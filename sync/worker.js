// Janai Form Coach — sync Worker (Cloudflare Workers + D1). No dependencies.
//
// A tiny token-authenticated mirror of the workout LOG so localStorage becomes
// a re-hydratable cache and finished workouts reach Janai Health with zero
// manual steps. Endpoints:
//
//   GET  /health                       → { ok: true }
//   POST /signup   {inviteCode,label}  → 201 { accountId, token }   (device token, shown once)
//   POST /tokens   {kind,label}        → 201 { token, kind }        (device-auth; kind device|server)
//   GET  /workouts?since=&limit=       → { workouts, cursor, more } (any token)
//   POST /workouts {workouts:[…]}      → { accepted, rejected }     (device token only)
//
// `since`/`cursor` are opaque server sequence numbers, not timestamps, so a
// poller never misses an edit because of device clock skew. Writes are
// last-writer-wins on the client's updatedAtMs; identical re-posts are no-ops,
// so retries are always safe. Camera / pose keys are stripped server-side as
// defence in depth — the log is the only thing this service ever stores.

const MAX_BODY_BYTES = 1_000_000;
const MAX_WORKOUT_BYTES = 256 * 1024;
const MAX_BATCH = 50;
const MAX_PAGE = 200;
const DEFAULT_PAGE = 100;
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const NEVER_STORE_KEYS = new Set([
  'camera', 'legacyV1', 'landmarks', 'poseLandmarks', 'worldLandmarks', 'frames', 'video', 'image',
]);

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    try {
      return await route(request, env, cors);
    } catch (err) {
      console.error('[sync] unhandled', err && err.stack ? err.stack : err);
      return json({ error: 'internal error' }, 500, cors);
    }
  },
};

async function route(request, env, cors) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const key = `${request.method} ${path}`;
  switch (key) {
    case 'GET /health': return json({ ok: true }, 200, cors);
    case 'POST /signup': return signup(request, env, cors);
    case 'POST /tokens': return createToken(request, env, cors);
    case 'GET /workouts': return listWorkouts(request, env, cors, url);
    case 'POST /workouts': return putWorkouts(request, env, cors);
    default: return json({ error: 'not found' }, 404, cors);
  }
}

// ── handlers ─────────────────────────────────────────────────────────────────

async function signup(request, env, cors) {
  if (!env.SIGNUP_CODE) return json({ error: 'signup disabled' }, 403, cors);
  const body = await readJson(request);
  if (!body.ok) return json({ error: body.error }, body.status, cors);
  const code = typeof body.value.inviteCode === 'string' ? body.value.inviteCode : '';
  if (!(await safeEqual(code, String(env.SIGNUP_CODE)))) return json({ error: 'invalid invite code' }, 403, cors);

  const t = nowMs(env);
  const accountId = `acc_${randomHex(12)}`;
  const token = newToken('device');
  await env.DB.batch([
    env.DB.prepare('INSERT INTO accounts (id, seq, created_at_ms) VALUES (?, 0, ?)').bind(accountId, t),
    env.DB.prepare('INSERT INTO tokens (token_hash, account_id, kind, label, created_at_ms) VALUES (?, ?, ?, ?, ?)')
      .bind(await sha256Hex(token), accountId, 'device', cleanLabel(body.value.label), t),
  ]);
  return json({ accountId, token, kind: 'device' }, 201, cors);
}

