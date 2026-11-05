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
// included; the pool keeps them in the origin's private directory, one
// pool per tab's store (batray-db-<id>/; the store from before 0.9.77 is
// batray-history-db/). Plain text files (the debug log sessions, the device
// notes) stay in batray-history/<logs dir>. Old NDJSON day files from before 0.9.40
// are neither read nor migrated (owner 2026-09-24: "no more ndjson, no more
// gz", day 0 is a breaking change); start counts them once for the log and
// Clear stored history removes them. Nothing here decides anything:
// the page's history logic module does, this only does I/O, and every SQL
// statement is in the SQL module so node tests run the same code.

// 0.9.50: this script's response must carry the page's Cross-Origin-Embedder-Policy or Chrome refuses the worker
// on the isolated page (it did, silently, from 0.9.40 to 0.9.49 - "worker error [object Event]"). The header is a
// site deploy rule; this note also gives the file a new hash so browsers fetch it again instead of reusing the
// year-long cached copy that had no header.
import sqlite3InitModule from './sqlite3.js';
import { isCorruptError } from './history-logic.js';
import { ensureSchema, insertRows, rowsAfter, lastRows, buckets, energyWh, span, dayInfo, dayCount, dbBytes, mergeFrom, looksLikeDayDb } from './history-sql.js';
import { storeDirs, storeOfDir, storeOfLogDir, validTabId } from './tab-logic.js';
import { sleep } from './sync.js';

const DIR = 'batray-history';           // text files: one logs directory per store (and old day files from before 0.9.40, unread)
// One store per tab (0.9.77): the page names its store first ('config'); the SQLite pool's directory and the debug-log
// directory come from that id (tab-logic storeDirs). Other tabs' stores are only listed, read (their logs) or removed.
let STORE = null, DIRS = null;
const OLD_RX = /^\d{4}-\d{2}-\d{2}\.ndjson(\.gz)?$/;   // a day file from before 0.9.40
const IDLE_CLOSE_MS = 60000;
const PAGE_CACHE_KIB = 512;           // SQLite's page cache per open day database (its default is 2 MB)            // a past day's database is closed after this without use (today's stays open)
const enc = new TextEncoder(), dec = new TextDecoder();
let dirP = null;
function dir() { if (!dirP) dirP = openDir(); return dirP; }
async function openDir() { const root = await navigator.storage.getDirectory(); return root.getDirectoryHandle(DIR, { create: true }); }

let sqlite3 = null, pool = null, initP = null;
const dbs = new Map();                  // day -> { db, usedAt }
const DAY_RX = /^(\d{4}-\d{2}-\d{2})$/;
const dbName = (day) => `/${day}.sqlite`;
const dayOfName = (name) => { const m = /^\/(\d{4}-\d{2}-\d{2})\.sqlite$/.exec(name); return m ? m[1] : null; };

// The pool holds a sync access handle on every file: only one worker can have a pool, so every tab has its own
// (0.9.77). The page that went before in this tab (a reload, a page in the back/forward cache) may still hold it
// for a moment, so the install is
// retried for a few seconds, and a page hands the pool back on pagehide (`pause`) and takes it again on use.
const INSTALL_TRIES = 40, INSTALL_WAIT_MS = 500;    // up to 20 s: the page before may hold the pool for a moment after it left; then the store goes memory-only
const wlog = (msg) => { try { self.postMessage({ log: msg }); } catch { /* no page */ } };
async function init() {
  if (pool) return;
  if (!DIRS) throw new Error('no store named yet');
  if (!initP) {
    initP = openPool();
  }
  try { await initP; } catch (e) { initP = null; throw e; }               // the next op tries again
}
async function openPool() {
  sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
  for (let i = 1; ; i++) {
    try { pool = await sqlite3.installOpfsSAHPoolVfs({ directory: '/' + DIRS.db, initialCapacity: 16, clearOnInit: false }); if (i > 1) wlog(`pool taken on try ${i}`); break; }
    catch (e) {
      const busy = /Access Handle|NoModificationAllowed|InvalidState/i.test(String(e && e.message));
      if (!busy || i >= INSTALL_TRIES) { wlog(`pool not taken after ${i} tries: ${e && e.message}`); throw e; }
      if (i === 1 || i % 10 === 0) wlog(`pool busy (another worker still holds its files), try ${i} of ${INSTALL_TRIES}`);
      await sleep(INSTALL_WAIT_MS);
    }
  }
}
/** Hand the pool's files back (pagehide): every day database is closed and the access handles released, so the
 *  next page (or another tab) can take them. The next op takes them again. */
