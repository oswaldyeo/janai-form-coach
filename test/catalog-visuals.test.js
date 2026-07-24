// Tests for the deterministic parametric catalog visual engine.
// Verifies skeleton geometry, resolver whitelist behaviour, SVG accessibility /
// well-formedness, and byte-level determinism. No files are written (checkOnly).

import test from 'node:test';
import assert from 'node:assert/strict';
import { seg, ik2, frame } from '../scripts/lib/skeleton.mjs';
import * as A from '../scripts/lib/archetypes.mjs';
import { resolve, build, validateSvg, DECLINE } from '../scripts/build-catalog-visuals.mjs';
import { CATALOG_LIST } from '../js/engine/catalog.js';

test('seg advances the correct distance and direction', () => {
  const up = seg({ x: 0, y: 100 }, 0, 50);
  assert.equal(up.x, 0);
  assert.equal(up.y, 50); // straight up = smaller y
  const right = seg({ x: 0, y: 0 }, 90, 50);
  assert.equal(right.x, 50);
  assert.equal(right.y, 0);
});

test('ik2 keeps the middle joint at limb length and never returns NaN', () => {
  const a = { x: 0, y: 0 };
  const c = { x: 60, y: 80 }; // reachable within 60+60
  const knee = ik2(a, c, 60, 60, 1);
  assert.ok(Number.isFinite(knee.x) && Number.isFinite(knee.y));
  assert.ok(Math.abs(Math.hypot(knee.x - a.x, knee.y - a.y) - 60) < 0.5);
  // over-extended target is clamped, still finite
  const far = ik2(a, { x: 500, y: 0 }, 60, 60, 1);
  assert.ok(Number.isFinite(far.x) && Number.isFinite(far.y));
});

test('frame() emits accessible, well-formed SVG', () => {
  const svg = frame('Test Move', 'START', 'a cue', '<circle cx="1" cy="1" r="1"/>');
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('role="img"'));
  assert.ok(svg.includes('<title'));
  assert.ok(svg.includes('<desc'));
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.doesNotThrow(() => validateSvg(svg, 'test'));
});

test('every archetype yields exactly two frames with body content', () => {
  const samples = [
    A.curl({}), A.press({}), A.squat({}), A.hinge({}), A.benchPress({}),
    A.pushup({}), A.pullup({}), A.pulldown({}), A.row({}), A.hipThrust({}),
    A.calfRaise({}), A.lunge({}), A.seatedRow({}), A.dip({}), A.chestFly({}),
    A.crunch({}), A.hangingRaise({}), A.kbSwing({}), A.backExtension({}),
    A.sumoSquat({}), A.hipAbduction({}), A.plank({}), A.abWheel({}),
    A.shrug({}), A.pushdown({}), A.overheadTriceps({}), A.kickback({}),
    A.skullcrusher({}), A.lateralRaise({}), A.uprightRow({}),
    A.legRaiseLying({}), A.carry({}),
  ];
  for (const arch of samples) {
    assert.ok(['side', 'front'].includes(arch.view));
    assert.equal(arch.frames.length, 2);
    for (const [phase, cue, body] of arch.frames) {
      assert.ok(phase && cue && body.length > 40);
      const svg = frame('X', phase, cue, body);
      assert.doesNotThrow(() => validateSvg(svg, phase));
      assert.ok(!/NaN|undefined|Infinity/.test(svg));
    }
  }
});

test('resolver is a strict whitelist: unmatched names return explicit null', () => {
  assert.equal(resolve({ name: 'Underwater Basket Weaving', equipment: 'none' }).archetype, null);
  assert.equal(resolve({ name: 'Running', equipment: 'none' }).archetype, null);
  assert.equal(resolve({ name: 'Clean and Jerk', equipment: 'barbell' }).archetype, null);
  // a clear match resolves
  const curl = resolve({ name: 'Bicep Curl (Dumbbell)', equipment: 'dumbbell' });
  assert.ok(curl.archetype);
  assert.equal(curl.rule, 'curl');
});

test('declined movements always carry a human-readable reason', () => {
  for (const entry of CATALOG_LIST) {
    const r = resolve(entry);
    if (!r.archetype) assert.ok(typeof r.reason === 'string' && r.reason.length > 8, `${entry.id} missing reason`);
  }
});

test('full catalog build is byte-for-byte deterministic', async () => {
  const a = await build({ checkOnly: true });
  const b = await build({ checkOnly: true });
  assert.deepEqual(a.hashes, b.hashes);
  assert.ok(a.report.resolvedCount > 200, `expected >200 resolved, got ${a.report.resolvedCount}`);
  assert.equal(a.report.resolvedCount + a.report.unresolvedCount, CATALOG_LIST.length);
});
