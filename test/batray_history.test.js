// BatRay by ClearEvo.com - tests (batray_history.test.js): stored history rules - rows, rollover, retention, thinning, chart
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
import { historyState, dayKey, dayStartMs, lineBytes, nextPos, replicaDecision, releaseHeld, rowFromReading, rowLine, parseLines, rolloverDecision, retentionDecision, quotaDecision, historySummary, cleanLen, recentSlice, transferPlan, histReqDecision, chunkB64, rxChunk, mergeRows, downsample, chartRange, chartSeries, energyWh, rowsBetween, spanMs, trimRows, thinRows, MEM_MAX_ROWS, MEM_TAIL_BYTES, daysNeeded, rowDue, HEADROOM_BYTES, XFER_CHUNK, HIST_REQ_MS, GAP_REQ_MS, GAP_ASKS_MAX, HOLD_MAX, MIN_ROW_MS, RANGES, MEM_MS } from '../public/batray/history-logic.js';
import { decodeCellInfo } from '../public/batray/jkbms.js';
import * as F from './batray_frames.js';

const owner = decodeCellInfo(F.OWNER_32S_CELL); assert.ok(owner.ok);

test('a row from the owner\'s frame: short keys, cells in mV, unknowns as null; the line survives a round trip and a torn tail', () => {
  const r = rowFromReading('n11', owner, 1700000000000);
  assert.equal(r.p, 'n11'); assert.equal(r.t, 1700000000000); assert.equal(r.soc, owner.soc); assert.equal(r.v, owner.packV);
  assert.equal(r.c.length, owner.cells.length); assert.equal(r.c[0], Math.round(owner.cells[0].v * 1000));
  assert.ok([0, 1].includes(r.ch)); assert.ok([0, 1, null].includes(r.bal));
  const j = rowFromReading('x', { soc: undefined, packV: NaN, current: null, cells: undefined, chgMos: undefined }, 5);
  assert.deepEqual([j.soc, j.v, j.i, j.c, j.ch], [null, null, null, null, null]);
  const text = rowLine(r) + '\n' + rowLine({ ...r, t: r.t + 3000 }) + '\n' + '{"t":170000000600';   // power cut mid-write
  const rows = parseLines(text);
  assert.equal(rows.length, 2); assert.deepEqual(rows[0], r);
});

test('day key is the phone\'s local calendar day', () => {
  const d = new Date(2026, 8, 21, 0, 0, 30);           // local midnight + 30 s
  assert.equal(dayKey(d.getTime()), '2026-09-21');
  assert.equal(dayKey(d.getTime() - 60000), '2026-09-20');
});

test('rollover: the first row starts the day, a day change compacts the previous day, the same day is a noop', () => {
  const hs = historyState();
  assert.deepEqual(rolloverDecision(hs, '2026-09-20'), { action: 'start', day: '2026-09-20' });
  hs.todayRows = 5;
  assert.deepEqual(rolloverDecision(hs, '2026-09-20'), { action: 'noop' }); assert.equal(hs.todayRows, 5);
  assert.deepEqual(rolloverDecision(hs, '2026-09-21'), { action: 'compact', day: '2026-09-20' });
  assert.equal(hs.day, '2026-09-21'); assert.equal(hs.todayRows, 0);
});

