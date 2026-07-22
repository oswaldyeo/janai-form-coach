// Adaptive Workout of the Day generator — pure, deterministic, no DOM/browser APIs.
//
// Janai Strength Coach principles encoded here:
//   - balanced full-body training, not random exercise soup
//   - dumbbell/bodyweight first
//   - rotate toward least-recently used movements
//   - double progression: earn reps, then add a conservative ~5% load
//   - cap volume and ease off when the previous session was <36 h ago
//
// The browser app can only read its local Form Coach history. A supplied baseline
// routine (Os's copied Hevy routine) seeds sensible loads before local history exists.

import { CATALOG_LIST, getCatalogEntry } from './catalog.js';
import { makeWorkout } from './workout.js';

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

const SLOT_IDS = [
  ['goblet-squat', 'split-squat', 'lunge', 'squat'],
  ['bench-press', 'pushup'],
  ['db-row'],
  ['shoulder-press'],
  ['bicep-curl', 'skull-crusher'],
  ['skull-crusher', 'bicep-curl'],
];

const ACCESSORIES = new Set(['bicep-curl', 'skull-crusher']);

export function generateWOD({
  history = [],
  catalog = CATALOG_LIST,
  baselineRoutine = null,
  nowMs,
  variant = 0,
  id = null,
} = {}) {
  if (!Number.isFinite(nowMs)) throw new Error('generateWOD requires an injected nowMs');
  const safeVariant = Math.max(0, Math.round(Number(variant) || 0));
  const allowed = new Map(catalog
    .filter((e) => e.equipment === 'dumbbell' || e.equipment === 'bodyweight')
    .map((e) => [e.id, e]));
  const recent = newestWorkout(history);
  const recoveryMode = !!(recent && nowMs - recent.startedAtMs >= 0 && nowMs - recent.startedAtMs < 36 * HOUR_MS);
  const selected = [];

  SLOT_IDS.forEach((slot, slotIndex) => {
    const candidates = slot.filter((exerciseId) => allowed.has(exerciseId) && !selected.includes(exerciseId));
    if (!candidates.length) return;
    selected.push(chooseLeastRecent(candidates, history, safeVariant + slotIndex));
  });

  const exercises = selected.slice(0, 6).map((exerciseId) => ({
    exerciseId,
    sets: recommendSets({ exerciseId, history, baselineRoutine, recoveryMode }),
  }));
  const dateKey = new Date(nowMs).toISOString().slice(0, 10);
  const workout = makeWorkout({
    id: id || `wod-${dateKey}-v${safeVariant}`,
    title: `Workout of the Day · ${recoveryMode ? 'Recovery' : 'Full Body'}`,
    startedAtMs: null,
    routineId: 'janai-wod',
    note: recoveryMode
      ? 'Janai Strength Coach: reduced to two working sets because your last logged workout was under 36 hours ago.'
      : 'Janai Strength Coach: balanced dumbbell/bodyweight session using recent Form Coach progress and your Hevy baseline.',
    exercises,
  });

  return {
    workout,
    meta: {
      recoveryMode,
      variant: safeVariant,
      generatedAtMs: nowMs,
      expiresAtMs: startOfNextLocalDay(nowMs),
      exerciseCount: exercises.length,
      setCount: exercises.reduce((n, ex) => n + ex.sets.length, 0),
      rationale: recoveryMode
        ? 'Recovery spacing: 2 sets each, loads held or eased.'
        : 'Balanced full body: movements rotate; reps build before load rises ~5%.',
    },
  };
}

function chooseLeastRecent(ids, history, rotation) {
  const ranked = ids.map((id, index) => ({
    id,
    lastAt: lastExerciseAt(history, id),
    rotated: mod(index - rotation, ids.length),
  }));
  ranked.sort((a, b) => a.lastAt - b.lastAt || a.rotated - b.rotated || a.id.localeCompare(b.id));
  return ranked[0].id;
}

