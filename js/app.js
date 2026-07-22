// Janai Form Coach v2 — browser orchestration.
//
// A Hevy-style strength tracker (routines → workouts → exercises → sets, with
// load) with the v1 on-device camera coach kept as an optional per-set assist.
// All biomechanics, rep logic, volume/PR/progression math live in ./engine/*
// (pure, deterministic, unit-tested). This file is I/O only: DOM, camera,
// MediaPipe, timers, storage. No LLM in any hot path.

import { getExercise } from './engine/exercises.js';
import {
  CATALOG_LIST, getCatalogEntry, hasCamera, isExperimentalCamera, searchCatalog, MUSCLES, EQUIPMENT,
} from './engine/catalog.js';
import { RepEngine } from './engine/rep-engine.js';
import { calibrate } from './engine/calibration.js';
import { SessionRecorder, toWorkoutExportDocument } from './engine/session.js';
import {
  makeWorkout, addExercise, removeExercise, addSet, removeSet, updateSet,
  workoutVolume, completedSetCount, totalReps, workoutDurationSec,
  summarize, newPRsInWorkout, previousSets, pruneIncompleteSets,
  nextLoadSuggestion, cadenceScore, SET_TYPES,
} from './engine/workout.js';
import {
  BUILTIN_ROUTINES, OCCAM_ROUTINE, OS_FULL_BODY_ROUTINE, routineToWorkout, repeatWorkout, workoutToRoutine, makeRoutine,
} from './engine/routines.js';
import { generateWOD } from './engine/wod.js';
import { createPoseLandmarker } from './pose.js';
import {
  loadWorkouts, saveWorkout, clearWorkouts, loadRoutines, saveRoutine, deleteRoutine,
  loadSettings, saveSettings, loadCalibration, saveCalibration, ensureMigrated,
  loadActiveWorkout, saveActiveWorkout, clearActiveWorkout,
} from './storage.js';

const $ = (id) => document.getElementById(id);
const now = () => Date.now();

// ── app state ────────────────────────────────────────────────────────────────
const state = {
  tab: 'home',
  screen: null,
  settings: loadSettings(),
  history: [],
  routines: [],
  wod: null,
  wodVariant: 0,
  workout: null,          // active Workout (plain object from engine/workout)
  wTimer: null,           // workout elapsed timer
  picker: { target: 'workout', filterMuscle: null, filterEquipment: null, onPick: null },
  // camera coach submode
  coach: null,            // { exIndex, setIndex, exerciseId, exercise, engine, recorder, calib, mode, calibSamples, calibEndsAt }
  pose: { landmarker: null, delegate: null, lib: null, ready: false, drawing: null },
  running: false,
  lastVideoTime: -1,
  lastFrameAt: 0,
  fps: 0,
  rest: { timer: null, endsAt: 0 },
  lastCue: '',
  lastSpokenAt: 0,
};

const video = $('video');
const canvas = $('overlay');
const ctx = canvas.getContext('2d');

