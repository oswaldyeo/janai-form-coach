# Janai Form Coach

An on-device, browser-based **strength tracker** with an optional **camera form
coach**. Log real weighted workouts — routines → workouts → exercises → sets
(weight × reps) — Hevy-style, and, on the lifts a phone camera can actually see,
let the on-device pose model count your reps and critique your form. Pose runs
**entirely on-device**; no video, image, landmark, or workout data ever leaves
your phone.

Grown from the `bodypark-coach` spike → a v1 camera rep-counter → this v2
tracker.

---

## What v2 adds over v1

- **Load is first-class.** Every set is `weight × reps`, entered manually by
  default. The camera only ever *pre-fills* reps you can edit.
- **Hevy-style logging loop** — multi-exercise workouts, set rows whose
  placeholders show last session's set (tick ✓ on an empty row to adopt them),
  set types (warmup / normal / drop / failure), optional RPE, a completion
  check, an automatic per-exercise rest timer, and finish/save. Finishing
  prunes unchecked sets (with a confirm if they held data) so history only
  records what was performed.
- **Crash-safe active workout** — the in-progress workout is persisted on every
  change and auto-resumed after a refresh, tab kill, or crash.
- **Routines** — a built-in *Occam-style A/B* preset, plus start-empty,
  repeat-last, and save-current-workout-as-routine.
- **History & progression** — per-workout summaries (volume, duration, sets),
  deterministic PR detection (max weight, Epley 1RM, volume), previous-value
  recall, and next-load *suggestions* for the Occam routine.
- **More exercises** — v1's five plus bench press, goblet squat, skull crusher,
  triceps pushdown, one-arm DB row (experimental camera) and cable twist
  (manual), plus manually-tracked foundational lifts (lat pulldown, leg press,
  RDL, deadlift, calf raise, plank).
- **Exercise how-to panels** — all 455 exercises in the full catalog have
  numbered setup/execution steps and form cues.
  Faithful public-domain demonstrations are bundled locally from
  `yuhonas/free-exercise-db`; exercises without a trustworthy visual match stay
  text-only rather than showing a misleading substitute.

### The camera is honest about what it can see

A single 2D camera can't see load, true depth, or rotation. Each camera-capable
lift declares a **confidence** and **view** that the UI surfaces:

| Exercise | Auto-count | Confidence | View | Notes |
|---|---|---|---|---|
| Squat / goblet squat | reliable | high | side | goblet load barely occludes the legs |
| Push-up | reliable | high | side | |
| Shoulder press | reliable | high | front | |
| Bicep curl | reliable | high | front | |
| Alternating lunge | reliable | medium | front | |
| Bench press | reliable | medium | side | far arm / rack can occlude — frame the near arm |
| Skull crusher | reliable | medium | side | counts the near arm |
| Triceps pushdown | reliable | medium | side | keep the cable stack out of frame |
| **One-arm DB row** | **proxy** | **low** | side | **experimental** — the working elbow hides behind the torso; verify the count |
| **Cable twist** | — | — | — | **manual only** — rotation is invisible to a 2D camera |

Manual weight/reps logging is always available on **every** exercise, camera or
not.

---

## Run

No build step, no dependencies to install. Any static server works; a
zero-dependency one is bundled:

```bash
cd projects/health/form-coach
npm run serve          # → http://localhost:8765
# or: python3 -m http.server 8765
```

Open the URL, tap **Start empty workout** (or a routine), add exercises, and log
sets. For real use — and for the camera coach — open it on your **phone** over
HTTPS or `localhost` (camera APIs and service workers require a secure context).
It works under a **GitHub Pages subpath** because every URL is relative.

> **First load needs network.** The pose model + MediaPipe runtime are fetched
> from a CDN on first use. After that the app shell is cached for offline launch
> (see *PWA & offline*). The tracker itself works fully offline from first load.

## Test

```bash
npm test               # node --test — 135 tests, no framework
```

The suite covers the pure engine: geometry, the rep state machine, per-exercise
calibration, the session/export schema, **catalog integrity**, the **workout
model** (volume / PR / 1RM / progression / cadence), **v1→v2 migration**
(idempotence + losslessness), **routines**, the **v2 export schema**, and
**every camera exercise end-to-end** with synthetic landmark sequences plus an
edge/failure case each.

Camera *accuracy* on real lifts is not unit-testable — see
[`QA-CHECKLIST.md`](QA-CHECKLIST.md) for the real-phone checklist per new lift.

---

## Architecture

The design rule (unchanged from v1): **all biomechanics, rep logic, and data-model
math is pure, deterministic, and unit-tested; the browser layer only does I/O**
(camera, MediaPipe, DOM, timers, storage). There is **no LLM anywhere in the
frame loop**, and none in the progression/cadence math either.

