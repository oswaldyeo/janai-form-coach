# Janai auto-sync — report

Branch: `janai/devin-auto-sync`. Goal: every workout saves to the owner's
backend automatically, with no share-sheet tap and no “Send to Janai”, and a
wiped phone re-hydrates its history from the server.

## 0. What I found and what I decided

The brief said `sync/README.md`, `worker.js`, `schema.sql` and an 8/8
`worker.test.mjs` were already in the repo. **They are not in the public repo.**
No branch and no commit has ever had a `sync/` directory. `main` also has no
`test/` or `package.json`: they were added in `b989bfd` and removed again by the
revert `c74c1e5`. So I **built the backend from the brief**: a Cloudflare Worker
plus a D1 schema with signup, pairing and token auth, `POST /workouts` and
`GET /workouts?since=`. If a private worker already exists, compare its API with
§2 before you merge. The client only relies on `POST /signup`,
`POST /workouts` and `GET /workouts?since=&limit=`, and their response shapes
are in §2.

The existing opt-in Supabase sync (`js/engine/cloud.js`) is **left unchanged**.
It is a separate, independent path.

## 1. What was wired

| Area | Where | Behaviour |
|---|---|---|
| Pair / signup | Settings → *Janai auto-sync* (`index.html`, `js/app.js` `syncSignup` / `syncPair`) | Enter the server URL and invite code, then `POST /signup`. The device token is **shown once** with Copy and “I’ve saved it”, then saved under `janai.formcoach.sync.v1`. When you close Settings or tap “I’ve saved it”, the token is removed from the DOM. A second device, or a wiped one, pastes the token into *Pair this device*. That call is checked with `GET /workouts?limit=1`. Unpair clears the config and keeps all workouts. |
| First pairing | `completePairing` | Queues the **whole local history** once (`queueManyForDelivery`; the server dedupes by id), then syncs. That push also pulls anything already on the server. |
| Auto-push on finish | `finishWorkout` → `queueForDelivery` + `autoSync('finish')` | The workout is saved locally first, then added to the existing outbox (`janai.formcoach.outbox.v1`) and POSTed in the background. |
| Auto-push on edit | History → **Edit** → `saveEditedWorkout` → `storage.updateWorkout` + `autoSync('edit')` | `updateWorkout` stamps `updatedAtMs`, replaces the workout by id, and re-queues it (one outbox entry per id). The only edit UI today is title + note: `main` had no past-workout editor. **Any future editor should call `saveEditedWorkout`.** |
| Retry / offline | `js/engine/sync.js` `drainOutbox`, `applySyncResults`, `backoffMs`; `scheduleSyncRetry` in `app.js` | Batches of 25. A failed batch stays queued with `attempts`, `nextAttemptAt` and `lastError`. Backoff is 5 s × 2ⁿ, capped at 30 min, with 50–100 % jitter. Sync also runs on `online`, on `visibilitychange → visible`, at boot and from *Sync now*. While the browser is offline nothing is attempted. If you edit a workout while its POST is in flight, the edit is not lost: entries are matched on `{id, queuedAt}`. Outbox entries for workouts that are no longer stored locally, or that the server rejects as malformed, are dropped and logged. |
| Boot pull-merge | `autoSync` step 2 → `pullAll` + `mergeRemote` | `GET /workouts?since=<cursor>` follows `more` pages. It does a full pull (`since=0`) when there is no cursor, when local history is empty (a wipe) or once every 24 h. The merge adds unknown ids, replaces a workout only when the remote `updatedAtMs` is strictly newer, never overrides an id still pending in the outbox, and keeps local-only per-set `camera` blobs and `legacyV1`. The push runs **before** the pull. |
| Status indicator | `#sync-pill` in the header (tap opens Settings), plus a detail line in Settings | `Not paired` · `Synced ✓` · `Pending N` · `Syncing…` · `Offline` / `Offline · N pending` · `Re-pair sync` (shown on 401/403). |
| Manual share | `btn-summary-send`, `btn-send-pending` | Hidden while paired, because delivery is automatic. Still available when unpaired. |
| Privacy | `sanitizeForSync` (client) **and** `stripNeverStore` (worker) | Only the workout-log JSON is sent. Keys `camera`, `legacyV1`, `landmarks`, `poseLandmarks`, `worldLandmarks`, `frames`, `video` and `image` are removed at any depth, on both sides. Exercises are enriched with `exerciseName` and `primaryMuscle` (same as the delivery document) so the Mac puller doesn't need the JS catalog. |
| Service worker | `sw.js` | Shell `v47` includes `js/engine/sync.js`. **Requests with an `Authorization` header are never cached.** |

