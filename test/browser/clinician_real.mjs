// Clinician suite on a REAL scan CD: fetches the SCDS demo zip same-origin
// (worker proxies R2 on the live site), drops it into the real pipeline, and
// runs the data-agnostic interaction scenarios. Oracles avoid dataset-specific
// counts - they assert behaviors (slice scroll moves, markers land on clicks,
// zoom changes, capture carries the overlay), not the synthetic fixtures.
//   BASE=https://www.clearevo.com node clinician_real.mjs
//   ZIP=/dicom-demo/scds_ct_demo.zip to test another CD.
const PORT = 8077, CDP = 9333;
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const ZIP = process.env.ZIP || '/dicom-demo/scds_ct_small_demo.zip';

const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); d.error ? err(new Error(JSON.stringify(d.error))) : ok(d.result); } };
const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable');
const evalJs = async (expr, awaitP = false) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: awaitP, returnByValue: true, timeout: 120000 });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const wheel = (x, y, dy, mods = 0) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, modifiers: mods, pointerType: 'mouse' });
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

// ---------- load the real CD zip ----------
await send('Page.navigate', { url: `${BASE}/dicom/` });
await sleep(1500);
console.log(`fetching ${ZIP} in-page and dropping it...`);
await evalJs(`(async () => {
  const r = await fetch(${JSON.stringify(ZIP)});
  if (!r.ok) throw new Error('zip fetch ' + r.status);
  const buf = await r.arrayBuffer();
  const f = new File([buf], ${JSON.stringify(ZIP.split('/').pop())});
  const dt = new DataTransfer(); dt.items.add(f);
  document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  return buf.byteLength;
})()`, true);
let readyOk = false;
for (let i = 0; i < 600; i++) {  // big CD: scan + preview decode can take minutes
  if (await evalJs(`document.getElementById('empty').style.display === 'none' && !document.getElementById('slice').disabled`)) { readyOk = true; break; }
  await sleep(500);
}
check('load: real CD zip scanned and browse-ready', readyOk, await text('stat'));
const ovbl = await text('ovBL');
const m = ovbl.match(/img (\d+)\/(\d+)/);
check('load: a slice is displayed', !!m, ovbl.replace(/\n/g, ' | '));
const nSlices = m ? +m[2] : 0;
check('load: multi-slice series selected', nSlices > 1, `${nSlices} slices`);

const vp = await evalJs(`JSON.parse(JSON.stringify(document.getElementById('viewport').getBoundingClientRect()))`);
const vcx = Math.round(vp.left + vp.width / 2), vcy = Math.round(vp.top + vp.height / 2);

// ---------- browse ----------
const s0 = await text('sliceLbl');
await wheel(vcx, vcy, 120); await sleep(400);
check('browse: wheel scrolls slices', (await text('sliceLbl')) !== s0, `${s0} -> ${await text('sliceLbl')}`);
await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))`); await sleep(400);
check('browse: arrow key scrolls back', (await text('sliceLbl')) === s0, `back to ${await text('sliceLbl')}`);

// ---------- measure on real anatomy ----------
await measureCheck('measure: baseline landing', [vcx - 100, vcy - 60], [vcx + 60, vcy + 80]);
await clickBtn('tZoom'); await drag(vcx, vcy, vcx, vcy - 100); await sleep(150);
await clickBtn('tPan'); await drag(vcx, vcy, vcx + 80, vcy + 40); await sleep(150);
await measureCheck('measure: zoomed + panned landing', [vcx - 70, vcy - 50], [vcx + 90, vcy + 60]);
await clickBtn('bReset'); await sleep(150);
await clickBtn('bRotate'); await sleep(300);
await measureCheck('measure: rotated 90 landing', [vcx - 80, vcy - 50], [vcx + 60, vcy + 70]);
await clickBtn('bFlip'); await sleep(300);
await measureCheck('measure: rotated + mirrored landing', [vcx - 60, vcy + 40], [vcx + 80, vcy - 60]);

// ---------- capture with overlay on real scan (rotated + mirrored + measured) ----------
await evalJs(`window.__cap = null; const oc = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__cap = this.href; } else { oc.call(this); } };`);
await clickBtn('bCapture'); await sleep(800);
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
check('capture: real-scan PNG contains the measurement overlay', cap && cap.cyan > 50, cap ? `${cap.w}x${cap.h}, ${cap.cyan} cyan px` : 'no capture intercepted');
await clickBtn('bReset'); await clearMeasure(); await sleep(200);

// ---------- zoom behaviors ----------
await clickBtn('tBrowse'); await sleep(150);
await dblClick(vcx, vcy); await sleep(300);
check('zoom: mouse double-click zooms', !/zoom 100%/.test(await text('wlz')), await text('wlz'));
await clickBtn('bReset'); await sleep(150);
await wheel(vcx, vcy, -100, 2); await sleep(300);   // ctrl+wheel = trackpad pinch
const zw = await text('wlz');
check('zoom: trackpad pinch (ctrl+wheel) zooms, slice unchanged', /zoom 110%/.test(zw) && (await text('sliceLbl')) === s0, zw);
await clickBtn('bReset'); await sleep(150);

// ---------- W/L on real HU data ----------
await clickBtn('tWL'); await sleep(100);
const wl0 = await text('wlz');
await drag(vcx, vcy, vcx + 60, vcy - 40); await sleep(300);
check('wl: drag changes window level/width', (await text('wlz')) !== wl0, `"${wl0}" -> "${await text('wlz')}"`);

// ---------- series switch (if the CD has more than one) ----------
const nSeries = await evalJs(`document.querySelectorAll('.ser').length`);
if (nSeries > 1) {
  const before = await text('ovBL');
  await evalJs(`document.querySelectorAll('.ser')[1].click()`); await sleep(2000);
  check('series: switching updates the view', (await text('ovBL')) !== before, (await text('ovBL')).replace(/\n/g, ' | '));
} else {
  console.log(`INFO  single-series CD (${nSeries} series) - switch scenario skipped`);
}

// ---------- tags on real scan ----------
await clickBtn('bTags'); await sleep(600);
check('tags: dialog opens with real DICOM tags', await evalJs(`document.getElementById('tags').style.display !== 'none' && document.getElementById('tags').textContent.length > 200`));
await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(200);
check('tags: Escape closes dialog', await evalJs(`document.getElementById('tags').style.display === 'none'`));

console.log('\n==== SUMMARY (real SCDS CD) ====');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  -- ' + r.detail : ''}`);
console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
ws.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
