// BatRay by ClearEvo.com - tests (batray_trend.test.js)
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
import test from 'node:test';
import assert from 'node:assert/strict';
import { timeToGo, splitHours, Ema, Trend } from '../public/batray/trend.js';

test('time to empty counts down to the inverter cut-off, not to 0 %', () => {
  // 280 Ah bank, 176 Ah left, 8 A out, inverter cuts at 10 % (28 Ah): (176-28)/8 = 18.5 h
  const r = timeToGo({ remainAh: 176, nominalAh: 280, currentA: -8, cutoffPct: 10 });
  assert.equal(r.kind, 'empty'); assert.ok(Math.abs(r.hours - 18.5) < 1e-9);
  // no cut-off configured: the whole remaining capacity
  assert.ok(Math.abs(timeToGo({ remainAh: 176, nominalAh: 280, currentA: -8, cutoffPct: 0 }).hours - 22) < 1e-9);
  // already below the cut-off: "at cut-off", zero, never negative
  assert.deepEqual(timeToGo({ remainAh: 20, nominalAh: 280, currentA: -8, cutoffPct: 10 }), { kind: 'atCutoff', hours: 0 });
});

test('time to full is straight-line from the charge current', () => {
  const r = timeToGo({ remainAh: 176, nominalAh: 280, currentA: 26, cutoffPct: 10 });
  assert.equal(r.kind, 'full'); assert.ok(Math.abs(r.hours - 104 / 26) < 1e-9);
  assert.equal(timeToGo({ remainAh: 280, nominalAh: 280, currentA: 5, cutoffPct: 10 }).hours, 0);
});

test('idle and unknown inputs never produce a number', () => {
  assert.equal(timeToGo({ remainAh: 100, nominalAh: 280, currentA: 0.02, cutoffPct: 10 }).kind, 'idle');
  assert.equal(timeToGo({ remainAh: null, nominalAh: 280, currentA: -3, cutoffPct: 10 }).kind, 'unknown');   // JK04: no capacity fields
  assert.equal(timeToGo({ remainAh: 100, nominalAh: 0, currentA: -3, cutoffPct: 10 }).kind, 'unknown');
  assert.equal(timeToGo({ remainAh: 100, nominalAh: 280, currentA: -3, cutoffPct: 99 }).kind, 'atCutoff');   // cut-off clamps to 95 %
});

test('splitHours: d/h/m, capped at 30 days', () => {
  assert.deepEqual(splitHours(18.5), { d: 0, h: 18, m: 30, capped: false });
  assert.deepEqual(splitHours(50.25), { d: 2, h: 2, m: 15, capped: false });
  assert.equal(splitHours(5000).capped, true);
  assert.equal(splitHours(null), null);
});

test('Ema smooths a sinusoidal load', () => {
  const e = new Ema(60);
  let maxDev = 0;
  for (let s = 0; s < 600; s += 3) { const v = e.push(-8 + 2 * Math.sin(s / 7), s * 1000); if (s > 200) maxDev = Math.max(maxDev, Math.abs(v + 8)); }
  assert.ok(maxDev < 0.3, `ema deviates ${maxDev}`);
  assert.equal(new Ema().push(null, 0), null);
});

test('Trend integrates charged and discharged Wh and drops old samples', () => {
  const tr = new Trend({ windowMs: 10000 });
  const t0 = 1_000_000;
  for (let i = 0; i <= 3600; i += 3) tr.push({ t: t0 + i * 1000, soc: 50, power: -1000 });   // 1 h at -1 kW
  assert.ok(Math.abs(tr.dischargedWh - 1000) < 1); assert.equal(tr.chargedWh, 0);
  for (let i = 3603; i <= 5400; i += 3) tr.push({ t: t0 + i * 1000, soc: 50, power: 2000 });   // 30 min at +2 kW
  assert.ok(Math.abs(tr.chargedWh - 1000) < 2);
  assert.ok(tr.samples.length <= 5 && tr.spanMs <= 10000, `window keeps ${tr.samples.length}`);
  // a frozen-tab gap is not integrated as if the power had held the whole time
  tr.push({ t: t0 + 9000 * 1000, soc: 50, power: 2000 });
  assert.ok(tr.chargedWh < 1005);
});
