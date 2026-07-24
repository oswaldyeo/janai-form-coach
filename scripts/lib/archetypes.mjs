// Archetype library — each function returns { view, frames:[[phase,cue,body],
// [phase,cue,body]] } for a movement family, parameterised by grip / equipment /
// posture / unilateral flags supplied by the resolver. Poses are built from the
// skeleton primitives so every joint is geometrically real, not eyeballed.

import {
  C, P, seg, ik2, pt, spine, sideFigure, frontFigure, frontSkeleton,
  eq, arrow, floorLine, smallText,
} from './skeleton.mjs';

const FLOOR = 525;
const HIPX = 430;

// Arm hanging straight down from a shoulder (gravity-loaded grip).
const hang = (sh, len = P.upper + P.fore) => pt(sh.x, sh.y + len);

// Attach a hand-held implement (side view: one visible hand).
function heldSide(equip, hand, other) {
  switch (equip) {
    case 'barbell': return eq.plate(hand, 24); // plate seen end-on
    case 'dumbbell': return eq.dumbbell(hand);
    case 'kettlebell': return eq.kettlebell(hand);
    case 'plate': return eq.plate(hand);
    default: return '';
  }
}

// ── FRONT-view isolation: curl ───────────────────────────────────────────
export function curl({ equip = 'dumbbell', grip = 'sup', unilateral = false, pad = null } = {}) {
  const hip = pt(HIPX, 348);
  const start = frontSkeleton(hip, { arm: { upper: 176, fore: 176 }, working: 'arm' });
  const finish = frontSkeleton(hip, { arm: { upper: 172, fore: 22 }, working: 'arm' });
  const gripLabel = grip === 'neutral' ? 'Neutral (hammer) grip' : grip === 'pronated' ? 'Palms-down (reverse) grip' : 'Palms-up grip';

  const load = (J, phase) => {
    if (equip === 'barbell') return eq.barbell(J.wR, J.wL);
    if (equip === 'cable') return eq.stack(HIPX, 420, 505) + eq.cable(pt(HIPX, 500), J.wR) + eq.cable(pt(HIPX, 500), J.wL);
    if (equip === 'band') return eq.band(pt(J.aR.x, FLOOR), J.wR) + eq.band(pt(J.aL.x, FLOOR), J.wL);
    if (equip === 'plate') return eq.plate(pt((J.wR.x + J.wL.x) / 2, (J.wR.y + J.wL.y) / 2));
    return eq.dumbbell(J.wR) + eq.dumbbell(J.wL);
  };
  const padSvg = pad ? `<line x1="${HIPX - 70}" y1="360" x2="${HIPX + 70}" y2="360" stroke="${C.pad}" stroke-width="18" stroke-linecap="round"/>` : '';

  return {
    view: 'front',
    frames: [
      ['START', `Elbows pinned at sides · ${gripLabel.toLowerCase()}`, floorLine() + padSvg + frontFigure(start) + load(start)],
      ['CURL', 'Bend elbows; lift without swinging the shoulders', floorLine() + padSvg + frontFigure(finish) + load(finish)
        + arrow(`M${HIPX + 120} 470 Q ${HIPX + 150} 400 ${HIPX + 120} 340`)],
    ],
  };
}

// ── FRONT-view overhead / shoulder press ─────────────────────────────────
export function press({ equip = 'dumbbell', seated = false } = {}) {
  const hip = pt(HIPX, 348);
  const start = frontSkeleton(hip, { arm: { upper: 118, fore: -22 }, working: 'arm', shoulderW: 46 });
  const finish = frontSkeleton(hip, { arm: { upper: 8, fore: 6 }, working: 'arm', shoulderW: 46 });
  const load = (J) => equip === 'barbell' ? eq.barbell(J.wR, J.wL)
    : equip === 'machine' ? eq.post(J.wR.x, 120, J.wR.y) + eq.post(J.wL.x, 120, J.wL.y) + eq.dumbbell(J.wR) + eq.dumbbell(J.wL)
    : eq.dumbbell(J.wR) + eq.dumbbell(J.wL);
  const seat = seated ? `<line x1="${HIPX - 60}" y1="${hip.y + 40}" x2="${HIPX + 60}" y2="${hip.y + 40}" stroke="${C.pad}" stroke-width="18" stroke-linecap="round"/>` : '';
  return {
    view: 'front',
    frames: [
      ['START', 'Weight at shoulders · elbows under wrists', floorLine() + seat + frontFigure(start) + load(start)],
      ['PRESS', 'Drive straight overhead; ribs down, don\'t arch', floorLine() + seat + frontFigure(finish) + load(finish)
        + arrow(`M${HIPX + 130} 300 L ${HIPX + 130} 170`)],
    ],
  };
}

// ── FRONT-view lateral raise / band pullapart ────────────────────────────
export function lateralRaise({ equip = 'dumbbell', unilateral = false } = {}) {
  const hip = pt(HIPX, 348);
  const start = frontSkeleton(hip, { arm: { upper: 172, fore: 172 }, working: 'arm' });
  const finish = frontSkeleton(hip, { arm: { upper: 92, fore: 92 }, working: 'arm' });
  const load = (J) => equip === 'cable' ? eq.cable(pt(HIPX, 500), J.wR)
    : equip === 'band' ? eq.band(pt(J.aR.x, FLOOR), J.wR) + eq.band(pt(J.aL.x, FLOOR), J.wL)
    : eq.dumbbell(J.wR) + eq.dumbbell(J.wL);
  return {
    view: 'front',
    frames: [
      ['START', 'Arms at sides · slight elbow bend', floorLine() + frontFigure(start) + load(start)],
      ['RAISE', 'Lift out to shoulder height; lead with the elbows', floorLine() + frontFigure(finish) + load(finish)
        + arrow(`M${finish.wR.x + 40} ${finish.wR.y + 60} Q ${finish.wR.x + 70} ${finish.wR.y} ${finish.wR.x + 40} ${finish.wR.y - 20}`)],
    ],
  };
}

// ── FRONT-view upright row ───────────────────────────────────────────────
export function uprightRow({ equip = 'barbell' } = {}) {
  const hip = pt(HIPX, 348);
  const start = frontSkeleton(hip, { arm: { upper: 176, fore: 176 }, working: 'arm' });
  // hands rise to chin at centre, elbows flare high/out
  const s2 = frontSkeleton(hip, { arm: { upper: 150, fore: -150 }, working: 'arm' });
  const load = (J) => equip === 'cable' ? eq.stack(HIPX, 430, 505) + eq.cable(pt(HIPX, 500), pt((J.wR.x + J.wL.x) / 2, (J.wR.y + J.wL.y) / 2)) : equip === 'dumbbell' ? eq.dumbbell(J.wR) + eq.dumbbell(J.wL) : eq.barbell(J.wR, J.wL);
  return {
    view: 'front',
    frames: [
      ['START', 'Bar against thighs · hands shoulder-width', floorLine() + frontFigure(start) + load(start)],
      ['PULL', 'Lead with the elbows up to collarbone height', floorLine() + frontFigure(s2) + load(s2)
        + arrow(`M${HIPX + 110} 430 L ${HIPX + 110} 300`)],
    ],
  };
}

