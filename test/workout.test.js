import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeSet, makeWorkout, addExercise, addSet, updateSet, removeSet, removeExercise,
  reorderExercise, reorderSet, setVolume, workoutVolume, completedSetCount, totalReps,
  epley1RM, exercisePRs, newPRsInWorkout, lastPerformance, previousSets,
  pruneIncompleteSets, nextLoadSuggestion, cadenceScore, summarize, SET_TYPES,
} from '../js/engine/workout.js';

// ── constructors / defaults ──────────────────────────────────────────────────
test('makeSet applies safe defaults and clamps', () => {
  const s = makeSet();
  assert.equal(s.weight, null);
  assert.equal(s.reps, 0);
  assert.equal(s.durationSec, 0);
  assert.equal(s.distanceM, 0);
  assert.equal(s.steps, 0);
  assert.equal(s.floors, 0);
  assert.equal(s.type, 'normal');
  assert.equal(s.completed, false);
  assert.equal(s.source, 'manual');
  const bad = makeSet({ type: 'nonsense', source: 'nope', rpe: 99, reps: 4.6, side: 'X' });
  assert.ok(SET_TYPES.includes(bad.type) && bad.type === 'normal');
  assert.equal(bad.source, 'manual');
  assert.equal(bad.rpe, 10); // clamped 1..10
  assert.equal(bad.reps, 5); // rounded
  assert.equal(bad.side, null);
});

test('makeSet preserves and clamps Hevy duration/distance/step metrics', () => {
  const s = makeSet({ durationSec: 61.6, distanceM: 123.45, steps: 99.6, floors: 7.7 });
  assert.deepEqual(
    { durationSec: s.durationSec, distanceM: s.distanceM, steps: s.steps, floors: s.floors },
    { durationSec: 62, distanceM: 123.45, steps: 100, floors: 8 },
  );
  const clamped = makeSet({ durationSec: -2, distanceM: -5, steps: -1, floors: -4 });
  assert.deepEqual(
    { durationSec: clamped.durationSec, distanceM: clamped.distanceM, steps: clamped.steps, floors: clamped.floors },
    { durationSec: 0, distanceM: 0, steps: 0, floors: 0 },
  );
});

// ── mutation helpers (pure, return new objects) ──────────────────────────────
test('add / update / remove exercises and sets are pure', () => {
  let w = makeWorkout({ id: 'w1', title: 'Test', startedAtMs: 0 });
  w = addExercise(w, 'bench-press', [{ weight: 60, reps: 5, completed: true }]);
  w = addSet(w, 0, { weight: 60, reps: 5, completed: true });
  assert.equal(w.exercises[0].sets.length, 2);
  w = updateSet(w, 0, 1, { reps: 8 });
  assert.equal(w.exercises[0].sets[1].reps, 8);
  const before = w.exercises[0].sets.length;
  const w2 = removeSet(w, 0, 0);
  assert.equal(w.exercises[0].sets.length, before, 'original untouched (pure)');
  assert.equal(w2.exercises[0].sets.length, before - 1);
});

test('reorderExercise moves an exercise and ignores out-of-range', () => {
  let w = makeWorkout({ id: 'w', startedAtMs: 0 });
  w = addExercise(w, 'a'); w = addExercise(w, 'b'); w = addExercise(w, 'c');
  const r = reorderExercise(w, 0, 2);
  assert.deepEqual(r.exercises.map((e) => e.exerciseId), ['b', 'c', 'a']);
  assert.equal(reorderExercise(w, 5, 0), w);
});

test('reorderSet moves a set within one exercise, pure, ignores out-of-range', () => {
  let w = makeWorkout({ id: 'w', startedAtMs: 0 });
  w = addExercise(w, 'a', [{ reps: 1 }, { reps: 2 }, { reps: 3 }]);
  w = addExercise(w, 'b', [{ reps: 9 }]);
  const r = reorderSet(w, 0, 0, 2);
  assert.deepEqual(r.exercises[0].sets.map((s) => s.reps), [2, 3, 1]);
  assert.deepEqual(w.exercises[0].sets.map((s) => s.reps), [1, 2, 3], 'original untouched (pure)');
  assert.deepEqual(r.exercises[1].sets.map((s) => s.reps), [9], 'other exercises untouched');
  assert.equal(reorderSet(w, 0, 5, 0).exercises[0], w.exercises[0], 'out-of-range from');
  assert.equal(reorderSet(w, 0, 0, 9).exercises[0], w.exercises[0], 'out-of-range to');
  assert.equal(reorderSet(w, 0, 1, 1).exercises[0], w.exercises[0], 'no-op move');
});

