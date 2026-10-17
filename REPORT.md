# Save-integrity investigation — `janai/devin-save-integrity`

Reported bug: a lift logged in the previous session was not recalled at the next session.
Per instructions, each suspected loss path was reproduced as a failing test **before** any fix
(`node --test`; pre-fix run: **25 fail / 9 pass**, post-fix: **34 / 34 pass**).
All fixtures are synthetic round numbers; no personal data or real workout values are in the repo.

Line numbers marked `main:` refer to the code before this branch (`git show main:<file>`).

## Note on the "existing test suite"

The README advertises `npm test` with 233 tests in `test/`, but this repository has no `test/`
directory and no `package.json` anywhere in its 38-commit history. There was no existing suite to
run. This branch adds `package.json` (scripts only, zero dependencies) and `test/`:

| file | covers |
| --- | --- |
| `test/baseline.test.js` | characterisation of pre-existing engine behaviour (green before and after) |
| `test/integrity-storage.test.js` | verified writes, quota, finish transaction, upsert, boot resume, migration guard, outbox states |
| `test/integrity-workout.test.js` | recall ordering, numeric PRs, typed-but-unticked sets, last-session summary, sibling-exercise history |
| `test/integrity-wod.test.js` | WOD progression with string-typed history |
| `test/helpers/memory-storage.js` | in-memory `localStorage` that can throw `QuotaExceededError`, fail per key, or silently drop writes |

## Root causes (ordered by likelihood for the reported bug)

### 1. Starting a new workout silently replaced the unfinished one (the auto-resume overwrite)
- `main:js/app.js:374, 382, 391, 397, 255` — every start path (`startEmptyWorkout`, `startOccam`,
  `startRoutine`, `startRepeatLast`, `startWOD`) assigned `state.workout = …` without checking for a
  workout already in progress.
- `main:js/app.js:413-419` — the next `persistActive()` then overwrote `janai.formcoach.active.v2`, the
  only copy of the unfinished session.
- `main:js/app.js:463` — Finish is disabled until a set is **ticked**, so a session where the lifter typed
  loads but did not tick could not be finished at all. It is auto-resumed on next launch
  (`main:js/app.js:1739-1744`); tapping Back and then "Start today's workout" destroyed it without a prompt.
  It never reached history, so nothing could be recalled.
- **Fix:** `beginWorkout()` / `settleUnfinishedWorkout()` (`js/app.js:376-406`). If the current workout has
  logged work (`hasLoggedWork`, `js/engine/workout.js`), the lifter is asked to save it to history first
  (or go back to it). Finish is enabled as soon as a set has typed values. Resuming a workout older than 6 h
  now shows a toast telling the lifter to finish it.
- **Repro/proof:** `hasLoggedWork` test, plus a browser smoke run: typing a load into an unticked row,
  leaving, and starting another workout now produces a saved history entry.

### 2. Finish pruned typed-but-unticked sets behind a habituated prompt
- `main:js/engine/workout.js:339-344` — `pruneIncompleteSets` keeps only `completed` sets.
- `main:js/app.js:930-936` — the guard counted every unticked row that "has data". Routine and history
  seeding pre-fills **every** row (`seedWorkoutFromHistory`), so the prompt "N unchecked sets will be
  discarded" appeared on almost every finish and got OK'd by habit. That drops new loads that were typed
  but not ticked, and the next session recalls the older values.
- **Fix:** sets typed into by the lifter are flagged `edited` (UI-only; stripped before saving).
  `uncheckedSetsSummary()` / `completeEditedSets()` (`js/engine/workout.js:392+`). Finish now asks
  specifically about *typed* unticked sets (OK = save them as completed, Cancel = go back). Untouched
  pre-filled rows are still dropped without a prompt.
- **Repro/proof:** `finish: typed-but-unticked sets are distinguished from untouched pre-filled rows`.

### 3. Silent storage failures and a non-atomic finish
- `main:js/storage.js:44-45` — `setItem`/`removeItem` swallowed every exception and returned `false`.
  Nothing read the write back.
