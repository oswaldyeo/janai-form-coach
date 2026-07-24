# Build spec — per-exercise "How to" section (Hevy-style)

**Goal:** add a Hevy-style *How to* panel to Janai Form Coach so each exercise
shows demonstration image(s) + numbered steps + form cues. Priority: the 12
exercises used by the two **Knee Rehab** routines. Nice-to-have: make the same
mechanism work for any catalog exercise (empty when no how-to authored yet).

The **instructions + cues below are authored and medically checked — use them
verbatim**. Do NOT rewrite the form guidance or invent your own steps. Your job
is the UI, the data plumbing, and sourcing/bundling images.

## Exercise how-to content (verbatim)

Keyed by catalog `id`.

### hevy-cda23948 — Glute Bridge
Steps:
1. Lie on your back, knees bent, feet flat and hip-width apart.
2. Brace your core and push through your heels.
3. Lift your hips until shoulders–hips–knees form a straight line.
4. Squeeze your glutes at the top for a second.
5. Lower slowly with control.
Cues: Drive through the heels, not the toes. Don't over-arch your lower back — the lift comes from the glutes.

### hevy-cc016611 — Clamshell
Steps:
1. Lie on your side, hips and knees bent ~45°, legs stacked, heels together.
2. Keep your heels touching and your pelvis still.
3. Rotate your top knee open like a clam by using your hip.
4. Pause at the top, then lower slowly.
Cues: The motion comes from the hip — keep your torso and pelvis from rolling back. Add a band above the knees to progress.

### hevy-dc59d143 — Lateral Leg Raises (side-lying hip abduction)
Steps:
1. Lie on your side with legs straight and stacked (bend the bottom knee for a stable base).
2. Tighten the top thigh and lift the top leg to about 45°.
3. Lead with your heel, toes pointed slightly down.
4. Lower slowly without letting the leg drift forward.
Cues: Keep the working leg in line with your body. Slow and controlled beats high and fast.

### hevy-ec02979e — Lateral Band Walks
Steps:
1. Loop a band around your ankles (or just above the knees).
2. Drop into a quarter-squat, feet hip-width, keeping tension on the band.
3. Step sideways in small, controlled steps, staying low.
4. Do equal steps each direction.
Cues: Stay low, toes pointing forward, and never let your knees cave inward.

### straight-leg-raise — Straight-Leg Raise
Steps:
1. Lie on your back, one knee bent with foot flat, the other leg straight.
2. Tighten the thigh of the straight leg so the knee is fully locked.
3. Lift the straight leg to the height of the opposite bent knee.
4. Hold for a beat, then lower slowly.
Cues: Keep the knee locked straight the whole time. Move slowly — no swinging.

### hevy-c8706c80 — Wall Sit
Steps:
1. Stand with your back flat against a wall, feet shoulder-width and ~2 feet out.
2. Slide down the wall to a comfortable, pain-free depth (start higher than 90°).
3. Keep your knees stacked over your ankles, not past your toes.
4. Hold; log the seconds in the reps field.
Cues: Weight in your heels. Only go as deep as stays pain-free, then progress toward 90° over time.

### calf-raise — Calf Raise
Steps:
1. Stand tall, feet hip-width, holding a wall or rail for balance.
2. Rise up onto the balls of your feet as high as you can.
3. Pause at the top.
4. Lower slowly with control.
Cues: Use the full range and stay controlled. Progress to single-leg when it's easy.

### step-down — Step-Down (eccentric)
Steps:
1. Stand on a low step on your affected leg, other foot hanging off the edge.
2. Slowly bend the standing knee to lightly tap the other heel to the floor.
3. Keep the standing knee pointing over your 2nd toe — no caving inward.
4. Push back up through the standing heel.
Cues: The slow lowering (eccentric) phase is the whole point — 3 seconds down. Knee tracks forward, never dives inward. This is the key lift for pain going up stairs.

