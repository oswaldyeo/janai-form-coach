// Worker tests: the real worker.js + real schema.sql on an in-memory SQLite
// D1 stand-in (node:sqlite, Node ≥ 22.5). Skipped with a note on older Node.
// Also runs the browser sync engine (js/engine/sync.js) against the Worker
// in-process, so the client/server contract is tested end to end.

import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { validateWorkout, stripNeverStore } from './worker.js';
import { createD1 } from './d1-sqlite.mjs';
import { makeSyncClient, drainOutbox, pullAll, mergeRemote, applySyncResults } from '../js/engine/sync.js';

const probe = await createD1();
const skip = probe ? false : 'node:sqlite unavailable — run on Node ≥ 22.5 to exercise the Worker';
const ORIGIN = 'https://oswaldyeo.github.io';
const BASE = 'https://sync.test';

async function makeEnv({ signupCode = 'invite-123', clock = { t: 1_000 } } = {}) {
  return { DB: await createD1(), SIGNUP_CODE: signupCode, ALLOWED_ORIGINS: ORIGIN, now: () => clock.t };
}
function call(env, method, path, { token, body, origin } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (origin) headers.Origin = origin;
  const req = new Request(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return worker.fetch(req, env);
}
async function signup(env) {
  const res = await call(env, 'POST', '/signup', { body: { inviteCode: 'invite-123' } });
  assert.equal(res.status, 201);
  return res.json();
}
const wk = (id, extra = {}) => ({
  id, title: 'W', startedAtMs: 100, endedAtMs: 200,
  exercises: [{ exerciseId: 'squat', sets: [{ weight: 60, reps: 5, completed: true, camera: { reps: [{ tMs: 1 }] } }] }],
  ...extra,
});

test('health + CORS preflight echo only allowed origins', { skip }, async () => {
  const env = await makeEnv();
  assert.deepEqual(await (await call(env, 'GET', '/health')).json(), { ok: true });
  const ok = await call(env, 'OPTIONS', '/workouts', { origin: ORIGIN });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(ok.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  const bad = await call(env, 'OPTIONS', '/workouts', { origin: 'https://evil.example' });
  assert.equal(bad.headers.get('Access-Control-Allow-Origin'), null);
});

test('signup requires the configured invite code; disabled when unset', { skip }, async () => {
  const off = await makeEnv({ signupCode: '' });
  assert.equal((await call(off, 'POST', '/signup', { body: { inviteCode: 'x' } })).status, 403);
  const env = await makeEnv();
  assert.equal((await call(env, 'POST', '/signup', { body: { inviteCode: 'wrong' } })).status, 403);
  const { token, accountId } = await signup(env);
  assert.match(token, /^jfc_d_[A-Za-z0-9_-]{40,}$/);
  assert.match(accountId, /^acc_[0-9a-f]{24}$/);
  // only the hash is stored
  const rows = env.DB.raw.prepare('SELECT token_hash FROM tokens').all();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token);
  assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/);
});

test('workouts endpoints reject missing/unknown tokens', { skip }, async () => {
  const env = await makeEnv();
  assert.equal((await call(env, 'GET', '/workouts')).status, 401);
  assert.equal((await call(env, 'GET', '/workouts', { token: 'jfc_d_nope' })).status, 401);
  assert.equal((await call(env, 'POST', '/workouts', { token: 'jfc_d_nope', body: { workouts: [wk('a')] } })).status, 401);
});

test('POST stores the log only — camera/legacy/pose keys are stripped server-side', { skip }, async () => {
  const env = await makeEnv();
  const { token } = await signup(env);
  const res = await call(env, 'POST', '/workouts', { token, body: { workouts: [wk('w1', { legacyV1: { big: 1 }, landmarks: [[0, 0]] })] } });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).accepted, ['w1']);
  const { workouts, cursor, more } = await (await call(env, 'GET', '/workouts?since=0', { token })).json();
  assert.equal(workouts.length, 1);
  assert.equal(more, false);
  assert.ok(cursor > 0);
  const stored = JSON.stringify(workouts[0]);
  for (const k of ['camera', 'legacyV1', 'landmarks']) assert.ok(!stored.includes(`"${k}"`), `${k} leaked`);
  assert.equal(workouts[0].exercises[0].sets[0].weight, 60);
  assert.equal(workouts[0].updatedAtMs, 200); // falls back to endedAtMs
});

