# Supabase auto-sync — `janai/devin-supabase-autosync`

The live Supabase backend in `js/engine/cloud.js` is now **the** auto-sync
transport. The Cloudflare Worker (`sync/`) is kept but dormant, and its pairing
UI is gone. Earlier reports (save integrity, CF auto-sync) are in git history
(`git show 2481d50:REPORT.md`).

## What changed

| Area | Change |
| --- | --- |
| `js/engine/cloud.js` | New `makeCloudClient({ fetchImpl })`, so the network can be injected and mocked. The existing exports (`signUp`, `signInWithPassword`, `refreshSession`, `pullWorkouts`, `pushWorkouts`) wrap a default client, so the auth flow is unchanged. `pushWorkouts` dedupes by id inside a batch and sends `keepalive` for bodies under 60 KB. `pullWorkouts` now pages (200 per page) instead of stopping at 300. Errors carry `status` and the PostgREST `code`. |
| `js/engine/autosync.js` (new) | `runCloudSync()` runs one pass: refresh the session if it expires within 60 s → one-time backfill per account → drain the outbox (upsert) → optional pull-merge → stamp `lastSyncMs`. On a 401/403 it refreshes once and retries. If the refresh token is dead it signs out quietly and keeps the outbox. If you sign out mid-flight, nothing is written back and the session is not resurrected. |
| `js/engine/sync.js` | `drainOutbox` now sends one payload per workout id; duplicate outbox entries share its result. Postgres rejects an `ON CONFLICT` batch that touches the same row twice. `syncStatus({ signedIn, … })` has states `signedout / offline / syncing / pending / synced / error`. The CF client (`makeSyncClient`, `normalizeSyncUrl`, `pullAll`, `SYNC_DEFAULTS`) is marked **DORMANT** and its tests are kept. |
| `js/storage.js` | `isCloudBackfilled(userId)` / `markCloudBackfilled(userId)` read and write key `janai.formcoach.cloud.backfill.v1`. The CF pairing helpers are marked dormant. The outbox, finish transaction and `updateWorkout` re-queue are unchanged: finish and edit already queue by id, even while signed out. |
| `js/app.js` | `cloudAutoSync(reason)` replaces both `cloudSync` (which pushed the whole history on every sync) and the CF `autoSync`. It runs on finish, on editing a past workout, on import, at boot, after sign-in, on `online`, on foreground, and on the backoff retry timer. It pulls on boot, sign-in, manual, online and resume. **Removed:** the Home "N workouts not delivered — Send now / Mark received" card, the History "Send pending" button, the summary "Send to Janai Health" button, `sendToJanaiHealth` (share sheet / download) and `confirmReceived`, plus all CF pairing UI and code. The new `refreshSyncUI()` drives the header pill and, when signed out with history, one calm Home card: "Back up your workouts — N saved on this device … [Sign in]". Tapping the card or the pill opens Settings with the email field focused. |
| `index.html`, `css/styles.css` | Outbox card, send buttons and the "Janai auto-sync" Settings block removed. Sign-in prompt card added. The privacy copy now describes sync honestly. Added the `signedout` pill style. |
| `sw.js` | Shell `v48 → v49`, `app.js?v=31`. `js/engine/autosync.js` added to SHELL. |
| `sync/README.md` (new) | Marks the Worker **DORMANT** and points to the Supabase path. Worker code is untouched. |
| Tests | `test/supabase-autosync.test.js` (new, 10 tests, mocked fetch + in-memory localStorage): signed-out queueing, **first-sign-in backfill** of history plus the legacy outbox (shared-unconfirmed, never-sent, orphan), exact request shape, camera/pose stripped, **dedupe** (duplicate outbox entries and repeated edits → one row per id; idempotent re-runs), **outbox drain** offline → backoff → drain, 5xx exponential backoff, token refresh and 401 retry, dead refresh → quiet sign-out with the outbox kept, paged pull-merge rehydrate with the pending local edit winning, and sign-out mid-flight. `test/sync.test.js`: `syncStatus` test updated to the new states. |

Payload privacy is unchanged and enforced in one place. `sanitizeForSync` strips `camera`, `legacyV1`, `landmarks`, `poseLandmarks`, `worldLandmarks`, `frames`, `video` and `image` at any depth before a request is built. The only key in the repo is the already-public publishable key in `cloud.js`.

## Exact Supabase calls

Base `https://pwuicyuuxrvemvrtmjia.supabase.co`. Every request sends `apikey: <publishable key>` and `Content-Type: application/json`. `Authorization` is `Bearer <user access_token>`, or the publishable key for auth calls.

