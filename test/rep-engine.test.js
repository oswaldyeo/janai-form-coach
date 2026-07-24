import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RepEngine } from '../js/engine/rep-engine.js';

// Feed a progress sequence and return the last event.
function feed(engine, seq) {
  let last = null;
  for (const p of seq) last = engine.update(p);
  return last;
}

// One full rest→peak→rest excursion.
function repCycle(peak = 0.95) {
  return [0, 0.2, 0.5, 0.8, peak, 0.8, 0.5, 0.2, 0];
}

test('counts one rep per full excursion', () => {
  const e = new RepEngine();
  feed(e, repCycle());
  assert.equal(e.count, 1);
  feed(e, repCycle());
  assert.equal(e.count, 2);
});

test('partial excursion (never reaches peak) is not counted', () => {
  const e = new RepEngine();
  const ev = feed(e, [0, 0.3, 0.5, 0.6, 0.5, 0.3, 0]); // peak 0.6 < enterPeak 0.7
  assert.equal(e.count, 0);
  assert.equal(e.partials, 1);
  assert.equal(ev.partial, true);
});

test('hysteresis prevents double-count on jitter near peak', () => {
  const e = new RepEngine();
  // wobble around the peak threshold without returning to rest
  feed(e, [0, 0.8, 0.68, 0.82, 0.69, 0.85]);
  assert.equal(e.count, 0, 'no rest crossing yet, so no completed rep');
  feed(e, [0.1, 0]); // now return to rest → exactly one rep
  assert.equal(e.count, 1);
});

test('reports peakProgress of the completed rep', () => {
  const e = new RepEngine();
  let completion = null;
  for (const p of repCycle(0.9)) {
    const ev = e.update(p);
    if (ev.repCompleted) completion = ev;
  }
  assert.ok(completion, 'a rep completed');
  assert.equal(completion.repCompleted, true);
  assert.ok(Math.abs(completion.peakProgress - 0.9) < 1e-9);
});

test('direction tracking', () => {
  const e = new RepEngine();
  e.update(0.1);
  assert.equal(e.update(0.4).direction, 'up');
  assert.equal(e.update(0.2).direction, 'down');
  assert.equal(e.update(0.2).direction, 'hold');
});

test('reset clears all state', () => {
  const e = new RepEngine();
  feed(e, repCycle());
  e.reset();
  assert.equal(e.count, 0);
  assert.equal(e.partials, 0);
  assert.equal(e.phase, 'rest');
});

test('edge: NaN/undefined progress is treated as 0 and never crashes', () => {
  const e = new RepEngine();
  const ev = e.update(NaN);
  assert.equal(ev.progress, 0);
  assert.equal(e.count, 0);
});
