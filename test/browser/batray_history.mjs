// BatRay by ClearEvo.com - tests (batray_history.mjs)
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
// Stored history on the real page over the real SQLite wasm in OPFS (owner
// decisions 2026-09-24): readings become rows in today's day database with
// dense ids, reads and writes fired at the same time all settle, a call past
// its deadline rejects and is logged and three in a row restart the worker,
// the statistics line, backup as a .tar of .sqlite files and a merging
// restore, Browse / delete, rows received from a reader (and junk refused),
// old NDJSON day files left alone, ids continuing after a reload, the chart
// drawn from bucket queries, and Delete through a sheet.
// Run through ./run.sh, or: BASE=... node batray_history.mjs
import { OWNER_32S_CELL, AIO_32S_DEV } from '../batray_frames.js';

const PORT = +(process.env.PORT || 8077), CDP = +(process.env.CDP || 9333);
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); d.error ? err(new Error(JSON.stringify(d.error))) : ok(d.result); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), new Promise((_, rej) => setTimeout(() => rej(new Error('eval timed out after 90 s: ' + expr.slice(0, 120))), 90000))]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let fails = 0;
const T00 = Date.now();
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'} [${Math.round((Date.now() - T00) / 1000)}s] ${name}${cond ? '' : ` - got ${JSON.stringify(got).slice(0, 700)}`}`); if (!cond) fails++; };

// the same fake Web Bluetooth device as the freeze test, so real readings make real rows
const FAKE = `
  const char = new EventTarget(); char.startNotifications = async () => char; char.writeValueWithoutResponse = async () => {};
  const gatt = { connected: false, connect: async () => { gatt.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => char }) }; }, disconnect: () => { if (!gatt.connected) return; gatt.connected = false; window.__dev.dispatchEvent(new Event('gattserverdisconnected')); } };
  const dev = new EventTarget(); dev.id = 'fake-1'; dev.name = 'n11'; dev.gatt = gatt; window.__dev = dev;
  window.__requestDevices = 0;
  navigator.bluetooth = { requestDevice: async () => { window.__requestDevices++; return dev; }, getAvailability: async () => true, getDevices: async () => [dev] };
  const cou = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__backupBlob = b; return cou(b); };
  HTMLAnchorElement.prototype.click = function () { window.__downloadName = this.download; };
  window.__notify = (bytes) => { char.value = new DataView(Uint8Array.from(bytes).buffer); char.dispatchEvent(new Event('characteristicvaluechanged')); };
`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
const notify = (frame) => evalJs(`window.__notify([${[...frame].join(',')}]); 1`);
const connect = async () => { await evalJs(`document.getElementById('connectBig').click(); 1`); await sleep(1500); await notify(AIO_32S_DEV); await notify(OWNER_32S_CELL); await sleep(800); };
const hist = () => evalJs('window.__batrayTest.histState()');
const logs = () => evalJs('window.__batrayTest.logLines()');
const today = new Date().toISOString().slice(0, 10), yday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);

// ---- 1. fresh store: connect, a few readings, flush -> today's database holds rows with dense ids ----
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(3000);
await evalJs('window.__batrayTest.clearHistory()'); await sleep(300);
let ll = await logs();
check('the store opens SQLite over the OPFS pool and says so in the log', ll.some((l) => /history: SQLite 3\.\d+\.\d+ over opfs-sahpool, \d+ files, \d+ ms to open/.test(l)), ll.filter((l) => /history:/.test(l)).slice(0, 5));
await connect();
for (let i = 0; i < 5; i++) { await notify(OWNER_32S_CELL); await sleep(120); }        // a burst: shown, but one stored row per 3 s
for (let i = 0; i < 2; i++) { await sleep(3100); await notify(OWNER_32S_CELL); }       // two more rows, 3 s apart
await evalJs('window.__batrayTest.flushHistory()');
let h = await hist(); let list = await evalJs('window.__batrayTest.histList()');
check("readings become rows in today's SQLite database, one per pack per 3 s however fast the BMS pushes frames (OPFS backend)", h.backend === 'opfs' && h.pending === 0 && list.length === 1 && list[0].day === today && list[0].rows === 3 && list[0].maxId === 3 && list[0].bytes >= 8192 && h.todayRows === 3 && h.nextId === 4, { h, list });
const rows = await evalJs(`window.__batrayTest.histRows('${today}', 0, 100)`);
check('the rows carry dense ids from 1, short keys and the cell millivolts', rows.length === 3 && rows.map((r) => r.id).join() === '1,2,3' && rows.every((r) => r.p === 'n11' && typeof r.soc === 'number' && typeof r.w === 'number' && Array.isArray(r.c) && r.c.length >= 8 && r.c[0] > 3000), rows[0]);
const info = await evalJs(`window.__batrayTest.histInfo('${today}')`);
check('the day info: rows, highest id, complete to the end, the pack', info.rows === 3 && info.maxId === 3 && info.contig === 3 && info.packs.join() === 'n11' && info.bytes > 0, info);

