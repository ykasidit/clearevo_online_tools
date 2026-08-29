// Memory stress on a REAL huge CD via the real user path: a disk-backed File
// through the file input (File.slice streaming - the zip is never held in RAM
// by the page). Loads the CD, visits every series, then rapid-scrolls the
// biggest one to churn the slice cache, sampling V8 heap + renderer RSS.
//   ZIPFILE=/abs/path/scds_ct_demo.zip BASE=https://www.clearevo.com node stress_ram.mjs
const PORT = 8077, CDP = 9333;
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const ZIPFILE = process.env.ZIPFILE;
if (!ZIPFILE) { console.error('ZIPFILE=/abs/path/to/cd.zip required'); process.exit(2); }
import { execSync } from 'node:child_process';

const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); let crashed = null;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); d.error ? err(new Error(JSON.stringify(d.error))) : ok(d.result); }
  else if (d.method === 'Inspector.targetCrashed') { crashed = 'TARGET CRASHED (renderer died - the "Aw, Snap" case)'; console.log('!!! ' + crashed); }
};
const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable'); await send('DOM.enable'); await send('Inspector.enable'); await send('Performance.enable');
const evalJs = async (expr, awaitP = false) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: awaitP, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (sel) => evalJs(`document.getElementById(${JSON.stringify(sel)}).textContent`).catch(() => '?');
const wheel = (x, y, dy) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy, pointerType: 'mouse' });

// --- RAM sampling: V8 heap via CDP + renderer RSS via ps ---
let peakHeap = 0, peakRss = 0;
const samples = [];
function rendererRssMb() {
  try {
    const out = execSync(`ps -eo rss=,args= | grep -- '--type=renderer' | grep -v grep | grep '${process.env.PROF || 'user-data-dir'}'`, { encoding: 'utf8' });
    return Math.max(...out.trim().split('\n').map((l) => parseInt(l) / 1024));
  } catch { return 0; }
}
async function sample(tag) {
  try {
    const m = await send('Performance.getMetrics');
    const heap = (m.metrics.find((x) => x.name === 'JSHeapUsedSize')?.value || 0) / 1048576;
    const rss = rendererRssMb();
    peakHeap = Math.max(peakHeap, heap); peakRss = Math.max(peakRss, rss);
    samples.push({ tag, heap: Math.round(heap), rss: Math.round(rss) });
    console.log(`  [mem] ${tag}: JS heap ${heap.toFixed(0)} MB, renderer RSS ${rss.toFixed(0)} MB`);
  } catch { if (!crashed) crashed = 'metrics unavailable (renderer gone?)'; }
}

// --- open the CD exactly like a user: file input with a disk-backed File ---
if (process.env.MOBILE) {   // emulate a low-memory phone: deviceMemory=2 shrinks the slice-cache budget
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 2 })" });
  console.log('MOBILE emulation: navigator.deviceMemory=2');
}
await send('Page.navigate', { url: `${BASE}/dicom/` });
await sleep(2000);
await sample('page loaded');
await evalJs(`window.__fi = null; HTMLInputElement.prototype.click = function () { window.__fi = this; };`);
await evalJs(`document.getElementById('bZip').click()`);
const fi = await send('Runtime.evaluate', { expression: 'window.__fi' });
await send('DOM.setFileInputFiles', { files: [ZIPFILE], objectId: fi.result.objectId });
console.log('CD zip handed to the file input (disk-backed, streams via File.slice)');
let ready = false;
for (let i = 0; i < 900 && !crashed; i++) {
  if (await evalJs(`document.getElementById('empty').style.display === 'none' && !document.getElementById('slice').disabled`).catch(() => false)) { ready = true; break; }
  if (i % 20 === 19) await sample(`scanning ${await text('stat')}`);
  await sleep(500);
}
console.log(`ready=${ready} stat="${await text('stat')}"`);
await sample('CD open, previews decoded');

const vp = await evalJs(`JSON.parse(JSON.stringify(document.getElementById('viewport').getBoundingClientRect()))`);
const vcx = Math.round(vp.left + vp.width / 2), vcy = Math.round(vp.top + vp.height / 2);

// --- visit every series ---
const nSeries = await evalJs(`document.querySelectorAll('.ser').length`);
console.log(`${nSeries} series - visiting each`);
for (let i = 0; i < nSeries && !crashed; i++) {
  await evalJs(`document.querySelectorAll('.ser')[${i}].click()`);
  await sleep(2500);
  console.log(`  series ${i + 1}/${nSeries}: ${(await text('ovBL')).replace(/\n/g, ' | ')}`);
  if (i % 3 === 2) await sample(`after series ${i + 1}`);
}
await sample('all series visited');

// --- pick the biggest series and rapid-scroll through it ---
await evalJs(`(() => { const els = [...document.querySelectorAll('.ser')]; let best = els[0], n = 0;
  for (const e of els) { const m = e.textContent.match(/(\\d+) img/); if (m && +m[1] > n) { n = +m[1]; best = e; } } best.click(); })()`);
await sleep(3000);
console.log(`rapid-scrolling biggest series: ${(await text('ovBL')).replace(/\n/g, ' | ')}`);
for (let i = 0; i < 500 && !crashed; i++) {
  await wheel(vcx, vcy, 120);
  await sleep(30);
  if (i % 100 === 99) await sample(`scroll ${i + 1}/500 (${await text('sliceLbl')})`);
}
for (let i = 0; i < 500 && !crashed; i++) {
  await wheel(vcx, vcy, -120);
  await sleep(30);
  if (i % 250 === 249) await sample(`scroll back ${i + 1}/500 (${await text('sliceLbl')})`);
}
await sleep(3000);
await sample('after scroll churn');

console.log('\n==== RAM SUMMARY ====');
for (const s of samples) console.log(`  ${s.tag}: heap ${s.heap} MB / rss ${s.rss} MB`);
console.log(`PEAK: JS heap ${peakHeap.toFixed(0)} MB, renderer RSS ${peakRss.toFixed(0)} MB`);
console.log(crashed ? `RESULT: ${crashed}` : 'RESULT: no crash');
ws.close();
process.exit(crashed ? 1 : 0);