- `main:js/app.js:942-945` — on a failed history write the app showed an `alert`, then **still** queued
  the workout, **cleared the active copy** (`discardActive`), and showed the summary. A quota failure at
  finish therefore deleted the only copy of the session.
- `main:js/app.js:413-418` — `persistActive` set `lastPersisted` *before* the write, so a failed
  crash-recovery write was never retried for identical content.
- `main:js/storage.js:203-204` — the v1→v2 migration guard was set even when the migrated history failed
  to save, so that history was never retried.
- `main:js/storage.js:85` — `saveWorkouts` silently dropped everything past 300 workouts.
- `main:js/storage.js:80` + `:92` — an unparseable workouts blob read as `[]`, so the next save replaced the
  whole history with one workout.
- **Fix (`js/storage.js`):** every write is read back and compared byte-for-byte (`setItem`, line 74).
  Failures are classified (`quota` / `unavailable` / `verify` / `corrupt`), recorded per key, and exposed
  through `storageHealth()` and `onStorageError()`. The app shows a pinned red `#storage-alert` banner,
  which clears when the key writes successfully again. `commitFinishedWorkout()` (line 185) writes and
  verifies history **first**, then queues delivery and clears the active copy; on failure nothing is
  touched, the workout stays open, and the lifter is offered a JSON download of it.
  `persistActiveWorkout()` (line 230) only remembers writes that landed. `saveWorkout` upserts by id.
  The migration guard is only set after a successful write. The silent 300 cap is removed (a full disk now
  fails loudly instead). A corrupt blob is stashed under `janai.formcoach.workouts.v2.corrupt` before being
  replaced.
- **Repro/proof:** the quota, read-back, recovery, finish-under-quota, retry, migration-guard, corrupt-blob
  and truncation tests in `test/integrity-storage.test.js`.

### 4. Recall, PR and progression lookups trusted array order and types
- `main:js/engine/workout.js:280-283, 346-347` — `previousSets` / `lastPerformance` were
  "newest-first assumed". But `mergeWorkouts` re-sorts by `startedAtMs` (`main:js/engine/backup.js:61`) on
  every cloud pull or import, and a crash-resumed workout keeps its original start. So array position ≠
  recency, and the placeholders and pre-fills could come from an older session.
- `main:js/engine/workout.js:170, 192, 253` — PR comparisons used raw `s.weight`. Cloud rows are stored
  unnormalised (`main:js/engine/cloud.js:27`), so `"100" > "30"` is a string comparison.
  `newPRsInWorkout` also counted a re-saved copy of the candidate against itself.
- `main:js/engine/wod.js:120,126` — `Number.isFinite` filters dropped string-typed sets, so the WOD
  silently fell back to the baseline routine's loads instead of last session's.
- `main:js/app.js:215-216` — the cached WOD was never rebuilt after a finish (only at midnight).
- **Fix:** `byRecency()` / `workoutTimeMs()` (`js/engine/workout.js:299`) order by the later of end and
  start time. `previousSets`, `lastPerformance` and `lastSessionSummary` use them, and the app keeps
  `state.history` recency-sorted (`reloadHistory`, `js/app.js:132`), so PR badges and "Repeat last" are
  correct too. `numericSet()` coerces in PR, series and WOD code. The cached WOD is invalidated after any
  history write.
- **Repro/proof:** the `previousSets follows recency`, `recency uses endedAtMs`, PR, re-saved-copy and WOD
  string tests.

### 5. Same movement, different catalog id (makes "missing" history look like a bug)
The catalog has the local `bench-press` = "Bench press (dumbbell)" alongside Hevy entries such as
"Bench Press (Barbell)" (`js/engine/hevy-catalog.js`), and the built-in routines use `bench-press`
(`js/engine/routines.js:63`). A load logged under one id is never recalled under the other. The old UI
then showed "Previous: first time" with no hint. `relatedHistoryIds()` now detects same-name siblings,
and the card says "No history for this exact exercise — last logged as …". This is a likely cause if
the lift was logged from the picker rather than the routine. It could not be confirmed without the
device's data.

