// Data-integrity regressions for js/storage.js. Each test reproduces a loss
// path found in the investigation (see REPORT.md) before asserting the fix.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../js/storage.js';
import { installStorage, KEYS } from './helpers/memory-storage.js';
import { workout, done } from './helpers/fixtures.js';

let mem;
beforeEach(() => {
  mem = installStorage();
  storage._resetStorageStateForTests?.();
});

const bench = (id, day, w = 20) => workout(id, day, [{ exerciseId: 'bench-press', sets: [done(w, 5)] }]);
const stored = (key) => JSON.parse(mem.getItem(key) || 'null');

test('quota exceeded on a history write is reported, not swallowed', () => {
  const seen = [];
  storage.onStorageError?.((e) => seen.push(e));
  mem.quotaBytes = 64;
  assert.equal(storage.saveWorkout(bench('w1', 0)), false);
  const health = storage.storageHealth?.();
  assert.ok(health, 'storageHealth() must exist');
  assert.equal(health.ok, false);
  assert.equal(health.errors[0].kind, 'quota');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'quota');
});

test('a write that silently does not persist is detected by read-back verification', () => {
  mem.dropWrites = true;
  assert.equal(storage.saveWorkout(bench('w1', 0)), false);
  assert.equal(storage.storageHealth?.().errors[0].kind, 'verify');
});

test('storage health recovers once the same key writes successfully again', () => {
  mem.quotaBytes = 64;
  storage.saveWorkout(bench('w1', 0));
  mem.quotaBytes = Infinity;
  assert.equal(storage.saveWorkout(bench('w1', 0)), true);
  assert.equal(storage.storageHealth?.().ok, true);
});

test('finish under quota keeps the active workout (legacy flow cleared it → total loss)', () => {
  const live = bench('w-live', 1);
  assert.equal(storage.saveActiveWorkout(live), true);
  // only the history key is too big to grow: allow what is stored now, nothing more
  mem.quotaBytes = mem.bytesWith('x', '') + 10;
  const res = storage.commitFinishedWorkout?.(live);
  assert.ok(res, 'commitFinishedWorkout() must exist');
  assert.equal(res.ok, false);
  assert.equal(stored(KEYS.active)?.id, 'w-live', 'in-progress copy must survive a failed save');
  assert.equal(storage.loadWorkouts().length, 0);
});

test('finish happy path: saved, verified, queued, active cleared', () => {
  const live = bench('w-live', 1);
  storage.saveActiveWorkout(live);
  const res = storage.commitFinishedWorkout?.(live);
  assert.equal(res?.ok, true);
  assert.deepEqual(storage.loadWorkouts().map((w) => w.id), ['w-live']);
  assert.equal(mem.getItem(KEYS.active), null);
  assert.deepEqual(storage.loadOutbox().map((e) => e.id), ['w-live']);
});

test('saving the same workout id twice upserts instead of duplicating', () => {
  storage.saveWorkout(bench('w1', 0, 10));
  storage.saveWorkout(bench('w1', 0, 30));
  const all = storage.loadWorkouts();
  assert.equal(all.length, 1);
  assert.equal(all[0].exercises[0].sets[0].weight, 30);
});

test('boot does not resume an active workout that is already in history', () => {
  const w = bench('w-done', 0);
  storage.saveWorkout(w);
  storage.saveActiveWorkout(w); // crash between history write and active clear
  const resumed = storage.resolveActiveOnBoot?.();
  assert.ok(resumed, 'resolveActiveOnBoot() must exist');
  assert.equal(resumed.workout, null);
  assert.equal(resumed.reason, 'already-saved');
  assert.equal(mem.getItem(KEYS.active), null);
});

test('boot resumes a genuinely unfinished workout', () => {
  storage.saveActiveWorkout(bench('w-open', 0));
  assert.equal(storage.resolveActiveOnBoot?.().workout?.id, 'w-open');
});

test('active-workout persistence retries after a failed write of identical content', () => {
  const w = bench('w-open', 0);
  mem.quotaBytes = 8;
  assert.equal(storage.persistActiveWorkout?.(w), false);
  mem.quotaBytes = Infinity;
  assert.equal(storage.persistActiveWorkout(w), true, 'must not be deduped against a write that never landed');
  assert.equal(stored(KEYS.active)?.id, 'w-open');
});

test('migration guard is not set when the migrated workouts failed to save', () => {
  mem.setItem(KEYS.historyV1, JSON.stringify([{ id: 's1', exercise: 'squat', startedAtMs: 1, counts: { full: 5 } }]));
  mem.failKeys.add(KEYS.workouts); // migrated history too big; tiny guard still fits
  storage.ensureMigrated(() => 1);
  mem.failKeys.clear();
  assert.equal(mem.getItem(KEYS.migration), null, 'guard must stay unset so the next boot retries');
  const again = storage.ensureMigrated(() => 2);
  assert.equal(again.added, 1);
  assert.equal(storage.loadWorkouts().length, 1);
});

test('outbox: queued → handed off stays visible as unconfirmed until marked received', () => {
  storage.saveWorkout(bench('a', 0));
  storage.saveWorkout(bench('b', 1));
  storage.queueForDelivery(storage.loadWorkouts()[1]);
  storage.queueForDelivery(storage.loadWorkouts()[0]);
  assert.ok(storage.outboxStatus, 'outboxStatus() must exist');
  assert.equal(storage.outboxStatus().unsent.length, 2);
  storage.markHandedOff(['a'], 'share', () => 1000);
  const s = storage.outboxStatus();
  assert.deepEqual(s.unsent.map((e) => e.id), ['b']);
  assert.deepEqual(s.unconfirmed.map((e) => e.id), ['a']);
  assert.equal(s.unconfirmed[0].via, 'share');
  assert.equal(storage.pendingWorkouts().length, 2, 'unconfirmed workouts are re-sent until confirmed');
  storage.markDelivered(['a']);
  assert.equal(storage.outboxStatus().unconfirmed.length, 0);
});

test('outbox: ids whose workout no longer exists are reported as orphaned, not as pending', () => {
  storage.queueForDelivery({ id: 'ghost', endedAtMs: 1 });
  const s = storage.outboxStatus?.();
  assert.ok(s);
  assert.equal(s.unsent.length, 0);
  assert.equal(s.orphaned, 1);
});

test('re-queuing an already handed-off workout keeps its delivery state', () => {
  storage.saveWorkout(bench('a', 0));
  storage.queueForDelivery(storage.loadWorkouts()[0]);
  storage.markHandedOff?.(['a'], 'download', () => 5);
  storage.queueForDelivery(storage.loadWorkouts()[0]);
  assert.equal(storage.outboxStatus?.().unconfirmed.length, 1);
});

test('an unreadable history blob is stashed before the next save rewrites the key', () => {
  mem.setItem(KEYS.workouts, '{not json');
  assert.equal(storage.saveWorkout(bench('w1', 0)), true);
  assert.equal(mem.getItem('janai.formcoach.workouts.v2.corrupt'), '{not json');
  assert.equal(storage.loadWorkouts().length, 1);
});

test('history is not silently truncated to make room', () => {
  storage.saveWorkouts(Array.from({ length: 320 }, (_, i) => bench(`w${i}`, i)));
  assert.equal(storage.loadWorkouts().length, 320);
});
