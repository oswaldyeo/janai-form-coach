import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySwipe, adjacentTab, shouldCommitSwipeBack,
  dropIndexFromOffset, clampDragOffset, isLongPress,
} from '../js/engine/gestures.js';

// ── classifySwipe ────────────────────────────────────────────────────────────
test('classifySwipe recognises left/right on distance', () => {
  assert.equal(classifySwipe({ dx: 90, dy: 10, dt: 300 }), 'right');
  assert.equal(classifySwipe({ dx: -90, dy: 10, dt: 300 }), 'left');
});

test('classifySwipe rejects slow, vertical, and tiny gestures', () => {
  assert.equal(classifySwipe({ dx: 90, dy: 5, dt: 900 }), null, 'too slow overall');
  assert.equal(classifySwipe({ dx: 60, dy: 80, dt: 200 }), null, 'vertically dominant');
  assert.equal(classifySwipe({ dx: 8, dy: 2, dt: 80 }), null, 'a tap, not a swipe');
  assert.equal(classifySwipe({ dx: 40, dy: 4, dt: 500 }), null, 'short and not fast enough');
});

test('classifySwipe accepts a short fast flick', () => {
  assert.equal(classifySwipe({ dx: 30, dy: 4, dt: 50 }), 'right', '0.6 px/ms flick');
  assert.equal(classifySwipe({ dx: -30, dy: 4, dt: 0 }), 'left', 'dt=0 treated as instant');
});

test('classifySwipe axis dominance is tunable', () => {
  assert.equal(classifySwipe({ dx: 70, dy: 60, dt: 200, axisRatio: 1.0 }), 'right');
  assert.equal(classifySwipe({ dx: 70, dy: 60, dt: 200, axisRatio: 1.5 }), null);
});

// ── adjacentTab ──────────────────────────────────────────────────────────────
const TABS = ['home', 'routines', 'history'];
test('adjacentTab: swipe left → next, swipe right → previous', () => {
  assert.equal(adjacentTab(TABS, 'home', 'left'), 'routines');
  assert.equal(adjacentTab(TABS, 'routines', 'left'), 'history');
  assert.equal(adjacentTab(TABS, 'routines', 'right'), 'home');
});

test('adjacentTab returns null at the ends and for unknown input', () => {
  assert.equal(adjacentTab(TABS, 'home', 'right'), null);
  assert.equal(adjacentTab(TABS, 'history', 'left'), null);
  assert.equal(adjacentTab(TABS, 'nope', 'left'), null);
  assert.equal(adjacentTab(TABS, 'home', 'up'), null);
});

// ── shouldCommitSwipeBack ───────────────────────────────────────────────────
test('swipe-back commits on a one-third drag, even when performed slowly', () => {
  assert.equal(shouldCommitSwipeBack({ dx: 132, dt: 900, width: 390 }), true);
  assert.equal(shouldCommitSwipeBack({ dx: 110, dt: 900, width: 390 }), false);
});

test('swipe-back commits a short fast flick but never leftward travel', () => {
  assert.equal(shouldCommitSwipeBack({ dx: 30, dt: 50, width: 390 }), true);
  assert.equal(shouldCommitSwipeBack({ dx: 30, dt: 300, width: 390 }), false);
  assert.equal(shouldCommitSwipeBack({ dx: -200, dt: 100, width: 390 }), false);
  assert.equal(shouldCommitSwipeBack({ dx: 200, dt: 100, width: 0 }), false);
});

// ── dropIndexFromOffset ──────────────────────────────────────────────────────
test('dropIndexFromOffset crosses an item once past its midpoint', () => {
  const sizes = [40, 40, 40];
  assert.equal(dropIndexFromOffset(0, 0, sizes, 10), 0, 'no movement');
  assert.equal(dropIndexFromOffset(0, 24, sizes, 10), 0, 'before midpoint (25)');
  assert.equal(dropIndexFromOffset(0, 26, sizes, 10), 1, 'past midpoint');
  assert.equal(dropIndexFromOffset(0, 80, sizes, 10), 2, 'past both');
  assert.equal(dropIndexFromOffset(2, -26, sizes, 10), 1, 'upwards');
  assert.equal(dropIndexFromOffset(2, -80, sizes, 10), 0, 'to the top');
});

test('dropIndexFromOffset handles non-uniform sizes and bad input', () => {
  const sizes = [100, 20, 60];
  assert.equal(dropIndexFromOffset(0, 11, sizes, 0), 1, 'small next item flips early');
  assert.equal(dropIndexFromOffset(0, 9, sizes, 0), 0);
  assert.equal(dropIndexFromOffset(0, 500, sizes, 0), 2, 'clamped to last');
  assert.equal(dropIndexFromOffset(5, 50, sizes, 0), 5, 'out-of-range from is echoed');
  assert.equal(dropIndexFromOffset(0, 50, null, 0), 0, 'no sizes');
});

// ── clampDragOffset ──────────────────────────────────────────────────────────
test('clampDragOffset keeps the dragged item inside the list', () => {
  const sizes = [40, 40, 40];
  assert.equal(clampDragOffset(-999, 1, sizes, 10), -50, 'cannot rise past the top');
  assert.equal(clampDragOffset(999, 1, sizes, 10), 50, 'cannot sink past the bottom');
  assert.equal(clampDragOffset(12, 1, sizes, 10), 12, 'in-range passes through');
  assert.equal(clampDragOffset(50, 9, sizes, 10), 0, 'bad index → no travel');
});

// ── isLongPress ──────────────────────────────────────────────────────────────
test('isLongPress requires holding still long enough', () => {
  assert.equal(isLongPress({ heldMs: 520, movedPx: 3 }), true);
  assert.equal(isLongPress({ heldMs: 300, movedPx: 3 }), false, 'released early');
  assert.equal(isLongPress({ heldMs: 800, movedPx: 20 }), false, 'wandered — a drag');
  assert.equal(isLongPress({ heldMs: 400, movedPx: 0, holdMs: 350 }), true, 'tunable threshold');
});
