// BatRay by ClearEvo.com - review tests (fable, round 7) F7-1: deleting today's history on the reader numbers today from 1 again
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
// 0.9.94 keeps the reader's row ids going when today's file starts over after a store wipe and after a corrupt live
// file, because a viewer holds the reader's rows by id: a live row at or under its complete run is a duplicate
// (replicaDecision) and a transfer plan starts after that run (transferPlan: after = min(viewer's contig, reader's
// highest id) - nothing to send while the reader's new ids are below it). Two more ways start today's file over,
// and both still set histS.nextId = 1: Browse > history > Delete on today's file (browseDelete) and Clear stored
// history (clearHistory). After either, every viewer that holds today up to id N stores none of the reader's new
// readings - not live, not by asking - until the new ids pass N: the rows the reader has, the viewer never gets.
// (A third way is not tested here: the reader page reloaded while its renewed file is still empty reads maxId 0 and
// starts at 1 too - the kept counter lives in memory only. One persisted high-water mark per day would cover all.)
//
// The real reader page with a fake BMS: rows stored, today deleted in Browse, more rows stored.
// Expected: the ids go on above the ones already handed out, as after a wipe or a corrupt file.
// Run: CDP=9427 PORT=8412 node test/review/fable_r7_delete_today_ids.mjs
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
const info = () => t.evalJs(`window.__batrayTest.flushHistory().then(() => window.__batrayTest.histInfo('${today}')).then((i) => ({ rows: i.rows, maxId: i.maxId }), (e) => 'failed: ' + e.message)`);
const before = await info();
t.check('setup: today has at least 10 numbered rows', before.rows >= 10 && before.maxId >= 10, before);

void t.evalJs(`window.__batrayTest.openBrowse('hist'); 1`); await sleep(800);
await t.evalJs(`window.__batrayTest.browseDelete('${today}')`); await sleep(15000);
const afterDelete = await info();
t.check('setup: today was deleted and new rows are stored', afterDelete.rows >= 2 && afterDelete.rows < before.rows, afterDelete);
// a viewer holding ids 1..before.maxId takes anything at or under that as a duplicate and is sent nothing below it
t.check(`F7-1: after Browse > Delete of today the new rows' ids go on above ${before.maxId}`, afterDelete.maxId > before.maxId, { before: before.maxId, after: afterDelete });
await t.done();
