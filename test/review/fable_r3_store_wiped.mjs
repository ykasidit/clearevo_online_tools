// BatRay by ClearEvo.com - review tests (fable, round 3) F3-1: storage wiped under the running page breaks the store for good, silently
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
// The lead of round 3 (the year sim, twice under load: every later insert and logAppend failed with "NotFoundError:
// A requested file or directory could not be found", never healed). This reproduces that signature on the real page
// in a few seconds, without load: the origin's private file system is removed while the page runs - what Chrome does
// when it evicts a site's storage under disk pressure (storage that is not "persistent": every headless run, and a
// phone where persist() was refused), and what "Clear site data" / Android's "Clear storage" do. After it:
//   - history-worker.js keeps its memoized directory handle (dirP) and the pool's open access handles; every
//     logAppend fails with exactly that NotFoundError, for as long as the page lives;
//   - inserts into a day file that was open keep "succeeding" (the handle writes into a deleted file): the page
//     says hist=opfs and counts rows, and nothing of it exists - the rows are gone at the next reload; an insert
//     that needs a NEW file (the next UTC day) fails with the same NotFoundError: the sim's "day files stuck";
//   - nothing restarts the worker or re-opens the pool: no timeout occurs, so the stuck rule never fires.
// A 24/7 reader therefore records nothing from that moment until a person reloads it, while showing no fault.
//
// The real page, a fake BMS, the debug log on; the file system is cleared through CDP (Storage.clearDataForOrigin,
// file_systems only - localStorage stays). Expected within 90 s: the store notices (the first failing write, or a
// probe), starts over on a fresh pool, and what is stored after that survives a reload.
// Run: CDP=9427 PORT=8412 node test/review/fable_r3_store_wiped.mjs
import { openTab, FAKE_RELAY, BASE, sleep, fakeBle } from './fable_cdp.mjs';
import { OWNER_32S_CELL, AIO_32S_DEV } from '../batray_frames.js';

const t = await openTab();
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: await fakeBle() });
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_RELAY });
const feed = `window.__notify([${[...AIO_32S_DEV].join(',')}]); window.__feed = setInterval(() => window.__notify([${[...OWNER_32S_CELL].join(',')}]), 400); 1`;
await t.send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(3000);
await t.evalJs(`window.__batrayTest.setLogKeep(true); document.getElementById('connectBig').click(); 1`); await sleep(1500);
await t.evalJs(feed); await sleep(13000);
const today = new Date().toISOString().slice(0, 10);
const before = await t.evalJs(`(async () => ({ backend: window.__batrayTest.histState().backend, rows: (await window.__batrayTest.histInfo('${today}')).rows, logs: (await window.__batrayTest.logList()).length }))()`);
t.check('setup: the reader stores rows and its debug log on OPFS', before.backend === 'opfs' && before.rows >= 2 && before.logs >= 1, before);

await t.send('Storage.clearDataForOrigin', { origin: BASE, storageTypes: 'file_systems' });
const wipedAt = Date.now();
await sleep(90000);                                                   // the budget to notice and start over
const fails = await t.evalJs(`window.__batrayTest.logLines().filter((l) => /logAppend failed|insert failed|could not be found/.test(l)).map((l) => l.slice(0, 160))`);
console.log(`after the wipe: ${fails.length} failure line(s) in the log, e.g. ${fails[0] || '-'}`);
await t.evalJs(`window.__batrayTest.logLine('probe line after the wipe'); window.__batrayTest.flushLog()`).catch(() => {}); await sleep(1500);
const logs = await t.evalJs(`window.__batrayTest.logList().then((l) => l.map((f) => f.bytes), (e) => 'logList failed: ' + e.message)`);
// threshold: 90 s is nine history flushes and thirty log flushes - ample to notice a write that fails every time
t.check('F3-1: 90 s after the storage was wiped, the debug log is written again (a log file exists and has bytes)', Array.isArray(logs) && logs.some((b) => b > 0), logs);
await t.evalJs(`window.__batrayTest.flushHistory()`).catch(() => {}); await sleep(1000);
await t.send('Page.navigate', { url: `${BASE}/batray/?test&n=2` }); await sleep(4500);
const after = await t.evalJs(`window.__batrayTest.histInfo('${today}').then((i) => i.rows, (e) => 'info failed: ' + e.message)`);
t.check(`F3-1: readings stored after the wipe exist after a reload (the page counted them as stored for ${Math.round((Date.now() - wipedAt) / 1000)} s)`, typeof after === 'number' && after >= 3, { rowsOnDiskAfterReload: after });
await t.done();
