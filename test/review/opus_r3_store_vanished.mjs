// BatRay by ClearEvo.com - review round 3 (Opus), O3-1: a store whose files vanish never heals, and "stores" into nothing
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
// The coordinator's lead (round 3): twice, under load, the year sim's store broke for good - every logAppend / insert
// "NotFoundError: A requested file or directory could not be found at the time an operation was processed", 1400+
// failures, never healed. Reproduced here exactly by removing the origin's file storage under the running page
// (CDP Storage.clearDataForOrigin 'file_systems' = what Chrome's eviction under disk pressure does to a non-persistent
// origin - the sandbox disk was 96 % full with 2 GB free and headless Chrome answers persist() false - and what a person
// does with "Clear site data" / Android "Manage space"). The worker keeps its cached directory handle (`dirP`) and the
// SQLite pool's access handles to files that no longer exist: every log write then fails with that NotFoundError for
// the life of the page, while inserts into today's open database keep answering "ok" - into a deleted file: the
// listing says the rows are stored, the disk holds nothing, and they are gone at the next reload. Nothing restarts the
// worker (only timeouts do). The store must notice and start over on fresh files.
// Run: CDP=9411 PORT=8411 node test/review/opus_r3_store_vanished.mjs
import { cdp, startReader, sleep, BASE, checker } from './opus_r1_lib.mjs';
const { check, done } = checker();
const c = await cdp();
await startReader(c, { debug: true });
await sleep(12000);                                                  // a few flushes: a day file and a log file exist
const T = 'window.__batrayTest';
const files = `(async () => { const out = []; async function walk(d, p) { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h, p + n + '/'); else out.push(p + n); } } await walk(await navigator.storage.getDirectory(), ''); return out; })()`;
const before = await c.evalJs(files);
check('before: the store has its pool files and a log file on disk', before.some((f) => /^batray-db-/.test(f)) && before.some((f) => /^batray-history\/logs-[^/]+\/log-/.test(f)), before);
await c.send('Storage.clearDataForOrigin', { origin: new URL(BASE).origin, storageTypes: 'file_systems' });
await sleep(40000);                                                  // four 10 s row flushes, a dozen log flushes
const after = await c.evalJs(files);
const fails = await c.evalJs(`${T}.logLines().filter((l) => /could not be found/.test(l)).length`);
const listed = await c.evalJs(`${T}.histList()`);
console.log(`40 s after the files went: on disk ${JSON.stringify(after)}; the store lists ${JSON.stringify(listed)}; NotFound lines ${fails}`);
check('the store starts over on fresh files: rows it reports stored are on disk again (a pool file exists)', after.some((f) => /^batray-db-/.test(f)), { after, listed });
check('...and the debug log is written again (a log file exists)', after.some((f) => /^batray-history\/logs-[^/]+\/log-/.test(f)), { after, fails });
c.close();
done('opus_r3_store_vanished');
