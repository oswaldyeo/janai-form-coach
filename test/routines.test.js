import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OCCAM_ROUTINE, OS_FULL_BODY_ROUTINE, BUILTIN_ROUTINES, makeRoutine, getRoutineDay,
  routineToWorkout, workoutToRoutine, repeatWorkout,
} from '../js/engine/routines.js';
import { makeWorkout, addExercise } from '../js/engine/workout.js';

// ── built-in Occam-style A/B ─────────────────────────────────────────────────
test('Occam routine: A = shoulder press + DB row, B = bench + goblet squat', () => {
  assert.equal(OCCAM_ROUTINE.builtin, true);
  const [A, B] = OCCAM_ROUTINE.days;
  assert.deepEqual(A.exercises.map((e) => e.exerciseId), ['shoulder-press', 'db-row']);
  assert.deepEqual(B.exercises.map((e) => e.exerciseId), ['bench-press', 'goblet-squat']);
});

test('Occam routine: 7 upper / 10 squat targets, 180s rest, 5/5 cadence, one set', () => {
  const [A, B] = OCCAM_ROUTINE.days;
  assert.equal(A.exercises[0].targetReps, 7);
  assert.equal(A.exercises[1].targetReps, 7);
  assert.equal(B.exercises[0].targetReps, 7);
  assert.equal(B.exercises[1].targetReps, 10); // squat gets 10
  for (const d of OCCAM_ROUTINE.days) for (const e of d.exercises) {
    assert.equal(e.targetSets, 1);
    assert.equal(e.targetRestSec, 180);
  }
  assert.equal(OCCAM_ROUTINE.cadenceTargetSec.up, 5);
  assert.equal(OCCAM_ROUTINE.cadenceTargetSec.down, 5);
});

test('Occam routine carries an honest non-medical disclaimer', () => {
  assert.match(OCCAM_ROUTINE.disclaimer, /not medical/i);
  assert.match(OCCAM_ROUTINE.disclaimer, /Occam/i);
  assert.ok(BUILTIN_ROUTINES.includes(OCCAM_ROUTINE));
});

test('Os’ Full Body copies the live Hevy routine exercises, weights, and reps', () => {
  assert.ok(BUILTIN_ROUTINES.includes(OS_FULL_BODY_ROUTINE));
  const w = routineToWorkout(OS_FULL_BODY_ROUTINE, 'A', { id: 'os1', startedAtMs: 5 });
  assert.deepEqual(w.exercises.map((e) => e.exerciseId), [
    'bench-press', 'goblet-squat', 'shoulder-press', 'db-row', 'skull-crusher',
    'bicep-curl', 'cable-twist', 'triceps-pushdown', 'split-squat',
  ]);
  assert.deepEqual(w.exercises[0].sets.map((s) => [s.weight, s.reps]), [[52, 12], [52, 12], [52, 12]]);
  assert.deepEqual(w.exercises[6].sets.map((s) => [s.weight, s.reps]), [[16.5, 12], [16.25, 12], [16.25, 12]]);
  assert.deepEqual(w.exercises[8].sets.map((s) => [s.weight, s.reps]), [[24, 12], [24, 12], [24, 12]]);
  assert.ok(w.exercises.every((e) => e.sets.every((s) => !s.completed)));
});

// ── seeding a workout from a routine ─────────────────────────────────────────
test('routineToWorkout seeds empty uncompleted sets per target', () => {
  const w = routineToWorkout(OCCAM_ROUTINE, 'B', { id: 'w1', startedAtMs: 5 });
  assert.equal(w.routineId, 'occam-ab');
  assert.equal(w.startedAtMs, 5);
  assert.deepEqual(w.exercises.map((e) => e.exerciseId), ['bench-press', 'goblet-squat']);
  for (const ex of w.exercises) {
    assert.equal(ex.sets.length, 1);
    assert.equal(ex.sets[0].completed, false);
    assert.equal(ex.sets[0].weight, null);
  }
});

test('getRoutineDay resolves by key and falls back to the first day', () => {
  assert.equal(getRoutineDay(OCCAM_ROUTINE, 'A').key, 'A');
  assert.equal(getRoutineDay(OCCAM_ROUTINE, 'zzz').key, 'A');
});

// ── save current workout as routine ──────────────────────────────────────────
test('workoutToRoutine derives targets from completed sets', () => {
  let w = makeWorkout({ id: 'w', title: 'My push', startedAtMs: 0 });
  w = addExercise(w, 'bench-press', [
    { weight: 60, reps: 8, completed: true },
    { weight: 60, reps: 6, completed: true },
  ]);
  const r = workoutToRoutine(w, { id: 'r1', name: 'My push' });
  assert.equal(r.name, 'My push');
  assert.equal(r.days[0].exercises[0].exerciseId, 'bench-press');
  assert.equal(r.days[0].exercises[0].targetSets, 2);
  assert.equal(r.days[0].exercises[0].targetReps, 8); // best of the completed sets
});

// ── repeat last workout ──────────────────────────────────────────────────────
test('repeatWorkout carries weights forward but resets completion', () => {
  let w = makeWorkout({ id: 'w', title: 'Push', startedAtMs: 0 });
  w = addExercise(w, 'bench-press', [{ weight: 60, reps: 8, completed: true }]);
  const next = repeatWorkout(w, { id: 'w2', startedAtMs: 99 });
  assert.equal(next.id, 'w2');
  assert.equal(next.startedAtMs, 99);
  const s = next.exercises[0].sets[0];
  assert.equal(s.weight, 60, 'weight carried forward');
  assert.equal(s.completed, false, 'completion reset');
});

// ── custom routine normalisation ─────────────────────────────────────────────
test('makeRoutine normalises a flat custom routine into a single day', () => {
  const r = makeRoutine({ id: 'c1', name: 'Arms', exercises: [{ exerciseId: 'bicep-curl', targetSets: 3, targetReps: 12 }] });
  assert.equal(r.days.length, 1);
  assert.equal(r.days[0].exercises[0].targetSets, 3);
  assert.equal(r.days[0].exercises[0].targetReps, 12);
  assert.equal(r.builtin, false);
});
