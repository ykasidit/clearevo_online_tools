// BatRay by ClearEvo.com - stored history pure decisions: rows, day files, rollover, retention, thinning, chart ranges (tested)
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
// Phase 3 of UI_GUIDELINES.md (owner decisions 2026-09-21): the reader
// appends one NDJSON row per reading to today's file, gzips the file at the
// day change, keeps as many days as the browser's storage allows (the
// oldest go when less than HEADROOM_BYTES stay free), sends a viewer the
// gzipped day files it asks for, and Parquet is a later, server side step. This module holds every decision; the history store module and its worker do
// the OPFS I/O; the app shell wires them. `historyState()` is the one object.

export const HISTORY_FLUSH_MS = 10000;          // rows are buffered and written together
export const HEADROOM_BYTES = 100 * 1048576;    // free space kept: a whole day of raw rows is under 10 MB, settings and the log a few KB
export const RECENT_HOURS = 24, RECENT_STEP_MS = 60000, RECENT_MAX_ROWS = 1500;
export const XFER_CHUNK = 12 * 1024;            // gz bytes per envelope (16 KB of base64 after encryption: well under any data channel limit)
export const XFER_MAX_BYTES = 40 * 1048576;     // per request, newest days first
export const XFER_BACKLOG = 128 * 1024;         // send the next chunk only when the channels have less queued than this
export const HIST_REQ_MS = 10 * 60e3;           // a viewer asks again this often (it asks at once when the link comes up)
export const CHART_MAX_POINTS = 2000;
export const MEM_MS = RECENT_HOURS * 3600e3;          // rows kept in memory at full resolution; older days are read from their files
export const RANGES = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 86400e3, all: 0 };

export function historyState() {
  return { day: null, todayRows: 0, todayBytes: 0, days: [], backend: 'none', persistent: null, range: '6h', usage: 0, quota: 0, reqAt: 0, xfer: null, rx: null };
}

/** Local calendar day of a time, YYYY-MM-DD (the reader's own clock: a day file is the phone's day). */
export function dayKey(tMs) {
  const d = new Date(tMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const nz = (v) => (v === undefined || v === null || Number.isNaN(v) ? null : v);
/** One stored row from a decoded reading. Short keys: the file is written every 3 s for years. */
export function rowFromReading(label, d, t) {
  return {
    t, p: label, soc: nz(d.soc), v: nz(d.packV), i: nz(d.current), w: nz(d.power), ah: nz(d.remainAh),
    tm: nz(d.tempMos), t1: nz(d.temp1), t2: nz(d.temp2), ch: d.chgMos === undefined ? null : (d.chgMos ? 1 : 0), ds: d.dsgMos === undefined ? null : (d.dsgMos ? 1 : 0),
    bal: d.balancing === undefined || d.balancing === null ? null : (d.balancing ? 1 : 0), err: nz(d.errors),
    c: Array.isArray(d.cells) ? d.cells.map((c) => Math.round(c.v * 1000)) : null,
  };
}
export const rowLine = (row) => JSON.stringify(row);
/** Rows from a file's text; a torn last line (power cut mid-write) is skipped, never fatal. */
export function parseLines(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r && typeof r.t === 'number') out.push(r); } catch { /* torn line */ }
  }
  return out;
}

/** The day changed (or the first row of the run): what to do with the previous day's file. */
export function rolloverDecision(hs, nowDay) {
  if (hs.day === nowDay) return { action: 'noop' };
  const prev = hs.day; hs.day = nowDay; hs.todayRows = 0;
  return prev ? { action: 'compact', day: prev } : { action: 'start', day: nowDay };
}
/** From a listing of day files, what to compact (raw files of past days) and what to delete: the oldest past
 *  days, until the browser's free space is at least `headroom` (no day limit, owner decision 2026-09-21). */
