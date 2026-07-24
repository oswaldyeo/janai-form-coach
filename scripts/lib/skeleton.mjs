// Reusable parametric skeleton + equipment/furniture primitives for the
// deterministic Form Coach catalog visual engine.
//
// Everything here is pure: given a pose descriptor (joint angles + lengths) it
// returns SVG fragment strings and the resolved joint coordinates, so equipment
// glyphs can attach to the exact hand/foot the skeleton computed. No randomness,
// no DOM, no time — identical inputs always yield byte-identical output.

export const C = {
  ink: '#17212b', muted: '#536273', accent: '#ff334f', accent2: '#25a8a0',
  skin: '#f4c9a8', shirt: '#8fe0da', equipment: '#708090', steel: '#94a3b8',
  floor: '#cfd7df', bg: '#f8fafc', white: '#fff', pad: '#b8c2cc',
};

const RAD = Math.PI / 180;
const r2 = (n) => { const v = Math.round(n * 100) / 100; return v === 0 ? 0 : v; }; // stable 2dp, no -0

// Segment: from point `p`, rotate `deg` off vertical-up (0=up, 90=+x/right,
// 180=down, 270/-90=left), advance `len`. Screen y grows downward.
export function seg(p, deg, len) {
  return { x: r2(p.x + len * Math.sin(deg * RAD)), y: r2(p.y - len * Math.cos(deg * RAD)) };
}

// Two-bar inverse kinematics: given a root `a` and a target `c`, plus segment
// lengths, return the middle joint (knee/elbow). `bend` (+1/-1) picks which way
// the joint flexes. Target is clamped to the reachable envelope so a
// floor-locked foot never yields NaN when the limb is fully extended.
export function ik2(a, c, l1, l2, bend = 1) {
  let dx = c.x - a.x, dy = c.y - a.y;
  let d = Math.hypot(dx, dy);
  const max = (l1 + l2) * 0.999, min = Math.abs(l1 - l2) * 1.001;
  if (d > max) { const s = max / (d || 1); dx *= s; dy *= s; d = max; }
  if (d < min) { const s = (min / (d || 1)); dx *= s; dy *= s; d = min; }
  const base = Math.atan2(dy, dx);
  const cosA = Math.max(-1, Math.min(1, (d * d + l1 * l1 - l2 * l2) / (2 * d * l1)));
  const ang = base + bend * Math.acos(cosA);
  return { x: r2(a.x + l1 * Math.cos(ang)), y: r2(a.y + l1 * Math.sin(ang)) };
}

// Point at fixed offset from another (screen coords).
export const pt = (x, y) => ({ x: r2(x), y: r2(y) });

// Standard proportions (px). Kept in one place so every archetype is consistent.
export const P = {
  headR: 27, neck: 14, spine: 150, upper: 74, fore: 70,
  thigh: 98, shin: 94, foot: 42, hipW: 26, shoulderW: 30,
};

// ── low-level SVG helpers ────────────────────────────────────────────────
const L = (a, b, cls = 'body') => `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="${cls}"/>`;
const dot = (p, rad = 8, fill = C.skin) => `<circle cx="${p.x}" cy="${p.y}" r="${rad}" fill="${fill}" stroke="${C.ink}" stroke-width="5"/>`;
const headAt = (p, rad = P.headR) => `<circle cx="${p.x}" cy="${p.y}" r="${rad}" fill="${C.skin}" stroke="${C.ink}" stroke-width="7"/>`;

function quad(a, b, c, d, fill = C.shirt) {
  return `<polygon points="${a.x},${a.y} ${b.x},${b.y} ${c.x},${c.y} ${d.x},${d.y}" fill="${fill}" stroke="${C.ink}" stroke-width="8" stroke-linejoin="round"/>`;
}

// Perpendicular offset points for a tapered torso built along the spine vector.
function torsoQuad(hip, shoulder, hipW, shoulderW) {
  const dx = shoulder.x - hip.x, dy = shoulder.y - hip.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len; // unit perpendicular
  const hL = { x: hip.x + px * hipW, y: hip.y + py * hipW };
  const hR = { x: hip.x - px * hipW, y: hip.y - py * hipW };
  const sL = { x: shoulder.x + px * shoulderW, y: shoulder.y + py * shoulderW };
  const sR = { x: shoulder.x - px * shoulderW, y: shoulder.y - py * shoulderW };
  return quad(hL, sL, sR, hR);
}

