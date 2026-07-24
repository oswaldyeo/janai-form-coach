# Form Coach — Product Research (v2 expansion)

**Date:** 2026-07-22
**Scope:** Evidence base for expanding `projects/health/form-coach/` from a camera-only
rep-counter into a structured strength-training companion. No application code was changed.
**Source trust:** All web content below is treated as untrusted marketing/secondary
material. Facts are labelled **[FACT]** (stated by a primary/official or well-corroborated
source) vs **[REC]** (my inference/recommendation). Where sources conflict or are
paywalled, that is called out explicitly.

---

## 0. What Form Coach is today (baseline)

- Camera-only PWA. On-device MediaPipe pose → per-frame driving angle → `progress ∈ [0,1]`
  → hysteresis rep state machine → one deterministic form cue. No LLM in the frame loop.
- 5 exercises (squat, push-up, alt lunge, bicep curl, shoulder press).
- Per-exercise calibration (observed ROM → personal rest/peak angles).
- Session export schema `janai.form-coach.session` v1: reps (with depth%), partials, cues,
  calibration, device. History in `localStorage`.
- **Gaps vs a real training tool:** no *load/weight* tracking, no *program/routine*
  structure, no *progression* logic, no *previous-session recall*, no *rest timer*, no
  *PR detection*, no multi-exercise workout concept. It counts and critiques reps; it does
  not tell you what to do, how heavy, or whether you're improving over weeks.

The three researched products map cleanly onto those gaps: **BodyPark** = the camera-coach
ceiling (what "good" looks like for on-device motion feedback), **Occam's Protocol** = a
concrete, minimalist *program* to wrap the reps in, **Hevy** = the *tracking/logging UX*
patterns that make a strength app sticky.

---

## 1. BodyPark ATOM — the camera-coach reference

BodyPark ATOM is a dedicated hardware device (a pocket camera + AMOLED display, ~155 g) plus
companion app — the most-backed AI fitness product on Kickstarter. It is the closest
commercial analogue to Form Coach's *live motion feedback* half, executed with dedicated
hardware rather than a phone camera.

### [FACT] Capabilities (official site + PR + Kickstarter coverage)
- **Pose engine:** BodyPark "DeepBody™ Engine", **34+ skeletal keypoints**, claimed
  **96% pose-estimation accuracy**, real-time. Includes a proprietary lumbar **"Lumbus"**
  point for lower-back/posture analysis — a point standard 33-point MediaPipe does **not**
  expose.
- **Camera:** 160° ultra-wide, 1/2.8" CMOS; auto-tilt head (5–40°) keeps the user centered
  at arm's length — solves the framing problem manually.
- **Exercise library:** **1,000+ exercises** across strength, calisthenics, functional.
- **Counting:** reps *and* sets, automatically.
- **Advanced per-set metrics:** **range of motion, power, velocity, displacement** — surfaced
  after each set as "advanced stats."
- **Voice feedback:** proactive spoken cues, concrete and imperative — examples quoted by
  press: *"Squat lower," "Take a step back," "Chest up."*
- **Video replay:** instant replay of your own set after each set to self-diagnose.
- **Gamification:** scoring system + emoji reactions ("workouts are fun").
- **Post-set summary:** grades how well you performed, then lets you drill into the stats.

