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
// Stored history (phase 3, 2026-09-21) on the real page: rows written to OPFS
// day files survive a reload, a past day is gzipped by maintenance and reads
// back, the History card draws with uPlot and its range buttons, and "Delete
// stored history" goes through a sheet and empties the store.
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
const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let fails = 0;
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` - got ${JSON.stringify(got).slice(0, 600)}`}`); if (!cond) fails++; };

// the same fake Web Bluetooth device as the freeze test, so real readings make real rows
const FAKE = `
  const char = new EventTarget(); char.startNotifications = async () => char; char.writeValueWithoutResponse = async () => {};
  const gatt = { connected: false, connect: async () => { gatt.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => char }) }; }, disconnect: () => { if (!gatt.connected) return; gatt.connected = false; window.__dev.dispatchEvent(new Event('gattserverdisconnected')); } };
  const dev = new EventTarget(); dev.id = 'fake-1'; dev.name = 'n11'; dev.gatt = gatt; window.__dev = dev;
  window.__requestDevices = 0;
  navigator.bluetooth = { requestDevice: async () => { window.__requestDevices++; return dev; }, getAvailability: async () => true, getDevices: async () => [dev] };
  // the backup download: keep the blob instead of navigating
  const cou = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__backupBlob = b; return cou(b); };
  HTMLAnchorElement.prototype.click = function () { window.__downloadName = this.download; };
  window.__notify = (bytes) => { char.value = new DataView(Uint8Array.from(bytes).buffer); char.dispatchEvent(new Event('characteristicvaluechanged')); };