test('retention: past raw days get compacted, days beyond the keep window deleted, today and the future untouched', () => {
  const days = [];
  for (let i = 0; i < 33; i++) { const day = `2026-08-${String(i + 1).padStart(2, '0')}`; days.push({ day, raw: i === 31, gz: i !== 31, bytes: 100 }); }
  days.push({ day: '2026-09-02', raw: true, gz: false, bytes: 50 });      // today, still being written
  days.push({ day: '2026-09-03', raw: true, gz: false, bytes: 5 });       // a clock that jumped: leave it
  // no day limit: the oldest past days go only while the browser's free space is under the headroom
  const MB = 1048576;
  const plenty = retentionDecision(days, '2026-09-02', { usage: 10 * MB, quota: 2000 * MB });
  assert.deepEqual(plenty.delete, []); assert.deepEqual(plenty.compact, ['2026-08-32']);
  const tight = retentionDecision(days, '2026-09-02', { usage: 1990 * MB, quota: 2000 * MB, headroom: 100 * MB });   // 10 MB free, 100 B per day: everything past goes
  assert.ok(tight.delete.length === 33 && tight.delete[0].day === '2026-08-01' && !tight.delete.some((x) => x.day >= '2026-09-02'), tight.delete.length);
  assert.deepEqual(tight.compact, [], 'a day being deleted is not compacted');
  const some = retentionDecision([{ day: '2026-08-01', gz: true, bytes: 60 * MB }, { day: '2026-08-02', gz: true, bytes: 60 * MB }, { day: '2026-09-02', raw: true, bytes: 1 }], '2026-09-02', { usage: 1950 * MB, quota: 2000 * MB, headroom: 100 * MB });
  assert.deepEqual(some.delete.map((x) => x.day), ['2026-08-01'], 'deleting the oldest 60 MB day makes 110 MB free: enough');
  assert.deepEqual(retentionDecision(days, '2026-09-02', { usage: 0, quota: 0 }).delete, [], 'no quota figure: nothing is deleted');
  assert.deepEqual(quotaDecision(days, '2026-09-02'), { action: 'delete', day: '2026-08-01' });
  assert.deepEqual(quotaDecision([{ day: '2026-09-02', raw: true, bytes: 5 }], '2026-09-02'), { action: 'give-up' });
  const s = historySummary(days, 7, { usage: 50 * MB, quota: 1000 * MB, headroom: 100 * MB, today: '2026-09-02' });
  assert.equal(s.days, 35); assert.equal(s.bytes, 3355); assert.equal(s.oldest, '2026-08-01'); assert.equal(s.todayRows, 7);
  assert.equal(s.perDay, 100); assert.equal(s.free, 950 * MB); assert.equal(s.estDays, 35 + Math.floor(850 * MB / 100));
  assert.equal(historySummary([], 0, { usage: 0, quota: 0 }).estDays, null);
  assert.equal(cleanLen(new TextEncoder().encode('{"t":1}\n{"t":2}\n{"t":3')), 16, 'a torn last line is cut');
  assert.equal(cleanLen(new Uint8Array([65, 66])), 0);
});