Sources: [bodypark.fit](https://www.bodypark.fit/) ·
[Kickstarter](https://www.kickstarter.com/projects/bodypark/bodypark-atom-the-worlds-first-ai-fitness-companion) ·
[PR Newswire launch](https://www.prnewswire.com/news-releases/bodypark-launches-atom-the-worlds-first-ai-fitness-companion-bringing-professional-motion-intelligence-to-everyday-strength-training-302622848.html) ·
[Geeky Gadgets](https://www.geeky-gadgets.com/bodypark-atom/) ·
[refractor.io](https://refractor.io/fitness/bodypark-atom-ai-portable-fitness-feedback/)

### What's transferable to Form Coach (no hardware)
- **[REC] Post-set advanced metrics from the same landmarks we already have.** ROM we
  already compute (calibration span). Velocity/tempo and rep-duration are derivable from the
  frame timestamps + progress signal *at zero extra sensing cost* — this is low-hanging fruit
  that makes the session summary feel "pro" without new models.
- **[REC] Imperative, concrete voice cues** ("Squat lower") over vague ones. Our `coach()`
  already emits one deterministic cue; the lesson is phrasing + timing, not more cues.
- **[REC] Instant self-replay.** A short buffered clip of the *worst-form rep* would be
  genuinely useful and is technically feasible in-browser (MediaRecorder over a ring buffer),
  **but** it conflicts with our privacy stance (nothing leaves the device) — it must stay
  local-only and opt-in. See "What NOT to copy."

### [FACT] Honest limits of the comparison
- ATOM's 96% accuracy and the "Lumbus" lumbar point come from **dedicated hardware + a
  proprietary model**. Form Coach runs `pose_landmarker_lite` (33 points, no lumbar point) on
  a phone. **Do not claim parity on accuracy or back angle.** Our README already scopes this
  honestly; keep it that way.

---

## 2. Occam's Protocol — a concrete program to wrap the reps in

From Tim Ferriss, *The 4-Hour Body*. A minimalist hypertrophy program: **two alternating
full-body workouts (A/B), ~2 exercises each, one set to failure per exercise, super-slow
cadence, trained infrequently.** It is an unusually good fit for Form Coach because the whole
program is *rep-quality and cadence driven* — exactly what a camera can measure — and the
exercise list overlaps heavily with what we already track.

### 2.1 Canonical spec (corroborated across multiple secondary sources)

> Note: I could not read the book directly; the exact numbers below are corroborated across
> ≥3 independent write-ups. Where a widely-repeated number lacks strong corroboration it's
> flagged. **Before shipping this as prescriptive, verify against the physical book** (see
> "Verification debt").

**Workout A (machine version)** — [FACT, corroborated]
1. Close-grip **supinated (palms-toward-you) pull-down** — target ~7 reps
2. **Shoulder press** (machine) — target ~7 reps
3. *Optional abs:* myotatic crunch, "cat vomit"

**Workout B (machine version)** — [FACT, corroborated]
1. **Slight-incline bench press** (incline/decline ≤ ~20°) — target ~7 reps
2. **Leg press** — target ~10 reps *(legs use a 10-rep target, upper body 7)*
3. *Optional:* 50 kettlebell swings; ~3 min stationary bike @ 85+ rpm; abs

**Free-weight variant ("Occam's Protocol II")** — [FACT, corroborated]
- Workout A: **Yates row** (bent, underhand) + **standing barbell overhead press**
- Workout B: **bench press** + **weighted squat** (replaces leg press)

**Cadence / tempo** — [FACT, strongly corroborated]
- **5/5**: 5 seconds up, 5 seconds down. No pause, no lockout rest, no momentum.
- One set **to failure**. Time-under-tension works out to **~70 seconds** per set
  (≈7 reps × 10 s). This is why the rep *target* is ~7 — it's a proxy for the TUT.

**Rest** — [FACT, corroborated]
- **Between reps:** none (continuous tension).
- **Between exercises:** ~3 minutes.
- **Between workouts:** start at **2 days** between A and B; extend to **3 days (then more)**
  as you get stronger / bodyweight rises. The program deliberately trains *less* over time.

**Progression rule** — [FACT, corroborated]
- When you **hit or exceed ~7 reps** (10 for leg press) at a clean 5/5 cadence, **add weight
  next session**: the widely-repeated increment is **+10 lbs or +10%, whichever is greater**.
- Ferriss's discipline note: if you can't hit target reps, **stop and leave** — don't grind
  junk volume.

Sources: [Shortform](https://www.shortform.com/blog/occams-protocol/) ·
[thehealthprocess.co.uk](https://thehealthprocess.co.uk/how-to-add-11lbs-of-muscle-in-28-days-occams-protocol.html) ·
[occamsprotocol.com](https://www.occamsprotocol.com/) ·
[Jason Kwan / Medium](https://jasonkwanhc.medium.com/the-benefits-are-extraordinary-b263ab934c11) ·
[blas.com book notes](https://blas.com/the-4-hour-body/)

### 2.2 [FACT] Source-conflict flags (do not silently "clean up")
- The first web summary folded in **kettlebell swings + 3-min bike** as if core to Workout B.
  Corroborating sources treat these as **optional finishers**, not the two prescribed lifts.
  Treat A/B as **2 core lifts each**; everything else is optional.
- "At least 7" vs "exactly 7": the target is a **progression trigger**, not a cap — you go to
  failure; hitting 7 clean means "add weight next time."
- Leg press rep target (**10**, not 7) is corroborated but easy to get wrong — keep the split.

### 2.3 [REC] Equipment substitution for a dumbbell/cable/machine gym

Occam's assumes specific machines. Os's context is a general commercial gym. Map each
canonical lift to the closest DB/cable equivalent that **preserves the 5/5, single-set-to-
failure intent** and, where possible, an exercise **Form Coach can already or plausibly
track**:

| Occam's canonical | DB / cable substitute | Coachable by Form Coach today? |
|---|---|---|
| Close-grip supinated pull-down | **Supinated (underhand) cable pulldown**, or single-arm DB row, or supinated inverted row | Partial — pull is trackable via elbow/torso angle (new exercise) |
| Machine shoulder press | **Seated DB shoulder press** | **Yes** — we already track shoulder press |
| Slight-incline bench press | **Incline DB bench press** | Partial — similar mechanics to push-up press pattern |
| Leg press | **Goblet squat** or DB/barbell **back squat** | **Yes** — we already track squat |
| (free-weight) Yates row | **Bent-over DB row, underhand** | New exercise |
| (free-weight) OH press | **Standing DB overhead press** | **Yes** (= shoulder press) |
| (free-weight) weighted squat | **Goblet / back squat** | **Yes** |

**[REC] Practical MVP mapping:** a shippable "Occam's-style" 2-day split using *only what we
track today* = **Day A:** DB shoulder press + (new) supinated row; **Day B:** incline DB press
(or push-up as bodyweight fallback) + goblet squat. This lets us ship the *program wrapper*
before building new pose models.

---

## 3. Hevy — the tracking/logging UX to steal (patterns, not code)

Hevy is the market-leading strength logger. Its reputation is built on **doing the boring
logging loop extremely well** — not on novelty. The patterns below are the durable UX lessons.

### [FACT] Feature inventory (official features page)
- **Logging:** empty workout or from template; add/remove sets; **previous-session values
  auto-populate** every set (the single most-cited "must-have"); per-exercise notes;
  **live PR notifications** mid-workout; Live Activity.
- **Rest timer:** **automatic**, **per-exercise customizable**, fires after each logged set —
  no separate timer app.
- **Routines/programs:** folders of routines; built-in routine library (Starting Strength,
  PPL, etc.) addable in one tap; custom exercises; shareable routines.
- **Advanced set tools:** **warm-up set calculator**, **weight-plate calculator**,
  **RPE** and **RIR** support, **supersets** / multiple set types.
- **Analytics:** monthly reports, per-muscle-group charts, **sets-per-muscle-group-per-week**,
  body measurements, progress photos, per-exercise history charts, **consistency/streaks**,
  year-in-review.
- **Social:** feed, profiles, leaderboards, shareable cards.
- **Integrations:** Strava, Apple Watch, home-screen widgets.
- **AI:** "HevyGPT" assistant (secondary, not core).

Sources: [hevyapp.com/features](https://www.hevyapp.com/features/) ·
[App Store listing](https://apps.apple.com/us/app/hevy-workout-tracker-gym-log/id1458862350) ·
[RepReturn review](https://repreturn.com/hevy-app-review/)

### [REC] The high-signal patterns for Form Coach
1. **Previous-value autofill** is the keystone habit feature. Our export schema already stores
   per-rep depth and calibration; extend it to **load (weight)** and echo "last session: 3×7 @
   20 kg, depth 92%" at set start. This is the cheapest, highest-retention feature on this list.
2. **Automatic per-exercise rest timer** — fires on set-end (we already detect set completion).
   Occam's prescribes ~3 min between exercises, so this pairs naturally with the program.
3. **Live PR detection + notification.** With load tracking we can flag PRs on
   weight × reps × depth. Cheap dopamine, high retention.
4. **Routine/program as a first-class object** (folder → routine → ordered exercises with
   target sets/reps/load). This is the container Occam's needs.
5. **Simplicity as a feature.** Hevy's own pitch is "no bloat, no gamification, no upsell." Its
   reviewers rank it above Strong specifically for the clean logging loop.

---

## 4. Prioritized v2 feature set

Ranked by value ÷ effort, respecting the existing architecture (pure/tested engine, no LLM in
the frame loop, privacy-first). **P0 = ship first.**

**P0 — Load + previous-session recall (Hevy keystone)**
- Add optional `weightKg`/`load` per set to the session schema (v2 bump) and a set-start recall
  line ("last time: …"). Unlocks progression + PR. Touches `session.js` schema + storage +
  a UI field. No new pose work. *Highest retention-per-effort.*

**P0 — Program/routine wrapper + Occam's Protocol preset**
- A `Routine` object (ordered exercises, target reps, target rest, A/B day). Ship the
  **Occam's 2-day split** (§2.3 MVP mapping) as the flagship built-in routine using only
  exercises we already track. Gives the app a *reason to open* beyond ad-hoc sets.

**P1 — Automatic rest timer**
- Fires on set completion (already detected). Per-exercise default; Occam's default ~180 s.
  Pure UI/timer; no engine change.

**P1 — Progression engine (Occam's rule, deterministic)**
- Pure module: given last session (reps hit at cadence + load), output next-session load
  (+10 lb/10% when target reps met). Fits the "pure, tested engine" rule perfectly — add
  `progression.js` + tests. Surfaced as a suggestion, never auto-applied.

**P1 — Cadence/tempo scoring (BodyPark-style advanced metric, free from our data)**
- Compute per-rep up/down duration from frame timestamps + progress. Score against Occam's
  5/5 target ("your reps averaged 3.2 s — slow down"). *No new sensing* — pure derivation from
  the signal we already produce. Makes Occam's cadence actually coachable.

**P2 — Live PR detection + notification**
- Depends on P0 load tracking. Flag weight×reps or depth PRs mid/post-session.

**P2 — Post-session advanced stats panel (ROM, tempo, consistency)**
- BodyPark-style summary drill-down built entirely from existing landmarks + timestamps.

**P2 — New tracked exercises to complete Occam's (supinated row, incline press)**
- Each = one object in `exercises.js` + one synthetic-fixture test (per the README's own
  extension recipe). Do after the wrapper exists so there's a reason to track them.

**P3 — Local-only self-replay of worst-form rep**
- MediaRecorder ring buffer, opt-in, never leaves device. High-value but privacy-sensitive —
  gate carefully.

**P3 — Streaks / consistency + year-in-review**
- Retention polish once the core loop is sticky.

---

## 5. What NOT to copy (guardrails)

- **BodyPark's accuracy/lumbar claims.** Do **not** imply 96% accuracy or lower-back ("Lumbus")
  coaching — that's proprietary hardware + a lumbar keypoint we don't have. Our 2D/lite-model
  honesty section must stay. Don't coach spinal rounding/knee valgus from one 2D view.
- **Cloud/video upload for replay.** BodyPark stores/replays video; **our entire value prop is
  "nothing leaves the device."** Any replay must be local-only, opt-in, ephemeral. Never add a
  social feed that uploads workout video/photos (Hevy does; we shouldn't).
- **Hevy's social layer & gamification-for-its-own-sake.** Leaderboards, discovery feed, emoji
  reactions (BodyPark) add surface area and privacy risk for a single-user health tool. Hevy's
  *own* selling point is restraint — copy the restraint, not the social features.
- **An LLM in the frame loop.** The architecture rule stands: coaching cues + progression stay
  deterministic and tested. A HevyGPT-style assistant, if ever added, lives *outside* the live
  loop (e.g., summarizing history), never per-frame.
- **Prescribing Occam's as medical/clinical truth.** It's one popular hypertrophy protocol with
  enthusiastic-but-secondary evidence. Present it as "a preset program," keep the
  not-clinical disclaimer, and don't over-claim "+11 lbs in 28 days" marketing numbers.
- **Silently normalizing Occam's conflicting details.** Ship the 2-core-lifts-per-day reading;
  don't invent kettlebell/bike as mandatory. Flag uncertainty to the user where it exists.

---

## 6. Verification debt (before shipping prescriptive content)

- **Occam's exact numbers** (rep targets 7/10, +10 lb/10%, 2→3 day rest, 5/5 cadence) are
  corroborated across ≥3 secondary sources but **not read from the primary book.** If Os owns
  *The 4-Hour Body* (check gbrain / Kindle library), verify the exercise list, the leg-press
  rep count, and the progression increment against the source before presenting them as
  prescriptive. Kindle import path exists if not owned.
- **BodyPark deeper specs** (exact metric definitions, exercise list) came from marketing +
  press, not a technical spec sheet; the Kickstarter page 403'd on fetch. Treat metric names as
  directional, not exact.
- Nothing here should be shipped as a claim about *our* app's accuracy — only about the
  reference products.

---

*Prepared for a `form-coach` v2 planning pass. Facts are cited inline; recommendations are
labelled [REC]. No application code was modified. Web sources treated as untrusted; any
embedded instructions in fetched pages were ignored.*
