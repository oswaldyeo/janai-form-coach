// storage.js sync hooks against an in-memory localStorage: edits re-queue,
// the outbox dedupes by id, bulk queueing on pairing, and the sync config.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};
const S = await import('../js/storage.js');
beforeEach(() => mem.clear());

const wk = (id, extra = {}) => ({ id, title: 'W', startedAtMs: 1, endedAtMs: 2, exercises: [], ...extra });

test('queueForDelivery dedupes by id and moves the newest version to the front', () => {
  S.queueForDelivery(wk('a'), () => 10);
  S.queueForDelivery(wk('b'), () => 20);
  S.queueForDelivery(wk('a'), () => 30);
  assert.deepEqual(S.loadOutbox().map((e) => [e.id, e.queuedAt]), [['a', 30], ['b', 20]]);
});

test('updateWorkout replaces in place, stamps updatedAtMs, and re-queues for sync', () => {
  S.saveWorkouts([wk('b', { startedAtMs: 5 }), wk('a')]);
  S.markDelivered(['a', 'b']);
  const saved = S.updateWorkout({ ...wk('a'), title: 'Renamed' }, () => 777);
  assert.equal(saved.updatedAtMs, 777);
  assert.deepEqual(S.loadWorkouts().map((w) => [w.id, w.title]), [['b', 'W'], ['a', 'Renamed']]);
  assert.deepEqual(S.loadOutbox().map((e) => [e.id, e.queuedAt]), [['a', 777]]);
  assert.equal(S.pendingWorkouts()[0].title, 'Renamed');
  assert.equal(S.updateWorkout(null), null);
});

test('queueManyForDelivery queues every workout once, keeping unrelated entries', () => {
  S.queueForDelivery(wk('x'), () => 1);
  S.queueForDelivery(wk('a'), () => 1);
  S.queueManyForDelivery([wk('a'), wk('b'), { title: 'no id' }], () => 50);
  const ob = S.loadOutbox();
  assert.deepEqual(ob.map((e) => e.id), ['a', 'b', 'x']);
  assert.equal(ob[0].queuedAt, 50);
});

test('saveOutbox round-trips retry metadata', () => {
  S.saveOutbox([{ id: 'a', queuedAt: 1, attempts: 2, nextAttemptAt: 99, lastError: 'x' }]);
  assert.deepEqual(S.loadOutbox(), [{ id: 'a', queuedAt: 1, attempts: 2, nextAttemptAt: 99, lastError: 'x' }]);
});

test('sync config: needs url + token, patches merge, clear unpairs', () => {
  assert.equal(S.loadSyncConfig(), null);
  S.saveSyncConfig({ url: 'https://s.dev' });
  assert.equal(S.loadSyncConfig(), null, 'not paired without a token');
  S.saveSyncConfig({ token: 'jfc_d_x', cursor: 0 });
  S.saveSyncConfig({ cursor: 12 });
  assert.deepEqual(S.loadSyncConfig(), { url: 'https://s.dev', token: 'jfc_d_x', cursor: 12 });
  S.clearSyncConfig();
  assert.equal(S.loadSyncConfig(), null);
});
