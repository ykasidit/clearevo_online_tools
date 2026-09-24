// BatRay by ClearEvo.com - tests (batray_history.test.js)
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
// The stored history's decisions (pure): day keys, the row rate, ids and a
// viewer's copy, retention, the transfer plan by ids, request timing, chunk
// assembly, chart windows and buckets, and the store-call statistics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { corruptDecision, isCorruptError, historyState, dayKey, dayStartMs, daysInRange, rowDue, rowFromReading, rolloverDecision, nextRowId, replicaDecision, retentionDecision, quotaDecision, historySummary, transferPlan, histReqDecision, chunkB64, rxChunk, chartRange, bucketStep, seriesFromBuckets, daysNeeded, bucketsFromRows, energyFromRows, opTimeoutMs, statsState, statsAdd, stuckDecision, statsLine, statsReset, HEADROOM_BYTES, HIST_REQ_MS, GAP_REQ_MS, GAP_ASKS_MAX, MIN_ROW_MS, RANGES, XFER_CHUNK, OP_TIMEOUT_MS, STUCK_RESTART } from '../public/batray/history-logic.js';
import { decodeCellInfo } from '../public/batray/jkbms.js';
import * as F from './batray_frames.js';

const T0 = Date.UTC(2026, 8, 24, 10, 0, 0);
const mk = (i, p = 'm-00', extra = {}) => ({ t: T0 + i * 3000, p, soc: 50, v: 52, w: i % 2 ? 600 : -300, ...extra });

test('a row from the owner\'s frame: short keys, cells in mV, unknowns as null, no id until the reader gives one', () => {
  const d = decodeCellInfo(F.OWNER_32S_CELL, 11);
  const r = rowFromReading('n11', d, 1_700_000_000_000);
  assert.equal(r.t, 1_700_000_000_000); assert.equal(r.p, 'n11'); assert.equal(r.id, undefined);
  assert.equal(r.soc, d.soc); assert.equal(r.v, d.packV); assert.equal(r.w, d.power);
  assert.equal(r.c.length, d.cells.length); assert.equal(r.c[0], Math.round(d.cells[0].v * 1000));
  assert.equal(rowFromReading('x', { soc: undefined, packV: NaN, cells: null }, 1).soc, null);
});

test('day keys are UTC; a window lists its UTC days', () => {
  assert.equal(dayKey(Date.UTC(2026, 8, 21, 23, 59, 59)), '2026-09-21');
  assert.equal(dayKey(Date.UTC(2026, 8, 22, 0, 0, 0)), '2026-09-22');
  assert.equal(dayStartMs('2026-09-22'), Date.UTC(2026, 8, 22));
  assert.deepEqual(daysInRange(Date.UTC(2026, 8, 21, 22), Date.UTC(2026, 8, 23, 1)), ['2026-09-21', '2026-09-22', '2026-09-23']);
  assert.deepEqual(daysInRange(T0, T0), [dayKey(T0)]);
});

test('rowDue: one stored row per pack per 3 s however fast the BMS pushes frames', () => {
  assert.equal(rowDue(null, 1000), true); assert.equal(rowDue(1000, 3999), false); assert.equal(rowDue(1000, 4000), true); assert.equal(MIN_ROW_MS, 3000);
});

test('rollover and ids: the first row starts the day, ids are dense per day and restart on the next day', () => {
  const hs = historyState();
  assert.deepEqual(rolloverDecision(hs, '2026-09-24'), { action: 'start', day: '2026-09-24' });
  assert.deepEqual([nextRowId(hs), nextRowId(hs), nextRowId(hs)], [1, 2, 3]); assert.equal(hs.todayRows, 3);
  assert.deepEqual(rolloverDecision(hs, '2026-09-24'), { action: 'noop' });
  assert.deepEqual(rolloverDecision(hs, '2026-09-25'), { action: 'rollover', day: '2026-09-25', prev: '2026-09-24' });
  assert.deepEqual([hs.nextId, hs.todayRows, hs.contig], [1, 0, 0]); assert.equal(nextRowId(hs), 1);
});

