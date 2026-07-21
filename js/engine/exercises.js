// Exercise definitions: pure biomechanics + cue logic. No DOM, no browser APIs.
//
// Each exercise exposes:
//   id, name, orientation      - metadata for the UI
//   defaults                   - { restAngle, peakAngle } fallback ROM (degrees) for the driving joint
//   measure(landmarks)         - { valid, reason?, side, drivingAngle, aux }
//   progressFrom(angle, calib) - map the driving angle to progress in [0,1] (0=rest, 1=peak)
//   coach(measure, state)      - { text, tone } single most-important live form cue
//
// The driving angle is the one scalar the RepEngine consumes (via progressFrom).
// `aux` carries the extra angles a coach() needs so measure() stays the single
// source of geometry truth (and so tests can drive coach() directly).

import { angle, avg, visible, meanVisibility, normalize } from './geometry.js';
import { LM } from './landmarks.js';

// tone ranking so a caller can pick the most urgent cue: bad > warn > good
export const TONE_RANK = { good: 0, warn: 1, bad: 2 };

// Pick whichever of two point-groups is more visible. Returns 'L' or 'R'.
function betterSide(lm, leftIdx, rightIdx) {
  const l = meanVisibility(leftIdx.map((i) => lm[i]));
  const r = meanVisibility(rightIdx.map((i) => lm[i]));
  return l >= r ? 'L' : 'R';
}

// progress from driving angle using calibrated (or default) rest/peak extremes.
// normalize() handles inverted ranges, so this works whether the peak is a
// smaller angle (squat/curl) or a larger angle (press).
function progressFrom(angleDeg, calib) {
  return normalize(angleDeg, calib.restAngle, calib.peakAngle);
}

// ---------------------------------------------------------------------------
// SQUAT — side-on. Driving joint: knee (hip-knee-ankle). Peak = deep (small angle).
// ---------------------------------------------------------------------------
const squat = {
  id: 'squat',
  name: 'Squat',
  orientation: 'Stand side-on, full body in frame.',
  driver: 'Knee angle',
  defaults: { restAngle: 172, peakAngle: 82 },
  calibrateMetric: 'drivingAngle',
  peakIsLow: true,
  progressFrom,
  measure(lm) {
    const side = betterSide(lm, [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE], [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE]);
    const P = side === 'L'
      ? { sh: lm[LM.LEFT_SHOULDER], hip: lm[LM.LEFT_HIP], knee: lm[LM.LEFT_KNEE], ankle: lm[LM.LEFT_ANKLE] }
      : { sh: lm[LM.RIGHT_SHOULDER], hip: lm[LM.RIGHT_HIP], knee: lm[LM.RIGHT_KNEE], ankle: lm[LM.RIGHT_ANKLE] };
    if (!visible([P.sh, P.hip, P.knee, P.ankle])) {
      return { valid: false, reason: 'Show your full side profile', side };
    }
    const knee = angle(P.hip, P.knee, P.ankle);
    const torso = angle(P.sh, P.hip, P.knee);   // hip-hinge / chest angle
    const hipBelowKnee = P.hip.y - P.knee.y;     // >0 means hip lower than knee (image y grows downward)
    return { valid: true, side, drivingAngle: knee, aux: { torso, hipBelowKnee } };
  },
  coach(m, state) {
    if (!m.valid) return { text: m.reason, tone: 'warn' };
    if (m.aux.torso < 45) return { text: 'Chest up', tone: 'bad' };
    if (m.drivingAngle < 60) return { text: 'Control the depth', tone: 'warn' };
    if (state.phase === 'active' && state.direction === 'down' && state.progress < 0.6) {
      return { text: 'A little lower', tone: 'warn' };
    }
    if (state.phase === 'active' && state.direction === 'up') return { text: 'Drive up', tone: 'good' };
    return { text: 'Ready', tone: 'good' };
  },
};

