// Stage 1 — Physiologist FORM-SPEC pre-pass (text-only).
// Produces a structured JSON spec that grounds both generation and verification,
// cutting regen iterations vs building the image prompt straight from research prose.
// Specs are cached in state/form-specs/<id>.json and NEVER regenerated once present.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runCapture, writeJsonAtomic } from './util.mjs';
import { FORM_SPEC_DIR } from './config.mjs';

export class SpecRateLimit extends Error {
  constructor(msg) { super(msg); this.name = 'SpecRateLimit'; }
}

const RATE_RE = /rate.?limit|usage limit|quota|overloaded|429|too many requests|please try again|reached your usage/i;

function specPathFor(id) {
  return join(FORM_SPEC_DIR, `${id}.json`);
}

// Build the physiologist prompt from the exercise's research row.
function specPrompt(t) {
  const eq = t.equipment || 'unspecified';
  const prim = t.primaryMuscle || 'unspecified';
  const sec = (t.secondaryMuscles || []).join(', ') || 'none listed';
  const steps = (t.steps || []).map((s, i) => `${i + 1}. ${s}`).join(' ');
  const cues = t.cues || '';
  return (
    `You are a sports physiologist. For exercise "${t.name}" (equipment: ${eq}), produce a JSON form spec ` +
    `for a two-frame how-to illustration. Use this reference for the movement — ` +
    `primary muscle: ${prim}; secondary: ${sec}; steps: ${steps} cues: ${cues}\n\n` +
    `Output an object with EXACTLY these keys:\n` +
    `{"startPosition": {"stance","footAngle","gripAndHands","equipmentPosition","hipKneeAngles","spine","headNeck"}, ` +
    `"finishPosition": {"stance","footAngle","gripAndHands","equipmentPosition","hipKneeAngles","spine","headNeck"}, ` +
    `"targetMuscles": {"primary": [], "secondary": []}, ` +
    `"commonFaultsToAvoidDepicting": [], ` +
    `"variantDisambiguators": [what visually distinguishes this EXACT variant from lookalikes, ` +
    `e.g. 'bar ON floor at start', 'feet outside shoulder width', 'hands INSIDE knees']}\n` +
    `Every startPosition/finishPosition value must be a short concrete phrase describing what a viewer would SEE. ` +
    `Output raw JSON only — no markdown fences, no commentary.`
  );
}

// Strip markdown fences / leading prose and parse the first JSON object found.
function parseSpecJson(stdout) {
  let text = String(stdout || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try {
    const obj = JSON.parse(slice);
    if (obj && obj.startPosition && obj.finishPosition && obj.targetMuscles) return obj;
    return null;
  } catch { return null; }
}

// Return the cached spec if present, else null.
export function readCachedSpec(id) {
  const p = specPathFor(id);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// Ensure a form spec exists for this exercise. Returns { spec, path, cached }.
// Throws SpecRateLimit on a claude usage cap so the orchestrator can back off,
// or a plain Error if the model output is unparseable after the call.
export async function ensureFormSpec(t) {
  const path = specPathFor(t.id);
  const cached = readCachedSpec(t.id);
  if (cached) return { spec: cached, path, cached: true };

  const prompt = specPrompt(t);
  const { stdout, stderr, code } = await runCapture(
    'claude',
    ['-p', '--model', 'sonnet', '--dangerously-skip-permissions', prompt],
    { input: '/dev/null', timeoutMs: 5 * 60 * 1000 },
  );
  const combined = `${stdout}\n${stderr}`;
  const spec = parseSpecJson(stdout);
  if (!spec) {
    if (RATE_RE.test(combined)) throw new SpecRateLimit(combined.slice(0, 300));
    throw new Error(`Unparseable form spec for ${t.id}: ${combined.slice(0, 200)}`);
  }
  await writeJsonAtomic(path, spec);
  return { spec, path, cached: false };
}
