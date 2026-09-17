// BatRay by ClearEvo.com - time-to-go estimate, current smoothing, session trend (pure, tested)
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

// What every commercial monitor shows and a BMS app does not: how long the
// battery lasts. Benchmarked 2026-09-17 against Victron ("Time to go"),
// Enphase ("70% (12 hrs 12 mins)"), EcoFlow ("Available time"), LiTime
// ("Estimated full time"). The discharge estimate counts down to the SOC at
// which the INVERTER cuts off, not the BMS: inverters are set to stop a little
// above the BMS protection, so the owner's real "empty" is that setting.
// Straight-line estimate from the smoothed current; charging slows near full,
// so the time-to-full is optimistic and is labelled "≈".

export const IDLE_A = 0.05;

/**
 * @param {{remainAh:number|null, nominalAh:number|null, currentA:number|null, cutoffPct:number}} x
 * @returns {{kind:'empty'|'full'|'idle'|'atCutoff'|'unknown', hours:number|null}}
 */
export function timeToGo({ remainAh, nominalAh, currentA, cutoffPct }) {
  const n = (v) => v === null || v === undefined || !Number.isFinite(v);
  if (n(remainAh) || n(nominalAh) || n(currentA) || nominalAh <= 0) return { kind: 'unknown', hours: null };
  const cut = Math.max(0, Math.min(95, Number.isFinite(cutoffPct) ? cutoffPct : 0));
  if (Math.abs(currentA) < IDLE_A) return { kind: 'idle', hours: null };
  if (currentA < 0) {
    const usable = remainAh - nominalAh * cut / 100;
    if (usable <= 0) return { kind: 'atCutoff', hours: 0 };
    return { kind: 'empty', hours: usable / -currentA };
  }
  const missing = Math.max(0, nominalAh - remainAh);
  return { kind: 'full', hours: missing / currentA };
}

/** Split hours into d/h/m for display; caps at 30 d so a trickle never reads "4 years". */
export function splitHours(hours) {
  if (hours === null || !Number.isFinite(hours) || hours < 0) return null;
  const capped = hours > 30 * 24;
  const total = Math.round(Math.min(hours, 30 * 24) * 60);
  return { d: Math.floor(total / 1440), h: Math.floor((total % 1440) / 60), m: total % 60, capped };
}

/** Exponential moving average with a time constant, so a sinusoidal load
 *  (compressor, inverter fan) does not make the estimate jump every frame. */
export class Ema {
  constructor(tauS = 60) { this.tauS = tauS; this.v = null; this.t = null; }
  push(v, t) {
    if (v === null || v === undefined || !Number.isFinite(v)) return this.v;
    if (this.v === null) { this.v = v; this.t = t; return v; }
    const dt = Math.max(0, (t - this.t) / 1000);
    const a = 1 - Math.exp(-dt / this.tauS);
    this.v += a * (v - this.v); this.t = t;
    return this.v;
  }
}

/**
 * Session trend: readings since this tab opened, kept in memory only (nothing
 * stored, nothing sent). One sample per frame; the window drops old samples.
 * Energy is integrated from power over time, split into charged/discharged Wh.
 */
export class Trend {
  constructor({ windowMs = 6 * 3600 * 1000, maxSamples = 8000 } = {}) {
    this.windowMs = windowMs; this.maxSamples = maxSamples; this.samples = []; this.chargedWh = 0; this.dischargedWh = 0;
  }
  push({ t, soc, power }) {
    const last = this.samples[this.samples.length - 1];
    if (last && power !== null && power !== undefined && last.power !== null && last.power !== undefined) {
      const dtS = (t - last.t) / 1000;
      if (dtS > 0 && dtS <= 60) {                    // a gap > 60 s (frozen tab) is not integrated
        const w = (power + last.power) / 2 * dtS / 3600;
        if (w > 0) this.chargedWh += w; else this.dischargedWh -= w;
      }
    }
    this.samples.push({ t, soc: soc === undefined ? null : soc, power: power === undefined ? null : power });
    const cutoff = t - this.windowMs;
    while (this.samples.length && (this.samples[0].t < cutoff || this.samples.length > this.maxSamples)) this.samples.shift();
  }
  get spanMs() { return this.samples.length < 2 ? 0 : this.samples[this.samples.length - 1].t - this.samples[0].t; }
}