// ── FRONT-view shrug ─────────────────────────────────────────────────────
export function shrug({ equip = 'dumbbell' } = {}) {
  const hip = pt(HIPX, 348);
  const start = frontSkeleton(hip, { arm: { upper: 178, fore: 178 } });
  const up = frontSkeleton(pt(HIPX, 348), { arm: { upper: 178, fore: 178 } });
  // raise shoulder points to fake trap elevation
  const lift = (J) => { const d = 26; return { ...J, sR: pt(J.sR.x, J.sR.y - d), sL: pt(J.sL.x, J.sL.y - d) }; };
  const load = (J) => equip === 'barbell' ? eq.barbell(J.wR, J.wL) : equip === 'cable' ? eq.dumbbell(J.wR) + eq.dumbbell(J.wL) : eq.dumbbell(J.wR) + eq.dumbbell(J.wL);
  return {
    view: 'front',
    frames: [
      ['START', 'Arms long · shoulders relaxed down', floorLine() + frontFigure(start) + load(start)],
      ['SHRUG', 'Lift shoulders straight up to the ears; no bending the arms', floorLine() + frontFigure(lift(up)) + load(up)
        + arrow(`M${HIPX + 120} 240 L ${HIPX + 120} 180`) + arrow(`M${HIPX - 120} 240 L ${HIPX - 120} 180`)],
    ],
  };
}

// ── SIDE-view triceps pushdown ───────────────────────────────────────────
export function pushdown({ rope = false, unilateral = false } = {}) {
  const hip = pt(HIPX, 348);
  const { shoulder, head } = spine(hip, 4);
  const elbow = pt(shoulder.x + 14, shoulder.y + P.upper); // upper arm pinned, slightly fwd
  const wristBent = seg(elbow, 55, P.fore); // forearm up-forward (bent)
  const wristExt = seg(elbow, 150, P.fore); // forearm down (extended)
  const leg = { knee: seg(hip, 178, P.thigh), ankle: pt(HIPX + 4, FLOOR), toe: pt(HIPX + 46, FLOOR) };
  const anchor = pt(shoulder.x + 30, 150);
  const base = (wr) => ({ hip, shoulder, head, elbow, wrist: wr, knee: leg.knee, ankle: leg.ankle, toe: leg.toe, working: 'arm' });
  const stack = eq.stack(anchor.x, 150, 505);
  return {
    view: 'side',
    frames: [
      ['START', 'Elbows pinned to ribs · forearms up', floorLine() + stack + eq.cable(anchor, wristBent) + sideFigure(base(wristBent))],
      ['PRESS DOWN', 'Extend at the elbow only; lock out, then return', floorLine() + stack + eq.cable(anchor, wristExt) + sideFigure(base(wristExt))
        + arrow(`M${elbow.x + 60} ${elbow.y + 20} L ${elbow.x + 60} ${wristExt.y}`)],
    ],
  };
}

// ── SIDE-view overhead triceps extension ─────────────────────────────────
export function overheadTriceps({ equip = 'dumbbell' } = {}) {
  const hip = pt(HIPX, 348);
  const { shoulder, head } = spine(hip, 4);
  const elbow = seg(shoulder, 10, P.upper); // upper arm up
  const wristBent = seg(elbow, 200, P.fore); // forearm down behind head
  const wristExt = seg(elbow, 8, P.fore); // forearm up (extended)
  const leg = { knee: seg(hip, 178, P.thigh), ankle: pt(HIPX + 4, FLOOR), toe: pt(HIPX + 46, FLOOR) };
  const base = (wr) => ({ hip, shoulder, head, elbow, wrist: wr, knee: leg.knee, ankle: leg.ankle, toe: leg.toe, working: 'arm' });
  const load = (wr) => equip === 'cable' ? eq.cable(pt(shoulder.x - 40, 505), wr) + eq.stack(shoulder.x - 40, 300, 505) : equip === 'barbell' ? eq.plate(wr, 20) : eq.dumbbell(wr);
  return {
    view: 'side',
    frames: [
      ['START', 'Upper arms vertical by the ears', floorLine() + sideFigure(base(wristBent)) + load(wristBent)],
      ['EXTEND', 'Straighten the elbows overhead; keep upper arms still', floorLine() + sideFigure(base(wristExt)) + load(wristExt)
        + arrow(`M${elbow.x + 55} ${wristBent.y} Q ${elbow.x + 80} ${elbow.y} ${elbow.x + 45} ${wristExt.y}`)],
    ],
  };
}

// ── SIDE-view triceps kickback ───────────────────────────────────────────
export function kickback({ equip = 'dumbbell' } = {}) {
  const hip = pt(HIPX, 360);
  const { shoulder, head } = spine(hip, 62); // torso hinged forward
  const elbow = seg(shoulder, 250, P.upper); // upper arm back, ~horizontal
  const wristBent = seg(elbow, 170, P.fore); // forearm hanging down
  const wristExt = seg(elbow, 250, P.fore); // forearm back (extended)
  const knee = seg(hip, 172, P.thigh), ankle = pt(hip.x - 10, FLOOR), toe = pt(hip.x + 32, FLOOR);
  const base = (wr) => ({ hip, shoulder, head, elbow, wrist: wr, knee, ankle, toe, working: 'arm' });
  const load = (wr) => equip === 'cable' ? eq.cable(pt(shoulder.x + 120, 250), wr) : eq.dumbbell(wr);
  return {
    view: 'side',
    frames: [
      ['START', 'Torso hinged · upper arm pinned back', floorLine() + sideFigure(base(wristBent)) + load(wristBent)],
      ['KICK BACK', 'Straighten the elbow behind you; squeeze the triceps', floorLine() + sideFigure(base(wristExt)) + load(wristExt)
        + arrow(`M${elbow.x - 30} ${wristBent.y} Q ${elbow.x - 70} ${elbow.y + 10} ${wristExt.x - 10} ${wristExt.y}`)],
    ],
  };
}

// ── SIDE-view lying skullcrusher / floor triceps ─────────────────────────
export function skullcrusher({ equip = 'barbell' } = {}) {
  const benchY = 430;
  const shoulder = pt(360, benchY), hip = pt(560, benchY);
  const head = pt(320, benchY + 6);
  const knee = pt(640, benchY + 40), ankle = pt(660, FLOOR), toe = pt(700, FLOOR);
  const elbow = seg(shoulder, 20, P.upper); // upper arm up toward ceiling
  const wristBent = seg(elbow, 300, P.fore); // forearm back toward head (bent)
  const wristExt = seg(elbow, 12, P.fore); // forearm up (extended)
  const bench = `<line x1="300" y1="${benchY + 26}" x2="600" y2="${benchY + 26}" stroke="${C.pad}" stroke-width="20" stroke-linecap="round"/>`;
  const base = (wr) => ({ hip, shoulder, head, elbow, wrist: wr, knee, ankle, toe, working: 'arm' });
  const load = (wr) => equip === 'dumbbell' ? eq.dumbbell(wr) : eq.plate(wr, 20);
  return {
    view: 'side',
    frames: [
      ['START', 'Upper arms vertical · weight above the forehead', floorLine() + bench + sideFigure(base(wristBent)) + load(wristBent)],
      ['EXTEND', 'Straighten the elbows; only the forearms move', floorLine() + bench + sideFigure(base(wristExt)) + load(wristExt)
        + arrow(`M${elbow.x - 40} ${wristBent.y} Q ${elbow.x} ${elbow.y - 40} ${wristExt.x} ${wristExt.y}`)],
    ],
  };
}

