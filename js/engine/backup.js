// Backup / import — pure data transforms, no DOM, no storage access.
//
// Export produces a versioned bundle wrapping the raw stores; import accepts
// either that bundle or a bare array of v2 Workouts (e.g. a Hevy conversion)
// and merges by workout id — existing records always win, so importing is
// idempotent and can never clobber data logged on this device.

export const BACKUP_FORMAT = 'formcoach-backup';
export const BACKUP_VERSION = 1;

/** Wrap the raw stores into a self-describing export bundle. */
export function exportBundle({ workouts = [], historyV1 = [], routines = [], settings = null }, nowMs) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAtMs: nowMs ?? null,
    workouts, historyV1, routines, settings,
  };
}

/**
 * Parse backup text → {workouts, historyV1, routines, settings} or throw with
 * a human-readable message. Accepts a bundle or a bare workouts array.
 */
export function parseBundle(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Not valid JSON.'); }
  if (Array.isArray(data)) data = { workouts: data };
  if (!data || typeof data !== 'object' || !Array.isArray(data.workouts)) {
    throw new Error('No workouts found in this file.');
  }
  const workouts = data.workouts.filter(isWorkoutish);
  const dropped = data.workouts.length - workouts.length;
  return {
    workouts, dropped,
    historyV1: Array.isArray(data.historyV1) ? data.historyV1 : [],
    routines: Array.isArray(data.routines) ? data.routines : [],
    settings: data.settings && typeof data.settings === 'object' ? data.settings : null,
  };
}

function isWorkoutish(w) {
  return !!w && typeof w === 'object' && typeof w.id === 'string' && Array.isArray(w.exercises);
}

/**
 * Merge imported workouts into the existing store. Dedup by id, existing wins.
 * Result keeps the store's newest-first order (by startedAtMs, unknown last).
 * @returns {{workouts:Object[], added:number, skipped:number}}
 */
export function mergeWorkouts(existing, incoming) {
  const have = new Set((existing || []).map((w) => w.id));
  const fresh = [];
  let skipped = 0;
  for (const w of incoming || []) {
    if (!isWorkoutish(w) || have.has(w.id)) { skipped += 1; continue; }
    have.add(w.id);
    fresh.push(w);
  }
  const workouts = [...(existing || []), ...fresh]
    .sort((a, b) => (b.startedAtMs ?? -Infinity) - (a.startedAtMs ?? -Infinity));
  return { workouts, added: fresh.length, skipped };
}
