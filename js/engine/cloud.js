// Cloud sync — Supabase over plain fetch. No SDK, no runtime dependencies.
//
// Auth is GoTrue email + password (new signups are auto-confirmed server-side,
// so signup returns a session directly); data is one PostgREST table
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

/**
 * Map an auth/network error → one short human sentence. Pure: reads only
 * `err.code` (GoTrue error_code, when the API sent one) and `err.message`.
 * The UI shows the result and console.logs the raw error for debugging.
 */
export function mapAuthError(err) {
  const code = (err && err.code) || '';
  const msg = String((err && err.message) || '').toLowerCase();
  if (code === 'user_already_exists' || msg.includes('already registered')) {
    return 'This email already has an account and that password didn’t match — check the password or ask Janai for a reset.';
  }
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'Wrong email or password — double-check and try again.';
  }
  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) {
    return 'This account isn’t activated yet — tell Janai and she’ll switch it on.';
  }
  if (code === 'weak_password' || msg.includes('password should be')) {
    return 'Password is too short — use at least 8 characters.';
  }
  if (code === 'validation_failed' || msg.includes('validate email') || msg.includes('invalid format')) {
    return 'That doesn’t look like a valid email address.';
  }
  if (code === 'signup_disabled' || msg.includes('signups not allowed')) {
    return 'New sign-ups are switched off right now — tell Janai.';
  }
  if (code.includes('rate_limit') || msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'Too many attempts — wait a minute, then try again.';
  }
  // fetch() rejections: Chrome "Failed to fetch", Safari "Load failed",
  // Firefox "NetworkError when attempting to fetch resource".
  if (msg.includes('fetch') || msg.includes('load failed') || msg.includes('networkerror') || msg.includes('network request failed')) {
    return 'You look offline — check your connection and try again.';
  }
  return `Something went wrong — try again. (${(err && err.message) || 'unknown error'})`;
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
    const err = new Error(msg);
    err.code = (json && json.error_code) || null; // GoTrue machine-readable code
    err.status = res.status;
    throw err;
  }
  return json;
}

/**
 * Create an account with email + password. The DB auto-confirms new signups
 * (trigger `formcoach_autoconfirm` on auth.users), so a genuinely new email
 * returns a session directly. An already-registered email returns a sessionless
 * obfuscated user (GoTrue anti-enumeration) — callers should treat null as
 * "this email probably has an account" and retry sign-in.
 */
export async function signUp(email, password) {
  const body = await call('/auth/v1/signup', { method: 'POST', body: { email, password } });
  return sessionFromTokenResponse(body); // null ⇒ confirmation pending
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
