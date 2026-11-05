// BatRay by ClearEvo.com - tests (batray_year.mjs)
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
// A YEAR OF THE READER (owner 2026-11-05: "the reader is supposed to run 24/7 ... a month or a year at a time;
// use a reader log as a template to simulate a year in an integration test, run it between each review loop and
// before the final deploy"). The real page runs in headless Chromium for its whole "year" without a reload, as the
// reader phone does: a fake JK BMS streams frames over a fake Web Bluetooth device, a fake relay socket takes the
// share, the history goes into the real SQLite store in OPFS, the debug log is on and stored.
//
// Each simulated day replays the event mix of a real reader log (test/longrun/reader_good_day.json, and every 30th
// day the worst night on record, reader_bad_night.json: 480 refused connects and 150 drops an hour): refused GATT
// connects, link drops, short freezes, a frozen tab, relay socket losses and restarts, a dropped wake lock, the
// network going away. Then the page's clock jumps to the next UTC day (a new day file, the rollover, every
// "N s ago"), and the probes run: the reader must be connected and sharing again, the day must have stored rows,
// and nothing may grow with the days - JS heap after a GC, DOM nodes, event listeners, the log ring, queues,
// localStorage keys, stored log files. A frame soak (100k cell frames) prices the per-frame cost on top.
//
//   test/longrun/year.sh                   DAYS=365 (default), DAY_MS=4000 real ms per simulated day
//   DAYS=30 test/longrun/year.sh           a month, for a quick check
// Exit code 0 = the year passed. A JSON report goes to $REPORT when set.
import { writeFileSync, readFileSync } from 'node:fs';
import { OWNER_32S_CELL, AIO_32S_DEV, ESPHOME_24S_SETTINGS } from '../batray_frames.js';

const PORT = Number(process.env.PORT || 8111), CDP = Number(process.env.CDP || 9361);
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const DAYS = Number(process.env.DAYS || 365), DAY_MS = Number(process.env.DAY_MS || 4000);
const CONNSEC = 50;                                                          // one second of the connection loop = 50 ms
const good = JSON.parse(readFileSync(new URL('../longrun/reader_good_day.json', import.meta.url), 'utf8'));
const bad = JSON.parse(readFileSync(new URL('../longrun/reader_bad_night.json', import.meta.url), 'utf8'));

