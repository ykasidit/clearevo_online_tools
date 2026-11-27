// BatRay by ClearEvo.com - the inverter's low-battery cut-off as a battery % (pure, tested)
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

// An inverter that does not talk to the BMS cuts at its own pack VOLTAGE. Time to go needs that as a battery %.
// The pack's own discharge readings (BMS % against cell voltage, from the stored history) say where it is; a
// chemistry curve only shapes the stretch below the lowest reading seen (the knee). Owner's sea-hut pack
// (2026-11-27, 14S Li-ion): 3.57 V/cell at 52 %, 3.39 V at 34 % - far below a textbook curve, so a curve alone
// would put a 46 V cut near 3 %; the pack's readings put it near 31 %.

/** Rest voltage per cell against state of charge (%), typical cells. Only the shape matters where the pack has
 *  readings of its own; it decides alone only without them. */
export const CHEM = {
  lfp: [[0, 2.5], [5, 2.85], [10, 3.0], [20, 3.2], [30, 3.22], [40, 3.25], [50, 3.26], [60, 3.27], [70, 3.3], [80, 3.32], [90, 3.35], [100, 3.4]],
  nmc: [[0, 3.0], [5, 3.37], [10, 3.46], [20, 3.56], [30, 3.61], [40, 3.66], [50, 3.72], [60, 3.8], [70, 3.88], [80, 3.97], [90, 4.07], [100, 4.18]],
  lto: [[0, 1.8], [10, 2.1], [20, 2.2], [30, 2.25], [50, 2.3], [70, 2.35], [90, 2.45], [100, 2.6]],
};
export const CHEM_NAME = { lfp: 'LiFePO4', nmc: 'Li-ion (NMC)', lto: 'LTO' };
const FLAT_V_PER_PCT = 0.002;   // flatter than this (the LFP plateau) a voltage says too little about the %
const FIT_MIN_SPAN = 5;         // SOC % the lowest readings must span for a slope
const FIT_WINDOW = 15;          // SOC % above the lowest reading that the fit uses
const MIN_N = 3;                // stored rows a SOC % needs before it counts

const num = (x) => typeof x === 'number' && Number.isFinite(x);

/** The chemistry: the BMS's cell over-voltage protection first (what the pack is set up for), then a cell above
 *  3.7 V (no LFP cell sits there), then the BMS's battery-type byte - the owner's 14S Li-ion pack reports type 0
 *  (LFP) at 3.62 V a cell (2026-11-27), so the byte alone is not trusted. null = unknown. */
export function chemOf(d, s) {
  const ovp = s ? s.cellOvp : null;
  if (num(ovp)) {
    if (ovp >= 3.9) return 'nmc';
    if (ovp >= 3.4 && ovp <= 3.8) return 'lfp';
    if (ovp < 3.0 && ovp > 2.0) return 'lto';
  }
  const cells = d && Array.isArray(d.cells) ? d.cells.map((c) => (c && typeof c === 'object' ? c.v : c)).filter(num) : [];
  if (cells.some((v) => v > 3.7)) return 'nmc';
  const t = d ? d.batteryType : null;
  if (t === 0) return 'lfp';
  if (t === 1) return 'nmc';
  if (t === 2) return 'lto';
  return null;
}

/** The % at a cell voltage on a chemistry curve (clamped 0..100). */
export function socAtCellV(chem, v) {
  const t = CHEM[chem];
  if (!t || !num(v)) return null;
  if (v <= t[0][1]) return 0;
  if (v >= t[t.length - 1][1]) return 100;
  for (let k = 1; k < t.length; k++) {
    const [s0, v0] = t[k - 1], [s1, v1] = t[k];
    if (v <= v1) return s0 + (v - v0) / (v1 - v0) * (s1 - s0);
  }
  return 100;
}

/** Volts per % of the curve at a cell voltage (how much a voltage says about the % there). */
export function slopeAt(chem, v) {
  const t = CHEM[chem];
  if (!t || !num(v)) return 0;
  for (let k = 1; k < t.length; k++) if (v <= t[k][1] || k === t.length - 1) return (t[k][1] - t[k - 1][1]) / (t[k][0] - t[k - 1][0]);
  return 0;
}

/** Stored discharge rows grouped by whole %, as the history store returns them ({s, sv, n}: pack volts summed),
 *  merged over days and live rows into one Map s -> {sv, n}. */