// ── units / formatting ───────────────────────────────────────────────────────
const unit = () => state.settings.units || 'kg';
function fmtWeight(w) { return w == null ? '–' : `${round1(w)} ${unit()}`; }
function fmtVol(v) { return `${Math.round(v)} ${unit()}`; }
function round1(v) { return Math.round(v * 10) / 10; }
function fmtDur(sec) {
  const m = Math.floor(sec / 60); const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function humanize(s) { return String(s || '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

const TRACKING_METRICS = {
  weight_reps: [{ key: 'weight', label: 'Weight', placeholder: 'kg', decimal: true }, { key: 'reps', label: 'Reps', placeholder: 'reps' }],
  reps_only: [{ key: 'reps', label: 'Reps', placeholder: 'reps' }],
  bodyweight_weighted: [{ key: 'weight', label: 'Added kg', placeholder: '+ kg', decimal: true }, { key: 'reps', label: 'Reps', placeholder: 'reps' }],
  bodyweight_assisted: [{ key: 'weight', label: 'Assist kg', placeholder: 'assist', decimal: true }, { key: 'reps', label: 'Reps', placeholder: 'reps' }],
  duration: [{ key: 'durationSec', label: 'Seconds', placeholder: 'sec' }],
  distance_duration: [{ key: 'distanceM', label: 'Metres', placeholder: 'm', decimal: true }, { key: 'durationSec', label: 'Seconds', placeholder: 'sec' }],
  short_distance_weight: [{ key: 'distanceM', label: 'Metres', placeholder: 'm', decimal: true }, { key: 'weight', label: 'Weight', placeholder: 'kg', decimal: true }],
  steps_duration: [{ key: 'steps', label: 'Steps', placeholder: 'steps' }, { key: 'durationSec', label: 'Seconds', placeholder: 'sec' }],
  floors_duration: [{ key: 'floors', label: 'Floors', placeholder: 'floors' }, { key: 'durationSec', label: 'Seconds', placeholder: 'sec' }],
};

function trackingType(cat) {
  return cat.trackingType || (cat.loadType === 'bodyweight' ? 'reps_only' : 'weight_reps');
}
function metricSpecs(cat) { return TRACKING_METRICS[trackingType(cat)] || TRACKING_METRICS.weight_reps; }

function setStatus(t) { const el = $('status'); if (el) el.textContent = t; }

// ── speech (throttled) ───────────────────────────────────────────────────────
function say(text) {
  if (!('speechSynthesis' in window)) return;
  const t = now();
  if (text === state.lastCue || t - state.lastSpokenAt < 1800) return;
  state.lastCue = text; state.lastSpokenAt = t;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.06; u.pitch = 1.0;
    speechSynthesis.speak(u);
  } catch { /* best-effort */ }
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTING — tabs + full-screen modes
// ════════════════════════════════════════════════════════════════════════════
function show(el, on) { if (el) el.classList.toggle('hidden', !on); }

function inCoach() { return !!state.coach; }
function inWorkoutScreen() { return !$('screen-workout').classList.contains('hidden'); }

function setTab(tab) {
  state.tab = tab;
  show($('tab-home'), tab === 'home');
  show($('tab-routines'), tab === 'routines');
  show($('tab-history'), tab === 'history');
  ['home', 'routines', 'history'].forEach((t) => {
    const b = $(`nav-${t}`);
    if (b) {
      b.classList.toggle('on', t === tab);
      if (t === tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    }
  });
  if (tab === 'home') renderHome();
  if (tab === 'routines') renderRoutines();
  if (tab === 'history') renderHistory();
}

// Show one full-screen mode; hide tabs + nav. Passing null returns to tabs.
function showScreen(id) {
  state.screen = id || null;
  ['screen-workout', 'screen-picker', 'screen-summary'].forEach((s) => show($(s), s === id));
  const onScreen = !!id;
  show($('main'), true);
  ['tab-home', 'tab-routines', 'tab-history'].forEach((t) => {
    if (onScreen) show($(t), false);
  });
  show($('bottomnav'), !onScreen && !inCoach());
  show($('btn-back'), onScreen);
  if (!onScreen) setTab(state.tab);
  refreshInstallBanner();
}

function goBack() {
  if (state.screen === 'screen-picker') return closePicker();
  if (state.screen === 'screen-workout') {
    persistActive();
    showScreen(null);
    return;
  }
  if (state.screen === 'screen-summary') {
    showScreen(null);
    setTab('home');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HOME TAB
// ════════════════════════════════════════════════════════════════════════════
function renderHome() {
  show($('home-active'), !!state.workout);
  show($('btn-resume-workout'), !!state.workout);
  renderWOD();
  // Disable "Repeat last workout" when there's nothing to repeat. Set this
  // before the empty-history early return below, or it never runs when empty.
  $('btn-repeat-last').disabled = !state.history.length;
  const el = $('home-recent');
  if (!el) return;
  show($('home-recent-card'), !!state.history.length);
  if (!state.history.length) { el.innerHTML = ''; return; }
  el.innerHTML = state.history.slice(0, 3).map(recentRow).join('');
}

function renderWOD() {
  const t = now();
  if (!state.wod || t >= state.wod.meta.expiresAtMs) {
    state.wod = generateWOD({
      history: state.history,
      baselineRoutine: OS_FULL_BODY_ROUTINE,
      nowMs: t,
      variant: state.wodVariant,
    });
  }
  const { workout, meta } = state.wod;
  $('wod-title').textContent = workout.title.replace('Workout of the Day · ', '');
  $('wod-rationale').textContent = meta.rationale;
  $('wod-exercises').innerHTML = workout.exercises.map((ex) => {
    const cat = getCatalogEntry(ex.exerciseId);
    const first = ex.sets[0] || {};
    const prescription = first.weight == null
      ? `${ex.sets.length} × ${first.reps} · BW`
      : `${ex.sets.length} × ${first.reps} · ${fmtWeight(first.weight)}`;
    return `<div class="wod-row"><span>${esc(cat ? cat.name : ex.exerciseId)}</span><b>${esc(prescription)}</b></div>`;
  }).join('');
}

function regenerateWOD() {
  state.wodVariant += 1;
  state.wod = null;
  renderWOD();
}

function startWOD() {
  if (!state.wod) renderWOD();
  state.workout = makeWorkout({
    ...state.wod.workout,
    id: newWorkoutId(),
    startedAtMs: now(),
  });
  openWorkout();
}

function recentRow(w) {
  const vol = workoutVolume(w, { bodyweightKg: state.settings.bodyweightKg });
  return `<div class="hist-row"><span>${fmtDate(w.startedAtMs)}</span><span>${esc(w.title)}</span><b>${fmtVol(vol)}</b></div>`;
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTINES TAB
// ════════════════════════════════════════════════════════════════════════════
function renderRoutines() {
  const bi = $('routines-builtin');
  bi.innerHTML = BUILTIN_ROUTINES.map((r) => routineCard(r, true)).join('');
  const cu = $('routines-custom');
  cu.innerHTML = state.routines.length
    ? state.routines.map((r) => routineCard(r, false)).join('')
    : '<div class="muted">No custom routines yet.</div>';
  bi.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => {
    startRoutine(b.dataset.routine, b.dataset.day);
  }));
  cu.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => {
    startRoutine(b.dataset.routine, b.dataset.day);
  }));
  cu.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    deleteRoutine(b.dataset.del);
    state.routines = loadRoutines();
    renderRoutines();
  }));
}

function routineCard(r, builtin) {
  const days = (r.days || []).map((d) => {
    const lifts = d.exercises.map((e) => catalogName(e.exerciseId)).join(', ');
    return `<div class="routine-day">
      <div><b>${esc(d.name)}</b><div class="muted">${esc(lifts)}</div></div>
      <button class="ghost small" data-start data-routine="${r.id}" data-day="${d.key}">Start</button>
    </div>`;
  }).join('');
  const disc = r.disclaimer ? `<p class="muted tiny" style="margin-top:8px">${esc(r.disclaimer)}</p>` : '';
  const del = builtin ? '' : `<button class="ghost small danger" data-del="${r.id}">Delete</button>`;
  return `<div class="routine">
    <div class="head-row"><div class="label">${esc(r.name)}${builtin ? ' <span class="badge">built-in</span>' : ''}</div>${del}</div>
    ${days}${disc}
  </div>`;
}

function catalogName(id) { const e = getCatalogEntry(id); return e ? e.name : id; }

// ════════════════════════════════════════════════════════════════════════════
// HISTORY TAB
// ════════════════════════════════════════════════════════════════════════════
function renderHistory() {
  const stats = $('history-stats');
  const total = state.history.length;
  const vol = state.history.reduce((a, w) => a + workoutVolume(w, { bodyweightKg: state.settings.bodyweightKg }), 0);
  const sets = state.history.reduce((a, w) => a + completedSetCount(w), 0);
  stats.innerHTML = `
    ${statTile('Workouts', total)}
    ${statTile('Sets', sets)}
    ${statTile('Volume', fmtVol(vol))}`;

  const list = $('history-list');
  if (!total) { list.innerHTML = '<div class="muted">No workouts yet.</div>'; return; }
  list.innerHTML = state.history.map((w, i) => {
    const v = workoutVolume(w, { bodyweightKg: state.settings.bodyweightKg });
    const dur = workoutDurationSec(w);
    const prs = newPRsInWorkout(w, state.history.slice(i + 1));
    const prBadge = prs.length ? `<span class="badge pr">★ ${prs.length} PR</span>` : '';
    const lifts = w.exercises.map((e) => catalogName(e.exerciseId)).join(' · ');
    return `<div class="wcard">
      <div class="head-row"><b>${esc(w.title)}</b><span class="muted">${fmtDate(w.startedAtMs)}</span></div>
      <div class="muted tiny" style="margin:4px 0">${esc(lifts)}</div>
      <div class="wstats">
        <span>${completedSetCount(w)} sets</span><span>${totalReps(w)} reps</span>
        <span>${fmtVol(v)}</span><span>${fmtDur(dur)}</span>${prBadge}
      </div>
    </div>`;
  }).join('');
}

