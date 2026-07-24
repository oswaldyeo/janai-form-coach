// Exercise catalog — pure DATA. No DOM, no browser APIs.
//
// The catalog is the serializable registry of exercise *definitions*: tracking
// metadata (for Hevy-style logging) plus an optional `camera` capability block
// describing whether — and how honestly — the on-device camera coach can track
// the lift. The biomechanics themselves (measure/progressFrom/coach) are CODE
// and live in exercises.js, keyed by the same id. A catalog entry with a
// `camera` block whose autoCount !== 'none' MUST have a biomech implementation;
// a manual-only lift simply has `camera: null` (or autoCount 'none').
//
// camera block shape:
//   autoCount   'reliable' | 'proxy' | 'none'   how much to trust auto rep counts
//   confidence  'high' | 'medium' | 'low'       honesty signal surfaced in the UI
//   view        'side' | 'front'                camera placement
//   formChecks  string[]                        what the coach() cue watches
//   placement   string                          human placement guide
//   notes       string                          caveats (occlusion etc.)
//   experimental bool                           label the coach "experimental"

import { HEVY_CATALOG } from './hevy-catalog.js';

// Hevy's public template taxonomy. Keep these raw keys stable so refreshes are
// deterministic and the picker behaves like Hevy's muscle/equipment filters.
export const MUSCLES = ['abdominals', 'abductors', 'adductors', 'biceps', 'calves', 'cardio', 'chest', 'forearms', 'full_body', 'glutes', 'hamstrings', 'lats', 'lower_back', 'neck', 'other', 'quadriceps', 'shoulders', 'traps', 'triceps', 'upper_back'];
export const EQUIPMENT = ['barbell', 'dumbbell', 'kettlebell', 'machine', 'none', 'other', 'plate', 'resistance_band', 'suspension'];
export const CATEGORIES = ['push', 'pull', 'legs', 'core', 'cardio', 'other'];

