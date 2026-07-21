// Browser-only persistence: session history + per-exercise calibration in
// localStorage. Everything degrades gracefully if storage is unavailable
// (private mode, quota) — the app keeps working, it just doesn't remember.

const HISTORY_KEY = 'janai.formcoach.history.v1';
const CALIB_KEY = 'janai.formcoach.calibration.v1';
const HISTORY_LIMIT = 200;

function safeParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function loadHistory() {
  try {
    const arr = safeParse(localStorage.getItem(HISTORY_KEY), []);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveSession(sessionObj) {
  try {
    const hist = loadHistory();
    hist.unshift(sessionObj);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, HISTORY_LIMIT)));
    return true;
  } catch {
    return false;
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadCalibration(exerciseId) {
  try {
    const all = safeParse(localStorage.getItem(CALIB_KEY), {});
    return all[exerciseId] || null;
  } catch {
    return null;
  }
}

export function saveCalibration(exerciseId, calib) {
  try {
    const all = safeParse(localStorage.getItem(CALIB_KEY), {});
    all[exerciseId] = calib;
    localStorage.setItem(CALIB_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}
