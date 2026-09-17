// BatRay by ClearEvo.com - tests (batray_freeze.mjs)
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
// Regression test for the Android "frozen tab" case, reported 2026-09-16:
// phone locked for an hour with BatRay connected, and on waking the page it
// still said "connected", replayed an hour of queued readings onto the meters,
// and only showed the disconnect about two minutes later. The page is driven
// through a fake Web Bluetooth device so the whole app runs for real.
//
// Run through ./run.sh (it starts Chrome with --remote-debugging-port=9333 and
// serves public/ on 8077), or: BASE=... node batray_freeze.mjs
import { readFileSync } from 'node:fs';
import { OWNER_32S_CELL, AIO_32S_DEV } from '../batray_frames.js';

const PORT = 8077, CDP = 9333;
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const STALE_MS = 12000;                       // must match jkbms.js

const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); d.error ? err(new Error(JSON.stringify(d.error))) : ok(d.result); }
  else if (d.method) events.push(d);
};
const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

// A fake Web Bluetooth device: the app's own code runs unchanged, and the test
// decides when notifications arrive - including a flood of stale ones.
const FAKE = `
  window.__renders = 0;
  const char = new EventTarget();
  char.startNotifications = async () => char;
  char.writeValueWithoutResponse = async () => {};
  const gatt = {
    connected: false,
    connect: async () => { window.__connects = (window.__connects || 0) + 1; gatt.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => char }) }; },
    disconnect: () => { if (!gatt.connected) return; gatt.connected = false; window.__dev.dispatchEvent(new Event('gattserverdisconnected')); },
  };
  const dev = new EventTarget(); dev.id = 'fake-1'; dev.name = 'n11'; dev.gatt = gatt;
  window.__dev = dev;
  navigator.bluetooth = { requestDevice: async () => dev, getAvailability: async () => true, getDevices: async () => [dev] };
  window.__notify = (bytes) => { char.value = new DataView(Uint8Array.from(bytes).buffer); char.dispatchEvent(new Event('characteristicvaluechanged')); };
`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
await send('Page.navigate', { url: `${BASE}/batray/?test` });   // ?test exposes window.__batrayTest (renderQr)
await sleep(2500);
await evalJs(`new MutationObserver(() => window.__renders++).observe(document.getElementById('soc'), { childList: true, characterData: true, subtree: true }); 1`);

const state = () => evalJs(`({ stat: document.getElementById('stat').textContent, soc: document.getElementById('soc').textContent, updated: document.getElementById('updated').textContent, gatt: window.__dev.gatt.connected, renders: window.__renders })`);
const notify = (frame, times = 1) => evalJs(`for (let i = 0; i < ${times}; i++) window.__notify([${[...frame].join(',')}]); 1`);

let fails = 0;
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` - got ${JSON.stringify(got)}`}`); if (!cond) fails++; };

await evalJs(`document.getElementById('connectBig').click(); 1`);
await sleep(600);
await notify(AIO_32S_DEV); await notify(OWNER_32S_CELL);
await sleep(1200);
let s = await state();
check('a connected pack shows readings', s.gatt === true && s.soc !== '-' && /n11/.test(s.stat), s);

// a fast unit (or a flush) must paint once per animation frame, not once per frame received
await evalJs('window.__renders = 0; 1');
await notify(OWNER_32S_CELL, 10);
await sleep(500);
s = await state();
check('a burst of 10 readings paints once', s.renders <= 1, s);

// the tab was frozen: no data at all for longer than a live link ever goes
// quiet. Auto reconnect is switched off first so the dropped link stays down
// for the flood below (with it on, the app is back on a fresh link in 3 s).
await evalJs(`{ const re1 = document.getElementById('autoRe'); if (re1.checked) re1.click(); } window.__renders = 0; 1`);
await sleep(STALE_MS + 6000);
s = await state();
check('silence drops the link instead of showing "connected"', s.gatt === false && /n11/.test(s.stat) && !/^connected/i.test(s.stat), s);

// ...and now the hour of queued readings floods in from the dead link. If any
// of it were processed, the reading age would reset to "just now".
const ageBefore = s.updated;
await notify(OWNER_32S_CELL, 20);
await sleep(800);
s = await state();
check('queued readings from the dead link are ignored',
  s.gatt === false && s.renders === 0 && !/just now|updated 0s|updated 1s/.test(s.updated) && s.updated !== ageBefore.replace(/\d+/, '0'),
  { ...s, ageBefore });

// --- reconnect: one attempt at a time, and a fresh link must not be killed by
// the watchdog before its own first frame (both seen live on 2026-09-17: a tap
// during a pending countdown raced it, and the reconnected pack showed
// "connected" for a few seconds, then dropped again) ---
await evalJs(`{ const re2 = document.getElementById('autoRe'); if (!re2.checked) re2.click(); } 1`);
await evalJs(`document.getElementById('reNow').click(); 1`);              // manual reconnect of the dropped pack
await sleep(1500);
await notify(OWNER_32S_CELL);                                              // one frame, then the link dies again
await sleep(300);
await evalJs(`window.__dev.gatt.disconnect(); 1`);                        // -> disconnected -> countdown (auto reconnect on)
await sleep(800);
const connectsBefore = await evalJs('window.__connects');
await evalJs(`document.getElementById('reNow').click(); 1`);              // the user taps while the countdown is pending
await sleep(12000);                                                        // longer than the countdown: it must NOT fire a second connect
s = await state();
const connectsAfter = await evalJs('window.__connects');
check('a tap during a pending countdown makes exactly one connect attempt', connectsAfter - connectsBefore === 1, { connectsBefore, connectsAfter, ...s });
check('a fresh reconnect survives 12 s without a frame of its own (old frames do not count)', s.gatt === true && /connected|connecting/i.test(s.stat), s);
await notify(OWNER_32S_CELL);
await sleep(5000);
s = await state();
check('...and stays up once its first frame arrives', s.gatt === true && /^connected/i.test(s.stat), s);

// --- share link as a QR code: the other phone just scans the screen ---
const qr = await evalJs(`(() => {
  const t = window.__batrayTest; if (!t) return { err: 'no test hook' };
  const ok = t.renderQr('https://www.clearevo.com/batray/?view=AbCdEfGhIjKlMnOpQrStUv#k=AbCdEfGhIjKlMnOpQrStUv');
  const c = document.getElementById('qrCanvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
  return { ok, w: c.width, h: c.height, dark };
})()`);
check('the share link renders as a QR code', qr.ok === true && qr.w > 150 && qr.dark > 500, qr);

const thrown = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
check('no page exceptions', thrown.length === 0, thrown);

ws.close();
console.log(fails ? 'BATRAY FREEZE TEST FAILED' : 'batray freeze test ok');
process.exit(fails ? 1 : 0);
