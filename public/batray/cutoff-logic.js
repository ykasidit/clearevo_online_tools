// BatRay by ClearEvo.com - the inverter's low-battery cut-off as a battery %, learned from the pack (pure, tested)
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

// An inverter that does not talk to the BMS cuts at its own pack VOLTAGE; time to go counts the BMS's battery %.
// Where that voltage falls on the % scale differs pack by pack (owner, 2026-11-27: "I would not want to guess that
// all LFP manufacturers are the same - learn from the history, like a fitness tracker learns each user"). So no
// chemistry curve: the stored history says, for each discharge that reached the cut-off voltage, the battery % it
// was at. The estimate is the median of the latest such discharges; until one exists (or with under a day of
// readings) it is not ready, and says what it still needs.

export const LEARN_DAYS = 30;     // the stored days looked at (the latest data: a pack ages, a BMS recalibrates)
export const MIN_HOURS = 24;      // readings needed before an estimate is offered
export const BELOW_ROWS = 2;      // stored rows at or under the cut-off (a row per 3 s): not a single surge, yet an
                                  // inverter that cuts within seconds still leaves two
export const USE_EVENTS = 5;      // the latest discharges that count

const num = (x) => typeof x === 'number' && Number.isFinite(x);

/** One day's cut-off evidence from the store: the highest whole % at which the pack sat at or under the cut-off
 *  voltage while discharging for BELOW_ROWS rows or more, counted from the top. null = it did not get there. */
export function dayCutSoc(below) {
  const bins = (Array.isArray(below) ? below : []).filter((b) => b && num(b.s) && num(b.n) && b.n > 0).sort((a, b) => b.s - a.s);
  let n = 0;
  for (const b of bins) { n += b.n; if (n >= BELOW_ROWS) return b.s; }
  return null;
}

/**
 * The learned cut-off from per-day facts (any order):
 * [{ day, first, last, n, below: [{s, n}], low: {v, soc} | null }] - first / last: the pack's stored time span that
 * day (ms), below: discharge rows at or under the cut-off voltage by whole %, low: the day's lowest discharge reading.
 * Returns { ready: true, soc, n, min, max, days, hours, low } or { ready: false, why: 'hours' | 'never', hours, low }.
 */
export function learnCut(days) {
  const list = (Array.isArray(days) ? days : []).filter((d) => d && typeof d.day === 'string').sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  let ms = 0, low = null;
  const events = [];
  for (const d of list) {
    if (num(d.first) && num(d.last) && d.last > d.first) ms += d.last - d.first;
    if (d.low && num(d.low.v) && num(d.low.soc) && (low === null || d.low.v < low.v)) low = { v: d.low.v, soc: d.low.soc };
    const s = dayCutSoc(d.below);
    if (s !== null) events.push({ day: d.day, soc: s });
  }
  const hours = ms / 3600000;
  if (hours < MIN_HOURS) return { ready: false, why: 'hours', hours, low };
  if (!events.length) return { ready: false, why: 'never', hours, low };
  const use = events.slice(0, USE_EVENTS), sorted = use.map((e) => e.soc).sort((a, b) => a - b), m = sorted.length >> 1;
  const soc = sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  return { ready: true, soc, n: use.length, min: sorted[0], max: sorted[sorted.length - 1], days: use.map((e) => e.day), hours, low };
}

/** cutDay over plain rows (the in-memory store): the same facts as the SQL in history-sql.js. */
export function cutDayFromRows(rows, p, volts) {
  let first = null, last = null, n = 0, low = null;
  const below = new Map();
  for (const r of rows || []) {
    if (!r || r.p !== p || !num(r.t)) continue;
    n++; if (first === null || r.t < first) first = r.t; if (last === null || r.t > last) last = r.t;
    if (!num(r.i) || r.i >= -0.5 || !num(r.v) || !num(r.soc)) continue;
    if (low === null || r.v < low.v) low = { v: r.v, soc: r.soc };
    if (r.v <= volts) { const s = Math.round(r.soc); below.set(s, (below.get(s) || 0) + 1); }
  }
  return { first, last, n, below: [...below].map(([s, c]) => ({ s, n: c })), low };
}

/** A cut-off setting from storage or the reader: { mode: 'pct' | 'v', pct, v } with sane numbers, or null. */
export function cutSetting(x) {
  if (!x || typeof x !== 'object') return null;
  const pct = num(x.pct) ? Math.max(0, Math.min(95, Math.round(x.pct))) : 10;
  const v = num(x.v) && x.v > 0 && x.v <= 1000 ? Math.round(x.v * 10) / 10 : null;
  return { mode: x.mode === 'v' ? 'v' : 'pct', pct, v };
}

/** What a viewer uses: its own setting for this room when it set one, else the reader's, else the default. */
export function viewerCut(own, reader) {
  const o = cutSetting(own), r = cutSetting(reader);
  return { ...(o || r || { mode: 'pct', pct: 10, v: null }), from: o ? 'own' : r ? 'reader' : 'default' };
}

/** What the time-to-go and the picture use: { pct (null = not known yet), mode, v, learn }. */
export function effectiveCut({ mode, pct, volts, learn }) {
  if (mode !== 'v') return { pct: num(pct) ? pct : 0, mode: 'pct', v: null, learn: null };
  if (!num(volts) || volts <= 0) return { pct: null, mode: 'v', v: null, learn: null };
  return { pct: learn && learn.ready ? Math.round(learn.soc) : null, mode: 'v', v: volts, learn: learn || null };
}
