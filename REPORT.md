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