// ---- 2. seed the last two minutes plus a day of yesterday -> two databases, the Storage box, Browse names ----
const seeded = await evalJs(`(() => {
  const now = Date.now(), rows = [];
  for (let i = 120; i >= 1; i--) rows.push({ t: now - i * 1000, p: 'n11', soc: 50 + (i % 10), v: 52.1, i: i % 2 ? 12 : -18, w: i % 2 ? 620 : -930, ah: 150, tm: 30, t1: 25, t2: 26, ch: 1, ds: 1, bal: 0, err: 0, c: null });
  const y0 = Date.parse('${yday}T00:00:00Z');
  for (let i = 0; i < 1440; i += 5) rows.push({ t: y0 + i * 60000, p: 'n11', soc: 70, v: 53, i: 5, w: 260, ah: 200, tm: 30, t1: 25, t2: 26, ch: 1, ds: 1, bal: 0, err: 0, c: null });
  return window.__batrayTest.histSeed(rows);
})()`);
await evalJs('window.__batrayTest.maintainHistory()');
list = await evalJs('window.__batrayTest.histList()'); h = await hist();
check('seeded rows land in their UTC day databases with ids continuing per day', seeded === 408 && list.length === 2 && list[0].day === yday && list[0].rows === 288 && list[1].day === today && list[1].rows === 123 && h.nextId === 124, { seeded, list, next: h.nextId });
const box = await evalJs(`({ use: document.getElementById('stUse').textContent, hist: document.getElementById('stHistSize').textContent, note: document.getElementById('histNote').textContent })`);
check('the Storage box: used of the maximum with a percent, the history row with days, the note says SQLite and .sqlite backups', /^[\d.]+ (KB|MB) of [\d.]+ (GB|MB) \([\d.]+ %\)$/.test(box.use) && /^\d+ KB · 2 days since /.test(box.hist) && /SQLite database per UTC day/.test(box.note) && /\.sqlite/.test(box.note), box);
const hb = await evalJs(`(async () => { document.getElementById('histBrowse').click(); await new Promise((r) => setTimeout(r, 400)); const items = [...document.querySelectorAll('#sheetItems .item')].map((i) => [i.querySelector('.nm').textContent, i.querySelector('.sz').textContent]); history.back(); await new Promise((r) => setTimeout(r, 400)); return items; })()`);
check('Browse lists the day databases newest first with their rows, today marked live', hb.length === 2 && /^\d{4}-\d{2}-\d{2}\.sqlite \(123 rows\) \(today, live\)$/.test(hb[0][0]) && hb[1][0] === `${yday}.sqlite (288 rows)` && /KB/.test(hb[0][1]), hb);

