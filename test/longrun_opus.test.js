// BatRay by ClearEvo.com - tests (longrun_opus.test.js): what stops the reader after hours, days, months or a year
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
// Long-run review (opus, 2026-11-05). Each test names a finding (L-O<n>) and states what the code should do for a
// reader that runs 24/7 for a month to a year; every one of them fails on 0.9.85 for the reason in its message.
// A year is driven as N iterations of the real code path (fakes for the browser, an injected clock), not wall time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import v8 from 'node:v8';
import vm from 'node:vm';
import { openSqlite } from './sqlite_node.mjs';
import { HistoryStore } from '../public/batray/history.js';
import { rowFromReading, rowDue } from '../public/batray/history-logic.js';
import { ensureSchema, insertRows } from '../public/batray/history-sql.js';
import { makeKeyB64 } from '../public/batray/live-logic.js';
import { Muxer, StreamTarget } from '../public/batray/mp4-muxer.js';
import { BoxSplitter, takeSegments } from '../public/batray/tv-logic.js';

// ---- the browser, faked once for the whole file ----
const sockets = [];
class FakeWS {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.bufferedAmount = 0; sockets.push(this); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; if (this.onclose) this.onclose({ code, reason, wasClean: true }); }
  open() { this.readyState = 1; if (this.onopen) this.onopen(); }
  push(m) { if (this.onmessage) this.onmessage({ data: JSON.stringify(m) }); }
}
globalThis.WebSocket = FakeWS;
globalThis.Worker = function FakeWorkerCtor() {};
globalThis.location = { protocol: 'https:', host: 'test.local', origin: 'https://test.local' };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, storage: { getDirectory() {}, persist: async () => true } }, configurable: true, writable: true });
globalThis.fetch = async (url, init = {}) => ({ ok: true, status: 200, json: async () => (init.method === 'POST' ? { room: 'r9', pub: 'tok' } : { type: 'status', viewers: 0, live: false }) });
const { Publisher, Viewer } = await import('../public/batray/live.js');
const settle = (ms = 15) => new Promise((r) => { setTimeout(r, ms); });
const lastSock = () => sockets[sockets.length - 1];
async function until(cond, ms) { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return true; await settle(5); } return cond(); }

// The phone's wall clock as the app reads it (Date.now), with an offset the test can step; timers stay monotonic.
const realNow = Date.now.bind(Date);
let clockSkew = 0;
Date.now = () => realNow() + clockSkew;

const READING = { soc: 50, packV: 52.1, current: -3.2, power: -166, remainAh: 100, tempMos: 30, temp1: 25, temp2: 26, chgMos: true, dsgMos: true, balancing: false, errors: 0, cells: Array.from({ length: 16 }, (_, i) => ({ v: 3.25 + i * 0.001 })) };

// =====================================================================================================================
// L-O1  history.js retryLater(): after a lock-out the store tries a fresh worker RETRY_TRIES (30) times, RETRY_MS (2 min)
// apart, then logs "giving up until a reload" and stays memory-only - which since 0.9.74 means NOTHING is stored (no
// readings, no debug log) for the rest of the page's life. A reader nobody reloads stops storing for months.
// =====================================================================================================================
test('L-O1: a store that went memory-only keeps trying, so a reader whose pool frees after an hour stores again (no "giving up until a reload" on a 24/7 page)', async () => {
  const logs = []; let made = 0;
  const FREE_AT = 33;                                  // the pool frees for the 33rd worker: 64 min after the lock-out at the app's 2 min retry pace
  const makeWorker = () => {
    const n = ++made; const w = { onmessage: null, onerror: null };
    w.postMessage = ({ id }) => {
      if (id === 0) return;                            // config: the real worker answers id 0 only on a failure
      setTimeout(() => w.onmessage({ data: n < FREE_AT
        ? { id, ok: false, error: "Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.", name: 'InvalidStateError' }
        : { id, ok: true, r: { version: '3.53.4', vfs: 'opfs-sahpool', files: 3 } } }), 1);
    };
    w.terminate = () => {};
    return w;
  };
  const h = new HistoryStore({ log: (m) => logs.push(m), makeWorker, store: 'lrstore1', retryMs: 2 });
  assert.equal(await h.ready, 'memory', 'the first open fails: memory-only');
  await until(() => h.backend === 'opfs' || logs.some((l) => /giving up until a reload/.test(l)), 3000);
  await settle(50);
  assert.equal(h.backend, 'opfs', `the store never came back: ${made} workers tried, then "${logs.filter((l) => /giving up/.test(l)).join('')}" - with RETRY_TRIES=30 x RETRY_MS=2 min the reader stores nothing (rows nor debug log) from 1 h after a lock-out until someone reloads the page`);
});