test('recent slice thins to a row a minute keeping the newest; transfer plan sends gz days the viewer lacks, today when the reader has more, newest first, capped', () => {
  const rows = []; for (let i = 0; i < 3000; i++) rows.push({ t: 1000 + i * 3000, p: 'n11', w: i, c: [1, 2, 3] });
  const s = recentSlice(rows, 1000 + 1000 * 3000, 60000, 1500);
  assert.ok(s.length > 90 && s.length <= 101, s.length); assert.equal(s[0].c, undefined); assert.equal(s[s.length - 1].t, rows[rows.length - 1].t);
  assert.ok(s.every((r, i) => i === 0 || r.t - s[i - 1].t >= 60000));
  const many = recentSlice(rows, 0, 3000, 100); assert.equal(many.length, 100); assert.equal(many[99].t, rows[2999].t);
  const reader = [{ day: '2026-09-18', gz: true, bytes: 900 }, { day: '2026-09-19', gz: true, bytes: 1000 }, { day: '2026-09-20', raw: true, bytes: 5000 }, { day: '2026-09-21', raw: true, bytes: 700 }];
  const plan = transferPlan(reader, [{ day: '2026-09-18', gz: true, bytes: 900 }, { day: '2026-09-21', raw: true, bytes: 300 }], '2026-09-21');
  assert.deepEqual(plan, [{ day: '2026-09-21', live: true, from: 300, replace: false }, { day: '2026-09-19', live: false, from: 0, replace: true }], 'today from the offset the viewer has, then the missing gz day; the raw past day waits for compaction; the equal gz day is skipped');
  assert.deepEqual(transferPlan(reader, [{ day: '2026-09-21', raw: true, bytes: 700 }, { day: '2026-09-19', gz: true, bytes: 999 }, { day: '2026-09-18', gz: true, bytes: 900 }], '2026-09-21'), [{ day: '2026-09-19', live: false, from: 0, replace: true }], 'a different size means a different copy');
  assert.deepEqual(transferPlan(reader, [], '2026-09-21', 1500), [{ day: '2026-09-21', live: true, from: 0, replace: true }], 'the cap stops after the first day that fits');
  assert.deepEqual(transferPlan(reader, [{ day: '2026-09-21', raw: true, bytes: 900 }], '2026-09-21', 1e9)[0], { day: '2026-09-21', live: true, from: 0, replace: true }, 'a viewer with MORE of today than the reader gets the whole file again');
  assert.deepEqual(transferPlan([{ day: '2026-09-21', raw: true, gz: true, bytes: 700 }], [{ day: '2026-09-21', raw: true, bytes: 300 }], '2026-09-21')[0], { day: '2026-09-21', live: false, from: 0, replace: true }, 'a today that is gz + raw (restored) is not a replica: sent whole, as a past day');
  assert.deepEqual(transferPlan([], [], '2026-09-21'), []);
  const hs = historyState();
  assert.deepEqual(histReqDecision(hs, { live: false, now: 1000 }), { action: 'noop' });
  assert.deepEqual(histReqDecision(hs, { live: true, now: 2000 }), { action: 'request', why: 'link up' });
  assert.deepEqual(histReqDecision(hs, { live: true, now: 2000 + HIST_REQ_MS - 1 }), { action: 'noop' });
  assert.deepEqual(histReqDecision(hs, { live: true, now: 2000 + GAP_REQ_MS - 1, gap: true }), { action: 'noop' }, 'a hole waits the short gap interval');
  assert.deepEqual(histReqDecision(hs, { live: true, now: 2000 + GAP_REQ_MS, gap: true }), { action: 'request', why: 'gap' });
  assert.deepEqual(histReqDecision(hs, { live: true, now: 2000 + GAP_REQ_MS + HIST_REQ_MS }), { action: 'request', why: 'periodic' });
  histReqDecision(hs, { live: false, now: 3e6 }); assert.deepEqual(histReqDecision(hs, { live: true, now: 3e6 + 1 }), { action: 'request', why: 'link up' }, 'a link that came back asks again at once');
  // 2026-09-22 viewer log: live flapped false/true four times in one ms and each flip asked again; and a hole was asked about every 5 s for five hours
  histReqDecision(hs, { live: false, now: 3e6 + 2 }); assert.deepEqual(histReqDecision(hs, { live: true, now: 3e6 + 3 }), { action: 'request', why: 'link up' });
  histReqDecision(hs, { live: false, now: 3e6 + 4 }); assert.equal(histReqDecision(hs, { live: true, now: 3e6 + 5 }).action, 'request', 'each real link-up asks once');
  const g = historyState(); histReqDecision(g, { live: true, now: 0 });
  let asked = 0; for (let t = GAP_REQ_MS; t < HIST_REQ_MS; t += GAP_REQ_MS) if (histReqDecision(g, { live: true, now: t, gap: true }).action === 'request') asked++;
  assert.equal(asked, GAP_ASKS_MAX, 'unanswered gap requests stop after GAP_ASKS_MAX until the reader answers');
  const lastAsk = GAP_ASKS_MAX * GAP_REQ_MS;
  assert.equal(histReqDecision(g, { live: true, now: lastAsk + HIST_REQ_MS - 1, gap: true }).action, 'noop');
  assert.equal(histReqDecision(g, { live: true, now: lastAsk + HIST_REQ_MS, gap: true }).why, 'periodic', 'then the 10 min rhythm from the last request');
  g.gapAsks = 0; assert.equal(histReqDecision(g, { live: true, now: lastAsk + HIST_REQ_MS + GAP_REQ_MS, gap: true }).why, 'gap', 'a received file (gapAsks reset) allows gap requests again');
  const b64 = 'A'.repeat(40000); const ch = chunkB64(b64); assert.equal(ch.length, Math.ceil(40000 / Math.ceil(XFER_CHUNK * 4 / 3))); assert.equal(ch.join(''), b64);
  const vs = historyState(); const env = (n, of, day = '2026-09-19') => ({ k: 'hist-file', v: { day, n, of, b64: 'p' + n, live: false } });
  assert.equal(rxChunk(vs, env(0, 3)), null); assert.equal(rxChunk(vs, env(1, 3)), null);
  assert.deepEqual(rxChunk(vs, env(2, 3)), { day: '2026-09-19', live: false, from: 0, replace: false, b64: 'p0p1p2' }); assert.equal(vs.rx, null);
  assert.deepEqual(rxChunk(vs, { k: 'hist-file', v: { day: '2026-09-21', n: 0, of: 1, b64: 'x', live: true, from: 4200, replace: false } }), { day: '2026-09-21', live: true, from: 4200, replace: false, b64: 'x' }, 'a tail carries its offset');
  rxChunk(vs, env(0, 3)); assert.equal(rxChunk(vs, env(2, 3)), null, 'a lost chunk voids the file'); assert.equal(vs.rx, null);
  assert.equal(rxChunk(vs, { k: 'hist-file', v: { day: 'x' } }), null);
});

