import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG_LIST, getCatalogEntry, hasCamera, isExperimentalCamera,
  cameraExercises, searchCatalog, MUSCLES, EQUIPMENT,
} from '../js/engine/catalog.js';
import { getExercise } from '../js/engine/exercises.js';

test('every catalog id is unique and resolves', () => {
  const ids = CATALOG_LIST.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const id of ids) assert.ok(getCatalogEntry(id), `resolves ${id}`);
});

test('catalog covers v1 lifts plus every requested v2 exercise', () => {
  const required = [
    'squat', 'pushup', 'lunge', 'bicep-curl', 'shoulder-press',
    'bench-press', 'goblet-squat', 'shoulder-press', 'db-row',
    'skull-crusher', 'cable-twist', 'triceps-pushdown',
  ];
  for (const id of required) assert.ok(getCatalogEntry(id), `catalog has ${id}`);
});

test('catalog mirrors all 451 official Hevy templates without duplicating local camera lifts', () => {
  // 22 local entries (18 original + 4 knee-rehab additions) + 433 imported Hevy = 455.
  assert.equal(CATALOG_LIST.length, 455);
  const imported = CATALOG_LIST.filter((e) => e.hevyId);
  assert.equal(imported.length, 433);
  assert.ok(imported.every((e) => e.camera == null), 'Hevy imports are manual-only');
  assert.ok(getCatalogEntry('hevy-79d0bb3a'), 'barbell bench press imported');
  assert.ok(getCatalogEntry('bench-press'), 'local camera dumbbell bench retained');
});

test('every entry uses the complete Hevy muscle and equipment taxonomies', () => {
  for (const e of CATALOG_LIST) {
    assert.ok(MUSCLES.includes(e.primaryMuscle), `${e.id} muscle ${e.primaryMuscle}`);
    assert.ok(EQUIPMENT.includes(e.equipment), `${e.id} equipment ${e.equipment}`);
  }
  assert.equal(MUSCLES.length, 20);
  assert.equal(EQUIPMENT.length, 9);
});

test('every camera-capable exercise has a biomech implementation with the full contract', () => {
  for (const e of CATALOG_LIST) {
    if (!hasCamera(e)) continue;
    const impl = getExercise(e.id);
    assert.ok(impl, `${e.id} (autoCount=${e.camera.autoCount}) has a biomech impl`);
    assert.equal(typeof impl.measure, 'function', `${e.id}.measure`);
    assert.equal(typeof impl.progressFrom, 'function', `${e.id}.progressFrom`);
    assert.equal(typeof impl.coach, 'function', `${e.id}.coach`);
    assert.equal(typeof impl.peakIsLow, 'boolean', `${e.id}.peakIsLow`);
    assert.ok(impl.defaults && typeof impl.defaults.restAngle === 'number', `${e.id}.defaults`);
  }
});

test('manual-only exercises need no biomech implementation', () => {
  for (const e of CATALOG_LIST) {
    if (hasCamera(e)) continue;
    // manual-only lifts either omit the camera block or mark it none
    assert.ok(!e.camera || e.camera.autoCount === 'none', `${e.id} is manual-only`);
    // they are still first-class catalog entries with load metadata
    assert.ok(e.loadType, `${e.id} has a loadType`);
  }
});

test('cable-twist is manual-only (no 2D-camera pretence)', () => {
  const ct = getCatalogEntry('cable-twist');
  assert.equal(ct.camera, null);
  assert.equal(hasCamera('cable-twist'), false);
});

test('db-row is flagged experimental; goblet-squat is not', () => {
  assert.equal(isExperimentalCamera('db-row'), true);
  assert.equal(isExperimentalCamera('goblet-squat'), false);
});

test('cameraExercises returns only camera-capable entries', () => {
  const cam = cameraExercises();
  assert.ok(cam.length >= 10, 'at least the v1 five plus new camera lifts');
  for (const e of cam) assert.ok(hasCamera(e));
  assert.ok(!cam.some((e) => e.id === 'cable-twist'));
});

test('every camera entry declares an honest confidence + view', () => {
  for (const e of cameraExercises()) {
    assert.ok(['high', 'medium', 'low'].includes(e.camera.confidence), `${e.id} confidence`);
    assert.ok(['side', 'front'].includes(e.camera.view), `${e.id} view`);
    assert.ok(typeof e.camera.placement === 'string' && e.camera.placement.length, `${e.id} placement`);
  }
});

test('searchCatalog filters by query, muscle and equipment', () => {
  assert.ok(searchCatalog({ query: 'bench' }).some((e) => e.id === 'bench-press'));
  assert.ok(searchCatalog({ muscle: 'triceps' }).every((e) => e.primaryMuscle === 'triceps' || e.secondaryMuscles.includes('triceps')));
  assert.ok(searchCatalog({ equipment: 'machine' }).every((e) => e.equipment === 'machine'));
  assert.equal(searchCatalog({ query: 'zzznope' }).length, 0);
});

test('searchCatalog treats muscle and equipment as independent, intersecting axes', () => {
  // The picker sets muscle and equipment on separate chip rows; a result must
  // satisfy BOTH constraints, and each axis on its own must be a superset.
  const both = searchCatalog({ muscle: 'triceps', equipment: 'dumbbell' });
  for (const e of both) {
    assert.ok(e.primaryMuscle === 'triceps' || e.secondaryMuscles.includes('triceps'), `${e.id} matches muscle`);
    assert.equal(e.equipment, 'dumbbell', `${e.id} matches equipment`);
  }
  const muscleOnly = searchCatalog({ muscle: 'triceps' });
  const equipOnly = searchCatalog({ equipment: 'dumbbell' });
  assert.ok(both.length <= muscleOnly.length && both.length <= equipOnly.length, 'intersection is no larger than either axis');
  // skull-crusher is a dumbbell triceps lift → present in all three sets
  assert.ok(both.some((e) => e.id === 'skull-crusher'));
});
