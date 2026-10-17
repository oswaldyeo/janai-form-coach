// Client-side auto-sync engine: payload sanitising, outbox retry/backoff,
// drain batching, pull pagination, pull-merge rules, and the status pill.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeForSync, workoutVersion, mergeRemote, backoffMs, dueEntries, nextRetryAt,
  applySyncResults, drainOutbox, pullAll, syncStatus, normalizeSyncUrl, makeSyncClient, NEVER_SYNC_KEYS,
} from '../js/engine/sync.js';

const wk = (id, extra = {}) => ({
  id, title: 'W', startedAtMs: 100, endedAtMs: 200,
  exercises: [{ exerciseId: 'squat', sets: [{ weight: 60, reps: 5, completed: true, camera: { reps: [{ tMs: 1 }], calibration: {} } }] }],
  ...extra,
});

test('sanitizeForSync strips every camera/pose key, keeps the log, never mutates', () => {
  const src = wk('a', { legacyV1: { frames: [1] }, landmarks: [[0, 1]] });
  const out = sanitizeForSync(src);
  const text = JSON.stringify(out);
  for (const k of NEVER_SYNC_KEYS) assert.ok(!text.includes(`"${k}"`), `${k} leaked`);
  assert.equal(out.exercises[0].sets[0].weight, 60);
  assert.equal(out.exercises[0].sets[0].reps, 5);
  assert.equal(out.updatedAtMs, 200);
  assert.ok(src.exercises[0].sets[0].camera, 'input untouched');
  assert.ok(src.legacyV1);
});

test('workoutVersion prefers updatedAtMs, then endedAtMs, then startedAtMs', () => {
  assert.equal(workoutVersion({ updatedAtMs: 9, endedAtMs: 5, startedAtMs: 1 }), 9);
  assert.equal(workoutVersion({ endedAtMs: 5, startedAtMs: 1 }), 5);
  assert.equal(workoutVersion({ startedAtMs: 1 }), 1);
  assert.equal(workoutVersion({}), 0);
  assert.equal(workoutVersion(null), 0);
});

test('mergeRemote adds unknown ids and re-hydrates an empty store newest-first', () => {
  const r = mergeRemote([], [wk('old', { startedAtMs: 1 }), wk('new', { startedAtMs: 5 }), { id: 'junk' }, null]);
  assert.deepEqual(r.workouts.map((w) => w.id), ['new', 'old']);
  assert.equal(r.added, 2);
  assert.equal(r.updated, 0);
});

test('mergeRemote: newer remote wins, older/equal remote ignored, input returned when unchanged', () => {
  const local = [wk('a', { title: 'Local', updatedAtMs: 500 })];
  const older = mergeRemote(local, [wk('a', { title: 'Old', updatedAtMs: 400 })]);
  assert.equal(older.workouts, local);
  assert.equal(older.updated, 0);
  const equal = mergeRemote(local, [wk('a', { title: 'Same', updatedAtMs: 500 })]);
  assert.equal(equal.workouts[0].title, 'Local');
  const newer = mergeRemote(local, [wk('a', { title: 'Remote', updatedAtMs: 600 })]);
  assert.equal(newer.workouts[0].title, 'Remote');
  assert.equal(newer.updated, 1);
});

test('mergeRemote: a pending local edit always beats the server copy', () => {
  const local = [wk('a', { title: 'Unpushed edit', updatedAtMs: 100 })];
  const r = mergeRemote(local, [wk('a', { title: 'Server', updatedAtMs: 999 })], { pendingIds: new Set(['a']) });
  assert.equal(r.workouts[0].title, 'Unpushed edit');
});

test('mergeRemote keeps local-only camera + legacy blobs when a newer remote replaces them', () => {
  const local = [wk('a', { legacyV1: { v: 1 } })];
  const remote = sanitizeForSync(wk('a', { title: 'Edited', updatedAtMs: 999 }));
  const r = mergeRemote(local, [remote]);
  assert.equal(r.workouts[0].title, 'Edited');
  assert.ok(r.workouts[0].exercises[0].sets[0].camera);
  assert.deepEqual(r.workouts[0].legacyV1, { v: 1 });
  // exercise order changed → no positional carry-over
  const swapped = { ...remote, exercises: [{ exerciseId: 'bench', sets: [{ weight: 1, reps: 1 }] }] };
  const r2 = mergeRemote(local, [swapped]);
  assert.equal(r2.workouts[0].exercises[0].sets[0].camera, undefined);
});