test('merge replaces same-time rows and sorts; LTTB keeps the peaks and both ends', () => {
  const m = mergeRows([{ t: 3, p: 'a', w: 1 }, { t: 1, p: 'a', w: 1 }], [{ t: 2, p: 'a', w: 5 }, { t: 3, p: 'a', w: 9 }]);
  assert.deepEqual(m.map((r) => [r.t, r.w]), [[1, 1], [2, 5], [3, 9]]);
  const rows = []; for (let i = 0; i < 10000; i++) rows.push({ t: i * 1000, w: i === 5000 ? 5000 : Math.sin(i / 50) * 100 });
  const ds = downsample(rows, 500);
  assert.equal(ds.length, 500); assert.equal(ds[0], rows[0]); assert.equal(ds[499], rows[9999]);
  assert.ok(ds.some((r) => r.w === 5000), 'the spike survives');
  assert.equal(downsample(rows.slice(0, 10), 500).length, 10);
});

test('chart ranges, columns and energy', () => {
  const rows = []; for (let i = 0; i <= 3600; i++) rows.push({ t: i * 1000, p: 'a', w: i < 1800 ? 1000 : -500, soc: 50, v: 52 });
  const r6 = chartRange(rows, '6h', 3600e3); assert.equal(r6.to - r6.from, RANGES['6h']);
  const ra = chartRange(rows, 'all', 3600e3); assert.equal(ra.from, 0);
  const rx = chartRange(rows, 'bogus', 10); assert.equal(rx.to - rx.from, RANGES['6h']);
  const cs = chartSeries(rows.slice(0, 3)); assert.deepEqual(cs.t, [0, 1, 2]); assert.deepEqual(cs.w, [1000, 1000, 1000]); assert.deepEqual(cs.soc, [50, 50, 50]);
  const e = energyWh(rows);
  assert.ok(Math.abs(e.charged - 500) < 1, e.charged); assert.ok(Math.abs(e.discharged - 250) < 1, e.discharged);
  assert.deepEqual(energyWh([{ t: 0, w: 100 }, { t: 120000, w: 100 }]), { charged: 0, discharged: 0 });   // a 2 min gap is not integrated
});

test('window slicing, memory trim, past-day lookup and the signed power columns', () => {
  const rows = []; for (let i = 0; i < 100; i++) rows.push({ t: i * 1000, p: 'a', w: i % 2 ? 50 : -50, soc: 40, v: 52 });
  assert.deepEqual(rowsBetween(rows, 10e3, 12e3).map((r) => r.t), [10000, 11000, 12000]);
  assert.equal(rowsBetween(rows, 500e3, 600e3).length, 0);
  assert.equal(spanMs(rows), 99e3); assert.equal(spanMs([]), 0); assert.equal(spanMs(rows.slice(0, 1)), 0);
  const kept = trimRows(rows, 99e3 + MEM_MS - 50e3);     // everything older than 24 h before "now" goes
  assert.equal(kept[0].t, 49e3); assert.equal(kept.length, 51);
  assert.equal(trimRows(rows, 0), rows, 'nothing to trim returns the same array');
  const days = [{ day: '2026-09-18' }, { day: '2026-09-19' }, { day: '2026-09-20' }, { day: '2026-09-21' }];
  assert.deepEqual(daysNeeded(days, new Date('2026-09-19T15:00:00').getTime(), '2026-09-21'), ['2026-09-19', '2026-09-20']);   // today is in memory
  assert.deepEqual(daysNeeded(days, new Date('2026-09-21T01:00:00').getTime(), '2026-09-21'), []);
  const cs = chartSeries([{ t: 0, w: 120, soc: 50, v: 52 }, { t: 1000, w: -80, soc: 49 }, { t: 2000, w: null }]);
  assert.deepEqual(cs.wc, [120, 0, null]); assert.deepEqual(cs.wd, [0, -80, null]); assert.deepEqual(cs.v, [52, null, null]);
});