function statTile(label, val) {
  return `<div class="stat"><div class="stat-val">${val}</div><div class="stat-label">${label}</div></div>`;
}

// ════════════════════════════════════════════════════════════════════════════
// START WORKOUT flows
// ════════════════════════════════════════════════════════════════════════════
function newWorkoutId() { return `w-${now().toString(36)}-${Math.floor(performance.now())}`; }

function startEmptyWorkout() {
  state.workout = makeWorkout({ id: newWorkoutId(), title: 'Workout', startedAtMs: now() });
  openWorkout();
  // jump straight to the picker for the first exercise
  openPicker('workout');
}

function startOccam(dayKey) {
  state.workout = routineToWorkout(OCCAM_ROUTINE, dayKey, { id: newWorkoutId(), startedAtMs: now() });
  openWorkout();
}

function startRoutine(routineId, dayKey) {
  const routine = BUILTIN_ROUTINES.find((r) => r.id === routineId)
    || state.routines.find((r) => r.id === routineId);
  if (!routine) return;
  state.workout = routineToWorkout(routine, dayKey, { id: newWorkoutId(), startedAtMs: now() });
  openWorkout();
}

function startRepeatLast() {
  if (!state.history.length) return;
  state.workout = repeatWorkout(state.history[0], { id: newWorkoutId(), startedAtMs: now() });
  openWorkout();
}

function openWorkout() {
  showScreen('screen-workout');
  renderWorkout();
  if (state.wTimer) clearInterval(state.wTimer);
  state.wTimer = setInterval(updateWorkoutHead, 1000);
  updateWorkoutHead();
}

// Persist the in-progress workout so a refresh / tab kill / crash mid-session
// never loses logged sets. updateWorkoutHead is the funnel every mutation path
// (and the 1 s timer) already runs through; the string compare skips no-op ticks.
let lastPersisted = '';
function persistActive() {
  if (!state.workout) return;
  const json = JSON.stringify(state.workout);
  if (json === lastPersisted) return;
  lastPersisted = json;
  saveActiveWorkout(state.workout);
}
function discardActive() { lastPersisted = ''; clearActiveWorkout(); }

function updateWorkoutHead() {
  if (!state.workout) return;
  persistActive();
  const dur = Math.max(0, Math.round((now() - state.workout.startedAtMs) / 1000));
  const vol = workoutVolume(state.workout, { bodyweightKg: state.settings.bodyweightKg });
  const sets = completedSetCount(state.workout);
  const t = $('workout-timer');
  if (t) {
    const done = state.workout.exercises.flatMap((ex) => ex.sets).filter((s) => s.completed);
    const distance = done.reduce((n, s) => n + (s.distanceM || 0), 0);
    const workSec = done.reduce((n, s) => n + (s.durationSec || 0), 0);
    const steps = done.reduce((n, s) => n + (s.steps || 0), 0);
    const floors = done.reduce((n, s) => n + (s.floors || 0), 0);
    const parts = [fmtDur(dur)];
    if (vol > 0) parts.push(fmtVol(vol));
    if (distance > 0) parts.push(distance >= 1000 ? `${round1(distance / 1000)} km` : `${round1(distance)} m`);
    if (workSec > 0) parts.push(`${fmtDur(workSec)} work`);
    if (steps > 0) parts.push(`${steps} steps`);
    if (floors > 0) parts.push(`${floors} floors`);
    parts.push(`${sets} set${sets === 1 ? '' : 's'}`);
    t.textContent = parts.join(' · ');
  }
  const title = $('workout-title');
  if (title) title.textContent = state.workout.title;
}

// ════════════════════════════════════════════════════════════════════════════
// ACTIVE WORKOUT — render exercise cards + set rows
// ════════════════════════════════════════════════════════════════════════════
function renderWorkout() {
  const host = $('workout-exercises');
  if (!host || !state.workout) return;
  const empty = !state.workout.exercises.length;
  host.innerHTML = !empty
    ? state.workout.exercises.map((ex, ei) => exerciseCard(ex, ei)).join('')
    : `<div class="workout-empty">
        <b>Build your workout</b>
        <span>Add an exercise to start logging sets.</span>
      </div>`;
  $('btn-save-as-routine').disabled = empty;
  $('btn-finish').disabled = completedSetCount(state.workout) === 0;
  const add = $('btn-add-exercise');
  add.className = empty ? 'primary wide' : 'ghost wide';
  add.textContent = empty ? '+ Add your first exercise' : '+ Add exercise';
  wireWorkoutEvents(host);
  updateWorkoutHead();
}

function exerciseCard(ex, ei) {
  const cat = getCatalogEntry(ex.exerciseId) || { name: ex.exerciseId, unilateral: false, loadType: 'external' };
  const prevSets = previousSets(state.history, ex.exerciseId);
  const prevStr = prevSets.length ? summarizeTrackedSet(prevSets[0], cat) : 'first time';
  const cam = hasCamera(ex.exerciseId);
  const exp = isExperimentalCamera(ex.exerciseId);
  const camDot = cam ? `<span class="cam-dot ${confClass(cat)}" title="${esc(cat.camera.confidence)} confidence"></span>` : '';
  const coachBtn = cam
    ? `<button class="ghost small" data-coach="${ei}">📷 Coach${exp ? ' <span class="badge experimental">exp</span>' : ''}</button>`
    : '';

  const rows = ex.sets.map((s, si) => setRow(ex, s, si, ei, cat, prevSets[si])).join('');
  const metricHead = metricSpecs(cat).map((m) => `<span>${esc(m.label)}</span>`).join('');
  return `<div class="ex-card2" data-ex="${ei}">
    <div class="ex-head">
      <div>${camDot}<b>${esc(cat.name)}</b>${cat.unilateral ? ' <span class="badge">per side</span>' : ''}</div>
      <button class="ghost tiny-btn" data-rmex="${ei}" aria-label="Remove exercise">✕</button>
    </div>
    <div class="muted tiny prev-line">Previous: ${esc(prevStr)}</div>
    <div class="set-head"><span>#</span><span class="metric-head">${metricHead}</span><span>type</span><span>RPE</span><span>✓</span></div>
    ${rows}
    <div class="ex-actions">
      <button class="ghost small" data-addset="${ei}">+ Add set</button>
      ${coachBtn}
    </div>
  </div>`;
}