// ---- 3. same time: inserts, chart queries and info calls fired together all settle; the statistics line ----
const storm = await evalJs(`(async () => {
  const T = window.__batrayTest; const t0 = Date.now(); const ps = [];
  const base = Date.parse('2026-09-01T00:00:00Z');
  for (let k = 0; k < 20; k++) {
    ps.push(T.histInsert('2026-09-01', Array.from({ length: 5 }, (_, i) => ({ id: k * 5 + i + 1, t: base + (k * 5 + i) * 3000, p: 'storm', soc: 40, v: 51, w: 100 }))));
    ps.push(T.histQuery({ p: 'n11', from: Date.now() - 6 * 3600e3, to: Date.now(), stepMs: 30000 }));
    if (k % 4 === 0) ps.push(T.histInfo('2026-09-01'));
  }
  const out = await Promise.all(ps);
  const info = await T.histInfo('2026-09-01'); const today = await T.histInfo('${today}');
  return { n: out.length, ms: Date.now() - t0, inserted: out.filter((x) => x && typeof x.inserted === 'number').reduce((a, b) => a + b.inserted, 0), rows: info.rows, contig: info.contig, maxId: info.maxId, todayRows: today.rows, stats: T.histStats(), raw: T.histStatsRaw() };
})()`);
check('20 inserts, 20 chart queries and 5 info calls at the same time all complete, nothing lost, the table stays consistent', storm.n === 45 && storm.inserted === 100 && storm.rows === 100 && storm.contig === 100 && storm.maxId === 100 && storm.todayRows === 123 && storm.ms < 15000, storm);
check('the read/write statistics line counts every kind with mean and max ms and rows moved, no failures', /^history stats: /.test(storm.stats) && /insert=\d+\(\d+ok\) \d+\/\d+ms \d+rows/.test(storm.stats) && /query=\d+\(\d+ok\)/.test(storm.stats) && storm.raw.fails === 0 && storm.raw.timeouts === 0, storm.stats);

// ---- 4. no block forever: a call past its deadline rejects and is logged; three in a row restart the worker ----
const to = await evalJs(`(async () => {
  const T = window.__batrayTest; T.histTimeouts({ slow: 400 });
  const before = T.logLines().length; const t0 = Date.now();
  const r = await T.histSlow(1500).then(() => 'answered', (e) => e.name + ': ' + e.message);
  const ms = Date.now() - t0;
  await new Promise((r) => setTimeout(r, 1400));                         // let the busy worker finish
  const list = await T.histList();
  return { r, ms, logs: T.logLines().slice(before).filter((l) => /history:/.test(l)), raw: T.histStatsRaw(), listOk: Array.isArray(list) };
})()`);
check('a store call past its deadline rejects at the deadline with a TimeoutError, the failure is in the debug log and counted', /^TimeoutError: slow timed out after 0 s$/.test(to.r) && to.ms >= 380 && to.ms < 1200 && to.logs.some((l) => /history: slow TIMED OUT after \d+ ms/.test(l)) && to.raw.timeouts === 1 && to.listOk, to);
const rs = await evalJs(`(async () => {
  const T = window.__batrayTest; T.histTimeouts({ slow: 300, days: 300, insert: 300, query: 300 });
  const before = T.logLines().length;
  const a = await T.histSlow(2500).catch((e) => e.name), b = await T.histSlow(2500).catch((e) => e.name), c = await T.histSlow(2500).catch((e) => e.name);
  const restarted = T.logLines().slice(before).find((l) => /looks stuck: restarting it/.test(l));
  T.histTimeouts({ slow: 15000, days: 8000, insert: 8000, query: 15000 });
  const list = await T.histList().then((l) => l.length, (e) => 'failed: ' + e.message);
  const info = await T.histInfo('${today}');
  return { a, b, c, restarted, list, rows: info.rows, raw: T.histStatsRaw(), stats: T.histStats() };
})()`);
check('three timeouts in a row restart the worker (logged), the fresh worker answers and the data is intact', rs.a === 'TimeoutError' && rs.b === 'TimeoutError' && rs.c === 'TimeoutError' && /restarting it \(restart 1\)/.test(rs.restarted || '') && rs.list === 3 && rs.rows === 123 && rs.raw.restarts === 1 && /restarts=1$/.test(rs.stats), rs);

