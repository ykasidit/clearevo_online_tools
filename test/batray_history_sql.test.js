// BatRay by ClearEvo.com - tests (batray_history_sql.test.js)
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
// The SQL layer of the stored history on the real SQLite wasm (in-memory
// databases in node, the same build the page ships): schema, inserts and
// dedupe, ids and the contiguous prefix a viewer's copy tracks, bucket and
// energy queries, cells blob round trip, merge, and reads interleaved with
// writes ("same time" on one connection, as the worker serialises them).
import test from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from './sqlite_node.mjs';
import { ensureSchema, insertRows, maxId, rowCount, contigId, rowsAfter, lastRows, buckets, energyWh, span, dayInfo, dbBytes, mergeFrom, looksLikeDayDb, cellsToBlob, blobToCells, COLS } from '../public/batray/history-sql.js';
import { rowFromReading } from '../public/batray/history-logic.js';
import { decodeCellInfo } from '../public/batray/jkbms.js';
import * as F from './batray_frames.js';

const sqlite3 = await openSqlite();
const mem = () => { const db = new sqlite3.oo1.DB(':memory:'); ensureSchema(db); return db; };
const T0 = Date.UTC(2026, 8, 24, 0, 0, 0);
const mk = (i, p = 'm-00', extra = {}) => ({ t: T0 + i * 3000, p, soc: 50 + (i % 10), v: 52.1, i: i % 2 ? 12 : -18, w: i % 2 ? 620 : -930, ah: 150, tm: 30, t1: 25, t2: 26, ch: 1, ds: 1, bal: 0, err: 0, c: [3300 + i, 3301, 3302], ...extra });

test('schema: the readings table, its unique (p, t) index and the meta table; idempotent', () => {
  const db = mem(); ensureSchema(db);
  assert.equal(db.selectValue("SELECT count(*) FROM sqlite_master WHERE name IN ('readings', 'readings_pt', 'meta')"), 3);
  assert.equal(db.selectValue("SELECT v FROM meta WHERE k = 'app'"), 'BatRay');
  assert.ok(looksLikeDayDb(db));
  const junk = new sqlite3.oo1.DB(':memory:'); junk.exec('CREATE TABLE x (a)');
  assert.equal(looksLikeDayDb(junk), false, 'another database is not a day file');
  db.close(); junk.close();
});

test('insert: the owner\'s real frame becomes a row and reads back, cells as millivolts through the blob', () => {
  const db = mem();
  const d = decodeCellInfo(F.OWNER_32S_CELL, 11);
  const row = rowFromReading('n11', d, T0 + 5000);
  const r = insertRows(db, [{ ...row, id: 1 }]);
  assert.deepEqual([r.inserted, r.ignored, r.maxId], [1, 0, 1]);
  const back = rowsAfter(db, 0)[0];
  assert.equal(back.id, 1); assert.equal(back.t, T0 + 5000); assert.equal(back.p, 'n11');
  assert.equal(back.soc, row.soc); assert.equal(back.w, row.w); assert.equal(back.v, row.v);
  assert.deepEqual(back.c, row.c, 'cell millivolts survive the u16 blob');
  assert.deepEqual(blobToCells(cellsToBlob([1, 65535, 70000, -3])), [1, 65535, 65535, 0], 'clamped to u16');
  assert.equal(cellsToBlob(null), null); assert.equal(blobToCells(null), null);
  db.close();
});

test('insert: ids are dense when handed out, duplicates by id or (p, t) are ignored, bad rows skipped', () => {
  const db = mem();
  const rows = Array.from({ length: 10 }, (_, i) => ({ ...mk(i), id: i + 1 }));
  assert.deepEqual(insertRows(db, rows), { inserted: 10, ignored: 0, maxId: 10 });
  assert.deepEqual(insertRows(db, rows), { inserted: 0, ignored: 10, maxId: 10 }, 'the same rows again: all ignored');
  assert.deepEqual(insertRows(db, [{ ...mk(3), id: 99 }]), { inserted: 0, ignored: 1, maxId: 10 }, 'same (p, t) under a new id: ignored');
  assert.deepEqual(insertRows(db, [mk(10), { t: 'x', p: 'm-00' }, { t: T0 }]), { inserted: 1, ignored: 2, maxId: 11 }, 'no id: the next one; rows without t or p skipped');
  assert.equal(rowCount(db), 11); assert.equal(maxId(db), 11);
  db.close();
});

