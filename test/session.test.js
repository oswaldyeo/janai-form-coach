import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionRecorder, toExportDocument, SCHEMA, SCHEMA_VERSION } from '../js/engine/session.js';
import { getExercise } from '../js/engine/exercises.js';
import { defaultCalibration } from '../js/engine/calibration.js';

const squat = getExercise('squat');

// Deterministic injectable clock.
function fakeClock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

test('records reps with schema-correct fields', () => {
  const now = fakeClock();
  const rec = new SessionRecorder({ exercise: squat, target: 3, calibration: defaultCalibration(squat), now, id: 'test-1' });
  now.advance(2000); rec.recordRep(0.92);
  now.advance(2000); rec.recordRep(0.88);
  now.advance(2000); rec.end();

  const json = rec.toJSON();
  assert.equal(json.schema, SCHEMA);
  assert.equal(json.version, SCHEMA_VERSION);
  assert.equal(json.exercise, 'squat');
  assert.equal(json.reps.length, 2);
  assert.equal(json.reps[0].depthPct, 92);
  assert.equal(json.reps[0].quality, 'full');
  assert.equal(json.reps[0].tMs, 2000);
  assert.equal(json.durationSec, 6);
  assert.equal(json.counts.full, 2);
  assert.equal(json.completed, false); // 2 of 3
});

test('completed flips true when target reached', () => {
  const now = fakeClock();
  const rec = new SessionRecorder({ exercise: squat, target: 2, calibration: null, now });
  rec.recordRep(0.9);
  rec.recordRep(0.9);
  assert.equal(rec.completed, true);
});

test('partials and cues are recorded and cues dedupe consecutively', () => {
  const now = fakeClock();
  const rec = new SessionRecorder({ exercise: squat, target: null, calibration: null, now });
  rec.recordPartial();
  rec.recordCue('Chest up', 'bad');
  rec.recordCue('Chest up', 'bad'); // deduped
  rec.recordCue('A little lower', 'warn');
  rec.recordCue('Ready', 'good'); // good tone ignored
  const json = rec.toJSON();
  assert.equal(json.partials, 1);
  assert.equal(json.cues.length, 2);
});

test('summary rolls up depth stats', () => {
  const now = fakeClock();
  const rec = new SessionRecorder({ exercise: squat, target: 2, calibration: null, now });
  now.advance(1000); rec.recordRep(0.8);
  now.advance(1000); rec.recordRep(1.0);
  rec.end();
  const s = rec.summary();
  assert.equal(s.reps, 2);
  assert.equal(s.avgDepthPct, 90);
  assert.equal(s.bestDepthPct, 100);
  assert.equal(s.completed, true);
});

test('toExportDocument wraps sessions with schema header', () => {
  const now = fakeClock();
  const rec = new SessionRecorder({ exercise: squat, target: 1, calibration: null, now });
  rec.recordRep(0.9); rec.end();
  const doc = toExportDocument([rec.toJSON()]);
  assert.equal(doc.schema, SCHEMA);
  assert.equal(doc.sessions.length, 1);
});

test('edge: constructing without a clock throws (no hidden Date.now)', () => {
  assert.throws(() => new SessionRecorder({ exercise: squat, target: 1, calibration: null }), /requires a now/);
});