test('dedupe by id: identical re-POST is a no-op; newer edit wins; older is ignored', { skip }, async () => {
  const env = await makeEnv();
  const { token } = await signup(env);
  await call(env, 'POST', '/workouts', { token, body: { workouts: [wk('w1')] } });
  const first = await (await call(env, 'GET', '/workouts?since=0', { token })).json();
  await call(env, 'POST', '/workouts', { token, body: { workouts: [wk('w1')] } }); // retry
  const after = await (await call(env, 'GET', `/workouts?since=${first.cursor}`, { token })).json();
  assert.equal(after.workouts.length, 0, 'retry must not resurface the workout to pollers');

  await call(env, 'POST', '/workouts', { token, body: { workouts: [wk('w1', { title: 'Edited', updatedAtMs: 500 })] } });
  await call(env, 'POST', '/workouts', { token, body: { workouts: [wk('w1', { title: 'Stale', updatedAtMs: 300 })] } });
  const delta = await (await call(env, 'GET', `/workouts?since=${first.cursor}`, { token })).json();
  assert.equal(delta.workouts.length, 1);
  assert.equal(delta.workouts[0].title, 'Edited');
  const all = await (await call(env, 'GET', '/workouts', { token })).json();
  assert.equal(all.workouts.length, 1);
  assert.equal(all.workouts[0].title, 'Edited');
});

test('GET ?since pages in server order with more/cursor', { skip }, async () => {
  const env = await makeEnv();
  const { token } = await signup(env);
  const many = Array.from({ length: 5 }, (_, i) => wk(`w${i}`, { startedAtMs: i }));
  await call(env, 'POST', '/workouts', { token, body: { workouts: many } });
  const p1 = await (await call(env, 'GET', '/workouts?since=0&limit=2', { token })).json();
  assert.deepEqual(p1.workouts.map((w) => w.id), ['w0', 'w1']);
  assert.equal(p1.more, true);
  const p2 = await (await call(env, 'GET', `/workouts?since=${p1.cursor}&limit=2`, { token })).json();
  assert.deepEqual(p2.workouts.map((w) => w.id), ['w2', 'w3']);
  const p3 = await (await call(env, 'GET', `/workouts?since=${p2.cursor}&limit=2`, { token })).json();
  assert.deepEqual(p3.workouts.map((w) => w.id), ['w4']);
  assert.equal(p3.more, false);
});

test('accounts are isolated', { skip }, async () => {
  const env = await makeEnv();
  const a = await signup(env);
  const b = await signup(env);
  await call(env, 'POST', '/workouts', { token: a.token, body: { workouts: [wk('same-id', { title: 'A' })] } });
  await call(env, 'POST', '/workouts', { token: b.token, body: { workouts: [wk('same-id', { title: 'B' })] } });
  const ga = await (await call(env, 'GET', '/workouts', { token: a.token })).json();
  const gb = await (await call(env, 'GET', '/workouts', { token: b.token })).json();
  assert.deepEqual(ga.workouts.map((w) => w.title), ['A']);
  assert.deepEqual(gb.workouts.map((w) => w.title), ['B']);
});

