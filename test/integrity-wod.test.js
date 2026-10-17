import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWOD } from '../js/engine/wod.js';
import { OS_FULL_BODY_ROUTINE } from '../js/engine/routines.js';
import { T0 } from './helpers/fixtures.js';

test('WOD recommends from last session even when stored weights are strings', () => {
  const sets = [1, 2, 3].map(() => ({ weight: '40', reps: '10', completed: true, rpe: null, type: 'normal' }));
  // pushup done more recently so the least-recent rotation picks bench-press
  const pushup = { id: 'p', startedAtMs: T0 + 3600000, endedAtMs: T0 + 3600001, exercises: [{ exerciseId: 'pushup', sets: [{ weight: null, reps: 10, completed: true }] }] };
  const history = [pushup, { id: 'h', startedAtMs: T0, endedAtMs: T0 + 1, exercises: [{ exerciseId: 'bench-press', sets }] }];
  const fromHistory = (h) => {
    for (let variant = 0; variant < 12; variant++) {
      const { workout } = generateWOD({ history: h, baselineRoutine: OS_FULL_BODY_ROUTINE, nowMs: T0 + 3 * 86400000, variant });
      const b = workout.exercises.find((e) => e.exerciseId === 'bench-press');
      if (b) return b.sets[0].weight;
    }
    return undefined;
  };
  const numeric = fromHistory([pushup, { ...history[1], exercises: [{ exerciseId: 'bench-press', sets: sets.map((s) => ({ ...s, weight: 40, reps: 10 })) }] }]);
  assert.notEqual(numeric, undefined, 'bench-press should appear in some WOD variant');
  assert.equal(fromHistory(history), numeric, 'string weights must recommend the same load as numeric ones');
});
