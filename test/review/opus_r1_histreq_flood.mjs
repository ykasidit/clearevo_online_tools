// BatRay by ClearEvo.com - review round 1 (Opus), O-flood: every viewer's history request runs at once, unbounded
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
// The relay forwards every `hist-req` a viewer socket sends straight to the reader (room.rs: no rate limit), and a
// viewer socket needs only the room id - the live demo's room id is printed on the public how-to page. Publisher.onMsg
// calls histRequest() for each without waiting, so N requests are N concurrent flushes + N full day listings in the
// SQLite worker, all queued in front of the live inserts (each with its own deadline). Here one socket sends 60 asks
// within a second (a buggy or hostile viewer; a benign one asks at link-up, every 10 min and on a gap): the reader
// may list its days a handful of times, not once per message.
// Run: CDP=9411 PORT=8411 node test/review/opus_r1_histreq_flood.mjs
import { cdp, startReader, sleep, checker } from './opus_r1_lib.mjs';
const { check, done } = checker();
const c = await cdp();
await startReader(c, { debug: false });
const T = 'window.__batrayTest';
await sleep(1500);
const n0 = await c.evalJs(`${T}.histStatsRaw().ops.days.n`);
await c.evalJs(`(async () => { for (let i = 0; i < 60; i++) { window.__toPub({ type: 'hist-req', from: 'flood1', have: [] }); await new Promise((r) => setTimeout(r, 15)); } return 1; })()`);
await sleep(4000);
const n1 = await c.evalJs(`${T}.histStatsRaw().ops.days.n`);
const lines = await c.evalJs(`${T}.logLines().filter((l) => /history: request from flood1/.test(l)).length`);
console.log(`days listings for 60 asks: ${n1 - n0}; request lines logged: ${lines}`);
check('60 history asks from one socket within a second cost at most 5 day listings in the worker (one ask in flight per viewer, the rest coalesced or refused)', n1 - n0 <= 5, { listings: n1 - n0, lines });
c.close();
done('opus_r1_histreq_flood');