// ---- 5. backup: a .tar of the day databases; restore after delete merges them back; junk refused ----
const bk = await evalJs('window.__batrayTest.backupHistory()');
const bkParsed = await evalJs(`(async () => { const b = window.__backupBlob; const bytes = new Uint8Array(await b.arrayBuffer()); const m = window.__batrayTest.tarParse(bytes); return { size: bytes.length, name: window.__downloadName, members: m.map((e) => e.name), heads: m.map((e) => new TextDecoder().decode(e.bytes.subarray(0, 15))) }; })()`);
check('Download history gives batray-history-<day>.tar with one real SQLite file per day', bk && bk.days === 3 && /^batray-history-\d{4}-\d{2}-\d{2}\.tar$/.test(bkParsed.name) && bkParsed.members.length === 3 && bkParsed.members.every((n) => /^batray-history\/\d{4}-\d{2}-\d{2}\.sqlite$/.test(n)) && bkParsed.heads.every((x) => x === 'SQLite format 3'), bkParsed);
await evalJs('window.__batrayTest.clearHistory()'); await sleep(300);
const rsd = await evalJs(`(async () => { const bytes = new Uint8Array(await window.__backupBlob.arrayBuffer()); return window.__batrayTest.restoreHistory(bytes, 'test'); })()`);
list = await evalJs('window.__batrayTest.histList()'); h = await hist();
check('Restore from that backup brings every day back with its rows, today\'s ids continue after the restored ones', rsd && rsd.written === 3 && rsd.failed === 0 && list.length === 3 && list.find((d) => d.day === today).rows === 123 && list.find((d) => d.day === yday).rows === 288 && list.find((d) => d.day === '2026-09-01').rows === 100 && h.nextId === 124, { rsd, list, next: h.nextId });
const again = await evalJs(`(async () => { const before = window.__batrayTest.logLines().length; const bytes = new Uint8Array(await window.__backupBlob.arrayBuffer()); const r = await window.__batrayTest.restoreHistory(bytes, 'again'); return { r, logs: window.__batrayTest.logLines().slice(before).filter((l) => /restored/.test(l)), list: await window.__batrayTest.histList() }; })()`);
check('restoring the same backup again merges by (pack, time): nothing added twice', again.r.written === 3 && again.logs.length === 3 && again.logs.every((l) => /: 0 rows merged into this device's copy/.test(l)) && again.list.find((d) => d.day === today).rows === 123, again);
const bad = await evalJs(`window.__batrayTest.restoreHistory(new Uint8Array(2048).fill(9), 'junk')`);
const badToast = await evalJs(`document.getElementById('toast').textContent`);
check('junk is refused with a toast', bad === null && /Not a BatRay backup/.test(badToast), badToast);
const badMember = await evalJs(`(async () => { const T = window.__batrayTest; const before = T.logLines().length; const tar = (await import('./backup-logic.js')).tarPack([{ name: 'batray-history/2026-09-10.sqlite', bytes: new Uint8Array(4096).fill(1) }]); const r = await T.restoreHistory(tar, 'badmember'); return { r, logs: T.logLines().slice(before).filter((l) => /history:/.test(l)), list: (await T.histList()).map((d) => d.day) }; })()`).catch((e) => ({ err: e.message }));
check('a member that is not a SQLite day database is refused and logged, nothing stored', badMember.r && badMember.r.failed === 1 && badMember.r.written === 0 && badMember.logs.some((l) => /import failed after \d+ ms: not a SQLite database/.test(l)) && !badMember.list.includes('2026-09-10'), badMember);

// ---- 6. rows from a reader (the viewer path): a gzipped JSON file of rows with ids is stored; junk refused; a hole is logged ----
const rx = await evalJs(`(async () => {
  const T = window.__batrayTest;
  const rows = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, t: Date.parse('2026-09-10T00:00:00Z') + i * 60000, p: 'n11', soc: 33, v: 51, w: -100 }));
  const gz = await T.gzipBytes(new TextEncoder().encode(JSON.stringify(rows)));
  let b = ''; for (const x of gz) b += String.fromCharCode(x);
  await T.storeReceived({ day: '2026-09-10', after: 0, b64: btoa(b) });
  const l = await T.histList(); const d = l.find((x) => x.day === '2026-09-10');
  const back = await T.histRows('2026-09-10', 0, 1000);
  return { d, rows: back.length, first: back[0], gzLen: gz.length };
})()`);
check('a row file from the reader is stored as that day with the reader\'s ids', rx.d && rx.d.rows === 300 && rx.d.maxId === 300 && rx.rows === 300 && rx.first.id === 1 && rx.first.soc === 33, rx);
const badRx = await evalJs(`window.__batrayTest.storeReceived({ day: '2026-09-11', after: 0, b64: btoa('not gzip') }).then(() => 'stored', (e) => 'refused: ' + e.message)`);
const noIds = await evalJs(`(async () => { const T = window.__batrayTest; const gz = await T.gzipBytes(new TextEncoder().encode(JSON.stringify([{ t: 1, p: 'x' }]))); let b = ''; for (const x of gz) b += String.fromCharCode(x); return T.storeReceived({ day: '2026-09-11', after: 0, b64: btoa(b) }).then(() => 'stored', (e) => 'refused: ' + e.message); })()`);
check('a broken file and a file of rows without ids are refused, never stored', /^refused/.test(badRx) && /^refused: not a row file/.test(noIds) && !(await evalJs('window.__batrayTest.histList()')).some((d) => d.day === '2026-09-11'), { badRx, noIds });
const gap = await evalJs(`(async () => {
  const T = window.__batrayTest; const hs = T.histState(); const before = T.logLines().length;
  const row = { id: hs.contig + 5, t: Date.now(), p: 'rem', soc: 40, v: 52, w: 10 };
  T.remoteTake('rem', { soc: 40 }, row.t, row);
  const after = T.histState(); await T.flushHistory();
  const info = await T.histInfo(hs.day);
  return { gap: after.gap, logs: T.logLines().slice(before).filter((l) => /history:/.test(l)), maxId: info.maxId, contig: info.contig, expected: hs.contig + 5 };
})()`);
check('a live row from a reader beyond this copy\'s complete prefix is stored, marked as a hole and logged', gap.gap === 'gap' && gap.logs.some((l) => /arrived but this copy is complete only to \d+: stored, asking the reader/.test(l)) && gap.maxId === gap.expected && gap.contig < gap.maxId, gap);
const plan = await evalJs(`(async () => { const before = window.__batrayTest.logLines().length; await window.__batrayTest.histRequest({ from: 'v1abcd', have: [] }); return window.__batrayTest.logLines().slice(before).join(' | '); })()`);
check('a history request while not sharing is logged and ignored', /request from v1abcd ignored \(not sharing\)/.test(plan), plan);

// ---- 7. old NDJSON day files (raw and gz) from before 0.9.40 are neither read nor migrated (owner: day 0); one log line ----
const oldA = new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10), oldB = new Date(Date.now() - 4 * 86400e3).toISOString().slice(0, 10);
await evalJs(`(async () => {
  const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('batray-history', { create: true });
  const lines = (day, n) => Array.from({ length: n }, (_, i) => JSON.stringify({ t: Date.parse(day + 'T00:00:00Z') + i * 60000, n: i + 1, o: i * 90, p: 'old', soc: 60, v: 52, w: 200, c: [3300, 3301] })).join('\\n') + '\\n';
  const raw = await d.getFileHandle('${oldA}.ndjson', { create: true }); let w = await raw.createWritable(); await w.write(lines('${oldA}', 50) + '{"t":1,"torn'); await w.close();
  const gzb = new Uint8Array(await new Response(new Blob([lines('${oldB}', 40)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const gzf = await d.getFileHandle('${oldB}.ndjson.gz', { create: true }); w = await gzf.createWritable(); await w.write(gzb); await w.close();
  return 1;
})()`);
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(4000);
ll = await logs(); list = await evalJs('window.__batrayTest.histList()');
const leftover = await evalJs(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('batray-history'); const names = []; for await (const [n] of d.entries()) names.push(n); return names.filter((n) => /^\\d{4}-\\d{2}-\\d{2}\\.ndjson/.test(n)); })()`);
check('old NDJSON day files are left alone at start: one log line says they are not read any more, they are not listed as days', ll.some((l) => /history: 2 day files from before 0\.9\.40 \(\d+ MB, NDJSON\) are not read any more; Clear stored history removes them/.test(l)) && !list.some((d) => d.day === oldA || d.day === oldB) && leftover.length === 2 && !ll.some((l) => /moved .* into/.test(l)), { leftover, list, logs: ll.filter((l) => /history:/.test(l)) });

// ---- 8. reload: ids continue from the database, the chart draws at once from bucket queries, 7 d reads the past days ----
h = await hist();
check('after a reload today\'s counters come from its database: rows, next id, complete prefix', h.backend === 'opfs' && h.todayRows === 124 && h.nextId === 129 && h.contig === 123 && h.days.length === 4, h);
check('the start line says what is stored', ll.some((l) => /history: opfs, 4 days, \d+ KB, oldest 2026-09-01, today 124 rows \(highest id 128, complete to 123\)/.test(l)), ll.filter((l) => /history: opfs/.test(l)));
const known = await evalJs(`({ shown: !document.getElementById('connectKnown').hidden, txt: document.getElementById('connectKnown').textContent })`);
check('the remembered BMS shows as a green "Connect to n11" button after a reload', known.shown && known.txt === 'Connect to n11', known);
await evalJs(`document.getElementById('connectKnown').click(); 1`); await sleep(1500); await notify(AIO_32S_DEV); await notify(OWNER_32S_CELL); await sleep(1200);
let card = await evalJs(`({ shown: !document.getElementById('trendCard').hidden, wait: !document.getElementById('trendWait').hidden, energy: document.getElementById('trendEnergy').textContent, cw: (document.querySelector('#trend canvas') || {}).width || 0, on: (document.querySelector('#histRanges button.on') || {}).dataset?.range, series: window.__batrayTest.histState().series })`);
check('with stored history the chart shows on the first reading, no 30 s wait, drawn by uPlot from bucket queries', card.shown && !card.wait && card.cw > 100 && /charged .* · discharged/.test(card.energy) && card.on === '6h' && card.series > 10, card);
await evalJs(`document.querySelector('#histRanges button[data-range="7d"]').click(); 1`); await sleep(1500);
card = await evalJs(`({ on: document.querySelector('#histRanges button.on').dataset.range, range: window.__batrayTest.histState().range, energy: document.getElementById('trendEnergy').textContent, saved: localStorage.getItem('batray_hist_range'), series: window.__batrayTest.histState().series, stats: window.__batrayTest.histStats() })`);
check('the 7 d range queries the past day databases in buckets and is remembered', card.on === '7d' && card.range === '7d' && card.saved === '7d' && /last 7 d( 0 h)?: charged/.test(card.energy) && card.series > 100 && /query=\d+\(\d+ok\)/.test(card.stats), card);
await evalJs(`document.querySelector('#histRanges button[data-range="6h"]').click(); 1`);
const memLine = await evalJs(`(() => { window.__batrayTest.memTick(); return document.getElementById('memUse').textContent; })()`);
check('the memory line counts queued readings, not a table in memory', /· \d+ readings in memory/.test(memLine) && !/\d{4,} readings/.test(memLine), memLine);

// ---- 9. Browse deletes one day; Delete through a sheet empties the store, never confirm() ----
const del = await evalJs(`(async () => { const T = window.__batrayTest; T.openBrowse('hist'); await new Promise((r) => setTimeout(r, 400)); await T.browseDelete('2026-09-10'); await new Promise((r) => setTimeout(r, 300)); history.back(); await new Promise((r) => setTimeout(r, 300)); return (await T.histList()).map((d) => d.day); })()`);
check('Browse deletes one day database on its own', del.length === 3 && !del.includes('2026-09-10'), del);
await evalJs(`window.__confirms = 0; window.confirm = () => { window.__confirms++; return true; }; document.getElementById('histClear').click(); 1`); await sleep(400);
const sheet = await evalJs(`({ open: !document.getElementById('sheet').hidden, text: document.getElementById('sheet').textContent.replace(/\\s+/g, ' ').slice(0, 160), buttons: [...document.querySelectorAll('#sheet button')].map((b) => b.textContent.trim()) })`);
check('Delete stored history opens a sheet with Cancel / Delete and the size', sheet.open && sheet.buttons.includes('Delete') && sheet.buttons.includes('Cancel') && /\d+ days?, \d+ KB/.test(sheet.text), sheet);
await evalJs(`[...document.querySelectorAll('#sheet button')].find((b) => b.textContent.trim() === 'Delete').click(); 1`); await sleep(1000);
h = await hist(); list = await evalJs('window.__batrayTest.histList()');
const after = await evalJs(`({ confirms: window.__confirms, toast: document.getElementById('toast').textContent, wait: getComputedStyle(document.getElementById('trendWait')).display !== 'none', card: document.getElementById('trendCard').hidden })`);
const oldLeft = await evalJs(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('batray-history'); const names = []; for await (const [n] of d.entries()) names.push(n); return names.filter((n) => /^\\d{4}-\\d{2}-\\d{2}\\.ndjson/.test(n)); })()`);
check('Clear stored history also removes the old NDJSON day files', oldLeft.length === 0, oldLeft);
check('the store is empty afterwards, a toast says so, and the History tab shows the collecting bar again', list.length === 0 && h.days.length === 0 && h.nextId === 1 && after.confirms === 0 && /deleted/i.test(after.toast) && after.wait && after.card, { h, list, after });