async function resume() { if (pool && pool.isPaused()) await pool.unpauseVfs(); return { paused: false }; }
async function room(n = 3) { if (pool.getFileCount() + n > pool.getCapacity()) await pool.addCapacity(Math.max(8, n)); }
const DEMO_DAY = 'demo';                 // the DEMO pack's rows: an in-memory database, never on disk, never listed or exported
let touching = null;                    // the day whose database the current op touches (named in a corruption error)
async function open(day, create = true) {
  if (day !== DEMO_DAY && !DAY_RX.test(day)) throw new Error('bad day ' + day);
  touching = day;
  const o = dbs.get(day);
  if (o) { o.usedAt = Date.now(); return o.db; }
  await init();
  if (day === DEMO_DAY) { const db = new sqlite3.oo1.DB(':memory:'); ensureSchema(db); dbs.set(day, { db, usedAt: Date.now() }); return db; }
  await resume();
  if (!create && !pool.getFileNames().includes(dbName(day))) return null;
  await room();
  const db = new pool.OpfsSAHPoolDb(dbName(day));
  try { db.exec('PRAGMA synchronous = NORMAL'); db.exec(`PRAGMA cache_size = -${PAGE_CACHE_KIB}`); ensureSchema(db); } catch (e) { try { db.close(); } catch { /* already */ } throw e; }
  dbs.set(day, { db, usedAt: Date.now() });
  return db;
}
function close(day) { const o = dbs.get(day); if (!o) return; try { o.db.close(); } catch { /* closing */ } dbs.delete(day); }
function closeIdle(keep) { const now = Date.now(); for (const [day, o] of dbs) if (day !== keep && day !== DEMO_DAY && now - o.usedAt > IDLE_CLOSE_MS) close(day); }
function todayKey() { return new Date().toISOString().slice(0, 10); }
/** Run fn over a stored day's database; a past day this call opened is closed again at once, so a walk over a year
 *  of days holds one page cache at a time (long-run review 2026-11-05: every listing had left every day open, the
 *  wasm heap never shrinks - ~6 MB of page cache per day file). */
async function visit(day, fn) {
  const was = dbs.has(day);
  const db = await open(day, false); if (!db) return null;
  try { return fn(db); } finally { if (!was && day !== todayKey() && day !== DEMO_DAY) close(day); }
}
// What the day listing needs of a PAST day (bytes, rows, highest id) does not change unless something writes that day:
// kept here and in a small file next to the logs, so a listing - at start, every midnight, every viewer's history
// request - costs one count per new day, not one scan of every file (the listing had a single 8 s deadline and a year
// of two-pack days takes ~7 s on a desktop). Every write forgets its day.
const infoCache = new Map();
let infoLoaded = false, infoDirty = false;
const infoName = () => `dayinfo-${STORE}.json`;
async function loadInfo() {
  if (infoLoaded) return; infoLoaded = true;
  try { const b = await fileBytes(await dir(), infoName()); if (b) for (const [k, v] of Object.entries(JSON.parse(dec.decode(b)))) if (DAY_RX.test(k) && v && typeof v.rows === 'number') infoCache.set(k, v); }
  catch { infoCache.clear(); }                                               // unreadable: counted again
}
async function saveInfo() {
  if (!infoDirty) return; infoDirty = false;
  try { const fh = await (await dir()).getFileHandle(infoName(), { create: true }); const w = await fh.createWritable(); await w.write(JSON.stringify(Object.fromEntries(infoCache))); await w.close(); }
  catch (e) { wlog(`day facts not saved: ${(e && e.message) || e}`); }
}
function forget(day) { if (infoCache.delete(day)) infoDirty = true; }
function daysOnDisk() { return pool ? pool.getFileNames().map(dayOfName).filter(Boolean).sort() : []; }

