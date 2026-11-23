// BatRay by ClearEvo.com - review tests (fable, round 1) F4: with nobody watching, the reader still sends every frame to the relay
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
//
// A JK BMS pushes a cell frame 2-3 times a second. Pack.onData publishes every one of them (app.js: `if (publisher)
// void publisher.publish(envelope('data', ...))`) whether or not a viewer is in the room: JSON + AES-GCM + base64 +
// a socket send per frame, about 216 000 messages and a few hundred MB of uplink a day per pack, each one waking the
// room object and rewriting its retained list - for a 24/7 reader whose viewers look a few minutes a day. The room
// only needs the newest reading for a viewer who joins later, and the reader stores one row per MIN_ROW_MS (3 s)
// anyway. This is load, not a proven kill: an always-on old phone that never lets its radio and CPU rest runs
// hotter and empties its battery sooner in a power cut (one tombstone in the logs: 40 h up, then phone 1 %, not
// charging, offline). It is listed last for that reason.
//
// The real page, a fake BMS at 2.5 frames a second for 12 s, the room saying viewers=0.
// Run: CDP=9427 PORT=8412 node test/review/fable_r1_publish_idle.mjs
import { openTab, FAKE_RELAY, BASE, sleep, fakeBle } from './fable_cdp.mjs';
import { OWNER_32S_CELL, AIO_32S_DEV } from '../batray_frames.js';

const t = await openTab();
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: await fakeBle() });
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_RELAY });
await t.send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(3000);
await t.evalJs(`document.getElementById('share').click(); 1`); await sleep(300);
await t.evalJs(`document.getElementById('shareGo').click(); 1`); await sleep(1500);
await t.evalJs(`window.__wsAll.at(-1).push({ type: 'status', viewers: 0, live: true }); document.getElementById('connectBig').click(); 1`); await sleep(2500);
await t.evalJs(`window.__notify([${[...AIO_32S_DEV].join(',')}]); 1`); await sleep(300);
const SECONDS = 12, HZ = 2.5;
const count = () => t.evalJs(`({ data: window.__wsSent.filter((m) => m.type === 'd' && /^data/.test(m.slot || '')).length, bytes: window.__wsSent.filter((m) => m.type === 'd' && /^data/.test(m.slot || '')).reduce((n, m) => n + m.b.length, 0), viewers: window.__batrayTest.pubState ? window.__batrayTest.pubState().viewers : null })`);
const a = await count();
await t.evalJs(`new Promise((done) => { let n = 0; const iv = setInterval(() => { window.__notify([${[...OWNER_32S_CELL].join(',')}]); if (++n >= ${SECONDS * HZ}) { clearInterval(iv); done(1); } }, ${1000 / HZ}); })`);
await sleep(500);
const b = await count();
const sent = b.data - a.data, frames = SECONDS * HZ;
console.log(`${frames} frames in ${SECONDS} s with no viewer: ${sent} data messages, ${b.bytes - a.bytes} base64 bytes (${Math.round((b.bytes - a.bytes) / SECONDS * 86400 / 1048576)} MB a day at this rate)`);
t.check('setup: the frames reached the page (it is connected and shows a reading)', (await t.evalJs(`document.getElementById('fSoc').textContent`)) !== '-', null);
// threshold: one retained reading per stored row (MIN_ROW_MS = 3 s) is all a late viewer can use: 12 s -> 4, +2 for the edges
t.check(`F4: with viewers=0 the reader sends at most one reading per 3 s (<= 6 in ${SECONDS} s), not one per frame`, sent <= 6, { sent, frames });
await t.done();