test('replicaDecision: a viewer\'s copy follows the reader\'s ids - next id appends, a hole is a gap, a re-send is a dup, another day is old', () => {
  const hs = historyState(); hs.day = dayKey(T0); hs.contig = 0;
  const today = dayKey(T0);
  assert.deepEqual(replicaDecision(hs, { ...mk(0), id: 1 }, today), { action: 'append' }); assert.equal(hs.contig, 1);
  assert.deepEqual(replicaDecision(hs, { ...mk(1), id: 2 }, today), { action: 'append' });
  assert.deepEqual(replicaDecision(hs, { ...mk(3), id: 4 }, today), { action: 'gap', expected: 3, got: 4 }); assert.equal(hs.contig, 2, 'stored anyway, but the prefix stays at 2 until 3 comes');
  assert.deepEqual(replicaDecision(hs, { ...mk(1), id: 2 }, today), { action: 'append', dup: true });
  assert.deepEqual(replicaDecision(hs, { ...mk(2), id: 3 }, today), { action: 'append' }); assert.equal(hs.contig, 3, 'the caller re-reads the prefix from the database after a fill');
  assert.deepEqual(replicaDecision(hs, { t: T0 - 86400e3, p: 'm-00', id: 9 }, today), { action: 'old' });
  assert.deepEqual(replicaDecision(hs, mk(5), today), { action: 'mem', why: 'no id' });
});

test('retention: the oldest past days go only while free space is under the headroom; today never', () => {
  const days = [{ day: '2026-09-20', bytes: 7e6 }, { day: '2026-09-21', bytes: 7e6 }, { day: '2026-09-22', bytes: 7e6 }];
  assert.deepEqual(retentionDecision(days, '2026-09-22', { usage: 21e6, quota: 1e9 }).delete, [], 'plenty of room');
  const tight = retentionDecision(days, '2026-09-22', { usage: 990e6, quota: 1e9 });
  assert.deepEqual(tight.delete.map((d) => d.day), ['2026-09-20', '2026-09-21'], 'two oldest bring free space over 100 MB... ');
  assert.equal(retentionDecision([{ day: '2026-09-22', bytes: 7e6 }], '2026-09-22', { usage: 999e6, quota: 1e9 }).delete.length, 0, 'today is never deleted');
  assert.deepEqual(quotaDecision(days, '2026-09-22'), { action: 'delete', day: '2026-09-20' });
  assert.deepEqual(quotaDecision([{ day: '2026-09-22', bytes: 1 }], '2026-09-22'), { action: 'give-up' });
  assert.equal(HEADROOM_BYTES, 100 * 1048576);
});

test('historySummary: days, bytes, oldest, per-day cost from past days, room in days', () => {
  const s = historySummary([{ day: '2026-09-22', bytes: 6e6 }, { day: '2026-09-23', bytes: 8e6 }, { day: '2026-09-24', bytes: 1e6 }], 300, { usage: 15e6, quota: 1e9, today: '2026-09-24' });
  assert.equal(s.days, 3); assert.equal(s.bytes, 15e6); assert.equal(s.oldest, '2026-09-22'); assert.equal(s.perDay, 7e6);
  assert.equal(s.estDays, 3 + Math.floor((1e9 - HEADROOM_BYTES - 15e6) / 7e6)); assert.equal(s.free, 985e6);
  assert.equal(historySummary([], 0).estDays, null);
});

test('transferPlan: newest day first, rows after what the viewer has (its contiguous prefix), a lacking day from 0, capped', () => {
  const reader = [{ day: '2026-09-22', maxId: 500 }, { day: '2026-09-23', maxId: 1000 }, { day: '2026-09-24', maxId: 120 }];
  assert.deepEqual(transferPlan(reader, []), [{ day: '2026-09-24', after: 0, rows: 120 }, { day: '2026-09-23', after: 0, rows: 1000 }, { day: '2026-09-22', after: 0, rows: 500 }]);
  const have = [{ day: '2026-09-24', maxId: 118, contig: 100 }, { day: '2026-09-23', maxId: 1000, contig: 1000 }, { day: '2026-09-22', maxId: 700, contig: 700 }];
  assert.deepEqual(transferPlan(reader, have), [{ day: '2026-09-24', after: 100, rows: 20 }], 'a hole at 101 refills from the prefix; complete days are skipped; a viewer ahead of the reader gets nothing');
  assert.deepEqual(transferPlan(reader, [], 1200), [{ day: '2026-09-24', after: 0, rows: 120 }, { day: '2026-09-23', after: 0, rows: 1000 }], 'the cap stops before the third day');
});

