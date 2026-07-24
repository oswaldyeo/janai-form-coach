// Synthetic landmark fixtures for the exercise tests.
//
// We build a full 33-point MediaPipe landmark array where the three points that
// drive a given joint angle are placed to yield *exactly* a requested angle, and
// the auxiliary points (torso, body-line, etc.) are placed for good (or
// deliberately bad) form. `pointAtAngle` guarantees angle(ref, vertex, P) equals
// the requested degrees, so fixtures are exact, not eyeballed.

import { LM } from '../js/engine/landmarks.js';

const D2R = Math.PI / 180;

// A point P such that the interior angle ref–vertex–P equals `deg`.
export function pointAtAngle(vertex, ref, deg, len, sign = 1) {
  const dir1 = Math.atan2(ref.y - vertex.y, ref.x - vertex.x);
  const dir2 = dir1 + sign * deg * D2R;
  return { x: vertex.x + len * Math.cos(dir2), y: vertex.y + len * Math.sin(dir2), visibility: 1 };
}

// 33 landmarks, all present but invisible by default; callers light up the ones
// the exercise reads.
export function blankPose() {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
}

function put(pose, idx, p) { pose[idx] = { x: p.x, y: p.y, z: 0, visibility: p.visibility ?? 1 }; }

// ── SQUAT ── knee = hip-knee-ankle ; torso = shoulder-hip-knee
export function squatPose(kneeAngle, { torso = 160 } = {}) {
  const pose = blankPose();
  const knee = { x: 0.5, y: 0.6, visibility: 1 };
  const ankle = { x: 0.5, y: 0.85, visibility: 1 };
  const hip = pointAtAngle(knee, ankle, kneeAngle, 0.22, -1);
  const shoulder = pointAtAngle(hip, knee, torso, 0.22, 1);
  put(pose, LM.LEFT_SHOULDER, shoulder);
  put(pose, LM.LEFT_HIP, hip);
  put(pose, LM.LEFT_KNEE, knee);
  put(pose, LM.LEFT_ANKLE, ankle);
  return pose;
}

// ── PUSH-UP ── elbow = shoulder-elbow-wrist ; bodyLine = shoulder-hip-ankle
export function pushupPose(elbowAngle, { bodyLine = 178 } = {}) {
  const pose = blankPose();
  const elbow = { x: 0.5, y: 0.5, visibility: 1 };
  const wrist = { x: 0.5, y: 0.75, visibility: 1 };
  const shoulder = pointAtAngle(elbow, wrist, elbowAngle, 0.2, -1);
  const hip = { x: 0.68, y: shoulder.y + 0.02, visibility: 1 };
  const ankle = pointAtAngle(hip, shoulder, bodyLine, 0.3, 1);
  put(pose, LM.LEFT_SHOULDER, shoulder);
  put(pose, LM.LEFT_ELBOW, elbow);
  put(pose, LM.LEFT_WRIST, wrist);
  put(pose, LM.LEFT_HIP, hip);
  put(pose, LM.LEFT_ANKLE, ankle);
  return pose;
}

// ── ALTERNATING LUNGE ── working (left) knee small, right knee straight
export function lungePose(frontKnee, { torso = 170, backKnee = 175 } = {}) {
  const pose = blankPose();
  // left = working leg
  const lKnee = { x: 0.4, y: 0.6, visibility: 1 };
  const lAnkle = { x: 0.4, y: 0.85, visibility: 1 };
  const lHip = pointAtAngle(lKnee, lAnkle, frontKnee, 0.22, -1);
  const lSh = pointAtAngle(lHip, lKnee, torso, 0.22, 1);
  put(pose, LM.LEFT_SHOULDER, lSh);
  put(pose, LM.LEFT_HIP, lHip);
  put(pose, LM.LEFT_KNEE, lKnee);
  put(pose, LM.LEFT_ANKLE, lAnkle);
  // right = trailing leg (kept straighter → larger angle so it's not "working")
  const rKnee = { x: 0.62, y: 0.6, visibility: 1 };
  const rAnkle = { x: 0.62, y: 0.85, visibility: 1 };
  const rHip = pointAtAngle(rKnee, rAnkle, backKnee, 0.22, 1);
  put(pose, LM.RIGHT_HIP, rHip);
  put(pose, LM.RIGHT_KNEE, rKnee);
  put(pose, LM.RIGHT_ANKLE, rAnkle);
  return pose;
}

// ── BICEP CURL ── elbow = shoulder-elbow-wrist ; upperArm = hip-shoulder-elbow
export function curlPose(elbowAngle, { upperArm = 18 } = {}) {
  const pose = blankPose();
  const elbow = { x: 0.5, y: 0.5, visibility: 1 };
  const wrist = { x: 0.5, y: 0.72, visibility: 1 };
  const shoulder = pointAtAngle(elbow, wrist, elbowAngle, 0.2, -1);
  const hip = pointAtAngle(shoulder, elbow, upperArm, 0.25, 1);
  put(pose, LM.LEFT_SHOULDER, shoulder);
  put(pose, LM.LEFT_ELBOW, elbow);
  put(pose, LM.LEFT_WRIST, wrist);
  put(pose, LM.LEFT_HIP, hip);
  return pose;
}

