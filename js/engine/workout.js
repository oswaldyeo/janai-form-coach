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
    // UI-only: the lifter typed into this set. Lets the finish flow tell typed
    // work apart from untouched pre-filled rows; stripped before saving.
    ...(partial.edited ? { edited: true } : {}),
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
    ...(partial.updatedAtMs != null ? { updatedAtMs: partial.updatedAtMs } : {}),
    // Which routine day seeded this workout. Only routine starts set it (not
    // repeat-last or the WOD), so it doubles as "started from a routine".
    routineDayKey: partial.routineDayKey ?? null,
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

export function reorderSet(workout, exIndex, from, to) {
  return mapExercise(workout, exIndex, (ex) => {
    if (from < 0 || from >= ex.sets.length || to < 0 || to >= ex.sets.length || from === to) return ex;
    const sets = ex.sets.slice();
    const [moved] = sets.splice(from, 1);
    sets.splice(to, 0, moved);
    return { ...ex, sets };
  });
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
  // Number() guard: reps can arrive as a string from a cloud row or imported
  // backup; += on a string would concatenate, and the total reaches innerHTML.
  for (const ex of workout.exercises || []) for (const s of ex.sets || []) if (s.completed) n += Number(s.reps) || 0;
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
      for (const raw of ex.sets || []) {
        const s = numericSet(raw);
        if (!s.completed || s.weight == null) continue;
        any = true;
        if (maxWeight == null || s.weight > maxWeight) maxWeight = s.weight;
        const orm = epley1RM(s.weight, s.reps);
        if (best1RM == null || orm > best1RM) best1RM = orm;
        const vol = round2(s.weight * s.reps);
        if (maxVolume == null || vol > maxVolume) maxVolume = vol;
        const key = String(s.weight);
        if (repsAtWeight[key] == null || s.reps > repsAtWeight[key]) repsAtWeight[key] = s.reps;
      }
    }
  }
  if (!any) return null;
  return { maxWeight, best1RM, maxVolume, repsAtWeight };
}

/**
 * Which of a candidate workout's sets are new PRs vs prior history. Pure.
 * A copy of the candidate inside `priorHistory` (same id) is ignored, so a
 * re-saved workout never competes with itself. Returns an array of
 * { exerciseId, setIndex, kinds:[...] } where kinds ⊆ {weight,e1rm,volume}.
 */
export function newPRsInWorkout(candidate, priorHistory) {
  const out = [];
  const prior = (priorHistory || []).filter((w) => !(w && candidate.id && w.id === candidate.id));
  for (const ex of candidate.exercises || []) {
    const prev = exercisePRs(prior, ex.exerciseId);
    // track intra-workout bests so a later set only PRs vs earlier same-workout sets too
    let runMaxW = prev ? prev.maxWeight : null;
    let runMax1 = prev ? prev.best1RM : null;
    let runMaxV = prev ? prev.maxVolume : null;
    (ex.sets || []).forEach((raw, i) => {
      const s = numericSet(raw);
      if (!s.completed || s.weight == null) return;
      const kinds = [];
      const orm = epley1RM(s.weight, s.reps);
      const vol = round2(s.weight * s.reps);
      if (runMaxW == null || s.weight > runMaxW) { kinds.push('weight'); runMaxW = s.weight; }
      if (runMax1 == null || orm > runMax1) { kinds.push('e1rm'); runMax1 = orm; }
      if (runMaxV == null || vol > runMaxV) { kinds.push('volume'); runMaxV = vol; }
      if (kinds.length) out.push({ exerciseId: ex.exerciseId, setIndex: i, kinds });
    });
  }
  return out;
}

