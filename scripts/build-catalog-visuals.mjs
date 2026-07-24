// Deterministic parametric visual engine for the Form Coach catalog.
//
// A STRICT POSITIVE-WHITELIST resolver maps each catalog exercise to an accurate
// biomechanical archetype (or explicit null with a reason). Every resolved
// exercise gets two self-contained, accessible 900×600 SVG frames built from
// parametric skeleton primitives — no generic decorative cards, no guessing.
//
// Output is written to a STAGING directory (.tmp/catalog-visuals) only. This
// script never touches the shipped manifest, howto module, or assets. Review the
// staged contact sheet (index.html) before any promotion happens.
//
//   node scripts/build-catalog-visuals.mjs         # build staging + report
//   node scripts/build-catalog-visuals.mjs --check  # determinism/validity self-test

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CATALOG_LIST } from '../js/engine/catalog.js';
import { frame } from './lib/skeleton.mjs';
import * as A from './lib/archetypes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '.tmp/catalog-visuals');

// ── token helpers ────────────────────────────────────────────────────────
const norm = (s) => String(s).toLowerCase();
const has = (n, ...words) => words.some((w) => n.includes(w));
const isUni = (n) => /\b(single|one[ -]arm|one arm|single[ -]leg|single leg|unilateral|single arm)\b/.test(n);
const gripOf = (n) => has(n, 'hammer', 'neutral') ? 'neutral' : has(n, 'reverse', 'pronat') ? 'pronated' : 'sup';

function equipToken(n, entry) {
  if (has(n, '(cable)', 'cable')) return 'cable';
  if (has(n, '(band)', 'band', 'resistance')) return 'band';
  if (has(n, '(barbell)', 'barbell', 'smith') || entry.equipment === 'barbell') return 'barbell';
  if (has(n, '(dumbbell)', 'dumbbell') || entry.equipment === 'dumbbell') return 'dumbbell';
  if (has(n, 'kettlebell')) return 'kettlebell';
  if (has(n, '(machine)', 'machine', 'pec deck', 'butterfly')) return 'machine';
  if (has(n, 'plate')) return 'plate';
  return 'dumbbell';
}