// ---- CDP ----
const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); if (d.error) err(new Error(JSON.stringify(d.error))); else ok(d.result); }
};
const send = (method, params = {}, sessionId) => new Promise((ok, err) => { const i = ++seq; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const until = async (expr, ms, step = 100) => { const t0 = Date.now(); for (;;) { if (await evalJs(expr)) return true; if (Date.now() - t0 > ms) return false; await sleep(step); } };

// ---- the world around the page: clock, BMS, wake lock, battery, relay ----
const bytes = (u8) => `[${[...u8].join(',')}]`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  // the clock: real time plus an offset the test moves (a day jump, a short freeze); timers run in real time
  const RealDate = Date; window.__simOff = 0;
  class SimDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + window.__simOff); } static now() { return RealDate.now() + window.__simOff; } }
  window.Date = SimDate;
  // the BMS: answers the device-info ask (0x97) and the settings ask (0x96), streams cell frames while connected
  const DEV = ${bytes(AIO_32S_DEV)}, SET = ${bytes(ESPHOME_24S_SETTINGS)}, CELL = ${bytes(OWNER_32S_CELL)};
  const char = new EventTarget();
  const notify = (b) => { char.value = new DataView(Uint8Array.from(b).buffer); char.dispatchEvent(new Event('characteristicvaluechanged')); };
  char.startNotifications = async () => char;
  char.writeValueWithoutResponse = async (v) => { const u = new Uint8Array(v.buffer || v); const cmd = u[4]; setTimeout(() => { if (!gatt.connected) return; if (cmd === 0x97) notify(DEV); else if (cmd === 0x96) notify(SET); }, 30); };
  const service = { getCharacteristic: async () => char };
  const server = { getPrimaryService: async () => service };
  const gatt = {
    connected: false,
    connect: async () => { window.__sim.connects++; await new Promise((r) => setTimeout(r, 20)); if (window.__sim.refuse > 0) { window.__sim.refuse--; window.__sim.refused++; throw new Error('Connection Error: Connection attempt failed.'); } gatt.connected = true; return server; },
    disconnect: () => { if (!gatt.connected) return; gatt.connected = false; dev.dispatchEvent(new Event('gattserverdisconnected')); },
  };
  const dev = new EventTarget(); dev.id = 'fake-year-1'; dev.name = 'n11'; dev.gatt = gatt;
  window.__sim = { connects: 0, refuse: 0, refused: 0, frames: 0, mute: false, sockets: 0, socketsOpen: 0, sent: 0, offline: false };
  navigator.bluetooth = { requestDevice: async () => dev, getAvailability: async () => true, getDevices: async () => [dev] };
  window.__dropLink = () => gatt.disconnect();
  window.__frames = (n) => { for (let i = 0; i < n; i++) { notify(CELL); window.__sim.frames++; } };
  setInterval(() => { if (gatt.connected && !window.__sim.mute) { notify(CELL); window.__sim.frames++; } }, 50);
  // a Screen Wake Lock the test can drop, as a phone does after hours
  let locks = [];
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async (type) => {
    const l = new EventTarget(); l.type = type; l.released = false;
    l.release = async () => { if (l.released) return; l.released = true; l.dispatchEvent(new Event('release')); };
    locks = locks.filter((x) => !x.released).concat([l]); return l;
  } } });
  window.__dropWake = () => { const l = locks.at(-1); if (l) l.release(); };
  window.__wakeHeld = () => locks.filter((x) => !x.released).length;
  const bat = new EventTarget(); bat.level = 0.9; bat.charging = true; navigator.getBattery = async () => bat;
  // the relay: POST /room answers, GET /room/<id> says live; every socket is a fake that opens, answers pings, and
  // can be killed; the test keeps counters only (a harness that remembers every message would be the leak)
  const rf = window.fetch.bind(window);
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (u, i = {}) => {
    const url = String(u), m = (i.method || 'GET').toUpperCase();
    if (/\\/batray\\/api\\//.test(url) && window.__sim.offline) throw new TypeError('Failed to fetch');
    if (url.endsWith('/batray/api/room') && m === 'POST') return J({ room: 'yearroom00000000000000', pub: 'yearpub000000000000000' });
    if (/\\/batray\\/api\\/room\\/[^/?]+(\\?|$)/.test(url)) return J({ viewers: 1, live: true });
    if (/\\/batray\\/api\\/push\\/key/.test(url)) return J({ error: 'no push in the test' }, 404);
    if (/\\/batray\\/api\\//.test(url)) return J({ ok: true });
    return rf(u, i);
  };
  window.__socks = new Set();
  window.WebSocket = class {
    constructor(url) {
      this.url = url; this.readyState = 0; this.bufferedAmount = 0; window.__sim.sockets++;
      setTimeout(() => {
        if (window.__sim.offline) { this.readyState = 3; if (this.onerror) this.onerror(new Event('error')); if (this.onclose) this.onclose({ code: 1006, reason: '', wasClean: false }); return; }
        this.readyState = 1; window.__socks.add(this); window.__sim.socketsOpen++;
        if (this.onopen) this.onopen();
        this.push({ type: 'status', viewers: 1, live: true });
      }, 20);
    }
    send(s) { window.__sim.sent++; let m = null; try { m = JSON.parse(s); } catch { return; } if (m && m.type === 'ping') setTimeout(() => this.push({ type: 'pong' }), 5); }
    close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; window.__socks.delete(this); if (this.onclose) this.onclose({ code, reason, wasClean: true }); }
    kill(code) { if (this.readyState === 3) return; this.readyState = 3; window.__socks.delete(this); if (this.onclose) this.onclose({ code, reason: '', wasClean: false }); }
    push(m) { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: JSON.stringify(m) }); }
  };
  window.__killSockets = (code) => { for (const s of [...window.__socks]) s.kill(code); };