// ── SIDE-view squat family ───────────────────────────────────────────────
export function squat({ hold = 'back', depth = 'parallel', frame = null, unilateral = false } = {}) {
  const ankle = pt(HIPX + 6, FLOOR - 6), toe = pt(HIPX + 52, FLOOR - 6);
  const topHip = pt(HIPX, 336);
  const botY = depth === 'deep' ? 432 : 412;
  const botHip = pt(HIPX - 24, botY);
  const lean = hold === 'front' || hold === 'goblet' || hold === 'zercher' ? 12 : 26;
  const mk = (hip, spineDeg) => {
    const { shoulder, head } = spine(hip, spineDeg);
    const knee = ik2(hip, ankle, P.thigh, P.shin, 1);
    let elbow, wrist, farLeg;
    if (hold === 'back' || hold === 'front') {
      // hands grip a bar at shoulder height
      elbow = seg(shoulder, 235, P.upper); wrist = seg(elbow, 320, P.fore * 0.7);
    } else if (hold === 'goblet' || hold === 'zercher') {
      elbow = seg(shoulder, 200, P.upper); wrist = seg(elbow, 320, P.fore * 0.7);
    } else {
      elbow = seg(shoulder, 190, P.upper); wrist = hang(shoulder);
    }
    if (unilateral) {
      // pistol: far leg extended forward off the floor
      farLeg = { knee: seg(hip, 120, P.thigh), ankle: seg(seg(hip, 120, P.thigh), 110, P.shin), toe: null };
    }
    return { hip, shoulder, head, knee, ankle, toe, elbow, wrist, working: 'leg', far: farLeg };
  };
  const barSvg = (J) => {
    if (hold === 'back') return eq.barbell(pt(J.shoulder.x - 6, J.shoulder.y), pt(J.shoulder.x + 6, J.shoulder.y));
    if (hold === 'front') return eq.barbell(pt(J.shoulder.x + 20, J.shoulder.y + 6), pt(J.shoulder.x + 34, J.shoulder.y + 6));
    if (hold === 'goblet') return eq.kettlebell(pt(J.shoulder.x + 18, J.shoulder.y + 20));
    if (hold === 'zercher') return eq.plate(pt(J.shoulder.x + 30, J.shoulder.y + 30), 18);
    return '';
  };
  const frameSvg = frame === 'hack' ? eq.post(HIPX - 120, 130, 520) + `<line x1="${HIPX - 120}" y1="200" x2="${HIPX + 30}" y2="260" class="frame"/>`
    : frame === 'machine' ? eq.post(HIPX + 150, 130, 520) : frame === 'smith' ? eq.post(HIPX - 130, 120, 520) + eq.post(HIPX + 150, 120, 520) : '';
  const top = mk(topHip, lean * 0.4), bot = mk(botHip, lean);
  return {
    view: 'side',
    frames: [
      ['START', unilateral ? 'Stand tall on one leg' : 'Stand tall · feet flat · chest up', floorLine() + frameSvg + sideFigure(top) + barSvg(top)],
      ['DESCEND', 'Sit hips back and down; knees track over toes', floorLine() + frameSvg + sideFigure(bot) + barSvg(bot)
        + arrow(`M${HIPX + 150} 340 L ${HIPX + 150} 470`)],
    ],
  };
}

// ── FRONT-view wide/sumo squat ───────────────────────────────────────────
export function sumoSquat({ equip = 'none' } = {}) {
  const topHip = pt(HIPX, 336), botHip = pt(HIPX, 420);
  const mk = (hip, deep) => {
    const half = 70;
    const hR = pt(hip.x + 30, hip.y), hL = pt(hip.x - 30, hip.y);
    const aR = pt(hip.x + half + (deep ? 18 : 0), FLOOR), aL = pt(hip.x - half - (deep ? 18 : 0), FLOOR);
    const kR = ik2(hR, aR, P.thigh, P.shin, 1), kL = ik2(hL, aL, P.thigh, P.shin, -1);
    const { shoulder, head } = spine(hip, 0);
    const sR = pt(shoulder.x + 44, shoulder.y), sL = pt(shoulder.x - 44, shoulder.y);
    const wR = pt(hip.x + 16, hip.y + 40), wL = pt(hip.x - 16, hip.y + 40);
    const eR = pt((sR.x + wR.x) / 2 + 10, (sR.y + wR.y) / 2), eL = pt((sL.x + wL.x) / 2 - 10, (sL.y + wL.y) / 2);
    return { hip, shoulder, head, sR, sL, hR, hL, kR, kL, aR, aL, eR, eL, wR, wL };
  };
  const load = (J) => equip === 'kettlebell' ? eq.kettlebell(pt(J.hip.x - 8, J.wR.y)) : equip === 'dumbbell' ? eq.dumbbell(pt(J.hip.x, J.wR.y)) : equip === 'barbell' ? eq.barbell(pt(J.sR.x, J.sR.y), pt(J.sL.x, J.sL.y)) : '';
  const top = mk(topHip, false), bot = mk(botHip, true);
  return {
    view: 'front',
    frames: [
      ['START', 'Wide stance · toes turned out', floorLine() + frontFigure(top) + load(top)],
      ['SQUAT', 'Drop straight down between the knees; chest tall', floorLine() + frontFigure(bot) + load(bot)
        + arrow(`M${HIPX} 360 L ${HIPX} 440`)],
    ],
  };
}

// ── SIDE-view lunge / split squat / step-up ──────────────────────────────
export function lunge({ hold = 'none', rear = 'floor', step = false, reverse = false } = {}) {
  const frontAnkle = pt(HIPX + 70, FLOOR - 6);
  const rearAnkle = rear === 'bench' ? pt(HIPX - 90, FLOOR - 70) : pt(HIPX - 96, FLOOR - 6);
  const stepBox = step ? eq.box(HIPX + 70, FLOOR - 110, 150, 116) : '';
  const fAnkle = step ? pt(HIPX + 70, FLOOR - 116) : frontAnkle;
  const mk = (hip, spineDeg) => {
    const { shoulder, head } = spine(hip, spineDeg);
    const knee = ik2(hip, fAnkle, P.thigh, P.shin, 1);
    const fkneeRear = ik2(hip, rearAnkle, P.thigh, P.shin, -1);
    const rearToe = pt(rearAnkle.x - 30, rearAnkle.y + (rear === 'bench' ? 8 : 0));
    let elbow, wrist;
    if (hold === 'back') { elbow = seg(shoulder, 235, P.upper); wrist = seg(elbow, 320, P.fore * 0.7); }
    else { elbow = seg(shoulder, 188, P.upper); wrist = hang(shoulder); }
    return { hip, shoulder, head, knee, ankle: fAnkle, toe: pt(fAnkle.x + 44, fAnkle.y),
      elbow, wrist, working: 'leg',
      far: { knee: fkneeRear, ankle: rearAnkle, toe: rearToe } };
  };
  const load = (J) => hold === 'dumbbell' ? eq.dumbbell(hang(J.shoulder)) : hold === 'back' ? eq.barbell(pt(J.shoulder.x - 6, J.shoulder.y), pt(J.shoulder.x + 6, J.shoulder.y)) : '';
  const top = mk(pt(HIPX, step ? 300 : 336), 6);
  const bot = mk(pt(HIPX + 6, step ? 300 : 424), 10);
  const startFrame = step
    ? ['START', 'One foot planted on the step', floorLine() + stepBox + sideFigure(bot) + load(bot)]
    : ['START', reverse ? 'Stand tall before stepping back' : 'Tall split stance · weight centred', floorLine() + sideFigure(top) + load(top)];
  const workFrame = step
    ? ['DRIVE UP', 'Push through the top foot to stand; control the descent', floorLine() + stepBox + sideFigure(top) + load(top) + arrow(`M${HIPX + 170} 420 L ${HIPX + 170} 320`)]
    : ['DESCEND', 'Drop the back knee straight down; front shin stays vertical', floorLine() + stepBox + sideFigure(bot) + load(bot) + arrow(`M${HIPX + 150} 350 L ${HIPX + 150} 460`)];
  return { view: 'side', frames: [startFrame, workFrame] };
}