async function fileBytes(d, name) {
  try { const fh = await d.getFileHandle(name); const f = await fh.getFile(); return new Uint8Array(await f.arrayBuffer()); } catch (e) { if (e && e.name === 'NotFoundError') return null; throw e; }
}
async function remove(d, name) { try { await d.removeEntry(name); return true; } catch (e) { if (e && e.name === 'NotFoundError') return false; throw e; } }
async function gzip(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); }

/** Bytes under a directory (an unreadable file - one another tab is writing - counts as 0). */
async function dirBytes(d) {
  let n = 0;
  for await (const [, h] of d.entries()) {
    try { n += h.kind === 'file' ? (await h.getFile()).size : await dirBytes(h); } catch { /* busy or gone */ }
  }
  return n;
}
async function logDirOf(store, create) { return (await dir()).getDirectoryHandle(storeDirs(store).logs, { create }); }
/** The origin's private root (typed loosely: the DOM typings lack the async iterator on a directory handle).
 *  @returns {Promise<any>} */
async function rootDir() { return navigator.storage.getDirectory(); }
/** Remove a directory and what is in it; a missing one is fine, one whose files another tab holds says so. */
async function rmTree(d, name) {
  try { await d.removeEntry(name, { recursive: true }); return true; }
  catch (e) {
    if (e && e.name === 'NotFoundError') return false;
    if (e && (e.name === 'NoModificationAllowedError' || e.name === 'InvalidModificationError')) throw new Error('in use by another tab', { cause: e });
    throw e;
  }
}
/** The log files of one directory into `out`, each with its store. */
async function scanLogs(out, d, store) {
  for await (const [name, handle] of d.entries()) {
    if (handle.kind !== 'file' || !name.startsWith('log-')) continue;
    let bytes = 0; try { bytes = (await handle.getFile()).size; } catch { /* being written */ }
    out.push({ name, bytes, store });
  }
}

