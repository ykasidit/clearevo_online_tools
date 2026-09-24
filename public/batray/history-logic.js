// BatRay by ClearEvo.com - stored history decisions (pure, tested in node)
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
// The decisions of the stored history: which rows to keep, which day they
// belong to, how a viewer's copy follows the reader's ids, what to send, what
// to delete, how a chart window is bucketed, and the bookkeeping of every
// store call (timeouts, failures, read/write statistics). Storage is SQLite,
// one database per UTC day, the live day included (owner decision
// 2026-09-24); the SQL itself is in its own module and the worker does the
// I/O. `historyState()` is the one state object the app owns.

export const HISTORY_FLUSH_MS = 10000;          // rows are buffered and inserted together (one transaction)
export const HEADROOM_BYTES = 100 * 1048576;    // free space kept: a day of two packs is ~7 MB, settings and the log a few KB
export const XFER_CHUNK = 12 * 1024;            // gz bytes per envelope (16 KB of base64 after encryption: well under any data channel limit)
export const XFER_ROWS = 2000;                  // rows per transfer file (a viewer gets a day in a few files, each verified on its own)
export const XFER_MAX_ROWS = 200000;            // per request, newest days first
export const XFER_BACKLOG = 128 * 1024;         // send the next chunk only when the channels have less queued than this
export const HIST_REQ_MS = 10 * 60e3;           // a viewer asks again this often (it asks at once when the link comes up)
export const GAP_REQ_MS = 5000;                 // ... and this soon after a live row shows a hole in its copy of today
export const GAP_ASKS_MAX = 3;                  // unanswered 5 s gap requests before falling back to the 10 min rhythm (2026-09-22 log: asked every 5 s for 5 h)
export const MIN_ROW_MS = 3000;                 // one stored row per pack per 3 s: a BMS that pushes frames every second is shown, not logged, faster
export const CHART_MAX_POINTS = 800;            // buckets per chart window (a phone screen is narrower than that)
export const RANGES = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 86400e3, all: 0 };
export const TREND_REFRESH_MS = 10000;          // a live chart is re-queried this often (right after the flush)
// Every store call has a deadline (owner rule 2026-09-24: "no block forever"): a stuck worker or a stuck
// OPFS handle must never freeze the page. The store rejects at the deadline, logs it, and after
// STUCK_RESTART timeouts in a row restarts the worker.
export const OP_TIMEOUT_MS = { ping: 25000, insert: 8000, query: 15000, rows: 15000, days: 8000, remove: 15000, clear: 30000, export: 60000, import: 60000, migrate: 180000, log: 8000, other: 15000 };
export const STUCK_RESTART = 3;
export const STATS_LOG_MS = 60000;              // the read/write statistics line

export function historyState() {
  return {
    day: null, todayRows: 0, nextId: 1, contig: 0, days: [], backend: 'none', persistent: null, range: '6h', usage: 0, quota: 0,
    reqAt: 0, wasLive: false, gapAsks: 0, xfer: null, rx: null, gap: null, migrated: null, spanFirst: null, spanLast: null,
  };
}

/** UTC calendar day of a time, YYYY-MM-DD (owner rule 2026-09-21: every stored date is GMT; only the drawing adds
 *  the browser's offset). A day database is the same day on the reader, its viewers and any later analysis. */
export function dayKey(tMs) { return new Date(tMs).toISOString().slice(0, 10); }
/** Start of a UTC day key in ms. */
export function dayStartMs(dayKeyStr) { const [y, m, d] = dayKeyStr.split('-').map(Number); return Date.UTC(y, m - 1, d); }
/** Which UTC days a window touches, oldest first. */
export function daysInRange(from, to) {
  const out = []; let t = dayStartMs(dayKey(from)); const end = dayStartMs(dayKey(to));
  while (t <= end) { out.push(dayKey(t)); t += 86400e3; }
  return out;
}

/** Is it time to store another row of this pack? (one per MIN_ROW_MS; the meters still paint every frame) */
export function rowDue(lastRowAt, t, minMs = MIN_ROW_MS) { return !lastRowAt || t - lastRowAt >= minMs; }

