// Routines — templates that seed a workout. Pure, serializable, no DOM.
//
// A Routine is a named, ordered set of RoutineExercises with target sets/reps/
// rest. Routines are optional: you can also start an empty workout or repeat the
// last one. The flagship built-in is an "Occam-style A/B" split.
//
// ⚠️ HONESTY: the Occam-style routine is *inspired by a secondary-source
// interpretation* of Occam's Protocol (Tim Ferriss, "The 4-Hour Body"). It is
// NOT medical truth and NOT verified against the primary book. The numbers
// (7 upper / 10 legs, 5/5 cadence, ~180 s rest, +load progression) are
// corroborated across secondary write-ups only. Presented as a preset, with a
// disclaimer, never as clinical advice.

import { makeWorkout } from './workout.js';

export const OCCAM_DISCLAIMER =
  'Inspired by a secondary-source interpretation of Occam\'s Protocol (Tim Ferriss, "The 4-Hour Body"). ' +
  'A popular minimalist hypertrophy idea — not medical advice, and not verified against the original book. ' +
  'Practical dumbbell substitutions are used. One hard set to failure, 5 s up / 5 s down, ~3 min rest.';

// The built-in Occam-style A/B routine, using practical gym substitutions.
// A = shoulder press + one-arm DB row ; B = bench press + goblet squat.
export const OCCAM_ROUTINE = Object.freeze({
  id: 'occam-ab',
  name: 'Occam-style A/B',
  builtin: true,
  source: 'Occam\'s Protocol (secondary-source interpretation)',
  disclaimer: OCCAM_DISCLAIMER,
  cadenceTargetSec: { up: 5, down: 5, total: 10 },
  defaultRestSec: 180,
  days: [
    {
      key: 'A',
      name: 'Day A · press + pull',
      exercises: [
        { exerciseId: 'shoulder-press', targetSets: 1, targetReps: 7, targetRestSec: 180 },
        { exerciseId: 'db-row', targetSets: 1, targetReps: 7, targetRestSec: 180 },
      ],
    },
    {
      key: 'B',
      name: 'Day B · press + squat',
      exercises: [
        { exerciseId: 'bench-press', targetSets: 1, targetReps: 7, targetRestSec: 180 },
        { exerciseId: 'goblet-squat', targetSets: 1, targetReps: 10, targetRestSec: 180 },
      ],
    },
  ],
});

// Os's live Hevy routine, copied on 22 Jul 2026. Keep the per-set templates
// intact rather than collapsing them to one target weight/reps pair.
export const OS_FULL_BODY_ROUTINE = Object.freeze({
  id: 'os-full-body',
  name: 'Os’ Full Body',
  builtin: true,
  source: 'Hevy · Full Body Occam Dumbbells',
  defaultRestSec: 120,
  days: [{
    key: 'A',
    name: 'Full workout',
    exercises: [
      { exerciseId: 'bench-press', sets: [{ weight: 52, reps: 12 }, { weight: 52, reps: 12 }, { weight: 52, reps: 12 }] },
      { exerciseId: 'goblet-squat', sets: [{ weight: 26, reps: 12 }, { weight: 26, reps: 12 }, { weight: 26, reps: 12 }] },
      { exerciseId: 'shoulder-press', sets: [{ weight: 36, reps: 12 }, { weight: 36, reps: 12 }, { weight: 36, reps: 12 }] },
      { exerciseId: 'db-row', sets: [{ weight: 20, reps: 12 }, { weight: 20, reps: 12 }, { weight: 20, reps: 12 }] },
      { exerciseId: 'skull-crusher', sets: [{ weight: 16, reps: 12 }, { weight: 16, reps: 12 }, { weight: 16, reps: 12 }] },
      { exerciseId: 'bicep-curl', sets: [{ weight: 10, reps: 12 }, { weight: 10, reps: 12 }, { weight: 10, reps: 12 }] },
      { exerciseId: 'cable-twist', sets: [{ weight: 16.5, reps: 12 }, { weight: 16.25, reps: 12 }, { weight: 16.25, reps: 12 }] },
      { exerciseId: 'triceps-pushdown', sets: [{ weight: 18, reps: 12 }, { weight: 18, reps: 12 }, { weight: 18, reps: 12 }] },
      { exerciseId: 'split-squat', sets: [{ weight: 24, reps: 12 }, { weight: 24, reps: 12 }, { weight: 24, reps: 12 }] },
    ],
  }],
});