// ── volume (weighted vs bodyweight) ──────────────────────────────────────────
test('setVolume: weighted counts, bodyweight is reps-only by default', () => {
  assert.equal(setVolume(makeSet({ weight: 60, reps: 8, completed: true })), 480);
  assert.equal(setVolume(makeSet({ weight: 60, reps: 8, completed: false })), 0, 'uncompleted = 0');
  assert.equal(setVolume(makeSet({ weight: null, reps: 12, completed: true })), 0, 'bodyweight reps-only');
  assert.equal(setVolume(makeSet({ weight: null, reps: 12, completed: true }), { bodyweightKg: 80 }), 960);
});

test('workoutVolume sums completed sets across exercises', () => {
  let w = makeWorkout({ id: 'w', startedAtMs: 1000, endedAtMs: 1000 + 600000 });
  w = addExercise(w, 'bench-press', [
    { weight: 60, reps: 8, completed: true },
    { weight: 60, reps: 6, completed: true },
    { weight: 80, reps: 5, completed: false },
  ]);
  w = addExercise(w, 'goblet-squat', [{ weight: 24, reps: 10, completed: true }]);
  assert.equal(workoutVolume(w), 60 * 8 + 60 * 6 + 24 * 10);
  assert.equal(completedSetCount(w), 3);
  assert.equal(totalReps(w), 8 + 6 + 10);
});

// ── 1RM + PRs ────────────────────────────────────────────────────────────────
test('epley1RM matches the formula', () => {
  assert.equal(epley1RM(100, 5), 116.67); // 100 × (1 + 5/30), rounded to 2dp
  assert.equal(epley1RM(100, 0), 0);
});

test('exercisePRs derives max weight, 1RM, volume across history', () => {
  const history = [
    makeWorkoutWith('bench-press', [{ weight: 60, reps: 8, completed: true }]),
    makeWorkoutWith('bench-press', [{ weight: 80, reps: 3, completed: true }, { weight: 70, reps: 6, completed: true }]),
    makeWorkoutWith('squat', [{ weight: 100, reps: 5, completed: true }]),
  ];
  const pr = exercisePRs(history, 'bench-press');
  assert.equal(pr.maxWeight, 80);
  assert.ok(Math.abs(pr.best1RM - Math.max(epley1RM(60, 8), epley1RM(80, 3), epley1RM(70, 6))) < 1e-9);
  assert.equal(pr.maxVolume, Math.max(60 * 8, 80 * 3, 70 * 6));
  assert.equal(pr.repsAtWeight['80'], 3);
  assert.equal(exercisePRs(history, 'never-done'), null);
});

test('newPRsInWorkout flags fresh PRs vs prior history only', () => {
  const prior = [makeWorkoutWith('bench-press', [{ weight: 60, reps: 8, completed: true }])];
  const candidate = makeWorkoutWith('bench-press', [
    { weight: 60, reps: 8, completed: true },   // ties, not a PR
    { weight: 65, reps: 8, completed: true },    // weight + 1RM + volume PR
  ]);
  const prs = newPRsInWorkout(candidate, prior);
  assert.equal(prs.length, 1);
  assert.equal(prs[0].setIndex, 1);
  assert.ok(prs[0].kinds.includes('weight'));
});

// ── unilateral per-side sets ─────────────────────────────────────────────────
test('unilateral sets keep a side and both count toward volume', () => {
  let w = makeWorkout({ id: 'w', startedAtMs: 0 });
  w = addExercise(w, 'db-row', [
    { weight: 24, reps: 8, completed: true, side: 'L' },
    { weight: 24, reps: 8, completed: true, side: 'R' },
  ]);
  assert.equal(w.exercises[0].sets[0].side, 'L');
  assert.equal(w.exercises[0].sets[1].side, 'R');
  assert.equal(workoutVolume(w), 24 * 8 * 2);
});

// ── last performance recall (Hevy autofill source) ───────────────────────────
test('lastPerformance finds the most recent completed set (newest-first)', () => {
  const history = [
    makeWorkoutWith('bench-press', [{ weight: 70, reps: 5, completed: true }]),
    makeWorkoutWith('bench-press', [{ weight: 60, reps: 8, completed: true }]),
  ];
  const lp = lastPerformance(history, 'bench-press');
  assert.equal(lp.weight, 70);
  assert.equal(lastPerformance(history, 'nope'), null);
});

// ── progression (Occam rule, suggestions only) ───────────────────────────────
test('nextLoadSuggestion holds below target, progresses when met', () => {
  assert.equal(nextLoadSuggestion({ lastWeight: 20, lastReps: 5, targetReps: 7 }).action, 'hold');
  const p = nextLoadSuggestion({ lastWeight: 20, lastReps: 7, targetReps: 7 });
  assert.equal(p.action, 'progress');
  assert.ok(p.suggestedWeight > 20);
  assert.equal(p.suggestedWeight % 2.5, 0, 'plate-friendly kg increment');
});