/**
 * Per-exercise progress time-series across history — the data behind a
 * Strong-style "max weight over time" chart. One point per workout that
 * contains the exercise (a workout may hold the exercise more than once — e.g.
 * a superset repeat — and those instances are merged into a single session
 * point). Considers completed sets only.
 *
 * Each point: {
 *   workoutId, startedAtMs, title,
 *   topSetWeight,   // heaviest completed weighted set that session
 *   best1RM,        // best Epley estimate that session
 *   volume,         // session volume for this exercise (weighted; bodyweight folds in if supplied)
 *   reps,           // total completed reps this session
 *   sets,           // completed set count this session
 *   bestSet         // {weight, reps} of the heaviest set (ties → more reps), or null if bodyweight-only
 * }
 *
 * Returned OLDEST-FIRST (charts read left→right in time), regardless of the
 * newest-first storage order. Sessions with no completed sets are skipped.
 * Pure.
 */
export function exerciseHistorySeries(historyWorkouts, exerciseId, { bodyweightKg = null } = {}) {
  const points = [];
  for (const w of historyWorkouts || []) {
    const insts = (w.exercises || []).filter((e) => e.exerciseId === exerciseId);
    if (!insts.length) continue;

    let volume = 0;
    let reps = 0;
    let sets = 0;
    let best1RM = null;
    let bestSet = null; // heaviest weighted set; ties broken by more reps
    for (const ex of insts) {
      for (const raw of ex.sets || []) {
        const s = numericSet(raw);
        if (!s.completed) continue;
        sets += 1;
        reps += s.reps;
        volume += setVolume(s, { bodyweightKg });
        if (s.weight == null) continue;
        const orm = epley1RM(s.weight, s.reps);
        if (best1RM == null || orm > best1RM) best1RM = orm;
        const better = bestSet == null
          || s.weight > bestSet.weight
          || (s.weight === bestSet.weight && (s.reps || 0) > (bestSet.reps || 0));
        if (better) bestSet = { weight: s.weight, reps: s.reps || 0 };
      }
    }
    if (sets === 0) continue; // no completed work this session

    points.push({
      workoutId: w.id,
      startedAtMs: w.startedAtMs ?? null,
      title: w.title || 'Workout',
      topSetWeight: bestSet ? bestSet.weight : null,
      best1RM,
      volume: round2(volume),
      reps,
      sets,
      bestSet,
    });
  }
  // Storage is newest-first; charts want oldest→newest along the x-axis. Nulls
  // (missing timestamps) sort to the front so they don't jump the newest bar.
  points.sort((a, b) => (a.startedAtMs || 0) - (b.startedAtMs || 0));
  return points;
}

// ── recall (what did I do last time?) ────────────────────────────────────────

/** When a workout happened, for recency: the later of its end and start. */
export function workoutTimeMs(w) {
  return Math.max(Number(w && w.endedAtMs) || 0, Number(w && w.startedAtMs) || 0);
}

/**
 * History sorted newest-first by workoutTimeMs. Storage order is NOT trusted:
 * cloud/import merges re-sort by startedAtMs, and a workout resumed after a
 * crash keeps its original start, so array position ≠ recency. Stable for ties.
 */
