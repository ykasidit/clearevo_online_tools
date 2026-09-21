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
  navigator.bluetooth = { requestDevice: async () => dev, getAvailability: async () => true, getDevices: async () => [dev] };
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
check('each row is one JSON line with short keys and the cell millivolts', lines.length === h.mem && lines.every((l) => /^\{"t":\d+,"p":"n11","soc":/.test(l)) && /"c":\[\d+/.test(lines[0]), { n: lines.length, mem: h.mem, first: lines[0].slice(0, 120) });

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
check('the History card says what is stored, for how long, and that it leaves only when sharing', /Stored on this device: \d+ days?, \d+ KB, since \d{4}-\d{2}-\d{2}\. Files are kept 30 days/.test(note), note);

// ---- 3. reload: rows come back from the files and the chart draws at once ----
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(2500);
h = await hist();
check('after a reload the last 24 h are back in memory from the day files', h.backend === 'opfs' && h.mem >= 120 && h.todayRows >= 120, h);
await connect();
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