New and changed files: `sync/worker.js`, `sync/schema.sql`,
`sync/wrangler.toml`, `sync/d1-sqlite.mjs` (test-only D1 stand-in),
`sync/worker.test.mjs`, `js/engine/sync.js`, `js/storage.js`, `js/app.js`,
`index.html`, `css/styles.css`, `sw.js`, `README.md`, `package.json`,
`test/sync.test.js`, `test/storage-sync.test.js`.

### Tests

`npm test` (`node --test`) gives **32/32 passing on Node 22**:

- 11 worker/integration tests against the real `schema.sql`
- 16 client sync-engine tests
- 5 storage/outbox tests

On Node 20 the 10 worker tests that need `node:sqlite` are skipped.

As a regression check I also ran the historical suite from `b989bfd` (not
committed, because it was reverted on `main`) against this branch: 177/180.
The same **3 failures happen on untouched `main`** (148 tests, 145 pass). They
are Hevy-catalog and how-to asset checks unrelated to sync: “catalog mirrors all
451 Hevy templates”, “every exercise has authored how-to guidance” and “every
referenced how-to image exists locally”.

I also ran a manual end-to-end smoke test in headless Chrome against the worker
running locally. It covered: unpaired, then signup with the token shown once,
then synced (camera blob absent on the server). Then an edit, which showed up
on the server. Going offline gave `Offline · 1 pending`, and coming back online
synced it. Finally I wiped localStorage and rebooted, and the history was
re-hydrated.

## 2. Worker API (`sync/worker.js`)

All bodies are JSON. Auth is `Authorization: Bearer <token>`. D1 stores only the
SHA-256 of each token.

| Route | Auth | Body → Response |
|---|---|---|
| `GET /health` | – | `{ok:true}` |
| `POST /signup` | invite code | `{inviteCode, label?}` → `201 {accountId, token, kind:"device"}`. 403 if the code is wrong or `SIGNUP_CODE` is unset. |
| `POST /tokens` | device | `{kind:"device"\|"server", label?}` → `201 {token, kind}`. Server tokens are **read-only**. |
| `POST /workouts` | device | `{workouts:[…]}` (max 50 per request, max 256 KB per workout) → `{accepted:[ids], rejected:[{id, reason}]}`. Upsert by `(account, id)`. Last writer wins on `updatedAtMs` (falling back to `endedAtMs`, then `startedAtMs`). An identical retry is a no-op. |
| `GET /workouts?since=<cursor>&limit=<≤200>` | device or server | `{workouts:[…], cursor, more}`. The cursor is a per-account server sequence, not a device clock, so clock skew can't drop changes. Every accepted change gets a new sequence number, so an edited workout shows up again with its new contents. |

CORS: only origins listed in `ALLOWED_ORIGINS` are allowed. Requests without an
Origin header, such as curl or the Mac puller, are unaffected.

## 3. Deploying to the owner's Cloudflare account

You need Node 18+ and a Cloudflare account. Nothing secret is in the repo:
`database_id` is a placeholder, and the invite code is a Worker secret.

```bash
cd sync
npx wrangler@3 login
# 1. Create the D1 database, then paste the printed database_id into wrangler.toml
npx wrangler@3 d1 create janai-formcoach-sync
# 2. Create the tables (remote D1)
npx wrangler@3 d1 execute janai-formcoach-sync --remote --file=schema.sql
# 3. Invite code that gates /signup (choose a long random value; never commit it)
npx wrangler@3 secret put SIGNUP_CODE
# 4. If the app is served from somewhere other than https://oswaldyeo.github.io,
#    edit ALLOWED_ORIGINS in wrangler.toml (comma-separated, exact origins)
# 5. Deploy
npx wrangler@3 deploy
# → https://janai-formcoach-sync.<your-subdomain>.workers.dev
curl https://janai-formcoach-sync.<your-subdomain>.workers.dev/health   # {"ok":true}
```

**Endpoint config in the app.** On the phone, open Settings → *Janai auto-sync*,
enter the `workers.dev` URL (or a custom domain) and the invite code, and tap
*Create sync account*. Save the token it shows in a password manager. You only
create the account once: every other device uses *Pair this device* with that
token. If you'd rather not type the URL, set `SYNC_DEFAULTS.url` in
`js/engine/sync.js` to the deployed URL. The URL is not a secret. Once you've
created your account, you can rotate or delete `SIGNUP_CODE`
(`wrangler secret delete SIGNUP_CODE`) to close signups.

