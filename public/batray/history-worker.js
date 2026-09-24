// BatRay by ClearEvo.com - stored history worker: SQLite day databases in OPFS (insert, query, export, import, delete)
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
// A dedicated module worker: SQLite (the sqlite.org wasm build, public
// domain) over its OPFS "sahpool" VFS, which needs the synchronous access
// handles only a worker has. One database per UTC day, the live day
// included; the pool keeps them in the origin's private directory
// batray-history-db/. Plain text files (the debug log sessions, the device
// notes) stay in batray-history/, where the old NDJSON day files also live
// until `migrate` has moved their rows into day databases (owner decision
// 2026-09-24: no more NDJSON, no more gz). Nothing here decides anything:
// the page's history logic module does, this only does I/O, and every SQL
// statement is in the SQL module so node tests run the same code.

import sqlite3InitModule from './sqlite3.js';
import { ensureSchema, insertRows, rowsAfter, lastRows, buckets, energyWh, span, dayInfo, dbBytes, mergeFrom, looksLikeDayDb } from './history-sql.js';

const DIR = 'batray-history';           // text files: logs/, devices.ndjson, and old day files awaiting migration
const DB_DIR = '/batray-history-db';    // the SQLite pool's directory (its files are opaque; export gives a real .sqlite)
const IDLE_CLOSE_MS = 60000;            // a past day's database is closed after this without use (today's stays open)
const enc = new TextEncoder(), dec = new TextDecoder();
let dirP = null;
function dir() { return dirP || (dirP = navigator.storage.getDirectory().then((root) => root.getDirectoryHandle(DIR, { create: true }))); }

let sqlite3 = null, pool = null, initP = null;
const dbs = new Map();                  // day -> { db, usedAt }
const DAY_RX = /^(\d{4}-\d{2}-\d{2})$/;
const dbName = (day) => `/${day}.sqlite`;
const dayOfName = (name) => { const m = /^\/(\d{4}-\d{2}-\d{2})\.sqlite$/.exec(name); return m ? m[1] : null; };

// The pool holds a sync access handle on every file: only one worker in the browser can have it. The page that
// went before (a reload, a tab in the back/forward cache) may still hold it for a moment, so the install is
// retried for a few seconds, and a page hands the pool back on pagehide (`pause`) and takes it again on use.
const INSTALL_TRIES = 40, INSTALL_WAIT_MS = 500;    // up to 20 s: the page before may hold the pool for a moment after it left; then the store goes memory-only
const wlog = (msg) => { try { self.postMessage({ log: msg }); } catch { /* no page */ } };
async function init() {
  if (pool) return;
  if (!initP) {
    initP = (async () => {
      sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
      for (let i = 1; ; i++) {
        try { pool = await sqlite3.installOpfsSAHPoolVfs({ directory: DB_DIR, initialCapacity: 16, clearOnInit: false }); if (i > 1) wlog(`pool taken on try ${i}`); break; }
        catch (e) {
          const busy = /Access Handle|NoModificationAllowed|InvalidState/i.test(String(e && e.message));
          if (!busy || i >= INSTALL_TRIES) { wlog(`pool not taken after ${i} tries: ${e && e.message}`); throw e; }
          if (i === 1 || i % 10 === 0) wlog(`pool busy (another worker still holds its files), try ${i} of ${INSTALL_TRIES}`);
          await new Promise((r) => setTimeout(r, INSTALL_WAIT_MS));
        }
      }
    })().catch((e) => { initP = null; throw e; });
  }
  await initP;
}
/** Hand the pool's files back (pagehide): every day database is closed and the access handles released, so the
 *  next page (or another tab) can take them. The next op takes them again. */