test('mergeRemote: duplicates in one pull resolve to the highest version', () => {
  const r = mergeRemote([], [wk('a', { title: 'v1', updatedAtMs: 1 }), wk('a', { title: 'v2', updatedAtMs: 2 })]);
  assert.equal(r.workouts.length, 1);
  assert.equal(r.workouts[0].title, 'v2');
  assert.equal(r.added, 1);
  assert.equal(r.updated, 0);
});

test('backoffMs doubles from 5 s, caps at 30 min, jitter stays in [50%, 100%]', () => {
  const max = { rand: () => 1 };
  assert.equal(backoffMs(1, max), 5000);
  assert.equal(backoffMs(2, max), 10000);
  assert.equal(backoffMs(5, max), 80000);
  assert.equal(backoffMs(50, max), 30 * 60 * 1000);
  assert.equal(backoffMs(3, { rand: () => 0 }), 10000);
  assert.equal(backoffMs(0, max), 5000);
});

test('dueEntries / nextRetryAt honour nextAttemptAt (legacy entries are due now)', () => {
  const ob = [{ id: 'a', queuedAt: 1 }, { id: 'b', queuedAt: 2, nextAttemptAt: 5000 }, { id: 'c', nextAttemptAt: 3000 }];
  assert.deepEqual(dueEntries(ob, 1000).map((e) => e.id), ['a']);
  assert.deepEqual(dueEntries(ob, 5000).map((e) => e.id), ['a', 'b', 'c']);
  assert.equal(nextRetryAt(ob), 3000);
  assert.equal(nextRetryAt([{ id: 'a' }]), null);
});

test('applySyncResults: sent removed, failed backed off, re-queued edit survives a late ack', () => {
  const current = [
    { id: 'a', queuedAt: 99 },      // re-queued (edited) while the POST of queuedAt 10 was in flight
    { id: 'b', queuedAt: 20 },
    { id: 'c', queuedAt: 30, attempts: 2 },
  ];
  const out = applySyncResults(current, {
    sent: [{ id: 'a', queuedAt: 10 }, { id: 'b', queuedAt: 20 }],
    failed: [{ id: 'c', queuedAt: 30, error: 'HTTP 500' }],
  }, 1000, { rand: () => 1 });
  assert.deepEqual(out.map((e) => e.id), ['a', 'c']);
  assert.equal(out[0].queuedAt, 99);
  assert.equal(out[1].attempts, 3);
  assert.equal(out[1].nextAttemptAt, 1000 + 20000);
  assert.equal(out[1].lastError, 'HTTP 500');
});

