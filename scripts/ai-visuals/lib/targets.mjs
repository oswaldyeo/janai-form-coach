// Target derivation + per-exercise ground truth + prompt/verifier text building.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './config.mjs';

// Human-readable equipment class + the strict class name the verifier checks.
const EQUIP_MAP = {
  none: { human: 'bodyweight (no equipment)', klass: 'bodyweight' },
  barbell: { human: 'a barbell', klass: 'barbell' },
  dumbbell: { human: 'dumbbell(s)', klass: 'dumbbell' },
  kettlebell: { human: 'a kettlebell', klass: 'kettlebell' },
  machine: { human: 'a weight machine', klass: 'machine' },
  plate: { human: 'a weight plate', klass: 'weight plate' },
  resistance_band: { human: 'a resistance band', klass: 'resistance band' },
  suspension: { human: 'a suspension trainer (TRX-style straps)', klass: 'suspension trainer' },
  cable: { human: 'a cable machine', klass: 'cable' },
  other: { human: 'the appropriate equipment for this exercise', klass: 'as-described' },
};

function equip(eq) {
  return EQUIP_MAP[eq] || EQUIP_MAP.other;
}

// Load all research rows keyed by exercise id (ground truth for prompts).
function loadResearchRows() {
  const dir = join(REPO_ROOT, 'research', 'full-catalog');
  const rows = {};
  for (const f of readdirSync(dir)) {
    if (!/^batch-.*\.json$/.test(f)) continue;
    const arr = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    for (const r of arr) rows[r.id] = r;
  }
  return rows;
}

// Derive the target list: every catalog id whose howto visual does NOT point to
// assets/howto/library/. Empty visuals and the authored-original SVG stickmen
// are in scope. Flags exercises that already have a non-library photo so the
// integrator can veto regenerating those.
export async function buildTargets({ onlyIds = null, forceInclude = false } = {}) {
  const catalogUrl = pathToFileURL(join(REPO_ROOT, 'js', 'engine', 'catalog.js')).href;
  const howtoUrl = pathToFileURL(join(REPO_ROOT, 'js', 'engine', 'howto.js')).href;
  const { CATALOG_LIST } = await import(catalogUrl);
  const { HOWTO_BY_ID } = await import(howtoUrl);
  const research = loadResearchRows();

  const targets = [];
  for (const e of CATALOG_LIST) {
    const h = HOWTO_BY_ID[e.id];
    const imgs = (h && h.images) || [];
    if (onlyIds && !onlyIds.includes(e.id)) continue;
    const isLibrary = imgs.some((p) => p.includes('assets/howto/library/'));
    // Library visuals are out of scope for --all, but an explicit forced id
    // (pilot / --ids) is generated regardless so the pipeline can be exercised.
    if (isLibrary && !(forceInclude && onlyIds && onlyIds.includes(e.id))) continue;

    const isOriginalSvg = imgs.some((p) => p.includes('assets/howto/original/'));
    const hasOtherPhoto = imgs.length > 0 && !isOriginalSvg;
    const row = research[e.id] || {};
    targets.push({
      id: e.id,
      name: e.name,
      equipment: e.equipment,
      primaryMuscle: e.primaryMuscle,
      secondaryMuscles: e.secondaryMuscles || [],
      steps: h?.steps || row.steps || [],
      cues: h?.cues || row.cues || '',
      priorVisual: imgs.length === 0 ? 'none' : (isOriginalSvg ? 'original-svg' : 'photo'),
      hadPhoto: hasOtherPhoto, // integrator veto flag
    });
  }
  return targets;
}

function muscleList(t) {
  const prim = (t.primaryMuscle || 'the primary movers').replace(/_/g, ' ');
  const sec = (t.secondaryMuscles || []).map((m) => m.replace(/_/g, ' ')).join(', ');
  return { prim, sec };
}

