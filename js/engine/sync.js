// Auto-sync engine — transport-agnostic outbox, retry, and merge rules.
// The live transport is Supabase (engine/cloud.js, orchestrated by
// engine/autosync.js). The Cloudflare Worker client at the bottom is DORMANT.
//
// Finished (and edited) workouts sit in the persistent outbox until the server
// acknowledges them; a boot-time pull-merge re-hydrates localStorage from the
// server so on-device history becomes a cache that can always be rebuilt.
// Everything here is pure or takes an injected `fetchImpl` / `post` / `get`,
// so the outbox, retry and merge rules are unit-tested with no DOM.
//
// Only the workout LOG ever syncs: per-set camera blobs, the v1 legacy copy and
// anything pose-shaped are stripped before a request is built.

// DORMANT (Cloudflare Worker): no longer read by the app.
export const SYNC_DEFAULTS = Object.freeze({ url: '' });

export const NEVER_SYNC_KEYS = Object.freeze([
  'camera', 'legacyV1', 'landmarks', 'poseLandmarks', 'worldLandmarks', 'frames', 'video', 'image',
]);
const NEVER_SYNC = new Set(NEVER_SYNC_KEYS);

const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 30 * 60 * 1000;

// ── payload shaping ──────────────────────────────────────────────────────────

function isWorkoutish(w) {
  return !!w && typeof w === 'object' && typeof w.id === 'string' && Array.isArray(w.exercises);
}

/** Version used for last-writer-wins: explicit edit stamp, else finish/start time. */
export function workoutVersion(w) {
  if (!w) return 0;
  return Number(w.updatedAtMs ?? w.endedAtMs ?? w.startedAtMs ?? 0) || 0;
}

function stripNeverSync(v) {
  if (Array.isArray(v)) return v.map(stripNeverSync);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (!NEVER_SYNC.has(k)) out[k] = stripNeverSync(x);
    return out;
  }
  return v;
}

/** Deep copy of a workout with every camera/pose key removed and a version stamp. */
export function sanitizeForSync(workout) {
  const out = stripNeverSync(workout);
  out.updatedAtMs = workoutVersion(workout);
  return out;
}

// Local-only fields (camera provenance, v1 copy) are never on the server, so a
// newer remote version must not erase them from this device.
function carryLocalOnly(local, remote) {
  const out = { ...remote };
  if (local.legacyV1 && !out.legacyV1) out.legacyV1 = local.legacyV1;
  out.exercises = (remote.exercises || []).map((ex, ei) => {
    const lex = (local.exercises || [])[ei];
    if (!lex || lex.exerciseId !== ex.exerciseId || !Array.isArray(ex.sets)) return ex;
    return {
      ...ex,
      sets: ex.sets.map((s, si) => {
        const ls = (lex.sets || [])[si];
        return ls && ls.camera && s && !s.camera ? { ...s, camera: ls.camera } : s;
      }),
    };
  });
  return out;
}

/**
 * Merge pulled workouts into the local store. Unknown ids are added; a known id
 * is replaced only when the remote version is strictly newer AND the local copy
 * has no un-pushed change pending in the outbox (pending local edits win).
 * Returns the input array untouched when nothing changed.
 * @returns {{workouts:object[], added:number, updated:number}}
 */
export function mergeRemote(local, remote, { pendingIds = new Set() } = {}) {
  const map = new Map();
  for (const w of local || []) if (w && w.id && !map.has(w.id)) map.set(w.id, w);
  const addedIds = new Set();
  let updated = 0;
  for (const r of remote || []) {
    if (!isWorkoutish(r)) continue;
    const cur = map.get(r.id);
    if (!cur) { map.set(r.id, r); addedIds.add(r.id); continue; }
    if (pendingIds.has(r.id)) continue;
    if (workoutVersion(r) > workoutVersion(cur)) {
      map.set(r.id, carryLocalOnly(cur, r));
      if (!addedIds.has(r.id)) updated += 1;
    }
  }
  if (!addedIds.size && !updated) return { workouts: local || [], added: 0, updated: 0 };
  const workouts = [...map.values()]
    .sort((a, b) => (b.startedAtMs ?? -Infinity) - (a.startedAtMs ?? -Infinity));
  return { workouts, added: addedIds.size, updated };
}