### spanish-squat — Spanish Squat (isometric hold)
Steps:
1. Loop a strong band around a sturdy post and behind both knees.
2. Lean back into the band, feet shoulder-width.
3. Sit back into a squat, keeping your shins vertical.
4. Hold; log the seconds in the reps field.
Cues: Shins stay vertical, weight in your heels, keep breathing through the hold.

### hevy-c284d923 — Reverse Lunge
Steps:
1. Stand tall, feet hip-width.
2. Step one foot back and lower until both knees are ~90°.
3. Keep the front shin vertical.
4. Push through the front heel to return to standing.
Cues: Front knee tracks over the toes, torso stays upright.

### split-squat — Split Squat
Steps:
1. Stagger your feet — one forward flat, one back on the toes.
2. Lower straight down, bending both knees.
3. Keep the front heel planted.
4. Drive up through the front leg.
Cues: Keep the front knee over the ankle, most of your weight on the front leg.

### single-leg-balance — Single-Leg Balance
Steps:
1. Stand on your affected leg with a slight knee bend, hips level.
2. Hold steady and tall; log the seconds in the reps field.
3. Progress by closing your eyes or standing on a cushion.
Cues: Keep your hips level — don't let one side drop. Knee stays soft and over the toes.

## Images

- Source ONLY from the free, open **yuhonas/free-exercise-db** (public-domain
  images). Index: `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json`.
  Image files: `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/<Exercise_Name>/<0|1>.jpg`.
- For each of the 12 exercises, try to match by name (Glute Bridge, Wall Sit,
  Standing Calf Raises, Bulgarian/rear-foot split squat, reverse lunge, etc.).
  Download at most 2 matched images per exercise into
  `assets/howto/<catalog-id>/0.jpg` (and `1.jpg`) and reference them **locally
  and relatively** so the PWA works offline and under the `/formcoach` subpath.
- If there is no confident name match (e.g. clamshell, band walk, straight-leg
  raise, Spanish squat, single-leg balance, step-down), **skip the image** and
  render a text-only how-to. Do NOT hotlink external URLs at runtime and do NOT
  substitute an unrelated image just to have one. Honesty over decoration.

## UI

- Add a "How to" affordance to each exercise (in the exercise picker and on the
  exercise card inside an active workout) — e.g. an ℹ️ / "How to" control that
  opens a panel/modal. Reuse the app's existing dark/mint styling and existing
  modal/sheet pattern; match the codebase, don't invent a new design language.
- Panel layout (Hevy-like): exercise name → image(s) if present → numbered
  Steps → Form cues. Clean, phone-first, scrollable.
- Exercises with no authored how-to simply show no "How to" control (or a
  disabled state) — never a broken/empty modal.

## Data & architecture

- Keep the pure/tested engine rule: put how-to DATA in a pure module (e.g.
  `js/engine/howto.js`) keyed by catalog id, exporting a lookup like
  `getHowto(id)`. No DOM in the engine. The UI rendering lives in `js/app.js`
  (or a small view helper), consistent with how camera/coach UI is wired.
- Bundle images under `assets/howto/`. Add them to the service worker so they're
  cached offline: bump `SHELL_CACHE` in `sw.js` to `formcoach-shell-v10` and
  include the how-to assets (runtime-cache is acceptable if that matches the
  existing pattern better).

## Verification (must all pass before you report done)

1. `npm test` stays green — add tests: every Knee-Rehab exercise id has a howto
   with ≥3 steps; every referenced local image path exists on disk.
2. Start/confirm the dev server and check the how-to renders: the app is already
   served on `http://127.0.0.1:8765` and publicly at
   `https://oswalds-macbook-pro.tail9c5ff6.ts.net/formcoach/`. Do a headless
   fetch to confirm `assets/howto/...` images return 200 and `js/engine/howto.js`
   loads. (Do NOT touch the tailscale funnel or the server processes.)
3. Keep every URL relative (must work under the `/formcoach` subpath).

## Report back (write to $BODY_FILE)

A short summary: which exercises got images vs text-only, files added/changed,
test result (N/N passing), and anything skipped and why.
