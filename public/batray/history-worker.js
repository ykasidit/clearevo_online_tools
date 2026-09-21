// BatRay by ClearEvo.com - stored history worker: OPFS day files (append, list, read, gzip compact, delete)
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
// Runs as a dedicated worker because OPFS sync access handles (fast appends
// that survive a killed tab) exist only there. Files live in the origin's
// private directory batray-history/ as <YYYY-MM-DD>.ndjson while the day is
// being written and <YYYY-MM-DD>.ndjson.gz once compacted. Nothing here
// decides anything: the page's history logic module does, this only does I/O.

const DIR = 'batray-history';
const enc = new TextEncoder(), dec = new TextDecoder();
let dirP = null;
function dir() { return dirP || (dirP = navigator.storage.getDirectory().then((root) => root.getDirectoryHandle(DIR, { create: true }))); }
const rawName = (day) => day + '.ndjson', gzName = (day) => day + '.ndjson.gz';

async function fileBytes(d, name) {
  try { const fh = await d.getFileHandle(name); const f = await fh.getFile(); return new Uint8Array(await f.arrayBuffer()); } catch (e) { if (e && e.name === 'NotFoundError') return null; throw e; }
}
async function writeBytes(d, name, bytes) {
  const fh = await d.getFileHandle(name, { create: true });
  const h = await fh.createSyncAccessHandle();
  try { h.truncate(0); h.write(bytes, { at: 0 }); h.flush(); } finally { h.close(); }
}
async function gzip(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()); }
async function gunzip(bytes) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }
async function remove(d, name) { try { await d.removeEntry(name); return true; } catch (e) { if (e && e.name === 'NotFoundError') return false; throw e; } }

const ops = {
  async ping() { await dir(); return { ok: true }; },
  /** Append text (lines already end with \n) to the day's raw file. */
  async append({ day, text }) {
    const d = await dir();
    const fh = await d.getFileHandle(rawName(day), { create: true });
    const h = await fh.createSyncAccessHandle();
    try { const size = h.getSize(); h.write(enc.encode(text), { at: size }); h.flush(); return { bytes: size + text.length }; } finally { h.close(); }
  },
  /** Every day file: [{day, raw, gz, bytes}] sorted by day. */
  async list() {
    const d = await dir(); const byDay = new Map();
    for await (const [name, handle] of d.entries()) {
      const m = /^(\d{4}-\d{2}-\d{2})\.ndjson(\.gz)?$/.exec(name); if (!m || handle.kind !== 'file') continue;
      const size = (await handle.getFile()).size;
      const e = byDay.get(m[1]) || { day: m[1], raw: false, gz: false, bytes: 0 };
      if (m[2]) e.gz = true; else e.raw = true;
      e.bytes += size; byDay.set(m[1], e);
    }
    return { days: [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)) };
  },
  /** The day's text: raw file first, else the gz inflated. */
  async read({ day }) {
    const d = await dir();
    let b = await fileBytes(d, rawName(day));
    if (b === null) { const g = await fileBytes(d, gzName(day)); if (g === null) return { text: '' }; b = await gunzip(g); }
    return { text: dec.decode(b) };
  },
  /** Gzip a past day's raw file into <day>.ndjson.gz and remove the raw one. */
  async compact({ day }) {
    const d = await dir();
    const raw = await fileBytes(d, rawName(day)); if (raw === null) return { done: false };
    const old = await fileBytes(d, gzName(day));
    const all = old ? new Uint8Array([...(await gunzip(old)), ...raw]) : raw;   // a day compacted twice (clock jumped back) keeps both parts
    const gz = await gzip(all);
    await writeBytes(d, gzName(day), gz);
    await remove(d, rawName(day));
    return { done: true, from: all.length, to: gz.length };
  },
  async remove({ day }) { const d = await dir(); const a = await remove(d, rawName(day)), b = await remove(d, gzName(day)); return { removed: a || b }; },
  async clear() { const d = await dir(); let n = 0; for await (const [name] of d.entries()) { await d.removeEntry(name); n++; } return { removed: n }; },
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