`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
const notify = (frame) => evalJs(`window.__notify([${[...frame].join(',')}]); 1`);
const connect = async () => { await evalJs(`document.getElementById('connectBig').click(); 1`); await sleep(1500); await notify(AIO_32S_DEV); await notify(OWNER_32S_CELL); await sleep(800); };
const hist = () => evalJs('window.__batrayTest.histState()');

// ---- 1. fresh store: connect, a few readings, flush -> today's file exists ----
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(2500);
await evalJs('window.__batrayTest.clearHistory()'); await sleep(300);
await connect();
for (let i = 0; i < 5; i++) { await notify(OWNER_32S_CELL); await sleep(120); }
await evalJs('window.__batrayTest.flushHistory()');
let h = await hist(); let list = await evalJs('window.__batrayTest.histList()');
const today = list.length ? list[list.length - 1].day : null;
check("readings become rows in today's NDJSON file (OPFS backend, persistence asked)", h.backend === 'opfs' && h.mem >= 6 && h.pending === 0 && list.length === 1 && list[0].raw && !list[0].gz && list[0].bytes > 200 && h.persistent !== null, { h, list });
const text = await evalJs(`window.__batrayTest.histRead('${today}')`);
const lines = text.trim().split('\n');
const parsedRows = lines.map((l) => JSON.parse(l));
const offsetsOk = parsedRows.every((r, i) => r.n === i + 1 && r.o === lines.slice(0, i).reduce((a, l) => a + new TextEncoder().encode(l).length + 1, 0));
check('each row is one JSON line with its row number and byte offset in the file, short keys and the cell millivolts', lines.length === h.mem && lines.every((l) => /^\{"t":\d+,"n":\d+,"o":\d+,"p":"n11","soc":/.test(l)) && offsetsOk && /"c":\[\d+/.test(lines[0]) && h.todayBytes === text.length && h.todayRows === lines.length, { n: lines.length, mem: h.mem, first: lines[0].slice(0, 120), h });
check('the day file is the UTC day', today === new Date().toISOString().slice(0, 10), today);

// ---- 2. seed two hours of today plus a day of yesterday, flush, maintain -> yesterday gzipped ----
await evalJs(`(() => {
  const now = Date.now(), rows = [];
  for (let i = 120; i >= 1; i--) rows.push({ t: now - i * 60000, p: 'n11', soc: 50 + (i % 10), v: 52.1, i: i % 2 ? 12 : -18, w: i % 2 ? 620 : -930, ah: 150, tm: 30, t1: 25, t2: 26, ch: 1, ds: 1, bal: 0, err: 0, c: null });
  for (let i = 0; i < 1440; i += 5) rows.push({ t: now - 26 * 3600e3 - i * 60000, p: 'n11', soc: 70, v: 53, i: 5, w: 260, ah: 200, tm: 30, t1: 25, t2: 26, ch: 1, ds: 1, bal: 0, err: 0, c: null });
  return window.__batrayTest.histSeed(rows);
})()`);
await evalJs('window.__batrayTest.flushHistory()');
await evalJs('window.__batrayTest.maintainHistory()');
list = await evalJs('window.__batrayTest.histList()');
const past = list.filter((d) => d.day !== today);
check('a past day is compacted to .ndjson.gz by maintenance, today stays raw', past.length >= 1 && past.every((d) => d.gz && !d.raw) && list.find((d) => d.day === today).raw, list);
const pastText = await evalJs(`window.__batrayTest.histRead('${past[0].day}')`);
check('the gzipped day reads back inflated', pastText.split('\n').filter(Boolean).length >= 100 && /"soc":70/.test(pastText), { len: pastText.length });
const note = await evalJs(`document.getElementById('histNote').textContent`);
check('the History card says days, used vs the browser maximum, the estimated days left and the auto-delete rule', /Stored on this device: \d+ days? since \d{4}-\d{2}-\d{2}, \d+ KB of the [\d.]+ (GB|MB) this browser allows, room for (about [\d,]+ more days|more than ten years) .* less than 100 MB stay free/.test(note), note);

// ---- 2b. torn tail: a half-written last line is never joined to the next rows, read, gzipped or sent ----
await evalJs(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('batray-history'); const fh = await d.getFileHandle('${today}.ndjson'); const w = await fh.createWritable({ keepExistingData: true }); const f = await fh.getFile(); await w.seek(f.size); await w.write('{"t":1,"p":"n11","soc":'); await w.close(); })()`);
await evalJs(`window.__batrayTest.histSeed([{ t: Date.now() - 100, p: 'n11', soc: 51, v: 52, i: 1, w: 50, ah: 1, tm: 1, t1: 1, t2: 1, ch: 1, ds: 1, bal: 0, err: 0, c: null }])`);
await evalJs('window.__batrayTest.flushHistory()');
const torn = await evalJs(`window.__batrayTest.histRead('${today}')`);
const tornLines = torn.split('\n');
check('a torn tail is closed with a newline before the next append and is skipped when reading', tornLines.every((l) => !l || l.startsWith('{"t":')) && torn.endsWith('\n') && !/"soc":\{"t"/.test(torn) && /"soc":51/.test(torn), { tail: torn.slice(-160) });

// ---- 2b2. a viewer's copy of today: the reader's rows land at the offsets they name; a hole holds rows and asks for the tail ----
const rep = await evalJs(`(async () => {
  const T = window.__batrayTest; const hs0 = T.histState();
  const day = hs0.day; const base = Date.now();
  const mk = (n, o, i) => ({ t: base + i, n, o, p: 'rem', soc: 40, v: 52, w: 10 });
  let o = hs0.todayBytes + hs0.pending * 0;                       // after flush: pending 0
  const rows = []; for (let i = 0; i < 3; i++) { const r = mk(hs0.todayRows + 1 + i, o, i); rows.push(r); o += T.lineBytes(r); }
  for (const r of rows) T.remoteTake('rem', { soc: r.soc }, r.t, r);
  const afterAppend = T.histState();
  const gapRow = mk(hs0.todayRows + 5, o + 80, 10);                 // row 4 never arrived
  const before = T.logLines().length;
  T.remoteTake('rem', { soc: 1 }, gapRow.t, gapRow);
  const held = T.histHeld(); const hs1 = T.histState(); const logs = T.logLines().slice(before).join(' | ');
  await T.flushHistory();
  const text = await T.histRead(day); const tail = text.trim().split('\\n').slice(-3).map((l) => JSON.parse(l));
  return { day, expected: o, afterAppend, held: held.map((r) => r.n), gap: hs1.gap, logs, tailN: tail.map((r) => r.n), tailO: tail.map((r) => r.o), fileLen: text.length, storedRows: hs1.todayRows };
})()`);
check('rows from the reader are appended exactly at the offsets they name, and a hole holds the row and logs it', rep.afterAppend.pendBytes === 0 || rep.afterAppend.pending > 0, rep);
check('...the three rows sit at the end of the file with their numbers, the file ends where the next row was expected', rep.tailN.join() === rep.tailN.map((_, i) => rep.tailN[0] + i).join() && rep.fileLen === rep.expected && rep.gap === 'gap' && rep.held.length === 1 && /starts at \d+ B but this copy ends at \d+ B \(gap\): holding it/.test(rep.logs), rep);
const tailIn = await evalJs(`(async () => {
  const T = window.__batrayTest; const hs = T.histState(); const held = T.histHeld()[0];
  const missing = { t: held.t - 5, n: held.n - 1, o: hs.todayBytes, p: 'rem', soc: 2, v: 52, w: 10 };
  missing.x = ''; let line = JSON.stringify(missing);
  missing.x = 'p'.repeat(held.o - hs.todayBytes - (new TextEncoder().encode(line).length + 1)); line = JSON.stringify(missing);
  const text = line + '\\n';
  const gz = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let b = ''; for (const x of gz) b += String.fromCharCode(x);
  const before = T.logLines().length;
  await T.storeReceived({ day: hs.day, live: true, from: hs.todayBytes, replace: false, b64: btoa(b) });
  await T.flushHistory();
  const after = T.histState(); const file = await T.histRead(hs.day); const last = JSON.parse(file.trim().split('\\n').pop());
  return { fits: new TextEncoder().encode(text).length === held.o - hs.todayBytes, heldAfter: T.histHeld().length, gap: after.gap, lastN: last.n, heldN: held.n, fileLen: file.length, expectedLen: held.o + T.lineBytes(held), logs: T.logLines().slice(before).join(' | ') };
})()`);
check('a tail from the reader lands at the copy\'s end, the held row is placed after it and the copy is whole again', tailIn.fits && tailIn.heldAfter === 0 && tailIn.gap === null && tailIn.lastN === tailIn.heldN && tailIn.fileLen === tailIn.expectedLen && /held rows: 1 placed/.test(tailIn.logs), tailIn);
const wrongTail = await evalJs(`window.__batrayTest.storeReceived({ day: window.__batrayTest.histState().day, live: true, from: 7, replace: false, b64: btoa('x') }).then(() => 'stored', (e) => 'refused: ' + e.message)`);
check('a tail for the wrong offset is refused', /^refused/.test(wrongTail), wrongTail);

// ---- 2c. backup: a .tar of the daily gzip files; restore after delete brings the days back ----
const bk = await evalJs('window.__batrayTest.backupHistory()');
const bkParsed = await evalJs(`(async () => { const b = window.__backupBlob; const bytes = new Uint8Array(await b.arrayBuffer()); const m = window.__batrayTest.tarParse(bytes); return { size: bytes.length, name: window.__downloadName, members: m.map((e) => e.name), ok: m.every((e) => e.bytes[0] === 0x1f && e.bytes[1] === 0x8b) }; })()`);
check('Back up history downloads batray-history-<day>.tar with one gzip member per day', bk && bk.days === list.length && /^batray-history-\d{4}-\d{2}-\d{2}\.tar$/.test(bkParsed.name) && bkParsed.members.length === list.length && bkParsed.members.every((n) => /^batray-history\/\d{4}-\d{2}-\d{2}\.ndjson\.gz$/.test(n)) && bkParsed.ok && bkParsed.size % 512 === 0, { bk, bkParsed });
await evalJs('window.__batrayTest.clearHistory()'); await sleep(300);
const rs = await evalJs(`(async () => { const bytes = new Uint8Array(await window.__backupBlob.arrayBuffer()); return window.__batrayTest.restoreHistory(bytes, 'test'); })()`);
list = await evalJs('window.__batrayTest.histList()'); h = await hist();
const restoredToday = await evalJs(`window.__batrayTest.histRead('${today}')`);
check('Restore from that backup brings every day back (past days as gz, today too) and reloads memory', rs && rs.written === bkParsed.members.length && rs.failed === 0 && list.length === bkParsed.members.length && h.mem >= 120 && /"soc":51/.test(restoredToday), { rs, list, mem: h.mem });
const rs2 = await evalJs(`(async () => { const bytes = new Uint8Array(await window.__backupBlob.arrayBuffer()); return window.__batrayTest.restoreHistory(bytes, 'again'); })()`);
check('restoring the same backup again writes nothing (every day already here)', rs2.written === 0 && rs2.skipped === bkParsed.members.length, rs2);
const bad = await evalJs(`window.__batrayTest.restoreHistory(new Uint8Array(2048).fill(9), 'junk')`);
const badToast = await evalJs(`document.getElementById('toast').textContent`);
check('junk is refused with a toast', bad === null && /Not a BatRay backup/.test(badToast), badToast);

// ---- 2d. a day file received from the reader (viewer path) is verified, stored and shows in the listing ----
const rx = await evalJs(`(async () => {
  const text = Array.from({ length: 300 }, (_, i) => JSON.stringify({ t: new Date('2026-09-10T00:00:00').getTime() + i * 60000, p: 'n11', soc: 33, v: 51, w: -100 })).join('\\n') + '\\n';
  const gz = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let b = ''; for (const x of gz) b += String.fromCharCode(x);
  await window.__batrayTest.storeReceived({ day: '2026-09-10', live: false, b64: btoa(b) });
  const l = await window.__batrayTest.histList(); const d = l.find((x) => x.day === '2026-09-10');
  const back = await window.__batrayTest.histRead('2026-09-10');
  return { d, rows: back.split('\\n').filter(Boolean).length, gzLen: gz.length };
})()`);
check('a gzipped day from the reader is stored as that day\'s .gz and reads back', rx.d && rx.d.gz && !rx.d.raw && rx.d.bytes === rx.gzLen && rx.rows === 300, rx);
const badRx = await evalJs(`window.__batrayTest.storeReceived({ day: '2026-09-11', live: false, b64: btoa('not gzip') }).then(() => 'stored', (e) => 'refused: ' + e.message)`);
check('a broken file is refused, never stored', /^refused/.test(badRx) && !(await evalJs('window.__batrayTest.histList()')).some((d) => d.day === '2026-09-11'), badRx);
const plan = await evalJs(`(async () => { const before = window.__batrayTest.logLines().length; await window.__batrayTest.histRequest({ from: 'v1abcd', have: [] }); return window.__batrayTest.logLines().slice(before).join(' | '); })()`);
check('a history request while not sharing is logged and ignored', /request from v1abcd ignored \(not sharing\)/.test(plan), plan);

// ---- 3. reload: rows come back from the files and the chart draws at once ----
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(2500);
h = await hist();
const sealed = await evalJs(`window.__batrayTest.histRead(window.__batrayTest.histState().day).then((t) => ({ len: t.length, rows: t.split('\\n').length - 1, endsNl: t.endsWith('\\n') }))`);
check('after a reload the last 24 h are back in memory from the day files, and row numbering continues from the sealed file', h.backend === 'opfs' && h.mem >= 120 && h.todayRows === sealed.rows && h.todayBytes === sealed.len && sealed.endsNl, { h, sealed });
const known = await evalJs(`({ shown: !document.getElementById('connectKnown').hidden, txt: document.getElementById('connectKnown').textContent, green: getComputedStyle(document.getElementById('connectKnown')).backgroundImage.includes('linear-gradient'), above: document.getElementById('connectKnown').nextElementSibling.id, saved: localStorage.getItem('batray_known_dev') })`);
check('the remembered BMS shows as a green "Connect to n11" button above Connect after a reload', known.shown && known.txt === 'Connect to n11' && known.green && known.above === 'connectBig' && /"name":"n11"/.test(known.saved), known);
await evalJs(`document.getElementById('connectKnown').click(); 1`); await sleep(1500); await notify(AIO_32S_DEV); await notify(OWNER_32S_CELL); await sleep(800);
const kc = await evalJs(`({ choosers: window.__requestDevices, stat: document.getElementById('stat').textContent, gatt: window.__dev.gatt.connected, origin: window.__batrayTest.connState().origin })`);
check('...and it connects without opening the chooser', kc.choosers === 0 && kc.gatt === true && /^connected/i.test(kc.stat) && kc.origin === 'known', kc);
await sleep(400);
let card = await evalJs(`({ shown: !document.getElementById('trendCard').hidden, wait: !document.getElementById('trendWait').hidden, energy: document.getElementById('trendEnergy').textContent, cw: (document.querySelector('#trend canvas') || {}).width || 0, on: (document.querySelector('#histRanges button.on') || { dataset: {} }).dataset.range, plot: window.__batrayTest.histState().plot })`);
check('with stored history the chart shows on the first reading, no 30 s wait, drawn by uPlot', card.shown && !card.wait && card.plot && card.cw > 100 && /charged .* · discharged/.test(card.energy) && card.on === '6h', card);
await evalJs(`document.querySelector('#histRanges button[data-range="7d"]').click(); 1`); await sleep(800);
card = await evalJs(`({ on: document.querySelector('#histRanges button.on').dataset.range, range: window.__batrayTest.histState().range, energy: document.getElementById('trendEnergy').textContent, saved: localStorage.getItem('batray_hist_range') })`);
check('the 7 d range button reads the past day file and is remembered', card.on === '7d' && card.range === '7d' && card.saved === '7d' && /last 7 d( 0 h)?: charged/.test(card.energy), card);
await evalJs(`document.querySelector('#histRanges button[data-range="6h"]').click(); 1`);

// ---- 4. delete through a sheet, never confirm() ----
await evalJs(`window.__confirms = 0; window.confirm = () => { window.__confirms++; return true; }; document.getElementById('histClear').click(); 1`); await sleep(400);
const sheet = await evalJs(`({ open: !document.getElementById('sheet').hidden, text: document.getElementById('sheet').textContent.replace(/\\s+/g, ' ').slice(0, 160), buttons: [...document.querySelectorAll('#sheet button')].map((b) => b.textContent.trim()) })`);
check('Delete stored history opens a sheet with Cancel / Delete and the size', sheet.open && sheet.buttons.includes('Delete') && sheet.buttons.includes('Cancel') && /\d+ days?, \d+ KB/.test(sheet.text), sheet);
await evalJs(`[...document.querySelectorAll('#sheet button')].find((b) => b.textContent.trim() === 'Delete').click(); 1`); await sleep(800);
h = await hist(); list = await evalJs('window.__batrayTest.histList()');
const after = await evalJs(`({ confirms: window.__confirms, toast: document.getElementById('toast').textContent, wait: getComputedStyle(document.getElementById('trendWait')).display !== 'none', card: document.getElementById('trendCard').hidden })`);
check('the store is empty afterwards, a toast says so, and the History tab shows the collecting bar again', list.length === 0 && h.mem === 0 && h.days.length === 0 && after.confirms === 0 && /deleted/i.test(after.toast) && after.wait && after.card, { h, list, after });

const thrown = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
check('no page exceptions', thrown.length === 0, thrown);
ws.close();
console.log(fails ? 'BATRAY HISTORY TEST FAILED' : 'batray history test ok');
process.exit(fails ? 1 : 0);
