// BatRay by ClearEvo.com - review tests (fable, round 4) F4-1: a NotFoundError about ANOTHER tab's files restarts this tab's healthy store
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
// 0.9.93: any store call that fails with a NotFoundError is taken as "this site's storage went away" and the store
// starts over (HistoryStore.storageGone: the worker is terminated, a fresh one takes the pool, the app re-reads
// today's counters and the log store, the log says "what it held is gone"). But one NotFoundError is ordinary: the
// worker's logRead / logRemove for ANOTHER tab's store looks that store's log directory up without creating it
// (logDirOf(store, false)), and it throws when that store is gone - Browse > logs lists every tab's files, and a
// closed viewer tab's store is freed by this page itself (dropOrphans at every start and midnight: 30 days unused,
// or space low) or by a Delete in Browse > history while the list is on screen. A tap on Delete or Upload of such a
// stale row then restarts the reader's own, healthy store: its worker is killed (flushes in flight fail), the log
// claims the storage was lost, and a fresh worker has to take the pool back (the lock-out path if it cannot).
// Nothing is lost when the pool comes back, so this is ranked low - but the storage-gone rule should fire on this
// tab's own files only.
//
// The real page with rows and a debug log stored; Browse > logs open; Delete of a log row whose (other) store no
// longer exists. Expected: that row is simply gone - no store restart, no "storage went away" line.
// Run: CDP=9427 PORT=8412 node test/review/fable_r4_notfound_other_store.mjs
import { openTab, FAKE_RELAY, BASE, sleep, fakeBle } from './fable_cdp.mjs';
import { OWNER_32S_CELL, AIO_32S_DEV } from '../batray_frames.js';

const t = await openTab();
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: await fakeBle() });
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_RELAY });
await t.send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(3000);
await t.evalJs(`window.__batrayTest.setLogKeep(true); document.getElementById('connectBig').click(); 1`); await sleep(1500);
await t.evalJs(`window.__notify([${[...AIO_32S_DEV].join(',')}]); window.__feed = setInterval(() => window.__notify([${[...OWNER_32S_CELL].join(',')}]), 400); 1`);
await sleep(12000);
const today = new Date().toISOString().slice(0, 10);
const before = await t.evalJs(`(async () => ({ rows: (await window.__batrayTest.histInfo('${today}')).rows, logs: (await window.__batrayTest.logList()).length }))()`);
t.check('setup: rows and a debug log are stored', before.rows >= 2 && before.logs >= 1, before);
void t.evalJs(`window.__batrayTest.openBrowse('log'); 1`); await sleep(800);
// a row of a store that has been freed since the list was drawn (a valid store id with no files)
const res = await t.evalJs(`window.__batrayTest.browseDelete('zzzzzzzz/log-2026-01-01T00-00-00Z-abcdef.txt').then(() => 'ok', (e) => 'threw: ' + e.message)`);
await sleep(4000);
const lines = await t.logs('/storage went away|fresh worker answers|worker stopped|pool busy/');
console.log(`Delete of a row of a store that is gone: ${res}`);
t.check('F4-1: a file of another, vanished store does not make this tab\'s store "start over" (no restart, no "storage went away" line)', lines.length === 0, lines.map((l) => l.slice(14, 200)));
const after = await t.evalJs(`window.__batrayTest.histInfo('${today}').then((i) => i.rows, (e) => 'info failed: ' + e.message)`);
t.check('the stored rows are still there', typeof after === 'number' && after >= before.rows, after);
await t.done();
