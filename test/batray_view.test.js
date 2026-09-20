// BatRay by ClearEvo.com - tests (batray_view.test.js): what the picture, chips, time-to-go and TV frame show, replayed on real frames
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
import { fmt, fmtWh, fmtRuntime, fmtSpan, socClass, socLevel, flowDir, maxAmps, flowModel, etaModel, chipList, cellsStat, ageLabel, buildTvModel, LEVEL_TOP, LEVEL_H } from '../public/batray/view-logic.js';
import { decodeCellInfo } from '../public/batray/jkbms.js';
import { I18N } from '../public/batray/i18n.js';
import * as F from './batray_frames.js';

const T = I18N.en;
const owner = decodeCellInfo(F.OWNER_32S_CELL);          // the owner's own 16-cell pack, 2026-09-11
assert.ok(owner.ok);

test('formatting: numbers, Wh vs kWh, runtimes, spans', () => {
  assert.equal(fmt(null), '-'); assert.equal(fmt(NaN), '-'); assert.equal(fmt(3.14159, 2, ' V'), '3.14 V'); assert.equal(fmt(7, 0), '7');
  assert.equal(fmtWh(999.4), '999 Wh'); assert.equal(fmtWh(1000), '1.00 kWh'); assert.equal(fmtWh(12345), '12.35 kWh');
  assert.equal(fmtRuntime(0, T), '-'); assert.equal(fmtRuntime(90061, T), T.dh(1, 1)); assert.equal(fmtRuntime(3720, T), T.hm(1, 2));
  assert.equal(fmtSpan(NaN, T), '-'); assert.equal(fmtSpan(0.5, T), T.mOnly(30)); assert.equal(fmtSpan(26.5, T), T.dh(1, 2)); assert.equal(fmtSpan(1e6, T), T.etaCapped);
});

test('the battery level: height from the SOC, red at 10 %, amber at 25 %, the cut-off line where the field says', () => {
  assert.equal(socClass(null), ''); assert.equal(socClass(10), 'on crit'); assert.equal(socClass(11), 'on low'); assert.equal(socClass(25), 'on low'); assert.equal(socClass(26), 'on'); assert.equal(socClass(100), 'on');
  const lv = socLevel(63, 10);
  assert.equal(lv.h, (LEVEL_H * 0.63).toFixed(2)); assert.equal(lv.y, (LEVEL_TOP + LEVEL_H - LEVEL_H * 0.63).toFixed(2)); assert.equal(lv.socTxt, '63%'); assert.equal(lv.cls, 'on');
  assert.equal(lv.cutPath, 'M9 137.8 H111'); assert.equal(lv.cutShown, true);
  assert.deepEqual(socLevel(null, 0), { y: '151.00', h: '0.00', cls: '', socTxt: '-', cutPath: 'M9 151.0 H111', cutShown: false });
  assert.equal(socLevel(150, 20).h, LEVEL_H.toFixed(2));          // clamped
  assert.equal(socLevel(0, 20).cutPath, 'M9 124.6 H111');
});

test('the flow on the owner\'s frame: direction, line width against the BMS limit, labels', () => {
  const settings = { maxChargeA: 50, maxDischargeA: 100 };
  const m = flowModel(owner, settings, T);
  assert.equal(m.dir, flowDir(owner.current));
  assert.equal(m.maxA, maxAmps(m.dir, settings));
  assert.match(m.powerTxt, /\d+ W$/); assert.match(m.ampsTxt, /A/); assert.match(m.battLine, /V/);
  assert.equal(flowDir(0.05), 'idle'); assert.equal(flowDir(0.06), 'chg'); assert.equal(flowDir(-0.06), 'dis'); assert.equal(flowDir(null), 'idle');
  const chg = flowModel({ current: 25, power: 1300, packV: 52.1, soh: 100 }, settings, T);
  assert.equal(chg.dir, 'chg'); assert.equal(chg.width, 3 + 15 * 0.5); assert.equal(chg.dashArray, '20.5 20.5'); assert.equal(chg.sysLbl, T.charger); assert.equal(chg.cls, 'chg');
  assert.equal(chg.powerTxt, `${T.flowCharge} 1300 W`); assert.equal(chg.ampsTxt, T.ofMax('25.00', '50'));
  const dis = flowModel({ current: -200, power: -10000, packV: 48, soh: 90 }, settings, T);
  assert.equal(dis.dir, 'dis'); assert.equal(dis.width, 18);         // capped at the limit
  const idle = flowModel({ current: null, power: null }, null, T);
  assert.deepEqual([idle.dir, idle.width, idle.cls, idle.powerTxt, idle.ampsTxt, idle.sysLbl], ['idle', 3, '', '-', T.noCurrent, T.system]);
});