function summarizeTrackedSet(set, cat) {
  return metricSpecs(cat).map((m) => {
    const value = set[m.key];
    if (m.key === 'weight') return value == null ? null : fmtWeight(value);
    if (!value) return null;
    if (m.key === 'durationSec') return `${value}s`;
    if (m.key === 'distanceM') return `${round1(value)}m`;
    return `${value} ${m.label.toLowerCase()}`;
  }).filter(Boolean).join(' · ') || 'logged';
}

function confClass(cat) {
  const c = cat.camera ? cat.camera.confidence : 'low';
  return c === 'high' ? 'high' : c === 'medium' ? 'med' : 'low';
}

// `prev` is set si of the last session for this exercise (may be undefined).
// Its values become placeholders, and the ✓ button adopts them when the inputs
// were left empty — the Hevy fast path: match last session by just ticking sets.
function setRow(ex, s, si, ei, cat, prev) {
  const typeLabel = { warmup: 'Warm', normal: 'Normal', drop: 'Drop', failure: 'Fail' }[s.type] || 'Normal';
  const sideLabel = cat.unilateral ? `<button class="side-btn" data-side="${ei}:${si}" aria-label="Working side">${s.side || 'L'}</button>` : '';
  const camTag = s.source === 'camera' ? '<span class="badge cam">📷</span>' : '';
  const metrics = metricSpecs(cat).map((m) => {
    const value = s[m.key];
    const previous = prev && prev[m.key];
    const placeholder = previous != null && previous !== 0 ? round1(previous) : m.placeholder;
    const cls = m.key === 'weight' ? 'w-in' : m.key === 'reps' ? 'r-in' : 'metric-in';
    const shown = m.key === 'weight' ? (value ?? '') : (value || '');
    return `<input class="${cls}" data-metric="${m.key}" data-set="${ei}:${si}" type="number" inputmode="${m.decimal ? 'decimal' : 'numeric'}" placeholder="${placeholder}" value="${shown}" aria-label="${esc(m.label)}, set ${si + 1}" />`;
  }).join('');
  return `<div class="set-row ${s.completed ? 'done' : ''}" data-row="${ei}:${si}">
    <span class="set-idx">${si + 1}${sideLabel}</span>
    <span class="set-load">${metrics}${camTag}</span>
    <button class="type-btn t-${s.type}" data-type="${ei}:${si}" aria-label="Set type">${typeLabel}</button>
    <input class="rpe-in" data-rpe="${ei}:${si}" type="number" inputmode="decimal" placeholder="–" aria-label="RPE, set ${si + 1}" value="${s.rpe ?? ''}" />
    <button class="check-btn ${s.completed ? 'on' : ''}" data-done="${ei}:${si}" aria-label="Complete set ${si + 1}" aria-pressed="${s.completed}">✓</button>
  </div>`;
}

function parseIdx(str) { const [a, b] = str.split(':').map(Number); return [a, b]; }