// =====================================================================================================================
// L-O2  history-worker.js `days` opens EVERY stored day database (open(day, false) per file) and runs dayInfo (count(*),
// DISTINCT p, contigId = a scan of every id) on each; closeIdle() right after closes only databases idle > 60 s, so
// all of them stay open together. The reader lists days at start, at every UTC midnight (maintainHistory, twice),
// and for every viewer history request (link up + every 10 min per viewer). Retention deletes only under 100 MB free,
// so on a phone with room the day count grows by one a day, for ever: a year = 365 connections open at once, each
// with SQLite's page cache filled by the scans, in a wasm heap that never shrinks - and one call doing all of that
// against the 8 s 'days' deadline (a timeout counts toward the stuck-worker restart).
// The real worker module runs here over the node build of the same sqlite3.wasm (a fake sahpool on its in-memory FS).
// =====================================================================================================================
async function workerHarness() {
  const hooks = "export async function resolve(spec, ctx, next) { if (spec === './sqlite3.js' && ctx.parentURL && ctx.parentURL.endsWith('/history-worker.js')) return { url: 'data:text/javascript,export default async function init() { return globalThis.lrSqlite3; }', shortCircuit: true }; return next(spec, ctx); }";
  register('data:text/javascript,' + encodeURIComponent(hooks));
  const s = await openSqlite();
  const files = new Set(), openDbs = new Set(); let cap = 16, peak = 0;
  class PoolDb extends s.oo1.DB {
    constructor(name) { super('/tmp' + name); files.add(name); openDbs.add(this); peak = Math.max(peak, openDbs.size); }
    close() { openDbs.delete(this); return super.close(); }
  }
  s.installOpfsSAHPoolVfs = async () => ({ vfsName: 'fake-sahpool', getFileNames: () => [...files], getFileCount: () => files.size, getCapacity: () => cap, addCapacity: async (n) => { cap += n; }, isPaused: () => false, unpauseVfs: async () => {}, unlink: (n) => { files.delete(n); }, OpfsSAHPoolDb: PoolDb });
  globalThis.lrSqlite3 = s;
  const waiting = new Map(); let seq = 0;
  globalThis.self = { postMessage: (m) => { const f = waiting.get(m.id); if (f) { waiting.delete(m.id); f(m); } } };
  await import('../public/batray/history-worker.js');
  const call = (op, args = {}) => new Promise((res) => { const id = ++seq; waiting.set(id, res); globalThis.self.onmessage({ data: { id, op, args } }); });
  return { s, call, openDbs, PoolDb, peak: () => peak };
}
/** SQLite's page cache in use by one connection (SQLITE_DBSTATUS_CACHE_USED), bytes. */
function cacheUsed(s, db) {
  const pc = s.wasm.pstack.pointer;
  try {
    const cur = s.wasm.pstack.alloc(8), hi = s.wasm.pstack.alloc(8);
    s.capi.sqlite3_db_status(db.pointer, s.capi.SQLITE_DBSTATUS_CACHE_USED, cur, hi, 0);
    return s.wasm.peek32(cur);
  } finally { s.wasm.pstack.restore(pc); }
}

