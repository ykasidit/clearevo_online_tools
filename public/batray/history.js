// BatRay by ClearEvo.com - stored history I/O shell: the OPFS worker, with an in-memory fallback
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
// The history logic module decides, this module only stores. HistoryStore
// speaks to the history worker over postMessage; when the browser has no OPFS (or the
// worker fails) the same calls work on an in-memory map, so the History tab
// still draws this session and the page says "not stored".

const WORKER_URL = 'history-worker.js';

class MemoryBackend {
  constructor() { this.files = new Map(); }        // day -> { raw: string, gz: string|null }
  async ping() { return { ok: true }; }
  async append({ day, text }) { const f = this.files.get(day) || { raw: '', gz: null }; f.raw += text; this.files.set(day, f); return { bytes: f.raw.length }; }
  async list() { return { days: [...this.files.entries()].map(([day, f]) => ({ day, raw: f.raw !== '', gz: f.gz !== null, bytes: f.raw.length + (f.gz ? f.gz.length : 0) })).sort((a, b) => (a.day < b.day ? -1 : 1)) }; }
  async read({ day }) { const f = this.files.get(day); return { text: f ? (f.gz || '') + f.raw : '' }; }
  async compact({ day }) { const f = this.files.get(day); if (!f || f.raw === '') return { done: false }; f.gz = (f.gz || '') + f.raw; f.raw = ''; return { done: true, from: f.gz.length, to: f.gz.length }; }
  async remove({ day }) { return { removed: this.files.delete(day) }; }
  async clear() { const n = this.files.size; this.files.clear(); return { removed: n }; }
  async estimate() { return { usage: 0, quota: 0 }; }
}

class WorkerBackend {
  constructor(log) {
    this.log = log; this.seq = 0; this.waiting = new Map();
    this.w = new Worker(WORKER_URL);
    this.w.onmessage = (ev) => { const m = ev.data; const p = this.waiting.get(m.id); if (!p) return; this.waiting.delete(m.id); m.ok ? p.res(m.r) : p.rej(Object.assign(new Error(m.error), { name: m.name || 'Error' })); };
    this.w.onerror = (e) => { this.log('history: worker error ' + (e.message || e)); for (const p of this.waiting.values()) p.rej(new Error('worker failed')); this.waiting.clear(); };
  }
  call(op, args) { return new Promise((res, rej) => { const id = ++this.seq; this.waiting.set(id, { res, rej }); this.w.postMessage({ id, op, args }); }); }
}
for (const op of ['ping', 'append', 'list', 'read', 'compact', 'remove', 'clear', 'estimate']) WorkerBackend.prototype[op] = function (args) { return this.call(op, args); };

export class HistoryStore {
  /** opts: { log(msg), forceMemory } */
  constructor(opts = {}) {
    this.log = opts.log || (() => {}); this.backend = 'none'; this.b = null; this.persistent = null;
    this.ready = this.open(!!opts.forceMemory);
  }
  async open(forceMemory) {
    if (!forceMemory && typeof Worker === 'function' && navigator.storage && navigator.storage.getDirectory) {
      try {
        const wb = new WorkerBackend(this.log);
        await Promise.race([wb.ping(), new Promise((_, rej) => setTimeout(() => rej(new Error('worker timeout')), 8000))]);
        this.b = wb; this.backend = 'opfs';
      } catch (e) { this.log('history: no OPFS (' + (e && e.message) + '), keeping this session in memory only'); }
    }
    if (!this.b) { this.b = new MemoryBackend(); this.backend = 'memory'; }
    return this.backend;
  }
  /** Ask the browser not to evict the files under storage pressure; Chrome grants it silently for an installed / engaged site. */
  async persist() {
    if (this.persistent !== null) return this.persistent;
    try { this.persistent = navigator.storage && navigator.storage.persist ? !!(await navigator.storage.persist()) : false; } catch { this.persistent = false; }
    return this.persistent;
  }
  async append(day, lines) { await this.ready; return this.b.append({ day, text: lines.join('\n') + '\n' }); }
  async list() { await this.ready; return (await this.b.list()).days; }
  async read(day) { await this.ready; return (await this.b.read({ day })).text; }
  async compact(day) { await this.ready; return this.b.compact({ day }); }
  async remove(day) { await this.ready; return this.b.remove({ day }); }
  async clear() { await this.ready; return this.b.clear(); }
  async estimate() { await this.ready; return this.b.estimate(); }
}
