// Live-workout UX: add-exercise mid-workout, routine-update prompt on finish,
// and recents-first exercise picker. All pure engine logic — no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeWorkout, addExercise, updateSet, pruneIncompleteSets,
  placeholderSetsFromHistory, recentExerciseIds,
} from '../js/engine/workout.js';
import {
  OCCAM_ROUTINE, makeRoutine, routineToWorkout, repeatWorkout,
  routineAdditions, addExercisesToRoutine, routineUpdatePrompt,
} from '../js/engine/routines.js';
import { searchCatalog, recentsFirst, CATALOG_LIST } from '../js/engine/catalog.js';

const done = (partial) => ({ completed: true, type: 'normal', ...partial });
const logged = (id, startedAtMs, exercises) => ({
  id, title: 'W', startedAtMs, endedAtMs: startedAtMs + 1000,
  exercises: exercises.map(([exerciseId, sets]) => ({ exerciseId, sets })),
});

// ── (1) add an exercise mid-workout ──────────────────────────────────────────
test('placeholderSetsFromHistory: one EMPTY row per last-session set, type/side kept', () => {
  const history = [logged('w2', 2000, [['bench-press', [
    done({ weight: 30, reps: 8, type: 'warmup' }), done({ weight: 40, reps: 6, side: 'L' }),
  ]]])];
  const rows = placeholderSetsFromHistory(history, 'bench-press');
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.weight, null);
    assert.equal(r.reps, 0);
    assert.equal(r.completed, false);
  }
  assert.equal(rows[0].type, 'warmup');
  assert.equal(rows[1].side, 'L');
});

test('placeholderSetsFromHistory: never-logged exercise gets a single blank row', () => {
  const rows = placeholderSetsFromHistory([], 'lat-pulldown');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].weight, null);
  assert.equal(rows[0].completed, false);
});

test('mid-workout add appends to the live workout and survives a persist/resume round-trip', () => {
  let w = routineToWorkout(OCCAM_ROUTINE, 'A', { id: 'w', startedAtMs: 0 });
  w = addExercise(w, 'lat-pulldown', placeholderSetsFromHistory([], 'lat-pulldown'));
  assert.deepEqual(w.exercises.map((e) => e.exerciseId), ['shoulder-press', 'db-row', 'lat-pulldown']);
  // crash-safe persistence stores JSON and boot rebuilds via makeWorkout
  const resumed = makeWorkout(JSON.parse(JSON.stringify(w)));
  assert.deepEqual(resumed.exercises.map((e) => e.exerciseId), ['shoulder-press', 'db-row', 'lat-pulldown']);
  assert.equal(resumed.routineId, 'occam-ab');
  assert.equal(resumed.routineDayKey, 'A');
});

// ── (2) routine-update prompt on finish ──────────────────────────────────────
function occamAWithExtra(extraId, { complete = true } = {}) {
  let w = routineToWorkout(OCCAM_ROUTINE, 'A', { id: 'w', startedAtMs: 0 });
  w = updateSet(w, 0, 0, { weight: 10, reps: 7, completed: true });
  if (extraId) {
    w = addExercise(w, extraId, [{ weight: 40, reps: 10 }, { weight: 45, reps: 8 }]);
    if (complete) {
      w = updateSet(w, 2, 0, { completed: true });
      w = updateSet(w, 2, 1, { completed: true });
    }
  }
  return pruneIncompleteSets(w);
}

test('routineAdditions: lists performed exercises the routine day lacks', () => {
  assert.deepEqual(routineAdditions(occamAWithExtra('lat-pulldown'), OCCAM_ROUTINE), ['lat-pulldown']);
});

test('routineAdditions: nothing new added → no prompt', () => {
  assert.deepEqual(routineAdditions(occamAWithExtra(null), OCCAM_ROUTINE), []);
});

test('routineAdditions: an added exercise with no completed sets is not offered', () => {
  assert.deepEqual(routineAdditions(occamAWithExtra('lat-pulldown', { complete: false }), OCCAM_ROUTINE), []);
});

test('routineAdditions: workouts not started from a routine never prompt', () => {
  let empty = makeWorkout({ id: 'e', startedAtMs: 0 });
  empty = addExercise(empty, 'lat-pulldown', [{ weight: 40, reps: 10, completed: true }]);
  assert.deepEqual(routineAdditions(empty, OCCAM_ROUTINE), []);
  assert.deepEqual(routineAdditions(empty, null), []);
  // repeat-last carries routineId for history, but it was started from a past
  // workout, not the routine — no day key, so no prompt
  const repeated = repeatWorkout(occamAWithExtra('lat-pulldown'), { id: 'r', startedAtMs: 0 });
  assert.equal(repeated.routineDayKey, null);
  assert.deepEqual(routineAdditions(repeated, OCCAM_ROUTINE), []);
  // a different routine's workout
  assert.deepEqual(routineAdditions(occamAWithExtra('lat-pulldown'), makeRoutine({ id: 'other', exercises: [] })), []);
});

test('routineAdditions: compares against the started day, deduped, in workout order', () => {
  let w = routineToWorkout(OCCAM_ROUTINE, 'A', { id: 'w', startedAtMs: 0 });
  w = addExercise(w, 'bench-press', [{ weight: 20, reps: 7, completed: true }]); // on Day B, not A
  w = addExercise(w, 'plank', [{ durationSec: 30, completed: true }]);
  w = addExercise(w, 'bench-press', [{ weight: 22, reps: 6, completed: true }]);
  assert.deepEqual(routineAdditions(pruneIncompleteSets(w), OCCAM_ROUTINE), ['bench-press', 'plank']);
});