const nz = (x) => (x === undefined || x === null || Number.isNaN(x) ? null : x);
/** One reading -> one row. Short keys, cells as millivolts. The id is given by the reader when it queues the row. */
export function rowFromReading(label, d, t) {
  return {
    t, p: label, soc: nz(d.soc), v: nz(d.packV), i: nz(d.current), w: nz(d.power), ah: nz(d.remainAh),
    tm: nz(d.tempMos), t1: nz(d.temp1), t2: nz(d.temp2), ch: d.chgMos === undefined ? null : (d.chgMos ? 1 : 0), ds: d.dsgMos === undefined ? null : (d.dsgMos ? 1 : 0),
    bal: d.balancing === undefined || d.balancing === null ? null : (d.balancing ? 1 : 0), err: nz(d.errors),
    c: Array.isArray(d.cells) ? d.cells.map((c) => Math.round(c.v * 1000)) : null,
  };
}

/** Day change: the first row starts the day, a later row on a new day switches to it (ids restart at 1 in the
 *  new day's database), the same day is a noop. */
export function rolloverDecision(hs, nowDay) {
  if (hs.day === nowDay) return { action: 'noop' };
  const prev = hs.day; hs.day = nowDay; hs.todayRows = 0; hs.nextId = 1; hs.contig = 0; hs.gap = null;
  return prev ? { action: 'rollover', day: nowDay, prev } : { action: 'start', day: nowDay };
}

/** The reader hands out ids: dense per day, so a viewer's copy can tell a hole from the end. */
export function nextRowId(hs) { const id = hs.nextId; hs.nextId = id + 1; hs.todayRows++; return id; }

/** A live row on a viewer against its copy of today (ids are the reader's): 'append' when it is the next id (or
 *  a re-send of one already there), 'gap' when ids are missing before it (the row is stored anyway; the reader is
 *  asked for the rows after `contig`), 'old' when it is from a day that is not today. */
export function replicaDecision(hs, row, today) {
  if (typeof row.id !== 'number') return { action: 'mem', why: 'no id' };
  if (dayKey(row.t) !== today) return { action: 'old' };
  if (row.id <= hs.contig) return { action: 'append', dup: true };
  if (row.id === hs.contig + 1) { hs.contig = row.id; return { action: 'append' }; }
  return { action: 'gap', expected: hs.contig + 1, got: row.id };
}

/** From a listing of day databases, what to delete: the oldest past days, until the browser's free space is at
 *  least `headroom` (no day limit, owner decision 2026-09-21). */
export function retentionDecision(days, today, { usage = 0, quota = 0, headroom = HEADROOM_BYTES } = {}) {
  const del = [];
  const past = days.filter((d) => d.day < today).sort((x, y) => (x.day < y.day ? -1 : 1));
  let free = quota > 0 ? quota - usage : Infinity;
  for (const d of past) { if (free >= headroom) break; del.push(d); free += d.bytes || 0; }
  return { delete: del };
}
/** The write hit the quota: drop the oldest past day and try again, once per day. */
export function quotaDecision(days, today) {
  const past = days.filter((d) => d.day < today).sort((x, y) => (x.day < y.day ? -1 : 1));
  return past.length ? { action: 'delete', day: past[0].day } : { action: 'give-up' };
}
export function historySummary(days, todayRows, { usage = 0, quota = 0, headroom = HEADROOM_BYTES, today = null } = {}) {
  const bytes = days.reduce((a, d) => a + (d.bytes || 0), 0);
  const keys = days.map((d) => d.day).sort();
  const past = days.filter((d) => d.day !== today);
  // bytes a stored day costs: the average past day, else today's so far, else a guess (7 MB for two packs)
  const perDay = past.length ? past.reduce((a, d) => a + (d.bytes || 0), 0) / past.length : (bytes ? Math.max(bytes, 1) : 7 * 1048576);
  const room = quota > 0 ? Math.max(0, quota - headroom - usage) : null;
  const estDays = room === null ? null : new Set(keys).size + Math.floor(room / perDay);
  return { days: new Set(keys).size, bytes, oldest: keys[0] || null, newest: keys[keys.length - 1] || null, todayRows, usage, quota, free: quota > 0 ? Math.max(0, quota - usage) : null, perDay, estDays, headroom };
}