// ── outbox / retry ───────────────────────────────────────────────────────────
// Outbox entries are { id, endedAtMs, queuedAt, attempts?, nextAttemptAt?, lastError? }.
// queuedAt identifies the version that was queued: an edit made while a POST
// is in flight re-queues with a new queuedAt, so the late ack can't drop it.

/** Exponential backoff with jitter in [0.5, 1] of the capped delay. */
export function backoffMs(attempts, { baseMs = BACKOFF_BASE_MS, maxMs = BACKOFF_MAX_MS, rand = Math.random } = {}) {
  const n = Math.max(1, Math.floor(attempts) || 1);
  const capped = Math.min(maxMs, baseMs * 2 ** (n - 1));
  return Math.round(capped * (0.5 + 0.5 * rand()));
}

export function dueEntries(outbox, nowMs) {
  return (outbox || []).filter((e) => e && e.id && !(e.nextAttemptAt > nowMs));
}

/** Earliest scheduled retry among outbox entries, or null if none is waiting. */
export function nextRetryAt(outbox) {
  let t = null;
  for (const e of outbox || []) if (e && e.nextAttemptAt && (t == null || e.nextAttemptAt < t)) t = e.nextAttemptAt;
  return t;
}

const snap = (e) => ({ id: e.id, queuedAt: e.queuedAt ?? null });
const same = (e, s) => e.id === s.id && (e.queuedAt ?? null) === s.queuedAt;

/**
 * Apply a drain result to the CURRENT outbox (re-read after the await, so
 * entries queued meanwhile survive). sent/dropped are removed; failed get
 * attempts+1 and a backoff-scheduled nextAttemptAt.
 */
export function applySyncResults(outbox, { sent = [], failed = [], dropped = [] } = {}, nowMs, { rand } = {}) {
  const gone = [...sent, ...dropped];
  return (outbox || [])
    .filter((e) => !gone.some((s) => same(e, s)))
    .map((e) => {
      const f = failed.find((s) => same(e, s));
      if (!f) return e;
      const attempts = (e.attempts || 0) + 1;
      return { ...e, attempts, nextAttemptAt: nowMs + backoffMs(attempts, { rand }), lastError: f.error || null };
    });
}

/**
 * POST every due outbox entry, in batches. Never throws: network/HTTP failures
 * are reported per entry so the caller can schedule a retry.
 * @param {object} p
 * @param {object[]} p.outbox      outbox snapshot
 * @param {object[]} p.workouts    local workouts (source of the payloads)
 * @param {(ws:object[])=>Promise<{rejected?:{id:string}[]}>} p.post
 * @param {number} p.nowMs
 * @param {(w:object)=>object} [p.prepare]  extra payload shaping (e.g. catalog enrichment); output is always sanitized
 * @returns {Promise<{sent:object[], failed:object[], dropped:object[], error:Error|null}>}
 */
