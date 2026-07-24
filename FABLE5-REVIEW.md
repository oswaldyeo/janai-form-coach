# Fable5 Review — Form Coach v2 (2026-07-21)

Independent product/UX/code review of the v2 Hevy-style tracker, requested by Os
after the v2 build. Scope: strengthen the primary workout loop and correctness;
keep the camera coach an optional per-set assist; preserve the pure-engine
architecture and all existing features/tests. No deploy, no public-repo changes.

**Method.** Full source read (app, storage, sw, all engine modules), Hevy
Workout-tab pattern comparison (public interaction patterns only — no
proprietary code/assets, no pixel parity claimed), mobile-viewport (390×844)
headless walkthrough with screenshots of every screen, then targeted fixes with
unit tests and an automated 23-assertion browser verification of each fix.

---

## Findings (ranked)

### P0

1. **Active workout lost on refresh / tab kill / crash.** The in-progress
   workout lived only in JS memory. On a phone this is a routine event (switch
   app mid-rest, iOS reclaims the tab) and cost the entire session's logged
   sets. *Fixed* — persisted on every change, auto-resumed on boot.

### P1

2. **Finishing silently saved unchecked/empty sets into history.** A routine
   seeds target sets; finishing with some untouched saved 0-rep incomplete sets
   into history (verified in the walkthrough: summary said "2 exercises, 1
   set" and the junk set persisted). Skews nothing numerically (volume counts
   completed only) but pollutes history, "Previous" recall, and repeat-last.
   *Fixed* — finish now prunes uncompleted sets (Hevy's discard behavior), with
   a confirm when pruned sets held typed data, and a zero-completed-sets finish
   offers to discard the workout instead of saving an empty record.

3. **Routine-builder navigation dead-ends.** Closing the exercise picker during
   "+ New" routine creation forced `screen-workout` with **no active workout**
   — a zombie screen with no nav back. Completing the flow left the workout
   screen and routines tab visible simultaneously with the bottom nav hidden.
   *Fixed* — picker close returns to the active workout if one exists, else the
   tabs; the routine flow ends with an explicit return to the Routines tab.
   Both paths verified in-browser.

4. **No per-set "Previous" fast path (Hevy's core interaction).** The exercise
   card showed one per-exercise "Previous" line, but set rows had generic
   `kg` / `reps` placeholders, and ticking ✓ on an empty row logged a 0-rep
   set. Hevy's defining loop — see last session per row, tap ✓ to repeat it —
   was missing. *Fixed* — each row's placeholders now show last session's set
   *i* (new pure `previousSets()` engine fn), and ✓ on empty fields adopts
   those values before completing. Typed values always win; bodyweight lifts
   keep `BW` when no previous weight exists.

### P2

5. **Set inputs/buttons had no accessible names.** Weight/reps/RPE inputs and
   the type/side/✓ buttons were unlabeled for screen readers. *Fixed* —
   `aria-label` (+ `aria-pressed` on ✓) per row.
6. **Storage-full save failures were silent.** `saveWorkout` returns false on
   quota/private-mode failure but finish ignored it. *Fixed* — alert prompting
   an export, so a finished workout can't vanish unnoticed.
7. **Service worker shell cache version unchanged after shell edits** would
   have served stale JS to installed PWAs. *Fixed* — `formcoach-shell-v3`
   (runtime cache name kept, so the cached pose model isn't re-downloaded).
8. **`state._finished` write-only field.** Removed.

## Intentionally deferred (not high-confidence wins, or out of scope)

- **Swipe-to-delete set rows.** Hevy hides set deletion behind swipe. With
  finish-time pruning in place, an accidental "+ Add set" is now harmless, so
  the extra touch-gesture machinery (and its innerHTML-re-render fragility)
  isn't worth it yet.
- **Compacting the rest overlay into a slim bar.** It's already a non-modal
  bottom sheet; the workout list stays interactive above it. Cosmetic only.
- **Per-exercise rest override & user default-rest precedence.** Catalog
  defaults currently beat the user's settings value; defensible, but the right
  fix (per-exercise user overrides, Hevy-style) is a feature, not a repair.
- **Exercise reorder UI.** `reorderExercise()` exists in the engine, untested
  drag-and-drop on innerHTML rows is exactly the kind of fragility to avoid.
- **Workout notes / editable title mid-workout, history detail drill-in.**
  Real features; none block the core loop.
- **`maximum-scale=1` viewport** (blocks pinch-zoom, an a11y trade-off made to
  stop iOS input auto-zoom). Left as-is deliberately.

## UX rationale (before → after)

Before, the fastest possible "same as last week" session required typing every
weight and rep count by hand, and the price of a mid-session refresh was the
whole workout. After: start a routine → each row already shows last session's
numbers as placeholders → tick ✓ per set (rest timer auto-starts) → Finish, and
history contains exactly what was performed. That is the Hevy loop: minimum
taps for the common case, typing only when something changed. The camera coach
is untouched: still a per-exercise 📷 button on supported lifts (with honesty
badges), never a separate journey.

## Changes applied (files)

| File | Change |
|---|---|
| `js/engine/workout.js` | + `previousSets()`, + `pruneIncompleteSets()` (pure) |
| `js/storage.js` | + `loadActiveWorkout` / `saveActiveWorkout` / `clearActiveWorkout` (`janai.formcoach.active.v2`) |
| `js/app.js` | active-workout persistence funnel + boot resume; finish prune/guards + save-failure alert; per-row previous placeholders + ✓-adopt; picker/routine-flow navigation fixes; aria labels; removed dead field |
| `sw.js` | shell cache → `formcoach-shell-v3` |
| `test/workout.test.js` | +4 tests (previousSets ×2, pruneIncompleteSets ×2) |
| `README.md` | feature notes + test count 103→107 |
| `package.json` | version 2.1.0 |
| `qa-shots-fable5/` | curated mobile screenshots (evidence below) |

## Verification evidence

- `npm test` — **107/107 pass** (was 103; +4 new engine tests).
- `MOBILE=1 node scripts/headless-check.js http://localhost:8771/` — **PASS**
  from a fresh profile; only the known non-fatal MediaPipe GPU-fallback log.
- Automated browser verification (CDP, mobile emulation, fresh profile) —
  **23/23 assertions pass**: placeholder values, ✓-adopt, rest auto-start,
  reload-resume with data intact, finish pruning, active-snapshot lifecycle,
  empty-finish discard, both routine-builder navigation paths, routine save.
- `git diff --check` — clean.
- Screenshots: `qa-shots-fable5/` — `01-home`, `04-workout-occam-a` (exercise
  cards + optional 📷 Coach buttons), `05-picker`, `07-set-done-rest`,
  `09-summary` (pre-fix baseline), `11-adopt-previous` and
  `12-resumed-after-reload` (post-fix behavior). Full sets also in
  `/tmp/fc-shots-before/` and `/tmp/fc-shots-after/` (ephemeral).

## Remaining known risks

- **Camera-lift accuracy on real phones is still unproven** — the
  `QA-CHECKLIST.md` real-device pass (10-rep counts, false-count holds, cue
  firing) has not been run; confidence ratings remain hypotheses.
- **✓-adopt uses last session's set at the same index.** If today's set count
  differs from last session's, later rows have no previous and fall back to
  manual entry — correct, but the placeholder column "shifts" if warmup
  patterns change between sessions.
- **Auto-resume has no staleness cutoff.** A workout abandoned days ago
  resumes on next open (with its original start time); Cancel clears it. Kept
  deliberately simple — data loss is worse than a stale resume.
- **localStorage remains the only store** (~5 MB). Camera provenance blobs are
  the main consumers; the 300-workout cap bounds it, but heavy camera use
  could approach quota — the new save-failure alert at least makes that
  visible.
