// BatRay by ClearEvo.com - review tests (fable, round 5) F5-1: after a corrupt live file the reader numbers today from 1 again
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
// 0.9.94 keeps today's row ids going after a store wipe (initHistoryOnce: nextId = max(maxId + 1, the previous
// nextId)), because a viewer holds the reader's rows by id: replicaDecision() takes a live row whose id is at or
// under the viewer's contiguous mark as a duplicate and stores nothing. The other path that starts today's file
// over was left as it was: corruptDb() on a live write sets histS.nextId = 1 and numbers the new file from 1. A
// viewer that holds today up to id N then drops every new reading as "already stored" until the reader's new ids
// pass N - as long again as the day had already run - and what it asks for by id is answered from the wrong rows.
// The same defect as the wipe, by the same mechanism, one function away.
//
// The real reader page with a fake BMS: rows stored, today's file damaged (the worker's test hook), the next flush
// renews it. Expected: the ids go on above the ones already handed out.
// Run: CDP=9427 PORT=8412 node test/review/fable_r5_corrupt_ids.mjs
import { openTab, FAKE_RELAY, BASE, sleep, fakeBle } from './fable_cdp.mjs';
import { OWNER_32S_CELL, AIO_32S_DEV } from '../batray_frames.js';

const t = await openTab();
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: await fakeBle() });
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_RELAY });
await t.send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(3000);
await t.evalJs(`document.getElementById('connectBig').click(); 1`); await sleep(1500);
await t.evalJs(`window.__notify([${[...AIO_32S_DEV].join(',')}]); window.__feed = setInterval(() => window.__notify([${[...OWNER_32S_CELL].join(',')}]), 400); 1`);
await sleep(42000);
const today = new Date().toISOString().slice(0, 10);
await t.evalJs(`window.__batrayTest.flushHistory()`); await sleep(500);
const before = await t.evalJs(`window.__batrayTest.histInfo('${today}')`);
t.check('setup: today has at least 10 numbered rows', before.rows >= 10 && before.maxId >= 10, before);
await t.evalJs(`window.__batrayTest.histCorrupt('${today}')`);
await sleep(24000);                                                   // two flushes: the failing one renews the file, the next writes into it
const renewed = await t.logs('/database is corrupt -> renew/');
const after = await t.evalJs(`window.__batrayTest.histInfo('${today}').then((i) => ({ rows: i.rows, maxId: i.maxId }), (e) => 'info failed: ' + e.message)`);
t.check('setup: the damaged live file was renewed and rows are stored again', renewed.length >= 1 && after && after.rows >= 1, { renewed: renewed.length, after });
// a viewer holding ids 1..before.maxId takes anything at or under that as a duplicate: the new ids must be above it
t.check(`F5-1: the renewed file's ids go on above ${before.maxId} (a viewer that holds today up to there would drop lower ones as duplicates)`, after && after.maxId > before.maxId, { before: before.maxId, after });
await t.done();