// ---- last: a worker stuck in JavaScript. Chrome's terminate() never releases its OPFS access handles (probed in
// this sandbox 2026-09-24: not after 2 min), so the fresh worker cannot take the pool; the store must not fail
// every call for the rest of the session - it goes memory-only, says so, and a reload takes the pool back ----
const lock = await evalJs(`(async () => {
  const T = window.__batrayTest; T.histTimeouts({ spin: 300, days: 8000, insert: 8000, query: 15000 });
  const before = T.logLines().length; const t0 = Date.now();
  await T.histSpin(2500).catch(() => 0); await T.histSpin(2500).catch(() => 0); await T.histSpin(2500).catch(() => 0);
  const list = await T.histList().then((l) => 'ok ' + l.length, (e) => 'failed: ' + e.message);
  const ins = await T.histInsert('${today}', [{ id: 1, t: Date.now(), p: 'mem', soc: 1, v: 1, w: 1 }]).then((r) => r.inserted, (e) => 'failed: ' + e.message);
  return { list, ins, ms: Date.now() - t0, backend: T.histState().backend, box: document.getElementById('storage').textContent.replace(/\\s+/g, ' ').slice(0, 200), logs: T.logLines().slice(before).filter((l) => /history/.test(l)) };
})()`);
check('a worker stuck in JavaScript: restarted, the pool stays locked, the store goes memory-only within 25 s, says so in the log, the Storage box says not stored, calls answer', /restarting it \(restart 1\)/.test(lock.logs.join('\n')) && /pool busy .* try 1 of 40/.test(lock.logs.join('\n')) && /storage pool stayed locked \d+ s after the worker restart .* reload the page to store again/.test(lock.logs.join('\n')) && lock.list === 'ok 0' && lock.ins === 1 && lock.backend === 'memory' && lock.ms > 15000 && lock.ms < 30000 && /cannot store files: history covers this session only/.test(lock.box), lock);
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(4000);
ll = await logs();
check('a reload takes the pool back: SQLite over OPFS again', ll.some((l) => /history: SQLite 3\.\d+\.\d+ over opfs-sahpool/.test(l)) && ll.some((l) => /history: opfs, 0 days/.test(l)), ll.filter((l) => /history/.test(l)));

