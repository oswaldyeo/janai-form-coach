// Workout data model + derived analytics — pure, deterministic, no DOM.
//
// Hierarchy (all plain serializable objects so storage/export are trivial):
//
//   Workout            { id, title, startedAtMs, endedAtMs, note, exercises[] }
//     ExerciseInstance { exerciseId, sets[] }
//       Set            { weight, reps, durationSec, distanceM, steps, floors,
//                        type, rpe, completed, source, side, camera }
//
// A Set is the atom: `weight × reps`, entered manually by default. The camera
// coach can pre-fill `reps` (and attach a v1-shaped `camera` provenance blob),
// but load is always human-entered. Volume, PRs, 1RM, progression and cadence
// scoring are small pure functions here — directly unit-testable with no browser.

export const SET_TYPES = ['warmup', 'normal', 'drop', 'failure'];
export const SET_SOURCES = ['manual', 'camera'];

// ── constructors (defensive defaults; everything is a plain object) ──────────

export function makeSet(partial = {}) {
  const type = SET_TYPES.includes(partial.type) ? partial.type : 'normal';
  const source = SET_SOURCES.includes(partial.source) ? partial.source : 'manual';
  return {
    weight: partial.weight == null ? null : Number(partial.weight),
    reps: partial.reps == null ? 0 : Math.max(0, Math.round(Number(partial.reps) || 0)),
    durationSec: partial.durationSec == null ? 0 : Math.max(0, Math.round(Number(partial.durationSec) || 0)),
    distanceM: partial.distanceM == null ? 0 : Math.max(0, Number(partial.distanceM) || 0),
    steps: partial.steps == null ? 0 : Math.max(0, Math.round(Number(partial.steps) || 0)),
    floors: partial.floors == null ? 0 : Math.max(0, Math.round(Number(partial.floors) || 0)),
    type,
    rpe: partial.rpe == null ? null : clampRpe(partial.rpe),
    completed: !!partial.completed,
    source,
    side: partial.side === 'L' || partial.side === 'R' ? partial.side : null,
    camera: partial.camera || null,
  };
}

export function makeExerciseInstance(exerciseId, sets = []) {
  return { exerciseId, sets: sets.map((s) => makeSet(s)) };
}

export function makeWorkout(partial = {}) {
  return {
    id: partial.id || null,
    title: partial.title || 'Workout',
    startedAtMs: partial.startedAtMs ?? null,
    endedAtMs: partial.endedAtMs ?? null,
    note: partial.note || '',
    routineId: partial.routineId || null,
    exercises: (partial.exercises || []).map((e) => makeExerciseInstance(e.exerciseId, e.sets || [])),
  };
}

// ── set / workout mutation helpers (return NEW instances; pure) ──────────────

export function addExercise(workout, exerciseId, sets = [{}]) {
  return { ...workout, exercises: [...workout.exercises, makeExerciseInstance(exerciseId, sets)] };
}

export function removeExercise(workout, index) {
  return { ...workout, exercises: workout.exercises.filter((_, i) => i !== index) };
}

export function reorderExercise(workout, from, to) {
  const ex = workout.exercises.slice();
  if (from < 0 || from >= ex.length || to < 0 || to >= ex.length) return workout;
  const [moved] = ex.splice(from, 1);
  ex.splice(to, 0, moved);
  return { ...workout, exercises: ex };
}

export function addSet(workout, exIndex, partial = {}) {
  return mapExercise(workout, exIndex, (ex) => ({ ...ex, sets: [...ex.sets, makeSet(partial)] }));
}

export function removeSet(workout, exIndex, setIndex) {
  return mapExercise(workout, exIndex, (ex) => ({ ...ex, sets: ex.sets.filter((_, i) => i !== setIndex) }));
}

export function updateSet(workout, exIndex, setIndex, patch) {
  return mapExercise(workout, exIndex, (ex) => ({
    ...ex,
    sets: ex.sets.map((s, i) => (i === setIndex ? makeSet({ ...s, ...patch }) : s)),
  }));
}

function mapExercise(workout, exIndex, fn) {
  return { ...workout, exercises: workout.exercises.map((ex, i) => (i === exIndex ? fn(ex) : ex)) };
}

// ── volume & totals ──────────────────────────────────────────────────────────

/**
 * Volume of a single set. Completed sets only. External load = weight×reps;
 * a bodyweight set (weight null) is reps-only by default, unless a bodyweight is
 * supplied in opts (then it folds in weight × reps).
 */
