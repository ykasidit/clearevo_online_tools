// BatRay by ClearEvo.com - tests (batray_log.test.js)
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
import test from 'node:test';
import assert from 'node:assert/strict';
import { logState, newSessionId, logFileName, parseLogName, logQueue, flushPlan, flushDone, logRetention, logSummary, uploadBody, debugButtons, lastRunRecord, lastRunReport, LASTRUN_KEY, LOG_FILE_MAX, LOG_FILES_MAX, LOG_UPLOAD_MAX } from '../public/batray/log-logic.js';

test('one file per session, rolled at 10 MB with the same session id; names sort by time and parse back', () => {
  const ls = logState(true, 'abc123');
  assert.equal(ls.on, true); assert.equal(ls.fileMax, LOG_FILE_MAX); assert.equal(ls.filesMax, LOG_FILES_MAX);
  assert.match(newSessionId(), /^[a-z0-9]{6}$/);
  const t0 = Date.UTC(2026, 8, 23, 1, 2, 3, 400);
  assert.equal(logFileName(t0, 'abc123'), 'log-2026-09-23T01-02-03Z-abc123.txt');
  assert.deepEqual(parseLogName('log-2026-09-23T01-02-03Z-abc123.txt'), { start: Date.UTC(2026, 8, 23, 1, 2, 3), sid: 'abc123' });
  assert.equal(parseLogName('2026-09-23.ndjson'), null);
  assert.deepEqual(flushPlan(ls, t0), { action: 'noop' });
  assert.equal(logQueue(ls, '01:02:03.400  hello'), true); assert.equal(ls.pendBytes, '01:02:03.400  hello'.length + 1);
  let plan = flushPlan(ls, t0);
  assert.deepEqual(plan, { action: 'write', file: 'log-2026-09-23T01-02-03Z-abc123.txt', roll: true, bytes: ls.pendBytes, lines: 1 }, 'the first flush opens the session file');
  flushDone(ls, plan.file, 22, 22); assert.equal(ls.pending.length, 0); assert.equal(ls.sessionBytes, 22);
  logQueue(ls, 'x'); plan = flushPlan(ls, t0 + 5000); assert.equal(plan.file, 'log-2026-09-23T01-02-03Z-abc123.txt'); assert.equal(plan.roll, false, 'later flushes append');
  flushDone(ls, plan.file, 24, 2);
  ls.fileBytes = LOG_FILE_MAX - 1; logQueue(ls, 'yy'); plan = flushPlan(ls, t0 + 3600e3);
  assert.equal(plan.roll, true); assert.equal(plan.file, 'log-2026-09-23T02-02-03Z-abc123.txt', 'a new timestamp, the same session id');
  const off = logState(false, 'zzz999'); assert.equal(logQueue(off, 'line'), false); assert.equal(off.pending.length, 0, 'opted out: nothing queued');
});

test('the newest 10 files are kept; the summary counts bytes; Upload sends the stored file, its tail, or the ring buffer', () => {
  const files = []; for (let i = 0; i < 13; i++) files.push({ name: logFileName(Date.UTC(2026, 8, 1 + i), i % 2 ? 'aaaaaa' : 'bbbbbb'), bytes: 1000 + i });
  files.push({ name: 'stray.txt', bytes: 5 });
  const del = logRetention(files, 10);
  assert.deepEqual(del.map((f) => f.name), files.slice(0, 3).map((f) => f.name), 'the three oldest go, the stray file is ignored');
  assert.deepEqual(logRetention(files.slice(0, 10), 10), []);
  assert.deepEqual(logSummary(files.slice(0, 2)), { files: 2, bytes: 2001 });
  const header = ['BatRay v0.9.32 · x', 'ua: y'];
  assert.deepEqual(uploadBody({ header, ring: 'r1\nr2', stored: '', limit: 100 }), { body: 'BatRay v0.9.32 · x\nua: y\n---\nr1\nr2', source: 'ring' });
  const stored = 'BatRay v0.9.32 · x\n' + 'l'.repeat(50);
  assert.deepEqual(uploadBody({ header, ring: 'r', stored, limit: 1000 }), { body: stored, source: 'file' });
  const big = 'BatRay v0.9.32 · x\n' + 'm'.repeat(5000);
  const tail = uploadBody({ header, ring: 'r', stored: big, limit: 1000 });
  assert.equal(tail.source, 'file-tail'); assert.ok(tail.body.startsWith('BatRay v0.9.32 · x\nua: y\n---\n(stored log is 5019 B: this is its tail from byte '), tail.body.slice(0, 90)); assert.ok(tail.body.length <= 1000, tail.body.length);
  assert.equal(LOG_UPLOAD_MAX, 4 * 1048576);
  assert.deepEqual(debugButtons(true), { disabled: false }); assert.deepEqual(debugButtons(false), { disabled: true });
});

test('the last-run record is the tombstone: a start after an unclean end says so at the top of the new log, with the last known state', () => {
  assert.equal(LASTRUN_KEY, 'batray_lastrun');
  const t0 = Date.UTC(2026, 8, 23, 1, 0, 0);
  const rec = lastRunRecord({ sid: 'abc123', now: t0, mem: { used: 50e6, limit: 2000e6, total: 60e6 }, rows: 28800, state: 'connected, sharing', file: 'log-x-abc123.txt' });
  assert.deepEqual(rec, { sid: 'abc123', at: t0, mem: { used: 50e6, limit: 2000e6 }, rows: 28800, state: 'connected, sharing', file: 'log-x-abc123.txt', clean: false });
  const r = lastRunReport(rec, t0 + 7 * 60000, { wasDiscarded: true, navType: 'reload' });
  assert.equal(r.length, 3);
  assert.match(r[0], /^previous session abc123 ENDED WITHOUT A CLEAN EXIT .* last seen 2026-09-23T01:00:00.000Z \(7 min before this start\)$/);
  assert.match(r[1], /state connected, sharing; memory 48 MB of 1907 MB; 28800 rows in memory; its log file: log-x-abc123.txt/);
  assert.match(r[2], /this start: reload; Chrome had DISCARDED the tab/);
  const clean = lastRunReport(lastRunRecord({ sid: 'zzz', now: t0, mem: null, rows: 0, state: 'idle', file: null, clean: true }), t0 + 60000, {});
  assert.deepEqual(clean, ['previous session zzz ended cleanly at 2026-09-23T01:00:00.000Z (1 min before this start)', '  this start: navigate']);
  assert.equal(lastRunReport(null, t0), null); assert.equal(lastRunReport('junk', t0), null);
});
