// BatRay by ClearEvo.com - stored history store: the page's door to the SQLite worker, with deadlines and statistics
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
// Every call has a deadline (owner rule 2026-09-24: "no block forever"): the
// promise rejects at the op's timeout whatever the worker is doing, the
// failure is logged, and three timeouts in a row restart the worker. Every
// call is counted (kind, ms, outcome, rows) for the statistics line the page
// logs. Where there is no worker or no OPFS (an old browser, a second tab
// holding the pool) a memory-only backend answers the same calls and the
// card says "not stored".

import { opTimeoutMs, statsState, statsAdd, stuckDecision, statsLine, statsReset, bucketsFromRows, energyFromRows, daysInRange } from './history-logic.js';

const WORKER_URL = 'history-worker.js';

class MemoryBackend {
  constructor() { this.store = new Map(); this.files = new Map(); }      // day -> rows[]; 'L:name' -> text
  rowsOf(day) { return this.store.get(day) || []; }
  async ping() { return { ok: true, vfs: 'memory' }; }
  async insert({ day, rows }) {
    const list = this.store.get(day) || []; let inserted = 0, ignored = 0;
    for (const r of rows || []) {
      if (typeof r.t !== 'number' || !r.p) { ignored++; continue; }
      const id = r.id === undefined || r.id === null ? (list.length ? list[list.length - 1].id + 1 : 1) : r.id;
      if (list.some((x) => x.id === id || (x.p === r.p && x.t === r.t))) { ignored++; continue; }
      list.push({ ...r, id }); inserted++;
    }
    list.sort((a, b) => a.id - b.id); this.store.set(day, list);
    return { inserted, ignored, maxId: list.length ? list[list.length - 1].id : 0 };
  }
  async days() { return { days: [...this.store.entries()].filter(([day]) => day !== 'demo').map(([day, rows]) => ({ day, bytes: rows.length * 120, rows: rows.length, maxId: rows.length ? rows[rows.length - 1].id : 0 })).sort((a, b) => (a.day < b.day ? -1 : 1)) }; }
  async info({ day }) { const rows = this.rowsOf(day); let contig = 0; for (const r of rows) { if (r.id === contig + 1) contig = r.id; else break; } return { day, rows: rows.length, maxId: rows.length ? rows[rows.length - 1].id : 0, minT: rows.length ? Math.min(...rows.map((r) => r.t)) : null, maxT: rows.length ? Math.max(...rows.map((r) => r.t)) : null, packs: [...new Set(rows.map((r) => r.p))], contig, bytes: rows.length * 120 }; }
  async rows({ day, after = 0, limit = 5000 }) { return { rows: this.rowsOf(day).filter((r) => r.id > after).slice(0, limit) }; }
  async last({ day, p, n = 1 }) { return { rows: this.rowsOf(day).filter((r) => r.p === p).sort((a, b) => a.t - b.t).slice(-n) }; }
  async query({ p, from, to, stepMs, days }) {
    const parts = [], energy = { charged: 0, discharged: 0 }; let first = null, last = null;
    for (const day of (days || [...this.store.keys()].sort())) {
      const rows = this.rowsOf(day).slice().sort((a, b) => a.t - b.t); if (!rows.length) continue;
      const b = bucketsFromRows(rows, { p, from, to, stepMs }); if (b.t.length) parts.push(b);
      const e = energyFromRows(rows, { p, from, to }); energy.charged += e.charged; energy.discharged += e.discharged;
      for (const r of rows) if (r.p === p && r.t >= from) { if (first === null || r.t < first) first = r.t; if (last === null || r.t > last) last = r.t; }
    }
    return { parts, energy, first, last };
  }
  async span({ p, since = 0, days }) { let first = null, last = null, n = 0; for (const day of (days || [...this.store.keys()])) for (const r of this.rowsOf(day)) if (r.p === p && r.t >= since) { n++; if (first === null || r.t < first) first = r.t; if (last === null || r.t > last) last = r.t; } return { first, last, n }; }
  async remove({ day }) { return { removed: this.store.delete(day) }; }
  async clear() { const n = this.store.size; this.store.clear(); return { removed: n }; }
  async export() { return { bytes: null }; }
  async import() { throw new Error('this browser cannot store files'); }
  async migrate() { return { done: true, remaining: 0 }; }
  async migrateCount() { return { files: 0, bytes: 0 }; }
  async pause() { return { paused: false }; }
  async resume() { return { paused: false }; }
  async slow({ ms }) { await new Promise((r) => setTimeout(r, ms)); return { slept: ms }; }
  async note() { return { bytes: 0 }; }
  async logAppend({ name, text }) { const f = this.files.get('L:' + name) || { raw: '' }; f.raw += text; this.files.set('L:' + name, f); return { bytes: f.raw.length }; }
  async logList() { return { files: [...this.files.entries()].filter(([k]) => k.startsWith('L:')).map(([k, f]) => ({ name: k.slice(2), bytes: f.raw.length })).sort((a, b) => (a.name < b.name ? -1 : 1)) }; }
  async logRead({ name }) { const f = this.files.get('L:' + name); return { text: f ? f.raw : '' }; }
  async logRemove({ name }) { return { removed: this.files.delete('L:' + name) }; }
  async logClear() { let n = 0; for (const k of [...this.files.keys()]) if (k.startsWith('L:')) { this.files.delete(k); n++; } return { removed: n }; }
  async logAllGz() { return { files: [] }; }
  async estimate() { return { usage: 0, quota: 0 }; }
}

