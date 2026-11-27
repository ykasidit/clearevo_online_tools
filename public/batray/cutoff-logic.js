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
// chemistry curve: the stored history says, each time a discharge stopped at or near the cut-off voltage (the inverter
// cutting), the battery % it was at. The estimate is the median of the latest such cuts; until one exists (or with
// under a day of stored readings) it is not ready, and says what it still needs.

export const LEARN_DAYS = 30;     // the stored days looked at (the latest data: a pack ages, a BMS recalibrates)
export const MIN_HOURS = 24;      // hours of stored readings needed before an estimate is offered
export const USE_EVENTS = 5;      // the latest cuts that count
export const GAP_MS = 300000;     // rows further apart than this are a gap, not hours of readings
export const STOP_MS = 30000;     // the row after the last discharge row within this: the discharge stopped
export const DIS_A = -0.2;        // discharging below this current
export const IDLE_A = -0.1;       // stopped (idle or charging) above this current
export const DROP = 0.5;          // ...or the load at least halved in one row (an inverter's standby draw stays)
export const STANDBY_A = -2;      // ...to a draw under this: a motor start that ends at -9 A is not a cut

const num = (x) => typeof x === 'number' && Number.isFinite(x);

/** How far above the setting the BMS may still read when the inverter cuts (it measures at its own terminals, after
 *  the cables, with its own calibration): 1 % of the voltage, at least 0.3 V. */
export function cutTol(v) { return Math.max(0.3, v * 0.01); }
/** The discharge stopped from one row (current i) to the next (ni): idle or charging, or the load at least halved and
 *  fell under STANDBY_A (what an inverter draws idling; a 4 A night load falling to 0.9 A is a cut, Fable round 3). */
export function stopped(i, ni) { return ni > IDLE_A || (ni > DROP * i && ni > STANDBY_A); }

/**
 * A cut, as stored rows show it: a discharge row at or near the cut-off voltage (from 2 x cutTol under it to cutTol
 * over it), and the next row (within STOP_MS) stopped - idle, charging, or the load at least halved to under STANDBY_A
 * (an inverter's standby draw stays on the BMS, Fable rounds 2-3): the inverter dropped its load (Fable review 2026-11-27: a 1-2 s cut leaves one row under
 * the voltage, and the BMS may still read 46.2 V when a 46.0 V inverter cuts). One day's facts for learnCut, over
 * that day's rows of pack p in time order: { n, ms (time between rows, gaps over GAP_MS left out), ends: [{t, soc,
 * v}], first: {t, i}, last: {t, soc, v, i}, low: the lowest discharge reading {v, soc} }. history-sql.js cutDay is
 * the same over SQLite.
 */
export function cutDayFromRows(rows, p, volts) {
  const rs = (rows || []).filter((r) => r && r.p === p && num(r.t)).sort((a, b) => a.t - b.t);
  const top = volts + cutTol(volts), ends = [];
  let ms = 0, low = null;
  for (let k = 0; k < rs.length; k++) {
    const r = rs[k], nx = rs[k + 1];
    if (k > 0 && r.t - rs[k - 1].t <= GAP_MS) ms += r.t - rs[k - 1].t;
    if (!num(r.i) || r.i >= DIS_A || !num(r.v) || !num(r.soc)) continue;
    if (low === null || r.v < low.v) low = { v: r.v, soc: r.soc };
    if (nx && num(nx.i) && stopped(r.i, nx.i) && nx.t - r.t <= STOP_MS && r.v <= top && r.v >= volts - 2 * cutTol(volts)) ends.push({ t: r.t, soc: r.soc, v: r.v });
  }
  const a = rs[0], z = rs[rs.length - 1];
  return { n: rs.length, ms, ends, first: a ? { t: a.t, i: num(a.i) ? a.i : null } : null, last: z ? { t: z.t, soc: num(z.soc) ? z.soc : null, v: num(z.v) ? z.v : null, i: num(z.i) ? z.i : null } : null, low };
}

/**
 * The learned cut-off from per-day facts (cutDay / cutDayFromRows, any order) at `volts`: the cuts of all days, a
 * cut across midnight stitched from one day's last row and the next day's first; the median battery % of the latest
 * USE_EVENTS cuts. Returns { ready: true, soc, n, min, max, hours, low } or { ready: false, why: 'hours' | 'never',
 * hours, low }.
 */
export function learnCut(days, volts) {
  const list = (Array.isArray(days) ? days : []).filter((d) => d && typeof d.day === 'string').sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const top = num(volts) ? volts + cutTol(volts) : -Infinity;
  let ms = 0, low = null;
  const events = [];
  for (let k = 0; k < list.length; k++) {
    const d = list[k], nx = list[k + 1];
    if (num(d.ms) && d.ms > 0) ms += d.ms;
    if (d.low && num(d.low.v) && num(d.low.soc) && (low === null || d.low.v < low.v)) low = { v: d.low.v, soc: d.low.soc };
    for (const e of Array.isArray(d.ends) ? d.ends : []) if (e && num(e.t) && num(e.soc)) events.push({ t: e.t, soc: e.soc });
    const a = d.last, b = nx && nx.first;
    if (a && b && num(a.t) && num(b.t) && b.t > a.t) {
      if (b.t - a.t <= GAP_MS) ms += b.t - a.t;
      if (num(a.i) && a.i < DIS_A && num(a.v) && a.v <= top && a.v >= volts - 2 * cutTol(volts) && num(a.soc) && num(b.i) && stopped(a.i, b.i) && b.t - a.t <= STOP_MS) events.push({ t: a.t, soc: a.soc });
    }
  }
  const hours = ms / 3600000;
  if (hours < MIN_HOURS) return { ready: false, why: 'hours', hours, low };
  if (!events.length) return { ready: false, why: 'never', hours, low };
  const use = events.sort((x, y) => y.t - x.t).slice(0, USE_EVENTS), sorted = use.map((e) => e.soc).sort((x, y) => x - y), m = sorted.length >> 1;
  const soc = sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  return { ready: true, soc, n: use.length, min: Math.round(sorted[0]), max: Math.round(sorted[sorted.length - 1]), hours, low };
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