test('nextLoadSuggestion holds when the 5/5 cadence is off', () => {
  const p = nextLoadSuggestion({ lastWeight: 20, lastReps: 8, targetReps: 7, cadenceOk: false });
  assert.equal(p.action, 'hold');
});

test('nextLoadSuggestion uses +10% when it exceeds the flat step', () => {
  const p = nextLoadSuggestion({ lastWeight: 100, lastReps: 7, targetReps: 7 }); // 10% = 10kg > 4.5
  assert.ok(p.suggestedWeight >= 110);
});

// ── cadence scoring (5/5 target from camera timestamps) ──────────────────────
test('cadenceScore rates rep tempo vs a 10s/rep (5/5) target', () => {
  assert.equal(cadenceScore([0]), null, 'needs >= 2 reps');
  const onPace = cadenceScore([0, 10000, 20000, 30000]); // 10s intervals
  assert.equal(onPace.verdict, 'on pace');
  assert.ok(onPace.score > 0.95);
  assert.equal(cadenceScore([0, 3000, 6000]).verdict, 'too fast');
  assert.equal(cadenceScore([0, 15000, 30000]).verdict, 'too slow');
});

// ── previous sets (per-row placeholders) ─────────────────────────────────────
test('previousSets returns completed sets of the newest workout with the exercise', () => {
  const newer = makeWorkoutWith('bench-press', [
    { weight: 60, reps: 8, completed: true },
    { weight: 62.5, reps: 6, completed: true },
    { weight: 65, reps: 3, completed: false }, // uncompleted → excluded
  ]);
  const older = makeWorkoutWith('bench-press', [{ weight: 50, reps: 10, completed: true }]);
  const prev = previousSets([newer, older], 'bench-press'); // newest-first
  assert.equal(prev.length, 2);
  assert.equal(prev[0].weight, 60);
  assert.equal(prev[1].weight, 62.5);
  assert.equal(previousSets([newer], 'squat').length, 0, 'unknown exercise → empty');
});

test('previousSets skips a newer workout whose sets were all uncompleted', () => {
  const emptyNewer = makeWorkoutWith('squat', [{ reps: 0, completed: false }]);
  const older = makeWorkoutWith('squat', [{ weight: null, reps: 12, completed: true }]);
  const prev = previousSets([emptyNewer, older], 'squat');
  assert.equal(prev.length, 1);
  assert.equal(prev[0].reps, 12);
});

// ── finish-time pruning ──────────────────────────────────────────────────────
test('pruneIncompleteSets drops uncompleted sets and empty exercises, keeps the rest', () => {
  let w = makeWorkout({ id: 'w', title: 'Mixed', startedAtMs: 0 });
  w = addExercise(w, 'bench-press', [
    { weight: 60, reps: 8, completed: true },
    { weight: 65, reps: 0, completed: false },
  ]);
  w = addExercise(w, 'db-row', [{ weight: 20, reps: 0, completed: false }]);
  const pruned = pruneIncompleteSets(w);
  assert.equal(pruned.exercises.length, 1, 'exercise with no completed sets is dropped');
  assert.equal(pruned.exercises[0].sets.length, 1);
  assert.equal(pruned.exercises[0].sets[0].weight, 60);
  // pure: the input workout is untouched
  assert.equal(w.exercises.length, 2);
  assert.equal(w.exercises[0].sets.length, 2);
  assert.equal(pruned.id, 'w');
});

test('pruneIncompleteSets keeps camera provenance on completed sets', () => {
  let w = makeWorkout({ id: 'w', startedAtMs: 0 });
  w = addExercise(w, 'squat', [{ reps: 10, completed: true, source: 'camera', camera: { reps: [] } }]);
  const pruned = pruneIncompleteSets(w);
  assert.equal(pruned.exercises[0].sets[0].source, 'camera');
  assert.ok(pruned.exercises[0].sets[0].camera);
});

// ── summary rollup ───────────────────────────────────────────────────────────
test('summarize rolls up duration, sets, reps, volume', () => {
  let w = makeWorkout({ id: 'w', title: 'Push', startedAtMs: 0, endedAtMs: 300000 });
  w = addExercise(w, 'bench-press', [{ weight: 60, reps: 8, completed: true }]);
  const s = summarize(w);
  assert.equal(s.durationSec, 300);
  assert.equal(s.sets, 1);
  assert.equal(s.reps, 8);
  assert.equal(s.volume, 480);
});

// helper
function makeWorkoutWith(exerciseId, sets) {
  let w = makeWorkout({ id: 'w-' + exerciseId + '-' + sets.map((s) => s.weight).join('-'), startedAtMs: 0 });
  return addExercise(w, exerciseId, sets);
}
