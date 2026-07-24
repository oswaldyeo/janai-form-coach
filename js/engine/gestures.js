// Gesture math — pure, deterministic, no DOM.
//
// Everything a swipe / drag-reorder / long-press recogniser needs to *decide*
// lives here so it can be unit-tested under node. The browser layer
// (js/interactions.js) only reads pointer events and applies transforms.

/**
 * Classify a completed horizontal swipe from its total delta + duration.
 * A swipe counts when it is horizontally dominant AND either long enough
 * (`minDist`) or a fast flick (`minFlickDist` at `minVelocity` px/ms).
 *
 * @returns {'left'|'right'|null}
 */
export function classifySwipe({
  dx = 0, dy = 0, dt = 0,
  minDist = 60, minFlickDist = 24, minVelocity = 0.5, maxDt = 600, axisRatio = 1.5,
} = {}) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (dt > maxDt) return null;                    // too slow — a drag, not a swipe
  if (ax < ay * axisRatio) return null;           // not horizontally dominant
  const velocity = dt > 0 ? ax / dt : Infinity;
  const farEnough = ax >= minDist;
  const flick = ax >= minFlickDist && velocity >= minVelocity;
  if (!farEnough && !flick) return null;
  return dx > 0 ? 'right' : 'left';
}

/**
 * Which tab a swipe lands on. Content follows the finger: swiping LEFT reveals
 * the NEXT tab, swiping RIGHT the previous one. Returns null at the ends or
 * for unknown tabs/directions.
 */
export function adjacentTab(order, current, direction) {
  const i = (order || []).indexOf(current);
  if (i < 0) return null;
  if (direction === 'left') return order[i + 1] ?? null;
  if (direction === 'right') return order[i - 1] ?? null;
  return null;
}

/**
 * Native-style swipe-back commit rule. A slow drag may commit by crossing a
 * fraction of the viewport; a shorter gesture may commit as a deliberate
 * rightward flick. Negative/zero travel can never navigate back.
 */
export function shouldCommitSwipeBack({
  dx = 0, dt = 0, width = 0,
  commitRatio = 0.33, minFlickDist = 24, minVelocity = 0.5,
} = {}) {
  if (dx <= 0 || width <= 0) return false;
  if (dx >= width * commitRatio) return true;
  const velocity = dt > 0 ? dx / dt : Infinity;
  return dx >= minFlickDist && velocity >= minVelocity;
}

/**
 * Drag-reorder: given the dragged item's index, its current translation, and
 * the ordered item sizes (heights for a vertical list), return the index the
 * item would drop at. An item is displaced once the drag crosses its midpoint.
 */
export function dropIndexFromOffset(from, offset, sizes, gap = 0) {
  if (!Array.isArray(sizes) || from < 0 || from >= sizes.length) return from;
  let idx = from;
  if (offset < 0) {
    let acc = 0;
    for (let i = from - 1; i >= 0; i--) {
      acc += sizes[i] + gap;
      if (-offset > acc - (sizes[i] + gap) / 2) idx = i; else break;
    }
  } else if (offset > 0) {
    let acc = 0;
    for (let i = from + 1; i < sizes.length; i++) {
      acc += sizes[i] + gap;
      if (offset > acc - (sizes[i] + gap) / 2) idx = i; else break;
    }
  }
  return idx;
}

/**
 * Clamp a drag translation so the dragged item cannot leave the list:
 * it can rise at most past everything above it, and sink past everything below.
 */
export function clampDragOffset(offset, from, sizes, gap = 0) {
  if (!Array.isArray(sizes) || from < 0 || from >= sizes.length) return 0;
  let min = 0;
  for (let i = 0; i < from; i++) min -= sizes[i] + gap;
  let max = 0;
  for (let i = from + 1; i < sizes.length; i++) max += sizes[i] + gap;
  return Math.min(max, Math.max(min, offset));
}

/**
 * A press is "long" when it was held long enough without wandering.
 */
export function isLongPress({ heldMs = 0, movedPx = 0, holdMs = 500, slopPx = 8 } = {}) {
  return heldMs >= holdMs && movedPx <= slopPx;
}