async function createToken(request, env, cors) {
  const who = await authenticate(request, env);
  if (!who) return json({ error: 'unauthorized' }, 401, cors);
  if (who.kind !== 'device') return json({ error: 'read-only token' }, 403, cors);
  const body = await readJson(request);
  if (!body.ok) return json({ error: body.error }, body.status, cors);
  const kind = body.value.kind === 'server' ? 'server' : body.value.kind === 'device' || body.value.kind == null ? 'device' : null;
  if (!kind) return json({ error: 'kind must be device or server' }, 400, cors);
  const token = newToken(kind);
  await env.DB.prepare('INSERT INTO tokens (token_hash, account_id, kind, label, created_at_ms) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), who.accountId, kind, cleanLabel(body.value.label), nowMs(env)).run();
  return json({ token, kind }, 201, cors);
}

async function listWorkouts(request, env, cors, url) {
  const who = await authenticate(request, env);
  if (!who) return json({ error: 'unauthorized' }, 401, cors);
  const since = Math.max(0, Math.floor(Number(url.searchParams.get('since')) || 0));
  const limitRaw = Math.floor(Number(url.searchParams.get('limit')) || DEFAULT_PAGE);
  const limit = Math.min(MAX_PAGE, Math.max(1, limitRaw));
  const { results } = await env.DB.prepare(
    'SELECT data, server_seq FROM workouts WHERE account_id = ? AND server_seq > ? ORDER BY server_seq ASC LIMIT ?'
  ).bind(who.accountId, since, limit + 1).all();
  const rows = results || [];
  const page = rows.slice(0, limit);
  const workouts = [];
  for (const r of page) {
    try { workouts.push(JSON.parse(r.data)); } catch { /* unreadable row — skip */ }
  }
  const cursor = page.length ? Number(page[page.length - 1].server_seq) : since;
  return json({ workouts, cursor, more: rows.length > limit }, 200, cors);
}

async function putWorkouts(request, env, cors) {
  const who = await authenticate(request, env);
  if (!who) return json({ error: 'unauthorized' }, 401, cors);
  if (who.kind !== 'device') return json({ error: 'read-only token' }, 403, cors);
  const body = await readJson(request);
  if (!body.ok) return json({ error: body.error }, body.status, cors);
  const v = body.value;
  const list = Array.isArray(v) ? v : Array.isArray(v.workouts) ? v.workouts : (v && v.id ? [v] : null);
  if (!list || !list.length) return json({ error: 'no workouts in body' }, 400, cors);
  if (list.length > MAX_BATCH) return json({ error: `at most ${MAX_BATCH} workouts per request` }, 413, cors);

  const t = nowMs(env);
  const accepted = [];
  const rejected = [];
  const stmts = [];
  for (const raw of list) {
    const checked = validateWorkout(raw);
    if (!checked.ok) { rejected.push({ id: raw && typeof raw.id === 'string' ? raw.id : null, reason: checked.reason }); continue; }
    const { workout, data, version } = checked;
    stmts.push(
      env.DB.prepare('UPDATE accounts SET seq = seq + 1 WHERE id = ?').bind(who.accountId),
      env.DB.prepare(
        `INSERT INTO workouts (account_id, id, data, client_updated_ms, server_seq, received_at_ms)
         VALUES (?, ?, ?, ?, (SELECT seq FROM accounts WHERE id = ?), ?)
         ON CONFLICT (account_id, id) DO UPDATE SET
           data = excluded.data,
           client_updated_ms = excluded.client_updated_ms,
           server_seq = excluded.server_seq,
           received_at_ms = excluded.received_at_ms
         WHERE excluded.client_updated_ms > workouts.client_updated_ms
            OR (excluded.client_updated_ms = workouts.client_updated_ms AND excluded.data <> workouts.data)`
      ).bind(who.accountId, workout.id, data, version, who.accountId, t),
    );
    accepted.push(workout.id);
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ accepted, rejected }, 200, cors);
}

// ── validation / sanitising (pure) ───────────────────────────────────────────

export function stripNeverStore(value) {
  if (Array.isArray(value)) return value.map(stripNeverStore);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!NEVER_STORE_KEYS.has(k)) out[k] = stripNeverStore(v);
    return out;
  }
  return value;
}

export function validateWorkout(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not an object' };
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return { ok: false, reason: 'bad id' };
  if (!Array.isArray(raw.exercises)) return { ok: false, reason: 'missing exercises' };
  const workout = stripNeverStore(raw);
  const version = Math.floor(Number(workout.updatedAtMs ?? workout.endedAtMs ?? workout.startedAtMs ?? 0)) || 0;
  workout.updatedAtMs = version;
  const data = JSON.stringify(workout);
  if (data.length > MAX_WORKOUT_BYTES) return { ok: false, reason: 'workout too large' };
  return { ok: true, workout, data, version };
}

// ── auth / crypto ────────────────────────────────────────────────────────────

async function authenticate(request, env) {
  const h = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  if (!m) return null;
  const hash = await sha256Hex(m[1]);
  const row = await env.DB.prepare(
    'SELECT account_id, kind FROM tokens WHERE token_hash = ? AND revoked_at_ms IS NULL'
  ).bind(hash).first();
  if (!row) return null;
  await env.DB.prepare('UPDATE tokens SET last_used_ms = ? WHERE token_hash = ?').bind(nowMs(env), hash).run();
  return { accountId: row.account_id, kind: row.kind };
}

function newToken(kind) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `jfc_${kind === 'server' ? 's' : 'd'}_${b64}`;
}

function randomHex(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time-ish compare: hash both sides so length and content timing leak nothing useful.
async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i += 1) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

// ── http helpers ─────────────────────────────────────────────────────────────

function nowMs(env) { return typeof env.now === 'function' ? env.now() : Date.now(); }

function cleanLabel(label) {
  return typeof label === 'string' ? label.slice(0, 64) : null;
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, status: 413, error: 'body too large' };
  try {
    const value = text ? JSON.parse(text) : {};
    if (!value || typeof value !== 'object') return { ok: false, status: 400, error: 'body must be a JSON object' };
    return { ok: true, value };
  } catch {
    return { ok: false, status: 400, error: 'invalid JSON' };
  }
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function json(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}
