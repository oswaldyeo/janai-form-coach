// Janai Form Coach — browser orchestration.
//
// Wires the camera + MediaPipe pose loop to the pure engine modules. Keeps the
// frame loop deterministic and LLM-free: measure → progress → rep engine →
// exercise cue. All heavy lifting (rep logic, calibration math, session schema)
// lives in ./engine/* and is unit-tested under Node.

import { EXERCISE_LIST, getExercise, TONE_RANK } from './engine/exercises.js';
import { RepEngine } from './engine/rep-engine.js';
import { calibrate, defaultCalibration } from './engine/calibration.js';
import { SessionRecorder, toExportDocument } from './engine/session.js';
import { createPoseLandmarker } from './pose.js';
import {
  loadHistory, saveSession, clearHistory,
  loadCalibration, saveCalibration,
} from './storage.js';

const $ = (id) => document.getElementById(id);
const now = () => Date.now();

// ── app state ───────────────────────────────────────────────────────────────
const state = {
  mode: 'idle',            // idle | calibrating | active | paused | resting | summary
  exercise: EXERCISE_LIST[0],
  target: 10,
  useCalibration: true,
  calib: null,
  engine: null,
  recorder: null,
  poseReady: false,
  landmarker: null,
  delegate: null,
  drawing: null,
  poseLib: null,
  running: false,
  lastVideoTime: -1,
  lastFrameAt: 0,
  fps: 0,
  calibSamples: [],
  calibEndsAt: 0,
  restEndsAt: 0,
  restTimer: null,
  lastCue: '',
  lastSpokenAt: 0,
  lastState: { phase: 'rest', direction: 'hold', progress: 0, peakProgress: 0 },
};

const video = $('video');
const canvas = $('overlay');
const ctx = canvas.getContext('2d');

// ── speech (throttled, only on change) ───────────────────────────────────────
function say(text) {
  if (!('speechSynthesis' in window)) return;
  const t = now();
  if (text === state.lastCue || t - state.lastSpokenAt < 1800) return;
  state.lastCue = text;
  state.lastSpokenAt = t;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.06; u.pitch = 1.0;
    speechSynthesis.speak(u);
  } catch { /* speech is best-effort */ }
}

function setStatus(text) { $('status').textContent = text; }

function setCue(text, tone = 'good', speak = false) {
  const el = $('cue');
  if (el) { el.textContent = text; el.className = `cue ${tone}`; }
  if (speak && (tone === 'bad' || tone === 'warn' || text.startsWith('Rep'))) say(text);
  if (state.recorder && (tone === 'warn' || tone === 'bad')) state.recorder.recordCue(text, tone);
}

// ── screen routing ───────────────────────────────────────────────────────────
function show(el, on) { if (el) el.classList.toggle('hidden', !on); }
function render() {
  show($('home'), state.mode === 'idle');
  show($('hud'), state.mode === 'active' || state.mode === 'paused');
  show($('calib-overlay'), state.mode === 'calibrating');
  show($('rest-overlay'), state.mode === 'resting');
  show($('summary-overlay'), state.mode === 'summary');
  show($('stage'), state.mode !== 'idle' && state.mode !== 'summary');
}

// ── pose model init (dynamic, offline-safe) ──────────────────────────────────
async function initPose() {
  setStatus('loading model…');
  try {
    const { landmarker, delegate, lib } = await createPoseLandmarker();
    state.landmarker = landmarker;
    state.delegate = delegate;
    state.poseLib = lib;
    state.drawing = null; // created per-canvas lazily
    state.poseReady = true;
    setStatus(`ready · ${delegate}`);
    $('begin-hint').textContent = `Pose model ready (${delegate}). Video never leaves your device.`;
  } catch (e) {
    console.warn('[app] pose model unavailable at boot', e);
    state.poseReady = false;
    setStatus('model offline');
    $('begin-hint').textContent = 'Pose model will load when you start (needs first-load network).';
  }
}

// ── camera ───────────────────────────────────────────────────────────────────
async function startCamera() {
  if (video.srcObject) return true;
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    await video.play();
    return true;
  } catch (e) {
    console.warn('[app] camera unavailable', e);
    setCue('Camera permission is required', 'bad');
    setStatus('no camera');
    return false;
  }
}

