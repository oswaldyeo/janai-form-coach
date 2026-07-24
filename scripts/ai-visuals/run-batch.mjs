#!/usr/bin/env node
// Form Coach — AI visual batch pipeline.
// Generates Hevy-style anatomical start/finish frames for every catalog
// exercise without a photo-library visual, gated by a strict physiologist
// verifier. Fault-tolerant, resumable, cwd-independent. Staging only — no app
// integration. See spec in the parent build task.
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  loadOpenAiKey, styleRefsExist, STYLE_REFS,
  STATE_DIR, WORK_DIR, OUT_DIR, PROGRESS_PATH, FAILED_PATH, MANIFEST_PATH,
  MODEL, IMAGE_SIZE, IMAGE_QUALITY, EST_PER_IMAGE_USD, MAX_GEN_CALLS, MAX_ATTEMPTS,
} from './lib/config.mjs';
import { buildTargets, genPrompt, finishFromStartPrompt } from './lib/targets.mjs';
import { generate, RateLimitError } from './lib/openai.mjs';
import { verify, VerifierRateLimit } from './lib/verify.mjs';
import { Semaphore, sleep, writeJsonAtomic, sipsToJpeg, runCapture } from './lib/util.mjs';

// ── CLI args ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function argVal(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const RUN_ALL = argv.includes('--all');
const PILOT = argv.includes('--pilot');
const idsArg = argVal('--ids');
const LIMIT = argVal('--limit') ? parseInt(argVal('--limit'), 10) : null;
const EX_CONC = argVal('--exercise-concurrency') ? parseInt(argVal('--exercise-concurrency'), 10) : 4;

const PILOT_IDS = ['hevy-d20d7bbe', 'hevy-08a2974e', 'hevy-99d5f10e']; // Sumo DL, T Bar Row, Ab Wheel
let onlyIds = null;
if (PILOT) onlyIds = PILOT_IDS;
else if (idsArg) onlyIds = idsArg.split(',').map((s) => s.trim()).filter(Boolean);
else if (!RUN_ALL) {
  console.error('Specify --all, --pilot, or --ids a,b,c');
  process.exit(2);
}

const JOB_ID = process.env.JANAI_JOB_ID || '';
const MILESTONE_SH = join(process.env.HOME, '.openclaw', 'workspace', 'scripts', 'subagent-delivery', 'milestone.sh');

// ── state ───────────────────────────────────────────────────────────────────
for (const d of [STATE_DIR, WORK_DIR, OUT_DIR]) mkdirSync(d, { recursive: true });

function loadProgress() {
  if (existsSync(PROGRESS_PATH)) {
    try { return JSON.parse(readFileSync(PROGRESS_PATH, 'utf8')); } catch { /* reinit */ }
  }
  return {
    startedAt: new Date().toISOString(), updatedAt: null,
    model: MODEL, provider: 'openai', size: IMAGE_SIZE, quality: IMAGE_QUALITY,
    genCalls: 0, estSpendUSD: 0, capHit: false, exercises: {},
  };
}
const progress = loadProgress();
let failedQueue = existsSync(FAILED_PATH) ? JSON.parse(readFileSync(FAILED_PATH, 'utf8')) : [];

let saveTimer = null;
async function saveState() {
  progress.updatedAt = new Date().toISOString();
  await writeJsonAtomic(PROGRESS_PATH, progress);
  await writeJsonAtomic(FAILED_PATH, failedQueue);
}
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => { saveTimer = null; await saveState(); }, 1500);
}

// ── milestone pings ─────────────────────────────────────────────────────────
async function ping(text) {
  console.log(`[milestone] ${text}`);
  if (JOB_ID && existsSync(MILESTONE_SH)) {
    await runCapture('bash', [MILESTONE_SH, JOB_ID, text], { timeoutMs: 30000 }).catch(() => {});
  }
}
function counts(total) {
  let done = 0, verified = 0;
  for (const ex of Object.values(progress.exercises)) {
    const f0 = ex.frames?.['0']?.status, f1 = ex.frames?.['1']?.status;
    if ((f0 === 'verified' || f0 === 'failed') && (f1 === 'verified' || f1 === 'failed')) done++;
    for (const fr of Object.values(ex.frames || {})) if (fr.status === 'verified') verified++;
  }
  return { done, verified, failed: failedQueue.length, gen: progress.genCalls, spend: progress.estSpendUSD.toFixed(2) };
}
function milestoneStr(total) {
  const c = counts(total);
  return `${c.done}/${total} exercises done · ${c.gen} generated · ${c.verified} verified · ${c.failed} failed-queue · ~$${c.spend} spent`;
}

