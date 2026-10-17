// Supabase auto-sync end to end against an in-memory localStorage and a mocked
// fetch: first-sign-in backfill (local history + legacy delivery outbox),
// dedupe by workout id, outbox drain with offline retry/backoff, token refresh,
// pull-merge rehydration, and that camera/pose data never leaves the device.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};
const S = await import('../js/storage.js');
const { makeCloudClient, CLOUD } = await import('../js/engine/cloud.js');
const { runCloudSync } = await import('../js/engine/autosync.js');

const NOW = 1_900_000_000_000;
const now = () => NOW;
const rand = () => 1;
const SESSION = { access_token: 'jwt-1', refresh_token: 'rt-1', expires_at: NOW / 1000 + 3600, user: { id: 'u1', email: 'a@b.c' } };

const wk = (id, extra = {}) => ({
  id, title: `W ${id}`, startedAtMs: 1000, endedAtMs: 2000,
  exercises: [{ exerciseId: 'squat', sets: [{ weight: 60, reps: 5, completed: true, camera: { reps: [{ tMs: 1 }] } }] }],
  ...extra,
});

/** Fake Supabase: in-memory formcoach_workouts keyed by (user, id), PostgREST-ish semantics. */
function fakeSupabase({ offline = false } = {}) {
  const net = { offline, rows: new Map(), calls: [], jwtValid: new Set(['jwt-1']), refreshOk: true, failNextUpsert: 0 };
  net.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    net.calls.push({ path: u.pathname, search: u.search, method: init.method || 'GET', headers: init.headers, body, keepalive: init.keepalive });
    if (net.offline) throw new TypeError('Failed to fetch');
    const json = (status, obj) => new Response(obj === undefined ? '' : JSON.stringify(obj), { status });
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') {
      if (!net.refreshOk) return json(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      net.jwtValid.add('jwt-2');
      return json(200, { access_token: 'jwt-2', refresh_token: 'rt-2', expires_at: NOW / 1000 + 7200, user: { id: 'u1', email: 'a@b.c' } });
    }
    if (u.pathname === `/rest/v1/${CLOUD.table}`) {
      const jwt = String(init.headers.Authorization).replace('Bearer ', '');
      if (!net.jwtValid.has(jwt)) return json(401, { code: 'PGRST301', message: 'JWT expired' });
      if (init.method === 'POST') {
        if (net.failNextUpsert > 0) { net.failNextUpsert -= 1; return json(503, { message: 'upstream down' }); }
        const ids = body.map((r) => r.id);
        if (new Set(ids).size !== ids.length) return json(500, { code: '21000', message: 'ON CONFLICT DO UPDATE command cannot affect row a second time' });
        for (const r of body) net.rows.set(`u1:${r.id}`, r);
        return json(201);
      }
      const limit = Number(u.searchParams.get('limit')); const offset = Number(u.searchParams.get('offset') || 0);
      const all = [...net.rows.values()].sort((a, b) => (b.started_at_ms ?? 0) - (a.started_at_ms ?? 0) || a.id.localeCompare(b.id));
      return json(200, all.slice(offset, offset + limit).map((r) => ({ data: r.data })));
    }
    return json(404, { message: 'not found' });
  };
  net.client = makeCloudClient({ fetchImpl: net.fetch });
  net.upserts = () => net.calls.filter((c) => c.method === 'POST' && c.path.startsWith('/rest/'));
  return net;
}

const run = (net, opts = {}) => runCloudSync({ store: S, client: net.client, now, rand, ...opts });

beforeEach(() => { mem.clear(); S._resetStorageStateForTests?.(); });

test('signed out: nothing is sent, finished workouts stay queued in the outbox', async () => {
  const net = fakeSupabase();
  S.commitFinishedWorkout(wk('a'), now);
  const r = await run(net);
  assert.equal(r.status, 'signedout');
  assert.equal(net.calls.length, 0);
  assert.deepEqual(S.loadOutbox().map((e) => e.id), ['a']);
});