` });

// ---- start: debug log on, connect, share ----
await send('Page.navigate', { url: `${BASE}/batray/?test&connsec=${CONNSEC}` }); await sleep(2500);
await evalJs(`localStorage.setItem('batray_debuglog', '1'); localStorage.setItem('batray_auto_reconnect', '1'); 1`);
await send('Page.navigate', { url: `${BASE}/batray/?test&connsec=${CONNSEC}&logon=1` }); await sleep(3000);
await evalJs(`document.getElementById('connectBig').click(); 1`);
const T = 'window.__batrayTest';
const connected = `(() => { const c = ${T}.connState(); return !!c && c.phase === 'connected' && window.__sim.frames > 0; })()`;
if (!(await until(connected, 20000))) { console.log('FAIL  the reader connects to the fake BMS at the start'); process.exit(1); }
await evalJs(`localStorage.removeItem(${T}.tabKey('share_last')); document.getElementById('share').click(); 1`); await sleep(400);
await evalJs(`document.getElementById('shareGo').click(); 1`);
const sharing = `(() => { const s = ${T}.shareState(); return s.phase === 'on' && window.__socks.size > 0; })()`;
if (!(await until(sharing, 15000))) { console.log('FAIL  the reader starts sharing at the start'); process.exit(1); }
console.log(`year: started - ${DAYS} days of ${DAY_MS} ms, connection loop second = ${CONNSEC} ms, template: ${good.source} / ${bad.source}`);

// ---- a deterministic schedule from the templates ----
let rnd = 20261105;
const rand = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
const poisson = (mean) => { let n = 0, p = Math.exp(-mean), s = p; const u = rand(); while (u > s && n < 1000) { n++; p *= mean / n; s += p; } return n; };
function dayPlan(d) {
  const P = d % 30 === 0 ? bad.perHour : good.perHour;
  const scale = d % 30 === 0 ? 1 / 40 : 1;                                   // the bad night, a fortieth of its 13.6 h (a few hundred refusals)
  const hours = d % 30 === 0 ? bad.hours : 24;
  const n = (k) => poisson(P[k] * hours * scale);
  return { refused: n('refused'), drops: n('gattDown'), freezes: n('stall') > 0 ? 1 + (d % 3) : (d % 4 === 0 ? 1 : 0), hidden: Math.max(n('hidden'), d % 2), sockets: n('socketClose') + (d % 7 === 0 ? 1 : 0), wake: d % 5 === 0 ? 1 : 0, offline: d % 30 === 15 ? 1 : 0, restart: d % 45 === 0 ? 1 : 0, bad: d % 30 === 0 };
}

// ---- probes ----
await send('HeapProfiler.enable');
async function heap() { await send('HeapProfiler.collectGarbage'); await send('HeapProfiler.collectGarbage'); const u = await send('Runtime.getHeapUsage'); const c = await send('Memory.getDOMCounters'); return { heapMB: Math.round(u.usedSize / 1048576 * 100) / 100, nodes: c.nodes, listeners: c.jsEventListeners, documents: c.documents }; }
const probeJs = `(async () => {
  const t = ${T}; const c = t.connState(), h = t.histState(), l = t.logState(), s = t.shareState();
  const lines = t.logLines(); const bad = lines.filter((x) => /UNHANDLED|ERROR /.test(x));
  return { phase: c && c.phase, share: s.phase, socks: window.__socks.size, todayRows: h.todayRows, day: h.day, backend: h.backend, pending: h.pending,
    days: (await t.histList()).length, logFiles: (l.files || []).length, logPending: l.pending, ring: lines.length, ls: localStorage.length,
    packs: t.packIds().length, frames: window.__sim.frames, connects: window.__sim.connects, refused: window.__sim.refused, sockets: window.__sim.sockets,
    wake: window.__wakeHeld(), errors: bad.slice(-3), errorCount: bad.length };
})()`;

// ---- the year ----
const report = { days: [], heaps: [], failures: [] };
let fails = 0;
const fail = (msg, got) => { fails++; report.failures.push({ msg, got }); console.log(`FAIL  ${msg}${got === undefined ? '' : ' - ' + JSON.stringify(got).slice(0, 400)}`); };
const base = await heap(); report.heaps.push({ day: 0, ...base });
let lastErrors = 0;
for (let d = 1; d <= DAYS; d++) {
  const plan = dayPlan(d), t0 = Date.now();
  const ev = [];
  for (let i = 0; i < plan.drops; i++) ev.push('drop');
  if (plan.refused) ev.push(`refuse:${plan.refused}`);
  for (let i = 0; i < plan.freezes; i++) ev.push('freeze');
  for (let i = 0; i < plan.hidden; i++) ev.push('hidden');
  for (let i = 0; i < plan.sockets; i++) ev.push('socket');
  if (plan.wake) ev.push('wake');
  if (plan.offline) ev.push('offline');
  if (plan.restart) ev.push('restart');
  for (const e of ev.sort(() => rand() - 0.5)) {
    if (e === 'drop') await evalJs('window.__dropLink(); 1');
    else if (e.startsWith('refuse:')) await evalJs(`window.__sim.refuse += ${Number(e.slice(7))}; window.__dropLink(); 1`);   // a run of refusals, then the BMS answers again
    else if (e === 'freeze') await evalJs('window.__sim.mute = true; window.__simOff += 20000; 1');   // 20 s with nothing from the BMS (a short freeze of the tab)
    else if (e === 'hidden') { await send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {}); await evalJs(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('freeze')); 1`); await sleep(150); await evalJs(`delete document.visibilityState; delete document.hidden; document.dispatchEvent(new Event('resume')); document.dispatchEvent(new Event('visibilitychange')); 1`); }
    else if (e === 'socket') await evalJs('window.__killSockets(1006); 1');
    else if (e === 'restart') await evalJs('window.__killSockets(1012); 1');
    else if (e === 'wake') await evalJs('window.__dropWake(); 1');
    else if (e === 'offline') { await evalJs(`window.__sim.offline = true; window.__killSockets(1006); window.dispatchEvent(new Event('offline')); 1`); await sleep(1500); await evalJs(`window.__sim.offline = false; window.dispatchEvent(new Event('online')); 1`); }
    await sleep(Math.max(50, Math.round(DAY_MS * 0.6 / Math.max(1, ev.length))));
    if (e === 'freeze') await evalJs('window.__sim.mute = false; 1');
  }
  // the rest of the day streams (a bad night's few hundred refusals take their time: they run out first); then the
  // clock moves to 06:00 UTC of the next day
  const left = DAY_MS - (Date.now() - t0); if (left > 0) await sleep(left);
  if (!(await until('window.__sim.refuse === 0', 180000, 250))) fail(`day ${d}: the run of refused connects is worked through (the loop keeps trying)`, await evalJs('window.__sim'));
  await evalJs(`(() => { const now = Date.now(), next = Math.floor(now / 86400000) * 86400000 + 86400000 + 6 * 3600000; window.__simOff += next - now; return 1; })()`);
  // the reader must be back on its own: connected, sharing, storing (the day jump looks like a frozen tab to it)
  const ok = await until(`(${connected}) && (${sharing})`, 15000, 200);
  await sleep(600);
  const p = await evalJs(probeJs);
  report.days.push({ d, plan, ...p });
  if (!ok) fail(`day ${d}: the reader is connected and sharing again within 15 s of the day change`, { phase: p.phase, share: p.share, socks: p.socks });
  if (p.backend !== 'opfs') fail(`day ${d}: the history store is still SQLite over OPFS`, p.backend);
  if (p.errorCount > lastErrors) { fail(`day ${d}: no ERROR / UNHANDLED line in the log`, p.errors); }
  lastErrors = p.errorCount;
  if (d % 10 === 0 || d === DAYS) {
    const h = await heap(); report.heaps.push({ day: d, ...h });
    console.log(`day ${d}: ${p.phase}/${p.share} rows today ${p.todayRows}, ${p.days} day files, ${p.logFiles} log files, ring ${p.ring}, ls ${p.ls}, frames ${p.frames}, connects ${p.connects} (${p.refused} refused), sockets ${p.sockets}, heap ${h.heapMB} MB, nodes ${h.nodes}, listeners ${h.listeners}`);
  }
  if (d === 5) {                                                             // the frame soak: what one more frame costs
    const before = await heap();
    for (let i = 0; i < 20; i++) { await evalJs('window.__frames(5000); 1'); await sleep(200); }
    await sleep(1500);
    const after = await heap();
    report.soak = { frames: 100000, before, after };
    console.log(`soak: 100000 frames, heap ${before.heapMB} -> ${after.heapMB} MB, listeners ${before.listeners} -> ${after.listeners}, nodes ${before.nodes} -> ${after.nodes}`);
    if (after.heapMB - before.heapMB > 3) fail('100k cell frames leave at most 3 MB more heap after a GC (a year is ~80M frames)', report.soak);
    if (after.listeners - before.listeners > 20) fail('100k cell frames add no event listeners', report.soak);
  }
}

