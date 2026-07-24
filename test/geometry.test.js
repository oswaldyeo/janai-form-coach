import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angle, normalize, visible, clamp, makeSmoother } from '../js/engine/geometry.js';

test('angle: right angle', () => {
  const a = { x: 0, y: 1 }, b = { x: 0, y: 0 }, c = { x: 1, y: 0 };
  assert.ok(Math.abs(angle(a, b, c) - 90) < 1e-6);
});

test('angle: straight line is 180', () => {
  const a = { x: -1, y: 0 }, b = { x: 0, y: 0 }, c = { x: 1, y: 0 };
  assert.ok(Math.abs(angle(a, b, c) - 180) < 1e-6);
});

test('normalize handles forward and inverted ranges', () => {
  assert.equal(normalize(50, 0, 100), 0.5);
  // inverted: squat-style, rest angle high maps to 0, peak angle low maps to 1
  assert.equal(normalize(172, 172, 82), 0);
  assert.equal(normalize(82, 172, 82), 1);
  assert.ok(Math.abs(normalize(127, 172, 82) - 0.5) < 1e-6);
});

test('normalize clamps out-of-range', () => {
  assert.equal(normalize(-10, 0, 100), 0);
  assert.equal(normalize(999, 0, 100), 1);
});

test('visible respects threshold and missing points', () => {
  assert.equal(visible([{ visibility: 0.9 }, { visibility: 0.6 }]), true);
  assert.equal(visible([{ visibility: 0.9 }, { visibility: 0.2 }]), false);
  assert.equal(visible([null]), false);
  assert.equal(visible([{ x: 0, y: 0 }]), true); // no visibility field == visible
});

test('clamp', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
});

test('makeSmoother eases toward samples and ignores NaN', () => {
  const s = makeSmoother(0.5);
  assert.equal(s(10), 10);
  assert.equal(s(20), 15);
  assert.equal(s(NaN), 15); // unchanged
});