// ---- corruption (owner rule 2026-09-24): a damaged day file raises on read and on write; no repair - the live
// writer deletes today's file and starts a new one with the flush's rows, a history reader deletes the file.
// Both log and toast. The page is fresh after the reload above (the pool taken back, nothing stored). ----
await connect();
for (let i = 0; i < 2; i++) { await sleep(3100); await notify(OWNER_32S_CELL); }
await evalJs('window.__batrayTest.flushHistory()');
const before = await evalJs(`window.__batrayTest.histInfo('${today}')`);
const live = await evalJs(`(async () => {
  const T = window.__batrayTest; const before = T.logLines().length;
  const dmg = await T.histCorrupt('${today}');
  await new Promise((r) => setTimeout(r, 3100));                          // one stored row per pack per 3 s
  window.__notify([${[...OWNER_32S_CELL].join(',')}]); await new Promise((r) => setTimeout(r, 200));
  await T.flushHistory();
  const info = await T.histInfo('${today}'); const rows = await T.histRows('${today}', 0, 10);
  return { dmg, info, ids: rows.map((r) => r.id), state: T.histState(), toast: document.getElementById('toast').textContent, hidden: document.getElementById('toast').hidden, logs: T.logLines().slice(before).filter((l) => /history/.test(l)), stats: T.histStatsRaw() };
})()`);
// whichever touches the damaged file first raises: the span refresh on the reading (a history read) or the flush's
// insert (the live write); today is renewed either way and the flush's row lands in the new file as id 1
check("a damaged today's file: the worker names the day and raises, the caller logs it, toasts, deletes the file, a new one starts and the flush's row is its id 1", before.rows >= 2 && live.dmg.bytes > 0
  && live.logs.some((l) => new RegExp(`history worker: ${today} database is corrupt \\((insert|span|query|info|days)\\): SQLITE_CORRUPT`).test(l))
  && live.logs.some((l) => new RegExp(`history: (insert|span|query|info|days) failed after \\d+ ms: ${today} database is corrupt`).test(l))
  && live.logs.some((l) => new RegExp(`history: (live write|history read): ${today} database is corrupt -> renew: deleted, a new live file starts`).test(l))
  && live.info.rows === 1 && live.info.maxId === 1 && live.info.contig === 1 && live.ids.join() === '1' && live.state.nextId === 2 && live.state.todayRows === 1
  && !live.hidden && /damaged: it was deleted and a new one started/.test(live.toast) && live.stats.restarts === 0, live);
