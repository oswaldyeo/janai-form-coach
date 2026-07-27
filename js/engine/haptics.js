// Haptic + edge auto-scroll decision math — pure, deterministic, no DOM.
//
// The browser layer (js/interactions.js) reads pointer/viewport values and calls
// navigator.vibrate; every *decision* here — should we buzz? how fast should the
// list auto-scroll while a drag hovers near a viewport edge? — is pure and
// unit-tested under node.
//
// Haptics themselves are a progressive enhancement: navigator.vibrate is
// supported on Android Chrome/Firefox but is ABSENT on iOS Safari and iOS Home
// Screen (standalone PWA) Safari — Apple exposes no web vibration API there. So
// on iPhone these buzzes silently no-op; the visual drag/auto-scroll still works.
// Nothing here assumes the buzz landed.

// Buzz durations (ms) for each drag moment. Kept short so reordering a long list
// feels like discrete ticks rather than a continuous rumble.
export const HAPTIC = {
  cross: 8,       // dragged item crossed into a new slot
  scrollEdge: 5,  // auto-scroll started / changed direction or speed tier
};

/**
 * Edge auto-scroll intent for a drag near a viewport edge. Returns a signed
 * per-tick step in px: negative scrolls the viewport up (pointer near the top),
 * positive down (near the bottom), 0 in the dead middle zone. The speed ramps
 * from the edge boundary inward and is quantised into `tiers` discrete levels so
 * the motion — and the haptic that announces a level change — is stable instead
 * of jittering every frame.
 *
 * @param {number} pointerY   pointer clientY (px from viewport top)
 * @param {number} viewportH  viewport height (px)
 * @returns {{dir:-1|0|1, step:number, tier:number}}
 */
export function edgeAutoScroll(pointerY, viewportH, {
  edgePx = 72, minStep = 6, maxStep = 26, tiers = 3,
} = {}) {
  const none = { dir: 0, step: 0, tier: 0 };
  if (!(viewportH > 0) || typeof pointerY !== 'number' || Number.isNaN(pointerY)) return none;

  const topDist = pointerY;               // distance from the top edge
  const botDist = viewportH - pointerY;   // distance from the bottom edge
  let dir = 0;
  let edgeDist = 0;
  if (topDist < edgePx && topDist <= botDist) { dir = -1; edgeDist = topDist; }
  else if (botDist < edgePx) { dir = 1; edgeDist = botDist; }
  else return none;

  // 0 at the boundary, 1 hard against (or past) the edge → fastest.
  const into = Math.min(edgePx, Math.max(0, edgePx - edgeDist)) / edgePx;
  const tier = Math.min(tiers, Math.max(1, Math.ceil(into * tiers)));
  const step = Math.round(minStep + (maxStep - minStep) * (tier / tiers));
  return { dir, step: dir * step, tier };
}

/**
 * Did the auto-scroll state change in a way worth announcing with a haptic?
 * True when the scroll direction flips or the speed tier steps up/down while
 * actively scrolling. Entering the dead zone (dir 0) is silent.
 */
export function autoScrollChanged(prev, next) {
  if (!next || next.dir === 0) return false;
  if (!prev) return true;
  return next.dir !== prev.dir || next.tier !== prev.tier;
}