// Derive the standard upper body (shoulder, neck, head) from a hip point and a
// spine lean angle. Shared by every side-view archetype.
export function spine(hip, spineDeg = 0, headDeg = null) {
  const shoulder = seg(hip, spineDeg, P.spine);
  const hd = headDeg == null ? spineDeg : headDeg;
  return { shoulder, head: seg(shoulder, hd, P.neck + P.headR) };
}

// ── side-view (sagittal) renderer — joint-based ──────────────────────────
// J = { hip, shoulder, head, elbow, wrist, knee, ankle, toe,
//       far?:{elbow,wrist,knee,ankle,toe}, working?:'arm'|'leg' }
// Any joint may be omitted to hide that limb. Coordinates come from the
// archetype (via seg / ik2), so equipment can attach to the exact hand/foot.
export function sideFigure(J) {
  const p = P;
  const far = J.far || {};
  const workArm = J.working === 'arm' ? 'working' : 'body';
  const workLeg = J.working === 'leg' ? 'working' : 'body';
  const parts = [];
  // far (behind) limbs, muted
  if (far.elbow) parts.push(L(J.shoulder, far.elbow, 'limb2'), far.wrist ? L(far.elbow, far.wrist, 'limb2') : '');
  if (far.knee) parts.push(L(J.hip, far.knee, 'limb2'), far.ankle ? L(far.knee, far.ankle, 'limb2') : '', (far.ankle && far.toe) ? L(far.ankle, far.toe, 'limb2') : '');
  // torso
  parts.push(torsoQuad(J.hip, J.shoulder, p.hipW, p.shoulderW));
  // near legs
  if (J.knee) parts.push(L(J.hip, J.knee, workLeg), J.ankle ? L(J.knee, J.ankle, workLeg) : '', (J.ankle && J.toe) ? L(J.ankle, J.toe, workLeg) : '');
  // near arms
  if (J.elbow) parts.push(L(J.shoulder, J.elbow, workArm), J.wrist ? L(J.elbow, J.wrist, workArm) : '');
  // joints + head
  if (J.knee) parts.push(dot(J.knee, 7));
  if (J.ankle) parts.push(dot(J.ankle, 7));
  if (J.elbow) parts.push(dot(J.elbow, 7));
  parts.push(dot(J.hip, 8), headAt(J.head));
  if (J.wrist) parts.push(dot(J.wrist, 8));
  return parts.join('');
}

// ── front-view (coronal) renderer — symmetric limbs ──────────────────────
// J = { hip, shoulder, head, sR,sL, eR,eL, wR,wL, hR,hL, kR,kL, aR,aL,
//       working?:'arm' }
export function frontFigure(J) {
  const p = P;
  const workArm = J.working === 'arm' ? 'working' : 'body';
  const footR = J.aR ? { x: J.aR.x + p.foot * 0.55, y: J.aR.y } : null;
  const footL = J.aL ? { x: J.aL.x - p.foot * 0.55, y: J.aL.y } : null;
  const parts = [quad(J.hL, J.sL, J.sR, J.hR)];
  if (J.kR) parts.push(L(J.hR, J.kR), L(J.kR, J.aR), footR ? L(J.aR, footR) : '');
  if (J.kL) parts.push(L(J.hL, J.kL), L(J.kL, J.aL), footL ? L(J.aL, footL) : '');
  if (J.eR) parts.push(L(J.sR, J.eR, workArm), J.wR ? L(J.eR, J.wR, workArm) : '');
  if (J.eL) parts.push(L(J.sL, J.eL, workArm), J.wL ? L(J.eL, J.wL, workArm) : '');
  if (J.kR) parts.push(dot(J.kR, 7), dot(J.kL, 7));
  if (J.eR) parts.push(dot(J.eR, 7), dot(J.eL, 7));
  if (J.wR) parts.push(dot(J.wR, 8));
  if (J.wL) parts.push(dot(J.wL, 8));
  parts.push(dot(J.hR, 8), dot(J.hL, 8), headAt(J.head));
  return parts.join('');
}