### 6. The outbox could never show non-delivery
- `main:js/app.js:1514, 1532` — `markDelivered` ran as soon as the share sheet resolved, and
  "optimistically" right after a download was triggered (`:1525`). Neither proves the iOS Shortcut stored
  the file, so the app's own outbox emptied itself while the receiver got nothing. That matches telemetry
  showing zero deliveries.
- `main:index.html:109`, `main:js/app.js:1540-1541` — the only indicator was a hidden button on the
  History tab.
- **Fix:** outbox entries now go *unsent → handed off (unconfirmed) → received*. `markHandedOff()` and
  `outboxStatus()` live in `js/storage.js:323, 336`. Orphaned ids (workout no longer in history) are
  counted separately, not as pending. Home has an `#outbox-card` showing the count, the unsent/unconfirmed
  split and the oldest date, with **Send now** and **Mark received** buttons. Unconfirmed workouts stay in
  `pendingWorkouts()`, so re-sending is safe (the receiver dedupes by id).

## Other changes
- Per-exercise **Last session** strip on every exercise card (`lastSessionLine`, `js/app.js:536`): date,
  top working set (warm-ups excluded) and set count, or "none recorded — first time", or the sibling-id
  warning.
- A `storage` event listener refreshes history and the outbox when another tab/window writes.
- Cache busting: `sw.js` shell `v46 → v47`, `app.js?v=29`, `wod.js?v=25`.
- No new network calls, frameworks or build step.

## How it was verified
- `npm test`: 34/34 pass (25 of them failed before the fixes).
- Headless Chrome smoke run against `python3 -m http.server`, with synthetic data:
  - The Last-session strip shows the seeded set.
  - Home outbox card shows "1 workout not delivered".
  - Typing into an unticked row and then starting another workout prompts, and saves the typed set.
  - With `Storage.prototype.setItem` forced to throw `QuotaExceededError`, Finish keeps the workout open
    and keeps the active copy, and the red banner appears. After restoring storage, Finish succeeds and
    the banner clears.
  - Download-fallback send leaves the workouts as "shared, not confirmed", and "Mark received" clears them.
  - The next session's strip shows the newly finished set.

## LOCAL-CHECKS (only testable on the real device)
1. **iOS Shortcut share flow:**
   1. Finish a workout → Send now → pick the "Save to Form Coach" Shortcut. Confirm the file lands in the
      iCloud inbox and the Mac launchd watcher ingests it.
   2. Then tap **Mark received** and confirm the Home card clears.
   3. Also check what `navigator.share` does when the Shortcut fails or is dismissed after the target is
      chosen. On iOS the promise may still resolve, which is why entries now stay "unconfirmed".
2. **Why zero deliveries since July:** check on the receiver side (Shortcut still installed and named
   the same, iCloud folder path, launchd watcher running, ingest logs). The app previously cleared the
   outbox on share, so the app cannot tell which side failed.
3. **Real quota behaviour on iOS Safari/WebKit:** fill storage, finish a workout, and confirm the red banner
   and the "NOT saved — download a copy" prompt. WebKit's exception name and code should match
   `QuotaExceededError` / 22.
4. **Separate storage containers:** a Home-Screen PWA and a Safari tab on iOS have separate
   `localStorage`. History logged in one is invisible in the other, which looks exactly like "last
   session not recalled". Confirm the lifter always uses the same one.
5. **Eviction:** Safari can evict script-writable storage for sites (not installed PWAs) that go unused for
   7 days. Check the status pill reports `storage: persistent` after `navigator.storage.persist()`.
6. **Existing on-device data:** look at the device's `janai.formcoach.workouts.v2` for the reported session.
   - If the lift is missing, it was lost before saving (causes 1–3).
   - If it is under a Hevy bench id, it is cause 5.
   - If it is present but older sessions are recalled, it is cause 4.
   - If `janai.formcoach.active.v2` holds an old unfinished session, it is cause 1. On next launch the
     resume toast will offer to finish it.
7. **Service-worker update:** after deploy, confirm the installed PWA picks up shell `v47` (the Last
   session strip and Home outbox card are visible).

---

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