test('contigId: the viewer\'s complete prefix - dense ids, a hole, a copy that lacks the first rows', () => {
  const db = mem();
  assert.equal(contigId(db), 0, 'empty');
  insertRows(db, [1, 2, 3].map((i) => ({ ...mk(i), id: i })));
  assert.equal(contigId(db), 3);
  insertRows(db, [{ ...mk(5), id: 5 }, { ...mk(6), id: 6 }]);
  assert.equal(contigId(db), 3, 'ids 5 and 6 arrived before 4: still complete only up to 3');
  insertRows(db, [{ ...mk(4), id: 4 }]);
  assert.equal(contigId(db), 6, 'the hole filled: complete to the end');
  const late = mem(); insertRows(late, [{ ...mk(7), id: 7 }]);
  assert.equal(contigId(late), 0, 'a copy that starts at 7 must ask for everything');
  db.close(); late.close();
});

test('rowsAfter and lastRows: ascending, limited, only the asked pack for lastRows', () => {
  const db = mem();
  insertRows(db, Array.from({ length: 20 }, (_, i) => ({ ...mk(i, i % 2 ? 's-01' : 'm-00'), id: i + 1 })));
  assert.deepEqual(rowsAfter(db, 15).map((r) => r.id), [16, 17, 18, 19, 20]);
  assert.deepEqual(rowsAfter(db, 0, 3).map((r) => r.id), [1, 2, 3]);
  assert.deepEqual(lastRows(db, 'm-00', 2).map((r) => r.id), [17, 19]);
  db.close();
});

test('buckets: a day of two packs at one row per 3 s into 5 min buckets, means and extremes per bucket, only the asked pack', () => {
  const db = mem();
  const rows = [];
  for (let i = 0; i < 28800; i++) rows.push({ ...mk(i), id: rows.length + 1 }, { ...mk(i, 's-01', { w: 100 }), id: rows.length + 2 });
  const t1 = Date.now(); insertRows(db, rows); const insMs = Date.now() - t1;
  const t2 = Date.now();
  const b = buckets(db, { p: 'm-00', from: T0, to: T0 + 86400e3, stepMs: 300000 });
  const qMs = Date.now() - t2;
  assert.equal(b.t.length, 288, 'a day in 5 min buckets');
  assert.equal(b.n[0], 100, '100 rows per bucket');
  assert.equal(b.wmin[0], -930); assert.equal(b.wmax[0], 620); assert.ok(Math.abs(b.w[0] - (-155)) < 1, 'mean of the alternating rows');
  assert.equal(b.t[0], T0); assert.equal(b.t[287], T0 + 287 * 300000);
  assert.ok(b.soc.every((s) => s >= 50 && s <= 59));
  const s = buckets(db, { p: 's-01', from: T0, to: T0 + 3600e3 - 1, stepMs: 3600e3 });
  assert.deepEqual([s.t.length, s.w[0], s.n[0]], [1, 100, 1200], 'the other pack, one bucket of an hour');
  assert.deepEqual(buckets(db, { p: 'nobody', from: T0, to: T0 + 86400e3, stepMs: 60000 }).t, []);
  assert.ok(insMs < 20000 && qMs < 5000, `57.6k inserts ${insMs} ms, day query ${qMs} ms`);
  db.close();
});