// ---- the year's verdict: nothing grows with the days ----
// the trend starts once the log ring is full (it fills to 4000 lines in the first weeks: growth that stops by design)
const ringFull = (report.days.find((x) => x.ring >= 4000) || { d: 10 }).d;
const hs = report.heaps.filter((h) => h.day >= Math.max(10, ringFull));
if (hs.length >= 3) {
  const first = hs[0], last = hs[hs.length - 1], span = last.day - first.day;
  const perDay = (k) => (last[k] - first[k]) / span;
  const yearHeap = perDay('heapMB') * 365, yearNodes = perDay('nodes') * 365, yearListeners = perDay('listeners') * 365;
  report.trend = { from: first.day, to: last.day, heapMBPerYear: Math.round(yearHeap * 100) / 100, nodesPerYear: Math.round(yearNodes), listenersPerYear: Math.round(yearListeners) };
  console.log(`trend day ${first.day} -> ${last.day}: heap ${first.heapMB} -> ${last.heapMB} MB (${report.trend.heapMBPerYear} MB a year at this rate), nodes ${first.nodes} -> ${last.nodes}, listeners ${first.listeners} -> ${last.listeners}`);
  if (yearHeap > 16) fail('the JS heap after a GC grows less than 16 MB a year', report.trend);
  if (yearNodes > 2000) fail('the DOM grows less than 2000 nodes a year', report.trend);
  if (yearListeners > 500) fail('the event listeners grow less than 500 a year', report.trend);
}
const dd = report.days, lastDay = dd[dd.length - 1], early = dd[Math.min(9, dd.length - 1)];
if (lastDay.ring > 4000) fail('the log ring stays at 4000 lines', lastDay.ring);
if (lastDay.logFiles > 10) fail('at most 10 stored log files', lastDay.logFiles);
if (lastDay.ls > early.ls + 5) fail('localStorage keys do not grow with the days', { early: early.ls, last: lastDay.ls });
if (lastDay.pending > 500 || lastDay.logPending > 5000) fail('no queue grows: pending rows and log lines stay small', { rows: lastDay.pending, log: lastDay.logPending });
if (lastDay.days < Math.min(DAYS, 300)) fail('a day file for (nearly) every simulated day: the store kept storing', lastDay.days);
if (lastDay.packs !== 1) fail('one pack the whole year (no ghost packs from reconnects)', lastDay.packs);
const noRows = dd.filter((x) => !(x.todayRows > 0)).map((x) => x.d);
if (noRows.length) fail('every simulated day stored rows (checked after the day change: the new day has its first rows)', noRows.slice(0, 20));
if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1));
console.log(fails ? `batray year test: ${fails} FAILED` : `batray year test ok (${DAYS} days)`);
process.exit(fails ? 1 : 0);