test('histReqDecision: at once on link up, within 5 s after a gap (3 times), then every 10 min', () => {
  const hs = historyState(); const t = 5_000_000;
  assert.deepEqual(histReqDecision(hs, { live: false, now: t }), { action: 'noop' });
  assert.deepEqual(histReqDecision(hs, { live: true, now: t }), { action: 'request', why: 'link up' });
  assert.deepEqual(histReqDecision(hs, { live: true, now: t + 1 }), { action: 'noop' });
  assert.deepEqual(histReqDecision(hs, { live: true, now: t + 1000, gap: true }), { action: 'noop' }, 'a gap within 5 s of the last ask waits');
  assert.deepEqual(histReqDecision(hs, { live: true, now: t + GAP_REQ_MS, gap: true }), { action: 'request', why: 'gap' });
  for (let i = 0; i < GAP_ASKS_MAX - 1; i++) assert.equal(histReqDecision(hs, { live: true, now: t + (i + 2) * GAP_REQ_MS, gap: true }).why, 'gap');
  assert.deepEqual(histReqDecision(hs, { live: true, now: t + 10 * GAP_REQ_MS, gap: true }), { action: 'noop' }, 'the 4th gap ask waits for the rhythm (the 2026-09-22 log asked every 5 s for 5 h)');
  assert.deepEqual(histReqDecision(hs, { live: true, now: t + HIST_REQ_MS + 20000 }), { action: 'request', why: 'periodic' });
  assert.deepEqual(histReqDecision(hs, { live: false, now: t + HIST_REQ_MS + 20001 }), { action: 'noop' });
  assert.deepEqual(histReqDecision(hs, { live: true, now: t + HIST_REQ_MS + 20002 }), { action: 'request', why: 'link up' }, 'a flap is one ask');
});

test('chunks: a file in base64 chunks reassembles in order; an out-of-order chunk drops the file', () => {
  const hs = historyState();
  const b64 = 'A'.repeat(XFER_CHUNK * 4 / 3 * 2 + 10);
  const chunks = chunkB64(b64); assert.equal(chunks.length, 3);
  const cs = chunks.map((c, n) => ({ day: '2026-09-24', after: 100, n, of: 3, b64: c }));
  assert.equal(rxChunk(hs, cs[0]).action, 'wait'); assert.equal(rxChunk(hs, cs[1]).action, 'wait');
  const r = rxChunk(hs, cs[2]); assert.equal(r.action, 'file'); assert.deepEqual([r.file.day, r.file.after, r.file.b64 === b64], ['2026-09-24', 100, true]);
  assert.equal(rxChunk(hs, cs[0]).action, 'wait'); assert.equal(rxChunk(hs, cs[2]).action, 'drop'); assert.equal(hs.rx, null);
});

test('chart window, bucket step and series from per-day buckets', () => {
  const now = T0;
  assert.deepEqual(chartRange('6h', now), { from: now - 6 * 3600e3, to: now });
  assert.deepEqual(chartRange('all', now, now - 3 * 86400e3), { from: now - 3 * 86400e3, to: now });
  assert.deepEqual(chartRange('all', now), { from: now - 3600e3, to: now }, 'nothing stored yet: an hour');
  assert.deepEqual(chartRange('nope', now), chartRange('6h', now));
  assert.equal(bucketStep(0, 3600e3, 800), Math.ceil(3600e3 / 800));
  assert.equal(bucketStep(0, 60e3, 800), MIN_ROW_MS, 'never finer than a stored row');
  assert.equal(bucketStep(0, 7 * 86400e3, 800), Math.ceil(7 * 86400e3 / 800));
  assert.deepEqual(RANGES.all, 0);
  const s = seriesFromBuckets([{ t: [1000, 4000], w: [-100, 200], soc: [50, 51], v: [52, 52.1] }, { t: [7000], w: [null], soc: [null], v: [null] }]);
  assert.deepEqual(s, { t: [1, 4, 7], w: [-100, 200, null], wc: [0, 200, null], wd: [-100, 0, null], soc: [50, 51, null], v: [52, 52.1, null] });
  assert.deepEqual(daysNeeded([{ day: '2026-09-20' }, { day: '2026-09-23' }, { day: '2026-09-24' }, { day: '2026-09-25' }], Date.UTC(2026, 8, 22), Date.UTC(2026, 8, 24, 12)), ['2026-09-23', '2026-09-24']);
});