export function byRecency(historyWorkouts) {
  return (historyWorkouts || [])
    .filter(Boolean)
    .map((w, i) => ({ w, i, t: workoutTimeMs(w) }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.w);
}

/**
 * Completed sets from the most recent workout containing the exercise. Powers
 * the per-row "previous" placeholders: row i of today's exercise mirrors set i
 * of the last session, Hevy-style.
 */
export function previousSets(historyWorkouts, exerciseId) {
  for (const w of byRecency(historyWorkouts)) {
    for (const ex of w.exercises || []) {
      if (ex.exerciseId !== exerciseId) continue;
      const done = (ex.sets || []).filter((s) => s.completed);
      if (done.length) return done;
    }
  }
  return [];
}

/**
 * Fresh, UNCOMPLETED sets for an exercise about to be added to the active
 * workout, seeded from its most recent completed sets anywhere in history
 * (any routine — `previousSets` scans by recency across all workouts).
 * Preserves the shape a lifter would reuse — weight, reps, the cardio metrics,
 * set type and side — but strips completion and camera/rpe provenance so they
 * read as a clean plan for today. Falls back to a single blank set the first
 * time an exercise is ever logged. Pure.
 */
export function seedSetsFromHistory(historyWorkouts, exerciseId) {
  const prev = previousSets(historyWorkouts, exerciseId);
  if (!prev.length) return [makeSet({})];
  return prev.map((s) => makeSet({
    weight: s.weight,
    reps: s.reps,
    durationSec: s.durationSec,
    distanceM: s.distanceM,
    steps: s.steps,
    floors: s.floors,
    type: s.type,
    side: s.side,
    completed: false,
  }));
}

/**
 * Rows for an exercise added to a workout already in progress: one EMPTY,
 * uncompleted row per set of the last session (any routine), so each row's
 * placeholder shows that session's set and ✓ on an untouched row adopts it.
 * Only set type and side carry over — they shape the row, they aren't data.
 * Values stay blank so untouched rows never read as "typed" to the finish
 * flow's discard check. First time ever: a single blank row. Pure.
 */
export function placeholderSetsFromHistory(historyWorkouts, exerciseId) {
  const prev = previousSets(historyWorkouts, exerciseId);
  if (!prev.length) return [makeSet({})];
  return prev.map((s) => makeSet({ type: s.type, side: s.side }));
}

/**
 * Distinct exercise ids from workout history, most recently performed first
 * (by endedAtMs, else startedAtMs; within one workout, its exercise order).
 * Only exercises with a completed set count. Pure.
 */
export function recentExerciseIds(historyWorkouts, { limit = 8 } = {}) {
  const when = (w) => w.endedAtMs ?? w.startedAtMs ?? 0;
  const sorted = (historyWorkouts || [])
    .map((w, i) => ({ w, i }))
    .sort((a, b) => (when(b.w) - when(a.w)) || (a.i - b.i))
    .map((x) => x.w);
  const ids = [];
  for (const w of sorted) {
    for (const ex of w.exercises || []) {
      if (ids.length >= limit) return ids;
      if (!ex.exerciseId || ids.includes(ex.exerciseId)) continue;
      if ((ex.sets || []).some((s) => s.completed)) ids.push(ex.exerciseId);
    }
  }
  return ids;
}

/**
 * Overlay a freshly-built workout (from a routine template) with each
 * exercise's most recent logged sets: lifters expect today's defaults to be
 * "what I did last time", not the template's canned numbers. Exercises with
 * no history keep their template sets (the template IS the best guess on a
 * first attempt). Pure.
 */
export function seedWorkoutFromHistory(workout, historyWorkouts) {
  const exercises = (workout.exercises || []).map((ex) => {
    const prev = previousSets(historyWorkouts, ex.exerciseId);
    if (!prev.length) return ex;
    return { ...ex, sets: seedSetsFromHistory(historyWorkouts, ex.exerciseId) };
  });
  return { ...workout, exercises };
}

/**
 * Drop uncompleted sets (and any exercise left with none) before saving a
 * finished workout, so history holds only what was actually performed. Pure.
 */
export function pruneIncompleteSets(workout) {
  const exercises = (workout.exercises || [])
    .map((ex) => ({ ...ex, sets: (ex.sets || []).filter((s) => s.completed).map(stripEdited) }))
    .filter((ex) => ex.sets.length > 0);
  const { updatedAtMs, ...rest } = workout; // eslint-disable-line no-unused-vars
  return { ...rest, exercises };
}

function stripEdited(s) {
  if (!('edited' in s)) return s;
  const { edited, ...rest } = s; // eslint-disable-line no-unused-vars
  return rest;
}

function hasSetData(s) {
  return s.weight != null || (s.reps || 0) > 0 || (s.durationSec || 0) > 0
    || (s.distanceM || 0) > 0 || (s.steps || 0) > 0 || (s.floors || 0) > 0;
}

/**
 * What the finish-time prune would drop. `edited` = unticked sets the lifter
 * typed into (real work that was probably just not ticked); `seededOnly` =
 * unticked rows that still hold only pre-filled numbers (safe to drop).
 */
export function uncheckedSetsSummary(workout) {
  const edited = [];
  let seededOnly = 0;
  (workout.exercises || []).forEach((ex, ei) => (ex.sets || []).forEach((s, si) => {
    if (s.completed) return;
    if (s.edited && hasSetData(s)) edited.push({ ei, si, exerciseId: ex.exerciseId });
    else if (hasSetData(s)) seededOnly += 1;
  }));
  return { edited, seededOnly };
}

/** Tick every typed-into, unticked set (the "keep my typed sets" finish choice). */
export function completeEditedSets(workout) {
  return {
    ...workout,
    exercises: (workout.exercises || []).map((ex) => ({
      ...ex,
      sets: (ex.sets || []).map((s) => (!s.completed && s.edited && hasSetData(s) ? { ...s, completed: true } : s)),
    })),
  };
}

/** True when abandoning this workout would lose something the lifter did. */
export function hasLoggedWork(workout) {
  if (!workout) return false;
  return completedSetCount(workout) > 0 || uncheckedSetsSummary(workout).edited.length > 0;
}

/**
 * The per-exercise "last session" line: most recent workout (by recency) with
 * completed sets of this exercise, its top working set (warm-ups excluded
 * unless that is all there is; heaviest, ties → more reps), set count, and
 * calendar days ago in local time. null when the exercise has no history.
 */
export function lastSessionSummary(historyWorkouts, exerciseId, nowMs = Date.now()) {
  for (const w of byRecency(historyWorkouts)) {
    const done = (w.exercises || [])
      .filter((ex) => ex.exerciseId === exerciseId)
      .flatMap((ex) => (ex.sets || []).map(numericSet).filter((s) => s.completed));
    if (!done.length) continue;
    const working = done.filter((s) => s.type !== 'warmup');
    const pool = working.length ? working : done;
    const top = pool.reduce((a, b) => {
      const aw = a.weight ?? -Infinity;
      const bw = b.weight ?? -Infinity;
      return bw > aw || (bw === aw && b.reps > a.reps) ? b : a;
    });
    const atMs = workoutTimeMs(w);
    return {
      workoutId: w.id,
      title: w.title || 'Workout',
      atMs,
      daysAgo: atMs ? calendarDaysBetween(atMs, nowMs) : null,
      topSet: { weight: top.weight, reps: top.reps },
      top,
      sets: done.length,
    };
  }
  return null;
}

function calendarDaysBetween(aMs, bMs) {
  const a = new Date(aMs); a.setHours(0, 0, 0, 0);
  const b = new Date(bMs); b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 86400000);
}