test('L-O2: listing the stored days (start, every UTC midnight, every viewer history request) leaves at most a few day databases open, not one per stored day', async () => {
  const h = await workerHarness(), s = h.s;
  assert.equal((await h.call('config', { store: 'lrstore2' })).ok, true);
  const SMALL = 114, REAL = 6, T0 = Date.UTC(2026, 0, 1), dayOf = (k) => new Date(T0 + k * 86400e3).toISOString().slice(0, 10);
  for (let k = 0; k < SMALL; k++) {                    // stored days through the worker's own insert (the count is the point here)
    const rows = []; for (let i = 0; i < 20; i++) { const r = rowFromReading('m-00', READING, T0 + k * 86400e3 + i * 3000); r.id = i + 1; rows.push(r); }
    const r = await h.call('insert', { day: dayOf(k), rows }); assert.equal(r.ok, true, r.error);
  }
  for (let k = SMALL; k < SMALL + REAL; k++) {         // real-size days: two packs, one row each per 3 s = 57,600 rows (~6 MB)
    const db = new h.PoolDb(`/${dayOf(k)}.sqlite`); ensureSchema(db);
    const rows = []; for (let i = 0; i < 57600; i++) { const r = rowFromReading(i % 2 ? 's-01' : 'm-00', READING, T0 + k * 86400e3 + i * 1500); r.id = i + 1; rows.push(r); }
    insertRows(db, rows); db.close();
  }
  clockSkew = 61000;                                   // a minute later: today's insert closes every idle past day (the state the reader is in)
  try {
    const today = new Date(Date.now()).toISOString().slice(0, 10);
    const r0 = rowFromReading('m-00', READING, Date.now()); r0.id = 1;
    await h.call('insert', { day: today, rows: [r0] });
    const before = h.openDbs.size, heap0 = s.wasm.heap8u().length;
    const t0 = realNow(); const d = await h.call('days'); const ms = realNow() - t0;
    assert.equal(d.ok, true, d.error); assert.equal(d.r.days.length, SMALL + REAL + 1);
    const after = h.openDbs.size, grew = s.wasm.heap8u().length - heap0;
    const realDb = [...h.openDbs].find((x) => x.filename && x.filename.includes(dayOf(SMALL)));
    const cache = realDb ? cacheUsed(s, realDb) : 0;
    const mb = (b) => (b / 1048576).toFixed(1);
    const msg = `one listing of ${SMALL + REAL + 1} days left ${after} day databases open (${before} before it) and grew the worker's wasm heap by ${mb(grew)} MB (it never shrinks); each real day holds ${mb(cache)} MB of page cache after the listing's scans -> a year of days = ~${Math.round(365 * cache / 1048576)} MB at every midnight and every viewer request (every 10 min per viewer). ${ms} ms here for that listing, nearly all of it the ${REAL} real-size days (~${Math.round(ms / REAL)} ms each on this machine): ~${Math.round(365 * ms / REAL / 1000)} s for a year on a fast desktop, against the 8 s 'days' deadline`;
    assert.ok(grew < 8 * 1048576, msg);
    assert.ok(after <= 4, msg);
  } finally { clockSkew = 0; }
});

// =====================================================================================================================
// L-O3  tv.js makeEncoder(): the mp4-muxer in 'fragmented' mode pushes every finished fragment (its chunk object with
// its sample objects) onto track.finalizedChunks and the muxer's own finalizedChunks list - kept for the mfra box
// written at finalize(), which a live stream never reaches. Show on TV makes one fragment per second, so the
// reader's heap grows for as long as it streams; only an encoder failure (a new muxer) resets it.
// =====================================================================================================================
test('L-O3: the Show on TV muxer keeps a bounded heap - a day of 1 s fragments must not leave tens of MB behind', () => {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const s = new BoxSplitter();
  const muxer = new Muxer({ target: new StreamTarget({ onData: (d, pos) => s.push(d, pos) }), video: { codec: 'avc', width: 1920, height: 1080 }, fastStart: 'fragmented', minFragmentDuration: 0.5, firstTimestampBehavior: 'strict' });   // tv.js options (segS 1)
  const avcC = new Uint8Array([1, 0x42, 0xE0, 0x1E, 0xFF, 0xE1, 0, 4, 0x67, 0x42, 0xE0, 0x1E, 1, 0, 2, 0x68, 0xCE]);
  const data = new Uint8Array(400); let f = 0;
  const run = (n) => { for (let k = 0; k < n; k++, f++) { muxer.addVideoChunkRaw(data, 'key', f * 1e6, 1e6, f === 0 ? { decoderConfig: { codec: 'avc1.42E01E', description: avcC } } : undefined); takeSegments(s); } };
  const heap = () => { gc(); gc(); return process.memoryUsage().heapUsed; };
  run(1000); const h0 = heap();
  const N = 20000; run(N); const h1 = heap();   // 5.6 h of 1 fps, 1 s segments
  const perFrag = (h1 - h0) / N, perDay = perFrag * 86400 / 1048576;
  assert.ok(perDay < 2, `the muxer kept ${Math.round(perFrag)} B per 1 s fragment: ${perDay.toFixed(1)} MB a day, ~${Math.round(perDay * 30)} MB after a month of Show on TV - an old phone's tab dies of it`);
});

// =====================================================================================================================
// L-O4  live.js Publisher.run / Viewer.run call this.emit() -> the app's onState (renderLiveChip, syncWake, watchReach,
// statusTick, alerts.notify, ...) unguarded inside the loop. One throw there ends the loop for good: start() then
// sees task !== null and never starts another, the socket is never reopened, and the only trace is one log line
// "publisher loop died". conn.js guards its hooks for exactly this reason (BLE review 2026-11-01); live.js does not.
// =====================================================================================================================
test('L-O4: the share loop survives one exception in the app\'s onState hook (the socket still reopens after a drop)', async () => {
  const logs = []; let thrown = 0;
  const p = new Publisher({ log: (m) => logs.push(m), retryS: 1, onState: (st) => { if (st.viewers === 1 && !thrown) { thrown++; throw new Error('a paint failed'); } } });
  await p.start(); await settle();
  const first = lastSock(); first.open(); await settle();
  assert.equal(p.state.live, true);
  first.push({ type: 'status', viewers: 1, live: true }); await settle();
  first.close(1006, ''); await settle();                                   // Wi-Fi blip: the relay drops the socket
  const reopened = await until(() => lastSock() !== first, 2500);
  await p.stop();
  assert.ok(reopened, `no new socket after the drop: the publisher loop ended on the hook's exception (${logs.filter((l) => /loop died/.test(l)).join('; ')}) - sharing stays dead until a person stops and restarts it`);
});

