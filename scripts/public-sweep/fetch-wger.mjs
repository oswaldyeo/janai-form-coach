// Bulk-pull wger.de exercise images + English names + equipment/category.
// Join: image.exercise (numeric base id) -> translation name + exercise equipment.
// Output: .tmp/public-sweep/wger-db.json
import fs from 'fs';

const LICENSE = { 1: 'CC-BY-SA 3.0', 2: 'CC-BY-SA 4.0', 3: 'CC0 1.0', 4: 'CC-BY 4.0', 5: 'ODbL' };
const B = 'https://wger.de/api/v2';

async function getAll(url, cap = Infinity) {
  const out = [];
  let next = url;
  while (next && out.length < cap) {
    const r = await fetch(next, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${r.status} on ${next}`);
    const d = await r.json();
    out.push(...d.results);
    next = d.next;
  }
  return out;
}

console.error('fetching images...');
const images = await getAll(`${B}/exerciseimage/?format=json&limit=100`);
console.error(`  ${images.length} images`);

console.error('fetching English translations...');
const trans = await getAll(`${B}/exercise-translation/?format=json&limit=200&language=2`);
const nameById = {};
for (const t of trans) if (!nameById[t.exercise]) nameById[t.exercise] = t.name;
console.error(`  ${Object.keys(nameById).length} named base exercises`);

console.error('fetching equipment names...');
const equipName = Object.fromEntries((await getAll(`${B}/equipment/?format=json&limit=100`)).map(e => [e.id, e.name]));
console.error('fetching category names...');
const catName = Object.fromEntries((await getAll(`${B}/exercisecategory/?format=json&limit=100`)).map(c => [c.id, c.name]));

// Only need equipment/category for exercises that actually have images.
const exIds = [...new Set(images.map(im => im.exercise))];
console.error(`fetching ${exIds.length} exercise base records for equipment/category...`);
const exMeta = {};
for (const id of exIds) {
  try {
    const r = await fetch(`${B}/exercise/${id}/?format=json`, { headers: { Accept: 'application/json' } });
    if (r.ok) {
      const d = await r.json();
      exMeta[id] = { category: catName[d.category] || null, equipment: (d.equipment || []).map(e => equipName[e] || e) };
    }
  } catch { /* skip */ }
}

const byId = {};
for (const im of images) {
  if (!byId[im.exercise]) {
    byId[im.exercise] = {
      exerciseId: im.exercise,
      name: nameById[im.exercise] || null,
      category: exMeta[im.exercise]?.category || null,
      equipment: exMeta[im.exercise]?.equipment || [],
      images: [],
    };
  }
  byId[im.exercise].images.push({
    url: im.image,
    license: LICENSE[im.license] || `license-${im.license}`,
    licenseAuthor: im.license_author || '',
    is_main: im.is_main,
    is_ai: im.is_ai_generated,
    style: im.style,
  });
}

const all = Object.values(byId);
fs.writeFileSync('.tmp/public-sweep/wger-db.json', JSON.stringify(all, null, 2));
console.error(`\nwrote ${all.length} exercises WITH images`);
console.error(`  named: ${all.filter(r => r.name).length}, total images: ${all.reduce((n, r) => n + r.images.length, 0)}`);
console.error(`  with >=2 frames: ${all.filter(r => r.images.length >= 2).length}`);