// ── global backoff gates ────────────────────────────────────────────────────
const genSem = new Semaphore(3);
const verSem = new Semaphore(2);
let genGateUntil = 0;
let genBackoffStep = 0;
const GEN_BACKOFFS = [30e3, 60e3, 120e3, 300e3, 600e3];
let verGateUntil = 0;
let verBackoffStep = 0;
const VER_BACKOFFS = [5 * 60e3, 15 * 60e3, 45 * 60e3];

async function awaitGate(getUntil) {
  while (Date.now() < getUntil()) {
    await sleep(Math.min(15000, getUntil() - Date.now()));
  }
}
async function tripGenBackoff() {
  const d = GEN_BACKOFFS[Math.min(genBackoffStep, GEN_BACKOFFS.length - 1)];
  genBackoffStep++;
  genGateUntil = Date.now() + d;
  await ping(`⏳ OpenAI rate-limited — global gen backoff ${Math.round(d / 1000)}s`);
}
async function tripVerBackoff() {
  const d = VER_BACKOFFS[Math.min(verBackoffStep, VER_BACKOFFS.length - 1)];
  verBackoffStep++;
  verGateUntil = Date.now() + d;
  await ping(`⏳ Verifier usage-capped — verification paused ${Math.round(d / 60000)} min, will auto-resume`);
}

// ── caps ────────────────────────────────────────────────────────────────────
function capHit() { return progress.genCalls >= MAX_GEN_CALLS; }
function chargeGen() {
  progress.genCalls++;
  progress.estSpendUSD += EST_PER_IMAGE_USD;
}

// ── per-frame worker ────────────────────────────────────────────────────────
// Generate + verify one frame with up to MAX_ATTEMPTS. Returns frame record.
// basePng: absolute path to the verified frame-0 raw PNG (finish frames only).
async function processFrame(t, frameIdx, phase, basePng) {
  const rec = t._exRec.frames[String(frameIdx)];
  const outJpg = join(OUT_DIR, t.id, `${frameIdx}.jpg`);
  const rawPng = join(WORK_DIR, t.id, `${frameIdx}.png`);
  mkdirSync(join(WORK_DIR, t.id), { recursive: true });
  let hint = '';

  while ((rec.attempts || 0) < MAX_ATTEMPTS) {
    if (capHit()) { progress.capHit = true; return rec; }
    rec.attempts = (rec.attempts || 0) + 1;

    // ---- generate ----
    let png;
    try {
      png = await genSem.run(async () => {
        await awaitGate(() => genGateUntil);
        // Retry loop purely for 429s (does not consume an attempt).
        for (;;) {
          try {
            const prompt = frameIdx === 0 ? genPrompt(t, phase, hint) : finishFromStartPrompt(t, hint);
            const refPaths = frameIdx === 0 ? STYLE_REFS : [...STYLE_REFS, basePng];
            const buf = await generate({ apiKey: t._key, prompt, refPaths });
            chargeGen();
            genBackoffStep = 0; // success resets escalation
            return buf;
          } catch (e) {
            if (e instanceof RateLimitError) { await tripGenBackoff(); await awaitGate(() => genGateUntil); continue; }
            throw e;
          }
        }
      });
    } catch (e) {
      rec.status = 'pending';
      rec.issues = `gen error: ${String(e.message || e).slice(0, 200)}`;
      console.warn(`[${t.id} f${frameIdx}] gen failed attempt ${rec.attempts}: ${rec.issues}`);
      scheduleSave();
      if (rec.attempts >= MAX_ATTEMPTS) break;
      await sleep(2000);
      continue;
    }

    await writeFile(rawPng, png);
    await sipsToJpeg(rawPng, outJpg);
    rec.status = 'generated';
    rec.path = `assets/howto/ai/${t.id}/${frameIdx}.jpg`;
    scheduleSave();

    // ---- verify ----
    let v;
    try {
      v = await verSem.run(async () => {
        await awaitGate(() => verGateUntil);
        for (;;) {
          try {
            const r = await verify(t, phase, outJpg);
            verBackoffStep = 0;
            return r;
          } catch (e) {
            if (e instanceof VerifierRateLimit) { await tripVerBackoff(); await awaitGate(() => verGateUntil); continue; }
            throw e;
          }
        }
      });
    } catch (e) {
      rec.issues = `verify error: ${String(e.message || e).slice(0, 200)}`;
      console.warn(`[${t.id} f${frameIdx}] verify error attempt ${rec.attempts}: ${rec.issues}`);
      scheduleSave();
      if (rec.attempts >= MAX_ATTEMPTS) break;
      continue;
    }

    rec.verdict = v.verdict;
    rec.issues = v.issues;
    if (v.verdict === 'PASS') {
      rec.status = 'verified';
      console.log(`[${t.id} f${frameIdx}] PASS (attempt ${rec.attempts})`);
      scheduleSave();
      return rec;
    }
    // FAIL or UNPARSEABLE → regenerate with hint
    hint = v.hint || (v.verdict === 'UNPARSEABLE' ? 'Ensure a clean single gray figure, correct equipment class, and only the target muscles highlighted.' : hint);
    console.log(`[${t.id} f${frameIdx}] ${v.verdict} (attempt ${rec.attempts}) — ${(v.issues || '').slice(0, 120)}`);
    scheduleSave();
  }

  // Exhausted attempts without a PASS.
  rec.status = 'failed';
  failedQueue.push({
    id: t.id, name: t.name, frame: frameIdx, phase,
    attempts: rec.attempts, lastVerdict: rec.verdict || null, lastIssues: rec.issues || '',
  });
  console.warn(`[${t.id} f${frameIdx}] FAILED after ${rec.attempts} attempts → failed-queue`);
  scheduleSave();
  return rec;
}