// ── SIDE-view hip hinge: deadlift / RDL / good-morning ────────────────────
export function hinge({ equip = 'barbell', style = 'rdl', unilateral = false } = {}) {
  const ankle = pt(HIPX + 4, FLOOR - 6), toe = pt(HIPX + 50, FLOOR - 6);
  const tall = pt(HIPX, 336);
  const hinged = pt(HIPX - 26, 356);
  const mk = (hip, spineDeg, kneeBend) => {
    const { shoulder, head } = spine(hip, spineDeg);
    const kneeAnkle = kneeBend ? pt(ankle.x, ankle.y) : ankle;
    const knee = ik2(hip, kneeAnkle, P.thigh, P.shin, 1);
    const wrist = hang(shoulder);
    let far;
    if (unilateral) far = { knee: seg(hip, 130, P.thigh), ankle: seg(seg(hip, 130, P.thigh), 150, P.shin) };
    return { hip, shoulder, head, knee, ankle, toe, elbow: pt(shoulder.x, shoulder.y + P.upper), wrist, working: 'leg', far };
  };
  const load = (J) => equip === 'dumbbell' ? eq.dumbbell(hang(J.shoulder)) : equip === 'kettlebell' ? eq.kettlebell(hang(J.shoulder)) : equip === 'band' ? eq.band(pt(J.ankle.x, FLOOR), hang(J.shoulder)) : eq.plate(hang(J.shoulder), 24);
  const top = mk(tall, style === 'conventional' ? 8 : 6, false);
  const bottomLean = style === 'goodmorning' ? 70 : 66;
  const bot = mk(hinged, bottomLean, style === 'conventional');
  const order = style === 'conventional'
    ? [['START', 'Hips back · flat back · bar over mid-foot', floorLine() + sideFigure(bot) + load(bot)],
       ['STAND', 'Drive the floor away; lock hips and knees together', floorLine() + sideFigure(top) + load(top) + arrow(`M${HIPX + 150} 440 L ${HIPX + 150} 330`)]]
    : [['START', 'Stand tall · soft knees · bar at the thighs', floorLine() + sideFigure(top) + load(top)],
       ['HINGE', 'Push hips back; lower the weight down the shins', floorLine() + sideFigure(bot) + load(bot) + arrow(`M${HIPX + 160} 350 Q ${HIPX + 120} 400 ${HIPX + 40} 400`)]];
  return { view: 'side', frames: order };
}

// ── SIDE-view hip thrust / glute bridge ──────────────────────────────────
export function hipThrust({ equip = 'barbell', bench = true, unilateral = false } = {}) {
  const shoulderY = bench ? 430 : 500;
  const shoulder = pt(320, shoulderY);
  const ankle = pt(560, FLOOR - 6), toe = pt(604, FLOOR - 6);
  const benchSvg = bench ? `<line x1="270" y1="${shoulderY + 22}" x2="370" y2="${shoulderY + 22}" stroke="${C.pad}" stroke-width="20" stroke-linecap="round"/><line x1="285" y1="${shoulderY + 22}" x2="285" y2="${FLOOR}" class="frame"/>` : '';
  const mk = (hipY) => {
    const hip = pt(452, hipY);
    const head = pt(shoulder.x - 46, shoulder.y - 4);
    const knee = ik2(hip, ankle, P.thigh, P.shin, -1);
    const arm = pt(shoulder.x + 6, shoulder.y + 30);
    let far;
    if (unilateral) far = { knee: seg(hip, 60, P.thigh), ankle: seg(seg(hip, 60, P.thigh), 30, P.shin) };
    return { hip, shoulder, head, knee, ankle, toe, elbow: arm, wrist: pt(arm.x - 20, arm.y + 20), working: 'leg', far };
  };
  const load = (J) => equip === 'barbell' ? eq.barbell(pt(J.hip.x - 6, J.hip.y - 6), pt(J.hip.x + 6, J.hip.y - 6)) : equip === 'dumbbell' ? eq.dumbbell(pt(J.hip.x, J.hip.y - 8)) : '';
  const low = mk(bench ? 486 : 508), high = mk(bench ? 424 : 452);
  return {
    view: 'side',
    frames: [
      ['START', bench ? 'Shoulders on the bench · hips low' : 'Back flat on the floor · knees bent', floorLine() + benchSvg + sideFigure(low) + load(low)],
      ['THRUST', 'Drive hips up to a flat table; squeeze the glutes', floorLine() + benchSvg + sideFigure(high) + load(high)
        + arrow(`M${520} 470 L ${520} 410`)],
    ],
  };
}

// ── SIDE-view calf raise ─────────────────────────────────────────────────
export function calfRaise({ equip = 'none', seated = false, unilateral = false } = {}) {
  const toeX = HIPX + 30;
  const mk = (lift) => {
    const ankleY = FLOOR - 8 - lift;
    const ankle = pt(HIPX, ankleY), toe = pt(toeX, FLOOR - 6);
    const hip = pt(HIPX - 4, ankleY - P.shin - P.thigh + (seated ? 40 : 0));
    const { shoulder, head } = spine(hip, seated ? -8 : 3);
    const knee = seated ? pt(hip.x + 90, hip.y + 30) : seg(hip, 179, P.thigh);
    const wrist = hang(shoulder);
    const far = unilateral ? { knee: seg(hip, 160, P.thigh), ankle: seg(seg(hip, 160, P.thigh), 200, P.shin * 0.6) } : null;
    return { hip, shoulder, head, knee, ankle, toe, elbow: pt(shoulder.x, shoulder.y + P.upper), wrist, working: 'leg', far };
  };
  const load = (J) => equip === 'dumbbell' ? eq.dumbbell(hang(J.shoulder)) : equip === 'barbell' ? eq.barbell(pt(J.shoulder.x - 6, J.shoulder.y), pt(J.shoulder.x + 6, J.shoulder.y)) : '';
  const down = mk(0), up = mk(34);
  const step = `<line x1="${HIPX - 60}" y1="${FLOOR - 6}" x2="${toeX + 20}" y2="${FLOOR - 6}" stroke="${C.equipment}" stroke-width="10"/>`;
  return {
    view: 'side',
    frames: [
      ['START', 'Heels down · weight on the balls of the feet', floorLine() + step + sideFigure(down) + load(down)],
      ['RAISE', 'Press up onto the toes; full ankle extension', floorLine() + step + sideFigure(up) + load(up)
        + arrow(`M${HIPX + 120} 400 L ${HIPX + 120} 340`)],
    ],
  };
}