// Muscle highlight list taken from the form spec (physiologist ground truth),
// falling back to the catalog fields if the spec is missing them.
function specMuscles(t, spec) {
  const tm = (spec && spec.targetMuscles) || {};
  const prim = (Array.isArray(tm.primary) && tm.primary.length
    ? tm.primary : [t.primaryMuscle]).filter(Boolean).map((m) => String(m).replace(/_/g, ' '));
  const sec = (Array.isArray(tm.secondary) && tm.secondary.length
    ? tm.secondary : (t.secondaryMuscles || [])).filter(Boolean).map((m) => String(m).replace(/_/g, ' '));
  return { prim: prim.join(', ') || 'the primary movers', sec: sec.join(', ') };
}

// Render a startPosition/finishPosition object as verbatim SEE-this lines.
const POS_KEYS = [
  ['stance', 'Stance'], ['footAngle', 'Foot angle'], ['gripAndHands', 'Grip & hands'],
  ['equipmentPosition', 'Equipment position'], ['hipKneeAngles', 'Hip/knee angles'],
  ['spine', 'Spine'], ['headNeck', 'Head/neck'],
];
function renderPosition(pos) {
  if (!pos || typeof pos !== 'object') return '';
  return POS_KEYS
    .filter(([k]) => pos[k])
    .map(([k, label]) => `- ${label}: ${pos[k]}`)
    .join('\n');
}

function disambiguators(spec) {
  const d = (spec && spec.variantDisambiguators) || [];
  return Array.isArray(d) ? d.filter(Boolean) : [];
}

const STYLE_BLOCK =
  'Hevy-style anatomical exercise illustration. A single matte light-gray/white 3D human figure on a PURE WHITE background. ' +
  'The target muscles are highlighted orange-red as if translucent skin reveals the muscle beneath; every non-target muscle stays plain matte gray. ' +
  'Realistic dark-gray equipment, correctly proportioned — no floating plates, bent bars, merged limbs, or extra fingers. ' +
  'No text, no logos, no UI, no watermark, no grid, no measurement lines. Full body visible, centered, clean neutral studio lighting, one figure only.';

// Generation prompt for a frame, built FROM the physiologist form spec.
// phase = 'START' | 'FINISH'. The matching position block is inserted verbatim,
// variant disambiguators are hard constraints, and muscle highlighting comes
// from the spec's targetMuscles.
export function genPromptFromSpec(t, spec, phase, hint = '') {
  const eq = equip(t.equipment);
  const { prim, sec } = specMuscles(t, spec);
  const pos = phase === 'START' ? spec?.startPosition : spec?.finishPosition;
  const posText = renderPosition(pos) || (t.steps || []).map((s, i) => `${i + 1}. ${s}`).join(' ');
  const phaseDesc = phase === 'START'
    ? 'the START / set-up position, just before the rep begins'
    : 'the FINISH / end-range working position at the hardest part of the rep';
  const dis = disambiguators(spec);
  let p =
    `${STYLE_BLOCK}\n\n` +
    `Exercise: ${t.name}, performed with ${eq.human}. Depict ${phaseDesc}.\n` +
    `The figure's body MUST match this position exactly:\n${posText}\n`;
  if (dis.length) {
    p += `HARD CONSTRAINTS — this exact variant is defined by (every one must be visibly true):\n` +
      dis.map((d) => `- ${d}`).join('\n') + '\n';
  }
  p +=
    `Highlight in orange-red ONLY these muscles: PRIMARY — ${prim}${sec ? `; SECONDARY (lighter) — ${sec}` : ''}. ` +
    `Do NOT highlight any other muscle group. Equipment class must be unmistakably ${eq.klass}.`;
  if (hint) p += `\nCORRECTION from prior attempt: ${hint}`;
  return p;
}

// Frame-1 request (frame 0 is passed as the LAST reference image). Pose target
// comes from the spec's finishPosition; figure/style/angle are held from frame 0.
export function finishFromStartPromptFromSpec(t, spec, hint = '') {
  const eq = equip(t.equipment);
  const posText = renderPosition(spec?.finishPosition)
    || (t.steps || []).map((s, i) => `${i + 1}. ${s}`).join(' ');
  const dis = disambiguators(spec);
  let p =
    'Use the LAST reference image as the base. Keep the identical figure, body proportions, camera angle, lighting, ' +
    'pure white background, and muscle highlighting. Modify ONLY the pose. ' +
    `Move the figure to the FINISH / end-range position of "${t.name}" (${eq.human}). ` +
    `The finish position MUST match exactly:\n${posText}\n`;
  if (dis.length) {
    p += `Still-true variant constraints: ${dis.join('; ')}. `;
  }
  p += `Equipment must stay realistic dark-gray ${eq.klass}. No text, no logos, pure white background.`;
  if (hint) p += `\nCORRECTION from prior attempt: ${hint}`;
  return p;
}

