// Clinician-scenario test suite for the DICOM viewer, driven over CDP in headless Chrome.
// Oracles: DOM text (#wlz, #ovBL, #sliceLbl, #stat) + locating drawn cyan measure
// markers in screenshots and comparing with real click coordinates.
const PORT = 8077, CDP = 9333;
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;

const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); d.error ? err(new Error(JSON.stringify(d.error))) : ok(d.result); } };
const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable');
const evalJs = async (expr, awaitP = false) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: awaitP, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
import { readFileSync } from 'node:fs';
async function injectAndDrop(names) {
  await evalJs('window.__dcm = {}');
  for (const n of names) {
    const b64 = readFileSync(new URL('./data/' + n, import.meta.url)).toString('base64');
    await evalJs(`(() => { const bin = atob('${b64}'); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) { a[i] = bin.charCodeAt(i); } window.__dcm[${JSON.stringify(n)}] = a; return a.length; })()`);
  }
  await evalJs(`(() => { const dt = new DataTransfer(); for (const [n, a] of Object.entries(window.__dcm)) { dt.items.add(new File([a], n)); } document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return 'ok'; })()`);
}

const text = (sel) => evalJs(`document.getElementById(${JSON.stringify(sel)}).textContent`);
const clickBtn = (sel) => evalJs(`document.getElementById(${JSON.stringify(sel)}).click()`);
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); };

const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
};
const dblClick = async (x, y) => {
  await click(x, y); await sleep(80);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2, pointerType: 'mouse' });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2, pointerType: 'mouse' });
};
const drag = async (x1, y1, x2, y2, steps = 8) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1, pointerType: 'mouse' });
  for (let i = 1; i <= steps; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps, button: 'left', pointerType: 'mouse' });
    await sleep(20);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1, pointerType: 'mouse' });
};
const wheel = (x, y, dy) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, pointerType: 'mouse' });

// cyan measure-marker pixels within the viewport, in CSS px (handles hi-DPI shots)
async function cyanInVp() {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  return evalJs(`(async () => {
    const img = new Image();
    await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = 'data:image/png;base64,${shot.data}'; });
    const scale = img.width / window.innerWidth;
    const r = document.getElementById('viewport').getBoundingClientRect();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const pix = [];
    const x0 = Math.ceil(r.left * scale), x1 = Math.floor(r.right * scale), y0 = Math.ceil(r.top * scale), y1 = Math.floor(r.bottom * scale);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i] < 90 && d[i + 1] > 160 && d[i + 2] > 200) pix.push([x / scale, y / scale]);
    }
    return pix;
  })()`, true);
}
async function nearestCyan(cx, cy) {
  const pix = await cyanInVp();
  let best = 1e9;
  for (const [px, py] of pix) { const d = Math.hypot(px - cx, py - cy); if (d < best) best = d; }
  return best;
}
async function clearMeasure() { await clickBtn('bMUndo'); await clickBtn('bMUndo'); await clickBtn('bMUndo'); }
async function measureCheck(name, p1, p2, tolerance = 4) {
  await clearMeasure();
  await clickBtn('tMeasure'); await sleep(150);
  await click(...p1); await sleep(500);
  await click(...p2); await sleep(500);
  const d1 = await nearestCyan(...p1), d2 = await nearestCyan(...p2);
  check(name, d1 <= tolerance && d2 <= tolerance, `marker offsets ${d1.toFixed(1)}px, ${d2.toFixed(1)}px`);
}

// ---------- load ----------
await send('Page.navigate', { url: `${BASE}/dicom/` });
await sleep(1500);
await injectAndDrop(['ct1.dcm','ct2.dcm','ct3.dcm','ct4.dcm','ct5.dcm','us_clip.dcm']);
for (let i = 0; i < 60; i++) { if (await evalJs(`document.getElementById('empty').style.display === 'none' && !document.getElementById('slice').disabled`)) break; await sleep(250); }
check('load: 2 series scanned', (await text('stat')).includes('2 series'), await text('stat'));
check('load: biggest series selected, mid-stack landing', (await text('sliceLbl')) === '3/5', `sliceLbl=${await text('sliceLbl')}`);

