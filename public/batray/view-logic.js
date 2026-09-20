// BatRay by ClearEvo.com - view models: what the picture, chips and TV frame show, from a reading (pure, tested)
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
// Functional core of the display (house rule 2026-09-20): every function here
// turns a decoded reading (plus the strings table T) into plain values the
// shell paints - the battery level and its colour class, the flow direction
// and line width, the status chips, the time-to-go line, the cell delta, the
// "updated N s ago" staleness, the TV frame model. No DOM anywhere, so the
// same real frames the decoder tests use replay through here in node.
import { errorLabels } from './jkbms.js';
import { timeToGo, splitHours } from './trend.js';

export function fmt(n, digits = 2, unit = '') {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return `${n.toFixed(digits)}${unit}`;
}
export function fmtWh(wh) { return wh >= 1000 ? `${(wh / 1000).toFixed(2)} kWh` : `${Math.round(wh)} Wh`; }
export function fmtRuntime(s, T) {
  if (!s) return '-';
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  return d ? T.dh(d, h) : T.hm(h, Math.floor((s % 3600) / 60));
}
export function fmtSpan(hours, T) {
  const x = splitHours(hours);
  if (!x) return '-';
  if (x.capped) return T.etaCapped;
  return x.d ? T.dh(x.d, x.h) : x.h ? T.hm(x.h, x.m) : T.mOnly(x.m);
}

// ---- the upright battery: a level in the inner area (y 19..151, 132 high),
// red at <= 10 %, amber at <= 25 %, the inverter cut-off as a dashed line ----
export const LEVEL_TOP = 19, LEVEL_H = 132, SOC_CRIT = 10, SOC_LOW = 25;
export function socClass(soc) { return soc === null || soc === undefined ? '' : `on${soc <= SOC_CRIT ? ' crit' : soc <= SOC_LOW ? ' low' : ''}`; }
export function socLevel(soc, cutoffPct) {
  const known = soc !== null && soc !== undefined;
  const h = known ? Math.round(LEVEL_H * Math.max(0, Math.min(100, soc))) / 100 : 0;
  return {
    y: (LEVEL_TOP + LEVEL_H - h).toFixed(2), h: h.toFixed(2), cls: socClass(known ? soc : null), socTxt: known ? `${soc}%` : '-',
    cutPath: `M9 ${(LEVEL_TOP + LEVEL_H * (1 - cutoffPct / 100)).toFixed(1)} H111`, cutShown: cutoffPct > 0,
  };
}

// ---- the flow: charge above IDLE_A into the battery, discharge below out of it ----
export const FLOW_IDLE_A = 0.05;
export function flowDir(I) { return I !== null && I !== undefined && I > FLOW_IDLE_A ? 'chg' : I !== null && I !== undefined && I < -FLOW_IDLE_A ? 'dis' : 'idle'; }
export function maxAmps(dir, settings) { return dir === 'chg' ? (settings && settings.maxChargeA) || 100 : (settings && settings.maxDischargeA) || 100; }
export function battLine(d, T) {
  return T.battLbl(d.packV === null || d.packV === undefined ? null : fmt(d.packV, 2), d.soh === undefined || d.soh === null ? null : d.soh);
}
/** Everything the flow line and its labels show for a reading. */
export function flowModel(d, settings, T) {
  const I = d.current === undefined ? null : d.current, dir = flowDir(I), maxA = maxAmps(dir, settings);
  const ratio = I === null ? 0 : Math.min(1, Math.abs(I) / maxA);
  const width = dir === 'idle' ? 3 : 3 + 15 * ratio;              // thicker line = more of the BMS's limit in use
  return {
    dir, cls: dir === 'idle' ? '' : dir, width, dashArray: `${10 + width} ${10 + width}`, maxA,
    powerTxt: d.power === null || d.power === undefined ? '-' : `${dir === 'chg' ? T.flowCharge : dir === 'dis' ? T.flowDischarge : T.flowIdle} ${fmt(Math.abs(d.power), 0)} W`,
    ampsTxt: I === null ? T.noCurrent : T.ofMax(fmt(Math.abs(I), 2), fmt(maxA, 0)),
    sysLbl: dir === 'chg' ? T.charger : dir === 'dis' ? T.load : T.system,
    battLine: battLine(d, T),
  };
}

