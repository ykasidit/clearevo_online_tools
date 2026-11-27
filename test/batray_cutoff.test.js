// BatRay by ClearEvo.com - tests: the inverter's voltage cut-off as a battery %
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHEM, chemOf, socAtCellV, slopeAt, curveAdd, curveBinsFromRows, curvePoints, cutSoc, effectiveCut } from '../public/batray/cutoff-logic.js';
import { timeToGo } from '../public/batray/trend.js';

// The owner's sea-hut pack (14S Li-ion), discharging at 1..15 A: BMS % and the mean pack volts of the readings at
// that % (numbers from its uploaded reader logs of 2026-10 and 2026-11, not the logs themselves).
const N11 = [[34, 47.52], [43, 49.05], [44, 49.10], [45, 49.23], [46, 49.33], [47, 49.64], [52, 49.97], [53, 49.99], [54, 50.08], [55, 50.16], [56, 50.27], [57, 50.34], [58, 50.48], [59, 50.55], [60, 50.57], [65, 51.15], [70, 51.70], [80, 53.38], [90, 55.63], [100, 57.33]];
const bins = (list, n = 5) => list.map(([s, v]) => ({ s, sv: v * n, n }));

test('chemistry: the cell over-voltage setting first, then a cell above 3.7 V, then the battery-type byte; unknown stays unknown', () => {
  assert.equal(chemOf({ batteryType: 0 }, { cellOvp: 4.2 }), 'nmc', 'the owner\'s 14S Li-ion pack reports type 0');
  assert.equal(chemOf({ batteryType: 1 }, { cellOvp: 3.65 }), 'lfp');
  assert.equal(chemOf({ batteryType: 0, cells: [{ v: 3.62 }, { v: 3.75 }] }, null), 'nmc', 'no LFP cell sits at 3.75 V');
  assert.equal(chemOf({ batteryType: 0, cells: [{ v: 3.62 }] }, null), 'lfp', 'only the byte is left');
  assert.equal(chemOf({ batteryType: 1 }, null), 'nmc');
  assert.equal(chemOf({ batteryType: 2 }, null), 'lto');
  assert.equal(chemOf({}, { cellOvp: 2.8 }), 'lto');
  for (const s of [null, {}, { cellOvp: NaN }, { cellOvp: 3.85 }, { cellOvp: 1 }, { cellOvp: '4.2' }]) assert.equal(chemOf({ batteryType: 7, cells: [{ v: 3.3 }, null, 'x'] }, s), null, JSON.stringify(s));
  assert.equal(chemOf(null, null), null);
});

test('chemistry curves: monotone, the % at a voltage clamps at both ends, slope is flat on the LFP plateau and steep at the NMC knee', () => {
  for (const [k, t] of Object.entries(CHEM)) for (let i = 1; i < t.length; i++) assert.ok(t[i][0] > t[i - 1][0] && t[i][1] > t[i - 1][1], `${k} row ${i}`);
  assert.equal(socAtCellV('nmc', 2.5), 0); assert.equal(socAtCellV('nmc', 4.5), 100); assert.equal(socAtCellV('nmc', 3.72), 50);
  assert.equal(socAtCellV('lfp', 3.0), 10);
  assert.equal(socAtCellV('xyz', 3.3), null); assert.equal(socAtCellV('nmc', NaN), null);
  assert.ok(slopeAt('lfp', 3.26) < 0.002 && slopeAt('nmc', 3.4) > 0.01);
});

test('curve: bins merge over days and live rows; discharge rows only; a % needs 3 rows; pack volts become cell volts', () => {
  const c = new Map();
  curveAdd(c, [{ s: 50, sv: 100, n: 2 }, { s: 50.4, sv: 50, n: 1 }, { s: 51, sv: 50, n: 1 }, null, { s: 'x', sv: 1, n: 1 }, { s: 120, sv: 1, n: 1 }, { s: 20, sv: 1, n: 0 }]);
  assert.deepEqual([...c.entries()], [[50, { sv: 150, n: 3 }], [51, { sv: 50, n: 1 }]]);
  assert.deepEqual(curvePoints(c, 1), [{ soc: 50, v: 50 }], '51 % has one row only');
  assert.deepEqual(curvePoints(c, 0), []);
  const rows = [{ p: 'a', soc: 50, v: 50, i: -5 }, { p: 'a', soc: 50, v: 52, i: 3 }, { p: 'b', soc: 50, v: 40, i: -5 }, { p: 'a', soc: 49.6, v: 49, i: -0.6 }, { p: 'a', soc: null, v: 49, i: -5 }];
  assert.deepEqual(curveBinsFromRows(rows, 'a'), [{ s: 50, sv: 99, n: 2 }], 'charging, another pack and a reading without SOC are left out');
});

