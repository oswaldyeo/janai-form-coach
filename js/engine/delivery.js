// Delivery — turn finished v2 workouts into a payload Janai Health can ingest
// through the SAME strength-coach pipeline that Hevy feeds.
//
// The receiver on Os's Mac (scripts/formcoach-receive.py) is deliberately dumb:
// it validates, dedupes by workout id, normalizes to the canonical Hevy-shaped
// per-day file, and fires the shared workout-post reactive routine. For that to
// work it needs exercise NAMES and PRIMARY MUSCLE — data the PWA already has in
// its catalog but which the raw Workout objects only reference by id. So we
// resolve those here (where the catalog lives) and attach them as ADDITIVE
// fields on each exercise instance. The document stays the canonical v2
// `janai.form-coach.workout` schema — a superset, backwards-compatible with the
// existing export/import path and its tests.
//
// Pure + deterministic: the catalog resolver and clock are injected so this is
// unit-testable with no DOM and no Date.now().

import { toWorkoutExportDocument } from './session.js';

/**
 * Resolve one exercise instance's catalog metadata onto it (additive, non-destructive).
 * @param {object} ex          ExerciseInstance { exerciseId, sets[] }
 * @param {(id:string)=>({name?:string, primaryMuscle?:string}|null)} resolveEntry
 */
export function enrichExercise(ex, resolveEntry) {
  const entry = (resolveEntry && resolveEntry(ex.exerciseId)) || null;
  return {
    ...ex,
    exerciseName: entry && entry.name ? entry.name : ex.exerciseId,
    primaryMuscle: entry && entry.primaryMuscle ? entry.primaryMuscle : null,
  };
}

/** Enrich every exercise instance in a workout with catalog name + primary muscle. */
export function enrichWorkoutForDelivery(workout, resolveEntry) {
  return {
    ...workout,
    exercises: (workout.exercises || []).map((ex) => enrichExercise(ex, resolveEntry)),
  };
}

/**
 * Build the delivery document for a set of finished workouts. Wraps the standard
 * v2 export document (so ingestion + the export tests keep reading one schema)
 * and stamps an exportedAtMs. Each workout is enriched with resolved exercise
 * names + primary muscles so the receiver never needs the JS catalog.
 *
 * @param {object[]} workouts   finished Workout objects (engine/workout shape)
 * @param {object} opts
 * @param {object} opts.settings              { units, bodyweightKg }
 * @param {(id:string)=>object|null} opts.resolveEntry  catalog lookup
 * @param {number} opts.nowMs                 injected clock (epoch ms)
 */
export function buildDeliveryDocument(workouts, { settings = null, resolveEntry = null, nowMs = null } = {}) {
  const enriched = (workouts || []).map((w) => enrichWorkoutForDelivery(w, resolveEntry));
  const doc = toWorkoutExportDocument(enriched, { settings: settings || { units: 'kg' } });
  doc.exportedAtMs = nowMs;
  doc.deliveryTarget = 'janai-health'; // hint for the receiver / share sheet
  return doc;
}

/**
 * Stable filename for a delivery drop. Uses the workout ids so a re-share of the
 * same set produces the same name — the receiver dedupes by workout id anyway,
 * but a stable name keeps the iCloud inbox tidy and traceable.
 */
export function deliveryFilename(workouts, nowMs) {
  const ids = (workouts || []).map((w) => w && w.id).filter(Boolean);
  const tag = ids.length === 1 ? String(ids[0]).replace(/[^a-zA-Z0-9_-]/g, '') : `${ids.length}wk`;
  return `formcoach-${tag}-${nowMs || 0}.json`;
}