function wireWorkoutEvents(host) {
  host.querySelectorAll('[data-metric]').forEach((el) => el.addEventListener('change', () => {
    const [ei, si] = parseIdx(el.dataset.set);
    const key = el.dataset.metric;
    const value = el.value === '' ? (key === 'weight' ? null : 0) : Number(el.value);
    state.workout = updateSet(state.workout, ei, si, { [key]: value });
    updateWorkoutHead();
  }));
  host.querySelectorAll('[data-rpe]').forEach((el) => el.addEventListener('change', () => {
    const [ei, si] = parseIdx(el.dataset.rpe);
    state.workout = updateSet(state.workout, ei, si, { rpe: el.value === '' ? null : Number(el.value) });
  }));
  host.querySelectorAll('[data-type]').forEach((el) => el.addEventListener('click', () => {
    const [ei, si] = parseIdx(el.dataset.type);
    const cur = state.workout.exercises[ei].sets[si].type;
    const next = SET_TYPES[(SET_TYPES.indexOf(cur) + 1) % SET_TYPES.length];
    state.workout = updateSet(state.workout, ei, si, { type: next });
    renderWorkout();
  }));
  host.querySelectorAll('[data-side]').forEach((el) => el.addEventListener('click', () => {
    const [ei, si] = parseIdx(el.dataset.side);
    const cur = state.workout.exercises[ei].sets[si].side || 'L';
    state.workout = updateSet(state.workout, ei, si, { side: cur === 'L' ? 'R' : 'L' });
    renderWorkout();
  }));
  host.querySelectorAll('[data-done]').forEach((el) => el.addEventListener('click', () => {
    const [ei, si] = parseIdx(el.dataset.done);
    const s = state.workout.exercises[ei].sets[si];
    const nowDone = !s.completed;
    const patch = { completed: nowDone };
    if (nowDone) {
      // empty fields adopt the placeholder (= last session's set si), Hevy-style
      const prev = previousSets(state.history, state.workout.exercises[ei].exerciseId)[si];
      if (prev) {
        for (const metric of metricSpecs(getCatalogEntry(state.workout.exercises[ei].exerciseId))) {
          const empty = metric.key === 'weight' ? s[metric.key] == null : !s[metric.key];
          if (empty && prev[metric.key] != null) patch[metric.key] = prev[metric.key];
        }
      }
    }
    state.workout = updateSet(state.workout, ei, si, patch);
    if (nowDone) { try { navigator.vibrate?.(12); } catch {} }
    renderWorkout();
    if (nowDone && state.settings.autoStartRest) startRest(ei);
  }));
  host.querySelectorAll('[data-addset]').forEach((el) => el.addEventListener('click', () => {
    const ei = Number(el.dataset.addset);
    const last = state.workout.exercises[ei].sets.slice(-1)[0];
    state.workout = addSet(state.workout, ei, last ? {
      weight: last.weight, reps: last.reps, durationSec: last.durationSec,
      distanceM: last.distanceM, steps: last.steps, floors: last.floors, type: 'normal',
    } : {});
    renderWorkout();
  }));
  host.querySelectorAll('[data-rmex]').forEach((el) => el.addEventListener('click', () => {
    const ei = Number(el.dataset.rmex);
    state.workout = removeExercise(state.workout, ei);
    renderWorkout();
  }));
  host.querySelectorAll('[data-coach]').forEach((el) => el.addEventListener('click', () => {
    enterCoach(Number(el.dataset.coach));
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// EXERCISE PICKER
// ════════════════════════════════════════════════════════════════════════════
function openPicker(targetMode = 'workout', onPick = null) {
  state.picker = { target: targetMode, filterMuscle: null, filterEquipment: null, onPick };
  showScreen('screen-picker');
  $('picker-search').value = '';
  renderPickerFilters();
  renderPicker();
  setTimeout(() => { try { $('picker-search').focus(); } catch {} }, 50);
}

// Muscle and equipment are independent filter axes: picking a muscle never
// clears the equipment selection (and vice versa). searchCatalog intersects
// whichever of the two are set, so "all" on an axis just means no constraint.
function renderPickerFilters() {
  renderFilterRow('picker-filters-muscle', MUSCLES, 'filterMuscle', 'All muscles');
  renderFilterRow('picker-filters-equipment', EQUIPMENT, 'filterEquipment', 'All equipment');
}

function renderFilterRow(hostId, values, key, allLabel) {
  const host = $(hostId);
  const active = state.picker[key];
  host.innerHTML = ['all', ...values].map((v) =>
    `<button class="chip ${(!active && v === 'all') || active === v ? 'on' : ''}" data-val="${v}">${v === 'all' ? allLabel : humanize(v)}</button>`
  ).join('');
  host.querySelectorAll('[data-val]').forEach((b) => b.addEventListener('click', () => {
    state.picker[key] = b.dataset.val === 'all' ? null : b.dataset.val;
    renderPickerFilters(); renderPicker();
  }));
}

function renderPicker() {
  const q = $('picker-search').value;
  const results = searchCatalog({ query: q, muscle: state.picker.filterMuscle, equipment: state.picker.filterEquipment });
  const host = $('picker-list');
  $('picker-count').textContent = `${results.length} exercise${results.length === 1 ? '' : 's'}`;
  host.innerHTML = results.map((e) => {
    const badge = hasCamera(e)
      ? `<span class="badge cam ${confClass(e)}">📷 Coach</span>`
      : `<span class="badge manual">${esc(humanize(trackingType(e)))}</span>`;
    return `<button class="pick-row" data-pick="${e.id}">
      <span><b>${esc(e.name)}</b><span class="pick-meta">${esc(humanize(e.primaryMuscle))} · ${esc(humanize(e.equipment))}</span></span>
      ${badge}
    </button>`;
  }).join('') || '<div class="muted">No matches.</div>';
  host.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => pickExercise(b.dataset.pick)));
}

function pickExercise(id) {
  // onPick callers (routine builder) own navigation — they either reopen the
  // picker for the next exercise or return to the tabs themselves.
  if (state.picker.onPick) { const cb = state.picker.onPick; cb(id); return; }
  state.workout = addExercise(state.workout, id, [{}]);
  showScreen('screen-workout');
  renderWorkout();
}

// Close the picker: back to the active workout if there is one, else the tabs.
function closePicker() {
  if (state.workout) showScreen('screen-workout');
  else showScreen(null);
}

// ════════════════════════════════════════════════════════════════════════════
// REST TIMER
// ════════════════════════════════════════════════════════════════════════════
function restSecFor(ei) {
  const ex = state.workout && state.workout.exercises[ei];
  const cat = ex && getCatalogEntry(ex.exerciseId);
  return (cat && cat.defaultRestSec) || state.settings.defaultRestSec || 120;
}

function startRest(ei) {
  const secs = restSecFor(ei);
  state.rest.endsAt = now() + secs * 1000;
  show($('rest-overlay'), true);
  tickRest();
  if (state.rest.timer) clearInterval(state.rest.timer);
  state.rest.timer = setInterval(tickRest, 250);
}
function tickRest() {
  const remain = Math.max(0, Math.ceil((state.rest.endsAt - now()) / 1000));
  const el = $('rest-timer'); if (el) el.textContent = `${remain}s`;
  if (remain <= 0) endRest();
}
function endRest() {
  if (state.rest.timer) { clearInterval(state.rest.timer); state.rest.timer = null; }
  show($('rest-overlay'), false);
}

// ════════════════════════════════════════════════════════════════════════════
// FINISH / CANCEL / SUMMARY
// ════════════════════════════════════════════════════════════════════════════
function finishWorkout() {
  if (!state.workout) return;
  if (!completedSetCount(state.workout)) {
    if (confirm('No completed sets — discard this workout?')) cancelWorkout();
    return;
  }
  // uncompleted-but-typed sets would be silently lost by the prune — ask first
  const droppedWithData = state.workout.exercises
    .flatMap((ex) => ex.sets)
    .filter((s) => !s.completed && (
      s.weight != null || (s.reps || 0) > 0 || (s.durationSec || 0) > 0 ||
      (s.distanceM || 0) > 0 || (s.steps || 0) > 0 || (s.floors || 0) > 0
    )).length;
  if (droppedWithData && !confirm(`${droppedWithData} unchecked set${droppedWithData === 1 ? '' : 's'} will be discarded. Finish anyway?`)) return;
  endRest();
  if (state.wTimer) { clearInterval(state.wTimer); state.wTimer = null; }
  const finished = pruneIncompleteSets(state.workout);
  finished.endedAtMs = now();
  const prs = newPRsInWorkout(finished, state.history);
  if (!saveWorkout(finished)) alert('Could not save the workout — storage is unavailable. Export before closing.');
  discardActive();
  state.history = loadWorkouts();
  showSummary(finished, prs);
  state.workout = null;
}

function cancelWorkout() {
  if (state.wTimer) { clearInterval(state.wTimer); state.wTimer = null; }
  endRest();
  state.workout = null;
  discardActive();
  showScreen(null);
  setTab('home');
}

function showSummary(workout, prs) {
  const s = summarize(workout, { bodyweightKg: state.settings.bodyweightKg });
  $('summary-body').innerHTML = `
    <div class="sum-row"><span>Title</span><b>${esc(workout.title)}</b></div>
    <div class="sum-row"><span>Duration</span><b>${fmtDur(s.durationSec)}</b></div>
    <div class="sum-row"><span>Exercises</span><b>${s.exercises}</b></div>
    <div class="sum-row"><span>Sets</span><b>${s.sets}</b></div>
    <div class="sum-row"><span>Reps</span><b>${s.reps}</b></div>
    <div class="sum-row"><span>Total volume</span><b>${fmtVol(s.volume)}</b></div>`;

  const prHost = $('summary-prs');
  // cadence + progression suggestion for Occam lifts (suggestions only)
  const extras = buildProgressionNotes(workout);
  const prCards = prs.length
    ? `<div class="card"><div class="label">New PRs ★</div>${prs.map((p) =>
        `<div class="sum-row"><span>${esc(catalogName(p.exerciseId))}</span><b>${p.kinds.join(' · ')}</b></div>`).join('')}</div>`
    : '';
  prHost.innerHTML = prCards + extras;
  showScreen('screen-summary');
}

// Deterministic next-load suggestions for camera-coached / Occam sets.
function buildProgressionNotes(workout) {
  const notes = [];
  for (const ex of workout.exercises) {
    const cat = getCatalogEntry(ex.exerciseId);
    // find a camera-sourced completed set to score cadence
    const camSet = ex.sets.find((s) => s.completed && s.source === 'camera' && s.camera && Array.isArray(s.camera.reps));
    let cadence = null;
    if (camSet) cadence = cadenceScore(camSet.camera.reps.map((r) => r.tMs));
    // progression only when the exercise has an Occam target
    const target = occamTargetFor(ex.exerciseId);
    const done = ex.sets.filter((s) => s.completed && s.weight != null);
    if (target && done.length) {
      const best = done.reduce((a, b) => ((b.weight || 0) >= (a.weight || 0) ? b : a));
      const sugg = nextLoadSuggestion({
        lastWeight: best.weight, lastReps: best.reps, targetReps: target, unit: unit(),
        cadenceOk: cadence ? cadence.verdict !== 'too fast' : true,
      });
      if (sugg) {
        const cad = cadence ? ` · cadence ${cadence.avgRepSec}s/rep (${cadence.verdict})` : '';
        notes.push(`<div class="sum-row"><span>${esc(cat.name)}</span><b>${sugg.action === 'progress' ? `→ ${fmtWeight(sugg.suggestedWeight)}` : 'hold'}</b></div>
          <div class="muted tiny" style="margin:-4px 0 8px">${esc(sugg.reason)}${cad}</div>`);
      }
    } else if (cadence) {
      notes.push(`<div class="sum-row"><span>${esc(cat.name)}</span><b>${cadence.avgRepSec}s/rep</b></div>
        <div class="muted tiny" style="margin:-4px 0 8px">Cadence: ${cadence.verdict} vs 5/5 target</div>`);
    }
  }
  return notes.length ? `<div class="card"><div class="label">Suggestions <span class="muted tiny">(not auto-applied)</span></div>${notes.join('')}</div>` : '';
}

function occamTargetFor(exerciseId) {
  for (const d of OCCAM_ROUTINE.days) {
    const re = d.exercises.find((e) => e.exerciseId === exerciseId);
    if (re) return re.targetReps;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// SAVE AS ROUTINE
// ════════════════════════════════════════════════════════════════════════════
function saveCurrentAsRoutine() {
  if (!state.workout || !state.workout.exercises.length) return;
  const name = prompt('Routine name?', state.workout.title || 'My routine');
  if (name == null) return;
  const routine = workoutToRoutine(state.workout, { id: `r-${now().toString(36)}`, name });
  saveRoutine(routine);
  state.routines = loadRoutines();
  setStatus('routine saved');
}

// ════════════════════════════════════════════════════════════════════════════
// CAMERA COACH SUBMODE  (reuses the v1 pose loop; writes reps back to a set)
// ════════════════════════════════════════════════════════════════════════════
async function enterCoach(exIndex) {
  const ex = state.workout.exercises[exIndex];
  const exercise = getExercise(ex.exerciseId);
  if (!exercise) return;
  // coach the first uncompleted set, or add one
  let setIndex = ex.sets.findIndex((s) => !s.completed);
  if (setIndex < 0) {
    state.workout = addSet(state.workout, exIndex, {});
    setIndex = state.workout.exercises[exIndex].sets.length - 1;
  }
  state.coach = { exIndex, setIndex, exerciseId: ex.exerciseId, exercise, mode: 'idle', calibSamples: [], calibEndsAt: 0, engine: null, recorder: null, calib: null };

  show($('bottomnav'), false);
  show($('main'), false);
  show($('stage'), true);
  refreshInstallBanner();
  const exp = isExperimentalCamera(ex.exerciseId);
  show($('coach-experimental'), exp);

  if (!state.pose.ready) { setStatus('loading model…'); await initPose(); }
  const ok = await startCamera();
  if (!ok) { exitCoach(false); return; }
  state.running = true;
  state.lastFrameAt = performance.now();
  state.lastVideoTime = -1;

  const stored = loadCalibration(ex.exerciseId);
  if (stored) { state.coach.calib = stored; startCoachSet(); }
  else startCoachCalibration();
  loop();
}

function startCoachCalibration() {
  state.coach.mode = 'calibrating';
  state.coach.calibSamples = [];
  state.coach.calibEndsAt = now() + 12000;
  $('calib-title').textContent = `Calibrate ${state.coach.exercise.name}`;
  $('calib-instructions').textContent = `${state.coach.exercise.orientation} Perform 2 slow, full-range reps.`;
  show($('calib-overlay'), true);
  show($('hud'), false);
}

function finishCoachCalibration() {
  const result = calibrate(state.coach.exercise, state.coach.calibSamples);
  state.coach.calib = result;
  saveCalibration(state.coach.exerciseId, result);
  show($('calib-overlay'), false);
  startCoachSet();
}

function startCoachSet() {
  state.coach.mode = 'active';
  state.coach.engine = new RepEngine();
  state.coach.recorder = new SessionRecorder({
    exercise: state.coach.exercise,
    target: null,
    calibration: state.coach.calib,
    now,
    device: { ua: navigator.userAgent, delegate: state.pose.delegate },
  });
  show($('hud'), true);
  $('reps').textContent = '0';
  $('rep-target').textContent = '';
  $('ex-name').textContent = state.coach.exercise.name;
  $('metric-label').textContent = state.coach.exercise.driver;
  setCue('Ready', 'good');
}

function endCoachSet() {
  if (!state.coach || !state.coach.recorder) { exitCoach(false); return; }
  state.coach.recorder.end();
  const blob = state.coach.recorder.toJSON();
  const reps = state.coach.recorder.repCount;
  const { exIndex, setIndex } = state.coach;
  state.workout = updateSet(state.workout, exIndex, setIndex, {
    reps, source: 'camera', camera: blob, completed: true,
  });
  say('Reps saved');
  const ei = exIndex;
  exitCoach(true);
  renderWorkout();
  if (state.settings.autoStartRest) startRest(ei);
}

function exitCoach(_saved) {
  state.running = false;
  stopCamera();
  show($('stage'), false);
  show($('hud'), false);
  show($('calib-overlay'), false);
  show($('coach-experimental'), false);
  state.coach = null;
  showScreen('screen-workout');
}

// ── pose init / camera / loop (adapted from v1) ──────────────────────────────
async function initPose() {
  try {
    const { landmarker, delegate, lib } = await createPoseLandmarker();
    state.pose = { landmarker, delegate, lib, ready: true, drawing: null };
    setStatus('ready');
  } catch (e) {
    console.warn('[app] pose model unavailable', e);
    state.pose.ready = false;
    setStatus('model offline');
  }
}

async function startCamera() {
  if (video.srcObject) return true;
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
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
  if (video.srcObject) { video.srcObject.getTracks().forEach((t) => t.stop()); video.srcObject = null; }
}

function loop() {
  if (!state.running || !state.coach) return;
  const active = state.coach.mode === 'active' || state.coach.mode === 'calibrating';
  if (active && state.pose.landmarker && video.readyState >= 2 && video.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = video.currentTime;
    const t = performance.now();
    const dt = t - state.lastFrameAt; state.lastFrameAt = t;
    if (dt > 0) state.fps = 0.9 * state.fps + 0.1 * (1000 / dt);

    let result = null;
    try { result = state.pose.landmarker.detectForVideo(video, t); }
    catch (e) { console.warn('[app] detect error', e); }

    canvas.width = video.videoWidth || canvas.width;
    canvas.height = video.videoHeight || canvas.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (result && result.landmarks && result.landmarks.length) {
      const lm = result.landmarks[0];
      drawSkeleton(lm);
      if (state.coach.mode === 'calibrating') handleCalibFrame(lm);
      else handleCoachFrame(lm);
    } else {
      setCue('Step into frame', 'warn');
    }
    setStatus(`live · ${state.pose.delegate} · ${Math.round(state.fps)} fps`);
  }
  requestAnimationFrame(loop);
}

function drawSkeleton(lm) {
  try {
    const lib = state.pose.lib;
    if (!lib) return;
    if (!state.pose.drawing) state.pose.drawing = new lib.DrawingUtils(ctx);
    state.pose.drawing.drawConnectors(lm, lib.PoseLandmarker.POSE_CONNECTIONS, { color: '#57e7ad', lineWidth: 4 });
    state.pose.drawing.drawLandmarks(lm, { color: '#ffffff', fillColor: '#57e7ad', radius: 3 });
  } catch { /* cosmetic */ }
}

function handleCalibFrame(lm) {
  const c = state.coach;
  const m = c.exercise.measure(lm);
  const remain = Math.max(0, Math.ceil((c.calibEndsAt - now()) / 1000));
  $('calib-count').textContent = remain;
  if (m.valid) { c.calibSamples.push(m.drivingAngle); $('calib-live').textContent = `${c.exercise.driver}: ${Math.round(m.drivingAngle)}° · ${c.calibSamples.length}`; }
  else $('calib-live').textContent = m.reason;
  if (now() >= c.calibEndsAt) finishCoachCalibration();
}

function handleCoachFrame(lm) {
  const c = state.coach;
  const m = c.exercise.measure(lm);
  if (!m.valid) { setCue(m.reason, 'warn'); return; }
  const progress = c.exercise.progressFrom(m.drivingAngle, c.calib);
  const ev = c.engine.update(progress);
  $('metric-primary').textContent = `${Math.round(m.drivingAngle)}°`;
  $('progress-fill').style.width = `${Math.round(progress * 100)}%`;
  const cue = c.exercise.coach(m, ev);

  if (ev.repCompleted) {
    c.recorder.recordRep(ev.peakProgress);
    $('reps').textContent = c.recorder.repCount;
    setCue(`Rep ${c.recorder.repCount}`, 'good', true);
  } else if (ev.partial) {
    c.recorder.recordPartial();
    setCue('Full range next time', 'warn', true);
  } else {
    setCue(cue.text, cue.tone, cue.tone !== 'good');
  }
}

function setCue(text, tone = 'good', speak = false) {
  const el = $('cue');
  if (el) { el.textContent = text; el.className = `cue ${tone}`; }
  if (speak && (tone === 'bad' || tone === 'warn' || text.startsWith('Rep'))) say(text);
  if (state.coach && state.coach.recorder && (tone === 'warn' || tone === 'bad')) state.coach.recorder.recordCue(text, tone);
}

// ════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════════════════════════
function openSettings() {
  const s = state.settings;
  $('seg-units').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.unit === s.units));
  $('set-bodyweight').value = s.bodyweightKg ?? '';
  $('set-rest').value = s.defaultRestSec;
  $('set-autorest').checked = !!s.autoStartRest;
  show($('screen-settings'), true);
}
function closeSettings() { show($('screen-settings'), false); }

function wireSettings() {
  $('seg-units').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    state.settings = saveSettings({ units: b.dataset.unit });
    openSettings();
    refreshAll();
  }));
  $('set-bodyweight').addEventListener('change', (e) => {
    state.settings = saveSettings({ bodyweightKg: e.target.value === '' ? null : Number(e.target.value) });
  });
  $('set-rest').addEventListener('change', (e) => {
    state.settings = saveSettings({ defaultRestSec: Math.max(0, Number(e.target.value) || 0) });
  });
  $('set-autorest').addEventListener('change', (e) => {
    state.settings = saveSettings({ autoStartRest: e.target.checked });
  });
  $('btn-reset-data').addEventListener('click', () => {
    if (confirm('Clear all v2 workout history? (v1 history is kept.)')) {
      clearWorkouts(); state.history = loadWorkouts(); refreshAll();
    }
  });
}