test('2026-11-27 sea-hut pack: a 46 V cut-off on 14S is near 31 % by its own readings, not the 3 % a textbook curve gives, nor the 10 % default', () => {
  const pts = curvePoints(curveAdd(new Map(), bins(N11)), 14);
  const e = cutSoc({ chem: 'nmc', points: pts, cutCellV: 46 / 14 });
  assert.equal(e.how, 'fit'); assert.equal(e.low, 34);
  assert.ok(e.soc > 28 && e.soc < 34, `cut-off at ${e.soc} %`);
  assert.ok(cutSoc({ chem: 'nmc', points: [], cutCellV: 46 / 14 }).soc < 5, 'the curve alone says ~3 %: why the pack\'s own readings decide');
  // what the owner saw: at 52 % and 3.5 A the 10 % default said over a day; the 46 V cut-off says half that
  const capAh = 230, now = { remainAh: capAh * 0.52, nominalAh: capAh, currentA: -3.5 };
  const byPct = timeToGo({ ...now, cutoffPct: 10 }).hours, byV = timeToGo({ ...now, cutoffPct: Math.round(e.soc) }).hours;
  assert.ok(byPct > 27, `${byPct} h`); assert.ok(byV > 11 && byV < 16 && byV < byPct / 1.8, `${byV} h`);
});

test('cut-off seen: a stored reading at or below the cut-off voltage gives the % directly (interpolated); a cut-off above every reading is the top %', () => {
  const pts = [{ soc: 20, v: 3.20 }, { soc: 25, v: 3.30 }, { soc: 30, v: 3.40 }];
  const e = cutSoc({ chem: 'nmc', points: pts, cutCellV: 3.25 });
  assert.equal(e.how, 'seen'); assert.ok(Math.abs(e.soc - 22.5) < 1e-9);
  assert.equal(cutSoc({ chem: 'nmc', points: pts, cutCellV: 3.5 }).soc, 30);
});

test('LFP: on the plateau the readings say too little - the curve\'s knee decides; readings near the knee are used', () => {
  const plateau = [40, 45, 50, 55, 60].map((s) => ({ soc: s, v: 3.25 + (s - 40) * 0.0005 }));
  const e = cutSoc({ chem: 'lfp', points: plateau, cutCellV: 48 / 16 });
  assert.equal(e.how, 'curve'); assert.equal(e.soc, 10);
  const knee = [{ soc: 12, v: 3.05 }, { soc: 14, v: 3.1 }, { soc: 16, v: 3.15 }, { soc: 18, v: 3.19 }];
  const k = cutSoc({ chem: 'lfp', points: knee, cutCellV: 3.0 });
  assert.ok(k.how === 'fit' || k.how === 'offset'); assert.ok(k.soc >= 8 && k.soc <= 12, `${k.how} ${k.soc}`);
  // the same voltage drop, on either chemistry: a cut-off below every reading lands below the lowest reading
  for (const chem of ['lfp', 'nmc']) {
    const low = chem === 'lfp' ? knee : curvePoints(curveAdd(new Map(), bins(N11)), 14);
    const r = cutSoc({ chem, points: low, cutCellV: low[0].v - 0.05 });
    assert.ok(r.soc <= low[0].soc && r.soc >= 0, `${chem}: ${r.soc}`);
  }
});

test('one or two low readings: the offset between BMS % and curve % from them; never above the lowest reading, never below 0', () => {
  const e = cutSoc({ chem: 'nmc', points: [{ soc: 34, v: 3.394 }], cutCellV: 46 / 14 });
  assert.equal(e.how, 'offset'); assert.ok(e.soc > 28 && e.soc < 34, `${e.soc}`);
  assert.equal(cutSoc({ chem: 'nmc', points: [{ soc: 90, v: 4.1 }], cutCellV: 2.0 }).soc, 0);
  assert.ok(cutSoc({ chem: 'nmc', points: [{ soc: 30, v: 3.3 }, { soc: 31, v: 3.31 }], cutCellV: 3.29 }).soc <= 30);
});

test('bad input: no chemistry or no voltage -> null; garbage points ignored; effectiveCut by % or by volts', () => {
  assert.equal(cutSoc({ chem: null, points: [], cutCellV: 3.3 }), null);
  assert.equal(cutSoc({ chem: 'nmc', points: [], cutCellV: NaN }), null);
  assert.equal(cutSoc({ chem: 'nmc', points: [{ soc: 'x', v: 1 }, { soc: 5 }], cutCellV: 3.46 }).how, 'curve');
  assert.deepEqual(effectiveCut({ mode: 'pct', pct: 10 }), { pct: 10, mode: 'pct', v: null, est: null });
  assert.deepEqual(effectiveCut({ mode: 'pct', pct: NaN }), { pct: 0, mode: 'pct', v: null, est: null });
  assert.equal(effectiveCut({ mode: 'v', volts: 46, chem: 'nmc', points: [], cells: 0 }).pct, null, 'no cell count yet');
  assert.equal(effectiveCut({ mode: 'v', volts: 0, chem: 'nmc', points: [], cells: 14 }).pct, null);
  assert.equal(effectiveCut({ mode: 'v', volts: 46, chem: null, points: [], cells: 14 }).pct, null, 'unknown chemistry');
  const v = effectiveCut({ mode: 'v', volts: 46, chem: 'nmc', points: curvePoints(curveAdd(new Map(), bins(N11)), 14), cells: 14 });
  assert.equal(v.mode, 'v'); assert.equal(v.v, 46); assert.ok(v.pct >= 29 && v.pct <= 33); assert.equal(v.est.how, 'fit');
});
