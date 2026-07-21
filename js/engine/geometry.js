// Pure geometry helpers. No DOM, no browser APIs — importable in Node and the browser.
//
// A "landmark" is { x, y, z?, visibility? } in MediaPipe normalized image space
// (x,y in [0,1], origin top-left). We only rely on x/y and visibility here.

/**
 * Interior angle at vertex `b` formed by points a-b-c, in degrees (0..180).
 */
export function angle(a, b, c) {
  const ab = Math.atan2(a.y - b.y, a.x - b.x);
  const cb = Math.atan2(c.y - b.y, c.x - b.x);
  let deg = Math.abs((ab - cb) * 180 / Math.PI);
  return deg > 180 ? 360 - deg : deg;
}

export function avg(a, b) {
  return (a + b) / 2;
}

/**
 * True when every supplied point exists and clears the visibility threshold.
 * Landmarks without a visibility field are treated as fully visible.
 */
export function visible(pts, threshold = 0.55) {
  return pts.every((p) => p && (p.visibility ?? 1) >= threshold);
}

/**
 * Mean visibility of a set of points (missing points count as 0).
 */
export function meanVisibility(pts) {
  if (!pts.length) return 0;
  return pts.reduce((s, p) => s + (p ? (p.visibility ?? 1) : 0), 0) / pts.length;
}

/**
 * Clamp a value into [lo, hi].
 */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Map `v` from range [inMin,inMax] to [0,1], clamped. Handles inverted ranges
 * (inMin > inMax) so callers don't have to special-case direction.
 */
export function normalize(v, inMin, inMax) {
  if (inMin === inMax) return 0;
  return clamp((v - inMin) / (inMax - inMin), 0, 1) + 0; // + 0 normalizes -0 to 0
}

/**
 * Exponential moving average smoother. Stateful, tiny, and pure w.r.t. its own
 * closed-over value — one instance per signal.
 */
export function makeSmoother(alpha = 0.6) {
  let value = null;
  return (sample) => {
    if (sample == null || Number.isNaN(sample)) return value;
    value = value == null ? sample : alpha * sample + (1 - alpha) * value;
    return value;
  };
}