// ── per-exercise worker ─────────────────────────────────────────────────────
async function processExercise(t, total) {
  const ex = progress.exercises[t.id] || (progress.exercises[t.id] = {
    name: t.name, equipment: t.equipment, priorVisual: t.priorVisual, hadPhoto: t.hadPhoto,
    frames: { '0': { status: 'pending', attempts: 0 }, '1': { status: 'pending', attempts: 0 } },
  });
  ex.frames['0'] = ex.frames['0'] || { status: 'pending', attempts: 0 };
  ex.frames['1'] = ex.frames['1'] || { status: 'pending', attempts: 0 };
  t._exRec = ex;

  // Frame 0 (START)
  if (ex.frames['0'].status !== 'verified' && ex.frames['0'].status !== 'failed') {
    await processFrame(t, 0, 'START', null);
  }
  if (capHit()) return;

  const basePng = join(WORK_DIR, t.id, '0.png');
  // Frame 1 (FINISH) needs a verified base frame.
  if (ex.frames['1'].status !== 'verified' && ex.frames['1'].status !== 'failed') {
    if (ex.frames['0'].status === 'verified' && existsSync(basePng)) {
      await processFrame(t, 1, 'FINISH', basePng);
    } else {
      ex.frames['1'].status = 'failed';
      ex.frames['1'].issues = 'no verified START frame to base FINISH on';
      failedQueue.push({ id: t.id, name: t.name, frame: 1, phase: 'FINISH', attempts: 0, lastVerdict: null, lastIssues: ex.frames['1'].issues });
    }
  }
  await saveState();
}

