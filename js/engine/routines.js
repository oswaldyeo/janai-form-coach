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

export const BUILTIN_ROUTINES = [OCCAM_ROUTINE];

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
  return {
    exerciseId: re.exerciseId,
    targetSets: Math.max(1, Math.round(re.targetSets || 1)),
    targetReps: re.targetReps == null ? null : Math.max(1, Math.round(re.targetReps)),
    targetRestSec: re.targetRestSec == null ? null : Math.max(0, Math.round(re.targetRestSec)),
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
    sets: Array.from({ length: re.targetSets || 1 }, () => ({
      weight: null,
      reps: 0,
      type: 'normal',
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