// ── STRICT WHITELIST ──────────────────────────────────────────────────────
// Ordered rules. Each: { id, test(n,entry) -> bool, build(n,entry) -> archetype }.
// First match wins. Rules are deliberately narrow: a movement only resolves when
// the archetype is a faithful depiction. Everything else falls through to null.
const RULES = [
  // ---- Curls (biceps) ----
  { id: 'curl', test: (n) => has(n, 'curl') && !has(n, 'leg curl', 'hamstring', 'nordic', 'wrist', 'neck'),
    build: (n, e) => A.curl({ equip: equipToken(n, e), grip: gripOf(n), unilateral: isUni(n),
      pad: has(n, 'preacher', 'spider') ? 'preacher' : null }) },

  // ---- Triceps ----
  { id: 'pushdown', test: (n) => has(n, 'pushdown', 'pressdown', 'press down', 'push down'),
    build: (n) => A.pushdown({ rope: has(n, 'rope'), unilateral: isUni(n) }) },
  { id: 'kickback', test: (n) => has(n, 'kickback') && has(n, 'tricep'),
    build: (n) => A.kickback({ equip: has(n, 'cable') ? 'cable' : 'dumbbell' }) },
  { id: 'skullcrusher', test: (n) => has(n, 'skullcrusher', 'skull crusher', 'lying triceps', 'floor triceps'),
    build: (n, e) => A.skullcrusher({ equip: equipToken(n, e) }) },
  { id: 'overhead-tri', test: (n) => has(n, 'tricep') && has(n, 'extension', 'overhead') && !has(n, 'machine'),
    build: (n, e) => A.overheadTriceps({ equip: equipToken(n, e) }) },

  // ---- Shoulder press / overhead ----
  { id: 'press', test: (n) => (has(n, 'overhead press', 'shoulder press', 'military press') || (has(n, 'press') && has(n, 'seated') && has(n, 'shoulder'))) && !has(n, 'bench', 'chest', 'leg', 'landmine', 'floor'),
    build: (n, e) => A.press({ equip: equipToken(n, e), seated: has(n, 'seated') }) },

  // ---- Raises / delts ----
  { id: 'lateral-raise', test: (n) => has(n, 'lateral raise') && !isUni(n),
    build: (n, e) => A.lateralRaise({ equip: equipToken(n, e), unilateral: false }) },
  { id: 'upright-row', test: (n) => has(n, 'upright row'),
    build: (n, e) => A.uprightRow({ equip: equipToken(n, e) }) },
  { id: 'shrug', test: (n) => has(n, 'shrug'),
    build: (n, e) => A.shrug({ equip: equipToken(n, e) }) },

  // ---- Chest fly / press ----
  { id: 'chest-fly', test: (n) => (has(n, 'fly', 'flys', 'flyes', 'crossover', 'pec deck', 'butterfly')) && has(n, 'chest', 'pec', 'crossover', 'butterfly', 'fly', 'flys', 'flyes') && !has(n, 'reverse', 'rear'),
    build: (n, e) => A.chestFly({ equip: has(n, 'cable', 'crossover') ? 'cable' : has(n, 'band') ? 'band' : has(n, 'dumbbell') ? 'dumbbell' : 'machine', low: has(n, 'low') }) },
  { id: 'bench-press', test: (n) => has(n, 'bench press', 'chest press', 'floor press', 'feet up bench') && !has(n, 'reverse'),
    build: (n, e) => A.benchPress({ equip: equipToken(n, e), incline: has(n, 'incline') ? 26 : has(n, 'decline') ? -20 : 0 }) },

  // ---- Push-ups & dips ----
  { id: 'pushup', test: (n) => has(n, 'push up', 'push-up', 'pushup', 'push ups', 'pushups') && !has(n, 'clap', 'one arm', 'plank pushup', 'handstand'),
    build: (n) => A.pushup({ variant: has(n, 'diamond', 'close') ? 'diamond' : has(n, 'pike') ? 'pike' : has(n, 'kneeling') ? 'kneeling' : has(n, 'wide') ? 'wide' : 'standard' }) },
  { id: 'dip', test: (n) => has(n, 'dip') && !has(n, 'floor triceps'),
    build: (n) => A.dip({ style: has(n, 'chest') ? 'chest' : 'triceps', bench: has(n, 'bench') }) },

  // ---- Rows (bent-over) ----
  { id: 'row', test: (n) => has(n, 'row') && !has(n, 'upright', 'seated cable', 'seated row', 'cable row', 'seated machine', 'high row', 'low row', 'iso-lateral', 'squat row', 'rowing', 'gorilla'),
    build: (n, e) => A.row({ equip: equipToken(n, e), support: has(n, 'chest supported', 'seal', 'incline') ? 'chest' : null, unilateral: isUni(n) }) },
  { id: 'seated-row', test: (n) => has(n, 'seated cable row', 'seated row', 'cable row', 'seated machine', 'low row', 'iso-lateral row', 'iso-lateral low', 'iso-lateral high'),
    build: (n, e) => A.seatedRow({ equip: has(n, 'machine', 'iso-lateral') ? 'machine' : 'cable', unilateral: isUni(n) }) },

  // ---- Pulldowns & pull-ups ----
  { id: 'straight-arm-pulldown', test: (n) => has(n, 'straight arm', 'straight-arm') && has(n, 'pulldown', 'pull down', 'pulldown'),
    build: (n) => A.pulldown({ equip: 'machine', straightArm: true }) },
  { id: 'pulldown', test: (n) => has(n, 'pulldown', 'lat pulldown', 'pull down', 'vertical traction'),
    build: (n) => A.pulldown({ equip: has(n, 'band') ? 'band' : 'machine', unilateral: isUni(n) }) },
  { id: 'pullup', test: (n) => has(n, 'pull up', 'pull-up', 'pullup', 'chin up', 'chin-up') && !has(n, 'kipping', 'scapular', 'negative', 'muscle up'),
    build: (n) => A.pullup({ style: has(n, 'chin') ? 'chin' : 'pullup', weighted: has(n, 'weighted'), assisted: has(n, 'assisted') }) },

  // ---- Squats ----
  { id: 'sumo-squat', test: (n) => has(n, 'sumo squat') || (has(n, 'squat') && has(n, 'sumo')),
    build: (n, e) => A.sumoSquat({ equip: has(n, 'kettlebell') ? 'kettlebell' : has(n, 'dumbbell') ? 'dumbbell' : has(n, 'barbell') ? 'barbell' : 'none' }) },
  { id: 'pistol-squat', test: (n) => has(n, 'pistol squat', 'pistol squats'),
    build: () => A.squat({ hold: 'none', unilateral: true, depth: 'deep' }) },
  { id: 'bulgarian', test: (n) => has(n, 'bulgarian') || has(n, 'split squat'),
    build: (n) => A.lunge({ hold: has(n, 'barbell') ? 'back' : has(n, 'dumbbell') ? 'dumbbell' : 'none', rear: 'bench' }) },
  { id: 'squat', test: (n) => has(n, 'squat') && !has(n, 'sissy', 'spanish', 'squat row', 'squat and press', 'jump'),
    build: (n, e) => A.squat({
      hold: has(n, 'front squat') ? 'front' : has(n, 'goblet') ? 'goblet' : has(n, 'zercher') ? 'zercher' : e.equipment === 'barbell' ? 'back' : 'none',
      frame: has(n, 'hack') ? 'hack' : has(n, 'smith') ? 'smith' : has(n, 'machine', 'pendulum', 'belt') ? 'machine' : null,
      depth: has(n, 'box') ? 'parallel' : 'parallel',
    }) },

  // ---- Lunges / step-ups ----
  { id: 'step-up', test: (n) => has(n, 'step up', 'step-up'),
    build: (n) => A.lunge({ hold: has(n, 'dumbbell') ? 'dumbbell' : has(n, 'barbell') ? 'back' : 'none', step: true }) },
  { id: 'lunge', test: (n) => has(n, 'lunge') && !has(n, 'jumping', 'lateral', 'curtsy'),
    build: (n) => A.lunge({ hold: has(n, 'dumbbell', 'overhead') ? 'dumbbell' : has(n, 'barbell') ? 'back' : 'none', reverse: has(n, 'reverse') }) },

  // ---- Hinges ----
  { id: 'deadlift', test: (n) => has(n, 'deadlift') && !has(n, 'romanian', 'straight leg', 'stiff', 'high pull', 'single leg'),
    build: (n, e) => A.hinge({ equip: has(n, 'dumbbell') ? 'dumbbell' : has(n, 'trap bar', 'band') ? (has(n, 'band') ? 'band' : 'barbell') : 'barbell', style: 'conventional' }) },
  { id: 'rdl', test: (n) => has(n, 'romanian deadlift', 'straight leg deadlift', 'stiff leg', 'stiff-leg') && !isUni(n),
    build: (n, e) => A.hinge({ equip: has(n, 'dumbbell') ? 'dumbbell' : 'barbell', style: 'rdl' }) },
  { id: 'single-leg-rdl', test: (n) => (has(n, 'romanian deadlift', 'rdl') && isUni(n)),
    build: (n) => A.hinge({ equip: has(n, 'dumbbell') ? 'dumbbell' : 'barbell', style: 'rdl', unilateral: true }) },
  { id: 'goodmorning', test: (n) => has(n, 'good morning', 'good-morning'),
    build: () => A.hinge({ equip: 'barbell', style: 'goodmorning' }) },
  { id: 'kb-swing', test: (n) => has(n, 'kettlebell swing') || (has(n, 'swing') && has(n, 'kettlebell')),
    build: () => A.kbSwing() },

  // ---- Hip thrust / bridge ----
  { id: 'hip-thrust', test: (n) => has(n, 'hip thrust'),
    build: (n, e) => A.hipThrust({ equip: has(n, 'dumbbell') ? 'dumbbell' : has(n, 'barbell', 'smith') ? 'barbell' : has(n, 'machine') ? 'none' : 'barbell', bench: true, unilateral: isUni(n) }) },
  { id: 'glute-bridge', test: (n) => has(n, 'glute bridge', 'partial glute bridge'),
    build: (n) => A.hipThrust({ equip: has(n, 'barbell') ? 'barbell' : 'none', bench: false, unilateral: isUni(n) }) },

  // ---- Calves ----
  { id: 'calf', test: (n) => has(n, 'calf raise', 'calf press', 'calf extension', 'standing calf'),
    build: (n, e) => A.calfRaise({ equip: has(n, 'dumbbell') ? 'dumbbell' : has(n, 'barbell') ? 'barbell' : 'none', seated: has(n, 'seated'), unilateral: isUni(n) }) },

  // ---- Back extension ----
  { id: 'back-extension', test: (n) => has(n, 'back extension', 'hyperextension', 'hyper extension'),
    build: (n) => A.backExtension({ weighted: has(n, 'weighted') }) },

  // ---- Hip abduction / adduction machines ----
  { id: 'hip-abd', test: (n) => has(n, 'hip abduction'),
    build: () => A.hipAbduction({ adduction: false }) },
  { id: 'hip-add', test: (n) => has(n, 'hip adduction'),
    build: () => A.hipAbduction({ adduction: true }) },

  // ---- Core ----
  { id: 'ab-wheel', test: (n) => has(n, 'ab wheel'),
    build: () => A.abWheel() },
  { id: 'plank', test: (n) => has(n, 'plank') && !has(n, 'pushup', 'reverse plank'),
    build: (n) => A.plank({ side: has(n, 'side') }) },
  { id: 'hanging-raise', test: (n) => (has(n, 'hanging') && has(n, 'raise')) || has(n, 'toes to bar', 'leg raise parallel'),
    build: (n) => A.hangingRaise({ knees: has(n, 'knee'), toesToBar: has(n, 'toes to bar') }) },
  { id: 'leg-raise', test: (n) => has(n, 'lying knee raise', 'lying leg raise', 'straight leg raise', 'flutter kick', 'leg raise') && !has(n, 'calf', 'parallel'),
    build: (n) => A.legRaiseLying({ knees: has(n, 'knee') }) },
  { id: 'crunch', test: (n) => has(n, 'crunch', 'sit up', 'sit-up', 'situp') && !has(n, 'bicycle', 'reverse', 'cable'),
    build: (n) => A.crunch({ weighted: has(n, 'weighted'), decline: has(n, 'decline'), machine: has(n, 'machine') }) },

  // ---- Carries ----
  { id: 'carry', test: (n) => has(n, 'suitcase carry', 'farmer', "farmer's"),
    build: (n) => A.carry({ equip: 'dumbbell', unilateral: has(n, 'suitcase') }) },
];