test('drainOutbox posts due entries in batches, sanitised + prepared; drops missing/rejected', async () => {
  const posted = [];
  const post = async (ws) => { posted.push(ws); return { accepted: ws.map((w) => w.id), rejected: ws.some((w) => w.id === 'bad') ? [{ id: 'bad' }] : [] }; };
  const workouts = ['a', 'b', 'c', 'bad'].map((id) => wk(id));
  const outbox = [
    { id: 'a', queuedAt: 1 }, { id: 'b', queuedAt: 2 }, { id: 'c', queuedAt: 3 }, { id: 'bad', queuedAt: 4 },
    { id: 'gone', queuedAt: 5 }, { id: 'later', queuedAt: 6, nextAttemptAt: 9e12 },
  ];
  const r = await drainOutbox({ outbox, workouts, post, nowMs: 1000, batchSize: 2, prepare: (w) => ({ ...w, enriched: true }) });
  assert.equal(posted.length, 2);
  assert.deepEqual(posted.flat().map((w) => w.id), ['a', 'b', 'c', 'bad']);
  assert.ok(posted.flat().every((w) => w.enriched && !JSON.stringify(w).includes('"camera"')));
  assert.deepEqual(r.sent.map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(r.dropped.map((s) => s.id).sort(), ['bad', 'gone']);
  assert.deepEqual(r.failed, []);
  assert.equal(r.error, null);
});

test('drainOutbox: a network failure marks that batch and all later ones failed, never throws', async () => {
  let n = 0;
  const post = async (ws) => { n += 1; if (n === 2) throw new Error('Failed to fetch'); return { accepted: ws.map((w) => w.id) }; };
  const workouts = ['a', 'b', 'c'].map((id) => wk(id));
  const outbox = workouts.map((w, i) => ({ id: w.id, queuedAt: i }));
  const r = await drainOutbox({ outbox, workouts, post, nowMs: 0, batchSize: 1 });
  assert.deepEqual(r.sent.map((s) => s.id), ['a']);
  assert.deepEqual(r.failed.map((s) => s.id), ['b', 'c']);
  assert.equal(r.failed[0].error, 'Failed to fetch');
  assert.equal(r.error.message, 'Failed to fetch');
  // offline → nothing sent, everything retried later
  const off = await drainOutbox({ outbox, workouts, post: async () => { throw new TypeError('Load failed'); }, nowMs: 0 });
  assert.equal(off.failed.length, 3);
  const next = applySyncResults(outbox, off, 0, { rand: () => 1 });
  assert.ok(next.every((e) => e.attempts === 1 && e.nextAttemptAt === 5000));
});

test('pullAll follows cursor pages and stops on no-more or a stuck cursor', async () => {
  const pages = { 0: { workouts: [wk('a')], cursor: 3, more: true }, 3: { workouts: [wk('b')], cursor: 7, more: false } };
  const seen = [];
  const r = await pullAll({ get: async (since) => { seen.push(since); return pages[since]; } });
  assert.deepEqual(seen, [0, 3]);
  assert.deepEqual(r.workouts.map((w) => w.id), ['a', 'b']);
  assert.equal(r.cursor, 7);
  let calls = 0;
  const stuck = await pullAll({ get: async () => { calls += 1; return { workouts: [], cursor: 0, more: true }; }, since: 0 });
  assert.equal(calls, 1);
  assert.equal(stuck.cursor, 0);
});

test('syncStatus labels: not paired / offline / syncing / pending N / synced / re-pair', () => {
  assert.deepEqual(syncStatus({ paired: false, pending: 3 }), { state: 'unpaired', label: 'Not paired' });
  assert.equal(syncStatus({ paired: true, online: false, pending: 2 }).label, 'Offline · 2 pending');
  assert.equal(syncStatus({ paired: true, online: false }).label, 'Offline');
  assert.equal(syncStatus({ paired: true, busy: true, pending: 1 }).state, 'syncing');
  assert.equal(syncStatus({ paired: true, pending: 4 }).label, 'Pending 4');
  assert.deepEqual(syncStatus({ paired: true }), { state: 'synced', label: 'Synced ✓' });
  assert.equal(syncStatus({ paired: true, authFailed: true, pending: 1 }).state, 'error');
});

test('normalizeSyncUrl: https only (http for localhost), adds scheme, trims slashes', () => {
  assert.equal(normalizeSyncUrl(' janai-sync.example.workers.dev/ '), 'https://janai-sync.example.workers.dev');
  assert.equal(normalizeSyncUrl('https://x.dev/api//'), 'https://x.dev/api');
  assert.equal(normalizeSyncUrl('http://localhost:8787'), 'http://localhost:8787');
  assert.equal(normalizeSyncUrl('http://x.dev'), null);
  assert.equal(normalizeSyncUrl(''), null);
  assert.equal(normalizeSyncUrl('not a url at all'), null);
});

test('makeSyncClient sends bearer + JSON, keepalive for small bodies, surfaces HTTP errors', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/boom/')) return new Response('{"error":"nope"}', { status: 401 });
    return new Response(JSON.stringify({ accepted: ['a'], workouts: [], cursor: 0, more: false }), { status: 200 });
  };
  const c = makeSyncClient({ url: 'https://s.dev/', token: 'tok', fetchImpl });
  await c.postWorkouts([{ id: 'a', exercises: [] }]);
  assert.equal(calls[0].url, 'https://s.dev/workouts');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.keepalive, true);
  await c.getWorkouts(42, 10);
  assert.equal(calls[1].url, 'https://s.dev/workouts?since=42&limit=10');
  assert.equal(calls[1].init.body, undefined);
  const anon = makeSyncClient({ url: 'https://s.dev', fetchImpl });
  await anon.signup('code');
  assert.equal(calls[2].init.headers.Authorization, undefined);
  const bad = makeSyncClient({ url: 'https://s.dev/boom', token: 't', fetchImpl });
  await assert.rejects(bad.getWorkouts(), (e) => e.status === 401 && e.message === 'nope');
  await assert.rejects(makeSyncClient({ url: 'http://insecure.dev', fetchImpl }).getWorkouts(), /https/);
});
