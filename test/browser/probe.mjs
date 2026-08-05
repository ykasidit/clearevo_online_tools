// Probe suspected bugs: ctrl+wheel (trackpad pinch), touch-pinch stray measure point, slider input.
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

await send('Page.navigate', { url: `${BASE}/dicom/` });
await sleep(1500);
await injectAndDrop(['ct1.dcm','ct2.dcm','ct3.dcm','ct4.dcm','ct5.dcm']);
for (let i = 0; i < 60; i++) { if (await evalJs(`!document.getElementById('slice').disabled`)) break; await sleep(250); }
const vp = await evalJs(`JSON.parse(JSON.stringify(document.getElementById('viewport').getBoundingClientRect()))`);
const vcx = Math.round(vp.left + vp.width / 2), vcy = Math.round(vp.top + vp.height / 2);
console.log('loaded:', await text('sliceLbl'), await text('wlz'));

// --- 1. ctrl+wheel = trackpad pinch-zoom gesture ---
const sliceBefore = await text('sliceLbl'), zoomBefore = await text('wlz');
await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: vcx, y: vcy, deltaX: 0, deltaY: -100, modifiers: 2 });
await sleep(300);
console.log(`ctrl+wheel (trackpad pinch): slice ${sliceBefore} -> ${await text('sliceLbl')}, wlz "${zoomBefore}" -> "${await text('wlz')}"`);

// --- 2. touch pinch while Measure tool active: stray point? ---
await evalJs(`document.getElementById('bReset').click(); document.getElementById('tMeasure').click()`);
await sleep(200);
const t1 = { x: vcx - 50, y: vcy }, t2 = { x: vcx + 50, y: vcy };
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [t1] });
await sleep(60);
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [t1, t2] });
for (let i = 1; i <= 6; i++) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: t1.x - i * 15, y: vcy }, { x: t2.x + i * 15, y: vcy }] });
  await sleep(40);
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(400);
const shot = await send('Page.captureScreenshot', { format: 'png' });
const cyan = await evalJs(`(async () => {
  const img = new Image();
  await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = 'data:image/png;base64,${shot.data}'; });
  const r = document.getElementById('viewport').getBoundingClientRect();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let y = Math.ceil(r.top); y < r.bottom; y++) for (let x = Math.ceil(r.left); x < r.right; x++) {
    const i = (y * c.width + x) * 4;
    if (d[i] < 90 && d[i + 1] > 160 && d[i + 2] > 200) n++;
  }
  return n;
})()`, true);
console.log(`touch pinch with Measure active: ${cyan} cyan marker px afterwards (0 = clean, >0 = stray point), wlz "${await text('wlz')}"`);

// --- 3. slider input ---
await evalJs(`const s = document.getElementById('slice'); s.value = 0; s.dispatchEvent(new Event('input', { bubbles: true }))`);
await sleep(400);
console.log(`slider to 0: sliceLbl = ${await text('sliceLbl')}`);

ws.close(); process.exit(0);
