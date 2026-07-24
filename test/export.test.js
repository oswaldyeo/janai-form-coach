import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toWorkoutExportDocument, WORKOUT_SCHEMA, WORKOUT_SCHEMA_VERSION,
  toExportDocument, SCHEMA,
} from '../js/engine/session.js';
import { makeWorkout, addExercise } from '../js/engine/workout.js';
import { migrateSession } from '../js/engine/migration.js';

test('v2 export document has the v2 discriminator, version and settings', () => {
  let w = makeWorkout({ id: 'w', title: 'Push', startedAtMs: 0, endedAtMs: 1000 });
  w = addExercise(w, 'bench-press', [{ weight: 60, reps: 8, completed: true }]);
  const doc = toWorkoutExportDocument([w], { settings: { units: 'kg' } });
  assert.equal(doc.schema, WORKOUT_SCHEMA);
  assert.equal(doc.schema, 'janai.form-coach.workout');
  assert.equal(doc.version, 2);
  assert.equal(WORKOUT_SCHEMA_VERSION, 2);
  assert.equal(doc.settings.units, 'kg');
  assert.equal(doc.workouts.length, 1);
});

test('migratedFrom is present ONLY when a workout was imported from v1', () => {
  const plain = toWorkoutExportDocument([makeWorkout({ id: 'w', startedAtMs: 0 })]);
  assert.equal('migratedFrom' in plain, false);

  const imported = migrateSession({ id: 'x', exercise: 'squat', exerciseName: 'Squat', startedAtMs: 0, counts: { full: 5 } });
  const doc = toWorkoutExportDocument([imported]);
  assert.equal(doc.migratedFrom, 1);
});

test('a v2 camera set still exposes a v1-shaped camera blob for Janai Health', () => {
  const v1 = { schema: SCHEMA, version: 1, id: 'x', exercise: 'squat', exerciseName: 'Squat', startedAtMs: 0, counts: { full: 5 }, reps: [], calibration: null, cues: [], device: {} };
  const imported = migrateSession(v1);
  const doc = toWorkoutExportDocument([imported]);
  const cam = doc.workouts[0].exercises[0].sets[0].camera;
  assert.equal(cam.schema, SCHEMA); // still the v1 session schema
  assert.equal(cam.version, 1);
  assert.equal(cam.counts.full, 5);
});

test('v1 export document is unchanged (backwards compatible)', () => {
  const doc = toExportDocument([{ id: 's1' }]);
  assert.equal(doc.schema, SCHEMA);
  assert.equal(doc.version, 1);
  assert.equal(doc.sessions.length, 1);
});