// ── SIDE-view bench press family ─────────────────────────────────────────
export function benchPress({ equip = 'barbell', incline = 0 } = {}) {
  // Reclined torso along a bench tilted `incline` degrees.
  const benchAngle = incline; // +incline tilts head up
  const seatY = 470;
  const hip = pt(430, seatY + Math.tan(-benchAngle * Math.PI / 180) * 0);
  const shoulder = pt(360, seatY - 60 - Math.sin(benchAngle * Math.PI / 180) * 60);
  const head = pt(shoulder.x - 40, shoulder.y - 4);
  const hipP = pt(470, seatY - Math.sin(benchAngle * Math.PI / 180) * -40);
  const knee = pt(560, seatY + 20), ankle = pt(600, FLOOR), toe = pt(644, FLOOR);
  const benchSvg = eq.bench(430, seatY + 26, benchAngle, 300);
  const post = incline === 0 ? '' : '';
  const armUp = (bent) => {
    const elbow = seg(shoulder, bent ? 140 : 8, P.upper);
    const wrist = seg(elbow, bent ? 30 : 8, P.fore);
    return { elbow, wrist };
  };
  const mk = (bent) => {
    const a = armUp(bent);
    return { hip: hipP, shoulder, head, knee, ankle, toe, elbow: a.elbow, wrist: a.wrist, working: 'arm' };
  };
  const load = (J) => equip === 'dumbbell' ? eq.dumbbell(J.wrist) : equip === 'machine' ? eq.post(J.wrist.x + 20, 140, J.wrist.y) + eq.dumbbell(J.wrist) : eq.barbell(pt(J.wrist.x - 6, J.wrist.y), pt(J.wrist.x + 6, J.wrist.y));
  const bottom = mk(true), topp = mk(false);
  return {
    view: 'side',
    frames: [
      ['START', 'Weight at chest · elbows tucked ~45°', floorLine() + benchSvg + sideFigure(bottom) + load(bottom)],
      ['PRESS', 'Drive the weight up over the shoulders; full lockout', floorLine() + benchSvg + sideFigure(topp) + load(topp)
        + arrow(`M${shoulder.x + 120} ${seatY - 40} L ${shoulder.x + 120} ${topp.wrist.y - 10}`)],
    ],
  };
}

// ── FRONT-view chest fly / pec deck / cable crossover ────────────────────
export function chestFly({ equip = 'machine', low = false } = {}) {
  const hip = pt(HIPX, 360);
  const open = frontSkeleton(hip, { arm: { upper: 96, fore: 30 }, working: 'arm', spineDeg: 0 });
  const closed = frontSkeleton(hip, { arm: { upper: 150, fore: 200 }, working: 'arm', spineDeg: 0 });
  const seat = equip === 'machine' ? `<line x1="${HIPX - 60}" y1="${hip.y + 40}" x2="${HIPX + 60}" y2="${hip.y + 40}" stroke="${C.pad}" stroke-width="18" stroke-linecap="round"/>` : '';
  const load = (J, o) => equip === 'cable'
    ? eq.cable(pt(HIPX - 220, low ? 480 : 150), J.wL) + eq.cable(pt(HIPX + 220, low ? 480 : 150), J.wR)
    : equip === 'band' ? eq.band(pt(HIPX - 200, 300), J.wL) + eq.band(pt(HIPX + 200, 300), J.wR)
    : eq.dumbbell(J.wR) + eq.dumbbell(J.wL);
  return {
    view: 'front',
    frames: [
      ['START', 'Arms open wide · slight elbow bend', floorLine() + seat + frontFigure(open) + load(open, true)],
      ['SQUEEZE', 'Sweep the hands together in front of the chest', floorLine() + seat + frontFigure(closed) + load(closed, false)
        + arrow(`M${HIPX - 150} 300 L ${HIPX - 40} 320`) + arrow(`M${HIPX + 150} 300 L ${HIPX + 40} 320`)],
    ],
  };
}

// ── SIDE-view push-up family ─────────────────────────────────────────────
export function pushup({ variant = 'standard' } = {}) {
  const hand = pt(560, FLOOR - 6);
  const feet = variant === 'kneeling' ? null : pt(280, FLOOR - 6);
  const knees = variant === 'kneeling' ? pt(330, FLOOR - 6) : null;
  const mk = (shoulderY) => {
    const shoulder = pt(hand.x - 8, shoulderY);
    const anchor = knees || feet;
    const hip = variant === 'pike' ? pt((shoulder.x + anchor.x) / 2, shoulderY - 70)
      : pt((shoulder.x + anchor.x) / 2 + 10, shoulderY + 16);
    const head = pt(shoulder.x + 34, shoulder.y - 6);
    const elbow = ik2(shoulder, hand, P.upper, P.fore, 1);
    const knee = knees ? knees : ik2(hip, feet, P.thigh, P.shin, -1);
    const ankle = knees ? null : feet;
    return { hip, shoulder, head, elbow, wrist: hand, knee, ankle, toe: ankle ? pt(ankle.x - 34, ankle.y) : null, working: 'arm' };
  };
  const top = mk(variant === 'pike' ? 360 : 400), bottom = mk(variant === 'pike' ? 410 : 452);
  const kneePad = knees ? '' : '';
  return {
    view: 'side',
    frames: [
      ['START', variant === 'pike' ? 'Hips high · body in an inverted V' : 'Top of the push-up · body in one line', floorLine() + sideFigure(top)],
      ['LOWER', variant === 'diamond' ? 'Hands close; lower with elbows tight to the ribs' : 'Bend elbows; lower the chest under control', floorLine() + sideFigure(bottom)
        + arrow(`M${hand.x - 150} ${bottom.shoulder.y - 40} L ${hand.x - 150} ${bottom.shoulder.y + 20}`)],
    ],
  };
}

// ── SIDE-view dip ────────────────────────────────────────────────────────
export function dip({ style = 'triceps', bench = false } = {}) {
  const barY = 300;
  if (bench) {
    const benchSvg = `<line x1="300" y1="430" x2="440" y2="430" stroke="${C.pad}" stroke-width="20" stroke-linecap="round"/>`;
    const mk = (hipY) => {
      const shoulder = pt(430, hipY - 150);
      const hand = pt(380, 430);
      const elbow = ik2(shoulder, hand, P.upper, P.fore, -1);
      const hip = pt(500, hipY);
      const head = pt(shoulder.x + 6, shoulder.y - P.headR - 10);
      return { hip, shoulder, head, elbow, wrist: hand, knee: pt(600, hipY + 10), ankle: pt(640, FLOOR), toe: pt(684, FLOOR), working: 'arm' };
    };
    const top = mk(430), bot = mk(486);
    return { view: 'side', frames: [
      ['START', 'Hands on the bench behind you · hips up', floorLine() + benchSvg + sideFigure(top)],
      ['DIP', 'Bend the elbows straight back; lower the hips', floorLine() + benchSvg + sideFigure(bot) + arrow('M540 440 L540 500')],
    ] };
  }
  const bars = eq.hbar(360, 500, barY);
  const mk = (shoulderY, lean) => {
    const shoulder = pt(430, shoulderY);
    const hand = pt(430 + (lean ? -6 : 0), barY);
    const elbow = ik2(shoulder, hand, P.upper, P.fore, -1);
    const hip = pt(shoulder.x + (style === 'chest' ? 18 : 6), shoulder.y + P.spine);
    const head = pt(shoulder.x + (lean ? 20 : 6), shoulder.y - P.headR - 12);
    const knee = seg(hip, 150, P.thigh), ankle = seg(knee, 165, P.shin);
    return { hip, shoulder, head, elbow, wrist: hand, knee, ankle, toe: pt(ankle.x + 30, ankle.y), working: 'arm' };
  };
  const top = mk(barY - P.upper - P.fore + 10, false), bot = mk(barY - 40, true);
  return {
    view: 'side',
    frames: [
      ['START', 'Arms locked out · shoulders over the bars', floorLine() + bars + sideFigure(top)],
      ['DIP', style === 'chest' ? 'Lean forward; lower until the shoulders reach elbow height' : 'Stay upright; bend to 90° and press back up', floorLine() + bars + sideFigure(bot) + arrow('M560 300 L560 380')],
    ],
  };
}

