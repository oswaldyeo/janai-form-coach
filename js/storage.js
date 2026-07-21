// Browser-only persistence for v2: workouts, routines, settings, per-exercise
// calibration, plus the retained v1 history key and a one-time migration guard.
// Everything degrades gracefully if storage is unavailable (private mode, quota)
// — the app keeps working, it just doesn't remember.

import { applyMigration } from './engine/migration.js';

// v1 keys (retained; history.v1 is the rollback safety net and migration source)
const HISTORY_KEY = 'janai.formcoach.history.v1';
const CALIB_KEY = 'janai.formcoach.calibration.v1'; // reused as-is in v2 (keyed by exercise id)

// v2 keys
const WORKOUTS_KEY = 'janai.formcoach.workouts.v2';
const ACTIVE_KEY = 'janai.formcoach.active.v2';
const ROUTINES_KEY = 'janai.formcoach.routines.v2';
const SETTINGS_KEY = 'janai.formcoach.settings.v2';
const MIGRATION_KEY = 'janai.formcoach.migration';

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
function setItem(key, val) { try { localStorage.setItem(key, val); return true; } catch { return false; } }
function removeItem(key) { try { localStorage.removeItem(key); return true; } catch { return false; } }

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

export function saveWorkouts(workouts) {
  const arr = Array.isArray(workouts) ? workouts.slice(0, WORKOUT_LIMIT) : [];
  return setItem(WORKOUTS_KEY, JSON.stringify(arr));
}

/** Prepend one finished workout (newest-first). */
export function saveWorkout(workout) {
  const all = loadWorkouts();
  all.unshift(workout);
  return saveWorkouts(all);
}

export function clearWorkouts() {
  return removeItem(WORKOUTS_KEY);
}

// ── in-progress workout (crash / refresh / tab-kill recovery) ────────────────

export function loadActiveWorkout() {
  const w = safeParse(getItem(ACTIVE_KEY), null);
  return w && typeof w === 'object' && Array.isArray(w.exercises) ? w : null;
}

export function saveActiveWorkout(workout) {
  return setItem(ACTIVE_KEY, JSON.stringify(workout));
}

export function clearActiveWorkout() {
  return removeItem(ACTIVE_KEY);
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
  if (added > 0) saveWorkouts(workouts);
  setItem(MIGRATION_KEY, JSON.stringify({ v1MigratedAt: now(), fromVersion: 1, added }));
  return { migrated: added > 0, added, skipped };
}

/** Debug: clear the guard so the migration can be re-run against history.v1. */
export function resetMigration() {
  return removeItem(MIGRATION_KEY);
}
