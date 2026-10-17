// Synthetic fixtures only — round, made-up numbers. Never real workout data.
import { makeWorkout } from '../../js/engine/workout.js';

const DAY = 86400000;
export const T0 = Date.UTC(2030, 0, 1, 9, 0, 0); // fixed synthetic epoch

export function done(weight, reps, extra = {}) { return { weight, reps, completed: true, ...extra }; }
export function todo(weight, reps, extra = {}) { return { weight, reps, completed: false, ...extra }; }

export function workout(id, dayOffset, exercises, extra = {}) {
  const startedAtMs = T0 + dayOffset * DAY;
  return makeWorkout({ id, title: `W ${id}`, startedAtMs, endedAtMs: startedAtMs + 3600000, exercises, ...extra });
}
export { DAY };