// ── manifest ────────────────────────────────────────────────────────────────
async function writeManifest() {
  const entries = [];
  for (const [id, ex] of Object.entries(progress.exercises)) {
    const frames = [];
    for (const fi of ['0', '1']) {
      const p = join(OUT_DIR, id, `${fi}.jpg`);
      if (ex.frames[fi]?.status === 'verified' && existsSync(p)) frames.push(`assets/howto/ai/${id}/${fi}.jpg`);
    }
    entries.push({
      id, name: ex.name, equipment: ex.equipment,
      frames,
      verdicts: { start: ex.frames['0']?.verdict || null, finish: ex.frames['1']?.verdict || null },
      attempts: { start: ex.frames['0']?.attempts || 0, finish: ex.frames['1']?.attempts || 0 },
      complete: frames.length === 2,
      priorVisual: ex.priorVisual,
      integratorNote: ex.hadPhoto ? 'previously had a free-exercise-db photo — verify before swapping' : undefined,
      provenance: {
        generator: MODEL, size: IMAGE_SIZE, quality: IMAGE_QUALITY,
        styleRefs: STYLE_REFS.map((p) => p.split('/').pop()),
        verifier: 'claude sonnet (strict physiologist gate)',
      },
    });
  }
  await writeJsonAtomic(MANIFEST_PATH, {
    generatedAt: new Date().toISOString(),
    model: MODEL, provider: 'openai',
    totalEntries: entries.length,
    complete: entries.filter((e) => e.complete).length,
    exercises: entries,
  });
}

// ── pool runner ─────────────────────────────────────────────────────────────
async function runPool(items, conc, fn) {
  let idx = 0;
  const workers = Array.from({ length: Math.min(conc, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try { await fn(items[i]); } catch (e) { console.error(`[${items[i].id}] fatal (skipped):`, e.message); }
    }
  });
  await Promise.all(workers);
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!styleRefsExist()) { console.error('FATAL: style reference image(s) missing:', STYLE_REFS.filter((p) => !existsSync(p))); process.exit(1); }
  const key = loadOpenAiKey(); // throws if unavailable

  let targets = await buildTargets({ onlyIds, forceInclude: !!onlyIds });
  if (LIMIT) targets = targets.slice(0, LIMIT);
  targets.forEach((t) => { t._key = key; });
  const total = targets.length;

  console.log(`AI visuals batch — ${total} target exercises · model ${MODEL} ${IMAGE_SIZE} q=${IMAGE_QUALITY}`);
  console.log(`Resuming from ${Object.keys(progress.exercises).length} tracked · genCalls so far ${progress.genCalls}`);
  await ping(`▶ AI visuals batch started — ${total} exercises · ${milestoneStr(total)}`);

  // Periodic milestone every 15 min.
  const interval = setInterval(() => { ping(milestoneStr(total)).catch(() => {}); }, 15 * 60 * 1000);

  // Milestone every 10 completed exercises (checked after each exercise below).
  let lastDone = counts(total).done;

  const pending = targets.filter((t) => {
    const ex = progress.exercises[t.id];
    if (!ex) return true;
    const f0 = ex.frames?.['0']?.status, f1 = ex.frames?.['1']?.status;
    const f0done = f0 === 'verified' || f0 === 'failed';
    const f1done = f1 === 'verified' || f1 === 'failed';
    return !(f0done && f1done);
  });
  console.log(`${targets.length - pending.length} already resolved · ${pending.length} to process`);

  await runPool(pending, EX_CONC, async (t) => {
    if (capHit()) { progress.capHit = true; return; }
    await processExercise(t, total);
    const done = counts(total).done;
    if (Math.floor(done / 10) > Math.floor(lastDone / 10)) {
      await ping(milestoneStr(total));
    }
    lastDone = done;
    await writeManifest();
  });

  clearInterval(interval);
  await saveState();
  await writeManifest();

  const c = counts(total);
  const capMsg = progress.capHit ? ` · ⚠️ GEN CAP (${MAX_GEN_CALLS}) HIT — rerun to continue` : '';
  await ping(`✅ Batch pass complete — ${milestoneStr(total)}${capMsg}`);
  console.log('\n=== SUMMARY ===');
  console.log(milestoneStr(total));
  console.log(`Manifest: ${MANIFEST_PATH}`);
  console.log(`Failed-queue: ${failedQueue.length} entries → ${FAILED_PATH}`);
  if (progress.capHit) console.log(`⚠️ Generation cap ${MAX_GEN_CALLS} reached — re-run to resume.`);
}

main().catch(async (e) => {
  console.error('FATAL:', e);
  try { await saveState(); } catch {}
  process.exit(1);
});