// ── Knee-rehab (PFPS / "runner's knee") routines, added 2026-07-24 ───────────
// Built for Os's anterior knee pain (worse up stairs, +theatre sign, no tendon
// point-tenderness → patellofemoral pain syndrome). Follows the 2019 PFP
// consensus (BJSM): combined hip + knee strengthening, first-line. Two phases
// run sequentially (each ~2 weeks), not alternating A/B.
const KNEE_REHAB_DISCLAIMER =
  'Runner\'s-knee (PFPS) rehab — general strengthening, not medical advice. ' +
  'Keep pain ≤2/10 during and no worse the next morning. Stop and see a sports ' +
  'physio if pain goes above ~4/10, or you get swelling, locking, or giving-way. ' +
  'Wall sit / Spanish squat / balance are timed holds (reps = seconds).';

export const KNEE_REHAB_PHASE1 = Object.freeze({
  id: 'knee-rehab-1',
  name: 'Knee Rehab · Phase 1 (Wk 1–2)',
  builtin: true,
  source: 'PFPS rehab — calm-down + hip/quad base (2019 PFP consensus, BJSM)',
  disclaimer: KNEE_REHAB_DISCLAIMER,
  defaultRestSec: 60,
  days: [{
    key: 'A',
    name: 'Calm-down + base · 3×/week',
    exercises: [
      { exerciseId: 'hevy-cda23948', targetSets: 3, targetReps: 12, targetRestSec: 60 }, // Glute Bridge
      { exerciseId: 'hevy-cc016611', targetSets: 3, targetReps: 15, targetRestSec: 45 }, // Clamshell
      { exerciseId: 'hevy-dc59d143', targetSets: 3, targetReps: 15, targetRestSec: 45 }, // Lateral Leg Raises
      { exerciseId: 'hevy-ec02979e', targetSets: 3, targetReps: 15, targetRestSec: 45 }, // Lateral Band Walks
      { exerciseId: 'straight-leg-raise', targetSets: 3, targetReps: 12, targetRestSec: 45 },
      { exerciseId: 'hevy-c8706c80', targetSets: 3, targetReps: 30, targetRestSec: 60 }, // Wall Sit (sec)
      { exerciseId: 'calf-raise', targetSets: 3, targetReps: 15, targetRestSec: 45 },
    ],
  }],
});

export const KNEE_REHAB_PHASE2 = Object.freeze({
  id: 'knee-rehab-2',
  name: 'Knee Rehab · Phase 2 (Wk 3–4)',
  builtin: true,
  source: 'PFPS rehab — progressive knee loading',
  disclaimer: KNEE_REHAB_DISCLAIMER,
  defaultRestSec: 60,
  days: [{
    key: 'A',
    name: 'Progressive knee load · 3×/week',
    exercises: [
      { exerciseId: 'step-down', targetSets: 3, targetReps: 10, targetRestSec: 60 }, // eccentric — key lift
      { exerciseId: 'spanish-squat', targetSets: 3, targetReps: 30, targetRestSec: 60 }, // sec hold
      { exerciseId: 'hevy-c284d923', targetSets: 3, targetReps: 8, targetRestSec: 60 }, // Reverse Lunge
      { exerciseId: 'split-squat', targetSets: 3, targetReps: 8, targetRestSec: 60 },
      { exerciseId: 'single-leg-balance', targetSets: 3, targetReps: 30, targetRestSec: 30 }, // sec
      { exerciseId: 'hevy-cda23948', targetSets: 3, targetReps: 12, targetRestSec: 45 }, // Glute Bridge (carry-over)
      { exerciseId: 'hevy-ec02979e', targetSets: 3, targetReps: 15, targetRestSec: 45 }, // Band Walks (carry-over)
    ],
  }],
});

export const BUILTIN_ROUTINES = [OS_FULL_BODY_ROUTINE, OCCAM_ROUTINE, KNEE_REHAB_PHASE1, KNEE_REHAB_PHASE2];