test('server tokens are read-only and cannot mint tokens', { skip }, async () => {
  const env = await makeEnv();
  const { token } = await signup(env);
  const minted = await call(env, 'POST', '/tokens', { token, body: { kind: 'server', label: 'mac-puller' } });
  assert.equal(minted.status, 201);
  const { token: server, kind } = await minted.json();
  assert.equal(kind, 'server');
  assert.match(server, /^jfc_s_/);
  await call(env, 'POST', '/workouts', { token, body: { workouts: [wk('w1')] } });
  assert.equal((await (await call(env, 'GET', '/workouts', { token: server })).json()).workouts.length, 1);
  assert.equal((await call(env, 'POST', '/workouts', { token: server, body: { workouts: [wk('w2')] } })).status, 403);
  assert.equal((await call(env, 'POST', '/tokens', { token: server, body: { kind: 'device' } })).status, 403);
  assert.equal((await call(env, 'POST', '/tokens', { token, body: { kind: 'admin' } })).status, 400);
  env.DB.raw.prepare('UPDATE tokens SET revoked_at_ms = 1 WHERE kind = ?').run('server');
  assert.equal((await call(env, 'GET', '/workouts', { token: server })).status, 401);
});

test('malformed input: bad JSON 400, bad ids rejected per-item, oversize batch 413', { skip }, async () => {
  const env = await makeEnv();
  const { token } = await signup(env);
  const bad = await worker.fetch(new Request(`${BASE}/workouts`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{nope',
  }), env);
  assert.equal(bad.status, 400);
  const mixed = await (await call(env, 'POST', '/workouts', {
    token, body: { workouts: [wk('ok-1'), { id: 'has space', exercises: [] }, { id: 'x' }] },
  })).json();
  assert.deepEqual(mixed.accepted, ['ok-1']);
  assert.deepEqual(mixed.rejected.map((r) => r.reason), ['bad id', 'missing exercises']);
  const big = Array.from({ length: 51 }, (_, i) => wk(`b${i}`));
  assert.equal((await call(env, 'POST', '/workouts', { token, body: { workouts: big } })).status, 413);
  assert.equal((await call(env, 'GET', '/nope', { token })).status, 404);
});

test('validateWorkout / stripNeverStore are pure', () => {
  const src = wk('p1');
  const v = validateWorkout(src);
  assert.equal(v.ok, true);
  assert.ok(src.exercises[0].sets[0].camera, 'input not mutated');
  assert.deepEqual(stripNeverStore({ a: [{ camera: 1, b: 2 }], video: 'x' }), { a: [{ b: 2 }] });
});

test('client engine ↔ Worker round trip: drain, retry-safe, pull re-hydrates a wiped device', { skip }, async () => {
  const env = await makeEnv();
  const fetchImpl = (url, init) => worker.fetch(new Request(url, init), env);
  const anon = makeSyncClient({ url: BASE, fetchImpl });
  const { token } = await anon.signup('invite-123');
  const client = makeSyncClient({ url: BASE, token, fetchImpl });

  const local = [wk('w2', { startedAtMs: 2 }), wk('w1', { startedAtMs: 1 })];
  let outbox = [{ id: 'w2', queuedAt: 20 }, { id: 'w1', queuedAt: 10 }];
  const r = await drainOutbox({ outbox, workouts: local, post: client.postWorkouts, nowMs: 1000 });
  assert.equal(r.sent.length, 2);
  assert.equal(r.error, null);
  outbox = applySyncResults(outbox, r, 1000);
  assert.deepEqual(outbox, []);

  // device wiped: empty local store pulls everything back
  const pulled = await pullAll({ get: client.getWorkouts, since: 0 });
  const merged = mergeRemote([], pulled.workouts);
  assert.deepEqual(merged.workouts.map((w) => w.id), ['w2', 'w1']);
  assert.equal(merged.added, 2);
  assert.ok(!JSON.stringify(merged.workouts).includes('"camera"'));

  // incremental pull from the cursor sees only later changes
  await client.postWorkouts([wk('w1', { title: 'Edited', updatedAtMs: 9999, startedAtMs: 1 })]);
  const delta = await pullAll({ get: client.getWorkouts, since: pulled.cursor });
  assert.deepEqual(delta.workouts.map((w) => w.title), ['Edited']);
  const m2 = mergeRemote(local, delta.workouts);
  assert.equal(m2.updated, 1);
  assert.equal(m2.workouts.find((w) => w.id === 'w1').title, 'Edited');
  assert.ok(m2.workouts.find((w) => w.id === 'w1').exercises[0].sets[0].camera, 'local camera blob kept');
});
