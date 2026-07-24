import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWOD } from '../js/engine/wod.js';
import { OS_FULL_BODY_ROUTINE } from '../js/engine/routines.js';
import { getCatalogEntry } from '../js/engine/catalog.js';

const NOW = Date.parse('2026-07-22T05:00:00Z');

function completedWorkout({ id = 'w1', at = NOW - 4 * 86400000, exerciseId, weight = 20, reps = 12, rpe = null }) {
  return {
    id, startedAtMs: at, endedAtMs: at + 3600000, title: 'Past',
    exercises: [{
      exerciseId,
      sets: Array.from({ length: 3 }, () => ({ weight, reps, rpe, completed: true, type: 'normal', source: 'manual' })),
    }],
  };
}

function exercise(result, id) {
  return result.workout.exercises.find((ex) => ex.exerciseId === id);
}

test('WOD is deterministic for identical inputs and injected time', () => {
  const args = { history: [], baselineRoutine: OS_FULL_BODY_ROUTINE, nowMs: NOW, variant: 0 };
  assert.deepEqual(generateWOD(args), generateWOD(args));
});

test('WOD is balanced, capped at 18 sets, and dumbbell/bodyweight only', () => {
  const result = generateWOD({ history: [], baselineRoutine: OS_FULL_BODY_ROUTINE, nowMs: NOW });
  assert.equal(result.workout.exercises.length, 6);
  assert.equal(result.meta.setCount, 18);
  const categories = result.workout.exercises.map((ex) => getCatalogEntry(ex.exerciseId).category);
  assert.ok(categories.includes('legs'));
  assert.ok(categories.includes('push'));
  assert.ok(categories.includes('pull'));
  for (const ex of result.workout.exercises) {
    assert.ok(['dumbbell', 'none'].includes(getCatalogEntry(ex.exerciseId).equipment));
    assert.ok(ex.sets.every((s) => !s.completed));
  }
});

test('Hevy baseline seeds familiar loads before local Form Coach history exists', () => {
  const result = generateWOD({ history: [], baselineRoutine: OS_FULL_BODY_ROUTINE, nowMs: NOW });
  assert.deepEqual(exercise(result, 'goblet-squat').sets.map((s) => [s.weight, s.reps]), [[26, 12], [26, 12], [26, 12]]);
  assert.deepEqual(exercise(result, 'db-row').sets.map((s) => [s.weight, s.reps]), [[20, 12], [20, 12], [20, 12]]);
  assert.deepEqual(exercise(result, 'pushup').sets.map((s) => [s.weight, s.reps]), [[null, 12], [null, 12], [null, 12]]);
});

test('movement choice rotates away from the most recently used option', () => {
  const history = [completedWorkout({ exerciseId: 'goblet-squat' })];
  const result = generateWOD({ history, baselineRoutine: OS_FULL_BODY_ROUTINE, nowMs: NOW, variant: 0 });
  assert.notEqual(result.workout.exercises[0].exerciseId, 'goblet-squat');
});

test('double progression adds about 5% and resets reps after all top-range sets', () => {
  // A more-recent push-up session makes bench press the least-recently-trained push
  // movement, so rotation selects it — the realistic case where load progression applies.
  const history = [
    completedWorkout({ id: 'push', at: NOW - 2 * 86400000, exerciseId: 'pushup', reps: 20 }),
    completedWorkout({ id: 'bench', at: NOW - 4 * 86400000, exerciseId: 'bench-press', weight: 20, reps: 12, rpe: 8 }),
  ];
  const result = generateWOD({ history, baselineRoutine: OS_FULL_BODY_ROUTINE, nowMs: NOW, variant: 1 });
  const bench = exercise(result, 'bench-press');
  assert.ok(bench, 'variant 1 includes bench press');
  assert.deepEqual(bench.sets.map((s) => [s.weight, s.reps]), [[21, 8], [21, 8], [21, 8]]);
});

test('a recent load jump is held instead of compounded again', () => {
  const history = [
    completedWorkout({ id: 'push', at: NOW - 2 * 86400000, exerciseId: 'pushup', reps: 20 }),
    completedWorkout({ id: 'new', at: NOW - 4 * 86400000, exerciseId: 'bench-press', weight: 20, reps: 12, rpe: 8 }),
    completedWorkout({ id: 'old', at: NOW - 8 * 86400000, exerciseId: 'bench-press', weight: 18, reps: 12, rpe: 8 }),
  ];
  const result = generateWOD({ history, baselineRoutine: OS_FULL_BODY_ROUTINE, nowMs: NOW, variant: 1 });
  assert.deepEqual(exercise(result, 'bench-press').sets.map((s) => s.weight), [20, 20, 20]);
});

test('high RPE eases load instead of progressing it', () => {
  const history = [
    completedWorkout({ id: 'push', at: NOW - 2 * 86400000, exerciseId: 'pushup', reps: 20 }),
    completedWorkout({ id: 'bench', at: NOW - 4 * 86400000, exerciseId: 'bench-press', weight: 20, reps: 10, rpe: 9.5 }),
  ];
  const result = generateWOD({ history, baselineRoutine: OS_FULL_BODY_ROUTINE, nowMs: NOW, variant: 1 });
  assert.deepEqual(exercise(result, 'bench-press').sets.map((s) => [s.weight, s.reps]), [[19, 8], [19, 8], [19, 8]]);
});

test('a workout inside 36 hours switches to two-set recovery mode', () => {
  const history = [completedWorkout({ at: NOW - 12 * 3600000, exerciseId: 'db-row', weight: 20, reps: 12 })];
  const result = generateWOD({ history, baselineRoutine: OS_FULL_BODY_ROUTINE, nowMs: NOW });
  assert.equal(result.meta.recoveryMode, true);
  assert.equal(result.meta.setCount, 12);
  assert.ok(result.workout.exercises.every((ex) => ex.sets.length === 2));
});

test('generator refuses hidden wall-clock access', () => {
  assert.throws(() => generateWOD({ history: [] }), /injected nowMs/);
});
