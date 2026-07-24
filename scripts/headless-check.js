// Headless smoke test via Chrome DevTools Protocol (no npm deps).
// Launches Google Chrome --headless, loads the served page, collects console
// errors + page exceptions, and asserts the ready UI rendered.
//
//   node scripts/headless-check.js <url> [chromePath]

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';

const URL = process.argv[2] || 'http://localhost:8771/';
const CHROME = process.argv[3] || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = `/tmp/fc-headless-profile-${process.pid}-${Date.now()}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getFreePort() {
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

function httpJSON(port, path, method = 'GET') {
  return new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port, path, method }, (r) => {
      let d = ''; r.on('data', (c) => (d += c)); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('error', rej);
    req.end();
  });
}

async function main() {
  const port = await getFreePort();
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { stdio: 'ignore' });

  const cleanup = () => {
    try { chrome.kill('SIGKILL'); } catch {}
    try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  };
  process.on('exit', cleanup);

  // wait for the debugger endpoint
  let ver = null;
  for (let i = 0; i < 50; i++) {
    try { ver = await httpJSON(port, '/json/version'); break; } catch { await sleep(200); }
  }
  if (!ver) { console.error('FAIL: Chrome DevTools endpoint never came up'); cleanup(); process.exit(1); }

  // Create a PAGE target and connect to it directly, so Runtime/Page commands
  // execute in the page context (the browser-level target has no DOM).
  const target = await httpJSON(port, `/json/new?${encodeURIComponent(URL)}`, 'PUT')
    .catch(() => httpJSON(port, `/json/new?${encodeURIComponent(URL)}`, 'GET'));
  if (!target || !target.webSocketDebuggerUrl) {
    console.error('FAIL: could not open page target', target); cleanup(); process.exit(1);
  }

  // Node has no built-in WS client; talk CDP over a raw upgrade instead.
  const ws = await rawWs(target.webSocketDebuggerUrl);

  const errors = [];
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej, method });
    ws.sendJSON({ id: mid, method, params });
  });

  ws.onMessage((msg) => {
    if (msg.id && pending.has(msg.id)) {
      const { res, rej, method } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(`${method}: ${JSON.stringify(msg.error)}`));
      else res(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push('exception: ' + (d.exception?.description || d.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  if (process.env.MOBILE) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
    });
  }
  await send('Page.navigate', { url: URL });
  // Page.navigate acknowledges the request before the new document is ready.
  // Poll for a stable app-shell element instead of evaluating against the
  // transient about:blank document (which produced undefined false negatives).
  let appLoaded = false;
  for (let i = 0; i < 50; i++) {
    const probe = await send('Runtime.evaluate', {
      expression: 'document.readyState === "complete" && !!document.getElementById("btn-start-empty")',
      returnByValue: true,
    });
    if (probe.result?.value === true) { appLoaded = true; break; }
    await sleep(100);
  }
  if (!appLoaded) {
    const where = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    throw new Error(`app shell never loaded at ${where.result?.value || URL}`);
  }
  await sleep(2000); // allow boot() + initPose() attempt

  const ready = await send('Runtime.evaluate', { expression: 'document.body.dataset.ready === "true"', returnByValue: true });
  const homeVisible = await send('Runtime.evaluate', { expression: '!document.getElementById("tab-home").classList.contains("hidden")', returnByValue: true });
  const navVisible = await send('Runtime.evaluate', { expression: '!!document.getElementById("nav-home") && !document.getElementById("bottomnav").classList.contains("hidden")', returnByValue: true });
  const startText = await send('Runtime.evaluate', { expression: 'document.getElementById("btn-start-empty").textContent', returnByValue: true });
  await send('Page.captureScreenshot', { captureBeyondViewport: false }).then((r) => {
    if (r && r.data) return import('node:fs/promises').then((fs) => fs.writeFile('/tmp/fc-wod-home.png', Buffer.from(r.data, 'base64')));
  }).catch(() => {});
  const wodFlow = await send('Runtime.evaluate', {
    expression: `(function(){
      const rowsBefore = [...document.querySelectorAll('#wod-exercises .wod-row')].map((r) => r.textContent.trim());
      document.getElementById('btn-wod-regenerate').click();
      const rowsAfter = [...document.querySelectorAll('#wod-exercises .wod-row')].map((r) => r.textContent.trim());
      document.getElementById('btn-wod-start').click();
      const title = document.getElementById('workout-title').textContent;
      const exerciseCount = document.querySelectorAll('#workout-exercises .ex-card2').length;
      const repsLoaded = [...document.querySelectorAll('#workout-exercises .r-in')].every((input) => Number(input.value) > 0);
      const weightsPresent = [...document.querySelectorAll('#workout-exercises .w-in')].some((input) => Number(input.value) > 0);
      const cards = [...document.querySelectorAll('#workout-exercises .ex-card2')];
      const cardsWithinViewport = cards.every((card) => {
        const rect = card.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= document.documentElement.clientWidth;
      });
      const noHorizontalOverflow = document.documentElement.scrollWidth <= document.documentElement.clientWidth;
      document.getElementById('btn-back').click();
      return { rowsBefore, rowsAfter, changed: rowsBefore.join('|') !== rowsAfter.join('|'), title, exerciseCount, repsLoaded, weightsPresent, cardsWithinViewport, noHorizontalOverflow };
    })()`,
    returnByValue: true,
  });
  // Full Hevy catalog + independent filters + type-aware duration fields.
  const catalogAudit = await send('Runtime.evaluate', {
    expression: `(function(){
      document.getElementById('btn-start-empty').click();
      const rows = document.querySelectorAll('#picker-list .pick-row').length;
      const muscleFilters = document.querySelectorAll('#picker-filters-muscle .chip').length;
      const equipmentFilters = document.querySelectorAll('#picker-filters-equipment .chip').length;
      // Chips have overflow:hidden (ripple), which zeroes the flex automatic
      // minimum size — without flex-shrink:0 they squash and clip their labels.
      const clippedChips = [...document.querySelectorAll('.chip')]
        .filter((c) => c.scrollWidth > c.clientWidth + 1)
        .map((c) => c.textContent.trim());
      const search = document.getElementById('picker-search');
      search.value = 'Running'; search.dispatchEvent(new Event('input'));
      const running = [...document.querySelectorAll('#picker-list .pick-row')].find((r) => r.querySelector('b')?.textContent === 'Running');
      if (running) running.querySelector('[data-pick]')?.click();
      const metricHead = document.querySelector('#workout-exercises .set-head span:nth-child(2)')?.textContent || '';
      const metricInputs = document.querySelectorAll('#workout-exercises .metric-in').length;
      document.getElementById('btn-add-exercise').click();
      return { rows, muscleFilters, equipmentFilters, clippedChips, runningFound: !!running, metricHead, metricInputs };
    })()`,
    returnByValue: true,
  });
  await send('Page.captureScreenshot', {}).then((r) => {
    if (r && r.data) return import('node:fs/promises').then((fs) => fs.writeFile('/tmp/fc-picker.png', Buffer.from(r.data, 'base64')));
  }).catch(() => {});
  const navFlow = await send('Runtime.evaluate', {
    expression: `(function(){
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--mint').trim();
      const pickerBackVisible = !document.getElementById('btn-back').classList.contains('hidden');
      document.getElementById('btn-back').click();
      const workoutVisible = !document.getElementById('screen-workout').classList.contains('hidden');
      document.getElementById('btn-back').click();
      const returnedToTabs = !document.getElementById('bottomnav').classList.contains('hidden');
      const resumeVisible = !document.getElementById('btn-resume-workout').classList.contains('hidden');
      document.getElementById('btn-resume-workout').click();
      const resumed = !document.getElementById('screen-workout').classList.contains('hidden');
      const finish = document.getElementById('btn-finish');
      const finishStyle = getComputedStyle(finish);
      const finishDisabled = finish.disabled;
      const finishBackground = finishStyle.backgroundColor;
      const finishColor = finishStyle.color;
      return { accent, pickerBackVisible, workoutVisible, returnedToTabs, resumeVisible, resumed, finishDisabled, finishBackground, finishColor };
    })()`,
    returnByValue: true,
  });

  // Interactive edge-swipe audit: the workout must follow the finger while
  // Home is visibly revealed underneath, then commit after crossing 1/3 width.
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: 5, y: 220, radiusX: 2, radiusY: 2, force: 1 }],
  });
  await send('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ x: 150, y: 222, radiusX: 2, radiusY: 2, force: 1 }],
  });
  await sleep(50);
  const swipeMid = await send('Runtime.evaluate', {
    expression: `(function(){
      const front = document.getElementById('screen-workout');
      const behind = document.getElementById('tab-home');
      return {
        frontTracksFinger: /translate3d\\(145px/.test(front.style.transform),
        behindRevealed: behind.classList.contains('swipe-back-underlay') && !behind.classList.contains('hidden'),
      };
    })()`,
    returnByValue: true,
  });
  await send('Page.captureScreenshot', { captureBeyondViewport: false }).then((r) => {
    if (r && r.data) return import('node:fs/promises').then((fs) => fs.writeFile('/tmp/fc-swipe-back.png', Buffer.from(r.data, 'base64')));
  }).catch(() => {});
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  const swipeEnd = await send('Runtime.evaluate', {
    expression: `(function(){
      const front = document.getElementById('screen-workout');
      const behind = document.getElementById('tab-home');
      return {
        returnedToTabs: !document.getElementById('bottomnav').classList.contains('hidden'),
        stylesClean: !front.style.transform && !behind.classList.contains('swipe-back-underlay'),
      };
    })()`,
    returnByValue: true,
  });
  const routineButtons = await send('Runtime.evaluate', {
    expression: `(function(){
      document.getElementById('nav-routines').click();
      const buttons = [...document.querySelectorAll('#routines-builtin [data-start]')];
      const result = {
        count: buttons.length,
        labelsComplete: buttons.every((button) => button.textContent.trim() === 'Start'),
        noneClipped: buttons.every((button) => button.scrollWidth <= button.clientWidth),
      };
      document.getElementById('nav-home').click();
      return result;
    })()`,
    returnByValue: true,
  });
  const howtoAudit = await send('Runtime.evaluate', {
    expression: `(function(){
      document.getElementById('btn-start-empty').click();
      const search = document.getElementById('picker-search');
      search.value = 'Arnold Press (Dumbbell)';
      search.dispatchEvent(new Event('input'));
      const row = [...document.querySelectorAll('#picker-list .pick-row')]
        .find((item) => item.querySelector('b')?.textContent === 'Arnold Press (Dumbbell)');
      const button = row?.querySelector('[data-howto]');
      button?.click();
      const result = {
        rowFound: !!row,
        howtoAvailable: !!button,
        dialogOpen: !document.getElementById('howto-overlay').classList.contains('hidden'),
        title: document.getElementById('howto-title').textContent,
        stepCount: document.querySelectorAll('#howto-steps li').length,
      };
      document.getElementById('btn-howto-close').click();
      search.value = 'Clamshell';
      search.dispatchEvent(new Event('input'));
      const originalRow = [...document.querySelectorAll('#picker-list .pick-row')]
        .find((item) => item.querySelector('b')?.textContent === 'Clamshell');
      originalRow?.querySelector('[data-howto]')?.click();
      result.originalVisual = {
        rowFound: !!originalRow,
        imageCount: document.querySelectorAll('#howto-images img').length,
      };
      return result;
    })()`,
    returnByValue: true,
  });
  await sleep(300);
  const authoredVisualAudit = await send('Runtime.evaluate', {
    expression: `(function(){
      const images = [...document.querySelectorAll('#howto-images img')];
      const result = {
        imagesLoaded: images.every((image) => image.complete && image.naturalWidth > 0),
        attribution: document.getElementById('howto-source').textContent,
      };
      document.getElementById('btn-howto-close').click();
      document.getElementById('btn-back').click();
      return result;
    })()`,
    returnByValue: true,
  });

  await send('Page.captureScreenshot', {}).then((r) => {
    if (r && r.data) {
      return import('node:fs/promises').then((fs) => fs.writeFile('/tmp/fc-headless.png', Buffer.from(r.data, 'base64')));
    }
  }).catch(() => {});

  cleanup();

  // Expected, non-fatal noise:
  //  - CDN unreachable in an offline CI box (dynamic import fails → caught)
  //  - GPU/WebGL delegate unavailable in headless → triggers the CPU fallback
  //    (MediaPipe logs the failure from its wasm layer even though we catch the JS reject)
  const EXPECTED = /tasks-vision|cdn\.jsdelivr|Failed to fetch|net::ERR|dynamically imported module|Loading|FilesetResolver|pose model|import\(\)|StartGraph|StartRun|gl_graph_runner|kGpuService|GpuService|emscripten_webgl|InferenceCalculator|calculator_graph|WebGL|Source Location Trace|drishti/i;
  const fatal = errors.filter((e) => !EXPECTED.test(e));

  console.log('ready flag      :', ready.result.value);
  console.log('home visible    :', homeVisible.result.value);
  console.log('bottom nav      :', navVisible.result.value);
  console.log('start button    :', JSON.stringify(startText.result.value));
  console.log('WOD flow        :', JSON.stringify(wodFlow.result.value));
  console.log('catalog audit   :', JSON.stringify(catalogAudit.result.value));
  console.log('theme + back nav:', JSON.stringify(navFlow.result.value));
  console.log('dynamic swipe    :', JSON.stringify({ ...swipeMid.result.value, ...swipeEnd.result.value }));
  console.log('routine buttons  :', JSON.stringify(routineButtons.result.value));
  console.log('full how-to      :', JSON.stringify({ ...howtoAudit.result.value, ...authoredVisualAudit.result.value }));
  console.log('total console errs:', errors.length, '| fatal (non-CDN):', fatal.length);
  if (errors.length) console.log('  errors:\n   - ' + errors.join('\n   - '));

  const ok = ready.result.value === true
    && homeVisible.result.value === true
    && navVisible.result.value === true
    && /workout/i.test(startText.result.value || '')
    && wodFlow.result.value.rowsBefore.length === 6
    && wodFlow.result.value.rowsAfter.length === 6
    && wodFlow.result.value.changed === true
    && /Workout of the Day/i.test(wodFlow.result.value.title || '')
    && wodFlow.result.value.exerciseCount === 6
    && wodFlow.result.value.repsLoaded === true
    && wodFlow.result.value.weightsPresent === true
    && wodFlow.result.value.cardsWithinViewport === true
    && wodFlow.result.value.noHorizontalOverflow === true
    && catalogAudit.result.value.rows === 455
    && catalogAudit.result.value.muscleFilters === 21
    && catalogAudit.result.value.equipmentFilters === 10
    && catalogAudit.result.value.clippedChips.length === 0
    && catalogAudit.result.value.runningFound === true
    && /Metres.*Seconds/.test(catalogAudit.result.value.metricHead)
    && catalogAudit.result.value.metricInputs === 2
    && navFlow.result.value.accent === '#ff334f'
    && navFlow.result.value.pickerBackVisible === true
    && navFlow.result.value.workoutVisible === true
    && navFlow.result.value.returnedToTabs === true
    && navFlow.result.value.resumeVisible === true
    && navFlow.result.value.resumed === true
    && navFlow.result.value.finishDisabled === true
    && swipeMid.result.value.frontTracksFinger === true
    && swipeMid.result.value.behindRevealed === true
    && swipeEnd.result.value.returnedToTabs === true
    && swipeEnd.result.value.stylesClean === true
    && routineButtons.result.value.count >= 4
    && routineButtons.result.value.labelsComplete === true
    && routineButtons.result.value.noneClipped === true
    && howtoAudit.result.value.rowFound === true
    && howtoAudit.result.value.howtoAvailable === true
    && howtoAudit.result.value.dialogOpen === true
    && howtoAudit.result.value.title === 'Arnold Press (Dumbbell)'
    && howtoAudit.result.value.stepCount >= 3
    && howtoAudit.result.value.originalVisual.rowFound === true
    && howtoAudit.result.value.originalVisual.imageCount === 2
    && authoredVisualAudit.result.value.imagesLoaded === true
    && /Form Coach original artwork/.test(authoredVisualAudit.result.value.attribution)
    && fatal.length === 0;
  console.log(ok ? '\nPASS: ready UI rendered with no fatal JS init errors' : '\nFAIL');
  process.exit(ok ? 0 : 1);
}

// Minimal WebSocket client over Node's http upgrade (CDP speaks WS text frames).
function rawWs(url) {
  return new Promise((resolve, reject) => {
    const u = new global.URL(url);
    const key = Buffer.from(Array.from({ length: 16 }, (_, i) => (i * 7) & 0xff)).toString('base64');
    const req = http.request({
      host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': key },
    });
    req.on('upgrade', (res, socket) => {
      const listeners = [];
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
          const frame = decodeFrame(buf);
          if (!frame) break;
          buf = frame.rest;
          if (frame.opcode === 0x8) { socket.end(); return; }
          if (frame.opcode === 0x1) { try { const m = JSON.parse(frame.payload.toString('utf8')); listeners.forEach((fn) => fn(m)); } catch {} }
        }
      });
      resolve({
        sendJSON: (obj) => socket.write(encodeFrame(Buffer.from(JSON.stringify(obj)))),
        onMessage: (fn) => listeners.push(fn),
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// client→server frames must be masked
function encodeFrame(payload) {
  const len = payload.length;
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  let header;
  if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
  else if (len < 65536) header = Buffer.from([0x81, 0x80 | 126, (len >> 8) & 0xff, len & 0xff]);
  else header = Buffer.from([0x81, 0x80 | 127, 0, 0, 0, 0, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); offset = 10; }
  if (buf.length < offset + len) return null;
  return { opcode, payload: buf.subarray(offset, offset + len), rest: buf.subarray(offset + len) };
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