export function curveAdd(curve, bins) {
  for (const b of bins || []) {
    if (!b || !num(b.s) || !num(b.sv) || !num(b.n) || b.n <= 0 || b.s < 0 || b.s > 100) continue;
    const s = Math.round(b.s), c = curve.get(s) || { sv: 0, n: 0 };
    c.sv += b.sv; c.n += b.n; curve.set(s, c);
  }
  return curve;
}
/** The same grouping over plain rows (the in-memory store, the live row). Discharge only. */
export function curveBinsFromRows(rows, p) {
  const m = new Map();
  for (const r of rows || []) {
    if (!r || (p !== undefined && r.p !== p) || !num(r.soc) || !num(r.v) || !num(r.i) || r.i >= -0.5) continue;
    const s = Math.round(r.soc), c = m.get(s) || { s, sv: 0, n: 0 };
    c.sv += r.v; c.n++; m.set(s, c);
  }
  return [...m.values()];
}

/** Cell-voltage points (soc ascending) of a curve, bins with fewer than MIN_N rows left out. */
export function curvePoints(curve, cells) {
  if (!(cells > 0)) return [];
  const out = [];
  for (const [s, c] of curve) if (c.n >= MIN_N) out.push({ soc: s, v: c.sv / c.n / cells });
  return out.sort((a, b) => a.soc - b.soc);
}

/**
 * The battery % at which the pack reaches the cut-off cell voltage.
 * - 'seen': a stored reading is at or below it - read off the pack's own readings.
 * - 'fit': the lowest readings (FIT_WINDOW above the lowest) mapped onto the chemistry curve, a straight line
 *   from BMS % to curve % fitted, the cut-off's curve % mapped back: the pack's own level, the curve's knee.
 * - 'offset': too few readings for a slope - the lowest ones fix the offset between BMS % and curve %.
 * - 'curve': no usable readings (or only on a flat stretch, where a voltage says too little) - the curve alone.
 * Returns { soc, how, low } (low = the lowest % with readings) or null without a chemistry.
 */
export function cutSoc({ chem, points, cutCellV }) {
  if (!CHEM[chem] || !num(cutCellV)) return null;
  const pts = (points || []).filter((p) => num(p.soc) && num(p.v));
  const clamp = (x, hi) => Math.max(0, Math.min(hi, x));
  const curve = { soc: clamp(socAtCellV(chem, cutCellV), 100), how: 'curve', low: pts.length ? pts[0].soc : null };
  if (!pts.length) return curve;
  // seen: the highest % whose reading is at or below the cut-off, interpolated with the reading just above it
  for (let k = pts.length - 1; k >= 0; k--) {
    if (pts[k].v > cutCellV) continue;
    const a = pts[k], b = pts.slice(k + 1).find((p) => p.v > cutCellV);
    const soc = b ? a.soc + (cutCellV - a.v) / (b.v - a.v) * (b.soc - a.soc) : a.soc;
    return { soc: clamp(soc, 100), how: 'seen', low: pts[0].soc };
  }
  const low = pts[0].soc, win = pts.filter((p) => p.soc <= low + FIT_WINDOW);
  // on a plateau (the curve there, or the pack's own readings) a voltage says too little about the %
  const span = win[win.length - 1].soc - low, vSpan = Math.max(...win.map((p) => p.v)) - Math.min(...win.map((p) => p.v));
  if (slopeAt(chem, win[0].v) < FLAT_V_PER_PCT || (span >= FIT_MIN_SPAN && vSpan / span < FLAT_V_PER_PCT)) return curve;
  const us = win.map((p) => socAtCellV(chem, p.v)), uCut = socAtCellV(chem, cutCellV);
  if (win.length >= 3 && span >= FIT_MIN_SPAN) {
    const n = win.length, mx = win.reduce((a, p) => a + p.soc, 0) / n, mu = us.reduce((a, u) => a + u, 0) / n;
    let sxx = 0, sxu = 0;
    for (let k = 0; k < n; k++) { sxx += (win[k].soc - mx) ** 2; sxu += (win[k].soc - mx) * (us[k] - mu); }
    const a = sxu / sxx;
    if (a >= 0.3 && a <= 3) return { soc: clamp((uCut - (mu - a * mx)) / a, low), how: 'fit', low };
  }
  const few = win.slice(0, 3), off = few.reduce((acc, p, k) => acc + (us[k] - p.soc), 0) / few.length;
  return { soc: clamp(uCut - off, low), how: 'offset', low };
}

/** What the time-to-go and the picture use: { pct, mode, v, est }. pct null = not known (the estimate hides). */
export function effectiveCut({ mode, pct, volts, chem, points, cells }) {
  if (mode !== 'v') return { pct: num(pct) ? pct : 0, mode: 'pct', v: null, est: null };
  if (!num(volts) || volts <= 0 || !(cells > 0)) return { pct: null, mode: 'v', v: num(volts) ? volts : null, est: null };
  const est = cutSoc({ chem, points, cutCellV: volts / cells });
  return { pct: est ? Math.round(est.soc) : null, mode: 'v', v: volts, est };
}