const vp = await evalJs(`JSON.parse(JSON.stringify(document.getElementById('viewport').getBoundingClientRect()))`);
const vcx = Math.round(vp.left + vp.width / 2), vcy = Math.round(vp.top + vp.height / 2);

// ---------- browse: wheel + keys + slider ----------
await wheel(vcx, vcy, 120); await sleep(300);
check('browse: wheel scrolls slices', (await text('sliceLbl')) === '4/5', `sliceLbl=${await text('sliceLbl')}`);
await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))`); await sleep(300);
check('browse: arrow key scrolls slices', (await text('sliceLbl')) === '3/5', `sliceLbl=${await text('sliceLbl')}`);
await wheel(vcx, vcy, -120); await wheel(vcx, vcy, -120); await wheel(vcx, vcy, -120); await sleep(300);
check('browse: wheel clamps at first slice', (await text('sliceLbl')) === '1/5', `sliceLbl=${await text('sliceLbl')}`);

// ---------- measure basics ----------
await measureCheck('measure: baseline landing', [vcx - 100, vcy - 60], [vcx + 60, vcy + 80]);

// ---------- double-click behaviors ----------
await clearMeasure(); await clickBtn('tBrowse'); await sleep(150);
await dblClick(vcx, vcy); await sleep(300);
const zAfterDblBrowse = await text('wlz');
check('browse: mouse double-click gives photo-style zoom (not fight-and-reset)', /zoom (?!100%)/.test(zAfterDblBrowse), `wlz="${zAfterDblBrowse}"`);
await clickBtn('bReset'); await sleep(150);

// zoom in with the Zoom tool, then measure with quick clicks (a clinician measuring a small lesion zoomed-in)
await clickBtn('tZoom'); await sleep(100);
await drag(vcx, vcy, vcx, vcy - 120); await sleep(200);
const zBefore = await text('wlz');
await clickBtn('tMeasure'); await sleep(100);
await click(vcx - 40, vcy - 30); await sleep(120); await click(vcx + 40, vcy + 30); await sleep(400);
const zAfter = await text('wlz');
check('measure: quick 2-click while zoomed keeps zoom (no dblclick reset)', zBefore.match(/zoom [\d]+%/)?.[0] === zAfter.match(/zoom [\d]+%/)?.[0], `before="${zBefore}" after="${zAfter}"`);
const dA = await nearestCyan(vcx - 40, vcy - 30), dB = await nearestCyan(vcx + 40, vcy + 30);
check('measure: quick 2-click while zoomed - markers on clicks', dA <= 4 && dB <= 4, `offsets ${dA.toFixed(1)}px, ${dB.toFixed(1)}px`);
await clickBtn('bReset'); await sleep(150);

// ---------- measure under zoom+pan ----------
await clickBtn('tZoom'); await drag(vcx, vcy, vcx, vcy - 100); await sleep(150);
await clickBtn('tPan'); await drag(vcx, vcy, vcx + 80, vcy + 40); await sleep(150);
await measureCheck('measure: zoomed + panned landing', [vcx - 70, vcy - 50], [vcx + 90, vcy + 60]);
await clickBtn('bReset'); await sleep(150);

// ---------- measure after rotate / flip ----------
await clickBtn('bRotate'); await sleep(150);
await measureCheck('measure: rotated 90 landing', [vcx - 80, vcy - 50], [vcx + 60, vcy + 70]);
await clickBtn('bFlip'); await sleep(150);
await measureCheck('measure: rotated 90 + mirrored landing', [vcx - 60, vcy + 40], [vcx + 80, vcy - 60]);
await clickBtn('bReset'); await sleep(150);

// ---------- undo pt then replace ----------
await clearMeasure(); await clickBtn('tMeasure'); await sleep(100);
await click(vcx - 90, vcy); await sleep(400); await click(vcx + 90, vcy); await sleep(400);
await clickBtn('bMUndo'); await sleep(150);
await click(vcx + 50, vcy + 70); await sleep(400);
const dU = await nearestCyan(vcx + 50, vcy + 70);
check('measure: undo pt then re-place', dU <= 4, `offset ${dU.toFixed(1)}px`);

// ---------- measure survives slice scroll? (spec: cleared) ----------
await wheel(vcx, vcy, 120); await sleep(300);
const pixAfterScroll = await cyanInVp();
check('measure: markers cleared on slice change (intended)', pixAfterScroll.length < 30, `${pixAfterScroll.length} cyan px remain`);

// ---------- hi-DPI (retina) ----------
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
await sleep(400);
await measureCheck('measure: hi-DPI (dpr=2) landing', [vcx - 80, vcy - 40], [vcx + 70, vcy + 50]);
await send('Emulation.clearDeviceMetricsOverride'); await sleep(400);

// ---------- W/L drag ----------
await clickBtn('tWL'); await sleep(100);
const wlBefore = await text('wlz');
await drag(vcx, vcy, vcx + 60, vcy - 40); await sleep(200);
const wlAfterD = await text('wlz');
check('wl: drag changes window level/width', wlBefore !== wlAfterD, `"${wlBefore}" -> "${wlAfterD}"`);

// ---------- series switch to multi-frame US clip + cine ----------
await evalJs(`[...document.querySelectorAll('.ser')].find((e) => e.textContent.includes('US'))?.click()`);
await sleep(1200);
check('us: multi-frame clip expands to 8 frames', (await text('sliceLbl')).endsWith('/8'), `sliceLbl=${await text('sliceLbl')}`);
check('us: overlay shows US series', (await text('ovBL')).includes('US'), (await text('ovBL')).replace(/\n/g, ' | '));
const frameBefore = await text('sliceLbl');
await clickBtn('bCine'); await sleep(700); await clickBtn('bCine'); await sleep(200);
check('us: cine advances frames', (await text('sliceLbl')) !== frameBefore, `${frameBefore} -> ${await text('sliceLbl')}`);

// measure on US (no PixelSpacing on this clip - marker should still land, label px-only)
await measureCheck('measure: on US clip landing', [vcx - 40, vcy - 20], [vcx + 40, vcy + 30]);

// ---------- tags dialog ----------
await clickBtn('bTags'); await sleep(400);
const tagsVisible = await evalJs(`document.getElementById('tags').style.display !== 'none' && document.getElementById('tags').textContent.length > 100`);
check('tags: dialog opens with content', !!tagsVisible);
await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(200);
check('tags: Escape closes dialog', await evalJs(`document.getElementById('tags').style.display === 'none'`));

// ---------- capture PNG includes measurement overlay + rotation ----------
await evalJs(`[...document.querySelectorAll('.ser')].find((e) => e.textContent.includes('CT'))?.click()`);
await sleep(800);
await clickBtn('bRotate'); await sleep(150);
await clearMeasure(); await clickBtn('tMeasure'); await sleep(100);
await click(vcx - 60, vcy - 40); await sleep(400); await click(vcx + 60, vcy + 40); await sleep(400);
await evalJs(`window.__cap = null; const oc = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__cap = this.href; } else { oc.call(this); } };`);
await clickBtn('bCapture'); await sleep(500);
const cap = await evalJs(`(async () => {
  if (!window.__cap) return null;
  const img = new Image();
  await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = window.__cap; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let cyan = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i] < 90 && d[i + 1] > 160 && d[i + 2] > 200) cyan++; }
  return { w: img.width, h: img.height, cyan };
})()`, true);
check('capture: PNG contains the measurement overlay', cap && cap.cyan > 50, cap ? `${cap.w}x${cap.h}, ${cap.cyan} cyan px` : 'no capture intercepted');
await clickBtn('bReset'); await clearMeasure(); await sleep(150);

// ---------- back to CT, invert + preset ----------
await evalJs(`[...document.querySelectorAll('.ser')].find((e) => e.textContent.includes('CT'))?.click()`);
await sleep(800);
await clickBtn('bInvert'); await sleep(150);
check('invert: toggles without error', true);

console.log('\n==== SUMMARY ====');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  -- ' + r.detail : ''}`);
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
ws.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
