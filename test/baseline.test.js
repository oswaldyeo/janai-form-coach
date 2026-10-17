// Characterisation of pre-existing engine behaviour (must stay green).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_LIST, getCatalogEntry } from '../js/engine/catalog.js';
import { applyMigration, migrateSession } from '../js/engine/migration.js';
import { mergeWorkouts, parseBundle } from '../js/engine/backup.js';
import { buildDeliveryDocument, deliveryFilename } from '../js/engine/delivery.js';
import { BUILTIN_ROUTINES, routineToWorkout, repeatWorkout } from '../js/engine/routines.js';
import {
  makeSet, workoutVolume, epley1RM, newPRsInWorkout, seedWorkoutFromHistory, pruneIncompleteSets,
} from '../js/engine/workout.js';
import { workout, done, todo } from './helpers/fixtures.js';

test('catalog ids are unique and every routine exercise resolves', () => {
  const ids = CATALOG_LIST.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of BUILTIN_ROUTINES) for (const d of r.days) for (const e of d.exercises) {
    assert.ok(getCatalogEntry(e.exerciseId), `${r.id}: ${e.exerciseId}`);
  }
});

test('makeSet defaults and coercion', () => {
  const s = makeSet({ weight: '20', reps: '5.4' });
  assert.equal(s.weight, 20);
  assert.equal(s.reps, 5);
  assert.equal(s.completed, false);
  assert.equal(s.type, 'normal');
});

test('volume counts completed sets only; epley', () => {
  const w = workout('a', 0, [{ exerciseId: 'bench-press', sets: [done(10, 10), todo(50, 10)] }]);
  assert.equal(workoutVolume(w), 100);
  assert.equal(epley1RM(30, 10), 40);
});

test('v1 migration is idempotent and lossless', () => {
  const v1 = [{ id: 's1', exercise: 'squat', exerciseName: 'Squat', startedAtMs: 1, counts: { full: 5 } }];
  const a = applyMigration([], v1);
  assert.equal(a.added, 1);
  const b = applyMigration(a.workouts, v1);
  assert.equal(b.added, 0);
  assert.deepEqual(migrateSession(v1[0]).legacyV1, v1[0]);
});

test('mergeWorkouts: existing wins, dedupes by id, newest-first', () => {
  const local = [workout('a', 2, []), workout('b', 0, [])];
  const { workouts, added, skipped } = mergeWorkouts(local, [workout('a', 9, []), workout('c', 1, [])]);
  assert.equal(added, 1); assert.equal(skipped, 1);
  assert.deepEqual(workouts.map((w) => w.id), ['a', 'c', 'b']);
  assert.throws(() => parseBundle('nope'), /Not valid JSON/);
});

test('delivery document enriches names and has a stable filename', () => {
  const w = workout('w-x', 0, [{ exerciseId: 'bench-press', sets: [done(10, 5)] }]);
  const doc = buildDeliveryDocument([w], { resolveEntry: (id) => getCatalogEntry(id), nowMs: 5 });
  assert.equal(doc.workouts[0].exercises[0].exerciseName, getCatalogEntry('bench-press').name);
  assert.equal(deliveryFilename([w], 5), 'formcoach-w-x-5.json');
});

test('routine → workout → repeat preserves shape', () => {
  const w = routineToWorkout(BUILTIN_ROUTINES[0], null, { id: 'r1', startedAtMs: 1 });
  assert.ok(w.exercises.length > 0);
  const r = repeatWorkout(w, { id: 'r2' });
  assert.equal(r.exercises.length, w.exercises.length);
});

test('seedWorkoutFromHistory pre-fills from latest completed sets, uncompleted', () => {
  const hist = [workout('h', 0, [{ exerciseId: 'bench-press', sets: [done(20, 8), done(20, 7)] }])];
  const fresh = workout('n', 1, [{ exerciseId: 'bench-press', sets: [todo(null, 10)] }]);
  const seeded = seedWorkoutFromHistory(fresh, hist);
  assert.deepEqual(seeded.exercises[0].sets.map((s) => [s.weight, s.reps, s.completed]), [[20, 8, false], [20, 7, false]]);
});

test('pruneIncompleteSets drops unchecked sets and empty exercises; PRs vs prior', () => {
  const w = workout('p', 0, [
    { exerciseId: 'bench-press', sets: [done(20, 5), todo(20, 5)] },
    { exerciseId: 'db-row', sets: [todo(10, 5)] },
  ]);
  const p = pruneIncompleteSets(w);
  assert.equal(p.exercises.length, 1);
  assert.equal(p.exercises[0].sets.length, 1);
  assert.equal(newPRsInWorkout(p, []).length, 1);
});
