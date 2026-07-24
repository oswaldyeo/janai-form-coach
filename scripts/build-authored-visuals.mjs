// Generate deterministic, original Form Coach diagrams for movements that have
// no faithful reusable public-library visual. Output is SVG so every line stays
// crisp offline and can be reviewed as source rather than opaque generated art.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets/howto/original');

const C = {
  ink: '#17212b', muted: '#536273', accent: '#ff334f', accent2: '#25a8a0',
  skin: '#f4c9a8', shirt: '#8fe0da', shorts: '#34495e', equipment: '#708090',
  floor: '#cfd7df', bg: '#f8fafc', white: '#fff',
};

const line = (x1,y1,x2,y2, cls='body') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`;
const joint = (x,y,r=8, fill=C.skin) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${C.ink}" stroke-width="5"/>`;
const head = (x,y,r=30) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${C.skin}" stroke="${C.ink}" stroke-width="7"/>`;
const torso = (points) => `<polygon points="${points}" fill="${C.shirt}" stroke="${C.ink}" stroke-width="8" stroke-linejoin="round"/>`;
const arrow = (d, color=C.accent) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" marker-end="url(#arrow)"/>`;
const band = (d) => `<path d="${d}" fill="none" stroke="${C.accent}" stroke-width="13" stroke-linecap="round" stroke-dasharray="20 10"/>`;
const floor = (y=525) => line(75,y,825,y,'floor');

function svg(title, phase, cue, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600" role="img" aria-labelledby="title desc">
<title id="title">${title} — ${phase}</title><desc id="desc">${cue}</desc>
<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="${C.accent}"/></marker></defs>
<style>
.body{stroke:${C.ink};stroke-width:15;stroke-linecap:round;stroke-linejoin:round}.limb2{stroke:${C.muted};stroke-width:12;stroke-linecap:round;stroke-linejoin:round}.working{stroke:${C.accent};stroke-width:16;stroke-linecap:round;stroke-linejoin:round}.floor{stroke:${C.floor};stroke-width:9;stroke-linecap:round}.equip{stroke:${C.equipment};stroke-width:12;stroke-linecap:round;stroke-linejoin:round}.cable{stroke:${C.accent2};stroke-width:8;stroke-linecap:round}.label{font:800 25px system-ui,sans-serif;letter-spacing:2px;fill:${C.accent}}.title{font:800 30px system-ui,sans-serif;fill:${C.ink}}.cue{font:600 22px system-ui,sans-serif;fill:${C.muted}}.small{font:700 19px system-ui,sans-serif;fill:${C.muted}}
</style>
<rect width="900" height="600" rx="28" fill="${C.bg}"/><text x="52" y="56" class="label">${phase.toUpperCase()}</text><text x="52" y="96" class="title">${title}</text><text x="52" y="570" class="cue">${cue}</text>${body}</svg>`;
}

const diagrams = {
  'cable-twist': [
    ['START', 'Arms long · hips face forward', `${floor()}${line(120,150,120,500,'equip')}${joint(120,210,13,C.accent2)}${head(480,205)}${torso('430,245 525,245 548,390 412,390')}${line(425,250,530,250,'cable')}${line(420,390,540,390,'cable')}${line(440,275,315,250)}${line(315,250,150,220)}${line(520,275,390,255,'limb2')}${line(390,255,150,220,'limb2')}${line(150,220,120,210,'cable')}${joint(150,220,10,C.accent2)}${line(440,390,410,510)}${line(520,390,550,510)}${arrow('M350 170 Q500 115 650 190')}`],
    ['FINISH', 'Rotate ribs; keep pelvis quiet', `${floor()}${line(120,150,120,500,'equip')}${joint(120,210,13,C.accent2)}${head(510,205)}${torso('445,280 565,220 578,390 442,390')}${line(445,280,565,220,'cable')}${line(440,390,580,390,'cable')}${line(475,275,600,245)}${line(600,245,730,260)}${line(545,255,650,255,'limb2')}${line(650,255,730,260,'limb2')}${line(730,260,120,210,'cable')}${joint(730,260,10,C.accent2)}${line(470,390,440,510)}${line(550,390,580,510)}${arrow('M360 170 Q520 95 690 190')}`],
  ],
  'hevy-cc016611': [
    ['START', 'Side-lying · hips stacked · feet together', `${floor()}<text x="650" y="180" class="small">SIDE-LYING</text>${head(220,405)}${torso('255,365 455,380 455,455 250,445')}${line(450,405,565,445)}${line(565,445,650,500)}${line(450,430,565,465,'limb2')}${line(565,465,650,500,'limb2')}${joint(650,500)}${band('M520 420 Q555 455 590 480')}`],
    ['FINISH', 'Open top knee; pelvis and feet stay still', `${floor()}<text x="650" y="180" class="small">SIDE-LYING</text>${head(220,405)}${torso('255,365 455,380 455,455 250,445')}${line(450,400,560,315)}${line(560,315,650,500)}${line(450,430,565,465,'limb2')}${line(565,465,650,500,'limb2')}${joint(650,500)}${band('M510 365 Q555 400 585 455')}${arrow('M560 425 Q620 370 575 300')}`],
  ],
  'hevy-ec02979e': [
    ['START', 'Band at ankles · knees softly bent', `${floor()}${head(450,170)}${torso('395,210 505,210 525,365 375,365')}${line(415,365,405,440)}${line(405,440,395,520)}${line(485,365,495,440)}${line(495,440,505,520)}${line(398,250,330,350,'limb2')}${line(502,250,570,350,'limb2')}${band('M385 485 Q450 500 515 485')}<text x="535" y="490" class="small">BAND</text>`],
    ['FINISH', 'Take a wide side step; knees track over toes', `${floor()}${head(470,170)}${torso('415,210 525,210 545,365 395,365')}${line(425,365,390,440)}${line(390,440,340,520)}${line(515,365,590,430)}${line(590,430,720,515)}${line(418,250,350,350,'limb2')}${line(522,250,590,350,'limb2')}${band('M330 485 Q525 500 730 480')}${arrow('M570 390 Q670 355 750 410')}`],
  ],
  'straight-leg-raise': [
    ['START', 'Brace quad; one knee bent', `${floor()}${head(190,455)}${torso('225,410 430,410 450,485 230,495')}${line(430,455,565,390)}${line(565,390,625,520)}${line(440,480,760,520,'working')}<text x="640" y="465" class="small">WORKING LEG</text>${arrow('M690 470 Q735 420 750 360')}`],
    ['FINISH', 'Lift the straight working leg; keep other knee bent', `${floor()}${head(190,455)}${torso('225,410 430,410 450,485 230,495')}${line(430,455,565,390)}${line(565,390,625,520)}${line(440,470,720,265,'working')}<text x="650" y="225" class="small">STRAIGHT</text>${arrow('M650 470 Q710 370 720 285')}`],
  ],
  'hevy-c8706c80': [
    ['START', 'Back flat to wall', `${floor()}${line(250,125,250,525,'equip')}${head(330,185)}${torso('270,220 370,220 385,365 270,365')}${line(330,365,440,425)}${line(440,425,520,515)}${line(280,365,350,455,'limb2')}${line(350,455,390,520,'limb2')}${arrow('M520 220 L520 340')}`],
    ['FINISH', 'Thighs level · knees over feet', `${floor()}${line(250,125,250,525,'equip')}${head(310,225)}${torso('265,260 355,260 365,405 265,405')}${line(330,405,500,405)}${line(500,405,500,520)}${line(285,405,440,420,'limb2')}${line(440,420,440,520,'limb2')}${joint(500,405)}${arrow('M600 270 L600 400')}`],
  ],
  'step-down': [
    ['START', 'Stand tall on the stance leg', `${line(180,405,620,405,'equip')}${line(180,405,180,525,'equip')}${line(620,405,620,525,'equip')}${floor()}${head(430,140)}${torso('380,180 480,180 490,330 370,330')}${line(405,330,405,405)}${line(405,405,365,405)}${line(465,330,520,395,'limb2')}${line(520,395,570,445,'limb2')}${line(385,220,330,320,'limb2')}${line(475,220,530,320,'limb2')}<text x="245" y="370" class="small">STANCE LEG →</text>`],
    ['FINISH', 'Bend stance knee; lower free heel slowly', `${line(180,405,620,405,'equip')}${line(180,405,180,525,'equip')}${line(620,405,620,525,'equip')}${floor()}${head(410,190)}${torso('360,230 460,230 480,365 350,365')}${line(385,365,455,405)}${line(455,405,410,405)}${line(445,365,530,430,'limb2')}${line(530,430,560,520,'limb2')}${line(365,270,320,355,'limb2')}${line(455,270,510,355,'limb2')}${arrow('M650 340 L650 500')}<text x="245" y="370" class="small">STANCE LEG →</text>`],
  ],
  'spanish-squat': [
    ['START', 'Band sits behind both knees', `${floor()}${line(120,260,120,510,'equip')}${joint(120,300,13,C.accent2)}${head(480,160)}${torso('430,200 530,200 545,350 415,350')}${line(445,350,425,430)}${line(425,430,400,520)}${line(515,350,535,430)}${line(535,430,560,520)}${band('M120 300 L440 375 M120 300 L515 375')}${arrow('M650 220 L650 350')}`],
    ['FINISH', 'Sit back; torso tall, shins stay vertical', `${floor()}${line(120,260,120,510,'equip')}${joint(120,300,13,C.accent2)}${head(460,230)}${torso('405,270 510,270 505,400 375,400')}${line(400,400,560,405)}${line(560,405,560,520)}${line(470,400,650,405,'limb2')}${line(650,405,650,520,'limb2')}${band('M120 300 L430 390 M120 300 L510 392')}${arrow('M720 250 L720 395')}<path d="M560 390 L560 525 M650 390 L650 525" stroke="${C.accent2}" stroke-width="5" stroke-dasharray="12 10"/><text x="535" y="365" class="small">VERTICAL SHINS</text>`],
  ],
  'single-leg-balance': [
    ['SETUP', 'Stand tall on two tripod feet', `${floor()}${head(450,145)}${torso('395,185 505,185 520,345 380,345')}${line(420,345,400,515)}${line(480,345,500,515,'limb2')}${line(395,225,375,355,'limb2')}${line(505,225,525,355,'limb2')}${joint(400,515)}${joint(500,515)}${arrow('M620 440 Q650 370 590 330')}`],
    ['HOLD', 'Lift one foot; keep pelvis level and still', `${floor()}${head(450,145)}${torso('395,185 505,185 520,345 380,345')}${line(430,345,430,515)}${line(485,345,550,390,'limb2')}${line(550,390,535,465,'limb2')}${line(395,225,285,285,'limb2')}${line(505,225,615,285,'limb2')}${joint(430,515)}${line(360,340,540,340,'cable')}<text x="565" y="345" class="small">PELVIS LEVEL</text>`],
  ],
};

await fs.mkdir(OUT, { recursive: true });
const manifest = {};
for (const [id, frames] of Object.entries(diagrams)) {
  const dir = path.join(OUT, id);
  await fs.mkdir(dir, { recursive: true });
  const images = [];
  for (const [index, [phase, cue, body]] of frames.entries()) {
    const rel = `./assets/howto/original/${id}/${index}.svg`;
    await fs.writeFile(path.join(ROOT, rel.slice(2)), svg(pretty(id), phase, cue, body));
    images.push(rel);
  }
  manifest[id] = {
    images,
    visualSource: {
      library: 'Form Coach original',
      exercise: 'Original movement diagram',
      url: null,
      license: 'Original artwork',
    },
  };
}
await fs.writeFile(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ exercises: Object.keys(diagrams).length, images: Object.keys(diagrams).length * 2 }, null, 2));

function pretty(id) {
  return ({
    'cable-twist': 'Cable Twist', 'hevy-cc016611': 'Clamshell',
    'hevy-ec02979e': 'Lateral Band Walk', 'straight-leg-raise': 'Straight-Leg Raise',
    'hevy-c8706c80': 'Wall Sit', 'step-down': 'Step-Down',
    'spanish-squat': 'Spanish Squat', 'single-leg-balance': 'Single-Leg Balance',
  })[id] || id;
}