// ── SIDE-view bent-over row ──────────────────────────────────────────────
export function row({ equip = 'barbell', support = null, unilateral = false } = {}) {
  const hip = pt(HIPX, 358);
  const lean = support === 'chest' ? 55 : 64;
  const { shoulder, head } = spine(hip, lean);
  const ankle = pt(hip.x - 8, FLOOR - 6), toe = pt(hip.x + 34, FLOOR - 6);
  const knee = ik2(hip, ankle, P.thigh, P.shin, 1);
  const wristDown = hang(shoulder, P.upper + P.fore);
  const elbowDown = pt(shoulder.x, shoulder.y + P.upper);
  const elbowUp = seg(shoulder, 250, P.upper);
  const wristUp = seg(elbowUp, 150, P.fore);
  const supportSvg = support === 'chest' ? eq.bench(hip.x + 20, shoulder.y + 30, 24, 220) : '';
  const load = (w) => equip === 'dumbbell' ? eq.dumbbell(w) : equip === 'kettlebell' ? eq.kettlebell(w) : equip === 'band' ? eq.band(pt(ankle.x, FLOOR), w) : eq.plate(w, 24);
  const base = (elbow, wrist) => ({ hip, shoulder, head, knee, ankle, toe, elbow, wrist, working: 'arm' });
  return {
    view: 'side',
    frames: [
      ['START', 'Hinge forward · flat back · arms hanging', floorLine() + supportSvg + sideFigure(base(elbowDown, wristDown)) + load(wristDown)],
      ['ROW', 'Pull the elbow up past the ribs; squeeze the back', floorLine() + supportSvg + sideFigure(base(elbowUp, wristUp)) + load(wristUp)
        + arrow(`M${wristDown.x + 40} ${wristDown.y} L ${wristUp.x + 40} ${wristUp.y}`)],
    ],
  };
}

// ── SIDE-view lat pulldown ───────────────────────────────────────────────
export function pulldown({ equip = 'machine', straightArm = false, unilateral = false } = {}) {
  const hip = pt(HIPX, 380);
  const { shoulder, head } = spine(hip, -6);
  const knee = pt(hip.x + 80, hip.y + 40), ankle = pt(hip.x + 100, FLOOR), toe = pt(hip.x + 144, FLOOR);
  const seatSvg = `<line x1="${hip.x - 50}" y1="${hip.y + 30}" x2="${hip.x + 50}" y2="${hip.y + 30}" stroke="${C.pad}" stroke-width="18" stroke-linecap="round"/>`;
  const anchor = pt(shoulder.x + 10, 120);
  const stack = equip === 'machine' ? eq.stack(anchor.x + 60, 130, 500) : '';
  if (straightArm) {
    const up = { elbow: seg(shoulder, 18, P.upper), wrist: seg(seg(shoulder, 18, P.upper), 18, P.fore) };
    const down = { elbow: seg(shoulder, 150, P.upper), wrist: seg(seg(shoulder, 150, P.upper), 150, P.fore) };
    const mk = (a) => ({ hip, shoulder, head, knee, ankle, toe, elbow: a.elbow, wrist: a.wrist, working: 'arm' });
    return { view: 'side', frames: [
      ['START', 'Arms straight overhead · slight forward lean', floorLine() + seatSvg + stack + eq.cable(anchor, up.wrist) + sideFigure(mk(up))],
      ['PULL DOWN', 'Sweep straight arms down to the thighs; lats drive it', floorLine() + seatSvg + stack + eq.cable(anchor, down.wrist) + sideFigure(mk(down)) + arrow(`M${shoulder.x + 130} 200 L ${shoulder.x + 130} 380`)],
    ] };
  }
  const upElbow = seg(shoulder, 14, P.upper), upWrist = seg(upElbow, 14, P.fore);
  const dnElbow = seg(shoulder, 235, P.upper), dnWrist = seg(dnElbow, 320, P.fore * 0.7);
  const mk = (elbow, wrist) => ({ hip, shoulder, head, knee, ankle, toe, elbow, wrist, working: 'arm' });
  return {
    view: 'side',
    frames: [
      ['START', 'Arms extended overhead · grip the bar', floorLine() + seatSvg + stack + eq.cable(anchor, upWrist) + sideFigure(mk(upElbow, upWrist))],
      ['PULL DOWN', 'Drive the elbows down and back to the collarbone', floorLine() + seatSvg + stack + eq.cable(anchor, dnWrist) + sideFigure(mk(dnElbow, dnWrist)) + arrow(`M${shoulder.x + 120} 210 L ${shoulder.x + 120} 320`)],
    ],
  };
}

// ── SIDE-view pull-up / chin-up ──────────────────────────────────────────
export function pullup({ style = 'pullup', weighted = false, assisted = false } = {}) {
  const barY = 150;
  const bar = eq.hbar(320, 540, barY);
  const mk = (shoulderY) => {
    const shoulder = pt(430, shoulderY);
    const hand = pt(430, barY);
    const elbow = ik2(shoulder, hand, P.upper, P.fore, 1);
    const hip = seg(shoulder, 182, P.spine);
    const head = pt(shoulder.x + 4, shoulder.y - P.headR - 12);
    const knee = seg(hip, 176, P.thigh), ankle = seg(knee, 176, P.shin);
    return { hip, shoulder, head, elbow, wrist: hand, knee, ankle, toe: pt(ankle.x + 30, ankle.y), working: 'arm' };
  };
  const bottom = mk(barY + P.upper + P.fore - 6), top = mk(barY + 44);
  const extra = weighted ? eq.plate(pt(bottom.hip.x, bottom.hip.y + 120), 18) : '';
  return {
    view: 'side',
    frames: [
      ['START', 'Dead hang · arms fully extended', floorLine() + bar + sideFigure(bottom) + extra],
      ['PULL UP', style === 'chin' ? 'Palms toward you; pull chin over the bar' : 'Pull the chest to the bar; drive elbows down', floorLine() + bar + sideFigure(top) + (weighted ? eq.plate(pt(top.hip.x, top.hip.y + 120), 18) : '') + arrow('M600 400 L600 250')],
    ],
  };
}

// ── SIDE-view seated cable / machine row ─────────────────────────────────
export function seatedRow({ equip = 'cable', grip = 'neutral', unilateral = false } = {}) {
  const hip = pt(HIPX, 420);
  const knee = pt(hip.x + 120, hip.y - 6), ankle = pt(hip.x + 210, FLOOR - 6), toe = pt(hip.x + 250, FLOOR - 6);
  const anchor = pt(hip.x + 300, 400);
  const seatSvg = `<line x1="${hip.x - 40}" y1="${hip.y + 26}" x2="${hip.x + 40}" y2="${hip.y + 26}" stroke="${C.pad}" stroke-width="18" stroke-linecap="round"/>`;
  const stack = equip === 'machine' ? eq.stack(anchor.x, 300, 500) : eq.post(anchor.x, 300, FLOOR);
  const mk = (spineDeg, reach) => {
    const { shoulder, head } = spine(hip, spineDeg);
    const elbow = reach ? seg(shoulder, 90, P.upper) : seg(shoulder, 250, P.upper);
    const wrist = reach ? seg(elbow, 90, P.fore) : seg(elbow, 150, P.fore * 0.8);
    return { hip, shoulder, head, knee, ankle, toe, elbow, wrist, working: 'arm' };
  };
  const stretch = mk(18, true), pull = mk(-4, false);
  return {
    view: 'side',
    frames: [
      ['START', 'Tall spine · arms reaching forward', floorLine() + seatSvg + stack + eq.cable(anchor, stretch.wrist) + sideFigure(stretch)],
      ['ROW', 'Pull the handle to the waist; drive the elbows back', floorLine() + seatSvg + stack + eq.cable(anchor, pull.wrist) + sideFigure(pull) + arrow(`M${anchor.x - 40} 410 L ${pull.wrist.x + 30} ${pull.wrist.y}`)],
    ],
  };
}

