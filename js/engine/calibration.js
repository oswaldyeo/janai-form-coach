// Per-exercise calibration: observe the user's real range of motion on the
// driving joint, derive personalised rest/peak angles. Pure and testable.
//
// The user performs 1–3 slow full-ROM reps during a short calibration window.
// We record the driving angle each frame, then take robust extremes (a low/high
// percentile rather than the raw min/max, so a single bad landmark frame does
// not blow out the range). If the captured ROM is too small to trust, we report
// invalid and the caller falls back to the exercise defaults.

const MIN_SAMPLES = 12;      // ~0.5s at 24fps
const MIN_SPAN_DEG = 25;     // reject ROM narrower than this
const PCT = 0.1;             // trim 10% off each end for robustness

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const idx = clamp(Math.round((sortedAsc.length - 1) * p), 0, sortedAsc.length - 1);
  return sortedAsc[idx];
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * @param {object} exercise  from exercises.js (needs peakIsLow + defaults)
 * @param {number[]} samples driving-angle values captured during calibration
 * @returns {{valid:boolean, reason?:string, restAngle:number, peakAngle:number,
 *            romSpan:number, samples:number, calibrated:boolean}}
 */
export function calibrate(exercise, samples) {
  const clean = (samples || []).filter((v) => typeof v === 'number' && !Number.isNaN(v));
  const fallback = () => ({
    valid: false,
    reason: clean.length < MIN_SAMPLES ? 'Not enough motion captured' : 'Range of motion too small',
    restAngle: exercise.defaults.restAngle,
    peakAngle: exercise.defaults.peakAngle,
    romSpan: Math.abs(exercise.defaults.restAngle - exercise.defaults.peakAngle),
    samples: clean.length,
    calibrated: false,
  });

  if (clean.length < MIN_SAMPLES) return fallback();

  const sorted = [...clean].sort((a, b) => a - b);
  const lo = percentile(sorted, PCT);
  const hi = percentile(sorted, 1 - PCT);
  const span = hi - lo;
  if (span < MIN_SPAN_DEG) return fallback();

  // peakIsLow: peak of movement is the smaller angle (squat depth, curl flexion).
  // Otherwise the peak is the larger angle (press lockout).
  const restAngle = exercise.peakIsLow ? hi : lo;
  const peakAngle = exercise.peakIsLow ? lo : hi;

  return {
    valid: true,
    restAngle: round1(restAngle),
    peakAngle: round1(peakAngle),
    romSpan: round1(span),
    samples: clean.length,
    calibrated: true,
  };
}

/**
 * Default (uncalibrated) calibration object for an exercise.
 */
export function defaultCalibration(exercise) {
  return {
    valid: true,
    restAngle: exercise.defaults.restAngle,
    peakAngle: exercise.defaults.peakAngle,
    romSpan: Math.abs(exercise.defaults.restAngle - exercise.defaults.peakAngle),
    samples: 0,
    calibrated: false,
  };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

export const CALIBRATION_CONSTANTS = { MIN_SAMPLES, MIN_SPAN_DEG, PCT };
