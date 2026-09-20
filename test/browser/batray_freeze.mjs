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
    connect: async () => { window.__connects = (window.__connects || 0) + 1; if (window.__failConnects > 0) { window.__failConnects--; throw new Error('Connection Error: Connection attempt failed.'); } gatt.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => char }) }; },
    disconnect: () => { if (!gatt.connected) return; gatt.connected = false; window.__dev.dispatchEvent(new Event('gattserverdisconnected')); },
  };
  const dev = new EventTarget(); dev.id = 'fake-1'; dev.name = 'n11'; dev.gatt = gatt;
  window.__dev = dev;
  window.__failConnects = 0; window.__requestDevices = 0;
  navigator.bluetooth = { requestDevice: async () => { window.__requestDevices++; return dev; }, getAvailability: async () => true, getDevices: async () => [dev] };
  window.__notify = (bytes) => { char.value = new DataView(Uint8Array.from(bytes).buffer); char.dispatchEvent(new Event('characteristicvaluechanged')); };
  // a fake Screen Wake Lock the test can drop, as a phone does after hours
  window.__locks = [];
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async (type) => {
    if (window.__refuseWake) throw new DOMException('denied', 'NotAllowedError');
    const l = new EventTarget(); l.type = type; l.released = false;
    l.release = async () => { if (l.released) return; l.released = true; l.dispatchEvent(new Event('release')); };
    window.__locks.push(l); return l;
  } } });
  window.__dropWake = () => { const l = window.__locks.at(-1); if (l) l.release(); };
  window.__plays = [];
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { window.__plays.push(this.id + ':' + (this.getAttribute('src') || '').split('/').pop() + ':muted=' + this.muted + ':vol=' + this.volume); return origPlay.call(this); };
`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
await send('Page.navigate', { url: `${BASE}/batray/?test` });   // ?test exposes window.__batrayTest (renderQr)
await sleep(2500);
await evalJs(`new MutationObserver(() => window.__renders++).observe(document.getElementById('fSoc'), { childList: true, characterData: true, subtree: true }); 1`);

const state = () => evalJs(`({ stat: document.getElementById('stat').textContent, soc: document.getElementById('fSoc').textContent, updated: document.getElementById('updated').textContent, gatt: window.__dev.gatt.connected, renders: window.__renders })`);
const notify = (frame, times = 1) => evalJs(`for (let i = 0; i < ${times}; i++) window.__notify([${[...frame].join(',')}]); 1`);

let fails = 0;
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` - got ${JSON.stringify(got)}`}`); if (!cond) fails++; };

// Android often refuses the first GATT connect ("Connection attempt failed") and
// takes the next: one tap must retry on its own, without reopening the chooser
await evalJs(`window.__failConnects = 2; document.getElementById('connectBig').click(); 1`);
await sleep(4500);
await notify(AIO_32S_DEV); await notify(OWNER_32S_CELL);
await sleep(1200);
let s = await state();
const tries = await evalJs(`({ connects: window.__connects, choosers: window.__requestDevices })`);
check('a connected pack shows readings', s.gatt === true && s.soc !== '-' && /n11/.test(s.stat), s);
check('two refused GATT connects were retried by the same tap: one chooser, three attempts', tries.choosers === 1 && tries.connects === 3, tries);
// no adapter-state probe any more (2026-09-17): the app warns once to keep
// Bluetooth on (toast) and keeps a line under the readings while connected
const bt = await evalJs(`({ toast: document.getElementById('toast').textContent, toastShown: !document.getElementById('toast').hidden, note: !document.getElementById('btNote').hidden, meters: document.querySelectorAll('.meter').length, packV: document.getElementById('fSoh').textContent, rows: document.getElementById('secondary').textContent })`);
const ui = await evalJs(`({ eta: document.getElementById('fEta').textContent, chips: [...document.querySelectorAll('#strip .chip')].map((c) => c.className + ':' + c.textContent), cellsStat: document.getElementById('cellsStat').textContent, etaLineShown: !document.getElementById('etaLine').hidden })`);
check('benchmark items after connecting: time-to-go on the picture, MOS/temp/alarm chips, cell delta line',
  /≈ .* (to 10 % cut-off|to full)|below the cut-off/.test(ui.eta) && ui.etaLineShown && ui.chips.some((c) => /charge (allowed|blocked)/.test(c)) && ui.chips.some((c) => /MOS .* T1/.test(c)) && ui.chips.some((c) => /alarm/.test(c)) && /Δ \d+ mV · lowest 3\.\d{3} V \(cell \d+\)/.test(ui.cellsStat), ui);
check('after connecting: keep-Bluetooth-on toast + line, no big meter cards, values in the details grid',
  bt.toastShown && /Bluetooth on/.test(bt.toast) && bt.note && bt.meters === 0 && /\d V · SOH/.test(bt.packV) && /Pack voltage/.test(bt.rows) && /State of charge/.test(bt.rows) && /Power/.test(bt.rows), bt);

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
const cd = await evalJs(`({ count: document.getElementById('reCount').textContent, tap: !document.getElementById('reNow').hidden, note: document.getElementById('btNote').hidden, gate: !!document.getElementById('reForce') })`);
check('the countdown runs on its own (no "tap to reconnect" gate) and offers Reconnect now', /reconnecting to n11 in \d+ s/.test(cd.count) && cd.tap && cd.note && !cd.gate, cd);
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
// the session trend appears once the pack has been read for 30 s (frames above span more than that)
const tr = await evalJs(`({ shown: !document.getElementById('trendCard').hidden, energy: document.getElementById('trendEnergy').textContent, w: document.getElementById('trend').width })`);
check('the session trend card shows with an energy line once 30 s of readings exist', tr.shown && /charged .* · discharged/.test(tr.energy) && tr.w > 100, tr);

