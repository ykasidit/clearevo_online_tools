// BatRay by ClearEvo.com - review tests (fable, round 2) F2-1: a frozen viewer tab still counts as a viewer
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
// 0.9.91 made the reader publish one reading per 3 s while the room says viewers=0 and every frame while it says
// viewers>0 (dataPublishDue), and made the READER close its socket when Chrome freezes it (freezeLinks, 4004). The
// viewer page does neither: a viewer tab left open on a phone is frozen a minute after it is hidden and keeps its
// socket in the room for as long as it stays frozen (the uploaded viewer logs hold viewer sessions that slept for
// hours and days: tombstones "viewer connected, viewing live=true" last seen 65, 81, 1440 and 1514 min before the
// next start, and "the page slept N s" lines). So one forgotten viewer tab anywhere keeps viewers>=1 and the
// reader at full rate - about 0.4 GB of uplink a day per pack, an encryption and a relay write per frame, the very
// load round 1 removed - and the relay keeps sending every reading to a socket nobody reads, which the viewer then
// gets in one burst at its wake ("N queued readings ... stored but not shown").
//
// The real viewer page over a fake relay socket, a real freeze by CDP. Expected: the viewer closes its socket
// before the page stops (the room's viewer count drops, the reader idles) and opens a new one after the resume.
// Run: CDP=9427 PORT=8412 node test/review/fable_r2_viewer_freeze.mjs
import { openTab, FAKE_RELAY, BASE, sleep } from './fable_cdp.mjs';

const KEY = 'qOZe1xrVxvTfYHUobOqjmg';
const t = await openTab();
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_RELAY });
await t.send('Page.navigate', { url: `${BASE}/batray/?view=AbCdEfGhIjKlMnOpQrStUv&test#k=${KEY}` }); await sleep(3500);
const socks = `window.__wsAll.filter((w) => /role=view/.test(w.url))`;
const before = await t.evalJs(`${socks}.map((w) => w.readyState)`);
t.check('setup: the viewer has one open socket in the room', before.length === 1 && before[0] === 1, before);
await t.evalJs(`${socks}[0].push({ type: 'status', viewers: 1, live: true }); 1`);

await t.send('Page.setWebLifecycleState', { state: 'frozen' });
const frozenAt = Date.now();
await sleep(3000);
const resumedAt = Date.now();
await t.send('Page.setWebLifecycleState', { state: 'active' });
await sleep(400);
const first = await t.evalJs(`${socks}[0].closedWith`);
// threshold: closed before the page stopped (1 s of slack for the freeze handler), as the reader's now is
t.check('F2-1: a viewer that Chrome freezes leaves the room (its socket is closed before the page stops), so the reader stops publishing every frame for it',
  !!first && first.at <= frozenAt + 1000 && first.at < resumedAt, { closedWith: first, frozenAt, resumedAt });
await sleep(7000);
const after = await t.evalJs(`${socks}.map((w) => w.readyState)`);
t.check('after the resume the viewer is in the room again (an open socket)', after.includes(1), after);
await t.done();