function recommendSets({ exerciseId, history, baselineRoutine, recoveryMode }) {
  const entry = getCatalogEntry(exerciseId);
  const sessions = exerciseSessions(history, exerciseId);
  const latest = sessions[0] || [];
  const baseline = baselineSets(baselineRoutine, exerciseId);
  const source = latest.length ? latest : baseline;
  const bodyweight = entry && entry.loadType === 'bodyweight';
  const [low, high] = ACCESSORIES.has(exerciseId) ? [10, 15] : [8, 12];
  const setCount = recoveryMode ? 2 : clamp(latest.length || baseline.length || 3, 2, 3);
  const repsSeen = source.map((s) => s.reps).filter((v) => Number.isFinite(v) && v > 0);
  const latestReps = repsSeen.length ? Math.round(median(repsSeen)) : (bodyweight ? 12 : 10);
  let targetReps = clamp(latestReps, low, high);
  let targetWeight = null;

  if (!bodyweight) {
    const weights = source.map((s) => s.weight).filter((v) => Number.isFinite(v) && v >= 0);
    targetWeight = weights.length ? median(weights) : null;
  }

  if (latest.length) {
    const averageRpe = avg(latest.map((s) => s.rpe).filter((v) => Number.isFinite(v)));
    const allAtTop = latest.length >= 2 && latest.every((s) => (s.reps || 0) >= high);
    const alreadyJumped = didLoadJump(sessions);

    if (!bodyweight && targetWeight != null && !recoveryMode && allAtTop && averageRpe <= 8 && !alreadyJumped) {
      targetWeight = conservativeIncrease(targetWeight);
      targetReps = low;
    } else if (!bodyweight && targetWeight != null && (averageRpe >= 9 || latestReps < low)) {
      targetWeight = roundHalf(targetWeight * 0.95);
      targetReps = low;
    } else if (!recoveryMode) {
      targetReps = Math.min(high, targetReps + 1);
    }
  }

  if (recoveryMode && targetWeight != null) targetWeight = roundHalf(targetWeight * 0.95);

  return Array.from({ length: setCount }, () => ({
    weight: bodyweight ? null : targetWeight,
    reps: targetReps,
    type: 'normal',
    rpe: null,
    completed: false,
    source: 'manual',
    side: null,
    camera: null,
  }));
}

function exerciseSessions(history, exerciseId) {
  return [...(history || [])]
    .sort((a, b) => (b.startedAtMs || 0) - (a.startedAtMs || 0))
    .flatMap((w) => (w.exercises || [])
      .filter((ex) => ex.exerciseId === exerciseId)
      .map((ex) => (ex.sets || []).filter((s) => s.completed)))
    .filter((sets) => sets.length);
}

function didLoadJump(sessions) {
  if (sessions.length < 2) return false;
  const a = median(sessions[0].map((s) => s.weight).filter(Number.isFinite));
  const b = median(sessions[1].map((s) => s.weight).filter(Number.isFinite));
  return Number.isFinite(a) && Number.isFinite(b) && b > 0 && a > b * 1.025;
}

function baselineSets(routine, exerciseId) {
  for (const day of (routine && routine.days) || []) {
    const ex = (day.exercises || []).find((candidate) => candidate.exerciseId === exerciseId);
    if (ex && Array.isArray(ex.sets)) return ex.sets;
  }
  return [];
}

function lastExerciseAt(history, exerciseId) {
  let latest = 0;
  for (const w of history || []) {
    if ((w.exercises || []).some((ex) => ex.exerciseId === exerciseId && (ex.sets || []).some((s) => s.completed))) {
      latest = Math.max(latest, w.startedAtMs || 0);
    }
  }
  return latest;
}

function newestWorkout(history) {
  return (history || []).reduce((latest, w) => (!latest || (w.startedAtMs || 0) > (latest.startedAtMs || 0) ? w : latest), null);
}

function conservativeIncrease(weight) {
  const increased = roundHalf(weight * 1.05);
  return increased > weight ? increased : roundHalf(weight + 0.5);
}

function startOfNextLocalDay(nowMs) {
  const d = new Date(nowMs);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

function median(values) {
  if (!values.length) return NaN;
  const a = [...values].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}
function avg(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function mod(v, n) { return ((v % n) + n) % n; }
function roundHalf(v) { return Math.round(v * 2) / 2; }