/** The worker and its message protocol: one promise per call, a deadline per call, terminate + fresh worker on restart. */
class WorkerBackend {
  constructor(log, makeWorker) { this.log = log; this.makeWorker = makeWorker || (() => new Worker(WORKER_URL, { type: 'module' })); this.seq = 0; this.waiting = new Map(); this.generation = 0; this.start(); }
  start() {
    this.generation++;
    this.w = this.makeWorker();
    this.w.onmessage = (ev) => { const m = ev.data; if (m && m.log) { this.log('history worker: ' + m.log); return; } const p = this.waiting.get(m.id); if (!p) return; this.waiting.delete(m.id); clearTimeout(p.timer); m.ok ? p.res(m.r) : p.rej(Object.assign(new Error(m.error), { name: m.name || 'Error' })); };
    this.w.onerror = (e) => { this.log('history: worker error ' + (e.message || e)); this.failAll(new Error('worker failed')); };
  }
  failAll(err) { for (const p of this.waiting.values()) { clearTimeout(p.timer); p.rej(err); } this.waiting.clear(); }
  /** Kill the worker (whatever it is doing) and start another; pending calls fail at once. */
  restart() { this.failAll(Object.assign(new Error('worker restarted'), { name: 'RestartError' })); try { if (this.w) this.w.terminate(); } catch { /* gone */ } this.start(); }
  /** Stop the worker (pagehide): its OPFS access handles are released with it, so the next page or another tab
   *  can take the pool; the next call starts a fresh worker (a page back from the back/forward cache). */
  stop() { this.failAll(Object.assign(new Error('worker stopped'), { name: 'RestartError' })); try { if (this.w) this.w.terminate(); } catch { /* gone */ } this.w = null; }
  call(op, args, timeoutMs) {
    if (!this.w) this.start();
    return new Promise((res, rej) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { if (!this.waiting.has(id)) return; this.waiting.delete(id); rej(Object.assign(new Error(`${op} timed out after ${Math.round(timeoutMs / 1000)} s`), { name: 'TimeoutError' })); }, timeoutMs);
      this.waiting.set(id, { res, rej, timer });
      try { this.w.postMessage({ id, op, args }); } catch (e) { clearTimeout(timer); this.waiting.delete(id); rej(e); }
    });
  }
}