async function pause() { if (!pool || pool.isPaused()) return { paused: !!pool }; for (const day of [...dbs.keys()]) if (day !== DEMO_DAY) close(day); await pool.pauseVfs(); return { paused: true }; }
async function resume() { if (pool && pool.isPaused()) await pool.unpauseVfs(); return { paused: false }; }
async function room(n = 3) { if (pool.getFileCount() + n > pool.getCapacity()) await pool.addCapacity(Math.max(8, n)); }
const DEMO_DAY = 'demo';                 // the DEMO pack's rows: an in-memory database, never on disk, never listed or exported
async function open(day, create = true) {
  if (day !== DEMO_DAY && !DAY_RX.test(day)) throw new Error('bad day ' + day);
  const o = dbs.get(day);
  if (o) { o.usedAt = Date.now(); return o.db; }
  await init();
  if (day === DEMO_DAY) { const db = new sqlite3.oo1.DB(':memory:'); ensureSchema(db); dbs.set(day, { db, usedAt: Date.now() }); return db; }
  await resume();
  if (!create && !pool.getFileNames().includes(dbName(day))) return null;
  await room();
  const db = new pool.OpfsSAHPoolDb(dbName(day));
  try { db.exec('PRAGMA synchronous = NORMAL'); ensureSchema(db); } catch (e) { try { db.close(); } catch { /* already */ } throw e; }
  dbs.set(day, { db, usedAt: Date.now() });
  return db;
}
function close(day) { const o = dbs.get(day); if (!o) return; try { o.db.close(); } catch { /* closing */ } dbs.delete(day); }
function closeIdle(keep) { const now = Date.now(); for (const [day, o] of dbs) if (day !== keep && day !== DEMO_DAY && now - o.usedAt > IDLE_CLOSE_MS) close(day); }
function todayKey() { return new Date().toISOString().slice(0, 10); }
function daysOnDisk() { return pool ? pool.getFileNames().map(dayOfName).filter(Boolean).sort() : []; }

async function fileBytes(d, name) {
  try { const fh = await d.getFileHandle(name); const f = await fh.getFile(); return new Uint8Array(await f.arrayBuffer()); } catch (e) { if (e && e.name === 'NotFoundError') return null; throw e; }
}
async function remove(d, name) { try { await d.removeEntry(name); return true; } catch (e) { if (e && e.name === 'NotFoundError') return false; throw e; } }
async function gzip(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); }