// --- a picked device that refuses all attempts goes to the countdown, never back to the chooser ---
await evalJs(`window.__dev.gatt.disconnect(); 1`); await sleep(500);
await evalJs(`{ const re3 = document.getElementById('autoRe'); if (!re3.checked) re3.click(); } document.getElementById('cancelRe').click(); 1`); await sleep(300);
const before = await evalJs(`({ connects: window.__connects, choosers: window.__requestDevices })`);
await evalJs(`window.__failConnects = 99; document.getElementById('connectAgain').click(); 1`);
await sleep(6500);                                                         // 3 attempts with 1.5 s gaps, then the countdown
const cd2 = await evalJs(`({ count: document.getElementById('reCount').textContent, countdown: !document.getElementById('reState').hidden, idle: !document.getElementById('reIdle').hidden, connects: window.__connects, choosers: window.__requestDevices })`);
check('after three refused attempts the pack sits on the reconnect countdown, not on the Connect button', cd2.countdown && !cd2.idle && cd2.connects - before.connects === 3 && cd2.choosers - before.choosers === 1 && /reconnecting to n11 in/.test(cd2.count), { ...cd2, before });
await evalJs(`window.__failConnects = 0; 1`);
await sleep(9000);                                                         // the countdown's own attempt now succeeds
await notify(OWNER_32S_CELL); await sleep(500);
s = await state();
check('...and the countdown brings it back once the BMS accepts', s.gatt === true && /^connected/i.test(s.stat), s);

// --- the screen lock: asked for again when the phone lets go of it, then a silent video (old Sony slept after hours, 2026-09-19) ---
const wakeState = () => evalJs(`({ locks: window.__locks.length, ...window.__batrayTest.wakeState(), plays: window.__plays.filter((p) => /keepawake/.test(p)), paused: document.getElementById('keepVideo').paused, muted: document.getElementById('keepVideo').muted, volume: document.getElementById('keepVideo').volume, note: !document.getElementById('wakeVideo').hidden, saved: localStorage.getItem('batray_keepawake') })`);
let wk = await wakeState();
check('a connected pack holds the screen wake lock, no video', wk.lock && wk.locks >= 1 && !wk.video && wk.plays.length === 0, wk);
const locks0 = wk.locks;
await evalJs(`window.__dropWake(); 1`); await sleep(2600);                 // first drop: asked again after 2 s, still no video
wk = await wakeState();
check('a lock the system drops while the tab is in front is asked for again', wk.lock && wk.locks === locks0 + 1 && wk.drops === 1 && !wk.video, wk);
await evalJs(`window.__dropWake(); 1`); await sleep(800);                  // second drop: the video steps in at once
wk = await wakeState();
check('a second drop starts the keep-awake video, unmuted at 1 % volume, with a status note', wk.drops === 2 && wk.video && !wk.paused && wk.muted === false && Math.abs(wk.volume - 0.01) < 1e-6 && wk.plays.length === 1 && wk.note, wk);
await sleep(4000);                                                         // 4 s back-off, then the lock is asked for again too
wk = await wakeState();
check('...and the lock itself is still asked for again', wk.lock && wk.locks === locks0 + 2, wk);
const setKeep = async (v) => { await evalJs(`document.getElementById('keepAwake').click(); 1`); await sleep(150); await evalJs(`document.querySelector('#sheetOpts [data-opt="${v}"]').click(); 1`); };   // the choice is a bottom sheet, not a select
await setKeep('never'); await sleep(300); wk = await wakeState();
check('"never" stops the video and is remembered', !wk.video && wk.paused && !wk.note && wk.saved === 'never', wk);
await setKeep('always'); await sleep(500); wk = await wakeState();
check('"always" plays it even while the lock is held', wk.video && !wk.paused && wk.lock && wk.saved === 'always', wk);
await setKeep('auto');

// --- the upright battery: a level that fills from the bottom, cut-off line at the inverter's percent (0.9.20) ---
const bf = await evalJs(`({ soc: document.getElementById('fSoc').textContent, h: +document.getElementById('fFill').getAttribute('height'), y: +document.getElementById('fFill').getAttribute('y'), cls: document.getElementById('fFill').getAttribute('class'), cut: document.getElementById('fCut').getAttribute('d'), cutShown: document.getElementById('fCut').getAttribute('display') !== 'none' })`);
const socN = parseInt(bf.soc, 10);
check('the battery level matches the SOC and the cut-off line sits at 10 %', Number.isFinite(socN) && socN > 0 && Math.abs(bf.h - 132 * socN / 100) < 0.05 && Math.abs(bf.y + bf.h - 151) < 0.05 && /\bon\b/.test(bf.cls) && bf.cut === 'M9 137.8 H111' && bf.cutShown, bf);
await evalJs(`{ const c = document.getElementById('cutoff'); c.value = '20'; c.dispatchEvent(new Event('change')); } 1`); await sleep(200);
const bf2 = await evalJs(`document.getElementById('fCut').getAttribute('d')`);
check('changing the cut-off moves the line on the battery at once', bf2 === 'M9 124.6 H111', bf2);
await evalJs(`{ const c = document.getElementById('cutoff'); c.value = '10'; c.dispatchEvent(new Event('change')); } 1`);

// --- the share setup prefills the BMS's own name ---
await evalJs(`localStorage.removeItem('batray_share_name'); document.getElementById('share').click(); 1`); await sleep(200);
const sp = await evalJs(`({ name: document.getElementById('shareName').value, shown: !document.getElementById('sharePanel').hidden })`);
check('Share prefills the name with the BMS name', sp.shown && sp.name === 'n11', sp);
await evalJs(`document.getElementById('shareCancel').click(); 1`);

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