export function retentionDecision(days, today, { usage = 0, quota = 0, headroom = HEADROOM_BYTES } = {}) {
  const del = [], compact = [];
  const past = days.filter((d) => d.day < today).sort((x, y) => (x.day < y.day ? -1 : 1));
  let free = quota > 0 ? quota - usage : Infinity;
  for (const d of past) { if (free >= headroom) break; del.push(d); free += d.bytes || 0; }
  const gone = new Set(del.map((d) => d.day));
  for (const d of past) if (!gone.has(d.day) && d.raw && !d.gz) compact.push(d.day);
  return { delete: del, compact: [...new Set(compact)] };
}
/** The write hit the quota: drop the oldest past day and try again, once per day file. */
export function quotaDecision(days, today) {
  const past = days.filter((d) => d.day < today).sort((x, y) => (x.day < y.day ? -1 : 1));
  return past.length ? { action: 'delete', day: past[0].day } : { action: 'give-up' };
}
export function historySummary(days, todayRows, { usage = 0, quota = 0, headroom = HEADROOM_BYTES, today = null } = {}) {
  const bytes = days.reduce((a, d) => a + (d.bytes || 0), 0);
  const keys = days.map((d) => d.day).sort();
  const gz = days.filter((d) => d.gz && d.day !== today);
  // bytes a stored day costs: the average compacted day, else today's raw file so far (compresses ~8x), else a guess
  const perDay = gz.length ? gz.reduce((a, d) => a + d.bytes, 0) / gz.length : (bytes ? Math.max(bytes / 8, 1) : 1048576);
  const room = quota > 0 ? Math.max(0, quota - headroom - usage) : null;
  const estDays = room === null ? null : new Set(keys).size + Math.floor(room / perDay);
  return { days: new Set(keys).size, bytes, oldest: keys[0] || null, newest: keys[keys.length - 1] || null, todayRows, usage, quota, free: quota > 0 ? Math.max(0, quota - usage) : null, perDay, estDays, headroom };
}
/** Bytes of a raw NDJSON file up to and including its last newline: a torn tail (power cut mid write) is never read, gzipped or sent. */
export function cleanLen(bytes) {
  for (let i = bytes.length - 1; i >= 0; i--) if (bytes[i] === 10) return i + 1;
  return 0;
}

/** Thin rows to at most maxRows, at least stepMs apart, keeping the newest; cells dropped (they are for the file, not the wire). */
export function recentSlice(rows, since, stepMs = RECENT_STEP_MS, maxRows = RECENT_MAX_ROWS) {
  // Walk from the newest row backwards so the latest reading is always in the slice.
  const out = []; let lastT = Infinity;
  for (let i = rows.length - 1; i >= 0 && out.length < maxRows; i--) {
    const r = rows[i];
    if (r.t < since) break;
    if (lastT - r.t < stepMs) continue;
    lastT = r.t; const { c, ...rest } = r; out.push(rest);
  }
  return out.reverse();
}
/** What a viewer should be sent, newest first: the compacted days it lacks (or has a different size of) and today's
 *  file when the reader has more of it; capped at maxBytes. `have` = the viewer's own listing. */
export function transferPlan(readerDays, have, today, maxBytes = XFER_MAX_BYTES) {
  const mine = new Map((have || []).map((d) => [d.day, d]));
  const out = []; let total = 0;
  for (const d of [...readerDays].sort((x, y) => (x.day < y.day ? 1 : -1))) {
    const h = mine.get(d.day);
    if (d.day === today) { if (h && h.bytes >= d.bytes) continue; }
    else if (!d.gz) continue;                                             // a past day still raw is compacted first, then sent next time
    else if (h && h.gz && h.bytes === d.bytes) continue;
    if (total + (d.bytes || 0) > maxBytes && out.length) break;
    out.push({ day: d.day, live: d.day === today }); total += d.bytes || 0;
  }
  return out;
}
/** Should the viewer ask the reader for history now? When the link comes up, then every HIST_REQ_MS. */
export function histReqDecision(hs, { live, now }) {
  if (!live) { hs.reqAt = 0; return { action: 'noop' }; }
  if (hs.reqAt && now - hs.reqAt < HIST_REQ_MS) return { action: 'noop' };
  hs.reqAt = now; return { action: 'request' };
}
/** Base64 chunks of a file for the wire. */
export function chunkB64(b64, size = Math.ceil(XFER_CHUNK * 4 / 3)) {
  const out = [];
  for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size));
  return out;
}
/** The viewer's side of a chunk: assemble one day at a time; returns the finished file or null. */
export function rxChunk(hs, env) {
  const c = env.v || {};
  if (!c.day || typeof c.n !== 'number' || typeof c.of !== 'number' || typeof c.b64 !== 'string') return null;
  if (!hs.rx || hs.rx.day !== c.day || hs.rx.of !== c.of) hs.rx = { day: c.day, of: c.of, live: !!c.live, parts: [] };
  if (c.n !== hs.rx.parts.length) { hs.rx = null; return null; }        // a lost chunk voids this file; the next request fetches it again
  hs.rx.parts.push(c.b64);
  if (hs.rx.parts.length < c.of) return null;
  const done = { day: hs.rx.day, live: hs.rx.live, b64: hs.rx.parts.join('') }; hs.rx = null;
  return done;
}
/** Merge incoming rows into an existing sorted array; a row with the same t and pack replaces the old one. */
export function mergeRows(existing, incoming) {
  const map = new Map();
  for (const r of existing) map.set(`${r.p}|${r.t}`, r);
  for (const r of incoming) map.set(`${r.p}|${r.t}`, r);
  return [...map.values()].sort((a, b) => a.t - b.t);
}