// Movements deliberately declined (explicit null + reason). These are dynamic,
// ballistic, sport/conditioning, or posturally too specific to render honestly
// as a two-frame parametric diagram.
const DECLINE = [
  [/(running|sprint|jog|treadmill|walking(?! lunge)|hiking|marath)/, 'locomotion — no discrete two-frame form to depict'],
  [/(cycling|spinning|air bike|bike|rowing machine|ski erg|stair machine|elliptical|aerobics|hiit|climbing|swimming|skiing|snowboard|skating|boxing|pilates|yoga|stretching|warm up|warm-up|dance)/, 'cardio / sport / mobility session — not a single strength rep'],
  [/(clean|jerk|snatch|press under|high pull|jump shrug|clean pull|deadlift high pull)/, 'Olympic / explosive lift — velocity-defined, unsafe to reduce to two static frames'],
  [/(burpee|box jump|broad jump|frog jump|jumping jack|jumping lunge|high knee|jump shrug|clap push|kipping|frog pump|ball slam|wall ball|battle rope|sled|bear crawl|spiderman|mountain climber|thruster|squat and press|landmine squat and press|deadlift high pull|gorilla row|around the world|halo|wrist roller|dead hang|handstand|front lever|dragon flag|dragonfly|human flag|l-sit|hollow rock|planche|scapular|negative pull|sternum pull|muscle up)/, 'ballistic / compound-flow / advanced-static skill — outside the accurate-archetype set'],
  [/(neck curl|neck extension|wrist curl|wrist extension|reverse wrist|behind the back wrist|palms up wrist|seated wrist)/, 'small isolated joint — no informative full-body silhouette'],
  [/(pullapart|pull apart|pull-apart|cable crunch)/, 'horizontal-plane / kneeling-cable posture the current archetype set does not depict faithfully yet'],
  [/(russian twist|torso rotation|side bend|cable twist|pallof|woodchop|bicycle crunch|dead bug|bird dog|heel taps|shoulder taps|ab scissors|v up|v-up|toe touch|reverse plank|side plank|glute kickback|standing leg curl|single leg extension|leg extension|leg press|nordic|fire hydrant|curtsy|lateral lunge|lateral squat|lateral raise single|rear delt|reverse fly|reverse curl|zottman|concentration|waiter curl|pinwheel|cross body|pull through|around|squeeze press|hex press|around the world)/, 'requires a rotation / specific-plane / posture the current archetype set does not depict faithfully yet'],
];