test('time to go: counts down to the inverter cut-off while discharging, to full while charging, hidden without capacity', () => {
  const dis = etaModel({ remainAh: 100, nominalAh: 200, currentA: -10, cutoffPct: 10 }, T);
  assert.equal(dis.kind, 'empty'); assert.equal(dis.text, T.etaEmpty(fmtSpan(8, T), 10)); assert.equal(dis.bad, false); assert.equal(dis.hidden, false);
  const chg = etaModel({ remainAh: 100, nominalAh: 200, currentA: 20, cutoffPct: 10 }, T);
  assert.equal(chg.kind, 'full'); assert.equal(chg.text, T.etaFull(fmtSpan(5, T)));
  const at = etaModel({ remainAh: 15, nominalAh: 200, currentA: -10, cutoffPct: 10 }, T);
  assert.equal(at.kind, 'atCutoff'); assert.equal(at.text, T.etaAtCutoff); assert.equal(at.bad, true);
  const jk04 = etaModel({ remainAh: undefined, nominalAh: undefined, currentA: -10, cutoffPct: 10 }, T);
  assert.equal(jk04.hidden, true); assert.equal(jk04.text, '');
});

test('status chips: MOS switches, balancing, temperatures, heating, the alarm line - on the owner\'s frame and on a faulty one', () => {
  const chips = chipList(owner, T);
  const txt = chips.map((c) => c.txt).join(' | ');
  assert.ok(chips.length >= 4, txt);
  assert.equal(chips[chips.length - 1].txt, T.chipAlarmNone); assert.equal(chips[chips.length - 1].cls, 'ok');
  assert.ok(chips.some((c) => c.txt === T.chipChg(!!owner.chgMos)));
  const bad = chipList({ chgMos: false, dsgMos: true, balancing: true, tempMos: 41.2, temp1: 30, temp2: null, heating: true, errors: (1 << 6) | (1 << 13) }, T);
  assert.deepEqual(bad.map((c) => c.cls), ['bad', 'ok', 'warn', '', 'warn', 'bad']);
  assert.equal(bad[3].txt, T.chipTemp('41°', '30°', '-'));
  assert.equal(bad[5].txt, T.chipAlarm(2, 'Charge overcurrent, Discharge overcurrent'));
  assert.deepEqual(chipList({}, T), [{ cls: 'ok', txt: T.chipAlarmNone }]);
});

test('the cell line names the lowest and highest cell with the delta in mV; nothing below two cells', () => {
  assert.equal(cellsStat({ cells: [] }, T), ''); assert.equal(cellsStat({ cells: [{ n: 1, v: 3.3 }] }, T), '');
  assert.equal(cellsStat({ cells: [{ n: 1, v: 3.301 }, { n: 2, v: 3.287 }, { n: 3, v: 3.312 }] }, T), T.cellsStat(25, '3.287', 2, '3.312', 3));
  assert.match(cellsStat(owner, T), /mV/);
});

test('"updated": just now under 2 s, N s ago after, amber past 15 s, "no data" without a reading', () => {
  assert.deepEqual(ageLabel(null, T), { text: T.noData, stale: false });
  assert.deepEqual(ageLabel(1, T), { text: T.justNow, stale: false });
  assert.deepEqual(ageLabel(9, T), { text: T.agoS(9), stale: false });
  assert.deepEqual(ageLabel(16, T), { text: T.agoS(16), stale: true });
});

test('the TV frame model: waiting without a reading; with one, the same numbers as the picture, the cut-off and staleness', () => {
  const now = Date.UTC(2026, 8, 20, 3, 4, 5);
  const w = buildTvModel({ label: 'm-00', demo: true, data: null, settings: null, iEmaV: null, lastFrameAt: null, now, cutoffPct: 10, T });
  assert.equal(w.waiting, true); assert.equal(w.footer, T.demoBadge); assert.equal(w.updatedTxt, T.noData); assert.match(w.clock, /^\d\d:\d\d:\d\d$/);
  const m = buildTvModel({ label: 'm-00', demo: false, data: owner, settings: { maxChargeA: 50, maxDischargeA: 100 }, iEmaV: -3.2, lastFrameAt: now - 20000, now, cutoffPct: 12, T });
  const f = flowModel(owner, { maxChargeA: 50, maxDischargeA: 100 }, T);
  assert.equal(m.soc, owner.soc); assert.equal(m.cutoffPct, 12); assert.equal(m.dir, f.dir); assert.equal(m.powerTxt, f.powerTxt); assert.equal(m.ampsTxt, f.ampsTxt); assert.equal(m.battLine, f.battLine);
  assert.equal(m.etaTxt, etaModel({ remainAh: owner.remainAh, nominalAh: owner.nominalAh, currentA: -3.2, cutoffPct: 12 }, T).text);   // the smoothed current, not the raw one
  assert.deepEqual(m.chips, chipList(owner, T)); assert.equal(m.stale, true); assert.equal(m.updatedTxt, T.agoS(20)); assert.equal(m.footer, ''); assert.equal(m.brand, 'BatRay by ClearEvo.com');
});
