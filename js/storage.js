// Browser-only persistence for v2: workouts, routines, settings, per-exercise
// calibration, plus the retained v1 history key and a one-time migration guard.
// Storage being unavailable (private mode, quota) never crashes the app, but it
// is never silent either: every write is read back, and failures are recorded
// per key (storageHealth / onStorageError) so the UI can tell the lifter.

import { applyMigration } from './engine/migration.js';
import { completedSetCount } from './engine/workout.js';

// v1 keys (retained; history.v1 is the rollback safety net and migration source)
const HISTORY_KEY = 'janai.formcoach.history.v1';
const CALIB_KEY = 'janai.formcoach.calibration.v1'; // reused as-is in v2 (keyed by exercise id)

// v2 keys
const WORKOUTS_KEY = 'janai.formcoach.workouts.v2';
const ACTIVE_KEY = 'janai.formcoach.active.v2';
const ROUTINES_KEY = 'janai.formcoach.routines.v2';
const SETTINGS_KEY = 'janai.formcoach.settings.v2';
const MIGRATION_KEY = 'janai.formcoach.migration';
// Delivery outbox: ids of finished workouts not yet handed to Janai Health.
// Persisted so a failed/cancelled/offline share is never lost — retry re-shares
// everything still pending, and the receiver dedupes by workout id.
const OUTBOX_KEY = 'janai.formcoach.outbox.v1';
// Raw copy of an unparseable workouts blob, kept before anything overwrites it.
const WORKOUTS_CORRUPT_KEY = 'janai.formcoach.workouts.v2.corrupt';
// Cloud auth session (Supabase GoTrue tokens). Workouts themselves are never
// stored here — only the signed-in identity that scopes cloud sync.
const CLOUD_SESSION_KEY = 'janai.formcoach.cloud.v1';
// Per-account record of the one-time sign-in backfill: { [userId]: epochMs }.
// Kept apart from the session so signing out and back in doesn't re-run it.
const CLOUD_BACKFILL_KEY = 'janai.formcoach.cloud.backfill.v1';
// DORMANT Cloudflare Worker pairing: { url, token, accountId, cursor, lastSyncMs, ... }.
// The token is shown to the user once at signup and lives only here after that.
const SYNC_KEY = 'janai.formcoach.sync.v1';

const HISTORY_LIMIT = 200;
const WORKOUT_LIMIT = 300;

export const DEFAULT_SETTINGS = Object.freeze({
  units: 'kg',
  bodyweightKg: null,
  defaultRestSec: 180,
  autoStartRest: true,
});

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function getItem(key) { try { return localStorage.getItem(key); } catch { return null; } }

// ── verified writes + error reporting ────────────────────────────────────────

const writeErrors = new Map(); // key → { key, kind: 'quota'|'unavailable'|'verify'|'corrupt', message, at }
const errorListeners = new Set();

function classifyStorageError(err) {
  const name = (err && err.name) || '';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || err?.code === 22 || err?.code === 1014) return 'quota';
  return 'unavailable';
}

function emit(e) { for (const fn of errorListeners) { try { fn(e); } catch { /* listener bug ≠ storage bug */ } } }

function reportWrite(key, err, kind) {
  const e = { key, kind: kind || classifyStorageError(err), message: err && err.message ? String(err.message) : null, at: Date.now() };
  writeErrors.set(key, e);
  emit(e);
  return false;
}

function clearWriteError(key) {
  if (writeErrors.delete(key)) emit({ key, kind: 'recovered', at: Date.now() });
}

// A write only counts once it reads back byte-identical.
function setItem(key, val) {
  try { localStorage.setItem(key, val); } catch (err) { return reportWrite(key, err); }
  let back;
  try { back = localStorage.getItem(key); } catch (err) { return reportWrite(key, err, 'verify'); }
  if (back !== val) return reportWrite(key, null, 'verify');
  clearWriteError(key);
  return true;
}

function removeItem(key) {
  try { localStorage.removeItem(key); } catch (err) { return reportWrite(key, err); }
  let back;
  try { back = localStorage.getItem(key); } catch (err) { return reportWrite(key, err, 'verify'); }
  if (back !== null) return reportWrite(key, null, 'verify');
  clearWriteError(key);
  return true;
}

/** Subscribe to write failures (and `kind: 'recovered'` once a key writes OK again). */
export function onStorageError(fn) {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}

/** Current write health: ok=false while any key's latest write failed. */
export function storageHealth() {
  const errors = [...writeErrors.values()];
  return { ok: errors.length === 0, errors };
}

export function _resetStorageStateForTests() {
  writeErrors.clear();
  errorListeners.clear();
  lastActiveJson = '';
}

// ── v1 history (retained; read by migration + v1 export) ─────────────────────