function refreshAll() {
  state.history = loadWorkouts();
  state.routines = loadRoutines();
  if (state.tab === 'home') renderHome();
  if (state.tab === 'history') renderHistory();
  if (state.tab === 'routines') renderRoutines();
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORT
// ════════════════════════════════════════════════════════════════════════════
function exportJSON() {
  const workouts = loadWorkouts();
  const doc = toWorkoutExportDocument(workouts, { settings: { units: unit(), bodyweightKg: state.settings.bodyweightKg } });
  doc.exportedAtMs = now();
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `janai-form-coach-v2-${now()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ════════════════════════════════════════════════════════════════════════════
// PWA install
// ════════════════════════════════════════════════════════════════════════════
let deferredPrompt = null;
let installReady = false;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredPrompt = e; installReady = true; refreshInstallBanner();
});

// Show the install prompt only on the tab views. On a full-screen mode (active
// workout, picker, summary) or in camera coach it would collide with the fixed
// bottom nav / controls, so keep it out of the way there.
function refreshInstallBanner() {
  const on = installReady && !state.screen && !inCoach();
  show($('install-banner'), on);
  document.body.classList.toggle('has-install-banner', on);
}

// ════════════════════════════════════════════════════════════════════════════
// WIRING + BOOT
// ════════════════════════════════════════════════════════════════════════════
function wireEvents() {
  $('nav-home').addEventListener('click', () => setTab('home'));
  $('nav-routines').addEventListener('click', () => setTab('routines'));
  $('nav-history').addEventListener('click', () => setTab('history'));

  $('btn-start-empty').addEventListener('click', startEmptyWorkout);
  $('btn-resume-workout').addEventListener('click', openWorkout);
  $('btn-back').addEventListener('click', goBack);
  $('btn-wod-start').addEventListener('click', startWOD);
  $('btn-wod-regenerate').addEventListener('click', regenerateWOD);
  $('btn-repeat-last').addEventListener('click', startRepeatLast);

  $('btn-add-exercise').addEventListener('click', () => openPicker('workout'));
  $('btn-finish').addEventListener('click', finishWorkout);
  $('btn-cancel-workout').addEventListener('click', () => { if (confirm('Discard this workout?')) cancelWorkout(); });
  $('btn-save-as-routine').addEventListener('click', saveCurrentAsRoutine);

  $('picker-search').addEventListener('input', renderPicker);

  $('btn-new-routine').addEventListener('click', createRoutineFlow);

  $('btn-coach-pause').addEventListener('click', () => {
    if (!state.coach) return;
    if (state.coach.mode === 'active') { state.coach.mode = 'paused'; $('btn-coach-pause').textContent = 'Resume'; }
    else { state.coach.mode = 'active'; state.lastVideoTime = -1; $('btn-coach-pause').textContent = 'Pause'; }
  });
  $('btn-coach-reset').addEventListener('click', () => {
    if (state.coach && state.coach.engine) { state.coach.engine.reset(); $('reps').textContent = '0'; setCue('Reset · ready', 'good'); }
  });
  $('btn-coach-end').addEventListener('click', endCoachSet);
  $('btn-calib-skip').addEventListener('click', () => { if (state.coach) finishCoachCalibration(); });

  $('btn-rest-add').addEventListener('click', () => { state.rest.endsAt += 15000; });
  $('btn-rest-skip').addEventListener('click', endRest);

  $('btn-export').addEventListener('click', exportJSON);
  $('btn-summary-export').addEventListener('click', exportJSON);
  $('btn-summary-done').addEventListener('click', () => { showScreen(null); setTab('home'); });

  $('btn-settings').addEventListener('click', openSettings);
  $('btn-settings-close').addEventListener('click', closeSettings);
  wireSettings();

  const inst = $('btn-install');
  if (inst) inst.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null;
    installReady = false; refreshInstallBanner();
  });
  const dismissInstall = $('btn-install-close');
  if (dismissInstall) dismissInstall.addEventListener('click', () => {
    installReady = false; refreshInstallBanner();
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[app] SW register failed', e));
  }
}

// Minimal custom-routine builder: name → pick exercises → save.
function createRoutineFlow() {
  const name = prompt('New routine name?', 'My routine');
  if (name == null) return;
  const picked = [];
  const addNext = () => openPicker('routine', (id) => {
    picked.push({ exerciseId: id, targetSets: 3, targetReps: 8, targetRestSec: 120 });
    if (confirm(`Added ${catalogName(id)}. Add another exercise?`)) addNext();
    else {
      const routine = makeRoutine({ id: `r-${now().toString(36)}`, name, exercises: picked });
      saveRoutine(routine);
      state.routines = loadRoutines();
      showScreen(null);
      setTab('routines');
    }
  });
  addNext();
}

function boot() {
  // one-time, idempotent v1 → v2 migration
  try { ensureMigrated(now); } catch (e) { console.warn('[app] migration skipped', e); }
  state.history = loadWorkouts();
  state.routines = loadRoutines();
  state.settings = loadSettings();

  wireEvents();
  setTab('home');
  showScreen(null);

  // resume a workout interrupted by a refresh / tab kill / crash
  const active = loadActiveWorkout();
  if (active) {
    state.workout = makeWorkout(active);
    openWorkout();
    setStatus('workout resumed');
  }

  // preload the pose model in the background; failure is non-fatal
  initPose();

  window.__formCoachReady = true;
  document.body.dataset.ready = 'true';
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