export function setVolume(set, { bodyweightKg = null } = {}) {
  if (!set || !set.completed) return 0;
  const reps = set.reps || 0;
  if (set.weight != null) return round2(set.weight * reps);
  if (bodyweightKg != null) return round2(bodyweightKg * reps);
  return 0; // bodyweight, no stored bodyweight → reps-only, no weighted volume
}

export function workoutVolume(workout, opts = {}) {
  let total = 0;
  for (const ex of workout.exercises || []) {
    for (const s of ex.sets || []) total += setVolume(s, opts);
  }
  return round2(total);
}

export function completedSetCount(workout) {
  let n = 0;
  for (const ex of workout.exercises || []) for (const s of ex.sets || []) if (s.completed) n++;
  return n;
}

export function totalReps(workout) {
  let n = 0;
  for (const ex of workout.exercises || []) for (const s of ex.sets || []) if (s.completed) n += s.reps || 0;
  return n;
}

export function workoutDurationSec(workout) {
  if (workout.startedAtMs == null || workout.endedAtMs == null) return 0;
  return Math.max(0, Math.round((workout.endedAtMs - workout.startedAtMs) / 1000));
}

// ── 1RM & PRs ────────────────────────────────────────────────────────────────

/** Epley estimated one-rep max. */
export function epley1RM(weight, reps) {
  if (weight == null || reps == null || reps <= 0) return 0;
  return round2(weight * (1 + reps / 30));
}

/**
 * Per-exercise PRs computed over a history array of workouts. Derived, not
 * persisted authoritatively. Considers completed, externally-loaded sets.
 * Returns null if the exercise has no qualifying sets.
 */
export function exercisePRs(historyWorkouts, exerciseId) {
  let maxWeight = null;
  let best1RM = null;
  let maxVolume = null;
  const repsAtWeight = {}; // weight → max reps at that weight
  let any = false;

  for (const w of historyWorkouts || []) {
    for (const ex of w.exercises || []) {
      if (ex.exerciseId !== exerciseId) continue;
      for (const s of ex.sets || []) {
        if (!s.completed || s.weight == null) continue;
        any = true;
        if (maxWeight == null || s.weight > maxWeight) maxWeight = s.weight;
        const orm = epley1RM(s.weight, s.reps);
        if (best1RM == null || orm > best1RM) best1RM = orm;
        const vol = round2(s.weight * (s.reps || 0));
        if (maxVolume == null || vol > maxVolume) maxVolume = vol;
        const key = String(s.weight);
        if (repsAtWeight[key] == null || (s.reps || 0) > repsAtWeight[key]) repsAtWeight[key] = s.reps || 0;
      }
    }
  }
  if (!any) return null;
  return { maxWeight, best1RM, maxVolume, repsAtWeight };
}

/**
 * Which of a candidate workout's sets are new PRs vs prior history. Pure.
 * `priorHistory` should EXCLUDE the candidate workout. Returns an array of
 * { exerciseId, setIndex, kinds:[...] } where kinds ⊆ {weight,e1rm,volume}.
 */
export function newPRsInWorkout(candidate, priorHistory) {
  const out = [];
  for (const ex of candidate.exercises || []) {
    const prev = exercisePRs(priorHistory, ex.exerciseId);
    // track intra-workout bests so a later set only PRs vs earlier same-workout sets too
    let runMaxW = prev ? prev.maxWeight : null;
    let runMax1 = prev ? prev.best1RM : null;
    let runMaxV = prev ? prev.maxVolume : null;
    ex.sets.forEach((s, i) => {
      if (!s.completed || s.weight == null) return;
      const kinds = [];
      const orm = epley1RM(s.weight, s.reps);
      const vol = round2(s.weight * (s.reps || 0));
      if (runMaxW == null || s.weight > runMaxW) { kinds.push('weight'); runMaxW = s.weight; }
      if (runMax1 == null || orm > runMax1) { kinds.push('e1rm'); runMax1 = orm; }
      if (runMaxV == null || vol > runMaxV) { kinds.push('volume'); runMaxV = vol; }
      if (kinds.length) out.push({ exerciseId: ex.exerciseId, setIndex: i, kinds });
    });
  }
  return out;
}

/**
 * Completed sets from the most recent workout containing the exercise
 * (newest-first assumed). Powers the per-row "previous" placeholders: row i of
 * today's exercise mirrors set i of the last session, Hevy-style.
 */
export function previousSets(historyWorkouts, exerciseId) {
  for (const w of historyWorkouts || []) {
    for (const ex of w.exercises || []) {
      if (ex.exerciseId !== exerciseId) continue;
      const done = (ex.sets || []).filter((s) => s.completed);
      if (done.length) return done;
    }
  }
  return [];
}

