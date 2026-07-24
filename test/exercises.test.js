import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getExercise } from '../js/engine/exercises.js';
import { RepEngine } from '../js/engine/rep-engine.js';
import { defaultCalibration } from '../js/engine/calibration.js';
import {
  squatPose, pushupPose, lungePose, curlPose, pressPose, runReps,
} from './helpers.js';

const near = (a, b, tol = 1.0) => Math.abs(a - b) <= tol;

// ── SQUAT ────────────────────────────────────────────────────────────────────
test('squat: fixture yields the requested knee angle and picks the visible side', () => {
  const ex = getExercise('squat');
  const m = ex.measure(squatPose(95));
  assert.equal(m.valid, true);
  assert.equal(m.side, 'L');
  assert.ok(near(m.drivingAngle, 95), `knee ${m.drivingAngle}`);
});

test('squat: counts 3 clean reps end-to-end', () => {
  const ex = getExercise('squat');
  const calib = defaultCalibration(ex);
  const engine = new RepEngine();
  runReps(ex, calib, engine, (a) => squatPose(a), { rest: 170, peak: 85, reps: 3 });
  assert.equal(engine.count, 3);
});

test('squat EDGE: an occluded ankle makes the frame invalid (not a false rep)', () => {
  const ex = getExercise('squat');
  const pose = squatPose(95);
  pose[27].visibility = 0.1; // left ankle occluded
  const m = ex.measure(pose);
  assert.equal(m.valid, false);
  assert.match(m.reason, /side profile/);
});

// ── PUSH-UP ──────────────────────────────────────────────────────────────────
test('pushup: fixture yields the requested elbow angle', () => {
  const ex = getExercise('pushup');
  const m = ex.measure(pushupPose(100));
  assert.equal(m.valid, true);
  assert.ok(near(m.drivingAngle, 100), `elbow ${m.drivingAngle}`);
});

test('pushup: counts 3 clean reps end-to-end', () => {
  const ex = getExercise('pushup');
  const engine = new RepEngine();
  runReps(ex, defaultCalibration(ex), engine, (a) => pushupPose(a), { rest: 162, peak: 85, reps: 3 });
  assert.equal(engine.count, 3);
});

test('pushup EDGE: sagging body line raises a bad-form cue', () => {
  const ex = getExercise('pushup');
  const m = ex.measure(pushupPose(120, { bodyLine: 140 }));
  const cue = ex.coach(m, { phase: 'active', direction: 'down', progress: 0.5 });
  assert.equal(cue.tone, 'bad');
  assert.match(cue.text, /Straighten/);
});

// ── ALTERNATING LUNGE ────────────────────────────────────────────────────────
test('lunge: working leg is the more-flexed (left) knee', () => {
  const ex = getExercise('lunge');
  const m = ex.measure(lungePose(100));
  assert.equal(m.valid, true);
  assert.equal(m.side, 'L');
  assert.ok(near(m.drivingAngle, 100), `front knee ${m.drivingAngle}`);
});

test('lunge: counts 3 clean reps end-to-end', () => {
  const ex = getExercise('lunge');
  const engine = new RepEngine();
  runReps(ex, defaultCalibration(ex), engine, (a) => lungePose(a), { rest: 168, peak: 95, reps: 3 });
  assert.equal(engine.count, 3);
});

test('lunge EDGE: shallow reps score as partials, not counted reps', () => {
  const ex = getExercise('lunge');
  const engine = new RepEngine();
  // peak 125° → progress ~0.58, below the peak zone
  runReps(ex, defaultCalibration(ex), engine, (a) => lungePose(a), { rest: 168, peak: 125, reps: 3 });
  assert.equal(engine.count, 0);
  assert.ok(engine.partials >= 3);
});

// ── BICEP CURL ───────────────────────────────────────────────────────────────
test('curl: fixture yields the requested elbow angle', () => {
  const ex = getExercise('bicep-curl');
  const m = ex.measure(curlPose(70));
  assert.equal(m.valid, true);
  assert.ok(near(m.drivingAngle, 70), `elbow ${m.drivingAngle}`);
});

test('curl: counts 3 clean reps end-to-end', () => {
  const ex = getExercise('bicep-curl');
  const engine = new RepEngine();
  runReps(ex, defaultCalibration(ex), engine, (a) => curlPose(a), { rest: 155, peak: 52, reps: 3 });
  assert.equal(engine.count, 3);
});

test('curl EDGE: elbow swinging away from torso raises a bad-form cue', () => {
  const ex = getExercise('bicep-curl');
  const m = ex.measure(curlPose(70, { upperArm: 55 }));
  const cue = ex.coach(m, { phase: 'active', direction: 'up', progress: 0.6 });
  assert.equal(cue.tone, 'bad');
  assert.match(cue.text, /elbow/i);
});

// ── SHOULDER PRESS (peak-is-high, inverted mapping) ──────────────────────────
test('press: fixture yields the requested elbow angle', () => {
  const ex = getExercise('shoulder-press');
  const m = ex.measure(pressPose(120));
  assert.equal(m.valid, true);
  assert.ok(near(m.drivingAngle, 120), `elbow ${m.drivingAngle}`);
});

test('press: counts 3 clean reps end-to-end (inverted ROM)', () => {
  const ex = getExercise('shoulder-press');
  const engine = new RepEngine();
  runReps(ex, defaultCalibration(ex), engine, (a) => pressPose(a), { rest: 78, peak: 162, reps: 3 });
  assert.equal(engine.count, 3);
});

test('press: wrist actually travels overhead at lockout in the fixture', () => {
  const ex = getExercise('shoulder-press');
  const m = ex.measure(pressPose(162));
  assert.ok(m.aux.wristAboveShoulder > 0, 'wrist above shoulder when extended');
});

test('press EDGE: locking elbows without pressing overhead raises a bad-form cue', () => {
  const ex = getExercise('shoulder-press');
  // crafted measurement: elbows extended (high progress) but hands never overhead
  const m = { valid: true, side: 'L', drivingAngle: 160, aux: { wristAboveShoulder: -0.05 } };
  const cue = ex.coach(m, { phase: 'active', direction: 'up', progress: 0.9 });
  assert.equal(cue.tone, 'bad');
  assert.match(cue.text, /overhead/i);
});
