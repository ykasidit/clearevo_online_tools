// BatRay by ClearEvo.com - tests (longrun_fable_history.mjs): the stored history on a reader that runs for months
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
// Long-run review (Fable, 2026-11-05), the two findings only the real page can show (app.js wiring):
//   L-F5  a start whose day listing (days(), one 8 s deadline over every file) times out must still read today's
//         counters: today's rows are otherwise numbered from 1 again and dropped as "already stored" until midnight
//   L-F6  rows the store keeps refusing must be bounded as a whole, not per day: the requeue cap is 5000 PER DAY KEY and
//         the day keys accumulate, so a refusing store (a disk full by other apps) grows the queue by a day's worth
//         every day for as long as the page runs
// Runs against a Chrome started with --remote-debugging-port=$CDP and serve.py on $PORT (own ports: 9351 / 8101):
//   google-chrome --headless=new --disable-gpu --remote-debugging-port=9351 --window-size=1200,800 --user-data-dir=$(mktemp -d) about:blank &
//   python3 test/browser/serve.py 8101 public &
//   PORT=8101 CDP=9351 node test/browser/longrun_fable_history.mjs
import { OWNER_32S_CELL, AIO_32S_DEV } from '../batray_frames.js';

const PORT = +(process.env.PORT || 8101), CDP = +(process.env.CDP || 9351);
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); d.error ? err(new Error(JSON.stringify(d.error))) : ok(d.result); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const evalJs = async (expr) => { const r = await Promise.race([send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), new Promise((_, rej) => { setTimeout(() => rej(new Error('eval timed out after 90 s: ' + expr.slice(0, 120))), 90000); })]); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let fails = 0;
const T00 = Date.now();
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'} [${Math.round((Date.now() - T00) / 1000)}s] ${name}${cond ? '' : ` - got ${JSON.stringify(got).slice(0, 900)}`}`); if (!cond) fails++; };

// the fake Web Bluetooth device of the other BatRay browser tests, so real readings make real rows; plus a switch that
// drops every `days` message to the history worker (the page then sees exactly what a listing past its deadline gives)
const FAKE = `
  const char = new EventTarget(); char.startNotifications = async () => char; char.writeValueWithoutResponse = async () => {};
  const gatt = { connected: false, connect: async () => { gatt.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => char }) }; }, disconnect: () => { if (!gatt.connected) return; gatt.connected = false; window.__dev.dispatchEvent(new Event('gattserverdisconnected')); } };
  const dev = new EventTarget(); dev.id = 'fake-1'; dev.name = 'n11'; dev.gatt = gatt; window.__dev = dev;
  navigator.bluetooth = { requestDevice: async () => dev, getAvailability: async () => true, getDevices: async () => [dev] };
  window.__notify = (bytes) => { char.value = new DataView(Uint8Array.from(bytes).buffer); char.dispatchEvent(new Event('characteristicvaluechanged')); };
  window.__droppedDays = 0;
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (m, ...rest) { if (m && m.op === 'days' && location.search.includes('dropdays')) { window.__droppedDays++; return undefined; } return post.call(this, m, ...rest); };
`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
const notify = (frame) => evalJs(`window.__notify([${[...frame].join(',')}]); 1`);
const connect = async () => { await evalJs(`document.getElementById('connectBig').click(); 1`); await sleep(1500); await notify(AIO_32S_DEV); await notify(OWNER_32S_CELL); await sleep(800); };
const hist = () => evalJs('window.__batrayTest.histState()');
const logs = () => evalJs('window.__batrayTest.logLines()');
const today = new Date().toISOString().slice(0, 10);

// ---- L-F5: today's file holds ids 1..5 from an earlier session; the next start's day listing times out ----
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(3500);
await evalJs('window.__batrayTest.clearHistory()'); await sleep(300);
let ll = await logs();
check('setup: the store opens SQLite over OPFS', ll.some((l) => /history: SQLite 3\.\d+\.\d+ over opfs-sahpool/.test(l)), ll.filter((l) => /history:/.test(l)).slice(0, 5));
const seeded = await evalJs(`(async () => {
  const now = Date.now(), rows = [];
  for (let i = 5; i >= 1; i--) rows.push({ t: now - i * 60000, p: 'n11', soc: 50, v: 52.1, i: 1, w: 50, ah: 150, tm: 30, t1: 25, t2: 26, ch: 1, ds: 1, bal: 0, err: 0, c: null });
  const n = await window.__batrayTest.histSeed(rows);
  return { n, info: await window.__batrayTest.histInfo('${today}'), state: window.__batrayTest.histState() };
})()`);
check('setup: five rows of today stored with ids 1..5, the counters follow', seeded.n === 5 && seeded.info.rows === 5 && seeded.info.maxId === 5 && seeded.state.nextId === 6, seeded);

