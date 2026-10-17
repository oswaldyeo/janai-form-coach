// Recall / PR / finish-flow regressions for js/engine/workout.js (pure).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../js/engine/workout.js';
import { workout, done, todo, T0, DAY } from './helpers/fixtures.js';

const ex = (sets, exerciseId = 'bench-press') => [{ exerciseId, sets }];

// A workout resumed days later keeps its original startedAtMs; after any
// cloud/import merge the array is re-sorted by startedAtMs, so array position
// and recency disagree. Recall must follow time, not position.
const older = workout('old', 0, ex([done(20, 5)]));
const newer = workout('new', 3, ex([done(40, 5)]));

test('previousSets follows recency, not array order', () => {
  assert.equal(W.previousSets([older, newer], 'bench-press')[0].weight, 40);
  assert.equal(W.previousSets([newer, older], 'bench-press')[0].weight, 40);
});

test('recency uses endedAtMs: a resumed workout finished later is the latest session', () => {
  const resumed = workout('resumed', 0, ex([done(50, 5)]), { endedAtMs: T0 + 5 * DAY });
  assert.equal(W.previousSets([newer, resumed], 'bench-press')[0].weight, 50);
  assert.equal(W.lastPerformance([newer, resumed], 'bench-press').weight, 50);
  assert.equal(W.seedSetsFromHistory([newer, resumed], 'bench-press')[0].weight, 50);
});

test('PR lookups compare weights numerically even when stored as strings', () => {
  const imported = [{ id: 'i', startedAtMs: 1, exercises: ex([
    { weight: '100', reps: '5', completed: true }, { weight: '20', reps: '5', completed: true },
  ]) }];
  const prs = W.exercisePRs(imported, 'bench-press');
  assert.equal(prs.maxWeight, 100);
  assert.equal(prs.maxVolume, 500);
  const series = W.exerciseHistorySeries(imported, 'bench-press');
  assert.deepEqual(series[0].bestSet, { weight: 100, reps: 5 });
  const cand = workout('c', 9, ex([done(30, 5)]));
  assert.equal(W.newPRsInWorkout(cand, imported).length, 0, '30 is not a weight PR over 100');
});

test('edited flag survives updateSet and is stripped from saved history', () => {
  let w = workout('w', 0, ex([todo(20, 5)]));
  w = W.updateSet(w, 0, 0, { weight: 45, edited: true });
  assert.equal(w.exercises[0].sets[0].edited, true);
  w = W.updateSet(w, 0, 0, { completed: true });
  const saved = W.pruneIncompleteSets(w);
  assert.equal('edited' in saved.exercises[0].sets[0], false);
});

test('finish: typed-but-unticked sets are distinguished from untouched pre-filled rows', () => {
  // routine seeded 3 bench rows from history; the lifter typed a new load into
  // all three but only ticked the other exercise
  let w = workout('w', 1, [
    { exerciseId: 'bench-press', sets: [todo(20, 5), todo(20, 5), todo(20, 5)] },
    { exerciseId: 'db-row', sets: [done(10, 8), todo(10, 8)] },
  ]);
  for (let i = 0; i < 3; i++) w = W.updateSet(w, 0, i, { weight: 45, edited: true });
  const u = W.uncheckedSetsSummary?.(w);
  assert.ok(u, 'uncheckedSetsSummary() must exist');
  assert.equal(u.edited.length, 3);
  assert.equal(u.seededOnly, 1);
  // legacy prune silently drops the typed bench work:
  assert.equal(W.pruneIncompleteSets(w).exercises.some((e) => e.exerciseId === 'bench-press'), false);
  // the fix offers to keep them:
  const kept = W.pruneIncompleteSets(W.completeEditedSets(w));
  const b = kept.exercises.find((e) => e.exerciseId === 'bench-press');
  assert.deepEqual(b.sets.map((s) => s.weight), [45, 45, 45]);
  assert.equal(kept.exercises.find((e) => e.exerciseId === 'db-row').sets.length, 1);
});

test('lastSessionSummary reports the top set (not the first/warm-up set) and age', () => {
  const h = [workout('h', 0, ex([done(10, 10, { type: 'warmup' }), done(40, 5), done(35, 6)]))];
  const s = W.lastSessionSummary?.(h, 'bench-press', T0 + 2 * DAY + 3600000);
  assert.ok(s, 'lastSessionSummary() must exist');
  assert.equal(s.workoutId, 'h');
  assert.deepEqual(s.topSet, { weight: 40, reps: 5 });
  assert.equal(s.sets, 3);
  assert.equal(s.daysAgo, 2);
  assert.equal(W.lastSessionSummary([], 'bench-press', T0), null);
});

test('relatedHistoryIds finds the same lift logged under a sibling catalog id', () => {
  const names = { 'bench-press': 'Bench press (dumbbell)', 'hevy-bb': 'Bench Press (Barbell)', 'db-row': 'One-arm DB row' };
  const h = [workout('h', 0, ex([done(40, 5)], 'hevy-bb'))];
  const rel = W.relatedHistoryIds?.(h, 'bench-press', (id) => names[id] || null);
  assert.deepEqual(rel, ['hevy-bb']);
  assert.deepEqual(W.relatedHistoryIds(h, 'db-row', (id) => names[id] || null), []);
});

test('a re-saved copy of the candidate in prior history does not suppress its PRs', () => {
  const cand = workout('same', 9, ex([done(30, 5)]));
  assert.ok(W.newPRsInWorkout(cand, [cand]).length > 0);
});

test('hasLoggedWork: ticked or typed work counts, untouched pre-fill does not', () => {
  const seeded = workout('s', 0, ex([todo(20, 5), todo(20, 5)]));
  assert.equal(W.hasLoggedWork(seeded), false);
  assert.equal(W.hasLoggedWork(W.updateSet(seeded, 0, 1, { reps: 6, edited: true })), true);
  assert.equal(W.hasLoggedWork(W.updateSet(seeded, 0, 0, { completed: true })), true);
});