test('addExercisesToRoutine: appends to that day from the completed sets, input untouched', () => {
  const routine = makeRoutine({ id: 'r-1', name: 'Mine', days: [
    { key: 'A', name: 'Push', exercises: [{ exerciseId: 'shoulder-press', targetSets: 1, targetReps: 7 }] },
    { key: 'B', name: 'Legs', exercises: [{ exerciseId: 'goblet-squat', targetSets: 1, targetReps: 10 }] },
  ] });
  let w = routineToWorkout(routine, 'A', { id: 'w', startedAtMs: 0 });
  w = updateSet(w, 0, 0, { weight: 10, reps: 7, completed: true });
  w = addExercise(w, 'lat-pulldown', [{ weight: 40, reps: 10, completed: true }, { weight: 45, reps: 8, completed: true }]);
  const finished = pruneIncompleteSets(w);
  const updated = addExercisesToRoutine(routine, 'A', finished, routineAdditions(finished, routine));
  assert.equal(updated.id, 'r-1');
  assert.deepEqual(updated.days[0].exercises.map((e) => e.exerciseId), ['shoulder-press', 'lat-pulldown']);
  assert.deepEqual(updated.days[1].exercises.map((e) => e.exerciseId), ['goblet-squat']);
  const added = updated.days[0].exercises[1];
  assert.equal(added.targetSets, 2);
  assert.deepEqual(added.sets.map((s) => [s.weight, s.reps]), [[40, 10], [45, 8]]);
  assert.equal(routine.days[0].exercises.length, 1);
  // the next start from the updated routine includes the new exercise, and
  // finishing that same workout again offers nothing
  const next = routineToWorkout(updated, 'A', { id: 'n', startedAtMs: 1 });
  assert.deepEqual(next.exercises.map((e) => e.exerciseId), ['shoulder-press', 'lat-pulldown']);
  assert.deepEqual(routineAdditions(finished, updated), []);
});

test('routineUpdatePrompt names every addition in one question', () => {
  assert.equal(routineUpdatePrompt(['Lat pulldown']), 'Add Lat pulldown to this routine?');
  assert.equal(routineUpdatePrompt(['Lat pulldown', 'Plank']), 'Add Lat pulldown and Plank to this routine?');
  assert.equal(routineUpdatePrompt(['A', 'B', 'C']), 'Add A, B and C to this routine?');
});

// ── (3) recents first in the exercise picker ─────────────────────────────────
const HISTORY = [
  // deliberately out of date order — recency comes from the timestamps
  logged('old', 1000, [['squat', [done({ reps: 10 })]], ['plank', [done({ durationSec: 30 })]]]),
  logged('new', 3000, [['bench-press', [done({ weight: 20, reps: 8 })]], ['squat', [done({ reps: 12 })]]]),
  logged('mid', 2000, [['lat-pulldown', [done({ weight: 40, reps: 10 })]]]),
];

test('recentExerciseIds: distinct, most recent workout first', () => {
  assert.deepEqual(recentExerciseIds(HISTORY), ['bench-press', 'squat', 'lat-pulldown', 'plank']);
  assert.deepEqual(recentExerciseIds(HISTORY, { limit: 2 }), ['bench-press', 'squat']);
  assert.deepEqual(recentExerciseIds([]), []);
});

test('recentExerciseIds: ignores exercises with no completed set', () => {
  const h = [logged('w', 5000, [['calf-raise', [{ reps: 10, completed: false }]]]), ...HISTORY];
  assert.equal(recentExerciseIds(h).includes('calf-raise'), false);
});

test('recentsFirst: recents on top, then the rest in the existing catalog order', () => {
  const all = searchCatalog({});
  const { recent, rest } = recentsFirst(all, recentExerciseIds(HISTORY));
  assert.deepEqual(recent.map((e) => e.id), ['bench-press', 'squat', 'lat-pulldown', 'plank']);
  assert.equal(recent.length + rest.length, CATALOG_LIST.length);
  const recentSet = new Set(recent.map((e) => e.id));
  assert.deepEqual(rest.map((e) => e.id), all.filter((e) => !recentSet.has(e.id)).map((e) => e.id));
});

test('recentsFirst: search still spans the whole catalog; recents only reorder matches', () => {
  const results = searchCatalog({ query: 'squat' });
  assert.ok(results.some((e) => e.id === 'goblet-squat'));
  const { recent, rest } = recentsFirst(results, recentExerciseIds(HISTORY));
  assert.deepEqual(recent.map((e) => e.id), ['squat']);
  assert.ok(rest.some((e) => e.id === 'goblet-squat'));
  assert.equal(recent.length + rest.length, results.length);
  // a recent exercise that doesn't match the search is not shown
  assert.equal([...recent, ...rest].some((e) => e.id === 'bench-press'), false);
});

test('recentsFirst: no history → original order untouched', () => {
  const all = searchCatalog({});
  const { recent, rest } = recentsFirst(all, []);
  assert.deepEqual(recent, []);
  assert.deepEqual(rest, all);
});
