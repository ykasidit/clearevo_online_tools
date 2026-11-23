// BatRay by ClearEvo.com - review tests (fable, round 1) F5: a frozen reader keeps the BMS's Bluetooth link it cannot serve
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
// Evidence (uploaded reader logs, numbers only): on waking from a freeze the reader's first act was "dropping
// link: no data for 16457 s" and, a day later, "... for 80155 s" - the GATT link was still nominally connected after
// 4.6 h and 22.3 h frozen. All that time the page could read nothing, the BMS's ONE Bluetooth slot was taken (the
// JK app, or another phone that could have taken over as the reader, cannot connect), the Bluetooth stack kept
// delivering 2-3 frames a second to a page that could not take them, and at the wake the link is dropped and
// reconnected anyway (the gap rule). Nothing is gained by keeping it.
//
// The real page, the fake BMS streaming, a real freeze by CDP. Expected: the link is closed before the page stops
// (a connected link only - a pending connect is never touched, 0.9.81), and the reader reconnects by itself after
// the resume (the countdown it already has).
// Run: CDP=9427 PORT=8412 node test/review/fable_r1_freeze_ble.mjs
import { openTab, FAKE_RELAY, BASE, sleep, fakeBle } from './fable_cdp.mjs';
import { OWNER_32S_CELL, AIO_32S_DEV } from '../batray_frames.js';

const t = await openTab();
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: await fakeBle() });
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_RELAY + `
  { const g = window.__dev.gatt, d0 = g.disconnect; g.disconnect = () => { if (g.connected) window.__discAt = Date.now(); d0(); }; }` });
await t.send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(3000);
await t.evalJs(`document.getElementById('connectBig').click(); 1`); await sleep(2000);
await t.evalJs(`window.__notify([${[...AIO_32S_DEV].join(',')}]); window.__feed = setInterval(() => window.__notify([${[...OWNER_32S_CELL].join(',')}]), 400); 1`);
await sleep(2500);
const before = await t.evalJs(`({ gatt: window.__dev.gatt.connected, conn: window.__batrayTest.connState(), soc: document.getElementById('fSoc').textContent })`);
t.check('setup: connected and reading', before.gatt && before.conn && before.conn.phase === 'connected' && before.soc !== '-', before);

await t.send('Page.setWebLifecycleState', { state: 'frozen' });
const frozenAt = Date.now();
await sleep(3000);
const resumedAt = Date.now();
await t.send('Page.setWebLifecycleState', { state: 'active' });
await sleep(400);
const at = await t.evalJs(`window.__discAt || null`);
// threshold: closed before the page stopped; 1 s of slack for the freeze handler
t.check('F5: the freeze closes the GATT link before the page stops (the BMS slot is free while the reader cannot read)', at !== null && at <= frozenAt + 1000 && at < resumedAt, { disconnectedAt: at, frozenAt, resumedAt });
await sleep(16000);                                                   // the 10 s reconnect countdown, the connect, a frame
const after = await t.evalJs(`({ gatt: window.__dev.gatt.connected, conn: window.__batrayTest.connState(), connects: window.__connects })`);
t.check('after the resume the reader is connected (again) by itself', after.gatt && after.conn && after.conn.phase === 'connected', after);
await t.done();