test('L-O4: the viewer loop survives one exception in the app\'s onState hook (the socket still reopens after a drop)', async () => {
  const logs = []; let thrown = 0;
  const v = new Viewer({ room: 'r1', keyB64: makeKeyB64(), log: (m) => logs.push(m), retryS: 1, onState: (st) => { if (st.viewers === 2 && !thrown) { thrown++; throw new Error('a paint failed'); } } });
  await v.start(); await settle();
  const first = lastSock(); first.open(); await settle();
  first.push({ type: 'status', viewers: 2, live: true }); await settle();
  first.close(1006, ''); await settle();
  const reopened = await until(() => lastSock() !== first, 2500);
  v.stop();
  assert.ok(reopened, `no new socket after the drop: the viewer loop ended on the hook's exception (${logs.filter((l) => /loop died/.test(l)).join('; ')})`);
});

// =====================================================================================================================
// L-O5  A backwards step of the phone's wall clock (NTP / carrier time correction, a wrong-time boot fixed later).
// (a) history-logic rowDue(lastRowAt, t) = t - lastRowAt >= 3 s: after a step back of S seconds no row is stored for
//     S seconds (an hour back = an hour of history missing, a year back = a year).
// (b) the reconnect countdowns run on wall-clock deadlines since 0.9.84 (live.js retryWait, conn.js secsLeft): a step
//     back of S seconds during a 4 s reopen countdown stretches it to S + 4 s.
// =====================================================================================================================
test('L-O5: a reading after the clock stepped back an hour is still stored (rowDue must not wait for the clock to catch up)', () => {
  const t = Date.UTC(2026, 10, 5, 12, 0, 0);
  const missed = []; let lastRowAt = t;
  for (let s = 3; s <= 3600; s += 3) { const now = t - 3600e3 + s * 1000; if (!rowDue(lastRowAt, now)) missed.push(now); else lastRowAt = now; }
  assert.equal(missed.length, 0, `${missed.length} readings (3 s apart) after a 1 h step back were not stored: ${Math.round(missed.length * 3 / 60)} min of history lost`);
});

test('L-O5: a share socket that drops just before the clock steps back an hour reopens in seconds, not in an hour', async () => {
  const p = new Publisher({ log: () => {}, retryS: 1, onState: () => {} });
  await p.start(); await settle();
  const first = lastSock(); first.open(); await settle();
  first.close(1006, ''); await settle(20);                                  // the 1 s countdown has started
  clockSkew = -3600e3;                                                      // NTP pulls the clock back an hour
  try {
    const reopened = await until(() => lastSock() !== first, 2500);
    assert.ok(reopened, `still counting down after 2.5 s: retryIn=${p.state.retryIn} s - the wall-clock deadline waits for the clock to catch up`);
  } finally { clockSkew = 0; await p.stop(); }
});

// =====================================================================================================================
// L-O6  House rule "every wait has a timeout": HistoryStore.persist() awaits navigator.storage.persist() with no
// deadline, and app.js flushBatch() awaits it at the top of the first flush while it holds the flush handle
// (histFlush). If the browser never answers, every later flush waits on that handle: nothing is stored, and the
// queue (histMem.pending, capped only on a FAILED insert) grows one row per pack per 3 s until the tab runs out of
// memory. The same call in a loop that must run for a year needs the store's usual deadline.
// =====================================================================================================================
test('L-O6: asking for persistent storage gives up after a deadline instead of holding the first history flush for good', async () => {
  const nav = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { value: { ...nav, storage: { ...nav.storage, persist: () => new Promise(() => {}) } }, configurable: true, writable: true });
  try {
    const h = new HistoryStore({ forceMemory: true });
    await h.ready;
    const r = await Promise.race([h.persist().then(() => 'answered'), settle(26000).then(() => 'hung')]);
    assert.equal(r, 'answered', 'persist() still pending after 26 s: the first flush (and every one after it) waits on it with no deadline');
  } finally { Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true }); }
});