const LOCAL_CATALOG = [
  // ── v1 lifts (bodyweight + dumbbell) ──────────────────────────────────────
  {
    id: 'squat', name: 'Squat (bodyweight)', category: 'legs', equipment: 'none',
    primaryMuscle: 'quadriceps', secondaryMuscles: ['glutes', 'hamstrings'],
    loadType: 'bodyweight', unilateral: false, defaultRestSec: 90,
    camera: { autoCount: 'reliable', confidence: 'high', view: 'side', formChecks: ['depth', 'torso-lean'], placement: 'Side-on, hip height, full body in frame.', notes: '' },
  },
  {
    id: 'pushup', name: 'Push-up', category: 'push', equipment: 'none',
    primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'],
    loadType: 'bodyweight', unilateral: false, defaultRestSec: 90,
    camera: { autoCount: 'reliable', confidence: 'high', view: 'side', formChecks: ['body-line', 'depth'], placement: 'Side-on, whole body in a straight plank.', notes: '' },
  },
  {
    id: 'lunge', name: 'Alternating lunge', category: 'legs', equipment: 'none',
    primaryMuscle: 'quadriceps', secondaryMuscles: ['glutes'],
    loadType: 'bodyweight', unilateral: false, defaultRestSec: 90,
    camera: { autoCount: 'reliable', confidence: 'medium', view: 'front', formChecks: ['depth', 'torso-tall'], placement: 'Face the camera, full body in frame.', notes: 'Alternates working leg automatically.' },
  },
  {
    id: 'bicep-curl', name: 'Bicep curl', category: 'pull', equipment: 'dumbbell',
    primaryMuscle: 'biceps', secondaryMuscles: [],
    loadType: 'external', unilateral: false, defaultRestSec: 90,
    camera: { autoCount: 'reliable', confidence: 'high', view: 'front', formChecks: ['pin-elbow'], placement: 'Face the camera, upper body in frame.', notes: '' },
  },
  {
    id: 'shoulder-press', name: 'Shoulder press', category: 'push', equipment: 'dumbbell',
    primaryMuscle: 'shoulders', secondaryMuscles: ['triceps'],
    loadType: 'external', unilateral: false, defaultRestSec: 120,
    camera: { autoCount: 'reliable', confidence: 'high', view: 'front', formChecks: ['overhead-lockout'], placement: 'Face the camera, upper body in frame.', notes: '' },
  },

  // ── requested new camera lifts ────────────────────────────────────────────
  {
    id: 'goblet-squat', name: 'Goblet squat', category: 'legs', equipment: 'dumbbell',
    primaryMuscle: 'quadriceps', secondaryMuscles: ['glutes', 'abdominals'],
    loadType: 'external', unilateral: false, defaultRestSec: 120,
    camera: { autoCount: 'reliable', confidence: 'high', view: 'side', formChecks: ['depth', 'torso-lean'], placement: 'Side-on, hip height, full body in frame.', notes: 'Goblet load barely occludes the legs — tracks like a bodyweight squat.' },
  },
  {
    id: 'bench-press', name: 'Bench press (dumbbell)', category: 'push', equipment: 'dumbbell',
    primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'],
    loadType: 'external', unilateral: false, defaultRestSec: 180,
    camera: { autoCount: 'reliable', confidence: 'medium', view: 'side', formChecks: ['touch-depth', 'lockout'], placement: 'Side-on at bench level, ~2 m, working arm nearest the camera.', notes: 'Bench/rack can occlude the far arm; frame the near, working side.' },
  },
  {
    id: 'skull-crusher', name: 'Skull crusher (dumbbell)', category: 'push', equipment: 'dumbbell',
    primaryMuscle: 'triceps', secondaryMuscles: [],
    loadType: 'external', unilateral: false, defaultRestSec: 120,
    camera: { autoCount: 'reliable', confidence: 'medium', view: 'side', formChecks: ['upper-arm-stability'], placement: 'Side-on at bench level, track the near arm.', notes: 'The near arm occludes the far one — the coach counts the near arm.' },
  },
  {
    id: 'triceps-pushdown', name: 'Triceps pushdown', category: 'push', equipment: 'machine',
    primaryMuscle: 'triceps', secondaryMuscles: [],
    loadType: 'external', unilateral: false, defaultRestSec: 90,
    camera: { autoCount: 'reliable', confidence: 'medium', view: 'side', formChecks: ['pin-elbow'], placement: 'Side-on, working arm toward the camera, clear of the stack.', notes: 'Keep the cable stack out of frame to avoid occlusion.' },
  },
  {
    id: 'db-row', name: 'One-arm DB row', category: 'pull', equipment: 'dumbbell',
    primaryMuscle: 'upper_back', secondaryMuscles: ['biceps', 'lats'],
    loadType: 'external', unilateral: true, defaultRestSec: 120,
    camera: { autoCount: 'proxy', confidence: 'low', view: 'side', formChecks: ['flat-back'], placement: 'Side-on to the working side, low angle.', notes: 'The working elbow hides behind the torso at the top — counts are noisy.', experimental: true },
  },
  {
    id: 'cable-twist', name: 'Cable twist / woodchop', category: 'core', equipment: 'machine',
    primaryMuscle: 'abdominals', secondaryMuscles: ['shoulders'],
    loadType: 'external', unilateral: true, defaultRestSec: 60,
    camera: null, // rotation about the vertical axis is invisible to a 2D camera — manual only.
  },

  // ── additional manually-tracked foundational lifts (no camera pretence) ────
  {
    id: 'lat-pulldown', name: 'Lat pulldown', category: 'pull', equipment: 'machine',
    primaryMuscle: 'lats', secondaryMuscles: ['biceps'],
    loadType: 'external', unilateral: false, defaultRestSec: 120, camera: null,
  },
  {
    id: 'leg-press', name: 'Leg press', category: 'legs', equipment: 'machine',
    primaryMuscle: 'quadriceps', secondaryMuscles: ['glutes', 'hamstrings'],
    loadType: 'external', unilateral: false, defaultRestSec: 120, camera: null,
  },
  {
    id: 'split-squat', name: 'Split squat (dumbbell)', category: 'legs', equipment: 'dumbbell',
    primaryMuscle: 'quadriceps', secondaryMuscles: ['glutes', 'hamstrings'],
    loadType: 'external', unilateral: true, defaultRestSec: 120, camera: null,
  },
  {
    id: 'romanian-deadlift', name: 'Romanian deadlift', category: 'pull', equipment: 'barbell',
    primaryMuscle: 'hamstrings', secondaryMuscles: ['glutes', 'lower_back'],
    loadType: 'external', unilateral: false, defaultRestSec: 180, camera: null,
  },
  {
    id: 'deadlift', name: 'Deadlift', category: 'pull', equipment: 'barbell',
    primaryMuscle: 'lower_back', secondaryMuscles: ['hamstrings', 'glutes', 'quadriceps'],
    loadType: 'external', unilateral: false, defaultRestSec: 180, camera: null,
  },
  {
    id: 'calf-raise', name: 'Calf raise', category: 'legs', equipment: 'machine',
    primaryMuscle: 'calves', secondaryMuscles: [],
    loadType: 'external', unilateral: false, defaultRestSec: 60, camera: null,
  },
  {
    id: 'plank', name: 'Plank (hold)', category: 'core', equipment: 'none',
    primaryMuscle: 'abdominals', secondaryMuscles: ['shoulders'],
    loadType: 'bodyweight', unilateral: false, defaultRestSec: 60, camera: null,
  },

  // ── knee-rehab (PFPS / runner's knee) additions — manual, bodyweight ───────
  // Added 2026-07-24 for the "Knee Rehab" routines. No camera pretence.
  {
    id: 'straight-leg-raise', name: 'Straight-Leg Raise', category: 'legs', equipment: 'none',
    primaryMuscle: 'quadriceps', secondaryMuscles: [],
    loadType: 'bodyweight', trackingType: 'reps_only', unilateral: true, defaultRestSec: 45, camera: null,
  },
  {
    id: 'step-down', name: 'Step-Down (eccentric)', category: 'legs', equipment: 'none',
    primaryMuscle: 'quadriceps', secondaryMuscles: ['glutes'],
    loadType: 'bodyweight', trackingType: 'reps_only', unilateral: true, defaultRestSec: 60, camera: null,
  },
  {
    id: 'spanish-squat', name: 'Spanish Squat (isometric hold)', category: 'legs', equipment: 'resistance_band',
    primaryMuscle: 'quadriceps', secondaryMuscles: ['glutes'],
    loadType: 'bodyweight', trackingType: 'duration', unilateral: false, defaultRestSec: 60, camera: null,
  },
  {
    id: 'single-leg-balance', name: 'Single-Leg Balance (hold)', category: 'legs', equipment: 'none',
    primaryMuscle: 'glutes', secondaryMuscles: ['quadriceps', 'calves'],
    loadType: 'bodyweight', trackingType: 'duration', unilateral: true, defaultRestSec: 30, camera: null,
  },
];