export function loadHistory() {
  const arr = safeParse(getItem(HISTORY_KEY), []);
  return Array.isArray(arr) ? arr : [];
}

export function saveSession(sessionObj) {
  const hist = loadHistory();
  hist.unshift(sessionObj);
  return setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, HISTORY_LIMIT)));
}

export function clearHistory() {
  return removeItem(HISTORY_KEY);
}

// ── calibration (unchanged v1 shape, reused by v2) ───────────────────────────

export function loadCalibration(exerciseId) {
  const all = safeParse(getItem(CALIB_KEY), {});
  return all[exerciseId] || null;
}

export function saveCalibration(exerciseId, calib) {
  const all = safeParse(getItem(CALIB_KEY), {});
  all[exerciseId] = calib;
  return setItem(CALIB_KEY, JSON.stringify(all));
}

// ── v2 workouts (history, newest-first, capped) ──────────────────────────────

export function loadWorkouts() {
  const arr = safeParse(getItem(WORKOUTS_KEY), []);
  return Array.isArray(arr) ? arr : [];
}

// No silent cap: dropping the oldest workouts to make room is data loss. If
// storage fills up the write fails loudly instead (see storageHealth).
export function saveWorkouts(workouts) {
  const arr = Array.isArray(workouts) ? workouts : [];
  return setItem(WORKOUTS_KEY, JSON.stringify(arr));
}

// History about to be rewritten. An unreadable blob is stashed under
// WORKOUTS_CORRUPT_KEY first, so a save can never replace it with [workout].
function loadWorkoutsForWrite() {
  const raw = getItem(WORKOUTS_KEY);
  if (raw == null) return [];
  const arr = safeParse(raw, null);
  if (Array.isArray(arr)) return arr;
  if (getItem(WORKOUTS_CORRUPT_KEY) !== raw && !setItem(WORKOUTS_CORRUPT_KEY, raw)) {
    reportWrite(WORKOUTS_KEY, null, 'corrupt');
    return null;
  }
  return [];
}

/**
 * Replace a stored workout by id (an edit of a past workout), stamping
 * updatedAtMs so the newer version wins on sync, and queue it for delivery.
 * Unknown ids are prepended. Returns the saved record, or null if storage failed.
 */
export function updateWorkout(workout, now = Date.now) {
  if (!workout || !workout.id) return null;
  const saved = { ...workout, updatedAtMs: now() };
  const all = loadWorkoutsForWrite();
  if (!all) return null;
  const idx = all.findIndex((w) => w && w.id === saved.id);
  if (idx >= 0) all[idx] = saved; else all.unshift(saved);
  if (!saveWorkouts(all)) return null;
  queueForDelivery(saved, now);
  return saved;
}

/** Insert one finished workout newest-first; replaces any copy with the same id. */
export function saveWorkout(workout) {
  if (!workout) return false;
  const all = loadWorkoutsForWrite();
  if (!all) return false;
  const rest = all.filter((w) => !(w && workout.id && w.id === workout.id));
  rest.unshift(workout);
  return saveWorkouts(rest);
}

/**
 * The finish transaction. Order matters: history is written and verified
 * FIRST; only then is the workout queued for delivery and the crash-recovery
 * copy removed. If the history write fails nothing else is touched, so the
 * in-progress copy survives for a retry / export.
 * @returns {{ok:true, queued:boolean, activeCleared:boolean} | {ok:false, stage:string, error:object|null}}
 */
export function commitFinishedWorkout(workout, now = Date.now) {
  if (!workout || !workout.id) return { ok: false, stage: 'invalid', error: null };
  if (!saveWorkout(workout)) return { ok: false, stage: 'history', error: writeErrors.get(WORKOUTS_KEY) || null };
  if (!loadWorkouts().some((w) => w && w.id === workout.id)) {
    return { ok: false, stage: 'verify', error: reportWrite(WORKOUTS_KEY, null, 'verify') || writeErrors.get(WORKOUTS_KEY) };
  }
  const queued = queueForDelivery(workout, now);
  const active = loadActiveWorkout();
  const activeCleared = active && active.id && active.id !== workout.id ? true : clearActiveWorkout();
  return { ok: true, queued, activeCleared };
}

export function clearWorkouts() {
  return removeItem(WORKOUTS_KEY);
}

// ── in-progress workout (crash / refresh / tab-kill recovery) ────────────────

export function loadActiveWorkout() {
  const w = safeParse(getItem(ACTIVE_KEY), null);
  return w && typeof w === 'object' && Array.isArray(w.exercises) ? w : null;
}

// Content of the last active write that actually landed (updatedAtMs excluded,
// so the stamp alone never forces a rewrite).
let lastActiveJson = '';

function activeContent(workout) {
  const { updatedAtMs, ...content } = workout; // eslint-disable-line no-unused-vars
  return content;
}