// ── SIDE-view crunch / sit-up ────────────────────────────────────────────
export function crunch({ weighted = false, decline = false, machine = false } = {}) {
  const hipX = 430, hipY = decline ? 470 : 500;
  const ankle = pt(hipX + 150, FLOOR - 6), toe = pt(hipX + 190, FLOOR - 6);
  const hip = pt(hipX, hipY);
  const knee = ik2(hip, ankle, P.thigh, P.shin, -1);
  const mk = (up) => {
    const shoulder = up ? pt(hip.x - 90, hip.y - 90) : pt(hip.x - 150, hip.y - 12);
    const head = pt(shoulder.x - 30, shoulder.y - 20);
    const elbow = pt(shoulder.x + 10, shoulder.y + 30), wrist = pt(shoulder.x + 30, shoulder.y + 10);
    return { hip, shoulder, head, elbow, wrist, knee, ankle, toe, working: 'none' };
  };
  const flat = mk(false), curled = mk(true);
  const load = weighted ? eq.plate(pt(curled.head.x - 10, curled.head.y), 16) : '';
  const inclineSvg = decline ? `<line x1="240" y1="${hipY + 40}" x2="640" y2="${hipY - 30}" stroke="${C.pad}" stroke-width="14" stroke-linecap="round"/>` : '';
  return {
    view: 'side',
    frames: [
      ['START', 'Lower back down · knees bent', floorLine() + inclineSvg + sideFigure(flat)],
      ['CRUNCH', 'Curl the ribcage toward the pelvis; don\'t yank the neck', floorLine() + inclineSvg + sideFigure(curled) + load + arrow(`M${curled.shoulder.x - 30} ${curled.shoulder.y + 60} Q ${curled.shoulder.x - 60} ${curled.shoulder.y + 10} ${curled.head.x} ${curled.head.y}`)],
    ],
  };
}

// ── SIDE-view lying leg / knee raise ─────────────────────────────────────
export function legRaiseLying({ knees = false } = {}) {
  const hip = pt(430, 470);
  const shoulder = pt(hip.x - 150, hip.y - 8);
  const head = pt(shoulder.x - 30, shoulder.y - 6);
  const armE = pt(shoulder.x + 10, hip.y - 4), armW = pt(shoulder.x + 60, hip.y - 2);
  const mk = (raise) => {
    const kneeAng = raise ? (knees ? 250 : 300) : 178;
    const knee = seg(hip, kneeAng, P.thigh);
    const shinAng = raise ? (knees ? 300 : 300) : 172;
    const ankle = seg(knee, knees && raise ? 340 : shinAng, knees ? P.shin * 0.7 : P.shin);
    return { hip, shoulder, head, elbow: armE, wrist: armW, knee, ankle, toe: pt(ankle.x + 20, ankle.y), working: 'leg' };
  };
  const down = mk(false), up = mk(true);
  return {
    view: 'side',
    frames: [
      ['START', 'Flat on the back · legs extended', floorLine() + sideFigure(down)],
      [knees ? 'KNEE RAISE' : 'LEG RAISE', knees ? 'Draw the knees toward the chest; keep the low back down' : 'Lift straight legs; lower slowly without arching', floorLine() + sideFigure(up) + arrow('M600 470 Q640 380 590 320')],
    ],
  };
}

// ── SIDE-view hanging leg / knee raise ───────────────────────────────────
export function hangingRaise({ knees = false, toesToBar = false } = {}) {
  const barY = 150;
  const bar = eq.hbar(340, 520, barY);
  const shoulder = pt(430, barY + P.upper + P.fore - 6);
  const hand = pt(430, barY);
  const elbow = ik2(shoulder, hand, P.upper, P.fore, 1);
  const head = pt(shoulder.x + 4, shoulder.y - P.headR - 12);
  const mk = (raise) => {
    const hip = seg(shoulder, 182, P.spine);
    const kneeAng = raise ? (toesToBar ? 250 : knees ? 250 : 285) : 178;
    const knee = seg(hip, kneeAng, P.thigh);
    const ankle = seg(knee, raise ? (toesToBar ? 300 : knees ? 300 : 285) : 176, P.shin);
    return { hip, shoulder, head, elbow, wrist: hand, knee, ankle, toe: pt(ankle.x + 20, ankle.y), working: 'leg' };
  };
  const down = mk(false), up = mk(true);
  return {
    view: 'side',
    frames: [
      ['START', 'Hang from the bar · legs long', floorLine() + bar + sideFigure(down)],
      [toesToBar ? 'TOES TO BAR' : knees ? 'KNEE RAISE' : 'LEG RAISE', toesToBar ? 'Swing the feet up to touch the bar' : 'Raise the legs without swinging; control the drop', floorLine() + bar + sideFigure(up) + arrow('M600 470 Q660 350 600 260')],
    ],
  };
}

// ── SIDE-view plank / static hold ────────────────────────────────────────
export function plank({ side = false } = {}) {
  const hand = pt(300, FLOOR - 6), feet = pt(600, FLOOR - 6);
  const shoulder = pt(hand.x + 6, hand.y - (P.upper + P.fore) + 8);
  const hip = pt((shoulder.x + feet.x) / 2, shoulder.y + 6);
  const head = pt(shoulder.x - 34, shoulder.y - 6);
  const elbow = pt(hand.x + 10, hand.y - 60);
  const knee = ik2(hip, feet, P.thigh, P.shin, 1);
  const J = { hip, shoulder, head, elbow, wrist: hand, knee, ankle: feet, toe: pt(feet.x - 34, feet.y), working: 'none' };
  const alignLine = `<line x1="${head.x - 10}" y1="${head.y - 8}" x2="${feet.x}" y2="${feet.y - 8}" stroke="${C.accent2}" stroke-width="5" stroke-dasharray="14 10"/>`;
  return {
    view: 'side',
    frames: [
      ['SET UP', 'Forearm under the shoulder · feet back', floorLine() + sideFigure(J)],
      ['HOLD', 'Squeeze glutes and abs; one straight line head to heels', floorLine() + sideFigure(J) + alignLine + smallText(hip.x - 40, hip.y - 30, 'STRAIGHT LINE')],
    ],
  };
}