await send('Page.navigate', { url: `${BASE}/batray/?test&dropdays` }); await sleep(12000);          // the listing's 8 s deadline passes
ll = await logs();
const h = await hist();
const dropped = await evalJs('window.__droppedDays');
check('L-F5 setup: the day listing timed out at start (as it does with a year of two-pack day files on a phone) and the start logged a load failure', dropped >= 1 && ll.some((l) => /history: days TIMED OUT after \d+ ms/.test(l)) && ll.some((l) => /history: load failed: days timed out/.test(l)), { dropped, logs: ll.filter((l) => /history/.test(l)) });
check("L-F5: today's counters are read on their own when the listing fails (info(today) is one cheap call), so new rows continue after id 5", h.nextId === 6 && h.todayRows === 5, { nextId: h.nextId, todayRows: h.todayRows, contig: h.contig });
await connect();
for (let i = 0; i < 2; i++) { await sleep(3100); await notify(OWNER_32S_CELL); }                     // three stored rows: the first reading and two more 3 s apart
await evalJs('window.__batrayTest.flushHistory()'); await sleep(300);
const after = await evalJs(`(async () => ({ info: await window.__batrayTest.histInfo('${today}'), rows: (await window.__batrayTest.histRows('${today}', 0, 100)).map((r) => r.id), state: window.__batrayTest.histState(), logs: window.__batrayTest.logLines().filter((l) => /already stored|history: (start|rollover)/.test(l)) }))()`);
check("L-F5: readings taken after that start are stored (today's file grows past the five seeded rows) instead of being dropped as duplicates of ids 1..3", after.info.rows >= 8 && after.rows.length >= 8 && !after.logs.some((l) => /rows for \d{4}-\d{2}-\d{2} were already stored/.test(l)), after);

// ---- L-F6: a store that refuses every insert, day after day ----
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(3500);
await evalJs('window.__batrayTest.clearHistory()'); await sleep(300);
const grown = await evalJs(`(async () => {
  const T = window.__batrayTest;
  T.histTimeouts({ insert: 1 }); T.histStuckSilent(1e9);                        // every insert is refused (its deadline passes); the worker is otherwise alive, so no restart
  const perDay = 600, days = 30, start = Date.parse('${today}T00:00:00Z') + 86400e3;   // thirty days after today, one after the other (600 rows: an insert the worker cannot finish inside the 1 ms)
  const counts = [];
  for (let d = 0; d < days; d++) {
    const t0 = start + d * 86400e3;
    for (let i = 0; i < perDay; i++) T.remoteTake('r1', { soc: 50, current: 1 }, t0 + i * 3000, { id: i + 1, t: t0 + i * 3000, p: 'r1', soc: 50, v: 52, w: 50 });
    await T.flushHistory();
    counts.push(T.histState().pending);
  }
  await new Promise((r) => { setTimeout(r, 500); });
  return { pending: T.histState().pending, counts: [counts[0], counts[9], counts[19], counts[29]], stats: T.histStats(), logs: T.logLines().filter((l) => /TIMED OUT|insert/.test(l)).slice(0, 3) };
})()`);
check('L-F6: rows the store refuses are bounded in memory as a whole - thirty days of refused rows must not sit in the queue (5000 is the cap the code means; each day key keeps its own 5000)', grown.pending <= 5000, { pending: grown.pending, pendingAfterDays_1_10_20_30: grown.counts, stats: grown.stats, logs: grown.logs });

const thrown = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
check('no page exceptions', thrown.length === 0, thrown);
ws.close();
console.log(fails ? 'LONGRUN FABLE HISTORY TEST FAILED' : 'longrun fable history test ok');
process.exit(fails ? 1 : 0);