/**
 * Other exercise ids in history that are the same movement under a different
 * catalog entry (e.g. "Bench press (dumbbell)" vs "Bench Press (Barbell)"):
 * same name once the equipment parenthetical and punctuation are dropped.
 * Newest first. Lets the UI say "logged as X" instead of a bare "first time".
 */
export function relatedHistoryIds(historyWorkouts, exerciseId, nameOf) {
  const base = movementKey(nameOf(exerciseId));
  if (!base) return [];
  const out = [];
  for (const w of byRecency(historyWorkouts)) {
    for (const ex of w.exercises || []) {
      if (ex.exerciseId === exerciseId || out.includes(ex.exerciseId)) continue;
      if (!(ex.sets || []).some((s) => s.completed)) continue;
      if (movementKey(nameOf(ex.exerciseId)) === base) out.push(ex.exerciseId);
    }
  }
  return out;
}

function movementKey(name) {
  if (!name) return '';
  return String(name).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Most-recent completed set for an exercise across history (by recency). */
export function lastPerformance(historyWorkouts, exerciseId) {
  for (const w of byRecency(historyWorkouts)) {
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

// Stored history is raw JSON (cloud rows / imported backups are not passed
// through makeSet), so numbers may arrive as strings. Compare numbers only.
function numericSet(s) {
  const w = s.weight == null || s.weight === '' ? null : Number(s.weight);
  return { ...s, weight: Number.isFinite(w) ? w : null, reps: Number(s.reps) || 0 };
}
function round2(v) { return Math.round(v * 100) / 100; }