test('energyWh: power over the time to the previous row, gaps capped, charge and discharge apart', () => {
  const db = mem();
  const rows = [];
  for (let i = 0; i < 1200; i++) rows.push({ ...mk(i, 'm-00', { w: 600 }), id: i + 1 });        // an hour at 600 W charging
  for (let i = 0; i < 1200; i++) rows.push({ ...mk(3000 + i, 'm-00', { w: -300 }), id: 1201 + i }); // after a 1.5 h gap, an hour at -300 W
  insertRows(db, rows);
  const e = energyWh(db, { p: 'm-00', from: T0, to: T0 + 86400e3, maxGapMs: 60000 });
  assert.ok(Math.abs(e.charged - 600 * (1199 * 3) / 3600) < 0.01, `charged ${e.charged}`);
  assert.ok(Math.abs(e.discharged - 300 * (1199 * 3 + 60) / 3600) < 0.01, `discharged ${e.discharged}: the gap counts as one capped minute`);
  assert.deepEqual(energyWh(db, { p: 'none', from: 0, to: 1 }), { charged: 0, discharged: 0 });
  db.close();
});

test('span, dayInfo, dbBytes', () => {
  const db = mem();
  insertRows(db, Array.from({ length: 5 }, (_, i) => ({ ...mk(i), id: i + 1 })));
  assert.deepEqual(span(db, 'm-00'), { first: T0, last: T0 + 12000, n: 5 });
  assert.deepEqual(span(db, 'm-00', T0 + 6000), { first: T0 + 6000, last: T0 + 12000, n: 3 });
  assert.deepEqual(span(db, 'x'), { first: null, last: null, n: 0 });
  assert.deepEqual(dayInfo(db), { rows: 5, maxId: 5, minT: T0, maxT: T0 + 12000, packs: ['m-00'], contig: 5 });
  assert.ok(dbBytes(db) >= 4096 * 3);
  db.close();
});

test('mergeFrom: a restored day merges into an existing one by (p, t), nothing twice', () => {
  const a = mem(), b = mem();
  insertRows(a, [1, 2, 3].map((i) => ({ ...mk(i), id: i })));
  insertRows(b, [2, 3, 4, 5].map((i) => ({ ...mk(i), id: i })));
  const bytes = sqlite3.capi.sqlite3_js_db_export(b);
  const name = '/tmp-merge.sqlite';
  sqlite3.capi.sqlite3_js_posix_create_file(name, bytes);
  a.exec(`ATTACH DATABASE '${name}' AS other`);
  assert.equal(mergeFrom(a, 'other'), 2, 'rows 4 and 5 added, 2 and 3 already there');
  a.exec('DETACH DATABASE other');
  assert.equal(rowCount(a), 5);
  a.close(); b.close();
});

test('same time: reads issued while writes are pending see a consistent table (one connection, serialised as the worker does)', async () => {
  const db = mem();
  const queue = []; let running = false;
  const run = (fn) => new Promise((res, rej) => { queue.push({ fn, res, rej }); pump(); });
  const pump = () => { if (running || !queue.length) return; running = true; const j = queue.shift(); setTimeout(() => { try { j.res(j.fn()); } catch (e) { j.rej(e); } running = false; pump(); }, 0); };
  const writes = [], reads = [];
  for (let k = 0; k < 20; k++) {
    writes.push(run(() => insertRows(db, Array.from({ length: 50 }, (_, i) => ({ ...mk(k * 50 + i), id: k * 50 + i + 1 })))));
    reads.push(run(() => rowCount(db)));
    reads.push(run(() => buckets(db, { p: 'm-00', from: T0, to: T0 + 86400e3, stepMs: 60000 }).n.reduce((a, n) => a + n, 0)));
  }
  const w = await Promise.all(writes), r = await Promise.all(reads);
  assert.equal(w.reduce((a, x) => a + x.inserted, 0), 1000);
  assert.ok(r.every((n, i) => n === (Math.floor(i / 2) + 1) * 50), `each read sees whole batches only: ${r.slice(0, 8)}`);
  assert.equal(rowCount(db), 1000); assert.equal(contigId(db), 1000);
  db.close();
});

test('COLS is the wire and table order the app relies on', () => {
  assert.deepEqual(COLS, ['t', 'p', 'soc', 'v', 'i', 'w', 'ah', 'tm', 't1', 't2', 'ch', 'ds', 'bal', 'err']);
});