const ops = {
  async ping() { await init(); await dir(); return { ok: true, vfs: pool.vfsName, files: pool.getFileCount(), capacity: pool.getCapacity(), version: sqlite3.version.libVersion }; },
  /** Rows into the day's database (one transaction). */
  async insert({ day, rows }) { const db = await open(day); const r = insertRows(db, rows || []); closeIdle(todayKey()); return r; },
  /** Every stored day: {day, bytes, rows, maxId}. */
  async days() {
    await init(); await resume(); const out = [];
    for (const day of daysOnDisk()) {
      const db = await open(day, false); if (!db) continue;
      const i = dayInfo(db); out.push({ day, bytes: dbBytes(db), rows: i.rows, maxId: i.maxId });
    }
    closeIdle(todayKey());
    return { days: out };
  },
  async info({ day }) { const db = await open(day, false); if (!db) return { day, rows: 0, maxId: 0, minT: null, maxT: null, packs: [], contig: 0, bytes: 0 }; return { day, ...dayInfo(db), bytes: dbBytes(db) }; },
  async rows({ day, after = 0, limit = 5000 }) { const db = await open(day, false); return { rows: db ? rowsAfter(db, after, limit) : [] }; },
  async last({ day, p, n = 1 }) { const db = await open(day, false); return { rows: db ? lastRows(db, p, n) : [] }; },
  /** One chart: buckets of every stored day the window touches (ascending), the energy of the window, and the
   *  stored time span of the pack over those days. */
  async query({ p, from, to, stepMs, days }) {
    await init();
    const parts = [], energy = { charged: 0, discharged: 0 }; let first = null, last = null;
    for (const day of (days || daysOnDisk())) {
      const db = await open(day, false); if (!db) continue;
      const b = buckets(db, { p, from, to, stepMs }); if (b.t.length) parts.push(b);
      const e = energyWh(db, { p, from, to }); energy.charged += e.charged; energy.discharged += e.discharged;
      const s = span(db, p, from); if (s.n) { if (first === null || s.first < first) first = s.first; if (last === null || s.last > last) last = s.last; }
    }
    closeIdle(todayKey());
    return { parts, energy, first, last };
  },
  async span({ p, since = 0, days }) {
    await init(); let first = null, last = null, n = 0;
    for (const day of (days || daysOnDisk())) { const db = await open(day, false); if (!db) continue; const s = span(db, p, since); if (s.n) { n += s.n; if (first === null || s.first < first) first = s.first; if (last === null || s.last > last) last = s.last; } }
    return { first, last, n };
  },
  async remove({ day }) { await init(); await resume(); close(day); const had = pool.getFileNames().includes(dbName(day)); if (had) pool.unlink(dbName(day)); return { removed: had }; },
  async clear() { await init(); await resume(); for (const day of [...dbs.keys()]) close(day); let n = 0; for (const day of daysOnDisk()) { pool.unlink(dbName(day)); n++; } return { removed: n }; },   // the demo's memory database goes too
  /** The day's database as bytes (a real SQLite file: DB Browser for SQLite, Python, DuckDB open it). */
  async export({ day }) { await init(); await resume(); const o = dbs.get(day); if (o) { try { o.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* not wal */ } } const name = dbName(day); if (!pool.getFileNames().includes(name)) return { bytes: null }; return { bytes: pool.exportFile(name) }; },
  /** A day file from a backup or from the reader: checked (SQLite header, our table), then stored as the day when
   *  this device lacks it, else merged into the existing day by (pack, time). */
  async import({ day, bytes }) {
    await init(); await resume();
    if (!DAY_RX.test(day)) throw new Error('bad day ' + day);
    if (!bytes || bytes.length < 100 || dec.decode(bytes.subarray(0, 15)) !== 'SQLite format 3') throw new Error('not a SQLite database');
    const tmp = '/import-tmp.sqlite';
    await room(4);
    pool.importDb(tmp, bytes);
    let tdb = null;
    try {
      tdb = new pool.OpfsSAHPoolDb(tmp);
      if (!looksLikeDayDb(tdb)) throw new Error('not a BatRay day database');
      const info = dayInfo(tdb);
      tdb.close(); tdb = null;
      if (!pool.getFileNames().includes(dbName(day))) {
        close(day);
        pool.importDb(dbName(day), bytes); pool.unlink(tmp);
        const db = await open(day); ensureSchema(db);
        return { rows: info.rows, merged: false, maxId: info.maxId };
      }
      const db = await open(day);
      db.exec(`ATTACH DATABASE '${tmp}' AS other`);
      let added = 0;
      try { added = mergeFrom(db, 'other'); } finally { db.exec('DETACH DATABASE other'); }
      pool.unlink(tmp);
      return { rows: added, merged: true, maxId: dayInfo(db).maxId };
    } catch (e) {
      if (tdb) { try { tdb.close(); } catch { /* closing */ } }
      try { pool.unlink(tmp); } catch { /* gone */ }
      throw e;
    }
  },
  /** Move one old NDJSON day file (raw or gz) into its day database, then delete it. Returns what was done and
   *  how many old files remain, so the page loops with a log line per file. */
  async migrate() {
    await init(); const d = await dir();
    const old = [];
    for await (const [name, h] of d.entries()) { const m = /^(\d{4}-\d{2}-\d{2})\.ndjson(\.gz)?$/.exec(name); if (m && h.kind === 'file') old.push({ name, day: m[1], gz: !!m[2] }); }
    old.sort((a, b) => (a.name < b.name ? -1 : 1));
    if (!old.length) return { done: true, remaining: 0 };
    const f = old[0]; const t0 = Date.now();
    const bytes = await fileBytes(d, f.name);
    let stream = new Blob([bytes]).stream(); if (f.gz) stream = stream.pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader(); const db = await open(f.day); let id = dayInfo(db).maxId; let carry = ''; let rows = 0, bad = 0; let batch = [];
    const flush = () => { if (!batch.length) return; rows += insertRows(db, batch).inserted; batch = []; };
    for (;;) {
      const { value, done } = await reader.read();
      const text = carry + (value ? dec.decode(value, { stream: true }) : '');
      const lines = text.split('\n'); carry = done ? '' : lines.pop();
      for (const line of lines) {
        if (!line) continue;
        try { const r = JSON.parse(line); if (r && typeof r.t === 'number' && r.p) { delete r.n; delete r.o; r.id = ++id; batch.push(r); } else bad++; } catch { bad++; }
        if (batch.length >= 2000) flush();
      }
      if (done) break;
    }
    flush();
    await remove(d, f.name);
    return { done: false, file: f.name, day: f.day, rows, bad, bytes: bytes.length, ms: Date.now() - t0, remaining: old.length - 1 };
  },
  /** How many old day files wait for migration (a quick look at start). */
  async migrateCount() { const d = await dir(); let n = 0, bytes = 0; for await (const [name, h] of d.entries()) if (h.kind === 'file' && /^\d{4}-\d{2}-\d{2}\.ndjson(\.gz)?$/.test(name)) { n++; bytes += (await h.getFile()).size; } return { files: n, bytes }; },
  /** Test hook: hold the worker busy (the page's timeout must fire, never wait). */
  /** Test hooks. `slow` = a worker that does not answer for a while (a timer: terminate() ends it cleanly and the
   *  pool is free at once); `spin` = a worker stuck in JavaScript (a busy loop: Chrome's terminate() then never
   *  releases its access handles - the pool stays locked until the page is reloaded, probed 2026-09-24). */
  async slow({ ms }) { await new Promise((r) => setTimeout(r, Math.min(ms || 0, 120000))); return { slept: ms }; },
  async spin({ ms }) { const end = Date.now() + Math.min(ms || 0, 120000); while (Date.now() < end) { /* busy */ } return { spun: ms }; },
  async note({ name, text }) {
    if (!/^[a-z]+\.ndjson$/.test(name)) throw new Error('bad note name');
    const d = await dir(); const fh = await d.getFileHandle(name, { create: true }); const h = await fh.createSyncAccessHandle();
    try { const size = h.getSize(); h.write(enc.encode(text), { at: size }); h.flush(); return { bytes: size + text.length }; } finally { h.close(); }
  },
  // ---- the debug log: session files under logs/ (owner ask 2026-09-23) ----
  async logDir() { return (await dir()).getDirectoryHandle('logs', { create: true }); },
  async logAppend({ name, text }) {
    if (!/^log-[0-9TZ-]+-[a-z0-9]{6}\.txt$/.test(name)) throw new Error('bad log name');
    const d = await ops.logDir(); const fh = await d.getFileHandle(name, { create: true }); const h = await fh.createSyncAccessHandle();
    try { const size = h.getSize(); const b = enc.encode(text); h.write(b, { at: size }); h.flush(); return { bytes: size + b.length }; } finally { h.close(); }
  },
  async logList() {
    const d = await ops.logDir(); const out = [];
    for await (const [name, handle] of d.entries()) if (handle.kind === 'file' && name.startsWith('log-')) out.push({ name, bytes: (await handle.getFile()).size });
    return { files: out.sort((a, b) => (a.name < b.name ? -1 : 1)) };
  },
  async logRead({ name }) { const d = await ops.logDir(); const b = await fileBytes(d, name); return { text: b ? dec.decode(b) : '' }; },
  async logRemove({ name }) { const d = await ops.logDir(); return { removed: await remove(d, name) }; },
  async logClear() { const d = await ops.logDir(); let n = 0; for await (const [name] of d.entries()) { await d.removeEntry(name); n++; } return { removed: n }; },
  /** Every log file gzipped, for a .tar download. */
  async logAllGz() {
    const d = await ops.logDir(); const { files } = await ops.logList(); const out = [];
    for (const f of files) { const b = await fileBytes(d, f.name); if (b && b.length) out.push({ name: f.name + '.gz', bytes: await gzip(b) }); }
    return { files: out };
  },
  async estimate() { const e = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : {}; return { usage: e.usage || 0, quota: e.quota || 0 }; },
};

self.onmessage = async (ev) => {
  const { id, op, args } = ev.data || {};
  try {
    if (!ops[op]) throw new Error('unknown op ' + op);
    const r = await ops[op](args || {});
    self.postMessage({ id, ok: true, r });
  } catch (e) { self.postMessage({ id, ok: false, error: (e && e.message) || String(e), name: e && e.name }); }
};