function resolve(entry) {
  const n = norm(entry.name);
  for (const [re, reason] of DECLINE) if (re.test(n)) return { archetype: null, reason };
  for (const rule of RULES) {
    try {
      if (rule.test(n, entry)) return { archetype: rule.build(n, entry), rule: rule.id };
    } catch (err) {
      return { archetype: null, reason: `resolver error in ${rule.id}: ${err.message}` };
    }
  }
  return { archetype: null, reason: 'no confident archetype match' };
}

// ── validation ────────────────────────────────────────────────────────────
function validateSvg(svg, id) {
  if (!svg.startsWith('<svg')) throw new Error(`${id}: not an SVG`);
  if (!svg.includes('<title') || !svg.includes('<desc')) throw new Error(`${id}: missing a11y title/desc`);
  if (!svg.trimEnd().endsWith('</svg>')) throw new Error(`${id}: unterminated SVG`);
  if (/NaN|undefined|Infinity/.test(svg)) throw new Error(`${id}: non-finite coordinate in output`);
  const opens = (svg.match(/<(svg|g|text|polygon|circle|rect|marker)\b/g) || []).length;
  const closes = (svg.match(/<\/(svg|g|text|polygon|circle|rect|marker)>/g) || []).length;
  const selfRect = (svg.match(/<rect[^>]*\/>/g) || []).length + (svg.match(/<circle[^>]*\/>/g) || []).length
    + (svg.match(/<polygon[^>]*\/>/g) || []).length;
  // not a strict parser, but catches gross imbalance
  if (closes > opens) throw new Error(`${id}: tag imbalance`);
  return true;
}

