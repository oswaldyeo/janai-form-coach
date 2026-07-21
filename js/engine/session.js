// Session recording, summary, and the export schema for later Janai Health
// ingestion. Pure and deterministic: the clock is injected, so tests can drive
// exact timestamps and there is no hidden Date.now().
//
// ─── EXPORT SCHEMA (janai.form-coach.session, version 1) ────────────────────
// A single workout set. History in localStorage is an array of these; the JSON
// export is either one object or { schema, version, sessions: [...] }.
//
//   schema        "janai.form-coach.session"     stable discriminator
//   version       1                              bump on breaking change
//   id            string                         unique per set
//   exercise      string                         exercise id (e.g. "squat")
//   exerciseName  string                         human label
//   startedAtMs   number (epoch ms)              set start
//   endedAtMs     number (epoch ms) | null       set end (null while live)
//   durationSec   number                         (endedAt-startedAt)/1000, 0 while live
//   target        number | null                  target rep count, null = open set
//   completed     boolean                        reached target
//   reps          Rep[]                           one entry per counted (full) rep
//   partials      number                         excursions that missed peak depth
//   counts        { full, partial }              convenience totals
//   calibration   { calibrated, restAngle, peakAngle, romSpan }
//   cues          Cue[]                           logged form warnings (bad/warn)
//   device        object                         { ua?, delegate? } filled by browser
//
//   Rep  = { index, tMs, peakProgress, depthPct, quality }
//            tMs           ms offset from startedAtMs
//            peakProgress  0..1 depth of that rep (1 = full calibrated ROM)
//            depthPct      Math.round(peakProgress*100)
//            quality       "full"
//   Cue  = { tMs, text, tone }   tone in {"warn","bad"}
// ────────────────────────────────────────────────────────────────────────────

export const SCHEMA = 'janai.form-coach.session';
export const SCHEMA_VERSION = 1;

export class SessionRecorder {
  /**
   * @param {object} opts
   * @param {object} opts.exercise    exercise def (id + name)
   * @param {number|null} opts.target  target rep count
   * @param {object} opts.calibration  calibration object
   * @param {() => number} opts.now    injected clock (epoch ms)
   * @param {string} opts.id           session id
   * @param {object} opts.device       optional device metadata
   */
  constructor({ exercise, target = null, calibration, now, id, device = {} }) {
    if (typeof now !== 'function') throw new Error('SessionRecorder requires a now() clock');
    this._now = now;
    this.exerciseId = exercise.id;
    this.exerciseName = exercise.name;
    this.target = target;
    this.calibration = calibration
      ? {
          calibrated: !!calibration.calibrated,
          restAngle: calibration.restAngle,
          peakAngle: calibration.peakAngle,
          romSpan: calibration.romSpan,
        }
      : null;
    this.device = device;
    this.id = id || `s-${this._now().toString(36)}`;
    this.startedAtMs = this._now();
    this.endedAtMs = null;
    this.reps = [];
    this.partials = 0;
    this.cues = [];
  }

  /** Record one completed (full) rep. peakProgress in [0,1]. */
  recordRep(peakProgress) {
    const tMs = this._now() - this.startedAtMs;
    const p = clamp01(peakProgress);
    this.reps.push({
      index: this.reps.length + 1,
      tMs,
      peakProgress: round3(p),
      depthPct: Math.round(p * 100),
      quality: 'full',
    });
    return this.reps.length;
  }

  /** Record an excursion that never reached peak depth. */
  recordPartial() {
    this.partials += 1;
  }

  /** Log a form warning (deduped against the immediately previous identical cue). */
  recordCue(text, tone) {
    if (tone !== 'warn' && tone !== 'bad') return;
    const last = this.cues[this.cues.length - 1];
    if (last && last.text === text) return;
    this.cues.push({ tMs: this._now() - this.startedAtMs, text, tone });
  }

  end() {
    if (this.endedAtMs == null) this.endedAtMs = this._now();
    return this;
  }

  get repCount() {
    return this.reps.length;
  }

  get completed() {
    return this.target != null && this.repCount >= this.target;
  }

  /** Serialize to the versioned export schema (a plain object). */
  toJSON() {
    const end = this.endedAtMs;
    return {
      schema: SCHEMA,
      version: SCHEMA_VERSION,
      id: this.id,
      exercise: this.exerciseId,
      exerciseName: this.exerciseName,
      startedAtMs: this.startedAtMs,
      endedAtMs: end,
      durationSec: end == null ? 0 : Math.round((end - this.startedAtMs) / 100) / 10,
      target: this.target,
      completed: this.completed,
      reps: this.reps,
      partials: this.partials,
      counts: { full: this.reps.length, partial: this.partials },
      calibration: this.calibration,
      cues: this.cues,
      device: this.device,
    };
  }

  /** Human-facing rollup for the summary screen. */
  summary() {
    const depths = this.reps.map((r) => r.depthPct);
    const avgDepth = depths.length ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length) : 0;
    const bestDepth = depths.length ? Math.max(...depths) : 0;
    const s = this.toJSON();
    return {
      exercise: this.exerciseName,
      reps: this.reps.length,
      partials: this.partials,
      target: this.target,
      completed: this.completed,
      durationSec: s.durationSec,
      avgDepthPct: avgDepth,
      bestDepthPct: bestDepth,
      warnings: this.cues.length,
    };
  }
}

/** Wrap a list of session objects into a single exportable document (v1). */
export function toExportDocument(sessions) {
  return {
    schema: SCHEMA,
    version: SCHEMA_VERSION,
    exportedAtMs: null, // caller may stamp; kept null to preserve determinism here
    sessions: sessions.slice(),
  };
}

// ─── EXPORT SCHEMA v2 (janai.form-coach.workout, version 2) ─────────────────
// Superset of v1. A v2 document carries Workout objects (see engine/workout.js);
// each camera-sourced set embeds a v1-shaped `camera` blob, so downstream
// depth/cue analytics (Janai Health) keep working unchanged. Ingestion reads
// either a v1 doc (schema "...session", version 1, sessions[]) or a v2 doc
// (schema "...workout", version 2, workouts[]).
export const WORKOUT_SCHEMA = 'janai.form-coach.workout';
export const WORKOUT_SCHEMA_VERSION = 2;

/**
 * Wrap workouts into the versioned v2 export document.
 * @param {Object[]} workouts
 * @param {{settings?:object, migratedFrom?:number}} opts
 */
export function toWorkoutExportDocument(workouts, { settings = null, migratedFrom = null } = {}) {
  const doc = {
    schema: WORKOUT_SCHEMA,
    version: WORKOUT_SCHEMA_VERSION,
    exportedAtMs: null, // caller may stamp
    settings: settings || { units: 'kg' },
    workouts: (workouts || []).slice(),
  };
  // present ONLY if any workout was imported from v1
  const hasImport = migratedFrom != null || (workouts || []).some((w) => w && w.importedFromV1);
  if (hasImport) doc.migratedFrom = migratedFrom != null ? migratedFrom : 1;
  return doc;
}

function clamp01(v) {
  if (v == null || Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}