test('bucketsFromRows and energyFromRows match the SQL\'s definitions (the memory-only backend)', () => {
  const rows = []; for (let i = 0; i < 1200; i++) rows.push(mk(i, 'm-00', { w: 600 }));
  for (let i = 0; i < 1200; i++) rows.push(mk(3000 + i, 'm-00', { w: -300 }));
  rows.push(mk(5, 's-01', { w: 9 }));
  const b = bucketsFromRows(rows, { p: 'm-00', from: T0, to: T0 + 3600e3 - 1, stepMs: 300000 });
  assert.equal(b.t.length, 12); assert.equal(b.n[0], 100); assert.equal(b.w[0], 600); assert.equal(b.wmin[0], 600); assert.equal(b.soc[0], 50); assert.equal(b.t[0], Math.floor(T0 / 300000) * 300000);
  const e = energyFromRows(rows, { p: 'm-00', from: T0, to: T0 + 86400e3, maxGapMs: 60000 });
  assert.ok(Math.abs(e.charged - 600 * (1199 * 3) / 3600) < 0.01); assert.ok(Math.abs(e.discharged - 300 * (1199 * 3 + 60) / 3600) < 0.01);
});

test('store-call bookkeeping: timeouts per kind, statistics per kind, the stuck decision after 3 timeouts in a row, the log line', () => {
  assert.equal(opTimeoutMs('insert'), OP_TIMEOUT_MS.insert); assert.equal(opTimeoutMs('nothing'), OP_TIMEOUT_MS.other);
  const st = statsState();
  statsAdd(st, 'insert', 12, 'ok', 5); statsAdd(st, 'insert', 30, 'ok', 5); statsAdd(st, 'query', 140, 'ok');
  statsAdd(st, 'query', 15000, 'timeout'); statsAdd(st, 'insert', 3, 'fail');
  assert.deepEqual(st.ops.insert, { n: 3, ok: 2, fail: 1, timeout: 0, ms: 45, max: 30, rows: 10 });
  assert.deepEqual([st.timeouts, st.fails, st.timeoutsInRow], [1, 1, 0], 'a failure after a timeout resets the run');
  assert.equal(statsLine(st), 'history stats: insert=3(2ok/1fail) 15/30ms 10rows · query=2(1ok/1timeout) 7570/15000ms');
  statsAdd(st, 'query', 15000, 'timeout'); statsAdd(st, 'query', 15000, 'timeout');
  assert.deepEqual(stuckDecision(st), { action: 'noop' });
  statsAdd(st, 'insert', 8000, 'timeout');
  assert.deepEqual(stuckDecision(st), { action: 'restart' }); assert.equal(STUCK_RESTART, 3);
  st.restarts++; statsReset(st, 99); assert.deepEqual(st.ops, {}); assert.equal(st.since, 99);
  assert.equal(statsLine(st), 'history stats: no calls yet · restarts=1');
  assert.equal(statsLine(statsState()), 'history stats: no calls yet');
});

test('a corrupt day: today is renewed (deleted, a new live file), a past day is dropped; the classifier reads SQLite\'s own words', () => {
  assert.deepEqual(corruptDecision('2026-09-24', '2026-09-24'), { action: 'renew', live: true });
  assert.deepEqual(corruptDecision('2026-09-23', '2026-09-24'), { action: 'drop', live: false });
  assert.ok(isCorruptError(new Error('SQLITE_CORRUPT: sqlite3 result code 11: database disk image is malformed')));
  assert.ok(isCorruptError(new Error('SQLITE_NOTADB: file is not a database')));
  assert.ok(isCorruptError({ message: '2026-09-24 database is corrupt (insert): SQLITE_CORRUPT' }));
  assert.equal(isCorruptError(new Error('SQLITE_FULL: database or disk is full')), false);
  assert.equal(isCorruptError(new Error('insert timed out after 8 s')), false);
  assert.equal(isCorruptError(null), false);
});
