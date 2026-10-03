// Cloud sync — Supabase over plain fetch. No SDK, no runtime dependencies.
//
// Auth is GoTrue email OTP / magic link; data is one PostgREST table
// (formcoach_workouts) with owner-only row-level security, so the publishable
// key below is safe to ship: without a signed-in user's JWT it can read and
// write nothing. Local storage remains the source of truth — the cloud is a
// mirror keyed by (user_id, workout id), merged with mergeWorkouts() so sync
// is idempotent and never clobbers on-device history.

export const CLOUD = {
  url: 'https://pwuicyuuxrvemvrtmjia.supabase.co',
  key: 'sb_publishable_VulWQyHk9IYQ09lfZTIpbQ_QZLziu_R',
  table: 'formcoach_workouts',
};

// ── pure helpers (unit-tested) ───────────────────────────────────────────────

/** Map a v2 Workout → one PostgREST row. user_id is filled by the DB default. */
export function rowFromWorkout(w) {
  return { id: w.id, data: w, started_at_ms: w.startedAtMs ?? null };
}

/** Map pulled rows → Workout records, dropping anything malformed. */
export function workoutsFromRows(rows) {
  return (rows || [])
    .map((r) => r && r.data)
    .filter((w) => !!w && typeof w === 'object' && typeof w.id === 'string' && Array.isArray(w.exercises));
}

/** True when the session is missing or expires within `skewSec` seconds. */
export function sessionNeedsRefresh(session, nowMs, skewSec = 60) {
  if (!session || !session.access_token) return true;
  if (!session.expires_at) return true;
  return session.expires_at * 1000 - nowMs < skewSec * 1000;
}

/** Normalize a GoTrue token response → the session shape we persist. */
export function sessionFromTokenResponse(body) {
  if (!body || !body.access_token) return null;
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token || null,
    expires_at: body.expires_at || null,
    user: body.user ? { id: body.user.id, email: body.user.email } : null,
  };
}

// ── network (thin wrappers; errors surface as thrown Error with message) ─────

async function call(path, { method = 'GET', jwt = null, body = undefined, headers = {} } = {}) {
  const res = await fetch(`${CLOUD.url}${path}`, {
    method,
    headers: {
      apikey: CLOUD.key,
      Authorization: `Bearer ${jwt || CLOUD.key}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (!res.ok) {
    const msg = (json && (json.msg || json.message || json.error_description || json.error)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/** Email a one-time code / magic link. Creates the account on first use. */
export function requestOtp(email) {
  return call('/auth/v1/otp', { method: 'POST', body: { email, create_user: true } });
}

/** Exchange the emailed 6-digit code for a session. */
export async function verifyOtp(email, token) {
  const body = await call('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token } });
  const session = sessionFromTokenResponse(body);
  if (!session) throw new Error('No session returned — code may be expired.');
  return session;
}

/** Email + password sign-in (1Password-friendly). */
export async function signInWithPassword(email, password) {
  const body = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  const session = sessionFromTokenResponse(body);
  if (!session) throw new Error('Sign-in failed.');
  return session;
}

/** Trade a refresh token for a fresh session. */
export async function refreshSession(refresh_token) {
  const body = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token } });
  const session = sessionFromTokenResponse(body);
  if (!session) throw new Error('Session refresh failed — sign in again.');
  return session;
}

/** Pull every cloud workout for the signed-in user (RLS scopes to owner). */
export async function pullWorkouts(session) {
  const rows = await call(
    `/rest/v1/${CLOUD.table}?select=data&order=started_at_ms.desc.nullslast&limit=300`,
    { jwt: session.access_token }
  );
  return workoutsFromRows(rows);
}

/** Upsert the given workouts under the signed-in user. Idempotent. */
export function pushWorkouts(session, workouts) {
  if (!workouts.length) return Promise.resolve(null);
  return call(`/rest/v1/${CLOUD.table}?on_conflict=user_id,id`, {
    method: 'POST',
    jwt: session.access_token,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: workouts.map(rowFromWorkout),
  });
}