export function saveActiveWorkout(workout, now = Date.now) {
  if (!workout) return false;
  const content = activeContent(workout);
  if (!setItem(ACTIVE_KEY, JSON.stringify({ ...content, updatedAtMs: now() }))) return false;
  lastActiveJson = JSON.stringify(content);
  return true;
}

/**
 * Crash-recovery write, called on every mutation and timer tick. Skips writes
 * whose content already landed; a FAILED write is never remembered, so the
 * next tick retries it.
 */
export function persistActiveWorkout(workout, now = Date.now) {
  if (!workout) return false;
  if (JSON.stringify(activeContent(workout)) === lastActiveJson) return true;
  return saveActiveWorkout(workout, now);
}

export function clearActiveWorkout() {
  const ok = removeItem(ACTIVE_KEY);
  if (ok) lastActiveJson = '';
  return ok;
}

/**
 * Decide what to do with a stored active workout at launch. One whose id is
 * already in history with at least as many completed sets is the leftover of
 * a finish whose cleanup did not land — resuming it would re-log a finished
 * session, so it is dropped. Anything with more logged work is resumed.
 * @returns {{workout:object|null, reason:'none'|'already-saved'|'resume'|'saved-but-newer'}}
 */
export function resolveActiveOnBoot() {
  const active = loadActiveWorkout();
  if (!active) return { workout: null, reason: 'none' };
  const saved = active.id ? loadWorkouts().find((w) => w && w.id === active.id) : null;
  if (saved && completedSetCount(active) <= completedSetCount(saved)) {
    clearActiveWorkout();
    return { workout: null, reason: 'already-saved' };
  }
  return { workout: active, reason: saved ? 'saved-but-newer' : 'resume' };
}

// ── v2 routines (user-created; built-ins live in code) ───────────────────────

export function loadRoutines() {
  const arr = safeParse(getItem(ROUTINES_KEY), []);
  return Array.isArray(arr) ? arr : [];
}

export function saveRoutine(routine) {
  const all = loadRoutines();
  const idx = all.findIndex((r) => r.id === routine.id);
  if (idx >= 0) all[idx] = routine; else all.unshift(routine);
  return setItem(ROUTINES_KEY, JSON.stringify(all));
}

export function deleteRoutine(routineId) {
  const all = loadRoutines().filter((r) => r.id !== routineId);
  return setItem(ROUTINES_KEY, JSON.stringify(all));
}

// ── v2 settings ──────────────────────────────────────────────────────────────

export function loadSettings() {
  const s = safeParse(getItem(SETTINGS_KEY), {});
  return { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) };
}