const ops = {
  /** The page names this worker's store before anything else; it never changes for the worker's life. */
  async config({ store }) {
    if (!validTabId(store)) throw new Error('bad store ' + store);
    if (STORE && STORE !== store) throw new Error('this worker already serves store ' + STORE);
    STORE = store; DIRS = storeDirs(store); return { store, dirs: DIRS };
  },
  /** Every store in this browser: {id, bytes, logBytes} (Browse lists the others; 'drop' removes one not in use). */
  async stores() {
    const root = await rootDir(), by = new Map(), get = (id) => by.get(id) || by.set(id, { id, bytes: 0, logBytes: 0 }).get(id);
    for await (const [name, h] of root.entries()) { const id = h.kind === 'directory' ? storeOfDir(name) : null; if (id) get(id).bytes = await dirBytes(h); }
    for await (const [name, h] of (await dir()).entries()) { const id = h.kind === 'directory' ? storeOfLogDir(name) : null; if (id) get(id).logBytes = await dirBytes(h); }
    return { stores: [...by.values()], own: STORE };
  },
  /** Remove another tab's store (its pool and its logs). A store a live tab holds refuses (its files are open). */
  async dropStore({ store }) {
    if (!validTabId(store)) throw new Error('bad store ' + store);
    if (store === STORE) throw new Error("this tab's own store: use Clear");
    const dirs = storeDirs(store);
    const a = await rmTree(await rootDir(), dirs.db), b = await rmTree(await dir(), dirs.logs);
    await remove(await dir(), `dayinfo-${store}.json`);                    // its day facts go with it
    return { removed: a || b };
  },
  async ping() { await init(); await dir(); return { ok: true, vfs: pool.vfsName, files: pool.getFileCount(), capacity: pool.getCapacity(), version: sqlite3.version.libVersion }; },
  /** Rows into the day's database (one transaction). */
  async insert({ day, rows }) { const db = await open(day); const r = insertRows(db, rows || []); if (r.inserted) forget(day); closeIdle(todayKey()); return r; },
  /** Every stored day: {day, bytes, rows, maxId}. */
  async days() {
    await init(); await resume(); await loadInfo(); const out = [], today = todayKey();
    const disk = daysOnDisk();
    for (const day of disk) {
      let i = day !== today ? infoCache.get(day) : null;
      if (!i) {
        i = await visit(day, (db) => ({ bytes: dbBytes(db), ...dayCount(db) })); if (!i) continue;
        if (day !== today) { infoCache.set(day, i); infoDirty = true; }
      }
      out.push({ day, bytes: i.bytes, rows: i.rows, maxId: i.maxId });
    }
    for (const day of [...infoCache.keys()]) if (!disk.includes(day)) forget(day);
    closeIdle(today); await saveInfo();
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
      await visit(day, (db) => {
        const b = buckets(db, { p, from, to, stepMs }); if (b.t.length) parts.push(b);
        const e = energyWh(db, { p, from, to }); energy.charged += e.charged; energy.discharged += e.discharged;
        const s = span(db, p, from); if (s.n) { if (first === null || s.first < first) first = s.first; if (last === null || s.last > last) last = s.last; }
      });
    }
    closeIdle(todayKey());
    return { parts, energy, first, last };
  },
  async span({ p, since = 0, days }) {
    await init(); let first = null, last = null, n = 0;
    for (const day of (days || daysOnDisk())) await visit(day, (db) => { const s = span(db, p, since); if (s.n) { n += s.n; if (first === null || s.first < first) first = s.first; if (last === null || s.last > last) last = s.last; } });
    return { first, last, n };
  },
  async remove({ day }) { await init(); await resume(); close(day); forget(day); const had = pool.getFileNames().includes(dbName(day)); if (had) pool.unlink(dbName(day)); return { removed: had }; },
  async clear() { await init(); await resume(); for (const day of [...dbs.keys()]) close(day); for (const day of [...infoCache.keys()]) forget(day); let n = 0; for (const day of daysOnDisk()) { pool.unlink(dbName(day)); n++; } const d = await dir(); for await (const [name, h] of d.entries()) if (h.kind === 'file' && OLD_RX.test(name)) { await remove(d, name); n++; } return { removed: n }; },   // the demo's memory database goes too
  /** The day's database as bytes (a real SQLite file: DB Browser for SQLite, Python, DuckDB open it). */
  async export({ day }) { await init(); await resume(); const o = dbs.get(day); if (o) { try { o.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* not wal */ } } const name = dbName(day); if (!pool.getFileNames().includes(name)) return { bytes: null }; return { bytes: pool.exportFile(name) }; },
  /** A day file from a backup or from the reader: checked (SQLite header, our table), then stored as the day when
   *  this device lacks it, else merged into the existing day by (pack, time). */
  async import({ day, bytes }) {
    await init(); await resume();
    if (!DAY_RX.test(day)) throw new Error('bad day ' + day);
    forget(day);
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
  /** Old NDJSON day files from before 0.9.40 (not read, not migrated): how many and how big, for one log line. */
  async oldFiles() { const d = await dir(); let n = 0, bytes = 0; for await (const [name, h] of d.entries()) if (h.kind === 'file' && OLD_RX.test(name)) { n++; bytes += (await h.getFile()).size; } return { files: n, bytes }; },
  /** Test hooks. `slow` = a worker that does not answer for a while (a timer: terminate() ends it cleanly and the
   *  pool is free at once); `spin` = a worker stuck in JavaScript (a busy loop: Chrome's terminate() then never
   *  releases its access handles - the pool stays locked until the page is reloaded, probed 2026-09-24). */
  async slow({ ms }) { await sleep(Math.min(ms || 0, 120000)); return { slept: ms }; },
  /** Test hook: damage a day's file in place (the header stays, every byte after it is 0xFF), as a bad flash
   *  block or a torn write would. The next read or write of that day raises SQLITE_CORRUPT. */
  async corrupt({ day }) { await init(); await resume(); close(day); forget(day); const name = dbName(day); const bytes = pool.exportFile(name); bytes.fill(0xff, 100); pool.importDb(name, bytes); return { bytes: bytes.length }; },
  async spin({ ms }) { const end = Date.now() + Math.min(ms || 0, 120000); while (Date.now() < end) { /* busy */ } return { spun: ms }; },
  async note({ name, text }) {
    if (!/^[a-z]+\.ndjson$/.test(name)) throw new Error('bad note name');
    const d = await ops.logDir(); const fh = await d.getFileHandle(name, { create: true }); const h = await fh.createSyncAccessHandle();   // per store since 0.9.77
    try { const size = h.getSize(); h.write(enc.encode(text), { at: size }); h.flush(); return { bytes: size + text.length }; } finally { h.close(); }
  },
  // ---- the debug log: session files in this store's logs directory (owner ask 2026-09-23; per tab since 0.9.77) ----
  async logDir() { if (!DIRS) throw new Error('no store named yet'); return logDirOf(STORE, true); },
  async logAppend({ name, text }) {
    if (!/^log-[0-9TZ-]+-[a-z0-9]{6}\.txt$/.test(name)) throw new Error('bad log name');
    const d = await ops.logDir(); const fh = await d.getFileHandle(name, { create: true }); const h = await fh.createSyncAccessHandle();
    try { const size = h.getSize(); const b = enc.encode(text); h.write(b, { at: size }); h.flush(); return { bytes: size + b.length }; } finally { h.close(); }
  },
  /** This store's log files; `all`: every store's, each with its `store` (Browse lists them all). */
  async logList({ all = false } = {}) {
    const out = [];
    if (!all) await scanLogs(out, await ops.logDir(), STORE);
    else for await (const [name, h] of (await dir()).entries()) { const id = h.kind === 'directory' ? storeOfLogDir(name) : null; if (id) await scanLogs(out, h, id); }
    return { files: out.sort((a, b) => (a.name < b.name ? -1 : 1)) };
  },
  async logRead({ name, store = null }) { const d = store && store !== STORE ? await logDirOf(store, false) : await ops.logDir(); const b = await fileBytes(d, name); return { text: b ? dec.decode(b) : '' }; },
  async logRemove({ name, store = null }) {
    if (!/^log-[0-9TZ-]+-[a-z0-9]{6}\.txt$/.test(name)) throw new Error('bad log name');
    const d = store && store !== STORE ? await logDirOf(store, false) : await ops.logDir(); return { removed: await remove(d, name) };
  },
  async logClear() { const d = await ops.logDir(); let n = 0; for await (const [name] of d.entries()) { await d.removeEntry(name); n++; } return { removed: n }; },
  /** Every log file gzipped, for a .tar download. */
  async logAllGz() {
    const d = await ops.logDir(); const { files } = await ops.logList(); const out = [];
    for (const f of files) { const b = await fileBytes(d, f.name); if (b && b.length) out.push({ name: f.name + '.gz', bytes: await gzip(b) }); }
    return { files: out };
  },
  async estimate() { const e = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : {}; return { usage: e.usage || 0, quota: e.quota || 0 }; },
};

self.onmessage = (ev) => { void runOp(ev.data || {}); };
/** One op: its reply (or its error) goes back with its id; the page's call waits on that. */
async function runOp({ id, op, args }) {
  try {
    if (!ops[op]) throw new Error('unknown op ' + op);
    const r = await ops[op](args || {});
    self.postMessage({ id, ok: true, r });
  } catch (e) {
    if (isCorruptError(e)) {                                                // the file is damaged: close it, name the day, raise
      const day = (args && args.day) || touching; close(day);
      const msg = `${day} database is corrupt (${op}): ${(e && e.message) || e}`; wlog(msg);
      self.postMessage({ id, ok: false, error: msg, name: 'CorruptError', data: { day, op } }); return;
    }
    self.postMessage({ id, ok: false, error: (e && e.message) || String(e), name: e && e.name });
  }
}