/**
 * Drop uncompleted sets (and any exercise left with none) before saving a
 * finished workout, so history holds only what was actually performed. Pure.
 */
export function pruneIncompleteSets(workout) {
  const exercises = (workout.exercises || [])
    .map((ex) => ({ ...ex, sets: (ex.sets || []).filter((s) => s.completed) }))
    .filter((ex) => ex.sets.length > 0);
  return { ...workout, exercises };
}

/** Most-recent completed set for an exercise across history (newest-first assumed). */
export function lastPerformance(historyWorkouts, exerciseId) {
  for (const w of historyWorkouts || []) {
    for (const ex of w.exercises || []) {
      if (ex.exerciseId !== exerciseId) continue;
      const done = (ex.sets || []).filter((s) => s.completed);
      if (done.length) {
        const top = done.reduce((a, b) => ((b.weight || 0) >= (a.weight || 0) ? b : a));
        return { workoutId: w.id, startedAtMs: w.startedAtMs, weight: top.weight, reps: top.reps, sets: done.length };
      }
    }
  }
  return null;
}

// ── progression (Occam rule, deterministic — SUGGESTIONS ONLY) ───────────────

/**
 * Next-load suggestion. Occam-style: once you hit (or beat) the rep target at a
 * clean cadence, add load next session — the widely-cited increment is +10 lb or
 * +10%, whichever is greater. In kg we use +4.5 kg (≈10 lb) or +10%.
 * NEVER auto-applied; the UI presents it as a suggestion.
 *
 * @returns {{action:'progress'|'hold', suggestedWeight, delta, reason} | null}
 */
export function nextLoadSuggestion({ lastWeight, lastReps, targetReps, unit = 'kg', cadenceOk = true } = {}) {
  if (lastWeight == null || lastReps == null || targetReps == null) return null;
  if (lastReps < targetReps) {
    return { action: 'hold', suggestedWeight: lastWeight, delta: 0, reason: `Hold — hit ${targetReps} clean reps first (${lastReps}/${targetReps}).` };
  }
  if (!cadenceOk) {
    return { action: 'hold', suggestedWeight: lastWeight, delta: 0, reason: 'Hold — tighten the 5/5 cadence before adding load.' };
  }
  const absStep = unit === 'lb' ? 10 : 4.5;
  const inc = Math.max(absStep, lastWeight * 0.10);
  const raw = lastWeight + inc;
  const suggested = roundToIncrement(raw, unit);
  return { action: 'progress', suggestedWeight: suggested, delta: round2(suggested - lastWeight), reason: `Target met (${lastReps}/${targetReps}) — add load next session.` };
}

// round to the nearest plate-friendly increment (2.5 kg / 5 lb)
function roundToIncrement(v, unit) {
  const step = unit === 'lb' ? 5 : 2.5;
  return round2(Math.round(v / step) * step);
}

// ── cadence scoring (BodyPark-style, free from the camera timestamps) ────────

/**
 * Score rep tempo against an Occam 5/5 (10 s/rep) target from the camera
 * recorder's per-rep timestamps. Pure derivation — no new sensing.
 * @param {number[]} repTMs  ms offsets of completed reps (recorder.reps[].tMs)
 * @returns {{avgRepSec, targetSec, score, verdict, samples} | null}
 */
export function cadenceScore(repTMs, { targetTotalSec = 10 } = {}) {
  const t = (repTMs || []).filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  if (t.length < 2) return null;
  const intervals = [];
  for (let i = 1; i < t.length; i++) intervals.push((t[i] - t[i - 1]) / 1000);
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const score = clamp01(1 - Math.abs(avg - targetTotalSec) / targetTotalSec);
  const verdict = avg < targetTotalSec * 0.7 ? 'too fast' : avg > targetTotalSec * 1.3 ? 'too slow' : 'on pace';
  return { avgRepSec: round2(avg), targetSec: targetTotalSec, score: round2(score), verdict, samples: intervals.length };
}

// ── summary rollup for the summary screen ────────────────────────────────────

export function summarize(workout, opts = {}) {
  return {
    id: workout.id,
    title: workout.title,
    startedAtMs: workout.startedAtMs,
    durationSec: workoutDurationSec(workout),
    exercises: (workout.exercises || []).length,
    sets: completedSetCount(workout),
    reps: totalReps(workout),
    volume: workoutVolume(workout, opts),
  };
}

// ── tiny utils ───────────────────────────────────────────────────────────────

function clampRpe(v) {
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return Math.max(1, Math.min(10, Math.round(n * 2) / 2)); // 1..10, half steps
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function round2(v) { return Math.round(v * 100) / 100; }
