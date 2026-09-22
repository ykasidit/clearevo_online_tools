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
export const GAP_REQ_MS = 5000;                 // ... and this soon after a live row shows a hole in its copy of today's file
export const REPLICA_GIVE_UP = 3;               // 'behind' resyncs of the same day before the viewer keeps that day in memory only
export const HOLD_MAX = 300;                    // live rows a viewer holds for a tail that has not come; beyond that they are memory only
export const GAP_ASKS_MAX = 3;                  // unanswered 5 s gap requests before falling back to the 10 min rhythm (2026-09-22 log: 6507 held, asked every 5 s for 5 h)
export const MIN_ROW_MS = 3000;                 // one stored row per pack per poll period: a BMS that pushes frames every second is shown, not logged, faster
export const CHART_MAX_POINTS = 2000;
export const MEM_MS = RECENT_HOURS * 3600e3;          // rows kept in memory at full resolution; older days are read from their files
export const RANGES = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 86400e3, all: 0 };

export function historyState() {
  return { day: null, todayRows: 0, todayBytes: 0, pendBytes: 0, days: [], backend: 'none', persistent: null, range: '6h', usage: 0, quota: 0, reqAt: 0, wasLive: false, gapAsks: 0, xfer: null, rx: null, gap: null, behind: 0, replicaOff: null };
}

/** UTC calendar day of a time, YYYY-MM-DD (owner rule 2026-09-21: every stored date is GMT; only the drawing adds
 *  the browser's offset). A day file is the same day on the reader, its viewers and any later analysis. */
export function dayKey(tMs) { return new Date(tMs).toISOString().slice(0, 10); }
/** Start of a UTC day key, ms. */
export function dayStartMs(day) { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); }
const utf8 = new TextEncoder();
/** Bytes a row takes in the file: its JSON line plus the newline. */
export const lineBytes = (row) => utf8.encode(JSON.stringify(row)).length + 1;
/** Where the next stored row of today lands: its row number and its byte offset (file length at the last flush plus
 *  what is queued). Both travel inside the row, so a viewer's copy can say exactly how far it got and the log can
 *  show the file growing. */
export const nextPos = (hs) => ({ n: hs.todayRows + 1, o: hs.todayBytes + hs.pendBytes });
/** Store this reading? One row per pack per MIN_ROW_MS; the first ever is always due. */
export const rowDue = (lastT, t, minMs = MIN_ROW_MS) => lastT === null || lastT === undefined || t - lastT >= minMs;
const nz = (v) => (v === undefined || v === null || Number.isNaN(v) ? null : v);
/** One stored row from a decoded reading. Short keys: the file is written every 3 s for years. */
export function rowFromReading(label, d, t, pos = null) {
  return {
    t, n: pos ? pos.n : null, o: pos ? pos.o : null, p: label, soc: nz(d.soc), v: nz(d.packV), i: nz(d.current), w: nz(d.power), ah: nz(d.remainAh),
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
  const prev = hs.day; hs.day = nowDay; hs.todayRows = 0; hs.todayBytes = 0; hs.pendBytes = 0; hs.gap = null; hs.behind = 0;
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
    let item = null, cost = d.bytes || 0;
    if (d.day === today) {
      // today's file is a byte replica on the viewer: send from the offset it has, or the whole file when it has
      // more than this reader (a reset, or another reader's day) or when this day is not a plain raw file
      const replica = d.raw && !d.gz;
      const from = !replica || !h || h.bytes > d.bytes ? 0 : h.bytes;
      if (h && h.bytes === d.bytes && (replica || h.gz)) continue;
      item = { day: d.day, live: replica, from, replace: from === 0 }; cost = Math.max(0, (d.bytes || 0) - from);
    } else if (!d.gz) continue;                                          // a past day still raw is compacted first, then sent next time
    else if (h && h.gz && h.bytes === d.bytes) continue;
    else item = { day: d.day, live: false, from: 0, replace: true };
    if (total + cost > maxBytes && out.length) break;
    out.push(item); total += cost;
  }
  return out;
}
/** A live row on the viewer against its copy of today's file (an exact byte replica of the reader's):
 *  append when the row starts where the copy ends, hold on a hole (a dropped row: the tail is fetched from the
 *  reader), hold on a row behind the copy (this copy is not the reader's file any more: refetch the whole day). */
export function replicaDecision(hs, row, heldCount = 0) {
  if (row.o === null || row.o === undefined || row.n === null || row.n === undefined) return { action: 'mem' };
  if (hs.replicaOff === hs.day) return { action: 'mem', why: 'replica off for this day' };
  const expected = hs.todayBytes + hs.pendBytes;
  if (row.o === expected) return { action: 'append' };
  if (heldCount >= HOLD_MAX) return { action: 'mem', why: 'hold full', expected };   // the tail will bring these rows when the reader answers
  if (row.o > expected) { hs.gap = hs.gap || 'gap'; return { action: 'hold', why: 'gap', expected }; }
  hs.gap = 'behind';
  return { action: 'hold', why: 'behind', expected };
}
/** Held rows after the tail landed: the ones that now fit are appended in order, older ones are in the tail already. */
export function releaseHeld(hs, held) {
  const append = [], drop = [], keep = [];
  let pos = hs.todayBytes + hs.pendBytes;
  for (const row of [...held].sort((a, b) => a.o - b.o)) {
    if (row.o < pos) drop.push(row);
    else if (row.o === pos) { append.push(row); pos += lineBytes(row); }
    else keep.push(row);
  }
  return { append, drop, keep };
}
/** Should the viewer ask the reader for history now? When the link comes up, then every HIST_REQ_MS. */
export function histReqDecision(hs, { live, now, gap = false }) {
  if (!live) { hs.wasLive = false; return { action: 'noop' }; }
  const linkUp = !hs.wasLive; hs.wasLive = true;
  if (linkUp) { hs.reqAt = now; hs.gapAsks = 0; return { action: 'request', why: 'link up' }; }
  if (gap && hs.gapAsks < GAP_ASKS_MAX) {
    if (now - hs.reqAt < GAP_REQ_MS) return { action: 'noop' };
    hs.gapAsks++; hs.reqAt = now; return { action: 'request', why: 'gap' };
  }
  if (now - hs.reqAt < HIST_REQ_MS) return { action: 'noop' };
  hs.reqAt = now; return { action: 'request', why: 'periodic' };
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
  if (!hs.rx || hs.rx.day !== c.day || hs.rx.of !== c.of) hs.rx = { day: c.day, of: c.of, live: !!c.live, from: c.from || 0, replace: !!c.replace, parts: [] };
  if (c.n !== hs.rx.parts.length) { hs.rx = null; return null; }        // a lost chunk voids this file; the next request fetches it again
  hs.rx.parts.push(c.b64);
  if (hs.rx.parts.length < c.of) return null;
  const done = { day: hs.rx.day, live: hs.rx.live, from: hs.rx.from, replace: hs.rx.replace, b64: hs.rx.parts.join('') }; hs.rx = null;
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
