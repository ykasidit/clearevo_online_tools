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
/** Length of a raw file up to its last newline: a torn tail is never read, gzipped or sent. */
function cleanLen(bytes) { for (let i = bytes.length - 1; i >= 0; i--) if (bytes[i] === 10) return i + 1; return 0; }
const clean = (bytes) => (bytes === null ? null : bytes.subarray(0, cleanLen(bytes)));
const DAY_RX = /^(\d{4}-\d{2}-\d{2})\.ndjson(\.gz)?$/;
async function remove(d, name) { try { await d.removeEntry(name); return true; } catch (e) { if (e && e.name === 'NotFoundError') return false; throw e; } }

const ops = {
  async ping() { await dir(); return { ok: true }; },
  /** Append text (lines end with \n) to the day's raw file. A torn tail from an earlier crash is closed with a
   *  newline first, so the new rows never join a half-written one; the returned size is always at a line end. */
  async append({ day, text }) {
    const d = await dir();
    const fh = await d.getFileHandle(rawName(day), { create: true });
    const h = await fh.createSyncAccessHandle();
    try {
      let size = h.getSize();
      if (size > 0) { const last = new Uint8Array(1); h.read(last, { at: size - 1 }); if (last[0] !== 10) { h.write(enc.encode('\n'), { at: size }); size += 1; } }
      const bytes = enc.encode(text); h.write(bytes, { at: size }); h.flush();
      return { bytes: size + bytes.length };
    } finally { h.close(); }
  },
  /** Close a torn tail (a crash mid write) with a newline and report the raw file's size and row count, so row
   *  numbers and offsets continue exactly from the file. */
  async seal({ day }) {
    const d = await dir();
    let b = await fileBytes(d, rawName(day)); if (b === null) return { bytes: 0, rows: 0 };
    if (b.length && b[b.length - 1] !== 10) { const fh = await d.getFileHandle(rawName(day)); const h = await fh.createSyncAccessHandle(); try { h.write(enc.encode('\n'), { at: b.length }); h.flush(); } finally { h.close(); } b = await fileBytes(d, rawName(day)); }
    let rows = 0; for (const x of b) if (x === 10) rows++;
    return { bytes: b.length, rows };
  },
  /** Append a received tail of today's file exactly at `at`: the file must end there, or the copy has moved. */
  async appendAt({ day, text, at }) {
    const d = await dir(); const fh = await d.getFileHandle(rawName(day), { create: true }); const h = await fh.createSyncAccessHandle();
    try {
      const size = h.getSize(); if (size !== at) throw new Error(`offset moved: file is ${size} B, tail starts at ${at}`);
      const bytes = enc.encode(text); h.write(bytes, { at }); h.flush(); return { bytes: at + bytes.length };
    } finally { h.close(); }
  },
  /** Append to a side file (devices.ndjson: the remembered BMS ids and names). */
  async note({ name, text }) {
    if (!/^[a-z]+\.ndjson$/.test(name)) throw new Error('bad note name');
    const d = await dir(); const fh = await d.getFileHandle(name, { create: true }); const h = await fh.createSyncAccessHandle();
    try { const size = h.getSize(); h.write(enc.encode(text), { at: size }); h.flush(); return { bytes: size + text.length }; } finally { h.close(); }
  },
  /** Every day file: [{day, raw, gz, bytes}] sorted by day. */
  async list() {
    const d = await dir(); const byDay = new Map();
    for await (const [name, handle] of d.entries()) {
      const m = DAY_RX.exec(name); if (!m || handle.kind !== 'file') continue;
      const size = (await handle.getFile()).size;
      const e = byDay.get(m[1]) || { day: m[1], raw: false, gz: false, bytes: 0 };
      if (m[2]) e.gz = true; else e.raw = true;
      e.bytes += size; byDay.set(m[1], e);
    }
    return { days: [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)) };
  },
  /** The day's text: the gz part (if any) followed by the raw part, each cut at its last newline. With `tail`
   *  only the last `tail` bytes (from the first whole line in them) are returned: a day at 4 rows/s is 88 MB
   *  and parsing all of it crashed a phone. `total` is the day's clean byte count, `cut` says a prefix was left. */
  async read({ day, tail = 0 }) {
    const d = await dir();
    const raw = clean(await fileBytes(d, rawName(day)));
    const g = await fileBytes(d, gzName(day));
    let parts = []; if (g !== null) parts.push(clean(await gunzip(g))); if (raw !== null) parts.push(raw);
    const total = parts.reduce((n, b) => n + b.length, 0);
    let cut = false;
    if (tail > 0 && total > tail) {
      cut = true; let keep = tail; const kept = [];
      for (let i = parts.length - 1; i >= 0 && keep > 0; i--) { const b = parts[i]; const piece = b.length > keep ? b.subarray(b.length - keep) : b; kept.unshift(piece); keep -= piece.length; }
      parts = kept;
      const first = parts[0]; let nl = -1; for (let i = 0; i < first.length; i++) if (first[i] === 10) { nl = i; break; }
      parts[0] = nl >= 0 ? first.subarray(nl + 1) : first.subarray(first.length);       // start at a whole line
    }
    return { text: parts.map((b) => dec.decode(b)).join(''), total, cut };
  },
  /** The day as one gzip: a past day's file as is; a day still raw (today) gzipped from its clean prefix. */
  async readGz({ day, from = 0 }) {
    const d = await dir();
    const raw = clean(await fileBytes(d, rawName(day)));
    const g = await fileBytes(d, gzName(day));
    if (raw === null || raw.length === 0) return { bytes: g, gz: g !== null, rawBytes: 0, from: 0 };
    if (g === null && from > 0) { if (from > raw.length) return { bytes: null, gz: false, rawBytes: raw.length, from }; const tail = raw.subarray(from); return { bytes: tail.length ? await gzip(tail) : null, gz: false, rawBytes: raw.length, from }; }
    let all = raw;
    if (g) { const gg = clean(await gunzip(g)); all = new Uint8Array(gg.length + raw.length); all.set(gg); all.set(raw, gg.length); }   // never spread a day into arguments: 88 MB threw
    return { bytes: await gzip(all), gz: g !== null, rawBytes: raw.length, from: 0 };
  },
  /** Gzip a past day's raw file into <day>.ndjson.gz and remove the raw one. */
  async compact({ day }) {
    const d = await dir();
    const raw = clean(await fileBytes(d, rawName(day))); if (raw === null) return { done: false };
    const old = await fileBytes(d, gzName(day));
    const all = old ? new Uint8Array([...clean(await gunzip(old)), ...raw]) : raw;   // a day compacted twice (clock jumped back, a restore) keeps both parts
    const gz = await gzip(all);
    await writeBytes(d, gzName(day), gz);
    await remove(d, rawName(day));
    return { done: true, from: all.length, to: gz.length };
  },
  /** Store a gzipped day received from the reader or a backup: verified by inflating and parsing it first.
   *  `asRaw` (today's file on a viewer) replaces the raw file with the inflated rows instead. */
  async writeGz({ day, bytes, asRaw }) {
    const inflated = await gunzip(bytes);
    const text = dec.decode(clean(inflated));
    let rows = 0; for (const line of text.split('\n')) { if (!line) continue; try { const r = JSON.parse(line); if (r && typeof r.t === 'number') rows++; } catch { /* torn */ } }
    if (!rows) throw new Error('no rows in ' + day);
    const d = await dir();
    let lastN = null; if (asRaw) { for (const line of text.trimEnd().split('\n').reverse()) { try { const r = JSON.parse(line); if (typeof r.n === 'number') { lastN = r.n; break; } } catch { /* torn */ } } }
    if (asRaw) { await writeBytes(d, rawName(day), enc.encode(text)); await remove(d, gzName(day)); }
    else { await writeBytes(d, gzName(day), bytes); await remove(d, rawName(day)); }
    return { rows, lastN, bytes: asRaw ? enc.encode(text).length : bytes.length };
  },
  /** A gzipped tail of today's file from the reader, appended exactly at `at` after inflating and checking it. */
  async appendGzAt({ day, bytes, at }) {
    const text = dec.decode(clean(await gunzip(bytes)));
    let rows = 0, lastN = null; for (const line of text.split('\n')) { if (!line) continue; try { const r = JSON.parse(line); if (r && typeof r.t === 'number') { rows++; if (typeof r.n === 'number') lastN = r.n; } } catch { /* torn */ } }
    if (!rows) throw new Error('no rows in the tail of ' + day);
    const r = await ops.appendAt({ day, text, at });
    return { rows, lastN, bytes: r.bytes };
  },
  /** Every day as {day, bytes (gzip)} for a backup; today gzipped from its clean prefix. */
  async readAllGz() {
    const { days } = await ops.list(); const out = [];
    for (const day of days) { const r = await ops.readGz({ day: day.day }); if (r.bytes) out.push({ day: day.day, bytes: r.bytes }); }
    return { files: out };
  },
  async remove({ day }) { const d = await dir(); const a = await remove(d, rawName(day)), b = await remove(d, gzName(day)); return { removed: a || b }; },
  async clear() { const d = await dir(); let n = 0; for await (const [name, h] of d.entries()) { if (h.kind !== 'file') continue; await d.removeEntry(name); n++; } return { removed: n }; },   // the logs/ folder stays
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