/** What a viewer should be sent, newest day first: for each day the rows after the id the viewer has (its `have`
 *  = [{day, maxId, contig}]; a day it lacks starts at 0; its contiguous prefix decides, so a hole is refilled).
 *  Capped at maxRows in total. */
export function transferPlan(readerDays, have, maxRows = XFER_MAX_ROWS) {
  const mine = new Map((have || []).map((d) => [d.day, d]));
  const out = []; let total = 0;
  for (const d of [...readerDays].sort((x, y) => (x.day < y.day ? 1 : -1))) {
    const h = mine.get(d.day);
    const after = h ? Math.max(0, Math.min(h.contig !== undefined && h.contig !== null ? h.contig : h.maxId || 0, d.maxId || 0)) : 0;
    const rows = Math.max(0, (d.maxId || 0) - after);
    if (!rows) continue;
    if (total + rows > maxRows && out.length) break;
    out.push({ day: d.day, after, rows }); total += rows;
  }
  return out;
}

/** When to ask the reader: at once when the link comes up (`wasLive` tracks it, so a flap is not four asks in one
 *  ms), within GAP_REQ_MS after a hole in today's copy (GAP_ASKS_MAX unanswered asks, then the rhythm), and
 *  every HIST_REQ_MS while live. */
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
  const out = []; for (let i = 0; i < b64.length; i += size) out.push(b64.slice(i, i + size)); return out;
}
/** A received chunk into the viewer's assembly (one file at a time, in order; a lost chunk voids the file and the
 *  next request fetches it again). Returns the complete file {day, after, b64} when the last chunk lands. */
export function rxChunk(hs, c) {
  const key = `${c.day}:${c.after || 0}`;
  if (!hs.rx || hs.rx.key !== key || hs.rx.of !== c.of) hs.rx = { key, day: c.day, after: c.after || 0, of: c.of, next: 0, parts: [] };
  if (c.n !== hs.rx.next) { hs.rx = null; return { action: 'drop', why: `chunk ${c.n} of ${c.of} out of order` }; }
  hs.rx.parts.push(c.b64); hs.rx.next++;
  if (hs.rx.next < hs.rx.of) return { action: 'wait', have: hs.rx.next, of: c.of };
  const file = { day: hs.rx.day, after: hs.rx.after, b64: hs.rx.parts.join('') }; hs.rx = null;
  return { action: 'file', file };
}

/** The visible window for a range button; `first` = the oldest stored time (for "all"). */
export function chartRange(rangeKey, nowMs, first = null) {
  const span = RANGES[rangeKey] === undefined ? RANGES['6h'] : RANGES[rangeKey];
  const to = nowMs;
  const from = span ? to - span : (first !== null && first !== undefined ? first : to - 3600e3);
  return { from, to };
}
/** Bucket size for a window so a chart gets at most `points` buckets, never finer than a stored row. */
export function bucketStep(from, to, points = CHART_MAX_POINTS, minMs = MIN_ROW_MS) {
  return Math.max(minMs, Math.ceil(Math.max(1, to - from) / Math.max(1, points)));
}
/** Merge per-day bucket results (same step, ascending days) into one series and the uPlot columns: seconds,
 *  power (mean W), charge part (>= 0), discharge part (<= 0), battery (%), voltage (V). */
