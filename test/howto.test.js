import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getHowto } from '../js/engine/howto.js';
import { BUILTIN_ROUTINES } from '../js/engine/routines.js';
import { generateWOD } from '../js/engine/wod.js';
import { CATALOG_LIST } from '../js/engine/catalog.js';

const KNEE_REHAB_IDS = [
  'hevy-cda23948',
  'hevy-cc016611',
  'hevy-dc59d143',
  'hevy-ec02979e',
  'straight-leg-raise',
  'hevy-c8706c80',
  'calf-raise',
  'step-down',
  'spanish-squat',
  'hevy-c284d923',
  'split-squat',
  'single-leg-balance',
];

test('every Knee Rehab exercise has authored how-to with at least three steps', () => {
  for (const id of KNEE_REHAB_IDS) {
    const howto = getHowto(id);
    assert.ok(howto, `${id} is missing how-to`);
    assert.ok(howto.steps.length >= 3, `${id} needs at least three steps`);
    assert.ok(howto.cues, `${id} is missing form cues`);
  }
});

test('every exercise in every built-in workout has authored how-to guidance', () => {
  const ids = new Set(BUILTIN_ROUTINES.flatMap((routine) =>
    routine.days.flatMap((day) => day.exercises.map((exercise) => exercise.exerciseId))));
  for (const id of ids) {
    const howto = getHowto(id);
    assert.ok(howto, `${id} is missing how-to guidance`);
    assert.ok(howto.steps.length >= 3, `${id} has fewer than three steps`);
    assert.ok(howto.cues && howto.cues.trim(), `${id} has no form cues`);
    assert.equal(howto.images.length, 2, `${id} needs two accurate visual frames`);
    assert.ok(howto.visualSource, `${id} is missing visual provenance`);
  }
});

test('every exercise in the complete catalog has authored how-to guidance', () => {
  assert.equal(CATALOG_LIST.length, 455, 'catalog size changed — refresh full-catalog research');
  for (const exercise of CATALOG_LIST) {
    const howto = getHowto(exercise.id);
    assert.ok(howto, `${exercise.id} (${exercise.name}) is missing how-to guidance`);
    assert.ok(howto.steps.length >= 3 && howto.steps.length <= 6, `${exercise.id} needs 3-6 steps`);
    assert.ok(howto.cues && howto.cues.trim(), `${exercise.id} has no form cues`);
  }
});

test('every exercise the Workout of the Day can select has authored guidance', () => {
  const ids = new Set();
  for (let variant = 0; variant < 24; variant += 1) {
    const { workout } = generateWOD({ nowMs: 1_800_000_000_000, variant });
    workout.exercises.forEach((exercise) => ids.add(exercise.exerciseId));
  }
  for (const id of ids) {
    assert.ok(getHowto(id), `${id} can appear in WOD but has no how-to guidance`);
  }
});

test('every referenced how-to image exists locally', async () => {
  for (const howto of Object.values((await import('../js/engine/howto.js')).HOWTO_BY_ID)) {
    for (const image of howto.images) {
      assert.match(image, /^\.\/assets\/howto\/(?:library\/[^/]+-[0-9a-f]{10}\/[01]\.(?:jpg|png)|original\/[^/]+\/[01]\.svg|[^/]+\/[01]\.(?:jpg|png))$/);
      const file = fileURLToPath(new URL(`../${image.slice(2)}`, import.meta.url));
      await assert.doesNotReject(access(file), `${image} does not exist`);
    }
  }
});

test('verified visuals and reviewed replacements remain in the offline core manifest', async () => {
  const manifestFile = fileURLToPath(new URL('../assets/howto/offline-core.json', import.meta.url));
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const howtos = (await import('../js/engine/howto.js')).HOWTO_BY_ID;
  const referenced = new Set(Object.values(howtos).flatMap((howto) => howto.images));
  const legacyAndOriginal = [...referenced].filter((image) => !image.includes('/library/'));
  for (const image of legacyAndOriginal) assert.ok(manifest.includes(image), `${image} lost offline coverage`);
  for (const image of howtos['hevy-cda23948'].images) assert.ok(manifest.includes(image), `${image} replacement is not offline-ready`);
  for (const image of manifest) assert.ok(referenced.has(image), `${image} is stale in the offline manifest`);
});

test('unknown exercises have no how-to', () => {
  assert.equal(getHowto('not-an-exercise'), null);
});
