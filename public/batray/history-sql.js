// BatRay by ClearEvo.com - stored history: the SQL over one SQLite day database (pure over a db handle, tested in node)
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
// One SQLite database per UTC day, the live day included (owner decision
// 2026-09-24: "no more ndjson, no more gz"). Every function here takes an
// open sqlite3 oo1 DB handle and plain values, so the same code runs in the
// history worker (OPFS) and in node tests (in-memory). Nothing here touches
// a timer, the network or the DOM.
//
// Table readings: id (dense per day: the reader hands ids out, a viewer's
// copy keeps the reader's ids), t ms UTC, p pack label, the reading's
// numbers, c = cell millivolts as a little-endian u16 blob. The unique
// (p, t) index is also the range index every chart query walks.

export const SCHEMA_VERSION = 1;
export const COLS = ['t', 'p', 'soc', 'v', 'i', 'w', 'ah', 'tm', 't1', 't2', 'ch', 'ds', 'bal', 'err'];
const NUM = new Set(['soc', 'v', 'i', 'w', 'ah', 'tm', 't1', 't2']);
const INT = new Set(['ch', 'ds', 'bal', 'err']);

export function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY, t INTEGER NOT NULL, p TEXT NOT NULL,
      soc REAL, v REAL, i REAL, w REAL, ah REAL, tm REAL, t1 REAL, t2 REAL,
      ch INTEGER, ds INTEGER, bal INTEGER, err INTEGER, c BLOB);
    CREATE UNIQUE INDEX IF NOT EXISTS readings_pt ON readings(p, t);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    INSERT OR IGNORE INTO meta (k, v) VALUES ('schema', '${SCHEMA_VERSION}'), ('app', 'BatRay');`);
}

/** Cell millivolts -> u16 little-endian blob (32 cells = 64 bytes); null/empty -> null. */
export function cellsToBlob(cells) {
  if (!cells || !cells.length) return null;
  const b = new Uint8Array(cells.length * 2);
  for (let i = 0; i < cells.length; i++) { const v = Math.max(0, Math.min(65535, Math.round(cells[i] || 0))); b[i * 2] = v & 0xff; b[i * 2 + 1] = v >> 8; }
  return b;
}
export function blobToCells(blob) {
  if (!blob || !blob.length) return null;
  const out = new Array(blob.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = blob[i * 2] | (blob[i * 2 + 1] << 8);
  return out;
}

const num = (x) => (x === undefined || x === null || Number.isNaN(x) ? null : Number(x));
const int = (x) => (x === undefined || x === null ? null : Number(x) ? 1 : 0);

/** Insert rows (objects with t, p, the numbers, c = cells array; id optional). INSERT OR IGNORE: a duplicate id or
 *  (p, t) is skipped, so the same rows can arrive twice (a viewer's live row and the reader's catch-up) without harm.
 *  One transaction. Returns { inserted, ignored, maxId }. */
export function insertRows(db, rows) {
  let inserted = 0, ignored = 0;
  if (!rows.length) return { inserted, ignored, maxId: maxId(db) };
  const st = db.prepare(`INSERT OR IGNORE INTO readings (id, ${COLS.join(', ')}, c) VALUES (?, ${COLS.map(() => '?').join(', ')}, ?)`);
  try {
    db.transaction(() => {
      for (const r of rows) {
        if (typeof r.t !== 'number' || !r.p) { ignored++; continue; }
        const vals = [r.id === undefined || r.id === null ? null : Math.round(r.id), Math.round(r.t), String(r.p)];
        for (const k of COLS.slice(2)) vals.push(NUM.has(k) ? num(r[k]) : INT.has(k) ? int(r[k]) : num(r[k]));
        vals.push(Array.isArray(r.c) ? cellsToBlob(r.c) : (r.c instanceof Uint8Array ? r.c : null));
        st.bind(vals).stepReset();
        if (db.changes() > 0) inserted++; else ignored++;
      }
    });
  } finally { st.finalize(); }
  return { inserted, ignored, maxId: maxId(db) };
}

export function maxId(db) { return db.selectValue('SELECT coalesce(max(id), 0) FROM readings'); }
export function rowCount(db) { return db.selectValue('SELECT count(*) FROM readings'); }

/** The largest id such that every id 1..contig is present (0 when the first row is missing or the table is empty):
 *  a viewer's copy is complete up to here; it asks the reader for the rows after it. */
export function contigId(db) {
  const min = db.selectValue('SELECT min(id) FROM readings');
  if (min === null || min === undefined) return 0;
  if (min > 1) return 0;
  return db.selectValue('SELECT coalesce((SELECT min(a.id) FROM readings a WHERE NOT EXISTS (SELECT 1 FROM readings b WHERE b.id = a.id + 1)), 0)');
}

function rowOf(o) {
  const r = { id: o.id, t: o.t, p: o.p };
  for (const k of COLS.slice(2)) if (o[k] !== null && o[k] !== undefined) r[k] = o[k];
  const c = blobToCells(o.c); if (c) r.c = c;
  return r;
}
/** Rows with id > after, ascending, at most limit (objects like the ones inserted, cells as an array). */
export function rowsAfter(db, after, limit = 5000) {
  return db.selectObjects(`SELECT id, ${COLS.join(', ')}, c FROM readings WHERE id > ? ORDER BY id LIMIT ?`, [after, limit]).map(rowOf);
}
/** The newest n rows of a pack, ascending. */
export function lastRows(db, p, n = 1) {
  return db.selectObjects(`SELECT id, ${COLS.join(', ')}, c FROM readings WHERE p = ? ORDER BY t DESC LIMIT ?`, [p, n]).map(rowOf).reverse();
}

/** Time buckets for a chart: rows of pack p with from <= t <= to grouped into stepMs buckets. Columns as arrays
 *  (uPlot style): t = bucket start (ms), w mean, wmin, wmax, soc mean, v mean, n rows. A bucket holds only the
 *  numbers, never rows, so a 30 d chart costs the same memory as a 1 h one. */
export function buckets(db, { p, from, to, stepMs }) {
  const step = Math.max(1, Math.round(stepMs));
  const rows = db.selectObjects(
    `SELECT (t / ?) AS b, avg(w) AS w, min(w) AS wmin, max(w) AS wmax, avg(soc) AS soc, avg(v) AS v, count(*) AS n
       FROM readings WHERE p = ? AND t BETWEEN ? AND ? GROUP BY b ORDER BY b`, [step, p, Math.round(from), Math.round(to)]);
  const out = { t: [], w: [], wmin: [], wmax: [], soc: [], v: [], n: [] };
  for (const r of rows) { out.t.push(r.b * step); out.w.push(r.w); out.wmin.push(r.wmin); out.wmax.push(r.wmax); out.soc.push(r.soc); out.v.push(r.v); out.n.push(r.n); }
  return out;
}

/** Charged / discharged watt-hours of pack p between from and to: each row's power over the time since the row
 *  before it, capped at maxGapMs (a gap in the log is not energy). */
export function energyWh(db, { p, from, to, maxGapMs = 60000 }) {
  const r = db.selectObject(
    `SELECT coalesce(sum(CASE WHEN w > 0 THEN w * dt END), 0) / 3600000.0 AS charged,
            coalesce(sum(CASE WHEN w < 0 THEN -w * dt END), 0) / 3600000.0 AS discharged
       FROM (SELECT w, min(t - lag(t) OVER (ORDER BY t), ?) AS dt FROM readings WHERE p = ? AND t BETWEEN ? AND ?)
      WHERE dt IS NOT NULL`, [Math.round(maxGapMs), p, Math.round(from), Math.round(to)]);
  return { charged: r ? r.charged : 0, discharged: r ? r.discharged : 0 };
}

/** First and last t and the row count of pack p from `since` on (for "how much is stored" decisions). */
export function span(db, p, since = 0) {
  const r = db.selectObject('SELECT min(t) AS first, max(t) AS last, count(*) AS n FROM readings WHERE p = ? AND t >= ?', [p, Math.round(since)]);
  return { first: r && r.n ? r.first : null, last: r && r.n ? r.last : null, n: r ? r.n : 0 };
}

/** What a day holds: rows, ids, time range, packs. */
export function dayInfo(db) {
  const r = db.selectObject('SELECT count(*) AS rows, coalesce(max(id), 0) AS maxId, min(t) AS minT, max(t) AS maxT FROM readings');
  const packs = db.selectValues('SELECT DISTINCT p FROM readings ORDER BY p');
  return { rows: r.rows, maxId: r.maxId, minT: r.minT, maxT: r.maxT, packs, contig: contigId(db) };
}
/** The database's size on disk in bytes (pages x page size). */
export function dbBytes(db) { return db.selectValue('SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()'); }

/** Merge every reading of an attached database (schema name `other`) into this one; ids are not kept (a restore
 *  into a day that already has rows). Returns the number added. */
export function mergeFrom(db, other = 'other') {
  const before = rowCount(db);
  db.exec(`INSERT OR IGNORE INTO readings (${COLS.join(', ')}, c) SELECT ${COLS.join(', ')}, c FROM ${other}.readings ORDER BY id`);
  return rowCount(db) - before;
}

/** Does this look like a BatRay day database? (a restored or received file is checked before it is kept) */
export function looksLikeDayDb(db) {
  try {
    const t = db.selectValue("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'readings'");
    if (!t) return false;
    const cols = db.selectValues('SELECT name FROM pragma_table_info(?)', ['readings']);
    return ['id', 't', 'p', 'w', 'soc'].every((c) => cols.includes(c));
  } catch { return false; }
}
