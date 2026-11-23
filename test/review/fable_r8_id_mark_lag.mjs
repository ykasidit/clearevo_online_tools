// BatRay by ClearEvo.com - review tests (fable, round 8) F8-1: the reader's id mark lags the ids it has already published
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
// Round 7 keeps the reader's next row id beside the store (tk('ids')), so today is never numbered from below ids
// that viewers already hold. The mark is written after each flush (every 10 s), but an id is handed out - and sent
// to the viewers with its row - the moment a reading is taken. A reader page that ends without its pagehide (the
// commonest end in the logs: a Chrome update or the system killing it; 5 of 17 tombstones name an update) loses the
// rows queued since the last flush: they were published under ids mark..mark+k, they are in no file and in no
// spill, and the next start numbers from max(file's highest + 1, mark) = those same ids again. Every viewer that was
// watching holds them already, so the first k rows after each such restart are duplicates to it (replicaDecision)
// and are never stored there, and a later transfer plan starts above them. Small - up to 10 s of rows per pack per
// unclean end - but it is the same broken promise rounds 4 to 7 were about, and it happens at every Chrome update.
//
// The real reader page with a fake BMS, sharing to a room that says one viewer watches. Sampled for 25 s: the id
// the next row will get, and the mark a restart would read. Expected: the mark is never below an id already used.
// Run: CDP=9427 PORT=8412 node test/review/fable_r8_id_mark_lag.mjs
import { openTab, FAKE_RELAY, BASE, sleep, fakeBle } from './fable_cdp.mjs';
import { OWNER_32S_CELL, AIO_32S_DEV } from '../batray_frames.js';

const t = await openTab();
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: await fakeBle() });
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_RELAY });
await t.send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(3000);
await t.evalJs(`document.getElementById('share').click(); 1`); await sleep(300);
await t.evalJs(`document.getElementById('shareGo').click(); 1`); await sleep(1500);
await t.evalJs(`window.__wsAll.at(-1).push({ type: 'status', viewers: 1, live: true }); document.getElementById('connectBig').click(); 1`); await sleep(1500);
await t.evalJs(`window.__notify([${[...AIO_32S_DEV].join(',')}]); window.__feed = setInterval(() => window.__notify([${[...OWNER_32S_CELL].join(',')}]), 400); 1`);
await sleep(14000);                                                   // past the first flush: a mark exists
const r = await t.evalJs(`new Promise((done) => {
  const T = window.__batrayTest, key = T.tabKey('ids'); let worst = 0, at = null, n = 0;
  const iv = setInterval(() => {
    const next = T.histState().nextId; let mark = 0; try { mark = JSON.parse(localStorage.getItem(key) || 'null').next || 0; } catch { /* none */ }
    if (next - mark > worst) { worst = next - mark; at = { nextId: next, mark }; }
    if (++n >= 125) { clearInterval(iv); done({ worst, at, samples: n, nextId: next }); }
  }, 200);
})`);
console.log(`25 s sampled: next id ${r.nextId}; the mark was behind by up to ${r.worst} id(s)${r.at ? ` (next ${r.at.nextId}, mark ${r.at.mark})` : ''}`);
t.check('setup: rows are numbered and a mark is kept', r.nextId > 5 && r.at !== null || r.worst === 0, r);
// threshold 0: an id that has left for the viewers must never be given to another row after an unclean restart
t.check(`F8-1: the persisted mark covers every id already handed out (it was ${r.worst} behind: a kill at that moment gives ${r.worst} new rows ids viewers already hold)`, r.worst === 0, r.at);
await t.done();
