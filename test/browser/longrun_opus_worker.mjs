// BatRay by ClearEvo.com - tests (longrun_opus_worker.mjs)
// Copyright (C) 2026 Kasidit Yusuf
//
// This program is free software; you can redistribute it and/or modify it
// under the terms of the GNU General Public License as published by the Free
// Software Foundation; either version 2 of the License, or (at your option)
// any later version.
//
// This program is distributed in the hope that it will be useful, but WITHOUT
// ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
// FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for
// more details: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
// Source: https://github.com/ykasidit/clearevo_online_tools
//
// Long-run review (opus, round 3): the real history worker over the real opfs-sahpool in Chrome, with ITS clock moved a
// day at a time (a wrapper module patches Date inside the worker, then imports history-worker.js), driven the way the
// reader drives it each day: 30 flushes, the year test's seed (info, an insert of SEED rows, info), a listing, info()
// on every stored day, a 7-day chart query. The worker's own memory (measureUserAgentSpecificMemory) must stop growing
// with the stored days. Chrome on CDP 9341, serve.py on 8091; DAYS (default 90), SEED (default 17280).
const PORT = 8091, CDP = 9341, DAYS = Number(process.env.DAYS || 90), SEED = Number(process.env.SEED || 17280);
const page = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();   // its own tab (another test may drive the first one)
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); if (d.error) err(new Error(JSON.stringify(d.error))); else ok(d.result); } };
const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

// an isolated page of the site that does not start the app (serve.py sends COOP/COEP for /batray/index.html)
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/batray/index.html?lr-worker` }); await sleep(800);
await evalJs(`(() => { window.stop(); document.documentElement.innerHTML = '<body>worker probe</body>'; return 1; })()`);
const setup = `(async () => {
  const wrap = "const RD = Date; let off = 0; globalThis.Date = class extends RD { constructor(...a) { if (a.length) super(...a); else super(RD.now() + off); } static now() { return RD.now() + off; } };" +
    "self.addEventListener('message', (e) => { if (e.data && e.data.clock !== undefined) { off = e.data.clock - RD.now(); e.stopImmediatePropagation(); self.postMessage({ clockSet: true }); } });" +
    "await import('${`http://127.0.0.1:${PORT}`}/batray/history-worker.js');";
  const w = new Worker(URL.createObjectURL(new Blob([wrap], { type: 'text/javascript' })), { type: 'module' });
  const waiting = new Map(); let seq = 0;
  w.onmessage = (e) => { const m = e.data; if (m && m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  window.__call = (op, args = {}) => new Promise((res) => { const i = ++seq; waiting.set(i, res); w.postMessage({ id: i, op, args }); });
  window.__clock = (t) => new Promise((res) => { const f = (e) => { if (e.data && e.data.clockSet) { w.removeEventListener('message', f); res(); } }; w.addEventListener('message', f); w.postMessage({ clock: t }); });
  window.__w = w;
  await window.__clock(Date.UTC(2027, 0, 1, 6));
  const c = await window.__call('config', { store: 'lrworker' + Math.random().toString(36).slice(2, 6) });
  const p = await window.__call('ping'); return { c: c.ok, p: p.ok ? p.r : p.error, iso: crossOriginIsolated };
})()`;
console.log('setup', await evalJs(setup));
const dayJs = (d) => `(async () => {
  const R = { soc: 50, v: 52.1, i: -3.2, w: -166, ah: 100, tm: 30, t1: 25, t2: 26, ch: 1, ds: 1, bal: 0, err: 0, c: Array.from({ length: 16 }, (_, k) => 3250 + k) };
  const t0 = Date.UTC(2027, 0, 1, 6) + ${d} * 86400e3; await window.__clock(t0);
  const day = new Date(t0).toISOString().slice(0, 10); let id = 0;
  for (let k = 0; k < 30; k++) { const rows = []; for (let i = 0; i < 6; i++) rows.push({ ...R, id: ++id, t: t0 - 50000 + k * 1000 + i * 100, p: i % 2 ? 's-01' : 'm-00' }); const r = await window.__call('insert', { day, rows }); if (!r.ok) return { err: r.error }; }
  await window.__call('info', { day });
  const from = Date.parse(day + 'T00:00:00Z'), rows = []; for (let i = 0; i < ${SEED}; i++) rows.push({ ...R, id: ++id, t: from + Math.floor(i * (86400e3 - 60000 * 60 * 18) / ${SEED}) + 7, p: i % 2 ? 's-01' : 'm-00' });
  const ins = await window.__call('insert', { day, rows }); if (!ins.ok) return { err: ins.error };
  await window.__call('info', { day });
  const list = await window.__call('days'); if (!list.ok) return { err: list.error };
  for (const x of list.r.days) await window.__call('info', { day: x.day });
  await window.__call('query', { p: 'm-00', from: t0 - 7 * 86400e3, to: t0, stepMs: 756000 });
  return { days: list.r.days.length };
})()`;
const mem = `(async () => { const m = await performance.measureUserAgentSpecificMemory(); let w = 0; for (const b of m.breakdown) if (b.attribution.some((a) => /Worker/.test(a.scope))) w += b.bytes; return Math.round(w / 1048576 * 10) / 10; })()`;
const samples = [];
for (let d = 1; d <= DAYS; d++) {
  const r = await evalJs(dayJs(d));
  if (r.err) { console.log(`day ${d}: ERROR ${r.err}`); process.exit(2); }
  if (d % 15 === 0) { const mb = await evalJs(mem); samples.push({ d, mb }); console.log(`day ${d}: ${r.days} day files, worker ${mb} MB`); }
}
const first = samples[0], last = samples[samples.length - 1];
const perDay = (last.mb - first.mb) / (last.d - first.d);
const ok = perDay < 0.05;
console.log(`${ok ? 'PASS' : 'FAIL'}  L-O12: the history worker's memory over the real sahpool does not grow with the stored days: day ${first.d} ${first.mb} MB -> day ${last.d} ${last.mb} MB (${perDay.toFixed(3)} MB per day)`);
ws.close();
await fetch(`http://127.0.0.1:${CDP}/json/close/${page.id}`);
process.exit(ok ? 0 : 1);