// ── build ─────────────────────────────────────────────────────────────────
async function build({ checkOnly = false } = {}) {
  const resolved = [];
  const unresolved = [];
  const byRule = {};
  const hashes = {};

  if (!checkOnly) {
    await fs.rm(OUT, { recursive: true, force: true });
    await fs.mkdir(OUT, { recursive: true });
  }

  for (const [index, entry] of CATALOG_LIST.entries()) {
    const res = resolve(entry);
    if (!res.archetype) {
      unresolved.push({ index, id: entry.id, name: entry.name, equipment: entry.equipment, reason: res.reason });
      continue;
    }
    const { view, frames } = res.archetype;
    if (!Array.isArray(frames) || frames.length !== 2) {
      unresolved.push({ index, id: entry.id, name: entry.name, equipment: entry.equipment, reason: `archetype ${res.rule} did not yield two frames` });
      continue;
    }
    const images = [];
    const dir = path.join(OUT, entry.id);
    if (!checkOnly) await fs.mkdir(dir, { recursive: true });
    for (const [fi, [phase, cue, body]] of frames.entries()) {
      const svg = frame(entry.name, phase, cue, body);
      validateSvg(svg, `${entry.id}#${fi}`);
      hashes[`${entry.id}/${fi}`] = createHash('sha1').update(svg).digest('hex').slice(0, 12);
      if (!checkOnly) await fs.writeFile(path.join(dir, `${fi}.svg`), svg);
      images.push(`./${entry.id}/${fi}.svg`);
    }
    byRule[res.rule] = (byRule[res.rule] || 0) + 1;
    resolved.push({ index, id: entry.id, name: entry.name, equipment: entry.equipment, view, rule: res.rule, images });
  }

  const report = {
    generatedFrom: 'js/engine/catalog.js',
    catalogCount: CATALOG_LIST.length,
    resolvedCount: resolved.length,
    unresolvedCount: unresolved.length,
    archetypeCoverage: Object.fromEntries(Object.entries(byRule).sort((a, b) => b[1] - a[1])),
    resolved,
    unresolved,
  };

  if (!checkOnly) {
    await fs.writeFile(path.join(OUT, 'mapping-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    await fs.writeFile(path.join(OUT, 'mapping-report.md'), renderReportMd(report));
    await fs.writeFile(path.join(OUT, 'index.html'), renderIndex(resolved, report));
  }
  return { report, hashes };
}

function renderReportMd(r) {
  const lines = [
    '# Catalog visual mapping report', '',
    `Generated deterministically from \`${r.generatedFrom}\`. Staging only — nothing here is promoted into the shipped app.`, '',
    `- **Catalog exercises:** ${r.catalogCount}`,
    `- **Resolved (2 parametric frames each):** ${r.resolvedCount}`,
    `- **Unresolved (explicit null + reason):** ${r.unresolvedCount}`, '',
    '## Archetype coverage', '',
    '| Archetype rule | Exercises |', '|---|---|',
    ...Object.entries(r.archetypeCoverage).map(([k, v]) => `| \`${k}\` | ${v} |`),
    '', '## Resolved exercises', '',
    '| # | ID | Exercise | Equip | View | Archetype |', '|---|---|---|---|---|---|',
    ...r.resolved.map((x) => `| ${x.index} | \`${x.id}\` | ${esc(x.name)} | ${x.equipment} | ${x.view} | \`${x.rule}\` |`),
    '', '## Unresolved exercises (declined with reason)', '',
    '| # | ID | Exercise | Equip | Reason |', '|---|---|---|---|---|',
    ...r.unresolved.map((x) => `| ${x.index} | \`${x.id}\` | ${esc(x.name)} | ${x.equipment} | ${esc(x.reason)} |`),
    '',
  ];
  return lines.join('\n');
}

function renderIndex(resolved, r) {
  const cards = resolved.map((x) => `
    <figure>
      <figcaption>${esc(x.name)} <span class="tag">${x.rule} · ${x.view}</span></figcaption>
      <div class="pair"><img loading="lazy" src="${x.images[0]}" alt="${esc(x.name)} start"><img loading="lazy" src="${x.images[1]}" alt="${esc(x.name)} finish"></div>
    </figure>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Form Coach — staged catalog visuals (${resolved.length})</title>
  <style>
    body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#eef2f6;color:#17212b}
    header{padding:24px 28px;background:#fff;border-bottom:2px solid #d8e0e8;position:sticky;top:0}
    h1{margin:0 0 4px;font-size:22px} .sub{color:#536273}
    main{display:grid;grid-template-columns:repeat(auto-fill,minmax(430px,1fr));gap:20px;padding:24px}
    figure{margin:0;background:#fff;border-radius:14px;padding:12px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
    figcaption{font-weight:700;margin-bottom:8px;display:flex;justify-content:space-between;gap:8px;align-items:center}
    .tag{font-weight:600;font-size:11px;color:#fff;background:#ff334f;padding:3px 8px;border-radius:20px;white-space:nowrap}
    .pair{display:grid;grid-template-columns:1fr 1fr;gap:8px} img{width:100%;height:auto;border-radius:8px;background:#f8fafc}
  </style></head><body>
  <header><h1>Form Coach — staged catalog visuals</h1>
  <div class="sub">${resolved.length} resolved · ${r.unresolvedCount} declined · ${r.catalogCount} total. Deterministic parametric SVG — review before promotion.</div></header>
  <main>${cards}</main></body></html>`;
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export { resolve, build, validateSvg, RULES, DECLINE };

// ── entry (only when run directly, not when imported by tests) ────────────
const checkOnly = process.argv.includes('--check');
if (import.meta.main) {
if (checkOnly) {
  const a = await build({ checkOnly: true });
  const b = await build({ checkOnly: true });
  const same = JSON.stringify(a.hashes) === JSON.stringify(b.hashes);
  console.log(JSON.stringify({
    determinism: same ? 'PASS (byte-identical across two runs)' : 'FAIL',
    frames: Object.keys(a.hashes).length,
    resolved: a.report.resolvedCount,
    unresolved: a.report.unresolvedCount,
  }, null, 2));
  if (!same) process.exit(1);
} else {
  const { report } = await build();
  console.log(JSON.stringify({
    catalog: report.catalogCount,
    resolved: report.resolvedCount,
    unresolved: report.unresolvedCount,
    coverage: report.archetypeCoverage,
    out: path.relative(ROOT, OUT),
  }, null, 2));
}
}