```
index.html ─ css/styles.css        mobile-first UI (dark, mint), bottom nav
│
js/app.js                          orchestration: screens, workout loop, camera coach
├── js/pose.js                     MediaPipe loader + GPU→CPU fallback (dynamic import)
├── js/interactions.js             ripple, swipe nav, drag-reorder + long-press (DOM only)
├── js/storage.js                  localStorage: workouts / routines / settings / calibration + migration guard
└── js/engine/                     ◀── PURE, TESTED, no DOM/browser APIs
    ├── geometry.js                angle / normalize / visibility / smoothing
    ├── gestures.js                swipe classification, drag drop-index math, long-press
    ├── landmarks.js               MediaPipe 33-point index map
    ├── rep-engine.js              RepEngine: progress(0..1) → rep state machine
    ├── exercises.js               biomechanics: measure() + progressFrom() + coach()
    ├── calibration.js             observed-ROM → personalised rest/peak angles
    ├── catalog.js                 exercise taxonomy (data) + camera capability blocks
    ├── workout.js                 Workout/Set model, volume, PR, 1RM, progression, cadence
    ├── migration.js               v1 history → v2 workouts (idempotent, lossless)
    ├── routines.js                routine templates + built-in Occam-style A/B
    └── session.js                 SessionRecorder + v1 & v2 export schemas
```

### The camera coach as a per-set sub-mode

The v1 frame loop is reused verbatim *inside* a workout: from an exercise card
you tap **📷 Coach**, optionally calibrate, then the loop
`measure → progressFrom → RepEngine → coach()` counts reps and logs form cues.
On **Save reps** it writes the count (and a v1-shaped `camera` provenance blob:
per-rep depth %, cadence timestamps, cues, calibration) back into the current
set and marks it done. **Weight stays manual** — the camera counts reps; the
human enters load.

### Data model & storage

```
Routine (template)  →  Workout (performed)  →  ExerciseInstance  →  Set(weight,reps,type,rpe,completed,source,side,camera?)
```

localStorage keys (v2): `workouts.v2`, `routines.v2`, `settings.v2`,
`calibration.v1` (reused as-is), a one-time `migration` guard, and the retained
`history.v1` (never deleted — rollback safety net + migration source).

### Migration (v1 → v2)

Runs once on boot, **idempotent** (guard flag + id-dedupe) and **lossless** (each
v1 session is preserved twice — as `set.camera` and `workout.legacyV1`). Corrupt
sessions are skipped and counted, never thrown. See `js/engine/migration.js`.

### Export

**Export JSON** downloads a versioned v2 document
(`schema: "janai.form-coach.workout", version: 2`) whose per-set `camera` blob
*is* the old v1 session shape, so downstream **Janai Health** depth/cue analytics
keep working. `migratedFrom` is present only if any workout was imported. The v1
`...session` export shape is retained for backward compatibility.

### Progression & cadence (deterministic, suggestions only)

- **Next-load suggestion** (Occam rule): once you hit the rep target at a clean
  cadence, add load next session (+10 lb / +10 %, whichever is greater; plate-
  rounded). Surfaced on the summary — **never auto-applied**.
- **Cadence score**: per-rep tempo derived for free from the camera timestamps,
  scored against the Occam 5/5 (10 s/rep) target.

### PWA & offline

`manifest.webmanifest` + `sw.js` make it installable and launchable full-screen.
The service worker (cache `v2`) caches the **app shell** cache-first (all v2
modules included), so the app opens offline after the first visit. **Honest
limitation:** the MediaPipe library/WASM/model load from a CDN and are cached
opportunistically — a fully cold-cache offline launch shows the UI and lets you
log manually, but can't run the camera until it's been online once.

---

## Limitations & honesty

- **Not clinical.** Heuristic form cues from 2D pose landmarks, not medical or
  professional coaching. Depth/ROM is relative to *your* calibration.
- **The Occam-style routine is a preset, not medical truth.** It's inspired by a
  *secondary-source interpretation* of Occam's Protocol (Tim Ferriss, *The
  4-Hour Body*), with practical dumbbell substitutions, and is **not verified
  against the primary book**. Presented with a disclaimer, never as clinical
  advice.
- **2D only.** A single camera can't see knee valgus, spinal rounding, rotation,
  or load. `low`/`proxy` lifts are labelled *experimental*; `none` lifts show no
  coach button at all.
- **Lite model.** Uses `pose_landmarker_lite` for phone performance.
- **Privacy is the whole point.** Everything stays on-device. No uploads, no
  social feed, no cloud replay.

## Development notes

- Pure ES modules, no bundler. The same `js/engine/*` files run in the browser
  and under `node --test`.
- No runtime dependencies. `package.json` has only scripts.
- New camera exercise = one object in `exercises.js` (`measure` +
  `progressFrom` + `coach` + `defaults` + `peakIsLow`), one catalog entry with a
  `camera` block, and one synthetic-fixture test (clean reps + one edge case).
- New manual exercise = one catalog entry with `camera: null`. Nothing else.