export function saveSettings(patch) {
  const merged = { ...loadSettings(), ...patch };
  setItem(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

// ── delivery outbox (pending → Janai Health) ─────────────────────────────────
// An array of { id, endedAtMs, queuedAt, handedOffAt?, via?, attempts? }.
// Newest-first, capped. Delivery is a manual share on iOS (no unauthenticated
// write endpoint), so we remember what still needs sending across sessions and
// let the receiver dedupe. A resolved share sheet / triggered download only
// proves the file left the PWA — not that the Shortcut stored it — so those
// entries stay in the outbox as "unconfirmed" until the lifter confirms
// receipt (markDelivered).

export function loadOutbox() {
  const arr = safeParse(getItem(OUTBOX_KEY), []);
  return Array.isArray(arr) ? arr : [];
}

export function saveOutbox(arr) {
  return setItem(OUTBOX_KEY, JSON.stringify((arr || []).slice(0, WORKOUT_LIMIT)));
}

/**
 * Queue a finished workout for delivery (idempotent by id). A re-queue keeps
 * the manual hand-off state but refreshes queuedAt and moves the entry to the
 * front: the sync engine matches in-flight POSTs on {id, queuedAt}, so an edit
 * made while the old version is being sent is never dropped.
 */
export function queueForDelivery(workout, now = Date.now) {
  if (!workout || !workout.id) return false;
  const all = loadOutbox();
  const prev = all.find((e) => e.id === workout.id);
  const out = all.filter((e) => e.id !== workout.id);
  out.unshift({
    ...(prev || {}),
    id: workout.id,
    endedAtMs: workout.endedAtMs ?? (prev && prev.endedAtMs) ?? null,
    queuedAt: now(),
  });
  return saveOutbox(out);
}

/** Queue many workouts at once (e.g. a full upload when a device is first paired). */
export function queueManyForDelivery(workouts, now = Date.now) {
  const list = (workouts || []).filter((w) => w && w.id);
  const ids = new Set(list.map((w) => w.id));
  const t = now();
  const fresh = list.map((w) => ({ id: w.id, endedAtMs: w.endedAtMs ?? null, queuedAt: t }));
  return saveOutbox([...fresh, ...loadOutbox().filter((e) => !ids.has(e.id))]);
}

/** Record that these workouts were handed to the share sheet / downloaded. */
export function markHandedOff(ids, via, now = Date.now) {
  const set = new Set(ids || []);
  const t = now();
  return saveOutbox(loadOutbox().map((e) => (set.has(e.id)
    ? { ...e, handedOffAt: t, via: via || null, attempts: (e.attempts || 0) + 1 }
    : e)));
}

/**
 * Outbox split for the UI. `unsent` were never handed off; `unconfirmed` were
 * shared/downloaded but receipt is not confirmed; `orphaned` counts entries
 * whose workout is no longer in local history (nothing left to send).
 */
export function outboxStatus() {
  const out = loadOutbox();
  const ids = new Set(loadWorkouts().filter(Boolean).map((w) => w.id));
  const live = out.filter((e) => ids.has(e.id));
  return {
    unsent: live.filter((e) => !e.handedOffAt),
    unconfirmed: live.filter((e) => e.handedOffAt),
    orphaned: out.length - live.length,
    total: live.length,
  };
}

/** Mark a set of workout ids as delivered/received (remove them from the outbox). */
export function markDelivered(ids) {
  const set = new Set(ids || []);
  return saveOutbox(loadOutbox().filter((e) => !set.has(e.id)));
}

/** The full workout objects still pending delivery, newest-first. */
export function pendingWorkouts() {
  const pendingIds = new Set(loadOutbox().map((e) => e.id));
  if (!pendingIds.size) return [];
  return loadWorkouts().filter((w) => w && pendingIds.has(w.id));
}

export function clearOutbox() { return removeItem(OUTBOX_KEY); }

// ── one-time v1 → v2 migration (idempotent via guard) ────────────────────────

export function loadMigrationGuard() {
  return safeParse(getItem(MIGRATION_KEY), null);
}

/**
 * Run the v1→v2 migration once. Idempotent: the guard flag prevents re-runs, and
 * applyMigration() dedupes by workout id even if the guard is missing. Injectable
 * clock so callers/tests control the timestamp. Non-destructive: history.v1 is
 * never deleted.
 * @returns {{migrated:boolean, added:number, skipped:number}}
 */
export function ensureMigrated(now = Date.now) {
  const guard = loadMigrationGuard();
  if (guard && guard.v1MigratedAt) return { migrated: false, added: 0, skipped: 0 };
  const v1 = loadHistory();
  const existing = loadWorkouts();
  const { workouts, added, skipped } = applyMigration(existing, v1);
  // never set the guard over a failed write — the next launch must retry
  if (added > 0 && !saveWorkouts(workouts)) {
    return { migrated: false, added: 0, skipped, error: writeErrors.get(WORKOUTS_KEY) || null };
  }
  setItem(MIGRATION_KEY, JSON.stringify({ v1MigratedAt: now(), fromVersion: 1, added }));
  return { migrated: added > 0, added, skipped };
}

/** Debug: clear the guard so the migration can be re-run against history.v1. */
export function resetMigration() {
  return removeItem(MIGRATION_KEY);
}

// ── cloud session ────────────────────────────────────────────────────────────

export function loadCloudSession() {
  const s = safeParse(getItem(CLOUD_SESSION_KEY), null);
  return s && typeof s === 'object' && s.access_token ? s : null;
}

export function saveCloudSession(session) {
  return setItem(CLOUD_SESSION_KEY, JSON.stringify(session));
}

export function clearCloudSession() {
  return removeItem(CLOUD_SESSION_KEY);
}

export function isCloudBackfilled(userId) {
  if (!userId) return false;
  const m = safeParse(getItem(CLOUD_BACKFILL_KEY), {});
  return !!(m && typeof m === 'object' && m[userId]);
}

export function markCloudBackfilled(userId, now = Date.now) {
  if (!userId) return false;
  const m = safeParse(getItem(CLOUD_BACKFILL_KEY), {});
  return setItem(CLOUD_BACKFILL_KEY, JSON.stringify({ ...(m && typeof m === 'object' ? m : {}), [userId]: now() }));
}

// ── DORMANT Cloudflare Worker pairing (no longer read by the app) ──────────────────────────────────────────────────

export function loadSyncConfig() {
  const s = safeParse(getItem(SYNC_KEY), null);
  return s && typeof s === 'object' && s.token && s.url ? s : null;
}

/** Shallow-merge a patch into the stored sync config. */
export function saveSyncConfig(patch) {
  const cur = safeParse(getItem(SYNC_KEY), null);
  const merged = { ...(cur && typeof cur === 'object' ? cur : {}), ...patch };
  return setItem(SYNC_KEY, JSON.stringify(merged)) ? merged : null;
}

export function clearSyncConfig() {
  return removeItem(SYNC_KEY);
}