export function seriesFromBuckets(parts) {
  const t = [], w = [], wc = [], wd = [], soc = [], v = [];
  for (const b of parts) {
    for (let i = 0; i < b.t.length; i++) {
      const p = b.w[i] === null || b.w[i] === undefined ? null : b.w[i];
      t.push(b.t[i] / 1000); w.push(p); wc.push(p === null ? null : Math.max(0, p)); wd.push(p === null ? null : Math.min(0, p));
      soc.push(b.soc[i] === null || b.soc[i] === undefined ? null : b.soc[i]); v.push(b.v[i] === null || b.v[i] === undefined ? null : b.v[i]);
    }
  }
  return { t, w, wc, wd, soc, v };
}
/** Buckets from plain rows (the memory-only backend and tests): the same columns the SQL gives. */
export function bucketsFromRows(rows, { p, from, to, stepMs }) {
  const step = Math.max(1, Math.round(stepMs)); const m = new Map();
  for (const r of rows) {
    if (r.p !== p || r.t < from || r.t > to) continue;
    const b = Math.floor(r.t / step); let a = m.get(b); if (!a) { a = { n: 0, w: 0, wn: 0, wmin: null, wmax: null, soc: 0, sn: 0, v: 0, vn: 0 }; m.set(b, a); }
    a.n++;
    if (r.w !== null && r.w !== undefined) { a.w += r.w; a.wn++; a.wmin = a.wmin === null ? r.w : Math.min(a.wmin, r.w); a.wmax = a.wmax === null ? r.w : Math.max(a.wmax, r.w); }
    if (r.soc !== null && r.soc !== undefined) { a.soc += r.soc; a.sn++; }
    if (r.v !== null && r.v !== undefined) { a.v += r.v; a.vn++; }
  }
  const out = { t: [], w: [], wmin: [], wmax: [], soc: [], v: [], n: [] };
  for (const b of [...m.keys()].sort((x, y) => x - y)) { const a = m.get(b); out.t.push(b * step); out.w.push(a.wn ? a.w / a.wn : null); out.wmin.push(a.wmin); out.wmax.push(a.wmax); out.soc.push(a.sn ? a.soc / a.sn : null); out.v.push(a.vn ? a.v / a.vn : null); out.n.push(a.n); }
  return out;
}
/** Energy from plain rows, the SQL's rule: each row's power over the time since the row before, gaps capped. */
export function energyFromRows(rows, { p, from, to, maxGapMs = 60000 }) {
  let charged = 0, discharged = 0, prev = null;
  for (const r of rows) {
    if (r.p !== p || r.t < from || r.t > to) continue;
    if (prev !== null && r.w !== null && r.w !== undefined) { const dt = Math.min(r.t - prev, maxGapMs); if (r.w > 0) charged += r.w * dt; else discharged += -r.w * dt; }
    prev = r.t;
  }
  return { charged: charged / 3600000, discharged: discharged / 3600000 };
}
/** Which stored days a window needs (today included). */
export function daysNeeded(days, from, to) {
  const want = new Set(daysInRange(from, to));
  return days.map((d) => d.day).filter((d) => want.has(d)).sort();
}

// ---- store call bookkeeping: timeouts, failures, statistics (owner ask 2026-09-24) ----
export function opTimeoutMs(op) { return OP_TIMEOUT_MS[op] || OP_TIMEOUT_MS.other; }
export function statsState() { return { since: 0, ops: {}, timeouts: 0, fails: 0, restarts: 0, timeoutsInRow: 0 }; }
/** Record one store call: kind, duration, outcome ('ok' | 'fail' | 'timeout'), rows or bytes moved. */
export function statsAdd(st, kind, ms, outcome = 'ok', n = 0) {
  const o = st.ops[kind] || (st.ops[kind] = { n: 0, ok: 0, fail: 0, timeout: 0, ms: 0, max: 0, rows: 0 });
  o.n++; o.ms += ms; if (ms > o.max) o.max = ms; o.rows += n || 0;
  if (outcome === 'ok') { o.ok++; st.timeoutsInRow = 0; }
  else if (outcome === 'timeout') { o.timeout++; st.timeouts++; st.timeoutsInRow++; }
  else { o.fail++; st.fails++; st.timeoutsInRow = 0; }
  return o;
}
/** Does the worker look stuck? (timeouts in a row) */
export function stuckDecision(st, limit = STUCK_RESTART) { return st.timeoutsInRow >= limit ? { action: 'restart' } : { action: 'noop' }; }
/** One log line of the statistics: per kind n/ok/fail/timeout, mean and max ms, rows. */
export function statsLine(st) {
  const parts = Object.entries(st.ops).map(([k, o]) => `${k}=${o.n}(${o.ok}ok${o.fail ? `/${o.fail}fail` : ''}${o.timeout ? `/${o.timeout}timeout` : ''}) ${o.n ? Math.round(o.ms / o.n) : 0}/${o.max}ms${o.rows ? ` ${o.rows}rows` : ''}`);
  return `history stats: ${parts.length ? parts.join(' · ') : 'no calls yet'}${st.restarts ? ` · restarts=${st.restarts}` : ''}`;
}
/** Reset the counters (a new statistics window). */
export function statsReset(st, now) { st.ops = {}; st.since = now; }