Local development: `npx wrangler@3 d1 execute janai-formcoach-sync --local
--file=schema.sql`, then `npx wrangler@3 dev`. Put a local `SIGNUP_CODE` in
`sync/.dev.vars` and don't commit it. Add `http://localhost:<port>` to
`ALLOWED_ORIGINS`.

## 4. Spec: Mac-side puller (for the owner's local agent)

**Credential.** Mint a read-only server token once, using the device token
(for example from a laptop shell):

```bash
curl -s -X POST "$SYNC_URL/tokens" -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H 'Content-Type: application/json' -d '{"kind":"server","label":"mac-puller"}'
# → {"token":"jfc_s_…","kind":"server"}
```

- Store it in the macOS Keychain, not in a file in a repo.
- Never log it.
- A server token **cannot write**, and gets 403 on `POST`.

**Loop.** Run every 5 minutes; launchd `StartInterval=300` works.

1. Load `cursor` from local state. Use `0` on the first run.
2. `GET $SYNC_URL/workouts?since=<cursor>&limit=200` with `Authorization: Bearer <server token>`.
3. For each workout in `workouts`, **upsert by `id`**. Keep the incoming copy only
   if its `updatedAtMs` is ≥ the stored one. The same id can arrive more than
   once (after edits), so this must be idempotent.
4. Durably commit the upserts, **then** save `cursor` = the response `cursor`.
   If you crash in between, you re-fetch the page, which is harmless because of
   the upsert.
5. While `more` is true, repeat from step 2 with the new cursor.

**Errors.**

- On a network error or 5xx, retry with exponential backoff (for example 30 s ×
  2ⁿ, capped at 1 h). Never advance the cursor on failure.
- On 401 or 403, stop and notify the owner: the token was revoked or is wrong.
- On 400, log the request and stop. It means a bug.

**Re-sync.** Setting `cursor=0` replays the whole account. Do this weekly as a
safety net if you like.

**Payload: one workout.**

```json
{ "id": "…", "title": "…", "startedAtMs": 0, "endedAtMs": 0, "updatedAtMs": 0,
  "note": "", "routineId": null,
  "exercises": [ { "exerciseId": "squat", "exerciseName": "Squat", "primaryMuscle": "quads",
                   "sets": [ { "weight": 40, "reps": 8, "durationSec": 0, "distanceM": 0,
                               "type": "normal", "rpe": null, "completed": true,
                               "source": "camera|manual", "side": null } ] } ] }
```

- Weights are in kg. Only `completed` sets count toward volume.
- An entry may carry extra fields. Ignore unknown keys.
- No camera, pose, frame or video data is ever present.

**Deletes.** The phone has no per-workout delete today, so the API has no
tombstones. If deletion is added later, mark it with a `deletedAtMs` field on
the workout and upsert as usual.

## 5. Overlap with `janai/devin-save-integrity`

I did not fetch or read that branch. These are the files we likely both touch;
merge them carefully:

- **`js/app.js`**:
  - `finishWorkout()`: I added `finished.updatedAtMs = finished.endedAtMs` and `autoSync('finish')` after `queueForDelivery`. Keep both, in that order, after the local save.
  - `refreshPendingBanner()`: hidden while paired, and it now calls `renderSyncStatus()`.
  - `renderHistory()`: adds the Edit button and note line.
  - `showSummary()`: hides the send button while paired.
  - Boot: `autoSync('boot')`.
  - The new auto-sync block sits just above “delivery to Janai Health”.
  - New imports at the top.
- **`js/storage.js`**:
  - New `updateWorkout`, `queueManyForDelivery` and the sync-config helpers.
  - `saveOutbox` is now exported.
  - If that branch changes `saveWorkout` / `saveWorkouts` / `queueForDelivery` semantics, for example to verify writes, `updateWorkout` should follow the same path.
- **`sw.js`**: I bumped the shell version (`v47`) and the `app.js?v=29` query. Whichever branch merges second should bump again.
- **`index.html`**: `app.js?v=29`, the header pill, and the Settings section.
- **`package.json`** and **`test/`**: both are new on this branch. If the other branch also restores them, combine the two.

## 6. Known limits

- The edit UI is minimal: title and note only, via `prompt()`. It exists so the
  edit → sync path is real and tested. Set-level editing still needs a proper
  editor.
- The token is kept in localStorage, like the existing Supabase session. Anyone
  with access to the unlocked phone's browser profile can read it.
- If a push is rejected for a reason other than 401/403 (for example a 413 on an
  enormous workout), it is dropped from the outbox only when the server
  explicitly rejects that id. Batch-level failures keep retrying with backoff.
