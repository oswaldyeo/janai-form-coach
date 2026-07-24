import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateSession, migrateV1History, applyMigration } from '../js/engine/migration.js';

// A minimal v1 session (SessionRecorder.toJSON() shape).
function v1Session(id, exercise = 'squat', full = 10) {
  return {
    schema: 'janai.form-coach.session', version: 1, id,
    exercise, exerciseName: exercise[0].toUpperCase() + exercise.slice(1),
    startedAtMs: 1000, endedAtMs: 42000, durationSec: 41,
    target: 10, completed: true,
    reps: Array.from({ length: full }, (_, i) => ({ index: i + 1, tMs: i * 1000, peakProgress: 0.9, depthPct: 90, quality: 'full' })),
    partials: 1, counts: { full, partial: 1 },
    calibration: { calibrated: true, restAngle: 168, peakAngle: 88, romSpan: 80 },
    cues: [], device: { ua: 'x', delegate: 'GPU' },
  };
}

test('migrateSession wraps a v1 set as a one-exercise, one-set workout', () => {
  const s = v1Session('abc', 'squat', 8);
  const w = migrateSession(s);
  assert.equal(w.id, 'w-abc');
  assert.equal(w.title, 'Squat');
  assert.equal(w.startedAtMs, 1000);
  assert.equal(w.exercises.length, 1);
  assert.equal(w.exercises[0].exerciseId, 'squat');
  const set = w.exercises[0].sets[0];
  assert.equal(set.reps, 8, 'reps come from counts.full');
  assert.equal(set.weight, null, 'v1 was bodyweight');
  assert.equal(set.source, 'camera');
  assert.equal(set.completed, true);
});

test('migration is LOSSLESS: original preserved as set.camera and workout.legacyV1', () => {
  const s = v1Session('keep');
  const w = migrateSession(s);
  assert.strictEqual(w.legacyV1, s);
  assert.strictEqual(w.exercises[0].sets[0].camera, s);
  assert.equal(w.importedFromV1, true);
});

test('corrupt / partial sessions are skipped and counted, never thrown', () => {
  const history = [v1Session('a'), null, {}, { foo: 1 }, v1Session('b')];
  const { workouts, count, skipped } = migrateV1History(history);
  assert.equal(count, 2);
  assert.equal(skipped, 3);
  assert.equal(workouts.length, 2);
});

test('migration is DETERMINISTIC: same input twice → identical output', () => {
  const history = [v1Session('a'), v1Session('b', 'pushup', 12)];
  const a = migrateV1History(history);
  const b = migrateV1History(history);
  assert.deepEqual(a, b);
});

test('applyMigration is IDEMPOTENT: second run adds nothing', () => {
  const history = [v1Session('a'), v1Session('b')];
  const first = applyMigration([], history);
  assert.equal(first.added, 2);
  const second = applyMigration(first.workouts, history);
  assert.equal(second.added, 0);
  assert.equal(second.workouts.length, first.workouts.length);
  assert.deepEqual(second.workouts, first.workouts);
});

test('applyMigration preserves already-present workouts and appends fresh ones', () => {
  const existing = [{ id: 'w-manual', title: 'hand-made', exercises: [] }];
  const { workouts, added } = applyMigration(existing, [v1Session('x')]);
  assert.equal(added, 1);
  assert.equal(workouts[0].id, 'w-manual', 'existing kept first');
  assert.ok(workouts.some((w) => w.id === 'w-x'));
});

test('empty history is a no-op', () => {
  assert.deepEqual(migrateV1History([]), { workouts: [], count: 0, skipped: 0 });
  assert.deepEqual(migrateV1History(null), { workouts: [], count: 0, skipped: 0 });
  const r = applyMigration([], []);
  assert.equal(r.added, 0);
});
