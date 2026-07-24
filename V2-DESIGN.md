# Form Coach v2 — Design

**Goal:** turn the v1 single-set camera rep-counter into an integrated, Hevy-style
strength tracker (routines → workouts → exercises → sets, with weight/load),
**while keeping the on-device camera coach** as an optional per-set assist.

**Design rule (unchanged from v1):** all biomechanics, rep logic, and data-model
math stay **pure, deterministic, and unit-tested** in `js/engine/*`; the browser
layer only does I/O (camera, MediaPipe, DOM, storage). No LLM in any hot path.

**One-line framing of the shift:** v1's atom is *"one camera-counted bodyweight
set."* v2's atom is *"one logged set = weight × reps,"* entered **manually by
default**, with the camera coach as one of two ways to fill in the reps. Every
requested lift is loaded (dumbbell/barbell/cable), so **load becomes a
first-class field** and **manual entry becomes the backbone** — the camera is a
capability that some exercises have and some don't.

---

## 1. What v1 already gives us (reused verbatim)

The entire pure core survives untouched. This is the leverage that makes v2 a
small build:

| Module | Reuse in v2 | Change |
|---|---|---|
| `engine/geometry.js` | angle / normalize / visibility / smoother | none |
| `engine/landmarks.js` | 33-pt index map | none (no new landmarks needed) |
| `engine/rep-engine.js` | `RepEngine` progress→rep state machine | none |
| `engine/calibration.js` | per-exercise ROM calibration | none |
| `engine/exercises.js` | the 5 measure/progressFrom/coach objects | **grows** (new lifts) + gains a `camera` capability field |
| `engine/session.js` | `SessionRecorder` | **repurposed**: it now records *one camera-coached set*, and its `toJSON()` becomes the set's `camera` provenance sub-object |
| `pose.js`, `storage.js` | loaders / persistence | extended, not rewritten |

The v1 `SessionRecorder` is already exactly "a recorder for one set of one
exercise." In v2 it stays that — it just gets embedded *inside* a Set instead of
being the top-level history record.

---

## 2. Exercise taxonomy

v1 hardcodes 5 exercise objects. v2 needs a **catalog** — a lookup of exercise
*definitions* that carry both tracking metadata (for Hevy-style logging) and,
where applicable, the camera biomechanics.

### 2.1 Exercise definition shape

```jsonc
{
  "id": "bench-press",
  "name": "Bench press",
  "category": "push",            // push | pull | legs | core | (for filtering)
  "equipment": "barbell",        // barbell | dumbbell | cable | machine | bodyweight | kettlebell
  "primaryMuscle": "chest",      // chest | back | shoulders | triceps | biceps | quads | ... 
  "secondaryMuscles": ["triceps","shoulders"],
  "loadType": "external",        // external (weight entered) | bodyweight | assisted
  "unilateral": false,           // true → sets are per-side (row)
  "defaultRestSec": 120,

  // OPTIONAL camera block — present only if the lift is camera-trackable.
  // When absent, the exercise is manual-only (still fully first-class).
  "camera": {
    "autoCount": "reliable",     // reliable | proxy | none
    "formChecks": ["touch-depth","lockout"],
    "view": "side",              // side | front
    "confidence": "medium",      // high | medium | low  (honesty signal in UI)
    "notes": "Bench/rack can occlude the far arm; frame the working side.",
    // biomechanics (same contract as v1 exercises.js):
    "driver": "Elbow angle",
    "peakIsLow": false,
    "defaults": { "restAngle": 74, "peakAngle": 168 }
    // measure()/progressFrom()/coach() live in code, keyed by id
  }
}
```