export async function drainOutbox({ outbox, workouts, post, nowMs, prepare = (w) => w, batchSize = 25 }) {
  const byId = new Map((workouts || []).filter((w) => w && w.id).map((w) => [w.id, w]));
  const result = { sent: [], failed: [], dropped: [], error: null };
  // One payload per workout id: duplicate outbox entries (e.g. from an older
  // build or two tabs) ride along with the first and share its outcome.
  const sendable = [];
  const byEntryId = new Map();
  for (const e of dueEntries(outbox, nowMs)) {
    const w = byId.get(e.id);
    if (!w) { result.dropped.push(snap(e)); continue; } // no longer stored locally
    const group = byEntryId.get(e.id);
    if (group) { group.snaps.push(snap(e)); continue; }
    const g = { id: e.id, w, snaps: [snap(e)] };
    byEntryId.set(e.id, g);
    sendable.push(g);
  }
  for (let i = 0; i < sendable.length; i += batchSize) {
    const chunk = sendable.slice(i, i + batchSize);
    try {
      const res = await post(chunk.map((c) => sanitizeForSync(prepare(c.w))));
      const rejected = new Set(((res && res.rejected) || []).map((r) => r && r.id));
      for (const c of chunk) (rejected.has(c.id) ? result.dropped : result.sent).push(...c.snaps);
    } catch (err) {
      result.error = err;
      const msg = (err && err.message) || 'sync failed';
      for (const c of sendable.slice(i)) for (const sn of c.snaps) result.failed.push({ ...sn, error: msg });
      break;
    }
  }
  return result;
}

/** Follow GET /workouts pages from `since` until the server says there's no more. */
export async function pullAll({ get, since = 0, pageSize = 200, maxPages = 50 }) {
  let cursor = Math.max(0, Number(since) || 0);
  const workouts = [];
  for (let p = 0; p < maxPages; p += 1) {
    const res = await get(cursor, pageSize);
    if (Array.isArray(res && res.workouts)) workouts.push(...res.workouts);
    const next = Number(res && res.cursor);
    const advanced = Number.isFinite(next) && next > cursor;
    if (advanced) cursor = next;
    if (!(res && res.more) || !advanced) break;
  }
  return { workouts, cursor };
}

// ── status ───────────────────────────────────────────────────────────────────

/**
 * One sync-status pill state + label. Signed out is a calm state, not an
 * error: workouts keep queuing locally and upload on the next sign-in.
 */
export function syncStatus({ signedIn, online = true, pending = 0, busy = false, authFailed = false }) {
  if (!signedIn) return { state: 'signedout', label: 'Signed out' };
  if (authFailed) return { state: 'error', label: 'Sign in again' };
  if (!online) return { state: 'offline', label: pending ? `Offline · ${pending} pending` : 'Offline' };
  if (busy) return { state: 'syncing', label: 'Syncing…' };
  if (pending) return { state: 'pending', label: `Pending ${pending}` };
  return { state: 'synced', label: 'Synced ✓' };
}

// ── DORMANT: Cloudflare Worker client (sync/worker.js) ───────────────────────
// The Worker is not deployed; the live transport is Supabase (engine/cloud.js
// + engine/autosync.js). Kept, with its tests, in case the Worker is revived.

/** https://host[/path] with no trailing slash; plain http only for localhost. null if unusable. */
export function normalizeSyncUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return null; }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}

/**
 * @param {{url:string, token?:string|null, fetchImpl?:Function}} opts
 */
export function makeSyncClient({ url, token = null, fetchImpl = (...a) => fetch(...a) }) {
  const base = normalizeSyncUrl(url);
  async function call(path, { method = 'GET', body } = {}) {
    if (!base) throw new Error('Sync server URL is missing or not https.');
    const headers = {};
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    // keepalive lets a just-finished workout's POST outlive a backgrounded tab
    // (browsers cap keepalive bodies at 64 KB, so only small batches use it).
    const init = { method, headers, body: payload };
    if (payload && payload.length < 60000) init.keepalive = true;
    const res = await fetchImpl(`${base}${path}`, init);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok) {
      const err = new Error((json && json.error) || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return json;
  }
  return {
    base,
    signup: (inviteCode, label = 'form-coach') => call('/signup', { method: 'POST', body: { inviteCode, label } }),
    postWorkouts: (workouts) => call('/workouts', { method: 'POST', body: { workouts } }),
    getWorkouts: (since = 0, limit = 200) => call(`/workouts?since=${encodeURIComponent(since)}&limit=${encodeURIComponent(limit)}`),
  };
}
