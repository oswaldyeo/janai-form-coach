# Live-workout UX — add mid-workout, routine update on finish, recents first

Branch: `janai/devin-live-workout-ux` (off `main` @ `054327a`).

## 1. Add exercises mid-workout

**What was there.** The active-workout screen already had `+ Add exercise` →
picker → `pickExercise()`. But the new exercise was seeded with
`seedSetsFromHistory()`, which **pre-fills** last session's weight/reps as real
values. That caused two problems:

- An untouched pre-filled row looks like typed data. `finishWorkout()` counts
  unchecked rows that hold data, so skipping the exercise you just added
  triggered "N unchecked sets will be discarded. Finish anyway?". The app was
  warning about data the user never entered.
- It didn't match the rest of the logging loop, where last session's numbers
  appear as **placeholders** and ✓ on an empty row adopts them.

After picking, the user also landed wherever the workout screen happened to be
scrolled, often with the new card off-screen.

**Change.**
- New pure `placeholderSetsFromHistory()` (`js/engine/workout.js`) gives one
  **empty**, uncompleted row per set of the last session. Only set type and side
  carry over. The existing `setRow()` placeholders and the ✓ adoption path
  (`previousSets()[si]`) then work unchanged. A never-logged exercise gets one
  blank row.
- `pickExercise()` uses it, scrolls the new card into view, and gives it a
  one-off highlight (`.just-added`). Reduced-motion users get no animation
  because the global reduce rule covers it.
- Crash safety: `renderWorkout()` → `updateWorkoutHead()` → `persistActive()`
  already persists every mutation, so the added exercise survives a reload.
  `makeWorkout()` now also carries `routineDayKey` (see §2), so a resumed
  workout keeps its routine origin.
- Routine starts still pre-fill values (v45 behaviour). I left them alone
  because the brief only covered mid-workout adds. Note that the same "unchecked
  sets will be discarded" warning fires for untouched rows seeded from a routine.

## 2. Routine update prompt on finish

**Root cause of the gap.** A workout only recorded `routineId`, not which day
started it. `repeatWorkout()` also copies `routineId`, so "came from a routine"
couldn't be told apart from "repeated a past workout".

**Change.**
- `routineToWorkout()` stamps `routineDayKey`, and `makeWorkout()` keeps it.
  Repeat-last and the WOD never set it, so a set `routineDayKey` means "started
  from this routine day".
- Pure helpers in `js/engine/routines.js`:
  - `routineAdditions(finished, routine)` returns the exercises in the
    **pruned** workout that the started day lacks. They are deduped, in workout
    order, and must have a completed set, so an exercise added and then never
    done isn't offered. The result is `[]` if the workout isn't from that
    routine, has no day key, or the routine is gone.
  - `addExercisesToRoutine(routine, dayKey, workout, ids)` appends them to that
    day as per-set templates built from the completed sets, then re-normalises
    with `makeRoutine()`. The input routine isn't modified.
  - `routineUpdatePrompt(names)` returns "Add A, B and C to this routine?"
- `finishWorkout()` prunes, then `offerRoutineUpdate(finished)` asks **once**
  with every name in a single `confirm()`. This happens after the existing
  discard confirm, so cancelling there never shows the prompt. **Yes** →
  `saveRoutine()`. **No** → the routine is untouched. Either way the workout
  saves exactly as before.
- Built-in presets live in code and can't be stored over. For these, **Yes**
  saves a personal copy, "<name> (mine)", under *Your routines*, and the prompt
  says so on a second line. I chose this over overriding the built-in by id,
  which would silently freeze the user on an old copy of a curated or physio
  programme.
- Comparison is per **day**, not the whole routine. Adding Day B's bench press
  to a Day A session offers it for Day A, which is where the user just did it.
- Edge case: a workout resumed after a crash that was *started before this
  change* has no `routineDayKey`, so it won't prompt.

## 3. Recents first in the picker

- New pure `recentExerciseIds(history, { limit = 8 })` (`workout.js`) returns
  distinct exercise ids, newest workout first. It sorts by
  `endedAtMs ?? startedAtMs` instead of trusting storage order, keeps the
  exercise order within a workout, and counts only exercises with a completed
  set.