test('every stored date is UTC; rows carry their row number and byte offset; a viewer keeps a byte copy of today and holds rows that do not fit', () => {
  const t = Date.UTC(2026, 8, 21, 23, 30);                       // 23:30 UTC = 06:30 Bangkok the next day: the file is still the 21st
  assert.equal(dayKey(t), '2026-09-21'); assert.equal(dayStartMs('2026-09-21'), Date.UTC(2026, 8, 21)); assert.equal(dayKey(dayStartMs('2026-09-22') - 1), '2026-09-21');
  const hs = historyState(); hs.day = '2026-09-21'; hs.todayRows = 41; hs.todayBytes = 9000; hs.pendBytes = 120;
  assert.deepEqual(nextPos(hs), { n: 42, o: 9120 });
  const row = rowFromReading('n11', { soc: 50, packV: 52.1, current: 1.5, power: 78, cells: [{ v: 3.271 }] }, t, nextPos(hs));
  assert.equal(row.n, 42); assert.equal(row.o, 9120); assert.deepEqual(Object.keys(row).slice(0, 4), ['t', 'n', 'o', 'p'], 'row number and offset right after the time');
  assert.equal(lineBytes(row), JSON.stringify(row).length + 1); assert.equal(lineBytes({ t: 1, p: 'แบต' }), new TextEncoder().encode(JSON.stringify({ t: 1, p: 'แบต' })).length + 1, 'UTF-8 bytes, not characters');
  assert.equal(rowFromReading('n11', { soc: 1 }, t).o, null, 'a demo / memory-only row has no position');
  // the viewer: its copy ends at 9120 B
  assert.deepEqual(replicaDecision(hs, { t, n: 42, o: 9120 }), { action: 'append' });
  assert.deepEqual(replicaDecision(hs, { t, n: 44, o: 9400 }), { action: 'hold', why: 'gap', expected: 9120 }); assert.equal(hs.gap, 'gap');
  assert.deepEqual(replicaDecision(hs, { t, n: 44, o: 9400 }, HOLD_MAX), { action: 'mem', why: 'hold full', expected: 9120 }, 'a full hold keeps the row in memory only');
  assert.equal(rowDue(null, 5), true); assert.equal(rowDue(1000, 1000 + MIN_ROW_MS - 1), false); assert.equal(rowDue(1000, 1000 + MIN_ROW_MS), true);
  assert.deepEqual(replicaDecision(hs, { t, n: 40, o: 8800 }), { action: 'hold', why: 'behind', expected: 9120 }); assert.equal(hs.gap, 'behind');
  assert.deepEqual(replicaDecision(hs, { t, n: null, o: null }), { action: 'mem' });
  hs.replicaOff = '2026-09-21'; assert.equal(replicaDecision(hs, { t, n: 42, o: 9120 }).action, 'mem'); hs.replicaOff = null;
  // the tail landed: the copy now ends at 9500 B; held rows are placed in order, older ones dropped, a later hole kept
  const a = { t, n: 45, o: 9500, p: 'n11' }, la = lineBytes(a); const b = { t: t + 1, n: 46, o: 9500 + la, p: 'n11' }; const c = { t: t + 2, n: 48, o: 9500 + la + lineBytes(b) + 70, p: 'n11' };
  hs.todayBytes = 9500; hs.pendBytes = 0;
  const rel = releaseHeld(hs, [c, b, { t, n: 44, o: 9400 }, a]);
  assert.deepEqual(rel.append.map((r) => r.n), [45, 46]); assert.deepEqual(rel.drop.map((r) => r.n), [44]); assert.deepEqual(rel.keep.map((r) => r.n), [48]);
  const ro = rolloverDecision(hs, '2026-09-22'); assert.equal(ro.action, 'compact'); assert.equal(hs.todayBytes, 0); assert.equal(hs.pendBytes, 0); assert.equal(hs.gap, null);
});

// The owner's reader crashed "Aw, Snap" on 2026-09-23 with 314k rows (88 MB) in today's file parsed into memory at start.
test('thinRows: evenly thins a big set to the cap, newest row kept; small sets untouched', () => {
  const rows = Array.from({ length: 314_393 }, (_, i) => ({ t: 1_000 + i * 275, p: 'm-00', n: i + 1 }));
  const out = thinRows(rows, MEM_MAX_ROWS);
  assert.equal(out.length, MEM_MAX_ROWS);
  assert.equal(out[out.length - 1].n, rows.length, 'the newest row is always kept');
  for (let i = 1; i < out.length; i++) assert.ok(out[i].t > out[i - 1].t, 'still sorted');
  const gaps = new Set(); for (let i = 1; i < 50; i++) gaps.add(out[i].n - out[i - 1].n);
  assert.ok([...gaps].every((g) => g === 5 || g === 6), `even steps of ~5.24 rows, got ${[...gaps]}`);
  const small = rows.slice(0, 100);
  assert.equal(thinRows(small, MEM_MAX_ROWS), small, 'under the cap: the same array back');
  assert.ok(MEM_TAIL_BYTES < 88 * 1048576, 'a 4 rows/s day (88 MB) is never read whole into memory');
});