Rationale for splitting metadata from biomechanics: the **catalog is data**
(serializable, filterable, extensible with user-created exercises later), but
`measure/progressFrom/coach` are **code** (can't be JSON). So the catalog entry
references its biomech implementation by `id`; `engine/exercises.js` remains the
registry of implementations. A manual-only exercise simply has no implementation
and a `camera.autoCount: "none"` (or no `camera` block).

### 2.2 The v2 catalog (v1 lifts + the 7 requested)

Bodyweight v1 lifts stay. `loadType: bodyweight` means the weight field is
optional/`null` and volume uses reps only.

| id | name | equip | primary | camera.autoCount | conf | view |
|---|---|---|---|---|---|---|
| squat | Squat (bodyweight) | bodyweight | quads | reliable | high | side |
| pushup | Push-up | bodyweight | chest | reliable | high | side |
| lunge | Alternating lunge | bodyweight | quads | reliable | med | front |
| bicep-curl | Bicep curl | dumbbell | biceps | reliable | high | front |
| shoulder-press | Shoulder press | dumbbell | shoulders | reliable | high | front |
| **goblet-squat** | Goblet squat | dumbbell/KB | quads | **reliable** | **high** | side |
| **bench-press** | Bench press | barbell | chest | **reliable** | **med** | side |
| **skull-crusher** | Skull crusher | barbell/DB | triceps | **reliable** | **med** | side |
| **triceps-pushdown** | Triceps pushdown | cable | triceps | **reliable** | **med** | side |
| **db-row** | One-arm DB row | dumbbell | back | **proxy** | **low** | side |
| **cable-twist** | Cable twist / woodchop | cable | core | **none** | — | — |

(See §7 for the full biomechanics feasibility analysis behind these ratings.)

---

## 3. Data model (Hevy hierarchy)

```
Routine (template, optional)
  └─ RoutineExercise[]  { exerciseId, targetSets, targetReps, targetRestSec }

Workout (a performed session)
  ├─ id, title, startedAtMs, endedAtMs, note
  └─ ExerciseInstance[]
        ├─ exerciseId
        └─ Set[]
              { weight, reps, type, rpe?, completed, source, camera? }
```

### 3.1 Set — the atom

```jsonc
{
  "weight": 60,            // number | null (null = bodyweight). Unit lives in settings.
  "reps": 8,
  "type": "normal",        // warmup | normal | drop | failure
  "rpe": null,             // optional 1..10
  "completed": true,       // the ✓ checkbox
  "source": "manual",      // manual | camera
  "side": null,            // "L" | "R" | null — set for unilateral lifts (db-row)
  "camera": null           // when source==camera: the v1 SessionRecorder.toJSON() blob
                           //   → { reps:[{index,tMs,peakProgress,depthPct}], partials,
                           //       cues:[...], calibration:{...}, counts, device }
}
```

The camera path fills `reps` from `RepEngine.count`, sets `source:"camera"`, and
attaches the full recorder JSON under `camera` for provenance (depth %, form
cues, calibration used). Weight is still prompted manually after the camera set
ends. **Camera counts reps; the human enters load.**

### 3.2 Volume & PR (pure, tested)

- **Set volume** = `(weight ?? bodyweightEstimate ?? 0) × reps`. For bodyweight
  lifts, default to reps-only volume unless a user bodyweight is set in settings.
- **Workout volume** = Σ set volume over completed sets.
- **PR detection** (per exercise, computed over history): max weight, max
  estimated 1RM (Epley: `w × (1 + reps/30)`), max reps at a given weight, max
  set volume. Stored as derived, not persisted authoritatively.

These are small pure functions in `engine/workout.js` → directly unit-testable
with no DOM.

---

## 4. Storage schema & migration

### 4.1 localStorage keys

| Key | Contents | Note |
|---|---|---|
| `janai.formcoach.workouts.v2` | `Workout[]` (history, newest-first, capped) | replaces `history.v1` |
| `janai.formcoach.routines.v2` | `Routine[]` | new |
| `janai.formcoach.calibration.v1` | `{exerciseId: calib}` | **reused as-is** — no bump needed, keyed by id |
| `janai.formcoach.settings.v2` | `{ units:"kg"\|"lb", bodyweightKg?, defaultRestSec, autoStartRest }` | new |
| `janai.formcoach.migration` | `{ v1MigratedAt, fromVersion:1 }` | migration guard |
| `janai.formcoach.history.v1` | *(left in place, untouched)* | rollback safety net |

Calibration deliberately keeps its `v1` key: its shape (`{restAngle, peakAngle,
romSpan, calibrated}` per exercise id) is unchanged and correct for v2, so
reusing it means existing users keep their calibrations for free.

### 4.2 Migration (v1 history → v2 workouts)

Runs once on boot, idempotent via the `migration` guard.

```
for each v1 session S in history.v1 (a single camera set of one exercise):
  Workout {
    id:         "w-" + S.id,
    title:      S.exerciseName,
    startedAtMs: S.startedAtMs,
    endedAtMs:   S.endedAtMs,
    note:       "Imported from v1",
    exercises: [ ExerciseInstance {
      exerciseId: S.exercise,
      sets: [ Set {
        weight:   null,                       // v1 was bodyweight-only
        reps:     S.counts.full,
        type:     "normal",
        completed: true,
        source:   "camera",
        camera:   S                           // the whole v1 session blob, lossless
      } ]
    } ],
    legacyV1: S                               // full original, for lossless re-export
  }
```

Properties:
- **Idempotent** — guard flag prevents re-run; safe on every boot.
- **Lossless** — the original v1 session is preserved twice (as `set.camera` and
  `workout.legacyV1`) so nothing is dropped and export can still emit v1 records.
- **Non-destructive** — `history.v1` is never deleted; a `Reset migration` debug
  action can re-run against it if needed.
- **Defensive** — corrupt/partial sessions are skipped and counted, not thrown.

### 4.3 Export schema v2

Bump the export document to version 2, superset of v1:

```jsonc
{
  "schema": "janai.form-coach.workout",
  "version": 2,
  "exportedAtMs": 1700000000000,
  "settings": { "units": "kg" },
  "workouts": [ /* Workout objects as above; each set.camera is a v1-shaped record */ ],
  "migratedFrom": 1            // present only if any workout was imported
}
```

Janai Health ingestion reads either: a v1 doc (`schema:"...session"`,
`version:1`, `sessions:[]`) or a v2 doc (`schema:"...workout"`, `version:2`,
`workouts:[]`). The per-set `camera` blob *is* the old v1 session shape, so
downstream depth/cue analytics keep working without change.

---

## 5. UX — screens & state flow

Reuse the v1 dark/mint shell and the existing camera **stage** (`<video>` +
`<canvas>` overlay) and **HUD** verbatim; wrap them in a workout context.

### 5.1 Screens

1. **Home / History** — list of past workouts (date · title · N exercises ·
   total volume · PR badges). Primary actions: **Start empty workout**,
   **Routines**, **Repeat last**. Export / settings in a menu.
2. **Routines** *(fast-follow — see §8)* — list templates; start-from-routine;
   "save current workout as routine."
3. **Active Workout** — the core screen:
   - Sticky header: elapsed timer, **Finish**.
   - One card per exercise. Each card = a table of set rows:
     `# · prev · kg · reps · ✓`, tap a cell to edit, ✓ to complete.
     Completing a set auto-starts the rest timer (setting-gated).
   - Per exercise card: **Add set**, and a **📷 Coach** affordance
     *only if `exercise.camera.autoCount !== "none"`* (with a confidence dot).
   - Footer: **Add exercise** → Exercise Picker.
4. **Exercise Picker** — searchable catalog; filter by muscle/equipment; each row
   shows a camera-capability badge (`📷 reliable` / `📷 proxy` / `manual`).
5. **Camera Coach (sub-mode of Active Workout)** — reuses v1 flow: optional
   calibrate → live count + form cues (existing HUD) → **End set**. On end, it
   writes `reps` + `source:"camera"` + `camera` blob back into the *current* set,
   then prompts for weight. Returns to Active Workout.
6. **Workout Summary** — duration, total volume, sets, new PRs; **Save** →
   writes the Workout, returns Home.

### 5.2 State flow

```
home ──Start empty / Repeat / from-routine──▶ activeWorkout
activeWorkout ──📷 Coach (per set)──▶ cameraCoach ──End set──▶ activeWorkout
activeWorkout ──Add exercise──▶ exercisePicker ──▶ activeWorkout
activeWorkout ──Finish──▶ summary ──Save──▶ home
```

`cameraCoach` is a nested mode that always returns to `activeWorkout` with a set
mutated — it is no longer a top-level session. The v1 modes
(`calibrating/active/paused/resting`) survive *inside* `cameraCoach`.

### 5.3 Key UX honesty rules (carried from v1's ethos)

- Camera confidence is shown, not hidden: a `low`/`proxy` lift labels the coach
  "experimental — verify the count."
- `camera:none` lifts (cable twist) show **no** coach button at all — the app
  never pretends to see a movement it can't.
- Manual entry is always available and never worse than camera; the camera only
  ever *pre-fills* reps you can edit.

---

## 6. Camera placement guide (per exercise)

Single 2D camera, phone on the floor/tripod, whole working segment in frame.

| Exercise | Placement | Why |
|---|---|---|
| goblet squat | **Side-on**, hip height, full body | knee angle + torso lean both visible |
| bench press | **Side-on**, bench level, ~2 m, working arm nearest | elbow flex/extend + wrist-to-chest depth |
| shoulder press | **Front-on**, upper body | symmetric lockout + wrist-overhead check |
| skull crusher | **Side-on**, bench level, track near arm | elbow flexion is the whole ROM; upper-arm drift visible |
| triceps pushdown | **Side-on**, working arm toward camera, clear of the stack | elbow extension + elbow-pin drift; avoids machine occlusion |
| one-arm DB row | **Side-on** to working side, low | elbow travel + flat-back line — but torso/bench clutter → low confidence |
| cable twist | *(no camera)* | rotation is depth motion; a 2D camera can't measure it |

---

## 7. Biomechanics feasibility (2D single-camera)

MediaPipe gives 2D landmarks only — **no load, no bar/dumbbell, no true depth,
and rotation about the vertical axis is largely invisible.** Ratings below are
for *auto-rep-counting* and *form-checking* from one camera.

### 7.1 Verdict table

| Exercise | Driver joint | peakIsLow | Auto-count | Form-check | Overall |
|---|---|---|---|---|---|
| **goblet squat** | knee (hip-knee-ankle) | true | **Reliable** | depth, torso lean | **HIGH** — same as v1 squat; goblet load barely occludes legs |
| **shoulder press** | elbow (sh-el-wr) | false | **Reliable** | overhead lockout | **HIGH** — already shipped & tested |
| **triceps pushdown** | elbow (sh-el-wr) | false | **Reliable** | elbow-pin drift (hip-sh-el) | **MED-HIGH** — clear side-on; cable stack can occlude → side view |
| **bench press** | elbow (sh-el-wr) | false | **Reliable** | touch depth (wrist↔shoulder), lockout | **MED** — supine, far-arm & rack occlusion; elbow flare needs a view we don't have |
| **skull crusher** | elbow (sh-el-wr) | true | **Reliable** | upper-arm drift (elbow x-stability) | **MED** — near arm occludes far; count the near arm |
| **one-arm DB row** | elbow + shoulder-extension | true | **Proxy** | flat-back line (sh-hip-knee) | **MED-LOW** — working elbow hides behind torso at top; noisy |
| **cable twist** | *(transverse rotation)* | — | **None** | — | **LOW** — rotation ≈ depth motion; only a wrist-crossing-midline *proxy* exists, form uncheckable |

### 7.2 New biomechanics implementations needed (mirror v1's contract)

Each is one object in `engine/exercises.js` (`measure` + `progressFrom` +
`coach` + `defaults` + `peakIsLow`) — the rep engine and calibration are reused
unchanged.

- **goblet-squat** — reuse squat's `measure` (knee driver, side betterSide),
  same `peakIsLow:true`. Practically an alias of `squat` with load + goblet
  torso cue. *Cheapest new exercise.*
- **bench-press** — elbow driver like shoulder-press but supine; `peakIsLow:false`
  (press-up = large angle = peak). Coach: at lockout check wrist traveled away
  from shoulder (extension) and at bottom check wrist near chest line (touch
  depth) via `wrist.y − shoulder.y`.
- **skull-crusher** — elbow driver, `peakIsLow:true` (weight at forehead = small
  angle = peak; arms straight up = rest). Coach: upper-arm should stay fixed →
  flag if elbow x drifts / `hip-shoulder-elbow` changes materially.
- **triceps-pushdown** — elbow driver, `peakIsLow:false` (arm extended down =
  large angle = peak). Coach: pin the elbow (`hip-shoulder-elbow` small & steady)
  — same pattern as bicep-curl's `upperArm` cue, inverted phase.
- **db-row** *(experimental)* — unilateral: `betterSide` already picks the
  visible working arm. Driver = elbow angle, `peakIsLow:true` (elbow flexed/
  pulled back = peak). Coach: flat-back (`shoulder-hip-knee` ≈ straight). Mark
  `camera.confidence:"low"`, `autoCount:"proxy"`; UI labels it experimental.
- **cable-twist** — **no** biomech object. Catalog entry only, `camera` omitted;
  manual-only. (A future stretch: wrist-x crossing torso midline as a rep proxy,
  but shipped off by default and never form-graded.)

No new landmarks are required — all drivers use shoulder/elbow/wrist/hip/knee/
ankle already in `landmarks.js`.

---

## 8. Staged implementation boundary

### BUILD 1 — "Hevy core + reuse the camera" *(this build — the smallest coherent v2)*

Everything needed to log a real weighted workout and keep the camera as an
assist. Scoped to land in one focused pass because the pure core is reused.

- `engine/workout.js` — Workout / ExerciseInstance / Set model + volume + PR
  (pure, tested).
- `engine/catalog.js` — exercise taxonomy (all v1 + 7 requested) with metadata +
  `camera` capability blocks.
- `engine/exercises.js` — add biomech for **goblet-squat, bench-press,
  skull-crusher, triceps-pushdown**; add `db-row` as experimental; add a
  `camera` capability field to all existing objects. (`cable-twist` = catalog
  entry only.)
- `storage.js` v2 keys + `engine/migration.js` (v1→v2, idempotent, lossless).
- `session.js` — repurpose `SessionRecorder` output to embed as `set.camera`;
  export doc → v2.
- UI: Home/History (workouts), **Active Workout** (manual weight×reps, add
  set/exercise, rest timer), Exercise Picker, Summary. Reuse camera HUD as the
  per-set **Coach** sub-mode writing reps back.
- Settings: units (kg/lb), auto-rest toggle, optional bodyweight.
- Tests: new exercise fixtures + workout-model + migration + export-v2; **all 43
  v1 tests stay green.**

**Explicitly deferred out of Build 1** (keeps scope honest):

### BUILD 2 — Routines & progression
- Routine templates: create/edit, "save workout as routine," start-from-routine.
- History analytics: per-exercise progression, PR history view, volume trends.
- Promote `db-row` from experimental once real-device data validates it; decide
  cable-twist proxy.

### BUILD 3 — Polish
- Superset grouping, drop-set UI, plate-math helper, CSV export, heavier pose
  model toggle for camera-tricky lifts (bench/row).

**Why this boundary:** Build 1 delivers the entire Hevy value proposition —
weighted sets, multi-exercise workouts, history, migration — plus every
camera-*reliable* new lift, while reusing 100% of the tested v1 engine. Routines
(Build 2) are the iconic fast-follow but their weight is UI, not model, so
splitting them keeps the first build shippable and reviewable.

---

## 9. Test strategy

Keep the zero-dependency `node --test` harness. New/extended suites:

1. **`test/helpers.js`** — add exact-angle fixtures: `gobletSquatPose` (reuse
   squat geometry), `benchPose`, `skullCrusherPose`, `pushdownPose`, `rowPose`.
   Each mirrors the v1 pattern: three points placed to yield an *exact* driving
   angle + aux points for good/bad form.
2. **`test/exercises.test.js`** — for each new camera lift, the v1 triplet:
   (a) fixture yields requested angle + correct side, (b) counts 3 clean reps
   end-to-end via `runReps`, (c) one edge/failure case (bench: no lockout →
   partial; skull-crusher: upper-arm drift → bad cue; pushdown: elbow unpinned →
   bad cue; row: occluded working arm → invalid frame). ≈ 15 new tests.
3. **`test/workout.test.js`** *(new)* — model: add exercise, add/edit/complete
   set, unilateral per-side sets, workout volume (weighted + bodyweight),
   Epley 1RM, PR detection across a history array.
4. **`test/migration.test.js`** *(new)* — v1 history → v2 workouts: shape
   correctness, **idempotence** (run twice = identical), losslessness (original
   recoverable), corrupt-session skip, empty-history no-op.
5. **`test/catalog.test.js`** *(new)* — every catalog id resolves; every exercise
   with `camera.autoCount !== "none"` has a biomech implementation; every
   `none`/manual exercise works with no `measure()` required (manual-only path).
6. **Export round-trip** — v2 export document validates (version 2, discriminator,
   `migratedFrom` present iff imported); a v2 doc containing camera sets still
   exposes v1-shaped `camera` blobs for Janai Health.

**Not unit-testable (honest boundary):** real-camera accuracy of the new lifts.
Ship a short **manual QA checklist** per exercise (correct count over 10 reps,
false-count on rest, cue fires on deliberate bad form) run on a phone — this is
the only way to validate the `medium`/`low` confidence ratings, and the ratings
in §7 are hypotheses until that runs.

---

## 10. Open decisions for Os (surface at build time)

- **Units default** — kg (assumed) vs lb.
- **Routines in Build 1 or 2?** — recommend Build 2 (UI-heavy, model already
  supports it). Build 1 ships empty-workout + repeat-last.
- **Bodyweight volume** — count reps-only, or fold in a stored bodyweight for
  push-up/squat volume? Recommend optional bodyweight in settings, reps-only
  default.
- **db-row / cable-twist camera** — ship db-row as *experimental* and cable-twist
  as *manual-only* (recommended), or hold both out of the coach entirely until
  real-device validation?