- New pure `recentsFirst(results, recentIds)` (`catalog.js`) splits the
  **already searched/filtered** results into `{ recent, rest }`. `rest` keeps
  `searchCatalog()` order. Search and filters still run over the whole catalog,
  and recents only reorder the matches. A recent exercise that doesn't match the
  query isn't shown.
- `renderPicker()` shows a "Recent" section, then "All exercises". With no
  history it falls back to the old flat list. The count still shows the total
  number of matches. The same picker serves the routine builder, so it gets
  recents too.

## Tests

- `test/live-workout-ux.test.js`: 15 tests covering the three behaviours, all
  pure logic. It includes a persist/resume round trip and the no-prompt cases
  (nothing added, empty workout, repeat-last, other routine, added but not done).
- **Brief vs repo mismatch:** the public repo has **no `test/` directory or
  `package.json`** on `main`, even though the README says `npm test`. I added
  `package.json` byte-identical to the private monorepo copy
  (`"test": "node --test"`) so `npm test` works here.
- To check the "existing tests pass" requirement, I ran the monorepo's
  existing suite (226 tests, same `js/` tree) against this branch: **241/241
  pass** (226 existing + 15 new). That suite isn't committed here because it
  contains personal routine data.
- I also ran a headless-Chrome phone-viewport (390×844) smoke test. Steps:
  1. Start a custom routine.
  2. The picker shows Recent (newest first).
  3. Add an exercise: empty rows, last-session placeholders.
  4. Reload: the exercise is resumed.
  5. ✓ adopts the placeholders.
  6. Finish → a single "Add Lat pulldown to this routine?" → Yes updates the
     stored routine.
  7. No leaves it unchanged and still saves.
  8. Nothing added → no prompt.
  9. Empty workout → no prompt.
  10. Built-in + Yes → "Occam-style A/B (mine)" is saved.
- `sw.js` shell cache: `v46` → `v47`. `app.js?v=28` → `v=29` in `index.html`
  and `sw.js`.

## Expected merge conflicts with sibling branches

I did not inspect `janai/devin-save-integrity` or `janai/devin-auto-sync`. These
predictions come only from what the brief says they touch (the finish/save flow
and the active-workout page):

| File | This branch touches | Conflict risk |
|---|---|---|
| `js/app.js` | `finishWorkout()` (prune moved above `endRest()`, new `offerRoutineUpdate()` call), new `offerRoutineUpdate()` / `findRoutine()`, `startRoutine()`, `pickExercise()`, `renderPicker()`, import lists from `workout.js` / `catalog.js` / `routines.js` | **High.** Both siblings edit the finish/save flow and the active-workout page. Keep the order: discard confirm → prune → routine prompt → save. The prompt must use the pruned workout. |
| `js/engine/workout.js` | `makeWorkout()` (+`routineDayKey`), new `placeholderSetsFromHistory()` / `recentExerciseIds()` inserted after `seedSetsFromHistory()` | **Medium-high.** Save-integrity may change recall/`previousSets()` ordering, and both branches insert next to it. |
| `sw.js` | `SHELL_CACHE` v47, `app.js?v=29` | **High.** Every branch bumps the same lines; take the highest version and bump once more after merging. |
| `index.html` | `app.js?v=29` | **High.** Same as `sw.js`. |
| `REPORT.md` | new file | **Certain** if siblings also add one (add/add). Concatenate the reports. |
| `package.json` | new file, copied verbatim from the monorepo | Low if a sibling adds the identical file; otherwise an add/add conflict. |
| `css/styles.css` | 5 lines after `.pick-howto` | Low. |
| `js/engine/routines.js` | `routineToWorkout()` (+`routineDayKey`), new helpers appended after it | Low–medium. |
| `js/engine/catalog.js` | `recentsFirst()` appended at EOF | Low. |
| `test/live-workout-ux.test.js` | new file | None unless the names collide. |

After merging all three, run `npm test` plus the monorepo suite. Then check by
hand: finish a routine workout with an added exercise and confirm the prompt
appears once, the routine updates, and the save is verified/synced.