// These Hevy templates are represented by richer local entries above (stable
// IDs preserve old workout history and camera implementations). Every other
// official Hevy template is included as a manual-tracking exercise.
const HEVY_REPLACED_BY_LOCAL = new Set([
  '9694DA61', '392887AA', '5E1A7777', '37FCC2BB', '878CD1D0', '3D0C7C75',
  '3601968B', '68F8A292', '93A552C6', 'F1E57334', '92D858EA', '6A6C31A5',
  'C7973E0E', '20C1A3CB', '2B4B7310', 'C6272009', 'E05C2C38', 'C6C9B8A0',
]);

const CATALOG = [
  ...LOCAL_CATALOG,
  ...HEVY_CATALOG.filter((e) => !HEVY_REPLACED_BY_LOCAL.has(e.hevyId)),
];

const BY_ID = Object.freeze(CATALOG.reduce((m, e) => { m[e.id] = e; return m; }, {}));

export const CATALOG_LIST = CATALOG;
export const CATALOG_BY_ID = BY_ID;

export function getCatalogEntry(id) {
  return BY_ID[id] || null;
}

/** True when the exercise offers any camera coaching (auto or proxy). */
export function hasCamera(entryOrId) {
  const e = typeof entryOrId === 'string' ? getCatalogEntry(entryOrId) : entryOrId;
  return !!(e && e.camera && e.camera.autoCount && e.camera.autoCount !== 'none');
}

/** True when auto counts should be treated as experimental (proxy / low conf). */
export function isExperimentalCamera(entryOrId) {
  const e = typeof entryOrId === 'string' ? getCatalogEntry(entryOrId) : entryOrId;
  return !!(e && e.camera && (e.camera.experimental || e.camera.autoCount === 'proxy' || e.camera.confidence === 'low'));
}

/** All entries that expose a camera coach. */
export function cameraExercises() {
  return CATALOG.filter((e) => hasCamera(e));
}

/** Filter helper for the exercise picker. `q` matches name/muscle/equipment. */
export function searchCatalog({ query = '', muscle = null, equipment = null } = {}) {
  const q = query.trim().toLowerCase();
  return CATALOG.filter((e) => {
    if (muscle && e.primaryMuscle !== muscle && !e.secondaryMuscles.includes(muscle)) return false;
    if (equipment && e.equipment !== equipment) return false;
    if (!q) return true;
    return (
      e.name.toLowerCase().includes(q) ||
      e.primaryMuscle.includes(q) ||
      e.secondaryMuscles.some((m) => m.includes(q)) ||
      e.equipment.includes(q) ||
      e.category.includes(q) ||
      (e.trackingType || '').includes(q)
    );
  });
}