| Purpose | Call |
| --- | --- |
| Sign in | `POST /auth/v1/token?grant_type=password` body `{email, password}` |
| Create account (fallback) | `POST /auth/v1/signup` body `{email, password}` |
| Refresh | `POST /auth/v1/token?grant_type=refresh_token` body `{refresh_token}` (when `expires_at` is < 60 s away, or after a 401/403 on upsert) |
| Upsert (finish / edit / backfill / retry) | `POST /rest/v1/formcoach_workouts?on_conflict=user_id,id` with header `Prefer: resolution=merge-duplicates,return=minimal`, body `[{id, data, started_at_ms}]` (≤25 rows per request, unique ids, `user_id` filled by the DB default, `data` = sanitized workout plus catalog `exerciseName`/`primaryMuscle`), `keepalive` when < 60 KB |
| Pull (boot / sign-in / manual / online / resume) | `GET /rest/v1/formcoach_workouts?select=data&order=started_at_ms.desc.nullslast,id.asc&limit=200&offset=<n*200>`, repeated until a short page (max 50 pages) |

## Verification done here

- `npm test`: **76/76 pass**: 66 existing (CF worker tests included, Node 22) plus 10 new.
- The private janai-brain suite (226 tests) run against this branch's `js/`: **226/226 pass**.
- Headless Chrome smoke test with Supabase mocked at the network layer (`page.route`), service worker blocked. Seeded 2 local workouts, one of them in the legacy outbox as "shared, unconfirmed".
  - Signed out: the pill reads "Signed out" and the calm prompt shows. The outbox card and send button are gone.
  - Signed in through the prompt: one upsert of `["w2","w1"]` went out with no camera keys, and the server-only row was pulled in. The outbox emptied, the pill read "Synced ✓" and the prompt hid.
  - Editing a past workout: the background upsert of `["w1"]` carried the new title.
- **Not verified against the real Supabase project.** No test account was used, and nothing was written to production. See LOCAL-CHECKS.

## Known limits

- When a whole upsert batch is rejected with a non-auth 4xx (e.g. a malformed row or a 413), the batch retries with backoff capped at 30 min rather than being split. Nothing is dropped. `lastError` on the outbox entry shows the cause.
- Deletes don't sync: the app has no delete-workout path. "Clear all v2 history" is local only, and the next boot pull restores the history from the cloud.
- Backfill is once per account per device. If a different account signs in on the same device, that account also gets this device's history.

## Files likely to overlap with parallel work

`js/app.js` (finish flow, `saveEditedWorkout`, boot, Settings), `js/storage.js`, `js/engine/sync.js`, `index.html`, `sw.js` (shell version).

## LOCAL-CHECKS (run on a real device / the live project)

1. **Serve:** `python3 -m http.server 8765`, open `http://localhost:8765` (or the deployed PWA). Hard-reload once so SW `formcoach-shell-v49` takes over.
2. **Signed out:** finish a workout while signed out. The pill says *Signed out*, Home shows one "Back up your workouts" card, there's no red/amber banner, and DevTools → Application → Local Storage → `janai.formcoach.outbox.v1` holds its id.
3. **Backfill:** tap *Sign in* and sign in. Within a few seconds the pill reads *Synced ✓*, the Settings message says "N on this device backed up", and `janai.formcoach.outbox.v1` is `[]`.
4. **Rows arrive server-side:** in the Supabase SQL editor run
   `select id, started_at_ms, data->>'title' from formcoach_workouts where user_id = (select id from auth.users where email = '<you>') order by started_at_ms desc;`
   Every local workout should be listed, including the one from step 2.
5. **No camera data server-side:** `select count(*) from formcoach_workouts where data::text ~ '"(camera|landmarks|poseLandmarks|worldLandmarks|frames|video|image|legacyV1)"';` → `0`.
6. **Finish → auto-upsert:** finish a workout while signed in. The Network tab shows one `POST …/formcoach_workouts?on_conflict=user_id,id` → `201`, and the row appears in step 4's query.
7. **Edit → auto-upsert:** History → edit a past workout's title. One POST goes out, and `data->>'title'` updates on the same row (no duplicate id).
8. **Offline queue:** DevTools → Network → Offline, then finish a workout. The pill reads *Offline · 1 pending*. Go back online: the pill goes *Syncing…* then *Synced ✓*, and the row arrives.
9. **Rehydrate:** with everything synced, run `localStorage.removeItem('janai.formcoach.workouts.v2')` in the console and reload. History comes back from the cloud and a "Restored N workouts" toast shows.
10. **Legacy outbox rescue (pre-existing devices):** on a device that still shows the old "not delivered" history, signing in (or booting while already signed in, the first time on this build) uploads all of it with no taps. Check with step 4.
11. **Expired session:** sign out in another tab, or revoke the session in the Supabase dashboard, then finish a workout. The pill falls back to *Signed out* with the calm prompt, and the workout stays queued until the next sign-in.
