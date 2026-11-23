// BatRay by ClearEvo.com - review round 8 (Opus), O8-1: a reader tab opened as a viewer keeps the reader's store
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
// pickTab() (0.9.77) keeps "this tab, as before" whenever the tab's sessionStorage id is there and its lock is free -
// with no look at the role or the room. A reader phone whose person opens a share link in the SAME tab (pasting the
// copied link, typing it) becomes a viewer of that room on top of the reader's own store: its day files hold the
// reader's own rows under the reader's ids. The viewer then counts those rows as its copy of the room's day: its
// run (contig, sent as `have` to the room's reader) claims today complete to the reader's own highest id, so the
// room's reader never sends its rows up to there; rows it does send collide with the reader's own ids and are
// ignored as already stored; and back as the reader, this phone's files hold the other room's rows, which it then
// sends to its own viewers. Here: a reader stores rows, then the same tab opens a viewer link of another room.
// Run: CDP=9411 PORT=8411 node test/review/opus_r8_tab_role.mjs
import { cdp, startReader, sleep, BASE, checker } from './opus_r1_lib.mjs';
import { randomBytes } from 'node:crypto';
const { check, done } = checker();
const c = await cdp();
await startReader(c, { debug: false, share: false });
const T = 'window.__batrayTest';
await c.until(`${T}.histState().todayRows >= 3`, 30000, 500);
await sleep(11000);                                                   // flushed into today's file
const reader = await c.evalJs(`({ tab: ${T}.tab(), rows: ${T}.histState().todayRows })`);
const key = randomBytes(16).toString('base64url');
await c.send('Page.navigate', { url: `${BASE}/batray/?test&view=otherroom0000000000000#k=${key}` }); await sleep(6000);
const viewer = await c.evalJs(`({ tab: ${T}.tab(), contig: ${T}.histState().contig, todayRows: ${T}.histState().todayRows, days: (${T}.histState().days || []).length })`);
console.log('reader', JSON.stringify(reader), 'then viewer', JSON.stringify(viewer));
check('the same tab opened as a viewer of another room gets a store of its own, not the reader\'s', viewer.tab.role === 'viewer' && viewer.tab.id !== reader.tab.id, { reader, viewer });
check('...and its copy of that room\'s today starts empty (it holds none of that room\'s rows)', viewer.contig === 0 && viewer.todayRows === 0, viewer);
c.close();
done('opus_r8_tab_role');
