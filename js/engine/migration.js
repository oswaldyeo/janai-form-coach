// v1 → v2 history migration — pure, deterministic, idempotent, lossless.
//
// A v1 record is a single camera-counted bodyweight SET of one exercise (the
// SessionRecorder.toJSON() shape). v2's atom is a Workout with exercises and
// weighted sets. We wrap each v1 session as a one-exercise, one-set Workout and
// preserve the original blob twice — as `set.camera` (provenance) and as
// `workout.legacyV1` (lossless re-export) — so nothing is dropped.
//
// Determinism: ids derive from the source session id (no clocks, no randomness),
// so migrating the same input twice yields byte-identical output. Idempotence at
// the collection level is enforced by applyMigration(), which skips workouts
// whose id already exists.

/** Map one v1 session object → a v2 Workout. Returns null for corrupt input. */
export function migrateSession(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.exercise == null) return null; // needs at least an exercise id
  const reps = s.counts && typeof s.counts.full === 'number'
    ? s.counts.full
    : Array.isArray(s.reps) ? s.reps.length : 0;
  const id = 'w-' + (s.id != null ? s.id : `${s.exercise}-${s.startedAtMs ?? 0}`);
  return {
    id,
    title: s.exerciseName || s.exercise,
    startedAtMs: s.startedAtMs ?? null,
    endedAtMs: s.endedAtMs ?? null,
    note: 'Imported from v1',
    routineId: null,
    importedFromV1: true,
    legacyV1: s, // full original, lossless
    exercises: [
      {
        exerciseId: s.exercise,
        sets: [
          {
            weight: null, // v1 was bodyweight-only
            reps,
            type: 'normal',
            rpe: null,
            completed: true,
            source: 'camera',
            side: null,
            camera: s, // the whole v1 session blob, lossless
          },
        ],
      },
    ],
  };
}

/**
 * Migrate a full v1 history array. Corrupt/partial sessions are skipped and
 * counted, never thrown.
 * @returns {{workouts:Object[], count:number, skipped:number}}
 */
export function migrateV1History(v1History) {
  const workouts = [];
  let skipped = 0;
  for (const s of v1History || []) {
    const w = migrateSession(s);
    if (w) workouts.push(w);
    else skipped++;
  }
  return { workouts, count: workouts.length, skipped };
}

/**
 * Merge migrated v1 workouts into an existing v2 collection, skipping any whose
 * id is already present. Idempotent: running twice adds nothing the second time.
 * @returns {{workouts:Object[], added:number, skipped:number}}
 */
export function applyMigration(existingWorkouts, v1History) {
  const have = new Set((existingWorkouts || []).map((w) => w && w.id));
  const { workouts, skipped } = migrateV1History(v1History);
  const fresh = workouts.filter((w) => !have.has(w.id));
  // newest-first: imported sessions sit after any already-present workouts
  return { workouts: [...(existingWorkouts || []), ...fresh], added: fresh.length, skipped };
}