// ---------------------------------------------------------------------------
// PUSH-UP — side-on. Driving joint: elbow (shoulder-elbow-wrist). Peak = bottom.
// ---------------------------------------------------------------------------
const pushup = {
  id: 'pushup',
  name: 'Push-up',
  orientation: 'Side-on, whole body in frame, plank position.',
  driver: 'Elbow angle',
  defaults: { restAngle: 165, peakAngle: 82 },
  calibrateMetric: 'drivingAngle',
  peakIsLow: true,
  progressFrom,
  measure(lm) {
    const side = betterSide(lm, [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST], [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST]);
    const P = side === 'L'
      ? { sh: lm[LM.LEFT_SHOULDER], el: lm[LM.LEFT_ELBOW], wr: lm[LM.LEFT_WRIST], hip: lm[LM.LEFT_HIP], ank: lm[LM.LEFT_ANKLE] }
      : { sh: lm[LM.RIGHT_SHOULDER], el: lm[LM.RIGHT_ELBOW], wr: lm[LM.RIGHT_WRIST], hip: lm[LM.RIGHT_HIP], ank: lm[LM.RIGHT_ANKLE] };
    if (!visible([P.sh, P.el, P.wr])) {
      return { valid: false, reason: 'Show your arm and torso', side };
    }
    const elbow = angle(P.sh, P.el, P.wr);
    // body-line straightness: shoulder-hip-ankle should be ~180° in a good plank
    const bodyLine = visible([P.sh, P.hip, P.ank]) ? angle(P.sh, P.hip, P.ank) : null;
    return { valid: true, side, drivingAngle: elbow, aux: { bodyLine } };
  },
  coach(m, state) {
    if (!m.valid) return { text: m.reason, tone: 'warn' };
    if (m.aux.bodyLine != null && m.aux.bodyLine < 155) {
      // hips sagging or piking breaks the straight line
      return { text: 'Straighten your body', tone: 'bad' };
    }
    if (state.phase === 'active' && state.direction === 'down' && state.progress < 0.6) {
      return { text: 'Lower your chest', tone: 'warn' };
    }
    if (state.phase === 'active' && state.direction === 'up') return { text: 'Press up', tone: 'good' };
    return { text: 'Ready', tone: 'good' };
  },
};

// ---------------------------------------------------------------------------
// ALTERNATING LUNGE — front-on or slight angle. Driving joint: the working (more
// flexed) knee. Peak = deep lunge. Reports which leg is active for alternation.
// ---------------------------------------------------------------------------
const lunge = {
  id: 'lunge',
  name: 'Alternating lunge',
  orientation: 'Face the camera, full body in frame.',
  driver: 'Front-knee angle',
  defaults: { restAngle: 170, peakAngle: 92 },
  calibrateMetric: 'drivingAngle',
  peakIsLow: true,
  progressFrom,
  measure(lm) {
    const L = { hip: lm[LM.LEFT_HIP], knee: lm[LM.LEFT_KNEE], ankle: lm[LM.LEFT_ANKLE], sh: lm[LM.LEFT_SHOULDER] };
    const R = { hip: lm[LM.RIGHT_HIP], knee: lm[LM.RIGHT_KNEE], ankle: lm[LM.RIGHT_ANKLE], sh: lm[LM.RIGHT_SHOULDER] };
    const lOk = visible([L.hip, L.knee, L.ankle]);
    const rOk = visible([R.hip, R.knee, R.ankle]);
    if (!lOk && !rOk) return { valid: false, reason: 'Show both legs', side: 'L' };
    const lKnee = lOk ? angle(L.hip, L.knee, L.ankle) : 180;
    const rKnee = rOk ? angle(R.hip, R.knee, R.ankle) : 180;
    // working leg = the more flexed (smaller-angle) knee that is visible
    const workingLeft = lOk && (!rOk || lKnee <= rKnee);
    const side = workingLeft ? 'L' : 'R';
    const drivingAngle = workingLeft ? lKnee : rKnee;
    const P = workingLeft ? L : R;
    const torso = visible([P.sh, P.hip, P.knee]) ? angle(P.sh, P.hip, P.knee) : null;
    return { valid: true, side, drivingAngle, aux: { torso, leftKnee: lKnee, rightKnee: rKnee } };
  },
  coach(m, state) {
    if (!m.valid) return { text: m.reason, tone: 'warn' };
    if (m.aux.torso != null && m.aux.torso < 150) return { text: 'Torso tall', tone: 'bad' };
    if (state.phase === 'active' && state.direction === 'down' && state.progress < 0.6) {
      return { text: 'Sink lower', tone: 'warn' };
    }
    if (state.phase === 'active' && state.direction === 'up') return { text: 'Push back up', tone: 'good' };
    const leg = m.side === 'L' ? 'left' : 'right';
    return { text: `Ready · ${leg} lead`, tone: 'good' };
  },
};

