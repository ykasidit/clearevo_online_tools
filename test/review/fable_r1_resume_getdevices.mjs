// BatRay by ClearEvo.com - review tests (fable, round 1) F2: a getDevices() that never answers stops the whole resume
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
// After Chrome or the phone restarts, the reopened reader page is meant to resume by itself after 30 s: share again
// on the last link, reconnect what Chrome still allows (resume-logic.js; the only unattended recovery there is).
// startResume() first awaits navigator.bluetooth.getDevices() (permittedIds) with no deadline, and doResume() awaits
// it again. The connection loop already treats that call as one that "may also hang" and gives it 2 s (conn.js
// attempt(), BLE review 2026-11-01); the resume does not. If it never answers (the adapter not up yet right after
// a boot is the likely moment), no plan is made: no countdown, no share, no reconnect, no log line - the reader page
// sits open and idle, and the relay never sees it again. Not seen in the uploaded logs (both phones have the
// getDevices flag off); proven here on the real page with a getDevices() that never settles.
// Run: CDP=9427 PORT=8412 node test/review/fable_r1_resume_getdevices.mjs
import { openTab, FAKE_RELAY, BASE, sleep, fakeBle } from './fable_cdp.mjs';

const t = await openTab();
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: await fakeBle() });
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_RELAY + `
  if (sessionStorage.getItem('hangGetDevices')) navigator.bluetooth.getDevices = () => new Promise(() => {});` });
const seed = () => t.evalJs(`localStorage.setItem(window.__batrayTest.tabKey('resume'), JSON.stringify({ share: true, packs: [{ id: 'fake-1', name: 'n11' }], at: Date.now() })); localStorage.setItem(window.__batrayTest.tabKey('share_name'), 'seahut'); 1`);
const state = () => t.evalJs(`({ share: window.__batrayTest.shareState().phase, pub: window.__wsAll.some((w) => /role=pub/.test(w.url)), conn: window.__batrayTest.connState(), plan: window.__batrayTest.logLines().filter((l) => /resume: /.test(l)).length })`);

// control: getDevices answers - the countdown (2 s here) runs out, the share is back, n11 reconnects without a tap
await t.send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(2500);
await seed();
await t.send('Page.navigate', { url: `${BASE}/batray/?test&resumetest=2&n=1` }); await sleep(9000);
const ok = await state();
t.check('control: with getDevices answering, the reader resumes by itself (share on, n11 connected)', ok.share === 'on' && ok.pub && ok.conn && ok.conn.phase === 'connected', ok);

// the case: getDevices never answers. 2 s countdown + the 2 s the connection loop already allows that call + slack
await seed();
await t.evalJs(`sessionStorage.setItem('hangGetDevices', '1'); 1`);
await t.send('Page.navigate', { url: `${BASE}/batray/?test&resumetest=2&n=2` }); await sleep(12000);
const hung = await state();
t.check('F2: with getDevices() never answering, the resume still starts (its plan is logged) within 12 s', hung.plan >= 1, hung);
t.check('F2: ...and the share is back on the last link (the part that needs no Bluetooth)', hung.share === 'on' && hung.pub, hung);
await t.done();