const more = await evalJs(`(async () => { const T = window.__batrayTest; window.__notify([${[...OWNER_32S_CELL].join(',')}]); await new Promise((r) => setTimeout(r, 3200)); window.__notify([${[...OWNER_32S_CELL].join(',')}]); await new Promise((r) => setTimeout(r, 200)); await T.flushHistory(); return (await T.histRows('${today}', 0, 10)).map((r) => r.id); })()`);
check('the new live file keeps taking rows with dense ids', more.join() === '1,2', more);
await evalJs(`window.__batrayTest.histInsert('2026-09-05', Array.from({ length: 20 }, (_, i) => ({ id: i + 1, t: Date.UTC(2026, 8, 5, 0, 0, 0) + i * 60000, p: 'n11', soc: 50, v: 52, w: 100 })))`);
const past = await evalJs(`(async () => {
  const T = window.__batrayTest; const before = T.logLines().length; document.getElementById('toast').hidden = true;
  await T.histCorrupt('2026-09-05');
  await T.maintainHistory();                                                 // a history read: the day listing opens every file
  const list = (await T.histList()).map((d) => d.day); const info = await T.histInfo('${today}');
  return { list, today: info.rows, toast: document.getElementById('toast').textContent, hidden: document.getElementById('toast').hidden, logs: T.logLines().slice(before).filter((l) => /history/.test(l)) };
})()`);
check('history read of a damaged past day: the worker raises, the reader logs it, toasts and deletes that file; today is untouched', past.logs.some((l) => /history worker: 2026-09-05 database is corrupt \((days|info)\): SQLITE_CORRUPT/.test(l))
  && past.logs.some((l) => /history: history read: 2026-09-05 database is corrupt -> drop: deleted$/.test(l))
  && !past.list.includes('2026-09-05') && past.list.includes(today) && past.today === 2 && !past.hidden && /history file of 2026-09-05 was damaged and has been deleted/.test(past.toast), past);

const thrown = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
check('no page exceptions', thrown.length === 0, thrown);
ws.close();
console.log(fails ? 'BATRAY HISTORY TEST FAILED' : 'batray history test ok');
process.exit(fails ? 1 : 0);