// ---------------------------------------------------------------------------
// BICEP CURL — facing or side. Driving joint: elbow. Peak = flexed (small angle).
// ---------------------------------------------------------------------------
const bicepCurl = {
  id: 'bicep-curl',
  name: 'Bicep curl',
  orientation: 'Face the camera, upper body in frame.',
  driver: 'Elbow angle',
  defaults: { restAngle: 158, peakAngle: 48 },
  calibrateMetric: 'drivingAngle',
  peakIsLow: true,
  progressFrom,
  measure(lm) {
    const side = betterSide(lm, [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST], [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST]);
    const P = side === 'L'
      ? { sh: lm[LM.LEFT_SHOULDER], el: lm[LM.LEFT_ELBOW], wr: lm[LM.LEFT_WRIST], hip: lm[LM.LEFT_HIP] }
      : { sh: lm[LM.RIGHT_SHOULDER], el: lm[LM.RIGHT_ELBOW], wr: lm[LM.RIGHT_WRIST], hip: lm[LM.RIGHT_HIP] };
    if (!visible([P.sh, P.el, P.wr])) return { valid: false, reason: 'Show your arm', side };
    const elbow = angle(P.sh, P.el, P.wr);
    // upper-arm stability: angle at shoulder (hip-shoulder-elbow). Small & steady
    // means the elbow is pinned to the torso instead of swinging forward.
    const upperArm = visible([P.hip, P.sh, P.el]) ? angle(P.hip, P.sh, P.el) : null;
    return { valid: true, side, drivingAngle: elbow, aux: { upperArm } };
  },
  coach(m, state) {
    if (!m.valid) return { text: m.reason, tone: 'warn' };
    if (m.aux.upperArm != null && m.aux.upperArm > 40) return { text: 'Pin your elbow', tone: 'bad' };
    if (state.phase === 'rest' && m.drivingAngle < 150) return { text: 'Fully extend', tone: 'warn' };
    if (state.phase === 'active' && state.direction === 'up') return { text: 'Curl up', tone: 'good' };
    if (state.phase === 'active' && state.direction === 'down') return { text: 'Control down', tone: 'good' };
    return { text: 'Ready', tone: 'good' };
  },
};

// ---------------------------------------------------------------------------
// SHOULDER PRESS — facing. Driving joint: elbow. Peak = extended overhead (LARGE
// angle). peakIsLow=false, so calibration & progress invert automatically.
// ---------------------------------------------------------------------------
const shoulderPress = {
  id: 'shoulder-press',
  name: 'Shoulder press',
  orientation: 'Face the camera, upper body in frame.',
  driver: 'Elbow angle',
  defaults: { restAngle: 74, peakAngle: 166 },
  calibrateMetric: 'drivingAngle',
  peakIsLow: false,
  progressFrom,
  measure(lm) {
    const side = betterSide(lm, [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST], [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST]);
    const P = side === 'L'
      ? { sh: lm[LM.LEFT_SHOULDER], el: lm[LM.LEFT_ELBOW], wr: lm[LM.LEFT_WRIST] }
      : { sh: lm[LM.RIGHT_SHOULDER], el: lm[LM.RIGHT_ELBOW], wr: lm[LM.RIGHT_WRIST] };
    if (!visible([P.sh, P.el, P.wr])) return { valid: false, reason: 'Show your arm', side };
    const elbow = angle(P.sh, P.el, P.wr);
    // wrist above shoulder (image y grows downward, so wrist.y < shoulder.y == overhead)
    const wristAboveShoulder = P.sh.y - P.wr.y; // >0 means overhead
    return { valid: true, side, drivingAngle: elbow, aux: { wristAboveShoulder } };
  },
  coach(m, state) {
    if (!m.valid) return { text: m.reason, tone: 'warn' };
    if (state.progress >= 0.85 && m.aux.wristAboveShoulder <= 0) {
      // "locked out" on elbow angle but hands never went overhead
      return { text: 'Press overhead', tone: 'bad' };
    }
    if (state.phase === 'active' && state.direction === 'up') return { text: 'Press up', tone: 'good' };
    if (state.phase === 'active' && state.direction === 'down') return { text: 'Lower with control', tone: 'good' };
    return { text: 'Ready', tone: 'good' };
  },
};

export const EXERCISES = {
  [squat.id]: squat,
  [pushup.id]: pushup,
  [lunge.id]: lunge,
  [bicepCurl.id]: bicepCurl,
  [shoulderPress.id]: shoulderPress,
};

export const EXERCISE_LIST = [squat, pushup, lunge, bicepCurl, shoulderPress];

export function getExercise(id) {
  return EXERCISES[id] || null;
}
