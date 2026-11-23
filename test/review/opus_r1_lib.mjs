// BatRay by ClearEvo.com - review round 1 (Opus): shared CDP harness for the opus_r1_*.mjs browser tests
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
// The world around the reader page, as in batray_year.mjs: a fake JK BMS over fake Web Bluetooth, a fake wake lock and
// battery, a fake relay (every WebSocket opens, answers pings, can be killed; the reader's pub socket can be handed a
// viewer's message with window.__toPub(m)). Counters only - a harness that keeps every message would be the leak.
import { OWNER_32S_CELL, AIO_32S_DEV, ESPHOME_24S_SETTINGS } from '../batray_frames.js';

export const PORT = Number(process.env.PORT || 8411), CDP = Number(process.env.CDP || 9411);
export const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
export const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const bytes = (u8) => `[${[...u8].join(',')}]`;

export async function cdp() {
  // a fresh tab for this test (the reader lock and tab locks of an earlier test's page must not be in the way)
  const t = await (await fetch(`http://127.0.0.1:${CDP}/json/new?about:blank`, { method: 'PUT' })).json();
  for (const o of await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()) if (o.type === 'page' && o.id !== t.id) await fetch(`http://127.0.0.1:${CDP}/json/close/${o.id}`).catch(() => {});
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let seq = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); if (d.error) err(new Error(JSON.stringify(d.error))); else ok(d.result); } };
  const send = (method, params = {}) => new Promise((ok, err) => { const i = ++seq; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((ok) => { ws.onopen = ok; });
  await send('Runtime.enable'); await send('Page.enable'); await send('Page.bringToFront').catch(() => {}); await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const until = async (expr, ms, step = 100) => { const t0 = Date.now(); for (;;) { if (await evalJs(expr)) return true; if (Date.now() - t0 > ms) return false; await sleep(step); } };
  const heap = async () => { await send('HeapProfiler.enable'); await send('HeapProfiler.collectGarbage'); await send('HeapProfiler.collectGarbage'); const u = await send('Runtime.getHeapUsage'); const c = await send('Memory.getDOMCounters'); return { heapMB: Math.round(u.usedSize / 1048576 * 100) / 100, nodes: c.nodes, listeners: c.jsEventListeners }; };
  return { ws, send, evalJs, until, heap, close: () => ws.close() };
}

/** The fakes, installed before any page script. opts.noGetDevices: Chrome with the permissions flag off (the owner's). */
export function world({ noGetDevices = false } = {}) {
  return `
  const DEV = ${bytes(AIO_32S_DEV)}, SET = ${bytes(ESPHOME_24S_SETTINGS)}, CELL = ${bytes(OWNER_32S_CELL)};
  const char = new EventTarget();
  const notify = (b) => { char.value = new DataView(Uint8Array.from(b).buffer); char.dispatchEvent(new Event('characteristicvaluechanged')); };
  char.startNotifications = async () => char;
  char.writeValueWithoutResponse = async (v) => { const u = new Uint8Array(v.buffer || v); const cmd = u[4]; setTimeout(() => { if (!gatt.connected) return; if (cmd === 0x97) notify(DEV); else if (cmd === 0x96) notify(SET); }, 30); };
  const service = { getCharacteristic: async () => char };
  const server = { getPrimaryService: async () => service };
  const gatt = {
    connected: false,
    connect: async () => { window.__sim.connects++; await new Promise((r) => setTimeout(r, 20)); if (window.__sim.refuse > 0) { window.__sim.refuse--; throw new Error('Connection Error: Connection attempt failed.'); } gatt.connected = true; return server; },
    disconnect: () => { if (!gatt.connected) return; gatt.connected = false; dev.dispatchEvent(new Event('gattserverdisconnected')); },
  };
  const dev = new EventTarget(); dev.id = 'fake-opus-1'; dev.name = 'n11'; dev.gatt = gatt;
  window.__sim = { connects: 0, refuse: 0, frames: 0, mute: false, sockets: 0, sent: 0, sentBytes: 0, toViewer: 0, offline: false, logUps: 0 };
  navigator.bluetooth = { requestDevice: async () => dev, getAvailability: async () => true${noGetDevices ? '' : ', getDevices: async () => [dev]'} };
  window.__dropLink = () => gatt.disconnect();
  setInterval(() => { if (gatt.connected && !window.__sim.mute) { notify(CELL); window.__sim.frames++; } }, 100);
  let locks = [];
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async (type) => {
    const l = new EventTarget(); l.type = type; l.released = false;
    l.release = async () => { if (l.released) return; l.released = true; l.dispatchEvent(new Event('release')); };
    locks = locks.filter((x) => !x.released).concat([l]); return l;
  } } });
  const bat = new EventTarget(); bat.level = 0.9; bat.charging = true; navigator.getBattery = async () => bat; window.__bat = bat;
  const rf = window.fetch.bind(window);
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (u, i = {}) => {
    const url = String(u), m = (i.method || 'GET').toUpperCase();
    if (/\\/batray\\/api\\//.test(url) && window.__sim.offline) throw new TypeError('Failed to fetch');
    if (url.endsWith('/batray/api/room') && m === 'POST') return J({ room: 'opusroom00000000000000', pub: 'opuspub000000000000000' });
    if (/\\/batray\\/api\\/room\\/[^/?]+(\\?|$)/.test(url)) return J({ viewers: 1, live: true });
    if (/\\/batray\\/api\\/push\\/key/.test(url)) return J({ error: 'no push in the test' }, 404);
    if (url.endsWith('/batray/api/log') && m === 'POST') { window.__sim.logUps++; return J({ id: 'opuslog' + window.__sim.logUps }); }
    if (/\\/batray\\/api\\//.test(url)) return J({ ok: true });
    return rf(u, i);
  };
  window.__socks = new Set();
  window.WebSocket = class {
    constructor(url) {
      this.url = url; this.readyState = 0; this.bufferedAmount = 0; window.__sim.sockets++;
      setTimeout(() => {
        if (window.__sim.offline) { this.readyState = 3; if (this.onclose) this.onclose({ code: 1006, reason: '', wasClean: false }); return; }
        this.readyState = 1; window.__socks.add(this);
        if (this.onopen) this.onopen();
        this.push({ type: 'status', viewers: 1, live: true });
      }, 20);
    }
    send(s) { window.__sim.sent++; window.__sim.sentBytes += s.length; let m = null; try { m = JSON.parse(s); } catch { return; } if (m && m.to) window.__sim.toViewer++; if (m && m.type === 'ping') setTimeout(() => this.push({ type: 'pong' }), 5); }
    close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; window.__socks.delete(this); if (this.onclose) this.onclose({ code, reason, wasClean: true }); }
    kill(code) { if (this.readyState === 3) return; this.readyState = 3; window.__socks.delete(this); if (this.onclose) this.onclose({ code, reason: '', wasClean: false }); }
    push(m) { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: JSON.stringify(m) }); }
  };
  window.__killSockets = (code) => { for (const s of [...window.__socks]) s.kill(code); };
  window.__toPub = (m) => { for (const s of window.__socks) if (/role=pub/.test(s.url)) s.push(m); };
  `;
}

/** Open the reader, connect to the fake BMS and start sharing. q: extra query. */
export async function startReader(c, { q = '', debug = false, share = true, world: w = {} } = {}) {
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: world(w) });
  await c.send('Page.navigate', { url: `${BASE}/batray/?test${q}` }); await sleep(2500);
  await c.evalJs(`localStorage.setItem('batray_debuglog', '${debug ? '1' : '0'}'); localStorage.setItem('batray_auto_reconnect', '1'); localStorage.setItem('batray_setup_done', '1'); 1`);
  await c.send('Page.navigate', { url: `${BASE}/batray/?test${q}${debug ? '&logon=1' : ''}` }); await sleep(3000);
  await c.evalJs(`document.getElementById('connectBig').click(); 1`);
  const T = 'window.__batrayTest';
  const connected = `(() => { const s = ${T}.connState(); return !!s && s.phase === 'connected' && window.__sim.frames > 0; })()`;
  if (!(await c.until(connected, 20000))) throw new Error('the reader did not connect to the fake BMS');
  if (share) {
    await c.evalJs(`localStorage.removeItem(${T}.tabKey('share_last')); document.getElementById('share').click(); 1`); await sleep(400);
    await c.evalJs(`document.getElementById('shareGo').click(); 1`);
    if (!(await c.until(`(() => { const s = ${T}.shareState(); return s.phase === 'on' && window.__socks.size > 0; })()`, 15000))) throw new Error('the reader did not start sharing');
  }
  return { connected };
}
export function checker() {
  let fails = 0;
  const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` - got ${String(JSON.stringify(got)).slice(0, 600)}`}`); if (!cond) fails++; };
  return { check, done: (what) => { console.log(fails ? `${what}: ${fails} FAILED` : `${what} ok`); process.exit(fails ? 1 : 0); } };
}