function stopCamera() {
  if (video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
}

// ── main frame loop ──────────────────────────────────────────────────────────
function loop() {
  if (!state.running) return;
  const active = state.mode === 'active' || state.mode === 'calibrating';
  if (active && state.landmarker && video.readyState >= 2 && video.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = video.currentTime;
    const t = performance.now();
    const dt = t - state.lastFrameAt; state.lastFrameAt = t;
    if (dt > 0) state.fps = 0.9 * state.fps + 0.1 * (1000 / dt);

    let result = null;
    try { result = state.landmarker.detectForVideo(video, t); }
    catch (e) { console.warn('[app] detect error', e); }

    canvas.width = video.videoWidth || canvas.width;
    canvas.height = video.videoHeight || canvas.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (result && result.landmarks && result.landmarks.length) {
      const lm = result.landmarks[0];
      drawSkeleton(lm);
      if (state.mode === 'calibrating') handleCalibrationFrame(lm);
      else handleWorkoutFrame(lm);
    } else {
      setCue('Step into frame', 'warn');
    }
    setStatus(`live · ${state.delegate} · ${Math.round(state.fps)} fps`);
  }
  requestAnimationFrame(loop);
}

function drawSkeleton(lm) {
  try {
    if (!state.poseLib) return;
    if (!state.drawing) state.drawing = new state.poseLib.DrawingUtils(ctx);
    state.drawing.drawConnectors(lm, state.poseLib.PoseLandmarker.POSE_CONNECTIONS, { color: '#57e7ad', lineWidth: 4 });
    state.drawing.drawLandmarks(lm, { color: '#ffffff', fillColor: '#57e7ad', radius: 3 });
  } catch { /* overlay is cosmetic */ }
}

// ── calibration flow ─────────────────────────────────────────────────────────
function handleCalibrationFrame(lm) {
  const m = state.exercise.measure(lm);
  const remain = Math.max(0, Math.ceil((state.calibEndsAt - now()) / 1000));
  $('calib-count').textContent = remain;
  if (m.valid) {
    state.calibSamples.push(m.drivingAngle);
    $('calib-live').textContent = `${state.exercise.driver}: ${Math.round(m.drivingAngle)}°  ·  ${state.calibSamples.length} samples`;
  } else {
    $('calib-live').textContent = m.reason;
  }
  if (now() >= state.calibEndsAt) finishCalibration();
}

function finishCalibration() {
  const result = calibrate(state.exercise, state.calibSamples);
  state.calib = result;
  saveCalibration(state.exercise.id, result);
  const note = result.calibrated
    ? `Calibrated · ROM ${result.romSpan}° (${result.peakAngle}°→${result.restAngle}°)`
    : `Using defaults (${result.reason})`;
  $('begin-hint').textContent = note;
  startWorkout();
}

// ── workout flow ─────────────────────────────────────────────────────────────
function handleWorkoutFrame(lm) {
  const m = state.exercise.measure(lm);
  if (!m.valid) { setCue(m.reason, 'warn'); return; }

  const progress = state.exercise.progressFrom(m.drivingAngle, state.calib);
  const ev = state.engine.update(progress);
  state.lastState = ev;

  // live metrics
  $('metric-primary').textContent = `${Math.round(m.drivingAngle)}°`;
  $('progress-fill').style.width = `${Math.round(progress * 100)}%`;

  const cue = state.exercise.coach(m, ev);

  if (ev.repCompleted) {
    state.recorder.recordRep(ev.peakProgress);
    $('reps').textContent = state.recorder.repCount;
    updateSetDots();
    setCue(`Rep ${state.recorder.repCount}`, 'good', true);
    if (state.target != null && state.recorder.repCount >= state.target) {
      completeSet();
      return;
    }
  } else if (ev.partial) {
    state.recorder.recordPartial();
    setCue('Full range next time', 'warn', true);
  } else {
    setCue(cue.text, cue.tone, cue.tone !== 'good');
  }
}

function updateSetDots() {
  const done = state.recorder ? state.recorder.repCount : 0;
  const tgt = state.target || 0;
  $('rep-target').textContent = tgt ? `/ ${tgt}` : '';
  const bar = $('set-progress-fill');
  if (bar) bar.style.width = tgt ? `${Math.min(100, Math.round((done / tgt) * 100))}%` : '0%';
}

// ── set / session lifecycle ──────────────────────────────────────────────────
function beginFlow() {
  state.exercise = state.exercise || EXERCISE_LIST[0];
  const stored = state.useCalibration ? loadCalibration(state.exercise.id) : null;
  const wantRecalibrate = $('recalibrate').checked;

  const proceed = async () => {
    const ok = await startCamera();
    if (!ok) return;
    state.running = true;
    state.lastFrameAt = performance.now();
    if (state.useCalibration && (!stored || wantRecalibrate)) {
      startCalibration();
    } else {
      state.calib = stored || defaultCalibration(state.exercise);
      startWorkout();
    }
    loop();
  };

  if (!state.poseReady) {
    setStatus('loading model…');
    initPose().then(proceed);
  } else {
    proceed();
  }
}

function startCalibration() {
  state.mode = 'calibrating';
  state.calibSamples = [];
  state.calibEndsAt = now() + 12000; // 12s window
  $('calib-title').textContent = `Calibrate ${state.exercise.name}`;
  $('calib-instructions').textContent = `${state.exercise.orientation} Perform 2 slow, full-range reps.`;
  render();
}

function startWorkout() {
  state.mode = 'active';
  state.engine = new RepEngine();
  state.recorder = new SessionRecorder({
    exercise: state.exercise,
    target: state.target,
    calibration: state.calib,
    now,
    device: { ua: navigator.userAgent, delegate: state.delegate },
  });
  $('reps').textContent = '0';
  $('ex-name').textContent = state.exercise.name;
  $('metric-label').textContent = state.exercise.driver;
  updateSetDots();
  setCue('Ready', 'good');
  render();
}

function pauseWorkout() {
  if (state.mode !== 'active') return;
  state.mode = 'paused';
  $('btn-pause').textContent = 'Resume';
  setStatus('paused');
  render();
}

function resumeWorkout() {
  if (state.mode !== 'paused') return;
  state.mode = 'active';
  $('btn-pause').textContent = 'Pause';
  state.lastVideoTime = -1;
  render();
}

function resetWorkout() {
  if (!state.engine) return;
  state.engine.reset();
  state.recorder = new SessionRecorder({
    exercise: state.exercise,
    target: state.target,
    calibration: state.calib,
    now,
    device: { ua: navigator.userAgent, delegate: state.delegate },
  });
  $('reps').textContent = '0';
  updateSetDots();
  setCue('Reset · ready', 'good');
}

function completeSet() {
  say('Set complete');
  state.recorder.end();
  saveSession(state.recorder.toJSON());
  startRest();
}

function endSet() {
  if (!state.recorder) { goHome(); return; }
  state.recorder.end();
  saveSession(state.recorder.toJSON());
  showSummary();
}

// ── rest timer ───────────────────────────────────────────────────────────────
function startRest() {
  state.mode = 'resting';
  state.restEndsAt = now() + 60000;
  render();
  tickRest();
  state.restTimer = setInterval(tickRest, 250);
}

function tickRest() {
  const remain = Math.max(0, Math.ceil((state.restEndsAt - now()) / 1000));
  $('rest-timer').textContent = `${remain}s`;
  if (remain <= 0) endRest();
}

function endRest() {
  clearInterval(state.restTimer); state.restTimer = null;
  showSummary();
}

// ── summary ──────────────────────────────────────────────────────────────────
function showSummary() {
  state.mode = 'summary';
  const s = state.recorder.summary();
  $('summary-body').innerHTML = `
    <div class="sum-row"><span>Exercise</span><b>${s.exercise}</b></div>
    <div class="sum-row"><span>Reps</span><b>${s.reps}${s.target ? ' / ' + s.target : ''}</b></div>
    <div class="sum-row"><span>Set complete</span><b>${s.completed ? 'Yes' : 'No'}</b></div>
    <div class="sum-row"><span>Duration</span><b>${s.durationSec}s</b></div>
    <div class="sum-row"><span>Avg depth</span><b>${s.avgDepthPct}%</b></div>
    <div class="sum-row"><span>Best depth</span><b>${s.bestDepthPct}%</b></div>
    <div class="sum-row"><span>Partial reps</span><b>${s.partials}</b></div>
    <div class="sum-row"><span>Form warnings</span><b>${s.warnings}</b></div>`;
  render();
  renderHistory();
}

function goHome() {
  state.mode = 'idle';
  state.running = false;
  stopCamera();
  if (state.restTimer) { clearInterval(state.restTimer); state.restTimer = null; }
  render();
  renderHistory();
  setStatus(state.poseReady ? `ready · ${state.delegate}` : 'model offline');
}

// ── history + export ─────────────────────────────────────────────────────────
function renderHistory() {
  const hist = loadHistory();
  const el = $('history-list');
  if (!el) return;
  if (!hist.length) { el.innerHTML = '<div class="muted">No sessions yet.</div>'; return; }
  el.innerHTML = hist.slice(0, 12).map((s) => {
    const d = new Date(s.startedAtMs);
    const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `<div class="hist-row"><span>${when}</span><span>${s.exerciseName}</span><b>${s.counts.full} reps</b></div>`;
  }).join('');
}

function exportJSON() {
  const hist = loadHistory();
  const doc = toExportDocument(hist);
  doc.exportedAtMs = now();
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `janai-form-coach-${now()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── exercise picker + target ─────────────────────────────────────────────────
function buildExercisePicker() {
  const grid = $('exercise-grid');
  grid.innerHTML = EXERCISE_LIST.map((ex, i) =>
    `<button class="ex-card${i === 0 ? ' selected' : ''}" data-ex="${ex.id}">
       <span class="ex-name">${ex.name}</span>
       <span class="ex-sub">${ex.driver}</span>
     </button>`).join('');
  grid.querySelectorAll('.ex-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.ex-card').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.exercise = getExercise(btn.dataset.ex);
      const stored = loadCalibration(state.exercise.id);
      $('calib-status').textContent = stored && stored.calibrated
        ? `Saved calibration · ROM ${stored.romSpan}°`
        : 'No saved calibration';
    });
  });
}

function setTarget(v) {
  state.target = Math.max(1, Math.min(99, v));
  $('target-val').textContent = state.target;
}

// ── PWA install ──────────────────────────────────────────────────────────────
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  show($('install-banner'), true);
});

function wireEvents() {
  buildExercisePicker();
  setTarget(state.target);

  $('target-inc').addEventListener('click', () => setTarget(state.target + 1));
  $('target-dec').addEventListener('click', () => setTarget(state.target - 1));
  $('btn-begin').addEventListener('click', beginFlow);
  $('use-calibration').addEventListener('change', (e) => { state.useCalibration = e.target.checked; });

  $('btn-calib-skip').addEventListener('click', finishCalibration);

  $('btn-pause').addEventListener('click', () => {
    (state.mode === 'active' ? pauseWorkout : resumeWorkout)();
  });
  $('btn-reset').addEventListener('click', resetWorkout);
  $('btn-end').addEventListener('click', endSet);

  $('btn-rest-skip').addEventListener('click', endRest);
  $('btn-rest-add').addEventListener('click', () => { state.restEndsAt += 15000; });

  $('btn-summary-again').addEventListener('click', () => { state.mode = 'idle'; render(); beginFlow(); });
  $('btn-summary-home').addEventListener('click', goHome);
  $('btn-export').addEventListener('click', exportJSON);
  $('btn-summary-export').addEventListener('click', exportJSON);
  $('btn-clear-history').addEventListener('click', () => { clearHistory(); renderHistory(); });

  const inst = $('btn-install');
  if (inst) inst.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    show($('install-banner'), false);
  });

  // register service worker (best-effort; needs http(s), not file://)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[app] SW register failed', e));
  }
}

// ── boot ─────────────────────────────────────────────────────────────────────
function boot() {
  wireEvents();
  renderHistory();
  render();
  // preload the model in the background; failure is non-fatal
  initPose();
  // signal to tests/headless that init completed with no throw
  window.__formCoachReady = true;
  document.body.dataset.ready = 'true';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