test('first sign-in backfills ALL local history plus the legacy delivery outbox, with zero taps', async () => {
  const net = fakeSupabase();
  // history recorded before sign-in: two never queued (pre-outbox / imported), one shared
  // via the old share sheet but never confirmed, one never sent
  S.saveWorkouts([wk('old1', { startedAtMs: 10 }), wk('old2', { startedAtMs: 20 }), wk('shared', { startedAtMs: 30 }), wk('unsent', { startedAtMs: 40 })]);
  S.queueForDelivery(wk('shared'), () => 5);
  S.markHandedOff(['shared'], 'share', () => 6);
  S.queueForDelivery(wk('unsent'), () => 7);
  S.queueForDelivery(wk('orphan'), () => 8); // legacy entry whose workout is gone locally
  S.saveCloudSession(SESSION);

  const r = await run(net, { pull: true });
  assert.equal(r.status, 'ok');
  assert.equal(r.backfilled, 4);
  assert.deepEqual([...net.rows.keys()].sort(), ['u1:old1', 'u1:old2', 'u1:shared', 'u1:unsent']);
  assert.equal(net.upserts().length, 1, 'one batched upsert');
  assert.deepEqual(S.loadOutbox(), [], 'outbox fully drained (orphan dropped)');
  assert.equal(r.dropped, 1);
  assert.ok(S.isCloudBackfilled('u1'));
  assert.equal(S.loadCloudSession().lastSyncMs, NOW);

  // signing out and back in does not re-upload the whole history
  S.clearCloudSession(); S.saveCloudSession(SESSION);
  const again = await run(net);
  assert.equal(again.backfilled, 0);
  assert.equal(net.upserts().length, 1);
});

