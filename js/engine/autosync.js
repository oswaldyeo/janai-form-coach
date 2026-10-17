// Supabase auto-sync orchestration: one pass = refresh session → one-time
// sign-in backfill → drain the outbox (upsert to formcoach_workouts) → optional
// pull-merge. Storage and the network client are injected, so the whole flow
// is unit-tested against an in-memory localStorage and a mocked fetch.
//
// The outbox is the same persistent queue the legacy "Send to Janai Health"
// delivery used, so anything still sitting in it (shared-but-unconfirmed or
// never sent) is drained here too. Camera/pose keys are stripped by
// sanitizeForSync inside drainOutbox before any request is built.

import { sessionNeedsRefresh } from './cloud.js';
import { drainOutbox, applySyncResults, mergeRemote } from './sync.js';

const isAuthError = (err) => !!err && (err.status === 401 || err.status === 403);
// GoTrue answers a dead refresh token with 400/401/403 — only a fresh sign-in fixes that.
const isDeadRefresh = (err) => !!err && err.status >= 400 && err.status < 500;

/**
 * @param {object} p
 * @param {object} p.store   storage.js-shaped: loadCloudSession, saveCloudSession, clearCloudSession,
 *                           loadWorkouts, saveWorkouts, loadOutbox, saveOutbox, queueManyForDelivery,
 *                           isCloudBackfilled, markCloudBackfilled
 * @param {object} p.client  makeCloudClient() result
 * @param {()=>number} [p.now]
 * @param {boolean} [p.pull]  also pull-merge from the server
 * @param {(w:object)=>object} [p.prepare]  payload shaping before sanitizing (e.g. catalog names)
 * @param {()=>number} [p.rand] backoff jitter (tests)
 * @returns {Promise<{status:'signedout'|'ok'|'error'|'expired', backfilled:number, sent:number,
 *   failed:number, dropped:number, added:number, updated:number, error:Error|null}>}
 */
export async function runCloudSync({ store, client, now = Date.now, pull = false, prepare, rand } = {}) {
  const out = { status: 'ok', backfilled: 0, sent: 0, failed: 0, dropped: 0, added: 0, updated: 0, error: null };
  let session = store.loadCloudSession();
  if (!session) return { ...out, status: 'signedout' };
  const userId = session.user && session.user.id;
  // A sign-out (or account switch) mid-flight must not be resurrected or written to.
  const stillCurrent = () => {
    const cur = store.loadCloudSession();
    return !!cur && (cur.user && cur.user.id) === userId;
  };

  async function refresh() {
    try {
      const fresh = await client.refreshSession(session.refresh_token);
      if (!stillCurrent()) return false;
      session = { ...session, ...fresh, user: fresh.user || session.user, lastSyncMs: session.lastSyncMs };
      store.saveCloudSession(session);
      return true;
    } catch (err) {
      if (isDeadRefresh(err) && stillCurrent()) { store.clearCloudSession(); out.status = 'expired'; }
      else out.status = 'error';
      out.error = err;
      return false;
    }
  }

  if (sessionNeedsRefresh(session, now()) && !(await refresh())) return out;

  // One-time backfill per account: every local workout joins the outbox, next
  // to whatever the legacy delivery outbox already held (queueManyForDelivery
  // keeps unrelated entries). Upserts are idempotent, so overlap is harmless.
  if (userId && !store.isCloudBackfilled(userId)) {
    const local = store.loadWorkouts().filter((w) => w && w.id);
    if (store.queueManyForDelivery(local, now)) {
      store.markCloudBackfilled(userId, now);
      out.backfilled = local.length;
    }
  }

  const post = (ws) => client.pushWorkouts(session, ws);
  let res = await drainOutbox({ outbox: store.loadOutbox(), workouts: store.loadWorkouts(), post, nowMs: now(), prepare });
  if (isAuthError(res.error)) {
    // JWT revoked/expired early: refresh once and retry the whole drain.
    if (!(await refresh())) return out;
    res = await drainOutbox({ outbox: store.loadOutbox(), workouts: store.loadWorkouts(), post, nowMs: now(), prepare });
  }
  if (!stillCurrent()) return { ...out, status: 'signedout' };
  store.saveOutbox(applySyncResults(store.loadOutbox(), res, now(), { rand }));
  out.sent = res.sent.length;
  out.failed = res.failed.length;
  out.dropped = res.dropped.length;
  if (res.error) {
    out.status = isAuthError(res.error) ? 'expired' : 'error';
    if (out.status === 'expired') store.clearCloudSession();
    out.error = res.error;
    return out;
  }

  if (pull) {
    try {
      const remote = await client.pullWorkouts(session);
      if (!stillCurrent()) return { ...out, status: 'signedout' };
      const pendingIds = new Set(store.loadOutbox().map((e) => e.id));
      const merged = mergeRemote(store.loadWorkouts(), remote, { pendingIds });
      if ((merged.added || merged.updated) && store.saveWorkouts(merged.workouts)) {
        out.added = merged.added;
        out.updated = merged.updated;
      }
    } catch (err) {
      out.status = 'error';
      out.error = err;
      return out;
    }
  }

  if (stillCurrent()) store.saveCloudSession({ ...store.loadCloudSession(), lastSyncMs: now() });
  return out;
}
