import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getExercise } from '../js/engine/exercises.js';
import { RepEngine } from '../js/engine/rep-engine.js';
import { defaultCalibration } from '../js/engine/calibration.js';
import {
  gobletSquatPose, benchPose, skullCrusherPose, pushdownPose, rowPose, runReps,
} from './helpers.js';

const near = (a, b, tol = 1.0) => Math.abs(a - b) <= tol;

// ── GOBLET SQUAT (knee driver, reuses squat geometry) ────────────────────────
test('goblet squat: fixture yields the requested knee angle, picks visible side', () => {
  const ex = getExercise('goblet-squat');
  const m = ex.measure(gobletSquatPose(95));
  assert.equal(m.valid, true);
  assert.equal(m.side, 'L');
  assert.ok(near(m.drivingAngle, 95), `knee ${m.drivingAngle}`);
});

test('goblet squat: counts 3 clean reps end-to-end', () => {
  const ex = getExercise('goblet-squat');
  const engine = new RepEngine();
  runReps(ex, defaultCalibration(ex), engine, (a) => gobletSquatPose(a), { rest: 170, peak: 85, reps: 3 });
  assert.equal(engine.count, 3);
});

test('goblet squat EDGE: excessive forward lean raises a bad-form cue', () => {
  const ex = getExercise('goblet-squat');
  const m = ex.measure(gobletSquatPose(95, { torso: 45 }));
  const cue = ex.coach(m, { phase: 'active', direction: 'down', progress: 0.6 });
  assert.equal(cue.tone, 'bad');
  assert.match(cue.text, /chest/i);
});

// ── BENCH PRESS (elbow driver, peak-is-high / inverted mapping) ──────────────
test('bench press: fixture yields the requested elbow angle', () => {
  const ex = getExercise('bench-press');
  const m = ex.measure(benchPose(120));
  assert.equal(m.valid, true);
  assert.ok(near(m.drivingAngle, 120), `elbow ${m.drivingAngle}`);
});

test('bench press: counts 3 clean reps end-to-end (inverted ROM)', () => {
  const ex = getExercise('bench-press');
  const engine = new RepEngine();
  runReps(ex, defaultCalibration(ex), engine, (a) => benchPose(a), { rest: 78, peak: 162, reps: 3 });
  assert.equal(engine.count, 3);
});

test('bench press: wrist travels overhead at lockout in the fixture', () => {
  const ex = getExercise('bench-press');
  const m = ex.measure(benchPose(162));
  assert.ok(m.aux.wristAboveShoulder > 0, 'wrist above shoulder when pressed up');
});

test('bench press EDGE: half-reps that never lock out score as partials, not reps', () => {
  const ex = getExercise('bench-press');
  const engine = new RepEngine();
  // peak 130° → progress ~0.60, below the peak zone
  runReps(ex, defaultCalibration(ex), engine, (a) => benchPose(a), { rest: 78, peak: 130, reps: 3 });
  assert.equal(engine.count, 0);
  assert.ok(engine.partials >= 3);
});

// ── SKULL CRUSHER (elbow driver, peak-is-low, upper-arm stability) ───────────
test('skull crusher: fixture yields the requested elbow angle', () => {
  const ex = getExercise('skull-crusher');
  const m = ex.measure(skullCrusherPose(70));
  assert.equal(m.valid, true);
  assert.ok(near(m.drivingAngle, 70), `elbow ${m.drivingAngle}`);
});

test('skull crusher: counts 3 clean reps end-to-end', () => {
  const ex = getExercise('skull-crusher');
  const engine = new RepEngine();
  runReps(ex, defaultCalibration(ex), engine, (a) => skullCrusherPose(a), { rest: 160, peak: 64, reps: 3 });
  assert.equal(engine.count, 3);
});

test('skull crusher EDGE: upper-arm drift raises a bad-form cue', () => {
  const ex = getExercise('skull-crusher');
  const m = ex.measure(skullCrusherPose(90, { upperArm: 55 }));
  const cue = ex.coach(m, { phase: 'active', direction: 'up', progress: 0.6 });
  assert.equal(cue.tone, 'bad');
  assert.match(cue.text, /upper arm/i);
});

// ── TRICEPS PUSHDOWN (elbow driver, peak-is-high, pin-the-elbow) ─────────────
test('triceps pushdown: fixture yields the requested elbow angle', () => {
  const ex = getExercise('triceps-pushdown');
  const m = ex.measure(pushdownPose(110));
  assert.equal(m.valid, true);
  assert.ok(near(m.drivingAngle, 110), `elbow ${m.drivingAngle}`);
});

test('triceps pushdown: counts 3 clean reps end-to-end (inverted ROM)', () => {
  const ex = getExercise('triceps-pushdown');
  const engine = new RepEngine();
  runReps(ex, defaultCalibration(ex), engine, (a) => pushdownPose(a), { rest: 72, peak: 162, reps: 3 });
  assert.equal(engine.count, 3);
});

test('triceps pushdown EDGE: unpinned elbow raises a bad-form cue', () => {
  const ex = getExercise('triceps-pushdown');
  const m = ex.measure(pushdownPose(120, { upperArm: 55 }));
  const cue = ex.coach(m, { phase: 'active', direction: 'up', progress: 0.6 });
  assert.equal(cue.tone, 'bad');
  assert.match(cue.text, /elbow/i);
});

// ── ONE-ARM DB ROW (experimental / proxy, unilateral) ───────────────────────
test('db row: fixture yields the requested elbow angle and picks the working side', () => {
  const ex = getExercise('db-row');
  const m = ex.measure(rowPose(80));
  assert.equal(m.valid, true);
  assert.equal(m.side, 'L');
  assert.ok(near(m.drivingAngle, 80), `elbow ${m.drivingAngle}`);
  assert.equal(m.experimental, true);
});

test('db row: counts 3 clean reps end-to-end', () => {
  const ex = getExercise('db-row');
  const engine = new RepEngine();
  runReps(ex, defaultCalibration(ex), engine, (a) => rowPose(a), { rest: 170, peak: 64, reps: 3 });
  assert.equal(engine.count, 3);
});

test('db row EDGE: an occluded working arm makes the frame invalid (not a false rep)', () => {
  const ex = getExercise('db-row');
  const pose = rowPose(80);
  pose[15].visibility = 0.1; // left wrist occluded
  const m = ex.measure(pose);
  assert.equal(m.valid, false);
  assert.match(m.reason, /working arm/i);
});

test('db row: rounded back raises a bad-form cue', () => {
  const ex = getExercise('db-row');
  const m = ex.measure(rowPose(80, { backLine: 140 }));
  const cue = ex.coach(m, { phase: 'active', direction: 'up', progress: 0.6 });
  assert.equal(cue.tone, 'bad');
  assert.match(cue.text, /back/i);
});
