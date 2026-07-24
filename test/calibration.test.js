import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrate, defaultCalibration, CALIBRATION_CONSTANTS } from '../js/engine/calibration.js';
import { getExercise } from '../js/engine/exercises.js';

const squat = getExercise('squat');
const press = getExercise('shoulder-press');

// Build a realistic sample sweep between two angles.
function sweep(a, b, n = 40) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(a + (b - a) * (i / n));
  return out;
}

test('calibrate captures ROM for a peak-is-low exercise (squat)', () => {
  const c = calibrate(squat, sweep(170, 80));
  assert.equal(c.calibrated, true);
  // rest = high angle (extended), peak = low angle (deep)
  assert.ok(c.restAngle > c.peakAngle);
  assert.ok(c.restAngle > 150 && c.restAngle <= 170);
  assert.ok(c.peakAngle >= 80 && c.peakAngle < 110);
  assert.ok(c.romSpan >= CALIBRATION_CONSTANTS.MIN_SPAN_DEG);
});

test('calibrate inverts correctly for a peak-is-high exercise (press)', () => {
  const c = calibrate(press, sweep(70, 168));
  assert.equal(c.calibrated, true);
  // rest = low angle (bent), peak = high angle (locked out overhead)
  assert.ok(c.peakAngle > c.restAngle);
  assert.ok(c.peakAngle > 150);
});

test('edge: too few samples falls back to defaults', () => {
  const c = calibrate(squat, [120, 118, 130]); // < MIN_SAMPLES
  assert.equal(c.calibrated, false);
  assert.equal(c.restAngle, squat.defaults.restAngle);
  assert.equal(c.peakAngle, squat.defaults.peakAngle);
  assert.match(c.reason, /Not enough/);
});

test('edge: ROM too small falls back to defaults', () => {
  const c = calibrate(squat, sweep(150, 140, 40)); // span 10° < 25°
  assert.equal(c.calibrated, false);
  assert.match(c.reason, /too small/);
});

test('percentile trimming rejects a single outlier frame', () => {
  const good = sweep(170, 90, 60);
  good[0] = 15; // one garbage frame
  const c = calibrate(squat, good);
  assert.equal(c.calibrated, true);
  assert.ok(c.peakAngle > 60, 'outlier did not blow out the peak angle');
});

test('defaultCalibration is uncalibrated but valid', () => {
  const c = defaultCalibration(squat);
  assert.equal(c.calibrated, false);
  assert.equal(c.valid, true);
  assert.equal(c.restAngle, squat.defaults.restAngle);
});