/** Normalise a (possibly user-authored) routine into the canonical shape. */
export function makeRoutine(partial = {}) {
  const days = (partial.days || []).map((d, i) => ({
    key: d.key || String.fromCharCode(65 + i),
    name: d.name || `Day ${String.fromCharCode(65 + i)}`,
    exercises: (d.exercises || []).map(normaliseRoutineExercise),
  }));
  // allow a flat single-day routine via `exercises`
  if (!days.length && Array.isArray(partial.exercises)) {
    days.push({ key: 'A', name: partial.name || 'Day A', exercises: partial.exercises.map(normaliseRoutineExercise) });
  }
  return {
    id: partial.id || null,
    name: partial.name || 'Custom routine',
    builtin: !!partial.builtin,
    disclaimer: partial.disclaimer || null,
    cadenceTargetSec: partial.cadenceTargetSec || null,
    defaultRestSec: partial.defaultRestSec || 120,
    days,
  };
}

function normaliseRoutineExercise(re) {
  const sets = Array.isArray(re.sets) && re.sets.length
    ? re.sets.map((s) => ({
      weight: s.weight == null ? null : Number(s.weight),
      reps: s.reps == null ? 0 : Math.max(0, Math.round(s.reps)),
      type: s.type || 'normal',
    }))
    : null;
  return {
    exerciseId: re.exerciseId,
    targetSets: sets ? sets.length : Math.max(1, Math.round(re.targetSets || 1)),
    targetReps: re.targetReps == null ? null : Math.max(1, Math.round(re.targetReps)),
    targetRestSec: re.targetRestSec == null ? null : Math.max(0, Math.round(re.targetRestSec)),
    sets,
  };
}

export function getRoutineDay(routine, dayKey) {
  if (!routine || !routine.days || !routine.days.length) return null;
  if (dayKey == null) return routine.days[0];
  return routine.days.find((d) => d.key === dayKey) || routine.days[0];
}

/**
 * Seed a Workout from a routine day. Creates `targetSets` empty (uncompleted)
 * sets per exercise so the user just fills weight and checks them off. Pure —
 * caller injects id + startedAtMs (no hidden clock).
 */
export function routineToWorkout(routine, dayKey, { id = null, startedAtMs = null } = {}) {
  const day = getRoutineDay(routine, dayKey);
  const exercises = (day ? day.exercises : []).map((re) => ({
    exerciseId: re.exerciseId,
    sets: (Array.isArray(re.sets) && re.sets.length
      ? re.sets
      : Array.from({ length: re.targetSets || 1 }, () => ({ weight: null, reps: re.targetReps || 0 })))
      .map((template) => ({
      weight: template.weight ?? null,
      reps: template.reps || 0,
      type: template.type || 'normal',
      rpe: null,
      completed: false,
      source: 'manual',
      side: null,
      camera: null,
    })),
  }));
  return makeWorkout({
    id,
    title: day ? `${routine.name} · ${day.name}` : routine.name,
    startedAtMs,
    routineId: routine.id,
    exercises,
  });
}

/**
 * Derive a reusable routine template from a performed workout ("save current
 * workout as routine"). Targets come from the completed sets. Pure.
 */
export function workoutToRoutine(workout, { id = null, name = null } = {}) {
  const exercises = (workout.exercises || []).map((ex) => {
    const done = (ex.sets || []).filter((s) => s.completed);
    const reps = done.length ? Math.max(...done.map((s) => s.reps || 0)) : (ex.sets[0] ? ex.sets[0].reps : null);
    return {
      exerciseId: ex.exerciseId,
      targetSets: Math.max(1, (ex.sets || []).length),
      targetReps: reps || null,
      targetRestSec: null,
    };
  });
  return makeRoutine({
    id,
    name: name || workout.title || 'Saved routine',
    days: [{ key: 'A', name: 'Day A', exercises }],
  });
}

/**
 * "Repeat last": clone a workout's structure with fresh, uncompleted sets that
 * carry the previous weights forward as a starting point. Pure — caller injects
 * id + startedAtMs.
 */
export function repeatWorkout(lastWorkout, { id = null, startedAtMs = null } = {}) {
  const exercises = (lastWorkout.exercises || []).map((ex) => ({
    exerciseId: ex.exerciseId,
    sets: (ex.sets && ex.sets.length ? ex.sets : [{}]).map((s) => ({
      weight: s.weight ?? null,
      reps: s.reps || 0,
      type: s.type || 'normal',
      rpe: null,
      completed: false,
      source: 'manual',
      side: s.side || null,
      camera: null,
    })),
  }));
  return makeWorkout({
    id,
    title: lastWorkout.title || 'Workout',
    startedAtMs,
    routineId: lastWorkout.routineId || null,
    exercises,
  });
}