// Build a symmetric front-view skeleton from a hip point + arm/leg angles.
// Returns the joint set consumable by frontFigure(); archetypes override arms
// per-phase. shoulderW/hipHalf are horizontal spreads.
export function frontSkeleton(hip, { arm, leg, shoulderW = 46, hipHalf = 26, spineDeg = 0, working } = {}) {
  const { shoulder, head } = spine(hip, spineDeg);
  const sR = { x: r2(shoulder.x + shoulderW), y: shoulder.y };
  const sL = { x: r2(shoulder.x - shoulderW), y: shoulder.y };
  const hR = { x: r2(hip.x + hipHalf), y: hip.y };
  const hL = { x: r2(hip.x - hipHalf), y: hip.y };
  const a = arm || { upper: 178, fore: 178 };
  const lg = leg || { thigh: 180, shin: 180 };
  const eR = seg(sR, a.upper, P.upper), wR = seg(eR, a.fore, P.fore);
  const eL = seg(sL, -a.upper, P.upper), wL = seg(eL, -a.fore, P.fore);
  const kR = seg(hR, lg.thigh, P.thigh), aR = seg(kR, lg.shin, P.shin);
  const kL = seg(hL, -lg.thigh, P.thigh), aL = seg(kL, -lg.shin, P.shin);
  return { hip, shoulder, head, sR, sL, hR, hL, eR, eL, wR, wL, kR, kL, aR, aL, working };
}