// Physiologist post-check prompt. The FORM SPEC is the ground truth: the verifier
// checks the image against every spec field + equipment-class exactness +
// anatomy/artifact sanity + style. Lenient only on the intended orange-red style.
export function verifierPromptFromSpec(t, spec, phase, imgPath) {
  const eq = equip(t.equipment);
  const { prim, sec } = specMuscles(t, spec);
  const pos = phase === 'START' ? spec?.startPosition : spec?.finishPosition;
  const posText = renderPosition(pos) || '(use standard biomechanics for this phase)';
  const dis = disambiguators(spec);
  const faults = (spec?.commonFaultsToAvoidDepicting || []).filter(Boolean);
  return (
    `You are a strict sports physiologist verifying an exercise how-to illustration against a FORM SPEC you must treat as ground truth. ` +
    `Read the image at ${imgPath}. It must depict "${t.name}" — the ${phase} position.\n\n` +
    `GROUND-TRUTH ${phase} POSITION (the image must match every line):\n${posText}\n` +
    (dis.length ? `\nVARIANT DISAMBIGUATORS (every one must be visibly true, else FAIL):\n${dis.map((d) => `- ${d}`).join('\n')}\n` : '') +
    (faults.length ? `\nMUST NOT depict these faults: ${faults.join('; ')}\n` : '') +
    `\nCheck all of the following:\n` +
    `(1) the figure's stance, foot angle, grip/hands, equipment position, hip/knee angles, spine and head/neck match the ground-truth position above;\n` +
    `(2) every variant disambiguator is visibly satisfied;\n` +
    `(3) equipment class matches EXACTLY — required class is ${eq.klass}. A wrong equipment class (barbell vs dumbbell vs kettlebell vs cable vs machine vs band vs plate vs bodyweight) is an automatic FAIL;\n` +
    `(4) anatomy/artifact sanity — no floating plates, bent bars, merged limbs, extra fingers, or duplicate figures;\n` +
    `(5) the muscles highlighted orange-red are exactly the movers of THIS exercise — primary: ${prim}${sec ? `; secondary: ${sec}` : ''}. No strong highlight on clearly irrelevant muscles;\n` +
    `(6) style: a matte gray figure on a PURE WHITE background with NO text/logos/UI. NOTE: the target muscles rendered orange-red under translucent skin is the CORRECT intended style — do NOT fail for that; only fail style if the whole figure is photographic/naturally-colored, the background is not white, or there is text.\n\n` +
    `Be strict on position, anatomy and equipment; lenient only on the intended orange-red highlight style. ` +
    `Output EXACTLY three lines and nothing else:\n` +
    `VERDICT: PASS or FAIL\n` +
    `ISSUES: <brief list, or "none">\n` +
    `REGEN_HINT: <one-sentence prompt correction>`
  );
}

export function parseVerdict(stdout) {
  const text = String(stdout || '');
  const vMatch = text.match(/VERDICT:\s*(PASS|FAIL)/i);
  const iMatch = text.match(/ISSUES:\s*([\s\S]*?)(?:\nREGEN_HINT:|$)/i);
  const hMatch = text.match(/REGEN_HINT:\s*([\s\S]*)$/i);
  if (!vMatch) return { parsed: false, verdict: null, issues: '', hint: '' };
  return {
    parsed: true,
    verdict: vMatch[1].toUpperCase(),
    issues: (iMatch ? iMatch[1] : '').trim().slice(0, 600),
    hint: (hMatch ? hMatch[1] : '').trim().split('\n')[0].slice(0, 300),
  };
}