/** Largest-triangle-three-buckets on `key`, returning the kept rows (peaks survive, 2000 points draw fast on a phone). */
export function downsample(rows, maxN = CHART_MAX_POINTS, key = 'w') {
  const n = rows.length;
  if (n <= maxN || maxN < 3) return rows;
  const y = (r) => (r[key] === null || r[key] === undefined ? 0 : r[key]);
  const out = [rows[0]]; const every = (n - 2) / (maxN - 2); let a = 0;
  for (let i = 0; i < maxN - 2; i++) {
    const rs = Math.floor((i + 1) * every) + 1, re = Math.min(Math.floor((i + 2) * every) + 1, n);
    let ax = 0, ay = 0; for (let j = rs; j < re; j++) { ax += rows[j].t; ay += y(rows[j]); }
    const cnt = Math.max(1, re - rs); ax /= cnt; ay /= cnt;
    const s = Math.floor(i * every) + 1, e = Math.min(Math.floor((i + 1) * every) + 1, n);
    let best = -1, bi = s;
    for (let j = s; j < e; j++) { const area = Math.abs((rows[a].t - ax) * (y(rows[j]) - y(rows[a])) - (rows[a].t - rows[j].t) * (ay - y(rows[a]))); if (area > best) { best = area; bi = j; } }
    out.push(rows[bi]); a = bi;
  }
  out.push(rows[n - 1]);
  return out;
}
/** The visible time window for a range button. */
export function chartRange(rows, rangeKey, nowMs) {
  const span = RANGES[rangeKey] === undefined ? RANGES['6h'] : RANGES[rangeKey];
  const to = nowMs;
  const from = span ? to - span : (rows.length ? rows[0].t : to - 3600e3);
  return { from, to };
}
/** uPlot columns from rows: seconds, power (W), charge part (>= 0), discharge part (<= 0), battery (%), voltage (V). */
export function chartSeries(rows) {
  const t = [], w = [], wc = [], wd = [], soc = [], v = [];
  for (const r of rows) {
    const p = r.w === undefined ? null : r.w;
    t.push(r.t / 1000); w.push(p); wc.push(p === null ? null : Math.max(0, p)); wd.push(p === null ? null : Math.min(0, p)); soc.push(r.soc === undefined ? null : r.soc); v.push(r.v === undefined ? null : r.v);
  }
  return { t, w, wc, wd, soc, v };
}
/** Rows with from <= t <= to (rows sorted by t). */
export function rowsBetween(rows, from, to) {
  let a = 0, b = rows.length;
  while (a < b && rows[a].t < from) a++;
  while (b > a && rows[b - 1].t > to) b--;
  return rows.slice(a, b);
}
/** Time covered by rows, ms. */
export const spanMs = (rows) => (rows.length < 2 ? 0 : rows[rows.length - 1].t - rows[0].t);
/** Drop rows older than MEM_MS from the in-memory set (the files keep them). */
export function trimRows(rows, now, keepMs = MEM_MS) {
  let i = 0; while (i < rows.length && rows[i].t < now - keepMs) i++;
  return i ? rows.slice(i) : rows;
}
/** Past days whose files the chart needs for a range (today's rows are in memory). */
export function daysNeeded(days, from, today) {
  const fromDay = dayKey(from);
  return days.map((d) => d.day).filter((d) => d >= fromDay && d < today);
}
/** Energy in Wh over rows (trapezoid, gaps over 60 s skipped like the session trend). */
export function energyWh(rows) {
  let charged = 0, discharged = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.w === null || b.w === null || a.w === undefined || b.w === undefined) continue;
    const dtS = (b.t - a.t) / 1000; if (dtS <= 0 || dtS > 60) continue;
    const wh = (a.w + b.w) / 2 * dtS / 3600; if (wh > 0) charged += wh; else discharged -= wh;
  }
  return { charged, discharged };
}
