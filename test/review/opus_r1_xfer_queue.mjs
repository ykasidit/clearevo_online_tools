// BatRay by ClearEvo.com - review round 1 (Opus), O-xfer: history sent again and again to viewers that are gone
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
// The relay gives every viewer SOCKET its own id, and a viewer asks for history at every link-up. While a transfer
// runs (minutes over a reader's 1.5 Mbps Wi-Fi), a viewer that reconnects - a phone changing networks, a tab woken
// from the background, a public visitor opening the how-to's live demo link and leaving - asks again under a new id.
// histRequest() queues a full plan per id (up to XFER_MAX_ROWS = 200000 rows each) and never drops the plans of ids
// that are gone: the 24/7 reader reads, gzips, encrypts and uploads the same week of rows once per stale id, while
// its live readings compete for the same socket. Here one viewer (the room says viewers=1 throughout) reconnects 5
// times during a transfer; the reader may keep at most one plan's worth of rows queued for it.
// Run: CDP=9411 PORT=8411 node test/review/opus_r1_xfer_queue.mjs
import { cdp, startReader, sleep, checker } from './opus_r1_lib.mjs';
const { check, done } = checker();
const c = await cdp();
await startReader(c, { debug: false });
const T = 'window.__batrayTest';
// three past days of 6000 rows each (a real day of one pack is 14-26k rows)
const seeded = await c.evalJs(`(async () => { const t = ${T}, day = t.histState().day; const tpl = { p: 'n11', soc: 53, v: 50.667, i: 4.2, w: 212.8, ah: 126.6, tm: 30, t1: 30.4, t2: 29.2, ch: 1, ds: 1, bal: 0, err: 0, c: [3619, 3618, 3619, 3619, 3620, 3620, 3619, 3619, 3620, 3620, 3618, 3619, 3619, 3620] };
  const rows = []; for (let d = 1; d <= 3; d++) { const from = Date.parse(day + 'T00:00:00Z') - d * 86400000; for (let i = 0; i < 6000; i++) { const r = { ...tpl, t: from + i * 14000 }; delete r.id; rows.push(r); } }
  return t.histSeed(rows); })()`);
check('seeded three past days (a profile reused from an earlier run may hold some already)', seeded >= 0, seeded);
// the uplink is slow: the socket has a backlog, so the transfer paces (waits) between chunks
await c.evalJs(`for (const s of window.__socks) if (/role=pub/.test(s.url)) Object.defineProperty(s, 'bufferedAmount', { get: () => 200 * 1024 }); 1`);
await c.evalJs(`window.__toPub({ type: 'hist-req', from: 'sockA1', have: [] }); 1`);
await sleep(1500);
for (let i = 2; i <= 6; i++) { await c.evalJs(`window.__toPub({ type: 'status', viewers: 1, live: true }); window.__toPub({ type: 'hist-req', from: 'sockA${i}', have: [] }); 1`); await sleep(400); }
const x = await c.evalJs(`(() => { const s = ${T}.histState(); const q = s.xfer ? s.xfer.queue : []; return { items: q.length, rows: q.reduce((a, b) => a + b.rows, 0), plan: q.filter((i) => i.to === 'sockA6').reduce((a, b) => a + b.rows, 0), to: [...new Set(q.map((i) => i.to))] }; })()`);
console.log('queue', JSON.stringify(x));
check('with one viewer in the room, the queued history is at most one plan (the newest id\'s), not one per socket id it ever had', x.plan > 0 && x.rows <= x.plan, x);
c.close();
done('opus_r1_xfer_queue');