// ── SIDE-view ab wheel rollout ───────────────────────────────────────────
export function abWheel() {
  const knee = pt(360, FLOOR - 6);
  const mk = (ext) => {
    const hip = pt(knee.x + (ext ? 40 : 10), ext ? FLOOR - 120 : FLOOR - 150);
    const shoulder = ext ? pt(knee.x + 210, FLOOR - 70) : pt(knee.x + 80, FLOOR - 180);
    const head = pt(shoulder.x + 26, shoulder.y - 10);
    const hand = ext ? pt(knee.x + 300, FLOOR - 6) : pt(knee.x + 150, FLOOR - 6);
    const elbow = ik2(shoulder, hand, P.upper, P.fore, 1);
    return { hip, shoulder, head, elbow, wrist: hand, knee, ankle: pt(knee.x - 40, FLOOR - 6), toe: pt(knee.x - 70, FLOOR - 6), working: 'none' };
  };
  const tucked = mk(false), extended = mk(true);
  const wheel = (J) => `<circle cx="${J.wrist.x}" cy="${J.wrist.y}" r="18" fill="none" stroke="${C.equipment}" stroke-width="8"/>`;
  return {
    view: 'side',
    frames: [
      ['START', 'Kneel tall · wheel under the shoulders', floorLine() + sideFigure(tucked) + wheel(tucked)],
      ['ROLL OUT', 'Roll forward as far as you can hold a flat back', floorLine() + sideFigure(extended) + wheel(extended) + arrow('M540 360 L680 460')],
    ],
  };
}

// ── FRONT-view seated hip abduction / adduction ──────────────────────────
export function hipAbduction({ adduction = false } = {}) {
  const hip = pt(HIPX, 400);
  const seatSvg = `<line x1="${HIPX - 70}" y1="440" x2="${HIPX + 70}" y2="440" stroke="${C.pad}" stroke-width="20" stroke-linecap="round"/>`;
  const mk = (spread) => {
    const half = spread;
    const hR = pt(hip.x + 24, hip.y), hL = pt(hip.x - 24, hip.y);
    const kR = pt(hip.x + half, hip.y + 70), kL = pt(hip.x - half, hip.y + 70);
    const aR = pt(kR.x + 4, FLOOR - 6), aL = pt(kL.x - 4, FLOOR - 6);
    const { shoulder, head } = spine(hip, 0);
    return { hip, shoulder, head, sR: pt(shoulder.x + 42, shoulder.y), sL: pt(shoulder.x - 42, shoulder.y),
      hR, hL, kR, kL, aR, aL, eR: pt(hip.x + 30, hip.y + 20), eL: pt(hip.x - 30, hip.y + 20),
      wR: pt(hip.x + 40, hip.y + 40), wL: pt(hip.x - 40, hip.y + 40) };
  };
  const closed = mk(adduction ? 90 : 34), open = mk(adduction ? 34 : 90);
  const first = adduction ? open : closed, second = adduction ? closed : open;
  return {
    view: 'front',
    frames: [
      ['START', adduction ? 'Knees apart against the pads' : 'Knees together at the pads', floorLine() + seatSvg + frontFigure(first)],
      [adduction ? 'SQUEEZE' : 'OPEN', adduction ? 'Draw the knees together; control the return' : 'Press the knees apart; pause, then return slowly', floorLine() + seatSvg + frontFigure(second)
        + (adduction ? arrow(`M${HIPX - 120} 470 L ${HIPX - 40} 470`) + arrow(`M${HIPX + 120} 470 L ${HIPX + 40} 470`) : arrow(`M${HIPX - 40} 470 L ${HIPX - 130} 470`) + arrow(`M${HIPX + 40} 470 L ${HIPX + 130} 470`))],
    ],
  };
}

// ── SIDE-view kettlebell swing ───────────────────────────────────────────
export function kbSwing() {
  const ankle = pt(HIPX + 4, FLOOR - 6), toe = pt(HIPX + 50, FLOOR - 6);
  const mkHinge = () => {
    const hip = pt(HIPX - 20, 360);
    const { shoulder, head } = spine(hip, 60);
    const knee = ik2(hip, ankle, P.thigh, P.shin, 1);
    const wrist = pt(hip.x + 30, hip.y + 70);
    const elbow = pt((shoulder.x + wrist.x) / 2, (shoulder.y + wrist.y) / 2);
    return { hip, shoulder, head, knee, ankle, toe, elbow, wrist, working: 'leg' };
  };
  const mkStand = () => {
    const hip = pt(HIPX, 336);
    const { shoulder, head } = spine(hip, 2);
    const knee = seg(hip, 179, P.thigh);
    const wrist = pt(shoulder.x + 40, shoulder.y - 20);
    const elbow = pt((shoulder.x + wrist.x) / 2, (shoulder.y + wrist.y) / 2 + 6);
    return { hip, shoulder, head, knee, ankle, toe, elbow, wrist, working: 'leg' };
  };
  const hinge = mkHinge(), stand = mkStand();
  return {
    view: 'side',
    frames: [
      ['HIKE', 'Hinge at the hips · bell swings back between the thighs', floorLine() + sideFigure(hinge) + eq.kettlebell(hinge.wrist)],
      ['SNAP', 'Snap the hips through; float the bell to chest height', floorLine() + sideFigure(stand) + eq.kettlebell(stand.wrist) + arrow(`M${HIPX + 90} 420 Q ${HIPX + 130} 340 ${HIPX + 70} 300`)],
    ],
  };
}

// ── SIDE-view back extension / hyperextension ────────────────────────────
export function backExtension({ weighted = false } = {}) {
  const padX = 430, padY = 400;
  const ankle = pt(padX + 130, FLOOR - 6);
  const benchSvg = `<line x1="${padX - 40}" y1="${padY}" x2="${padX + 40}" y2="${padY}" stroke="${C.pad}" stroke-width="20" stroke-linecap="round"/><line x1="${padX + 130}" y1="${FLOOR - 40}" x2="${padX + 60}" y2="${FLOOR - 40}" stroke="${C.equipment}" stroke-width="10"/>`;
  const mk = (down) => {
    const hip = pt(padX, padY - 8);
    const spineDeg = down ? 118 : 74;
    const { shoulder, head } = spine(hip, spineDeg);
    const knee = pt(hip.x + 70, hip.y + 40);
    return { hip, shoulder, head, knee, ankle, toe: pt(ankle.x + 30, ankle.y),
      elbow: seg(shoulder, spineDeg, 40), wrist: seg(shoulder, spineDeg, 70), working: 'none' };
  };
  const flexed = mk(true), extended = mk(false);
  const load = weighted ? eq.plate(pt(extended.head.x, extended.head.y + 20), 16) : '';
  return {
    view: 'side',
    frames: [
      ['START', 'Hips on the pad · torso folded down', floorLine() + benchSvg + sideFigure(flexed)],
      ['EXTEND', 'Raise the torso to one line with the legs; don\'t over-arch', floorLine() + benchSvg + sideFigure(extended) + load + arrow(`M${extended.shoulder.x - 40} 430 Q ${extended.shoulder.x - 90} 360 ${extended.shoulder.x - 40} 300`)],
    ],
  };
}

// ── FRONT-view standing carry / static hold ──────────────────────────────
export function carry({ equip = 'dumbbell', unilateral = true } = {}) {
  const hip = pt(HIPX, 348);
  const J = frontSkeleton(hip, { arm: { upper: 178, fore: 178 } });
  const load = unilateral ? eq.dumbbell(J.wR) : eq.dumbbell(J.wR) + eq.dumbbell(J.wL);
  return {
    view: 'front',
    frames: [
      ['SET UP', unilateral ? 'Weight in one hand · stand tall and square' : 'A weight in each hand · shoulders packed', floorLine() + frontFigure(J) + load],
      ['CARRY', 'Brace the core and walk tall; resist leaning to the side', floorLine() + frontFigure(J) + load + arrow(`M${HIPX + 150} 300 L ${HIPX + 230} 300`) + smallText(HIPX + 150, 280, 'WALK')],
    ],
  };
}