test('upsert request: exact PostgREST call, owner JWT, camera/pose stripped, keepalive', async () => {
  const net = fakeSupabase();
  S.markCloudBackfilled('u1', now);
  S.saveCloudSession(SESSION);
  S.commitFinishedWorkout(wk('a', { legacyV1: { frames: [1] }, landmarks: [[1, 2]] }), now);
  await run(net);
  const [c] = net.upserts();
  assert.equal(c.path, `/rest/v1/${CLOUD.table}`);
  assert.equal(c.search, '?on_conflict=user_id,id');
  assert.equal(c.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
  assert.equal(c.headers.Authorization, 'Bearer jwt-1');
  assert.equal(c.headers.apikey, CLOUD.key);
  assert.equal(c.keepalive, true);
  assert.equal(c.body.length, 1);
  assert.deepEqual(Object.keys(c.body[0]).sort(), ['data', 'id', 'started_at_ms']);
  const text = JSON.stringify(c.body);
  for (const k of ['camera', 'legacyV1', 'landmarks']) assert.ok(!text.includes(`"${k}"`), `${k} leaked`);
  assert.equal(c.body[0].data.exercises[0].sets[0].weight, 60);
  assert.equal(c.body[0].data.exercises[0].exerciseName, undefined, 'no prepare ⇒ untouched');
  // local copy still has its camera data
  assert.ok(S.loadWorkouts()[0].exercises[0].sets[0].camera);
});

test('dedupe: duplicate outbox entries and repeated edits become ONE row per workout id', async () => {
  const net = fakeSupabase();
  S.markCloudBackfilled('u1', now);
  S.saveCloudSession(SESSION);
  S.saveWorkouts([wk('a'), wk('b')]);
  // legacy outbox with duplicate ids (older builds didn't dedupe)
  S.saveOutbox([{ id: 'a', queuedAt: 1 }, { id: 'b', queuedAt: 2 }, { id: 'a', queuedAt: 3 }]);
  S.updateWorkout({ ...wk('b'), title: 'edit 1' }, () => 10);
  S.updateWorkout({ ...wk('b'), title: 'edit 2' }, () => 11);
  const r = await run(net);
  assert.equal(r.status, 'ok');
  const [c] = net.upserts();
  assert.deepEqual(c.body.map((x) => x.id).sort(), ['a', 'b']);
  assert.equal(net.rows.get('u1:b').data.title, 'edit 2');
  assert.deepEqual(S.loadOutbox(), []);
  // re-running is idempotent: nothing pending ⇒ no request; re-queue ⇒ same row overwritten
  await run(net);
  assert.equal(net.upserts().length, 1);
  S.updateWorkout({ ...wk('b'), title: 'edit 3' }, () => 12);
  await run(net);
  assert.equal(net.rows.size, 2);
  assert.equal(net.rows.get('u1:b').data.title, 'edit 3');
});

test('outbox drain offline → backoff → drains when the network returns', async () => {
  const net = fakeSupabase({ offline: true });
  S.markCloudBackfilled('u1', now);
  S.saveCloudSession(SESSION);
  S.commitFinishedWorkout(wk('a'), now);
  S.commitFinishedWorkout(wk('b'), now);
  const r1 = await run(net);
  assert.equal(r1.status, 'error');
  assert.equal(r1.failed, 2);
  const ob = S.loadOutbox();
  assert.ok(ob.every((e) => e.attempts === 1 && e.nextAttemptAt === NOW + 5000 && e.lastError === 'Failed to fetch'));
  // not due yet: no request
  net.offline = false;
  net.calls.length = 0;
  await run(net);
  assert.equal(net.upserts().length, 0);
  // due: drains
  const r3 = await runCloudSync({ store: S, client: net.client, now: () => NOW + 6000, rand });
  assert.equal(r3.sent, 2);
  assert.deepEqual(S.loadOutbox(), []);
  assert.equal(net.rows.size, 2);
});

test('server error keeps the outbox and backs off exponentially', async () => {
  const net = fakeSupabase();
  S.markCloudBackfilled('u1', now);
  S.saveCloudSession(SESSION);
  S.commitFinishedWorkout(wk('a'), now);
  net.failNextUpsert = 2;
  await run(net);
  await runCloudSync({ store: S, client: net.client, now: () => NOW + 5000, rand });
  const [e] = S.loadOutbox();
  assert.equal(e.attempts, 2);
  assert.equal(e.nextAttemptAt, NOW + 5000 + 10000);
  assert.equal(e.lastError, 'upstream down');
  await runCloudSync({ store: S, client: net.client, now: () => NOW + 20000, rand });
  assert.deepEqual(S.loadOutbox(), []);
});

test('expiring session is refreshed before sync; a 401 mid-drain refreshes once and retries', async () => {
  const net = fakeSupabase();
  S.markCloudBackfilled('u1', now);
  S.saveCloudSession({ ...SESSION, expires_at: NOW / 1000 + 10 });
  S.commitFinishedWorkout(wk('a'), now);
  await run(net);
  assert.equal(S.loadCloudSession().access_token, 'jwt-2');
  assert.equal(net.rows.size, 1);

  const net2 = fakeSupabase();
  S.saveCloudSession(SESSION);
  net2.jwtValid.delete('jwt-1'); // revoked early
  S.commitFinishedWorkout(wk('b'), now);
  const r = await run(net2);
  assert.equal(r.status, 'ok');
  assert.equal(net2.upserts().length, 2);
  assert.equal(net2.rows.size, 1);
});

test('dead refresh token signs out quietly and keeps every queued workout', async () => {
  const net = fakeSupabase();
  net.refreshOk = false;
  S.markCloudBackfilled('u1', now);
  S.saveCloudSession({ ...SESSION, expires_at: 1 });
  S.commitFinishedWorkout(wk('a'), now);
  const r = await run(net);
  assert.equal(r.status, 'expired');
  assert.equal(S.loadCloudSession(), null);
  assert.deepEqual(S.loadOutbox().map((e) => e.id), ['a']);
});

test('boot pull-merge rehydrates a wiped device (paged) and never clobbers a pending local edit', async () => {
  const net = fakeSupabase();
  for (let i = 0; i < 205; i += 1) {
    const w = wk(`r${String(i).padStart(3, '0')}`, { startedAtMs: 1000 + i, updatedAtMs: 5000 });
    net.rows.set(`u1:${w.id}`, { id: w.id, data: w, started_at_ms: w.startedAtMs });
  }
  S.markCloudBackfilled('u1', now);
  S.saveCloudSession(SESSION);
  S.saveWorkouts([wk('r000', { title: 'local pending edit', startedAtMs: 1000, updatedAtMs: 1 })]);
  S.saveOutbox([{ id: 'r000', queuedAt: 1, nextAttemptAt: NOW + 99999 }]); // not due ⇒ stays pending
  const r = await run(net, { pull: true });
  assert.equal(r.status, 'ok');
  assert.equal(r.added, 204);
  const local = S.loadWorkouts();
  assert.equal(local.length, 205);
  assert.equal(local.find((w) => w.id === 'r000').title, 'local pending edit');
  const pulls = net.calls.filter((c) => c.method === 'GET');
  assert.equal(pulls.length, 2);
  assert.match(pulls[0].search, /select=data&order=started_at_ms\.desc\.nullslast,id\.asc&limit=200&offset=0/);
});

test('sign-out mid-flight: results are not written back and the session is not resurrected', async () => {
  const net = fakeSupabase();
  S.markCloudBackfilled('u1', now);
  S.saveCloudSession(SESSION);
  S.commitFinishedWorkout(wk('a'), now);
  const realFetch = net.fetch;
  const client = makeCloudClient({ fetchImpl: async (...a) => { S.clearCloudSession(); return realFetch(...a); } });
  const r = await runCloudSync({ store: S, client, now, rand });
  assert.equal(r.status, 'signedout');
  assert.equal(S.loadCloudSession(), null);
  assert.deepEqual(S.loadOutbox().map((e) => e.id), ['a'], 'still queued for the next sign-in');
});
