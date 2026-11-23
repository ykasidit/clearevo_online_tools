// BatRay by ClearEvo.com - review round 4 (Opus), O4-1: after a storage wipe the reader numbers today from 1 again
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
// 0.9.93 (round 3's O3-1/F3-1): a wiped site storage makes the store start over, and onBackend('opfs') re-runs
// initHistory(), which reads today's counters from the fresh, empty file: nextId = 1. The viewers still hold today's
// rows 1..N under the reader's ids (a byte replica, 0.9.31). On a viewer, replicaDecision() takes every live row with
// an id <= its contig for a re-send it already has ('append', dup) and does not store it, and transferPlan() sees the
// reader's day smaller than its own and sends nothing - so every viewer drops the reader's new readings until the
// new numbering passes N: up to a whole day of history (28800 rows at 3 s) lost on every viewer, silently. The page
// knew N before the wipe (histS.nextId); the new file should go on from there.
// Run: CDP=9411 PORT=8411 node test/review/opus_r4_wipe_numbering.mjs
import { cdp, startReader, sleep, BASE, checker } from './opus_r1_lib.mjs';
const { check, done } = checker();
const c = await cdp();
await startReader(c, { debug: true, share: false });               // the debug log on: a log write notices the wipe within 3 s
const T = 'window.__batrayTest';
await c.until(`${T}.histState().todayRows > 0`, 20000);
// today already holds 500 rows (a morning of one pack), as every viewer's copy does
await c.evalJs(`(async () => { const t = ${T}, day = t.histState().day, from = Date.parse(day + 'T00:00:00Z'), rows = [];
  const tpl = { p: 'n11', soc: 53, v: 50.667, i: 4.2, w: 212.8, ah: 126.6, tm: 30, t1: 30.4, t2: 29.2, ch: 1, ds: 1, bal: 0, err: 0, c: [3619, 3618, 3619] };
  for (let i = 0; i < 500; i++) rows.push({ ...tpl, t: from + i * 1000 }); return t.histSeed(rows); })()`);
await sleep(11000);
const before = await c.evalJs(`${T}.histState().nextId`);
await c.send('Storage.clearDataForOrigin', { origin: new URL(BASE).origin, storageTypes: 'file_systems' });
await c.evalJs(`${T}.flushHistory().then(() => 1)`);                // the 10 s flush happened to run just after the wipe (into the deleted file, 'ok')
const back = await c.until(`${T}.logLines().some((l) => /storage went away/.test(l)) && ${T}.histState().todayRows > 0 && (${T}.histState().nextId > 1)`, 120000, 500);
await sleep(8000);                                                   // a few new rows numbered by the fresh file
// (the next id the reader gives a reading; the viewer is judged on the newest one it numbered)
const after = await c.evalJs(`(async () => { const t = ${T}, h = t.histState(); const rows = await t.histRows(h.day, 0, 100000); return { nextId: h.nextId, ids: rows.map((r) => r.id) }; })()`);
// what a viewer that holds today's rows 1..before-1 does with the reader's next live row
const viewer = await c.evalJs(`(async () => { const L = await import('/batray/history-logic.js'); const hs = { contig: ${before - 1} }; const id = ${after.nextId - 1};
  return L.replicaDecision(hs, { id, t: Date.now() }, L.dayKey(Date.now())); })()`);
console.log(`before the wipe the next id was ${before}; the store came back: ${back}; after: ${JSON.stringify(after)}; a viewer holding 1..${before - 1} decides ${JSON.stringify(viewer)}`);
check('after the wipe the reader goes on numbering today from where it was (a viewer that holds the morning stores the new rows)', after.nextId > before && !viewer.dup, { before, after, viewer });
c.close();
done('opus_r4_wipe_numbering');