/** The time-to-go line: to the inverter cut-off while discharging, to full while charging. */
export function etaModel({ remainAh, nominalAh, currentA, cutoffPct }, T) {
  const r = timeToGo({ remainAh, nominalAh, currentA, cutoffPct });
  return {
    kind: r.kind,
    text: r.kind === 'empty' ? T.etaEmpty(fmtSpan(r.hours, T), cutoffPct) : r.kind === 'full' ? T.etaFull(fmtSpan(r.hours, T)) : r.kind === 'atCutoff' ? T.etaAtCutoff : '',
    bad: r.kind === 'atCutoff', hidden: r.kind === 'unknown',
  };
}

/** The status chips under the picture: MOS switches, balancing, temperatures, heating, the BMS alarm line. */
export function chipList(d, T) {
  const R = T.r;
  const t = (v) => (v === null || v === undefined ? '-' : fmt(v, 0, '°'));
  const bits = [];
  if (d.chgMos !== undefined) bits.push({ cls: d.chgMos ? 'ok' : 'bad', txt: T.chipChg(!!d.chgMos) });
  if (d.dsgMos !== undefined) bits.push({ cls: d.dsgMos ? 'ok' : 'bad', txt: T.chipDsg(!!d.dsgMos) });
  if (d.balancing !== undefined && d.balancing !== null) bits.push({ cls: d.balancing ? 'warn' : '', txt: T.chipBal(!!d.balancing) });
  if (d.tempMos !== undefined || d.temp1 !== undefined) bits.push({ cls: '', txt: T.chipTemp(t(d.tempMos), t(d.temp1), t(d.temp2)) });
  if (d.heating) bits.push({ cls: 'warn', txt: `${R.heating} ${R.on}` });
  const labels = d.errors ? errorLabels(d.errors) : [];
  bits.push(labels.length ? { cls: 'bad', txt: T.chipAlarm(labels.length, labels.join(', ')) } : { cls: 'ok', txt: T.chipAlarmNone });
  return bits;
}

/** The cell line: delta in mV and the lowest / highest cell by name; empty below two cells. */
export function cellsStat(d, T) {
  const cells = d.cells || [];
  if (cells.length < 2) return '';
  let lo = cells[0], hi = cells[0];
  for (const c of cells) { if (c.v < lo.v) lo = c; if (c.v > hi.v) hi = c; }
  return T.cellsStat(Math.round((hi.v - lo.v) * 1000), lo.v.toFixed(3), lo.n, hi.v.toFixed(3), hi.n);
}

/** "updated just now" / "N s ago"; amber once a reading is older than STALE_AGE_S. */
export const STALE_AGE_S = 15;
export function ageLabel(ageS, T) {
  if (ageS === null || ageS === undefined) return { text: T.noData, stale: false };
  return { text: ageS < 2 ? T.justNow : T.agoS(ageS), stale: ageS > STALE_AGE_S };
}

/** The session trend needs TREND_MIN_MS of readings before it draws; until then, how far along it is. */
export const TREND_MIN_MS = 30000;
export function trendProgress(spanMs, hasData) {
  if (!hasData) return { ready: false, pct: 0, haveS: 0, needS: TREND_MIN_MS / 1000, waiting: true };
  const s = Math.max(0, spanMs || 0);
  return { ready: s >= TREND_MIN_MS, pct: Math.min(100, Math.round((s / TREND_MIN_MS) * 100)), haveS: Math.min(TREND_MIN_MS / 1000, Math.round(s / 1000)), needS: TREND_MIN_MS / 1000, waiting: false };
}

/** The model tv-draw paints: the picture's numbers laid out for a TV. */
export function buildTvModel({ label, demo, data: d, settings, iEmaV, lastFrameAt, now, cutoffPct, T }) {
  const clock = new Date(now).toTimeString().slice(0, 8);
  const base = { label: label || '', clock, brand: 'BatRay by ClearEvo.com', footer: demo ? T.demoBadge : '' };
  if (!d) return { ...base, waiting: true, waitingTxt: T.tvWaiting, updatedTxt: T.noData };
  const age = lastFrameAt ? Math.round((now - lastFrameAt) / 1000) : null;
  const f = flowModel(d, settings, T);
  const e = etaModel({ remainAh: d.remainAh, nominalAh: d.nominalAh, currentA: iEmaV !== null && iEmaV !== undefined ? iEmaV : d.current, cutoffPct }, T);
  const a = ageLabel(age, T);
  return {
    ...base, soc: d.soc === undefined ? null : d.soc, cutoffPct, battLine: f.battLine, dir: f.dir,
    powerTxt: f.powerTxt, ampsTxt: f.ampsTxt, etaTxt: e.text, etaBad: e.bad, sysLbl: f.sysLbl, chips: chipList(d, T),
    updatedTxt: a.text, stale: a.stale,
  };
}
