// Reproduce: DICOM viewer measure ("ruler") marker not drawn where clicked.
// Drives the real page in headless Chrome via CDP: drop a synthetic DICOM,
// select Measure, click 2 points, then locate the drawn cyan markers in a
// screenshot and compare with the click coordinates. Runs at A-zoom 100% and 150%.
const PORT = 8077, CDP = 9333;
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;

const res = await fetch(`http://127.0.0.1:${CDP}/json/list`);
const targets = await res.json();
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


await send('Page.navigate', { url: `${BASE}/dicom/` });
await sleep(1500);

// drop the synthetic DICOM into the real pipeline
await injectAndDrop(['ct1.dcm']);
for (let i = 0; i < 40; i++) { if (await evalJs(`document.getElementById('empty').style.display === 'none' && document.getElementById('busy').style.display !== 'flex'`)) break; await sleep(250); }
console.log('frame shown:', await evalJs(`document.getElementById('ovBL').textContent`));

const click = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
};

// find cyan (#00e5ff) marker pixels in a screenshot, done in-page via an Image+canvas
async function markerCenters() {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  return evalJs(`(async () => {
    const img = new Image();
    await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = 'data:image/png;base64,${shot.data}'; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const pix = [];
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i] < 90 && d[i + 1] > 160 && d[i + 2] > 200) pix.push([x, y]);
    }
    // cluster pixels into blobs (markers/line); return blob centroids of small round blobs
    return pix;
  })()`, true);
}

async function runCase(label, clicks, gapMs = 600) {
  // clear old points + reset zoom/pan (dblclick handler resets), reselect tool
  await evalJs(`document.getElementById('bMUndo').click(); document.getElementById('bMUndo').click(); document.getElementById('bReset').click()`);
  await evalJs(`document.getElementById('tMeasure').click()`);
  await sleep(400);
  for (const [x, y] of clicks) { await click(x, y); await sleep(gapMs); }
  const pix = await markerCenters();
  for (const [cx, cy] of clicks) {
    let best = 1e9, bp = null;
    for (const [px, py] of pix) { const d = Math.hypot(px - cx, py - cy); if (d < best) { best = d; bp = [px, py]; } }
    console.log(`${label}: click (${cx},${cy}) -> nearest cyan ${bp ? `(${bp[0]},${bp[1]}) ${best.toFixed(1)}px away, delta (${bp[0] - cx},${bp[1] - cy})` : 'NONE'}`);
  }
  if (pix.length) {
    const xs = pix.map((p) => p[0]), ys = pix.map((p) => p[1]);
    console.log(`${label}: ${pix.length} cyan px, bbox x ${Math.min(...xs)}..${Math.max(...xs)} y ${Math.min(...ys)}..${Math.max(...ys)}`);
  }
}

const vpRect = await evalJs(`JSON.parse(JSON.stringify(document.getElementById('viewport').getBoundingClientRect()))`);
console.log('vp rect:', vpRect.left.toFixed(0), vpRect.top.toFixed(0), vpRect.width.toFixed(0), vpRect.height.toFixed(0));
const p1 = [Math.round(vpRect.left + vpRect.width * 0.45), Math.round(vpRect.top + vpRect.height * 0.4)];
const p2 = [Math.round(vpRect.left + vpRect.width * 0.6), Math.round(vpRect.top + vpRect.height * 0.65)];

console.log('--- A-zoom 100%, slow clicks (600ms apart) ---');
await runCase('zoom100-slow', [p1, p2]);
console.log('--- A-zoom 100%, fast clicks (150ms apart, inside 320ms double-tap window) ---');
await runCase('zoom100-fast', [p1, p2], 150);

console.log('--- A-zoom 150% (5x A+ clicks, persisted ce_zoom) ---');
await evalJs(`for (let i = 0; i < 5; i++) document.getElementById('fPlus').click(); document.body.style.zoom`);
await sleep(300);
const vpRect2 = await evalJs(`JSON.parse(JSON.stringify(document.getElementById('viewport').getBoundingClientRect()))`);
console.log('vp rect now:', vpRect2.left.toFixed(0), vpRect2.top.toFixed(0), vpRect2.width.toFixed(0), vpRect2.height.toFixed(0));
const q1 = [Math.round(vpRect2.left + vpRect2.width * 0.45), Math.round(vpRect2.top + vpRect2.height * 0.4)];
const q2 = [Math.round(vpRect2.left + vpRect2.width * 0.6), Math.round(vpRect2.top + vpRect2.height * 0.65)];
await runCase('zoom150', [q1, q2]);

ws.close();
process.exit(0);
