// BatRay by ClearEvo.com - log review 2026-11-27 (Fable), L4 + L5: a gap ask in the middle of a transfer; the reach hold
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
// L4: sea-hut reader 11-26 11:58 (viewer 6djYFL) and backyard reader 11-26 03:31 (viewer 0ksXdA): the viewer asked at
// link-up, the reader began sending today in 2000-row files, the first file left "still a hole" and 4-5 s later the
// viewer's gap ask went out while the other files were still arriving; the reader planned again from the new mark and
// sent the files in flight a second time (3268 rows / 90 KB over the hut's 5G; 19663 rows / 644 KB at home).
// L5: REACH_HOLD_MS (10 s) is shorter than one reopen cycle of the socket (4 s wait + a 10 s open deadline), so every
// socket death that needs a second try is announced: 71 "Server unreachable" + 71 "Back online" in 51 h on the hut
// reader, 64 of the 71 over within a minute.
// Run: node --test test/review/fable_logs_transfer_reach.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { historyState, histReqDecision, rxChunk, GAP_REQ_MS } from '../../public/batray/history-logic.js';
import { REACH_HOLD_MS } from '../../public/batray/share-logic.js';

test('L4 no gap ask while a file from the reader is being received', () => {
  const hs = historyState(), t0 = 1e6;
  assert.equal(histReqDecision(hs, { live: true, now: t0 }).action, 'request');             // link up: the catch-up ask
  rxChunk(hs, { day: '2026-11-26', after: 8085, n: 0, of: 5, b64: 'AAAA' });                // file 2 of the answer has begun
  const d = histReqDecision(hs, { live: true, now: t0 + GAP_REQ_MS + 500, gap: true });      // file 1 left "still a hole"
  assert.equal(d.action, 'noop', 'asked again while chunk 1 of 5 of the next file is in the assembly: the reader resends what is in flight');
});

test('L5 the reach hold outlasts one reopen cycle (4 s wait + 10 s open deadline)', () => {
  assert.ok(REACH_HOLD_MS > 4000 + 10000, `REACH_HOLD_MS ${REACH_HOLD_MS} ms: "Server unreachable" is announced before the first reopen can fail`);
});