// ── equipment & furniture primitives (all attach to computed joints) ─────
export const eq = {
  // Dumbbell centred on a hand point, oriented across a small span.
  dumbbell(p, len = 34) {
    const a = { x: p.x - len / 2, y: p.y }, b = { x: p.x + len / 2, y: p.y };
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="equip"/>`
      + `<circle cx="${a.x}" cy="${a.y}" r="11" fill="${C.equipment}" stroke="${C.ink}" stroke-width="4"/>`
      + `<circle cx="${b.x}" cy="${b.y}" r="11" fill="${C.equipment}" stroke="${C.ink}" stroke-width="4"/>`;
  },
  // Barbell: a long bar through two hand points with plates at both ends.
  barbell(a, b, plate = 26) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, ext = 70;
    const A = { x: a.x - ux * ext, y: a.y - uy * ext };
    const B = { x: b.x + ux * ext, y: b.y + uy * ext };
    const pw = 9;
    const plateAt = (c) => `<rect x="${r2(c.x - pw)}" y="${r2(c.y - plate)}" width="${pw * 2}" height="${plate * 2}" rx="4" fill="${C.equipment}" stroke="${C.ink}" stroke-width="4" transform="rotate(${r2(Math.atan2(dy, dx) * 180 / Math.PI)} ${c.x} ${c.y})"/>`;
    return `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="bar"/>${plateAt(A)}${plateAt(B)}`;
  },
  // Kettlebell hanging from a hand.
  kettlebell(p) {
    return `<path d="M${p.x - 8} ${p.y} q -6 22 14 22 q 20 0 14 -22 z" fill="${C.equipment}" stroke="${C.ink}" stroke-width="4"/>`
      + `<path d="M${p.x - 8} ${p.y + 2} q 14 -18 28 0" fill="none" stroke="${C.ink}" stroke-width="5"/>`;
  },
  // Plate held between hands (Svend / plate raise).
  plate(p, r = 22) {
    return `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="none" stroke="${C.equipment}" stroke-width="10"/>`;
  },
  // Resistance band as a dashed catenary between two anchor points.
  band(a, b) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + 18;
    return `<path d="M${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}" fill="none" stroke="${C.accent}" stroke-width="9" stroke-linecap="round" stroke-dasharray="18 10"/>`;
  },
  // Cable from an anchor (pulley) to a hand, with a stack glyph at the anchor.
  cable(anchor, hand) {
    return `<line x1="${anchor.x}" y1="${anchor.y}" x2="${hand.x}" y2="${hand.y}" class="cable"/>`
      + `<circle cx="${anchor.x}" cy="${anchor.y}" r="9" fill="${C.accent2}" stroke="${C.ink}" stroke-width="4"/>`;
  },
  // Weight-stack column + pulley head (for machine / pulldown / cable).
  stack(x, top = 150, bottom = 500) {
    return `<rect x="${x - 26}" y="${top}" width="52" height="${bottom - top}" rx="8" fill="none" stroke="${C.steel}" stroke-width="6"/>`
      + `<rect x="${x - 20}" y="${bottom - 90}" width="40" height="80" rx="5" fill="${C.steel}" stroke="${C.ink}" stroke-width="4"/>`
      + `<circle cx="${x}" cy="${top}" r="10" fill="none" stroke="${C.steel}" stroke-width="6"/>`;
  },
  // Flat / incline bench. angleDeg tilts the pad; seat at (x,y) = head end.
  bench(cx, topY, angleDeg = 0, len = 240) {
    const a = angleDeg * RAD;
    const half = len / 2;
    const dx = Math.cos(a) * half, dy = Math.sin(a) * half;
    const A = { x: cx - dx, y: topY + dy }, B = { x: cx + dx, y: topY - dy };
    const legY = topY + 70;
    return `<line x1="${r2(A.x)}" y1="${r2(A.y)}" x2="${r2(B.x)}" y2="${r2(B.y)}" stroke="${C.pad}" stroke-width="20" stroke-linecap="round"/>`
      + `<line x1="${r2(A.x + 20)}" y1="${r2(A.y)}" x2="${r2(A.x + 20)}" y2="${legY}" class="frame"/>`
      + `<line x1="${r2(B.x - 20)}" y1="${r2(B.y)}" x2="${r2(B.x - 20)}" y2="${legY}" class="frame"/>`;
  },
  // Simple machine frame / upright post.
  post(x, top = 120, bottom = 520) {
    return `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" class="frame"/>`;
  },
  // A box / step / plyo platform.
  box(cx, topY, w = 150, h = 120) {
    return `<rect x="${cx - w / 2}" y="${topY}" width="${w}" height="${h}" rx="6" fill="none" stroke="${C.equipment}" stroke-width="8"/>`;
  },
  // Pull-up / dip bars: horizontal bar at height y spanning x1..x2.
  hbar(x1, x2, y) {
    return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="frame"/>`
      + `<line x1="${x1}" y1="${y}" x2="${x1}" y2="120" class="frame"/>`
      + `<line x1="${x2}" y1="${y}" x2="${x2}" y2="120" class="frame"/>`;
  },
};

// Directional motion arrow along a quadratic path.
export const arrow = (d, color = C.accent) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" marker-end="url(#arrow)"/>`;

export const floorLine = (y = 525) => `<line x1="70" y1="${y}" x2="830" y2="${y}" class="floor"/>`;

export const smallText = (x, y, s) => `<text x="${x}" y="${y}" class="small">${s}</text>`;

// ── frame assembler ──────────────────────────────────────────────────────
export function frame(title, phase, cue, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600" role="img" aria-labelledby="t d">`
    + `<title id="t">${escapeXml(title)} — ${escapeXml(phase)}</title><desc id="d">${escapeXml(cue)}</desc>`
    + `<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="${C.accent}"/></marker></defs>`
    + `<style>`
    + `.body{stroke:${C.ink};stroke-width:15;stroke-linecap:round;stroke-linejoin:round;fill:none}`
    + `.limb2{stroke:${C.muted};stroke-width:12;stroke-linecap:round;stroke-linejoin:round;fill:none}`
    + `.working{stroke:${C.accent};stroke-width:16;stroke-linecap:round;stroke-linejoin:round;fill:none}`
    + `.floor{stroke:${C.floor};stroke-width:9;stroke-linecap:round}`
    + `.equip{stroke:${C.equipment};stroke-width:12;stroke-linecap:round}`
    + `.bar{stroke:${C.equipment};stroke-width:11;stroke-linecap:round}`
    + `.cable{stroke:${C.accent2};stroke-width:7;stroke-linecap:round}`
    + `.frame{stroke:${C.steel};stroke-width:10;stroke-linecap:round}`
    + `.label{font:800 25px system-ui,sans-serif;letter-spacing:2px;fill:${C.accent}}`
    + `.title{font:800 29px system-ui,sans-serif;fill:${C.ink}}`
    + `.cue{font:600 22px system-ui,sans-serif;fill:${C.muted}}`
    + `.small{font:700 18px system-ui,sans-serif;fill:${C.muted}}`
    + `</style>`
    + `<rect width="900" height="600" rx="28" fill="${C.bg}"/>`
    + `<text x="52" y="54" class="label">${escapeXml(phase.toUpperCase())}</text>`
    + `<text x="52" y="92" class="title">${escapeXml(title)}</text>`
    + `<text x="52" y="572" class="cue">${escapeXml(cue)}</text>`
    + `${body}</svg>`;
}

export function escapeXml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