const POOL_LOCKED_RX = /Access Handles? cannot be created|pool not taken/i;
const KIND = { ping: 'ping', pause: 'other', resume: 'other', insert: 'insert', days: 'days', info: 'days', rows: 'rows', last: 'rows', query: 'query', span: 'query', remove: 'remove', clear: 'clear', export: 'export', import: 'import', migrate: 'migrate', migrateCount: 'days', slow: 'other', spin: 'other', note: 'log', logAppend: 'log', logList: 'log', logRead: 'log', logRemove: 'log', logClear: 'log', logAllGz: 'export', estimate: 'days' };

export class HistoryStore {
  /** opts: { log(msg), forceMemory, backend (tests), makeWorker (tests), timeouts (tests: {op: ms}) } */
  constructor(opts = {}) {
    this.log = opts.log || (() => {}); this.backend = 'none'; this.b = null; this.persistent = null; this.stats = statsState();
    this.timeouts = opts.timeouts || {}; this.makeWorker = opts.makeWorker || null; this.lastFail = '';
    this.ready = opts.backend ? this.adopt(opts.backend, opts.backendName || 'test') : this.open(!!opts.forceMemory);
  }
  async adopt(b, name) { this.b = b; this.backend = name; return name; }
  async open(forceMemory) {
    if (!forceMemory && typeof Worker === 'function' && typeof navigator !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
      try {
        const wb = new WorkerBackend(this.log, this.makeWorker);
        const t0 = Date.now(); const r = await wb.call('ping', {}, this.timeoutFor('ping'));
        this.b = wb; this.backend = 'opfs'; this.log(`history: SQLite ${r.version} over ${r.vfs}, ${r.files} files, ${Date.now() - t0} ms to open`);
      } catch (e) { this.log('history: no SQLite store (' + (e && e.message) + '), keeping this session in memory only'); }
    }
    if (!this.b) { this.b = new MemoryBackend(); this.backend = 'memory'; }
    return this.backend;
  }
  timeoutFor(op) { return this.timeouts[op] || opTimeoutMs(KIND[op] || 'other'); }
  /** One store call: deadline, statistics, a log line on a failure or a timeout, a worker restart when stuck. */
  async call(op, args = {}, n = 0) {
    await this.ready; if (this.reopening) await this.reopening;               // a fresh worker is taking the pool: calls wait for it (bounded by the ping deadline)
    const kind = KIND[op] || 'other', t0 = Date.now();
    try {
      const r = this.b instanceof WorkerBackend ? await this.b.call(op, args, this.timeoutFor(op)) : await this.b[op](args);
      statsAdd(this.stats, kind, Date.now() - t0, 'ok', n);
      return r;
    } catch (e) {
      const timeout = e && e.name === 'TimeoutError';
      statsAdd(this.stats, kind, Date.now() - t0, timeout ? 'timeout' : 'fail', n);
      const key = `${op}:${timeout ? 'timeout' : e && e.message}`;               // the same failure again and again is logged once (a full disk every 10 s)
      if (key !== this.lastFail || timeout) this.log(`history: ${op} ${timeout ? 'TIMED OUT' : 'failed'} after ${Date.now() - t0} ms${timeout ? '' : `: ${e && e.message}`}`);
      this.lastFail = key;
      if (timeout && this.b instanceof WorkerBackend && stuckDecision(this.stats).action === 'restart') {
        this.stats.restarts++; this.stats.timeoutsInRow = 0;
        this.log(`history: ${this.stats.timeouts} timeouts, the worker looks stuck: restarting it (restart ${this.stats.restarts})`);
        this.reopen();
      }
      throw e;
    }
  }
  /** Kill the stuck worker, start a fresh one and ping it; every call waits for that ping (`reopening`). The fresh
   *  worker retries the pool for a while, so the ping deadline bounds the wait; a ping that fails or times out
   *  means the pool is lost for this page and the store goes memory-only. */
  reopen() {
    this.b.restart(); const wb = this.b, t0 = Date.now();
    this.reopening = (async () => {
      try { const r = await wb.call('ping', {}, this.timeoutFor('ping')); this.log(`history: fresh worker answers, SQLite over ${r.vfs}, ${r.files} files, ${Date.now() - t0} ms`); }
      catch (e) { if (this.b === wb) this.lockOut(Date.now() - t0, e); }
      finally { this.reopening = null; }
    })();
  }
  /** The fresh worker could not take the pool: a worker killed while it was busy keeps its access handles until
   *  the page is reloaded (Chrome, probed 2026-09-24). The session goes memory-only rather than failing every call. */
  lockOut(ms, e) {
    try { this.b.stop(); } catch { /* gone */ }
    this.b = new MemoryBackend(); this.backend = 'memory'; this.stats.lockouts = (this.stats.lockouts || 0) + 1;
    const why = e && e.name === 'TimeoutError' ? 'no answer' : POOL_LOCKED_RX.test(String(e && e.message)) ? 'a killed worker keeps its files open' : String(e && e.message);
    this.log(`history: the storage pool stayed locked ${Math.round(ms / 1000)} s after the worker restart (${why}): readings are kept in memory only - reload the page to store again`);
    if (this.onBackend) { try { this.onBackend(this.backend); } catch { /* ui */ } }
  }
  statsLine() { return statsLine(this.stats); }
  statsReset(now = Date.now()) { statsReset(this.stats, now); }
  /** Ask the browser not to evict the files under storage pressure; Chrome grants it silently for an engaged site. */
  async persist() {
    if (this.persistent !== null) return this.persistent;
    try { this.persistent = typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist ? !!(await navigator.storage.persist()) : false; } catch { this.persistent = false; }
    return this.persistent;
  }
  // ---- day databases ----
  insert(day, rows) { return this.call('insert', { day, rows }, rows.length); }
  async days() { return (await this.call('days')).days; }
  info(day) { return this.call('info', { day }); }
  async rows(day, after = 0, limit = 5000) { const r = await this.call('rows', { day, after, limit }); this.stats.ops.rows.rows += r.rows.length; return r.rows; }
  async last(day, p, n = 1) { return (await this.call('last', { day, p, n })).rows; }
  query({ p, from, to, stepMs, days }) { return this.call('query', { p, from, to, stepMs, days: days || daysInRange(from, to) }); }
  span(p, since = 0, days) { return this.call('span', { p, since, days }); }
  remove(day) { return this.call('remove', { day }); }
  clear() { return this.call('clear'); }
  async exportDay(day) { const r = await this.call('export', { day }); if (r.bytes) this.stats.ops.export.rows += r.bytes.length; return r.bytes; }
  importDay(day, bytes) { return this.call('import', { day, bytes }, bytes.length); }
  migrate() { return this.call('migrate'); }
  migrateCount() { return this.call('migrateCount'); }
  /** Hand the pool back (pagehide): the worker is stopped, which releases its access handles; the next call starts
   *  a new one. Not SQLite's pauseVfs(): pausing the VFS while the page went into the back/forward cache crashed
   *  the renderer in the sandbox (2026-09-24). */
  release() { if (this.b instanceof WorkerBackend) { this.b.stop(); this.log('history: worker stopped for the page hide (a fresh one starts on the next call)'); } }
  estimate() { return this.call('estimate'); }
  slow(ms) { return this.call('slow', { ms }); }
  spin(ms) { return this.call('spin', { ms }); }
  note(name, line) { return this.call('note', { name, text: line + '\n' }); }
  // ---- the debug log's files ----
  logAppend(name, text) { return this.call('logAppend', { name, text }, text.length); }
  async logList() { return (await this.call('logList')).files; }
  async logRead(name) { return (await this.call('logRead', { name })).text; }
  logRemove(name) { return this.call('logRemove', { name }); }
  logClear() { return this.call('logClear'); }
  async logAllGz() { return (await this.call('logAllGz')).files; }
}
export { MemoryBackend, WorkerBackend };