// ── SHOULDER PRESS ── elbow = shoulder-elbow-wrist ; wrist above shoulder overhead
export function pressPose(elbowAngle) {
  const pose = blankPose();
  const elbow = { x: 0.5, y: 0.45, visibility: 1 };
  const shoulder = { x: 0.48, y: 0.62, visibility: 1 };
  // wrist opposite the shoulder ray by `elbowAngle`; large angle → wrist goes overhead
  const wrist = pointAtAngle(elbow, shoulder, elbowAngle, 0.25, -1);
  put(pose, LM.LEFT_SHOULDER, shoulder);
  put(pose, LM.LEFT_ELBOW, elbow);
  put(pose, LM.LEFT_WRIST, wrist);
  return pose;
}

// ── GOBLET SQUAT ── identical geometry to the bodyweight squat (knee driver).
export function gobletSquatPose(kneeAngle, opts = {}) {
  return squatPose(kneeAngle, opts);
}

// ── BENCH PRESS ── supine side-on. elbow = shoulder-elbow-wrist; wrist above
// shoulder at lockout (large angle → wrist travels overhead in image space).
export function benchPose(elbowAngle) {
  const pose = blankPose();
  const elbow = { x: 0.5, y: 0.45, visibility: 1 };
  const shoulder = { x: 0.48, y: 0.62, visibility: 1 };
  const wrist = pointAtAngle(elbow, shoulder, elbowAngle, 0.25, -1);
  put(pose, LM.LEFT_SHOULDER, shoulder);
  put(pose, LM.LEFT_ELBOW, elbow);
  put(pose, LM.LEFT_WRIST, wrist);
  return pose;
}

// ── SKULL CRUSHER ── elbow = shoulder-elbow-wrist ; upperArm = hip-shoulder-elbow
// (a steady skull crusher keeps the upper arm ~90° to the torso).
export function skullCrusherPose(elbowAngle, { upperArm = 90 } = {}) {
  const pose = blankPose();
  const elbow = { x: 0.5, y: 0.5, visibility: 1 };
  const wrist = { x: 0.5, y: 0.72, visibility: 1 };
  const shoulder = pointAtAngle(elbow, wrist, elbowAngle, 0.2, -1);
  const hip = pointAtAngle(shoulder, elbow, upperArm, 0.25, 1);
  put(pose, LM.LEFT_SHOULDER, shoulder);
  put(pose, LM.LEFT_ELBOW, elbow);
  put(pose, LM.LEFT_WRIST, wrist);
  put(pose, LM.LEFT_HIP, hip);
  return pose;
}

// ── TRICEPS PUSHDOWN ── elbow = shoulder-elbow-wrist ; upperArm = hip-shoulder-elbow
// (pinned elbow → small, steady upper-arm angle).
export function pushdownPose(elbowAngle, { upperArm = 12 } = {}) {
  const pose = blankPose();
  const elbow = { x: 0.5, y: 0.5, visibility: 1 };
  const wrist = { x: 0.5, y: 0.72, visibility: 1 };
  const shoulder = pointAtAngle(elbow, wrist, elbowAngle, 0.2, -1);
  const hip = pointAtAngle(shoulder, elbow, upperArm, 0.25, 1);
  put(pose, LM.LEFT_SHOULDER, shoulder);
  put(pose, LM.LEFT_ELBOW, elbow);
  put(pose, LM.LEFT_WRIST, wrist);
  put(pose, LM.LEFT_HIP, hip);
  return pose;
}

// ── ONE-ARM DB ROW ── elbow = shoulder-elbow-wrist ; backLine = shoulder-hip-knee.
// Working side (default left) lit up; the other side stays invisible.
export function rowPose(elbowAngle, { backLine = 170, side = 'L' } = {}) {
  const pose = blankPose();
  const elbow = { x: 0.5, y: 0.5, visibility: 1 };
  const wrist = { x: 0.5, y: 0.78, visibility: 1 };
  const shoulder = pointAtAngle(elbow, wrist, elbowAngle, 0.2, -1);
  const hip = { x: shoulder.x + 0.28, y: shoulder.y + 0.03, visibility: 1 };
  const knee = pointAtAngle(hip, shoulder, backLine, 0.3, 1);
  const idx = side === 'L'
    ? { sh: LM.LEFT_SHOULDER, el: LM.LEFT_ELBOW, wr: LM.LEFT_WRIST, hip: LM.LEFT_HIP, knee: LM.LEFT_KNEE }
    : { sh: LM.RIGHT_SHOULDER, el: LM.RIGHT_ELBOW, wr: LM.RIGHT_WRIST, hip: LM.RIGHT_HIP, knee: LM.RIGHT_KNEE };
  put(pose, idx.sh, shoulder);
  put(pose, idx.el, elbow);
  put(pose, idx.wr, wrist);
  put(pose, idx.hip, hip);
  put(pose, idx.knee, knee);
  return pose;
}

// Drive a rest→peak→rest cycle N times through measure→progressFrom→engine.
// Returns the final engine state so a test can assert the rep count.
export function runReps(exercise, calib, engine, poseFor, { rest, peak, reps, steps = 6 }) {
  const cycle = [];
  for (let i = 0; i <= steps; i++) cycle.push(rest + (peak - rest) * (i / steps)); // down
  for (let i = 1; i <= steps; i++) cycle.push(peak + (rest - peak) * (i / steps)); // up
  let last = null;
  for (let r = 0; r < reps; r++) {
    for (const ang of cycle) {
      const m = exercise.measure(poseFor(ang));
      const progress = m.valid ? exercise.progressFrom(m.drivingAngle, calib) : 0;
      if (m.valid) last = engine.update(progress);
    }
  }
  return last;
}
