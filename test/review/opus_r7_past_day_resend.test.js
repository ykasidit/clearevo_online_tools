// BatRay by ClearEvo.com - review round 7 (Opus), O7-1: a past day the reader lost rows of is resent to a viewer for ever
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
// Since 0.9.94 a reader whose today file was wiped (O4-1) or renewed as corrupt (F5-1) goes on numbering above the
// ids it lost. F6-1's receivedContig() closes the viewer's run for TODAY, in memory (histS.contig). A PAST day has no
// such memory: requestHistory() sends the viewer's db contig (counted from id 1) and its row count, and transferPlan()
// skips a day only when rows and maxId are equal. A viewer that missed part of the lost range (it was away from id
// 3001, the reader lost 1..4999 before the viewer caught up) holds 1..3000 + 5000..9000: its contig stays 3000 and its
// row count differs from the reader's, so every ask - each link-up and every 10 min, for as long as both keep the
// day - plans the reader's whole day again (rows > 3000 = all of 5000..9000), and every row arrives as "0 new".
// Here: the viewer's have as requestHistory() builds it for a past day, the reader's listing, two rounds of
// ask -> send -> store; the second ask must find nothing to send. Since the fix (0.9.94, round 7) the viewer keeps the
// run each received file closes (receivedContig) per day and reports it (haveContig) - modelled here as app.js does.
// Run: node --test test/review/opus_r7_past_day_resend.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { transferPlan, XFER_ROWS, receivedContig, haveContig } from '../../public/batray/history-logic.js';

const DAY = '2026-11-22';
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const contigOf = (ids) => { let c = 0; for (const id of [...ids].sort((x, y) => x - y)) { if (id === c + 1) c = id; else if (id > c + 1) break; } return c; };   // as the worker's contigId

test('a past day the reader lost rows of (wipe / renewed file) is not resent in full on every ask once the viewer holds every row the reader has', () => {
  const reader = new Set(range(5000, 9000));                           // the reader lost 1..4999 and went on from 5000
  const viewer = new Set([...range(1, 3000), ...range(5000, 9000)]);   // the viewer had 1..3000 before it went away, then got the rest
  const sends = []; let done;
  for (let round = 1; round <= 2; round++) {
    const have = [{ day: DAY, maxId: Math.max(...viewer), contig: haveContig(contigOf(viewer), Math.max(...viewer), done), rows: viewer.size }];   // requestHistory(), past day
    const plan = transferPlan([{ day: DAY, rows: reader.size, maxId: Math.max(...reader) }], have);
    let sent = 0;
    for (const item of plan) {                                         // histSend: the reader's rows above `after`, XFER_ROWS per file
      const ids = [...reader].filter((id) => id > item.after).sort((a, b) => a - b);
      for (let i = 0, after = item.after; i < ids.length; i += XFER_ROWS) {   // one hist-file per batch, `after` = the previous batch's last id
        const batch = ids.slice(i, i + XFER_ROWS); for (const id of batch) { viewer.add(id); sent++; }
        const run = receivedContig(haveContig(contigOf(viewer), Math.max(...viewer), done), contigOf(viewer), after, batch[batch.length - 1]);   // storeReceived()
        if (run > contigOf(viewer)) done = run;
        after = batch[batch.length - 1];
      }
    }
    sends.push(sent);
  }
  assert.equal(sends[1], 0, `the viewer already holds every row the reader has, yet the next ask sends ${sends[1]} rows again (first ask: ${sends[0]}); it repeats at every link-up and every 10 min`);
});
