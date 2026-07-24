# Real-phone QA checklist — camera coach

Synthetic fixtures prove the biomechanics math; they **cannot** prove real-camera
accuracy. The confidence ratings in `V2-DESIGN.md` §7 are *hypotheses* until this
runs on a real phone. Do one pass per new camera lift.

## How to run

1. Serve over `localhost` or HTTPS (camera needs a secure context); open on a
   phone. `npm run serve` then browse to the LAN URL over HTTPS, or use the
   deployed GitHub Pages URL.
2. Start an empty workout → add the exercise → tap **📷 Coach**.
3. Follow the on-screen **placement** (also in the table below). Calibrate with
   2 slow full-range reps when prompted.
4. Score each row **pass / fail**, note the device + lighting.

For each lift, verify these three things:

- **A. Clean count** — do **10** deliberate, full-range reps. The counter should
  read **10 (±1)**. Record the actual count.
- **B. No false counts at rest** — hold the bottom/top and the rest position for
  ~15 s and fidget slightly. The counter must **not** increment.
- **C. Cue fires on deliberate bad form** — perform the named bad-form rep; the
  form cue must turn **amber/red** with the expected text.

Record: `device · lighting · A count/10 · B held? · C cue fired?`

---

### 1. Goblet squat  *(expected: HIGH)*
- **Placement:** side-on, phone at hip height, whole body in frame.
- **Bad-form rep (C):** collapse the chest forward at the bottom → expect
  **"Chest tall, elbows in"** (red).
- Watch for: goblet dumbbell occluding the near knee at the bottom.

### 2. Bench press  *(expected: MEDIUM)*
- **Placement:** side-on at bench level, ~2 m back, **working arm nearest** the
  camera.
- **Bad-form rep (C):** stop halfway (no lockout) → those reps should log as
  **partials**, not counted reps (counter stays put; "Full range next time").
- Watch for: the far arm / rack occluding the near arm; re-frame if the count
  jumps.

### 3. Skull crusher  *(expected: MEDIUM)*
- **Placement:** side-on at bench level, track the **near** arm.
- **Bad-form rep (C):** let the upper arms drift toward the head/feet → expect
  **"Keep your upper arms still"** (red).
- Watch for: near arm occluding the far arm — count the near arm only.

### 4. Triceps pushdown  *(expected: MEDIUM)*
- **Placement:** side-on, working arm toward the camera, **cable stack out of
  frame**.
- **Bad-form rep (C):** let the elbow swing forward off the ribs → expect
  **"Pin your elbows"** (red).
- Watch for: the machine/stack occluding the forearm at the bottom.

### 5. One-arm DB row  *(EXPERIMENTAL — expected: LOW)*
- **Placement:** side-on to the working side, low angle, flat back over a bench.
- The coach shows an **"Experimental count — verify the reps"** banner. This lift
  is expected to be noisy; the goal of QA is to *quantify* how noisy.
- **Bad-form rep (C):** round the back → expect **"Flatten your back"** (red).
- Watch for: the working elbow disappearing behind the torso at the top (the
  known failure mode). Note whether A lands within ±1 or drifts further — that
  determines whether it can be promoted out of "experimental" (Build 2).

---

## Sign-off

| Lift | Device / lighting | A (count/10) | B (no false at rest) | C (cue fired) | Verdict |
|---|---|---|---|---|---|
| Goblet squat | | | | | |
| Bench press | | | | | |
| Skull crusher | | | | | |
| Triceps pushdown | | | | | |
| One-arm DB row (exp) | | | | | |

If A is outside ±1 for a `medium` lift, downgrade it to `low`/experimental in
`js/engine/catalog.js` (the ratings are hypotheses, not commitments). Cable twist
is intentionally **not** in this list — it has no camera coach.
