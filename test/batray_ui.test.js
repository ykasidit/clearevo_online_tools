// BatRay by ClearEvo.com - tests (batray_ui.test.js): tabs, sheets, Back, low power and the plain-language sheet contents
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
import { uiState, tabTap, sheetOpen, sheetClose, backDecision, lowPowerSet, motionAllowed, cellBalance, sheetModel, TABS } from '../public/batray/ui-logic.js';
import { decodeCellInfo } from '../public/batray/jkbms.js';
import { I18N } from '../public/batray/i18n.js';
import * as F from './batray_frames.js';

const T = I18N.en;
const owner = decodeCellInfo(F.OWNER_32S_CELL); assert.ok(owner.ok);
const ctx = (extra = {}) => ({ d: owner, settings: { maxChargeA: 50, maxDischargeA: 100 }, iEmaV: null, cutoffPct: 10, label: 'm-00', lang: 'en', langs: [{ code: 'en', name: 'English' }, { code: 'th', name: 'ไทย' }], res: '1920x1080', mode: 'auto', ...extra });

test('tabs exist only for the viewer; the reader has one screen', () => {
  const r = uiState('reader');
  assert.deepEqual(tabTap(r, 'history'), { action: 'noop' }); assert.equal(r.tab, 'now');
  const v = uiState('viewer');
  assert.deepEqual(tabTap(v, 'history'), { action: 'switch', tab: 'history' });
  assert.deepEqual(tabTap(v, 'history'), { action: 'noop' });
  assert.deepEqual(tabTap(v, 'bogus'), { action: 'noop' });
  assert.deepEqual(TABS, ['now', 'history', 'more']);
});

test('Back like a messenger: closes the sheet first, then returns to Now, then leaves', () => {
  const v = uiState('viewer'); tabTap(v, 'more');
  assert.deepEqual(sheetOpen(v, 'cells'), { action: 'open', kind: 'cells', replace: false });
  assert.deepEqual(sheetOpen(v, 'soc'), { action: 'open', kind: 'soc', replace: true });     // a second tile replaces the sheet, no extra history entry
  assert.deepEqual(backDecision(v), { action: 'close-sheet', kind: 'soc' }); assert.equal(v.sheet, null);
  assert.deepEqual(backDecision(v), { action: 'switch', tab: 'now' });
  assert.deepEqual(backDecision(v), { action: 'leave' });
  const r = uiState('reader'); sheetOpen(r, 'lang');
  assert.deepEqual(sheetClose(r), { action: 'close', kind: 'lang' }); assert.deepEqual(sheetClose(r), { action: 'noop' });
  assert.deepEqual(backDecision(r), { action: 'leave' });
});

test('low power and reduced motion stop decorative motion; hidden tabs too', () => {
  const ui = uiState('reader');
  assert.equal(motionAllowed(ui), true);
  assert.equal(motionAllowed(ui, { reducedMotion: true }), false);
  assert.equal(motionAllowed(ui, { visible: false }), false);
  assert.equal(lowPowerSet(ui, true), true); assert.equal(motionAllowed(ui), false);
  lowPowerSet(ui, 0); assert.equal(ui.lowPower, false);
});

test('cell balance in plain words: ok to 30 mV, watch to 60, act above', () => {
  assert.equal(cellBalance(0), 'ok'); assert.equal(cellBalance(30), 'ok'); assert.equal(cellBalance(31), 'watch'); assert.equal(cellBalance(60), 'watch'); assert.equal(cellBalance(61), 'act');
});

test('the battery sheet on the owner\'s frame: one plain sentence with the time to go, then the technical rows', () => {
  const m = sheetModel('soc', ctx(), T);
  assert.equal(m.title, T.sheetSocTitle);
  assert.ok(m.lead.startsWith(T.sheetSocLead(owner.soc)), m.lead);
  assert.ok(['ok', 'watch', 'act'].includes(m.tone));
  assert.deepEqual(m.rows.map((r) => r[0]), [T.shPackV, T.shSoh, T.shRemain, T.shCutoff]);
  assert.equal(m.rows[3][1], '10 %');
  assert.equal(sheetModel('soc', ctx({ d: null }), T).lead, T.noData);
  assert.equal(sheetModel('soc', ctx({ d: { ...owner, soc: 8 } }), T).tone, 'act');
});

test('the flow sheet: charging / load / idle sentence and the BMS limit', () => {
  const chg = sheetModel('flow', ctx({ d: { ...owner, current: 12.5, power: 650 } }), T);
  assert.equal(chg.lead, T.sheetFlowChg('650')); assert.equal(chg.tone, 'ok'); assert.equal(chg.rows[1][1], '50 A');
  const dis = sheetModel('flow', ctx({ d: { ...owner, current: -7, power: -362 } }), T);
  assert.equal(dis.lead, T.sheetFlowDis('362')); assert.equal(dis.rows[1][1], '100 A'); assert.equal(dis.rows[0][1], '-7.00 A');
  const idle = sheetModel('flow', ctx({ d: { ...owner, current: 0, power: 0 } }), T);
  assert.equal(idle.lead, T.sheetFlowIdle); assert.equal(idle.tone, '');
});

test('the BMS status sheet: no alarm, a blocked switch, or N alarms', () => {
  const ok = sheetModel('chips', ctx({ d: { ...owner, chgMos: true, dsgMos: true, errors: 0 } }), T);
  assert.equal(ok.lead, T.sheetChipsOk); assert.equal(ok.tone, 'ok'); assert.ok(ok.rows.length >= 4);
  const blocked = sheetModel('chips', ctx({ d: { ...owner, chgMos: false, dsgMos: true, errors: 0 } }), T);
  assert.equal(blocked.lead, T.sheetChipsBlocked); assert.equal(blocked.tone, 'watch'); assert.equal(blocked.rows[0][1], '!');
  const alarm = sheetModel('chips', ctx({ d: { ...owner, errors: (1 << 6) | (1 << 13) } }), T);
  assert.equal(alarm.lead, T.sheetChipsBad(1)); assert.equal(alarm.tone, 'act');
});

test('the cells sheet: balance sentence, lowest and highest by name', () => {
  const m = sheetModel('cells', ctx({ d: { cells: [{ n: 1, v: 3.301 }, { n: 2, v: 3.287 }, { n: 3, v: 3.352 }] } }), T);
  assert.equal(m.lead, T.cellsAct(65)); assert.equal(m.tone, 'act');
  assert.deepEqual(m.rows, [[T.shLow, '2: 3.287 V'], [T.shHigh, '3: 3.352 V'], [T.shDelta, '65 mV'], [T.shCount, '3']]);
  assert.equal(sheetModel('cells', ctx({ d: { cells: [] } }), T).lead, T.noData);
  assert.match(sheetModel('cells', ctx(), T).lead, /mV/);
});

test('choice sheets: language, TV resolution, keep-awake mark the current choice; the upload sheet keeps the full warning', () => {
  const l = sheetModel('lang', ctx(), T);
  assert.deepEqual(l.options, [{ id: 'en', label: 'English', on: true }, { id: 'th', label: 'ไทย', on: false }]);
  const r = sheetModel('res', ctx({ res: '1280x720' }), T);
  assert.deepEqual(r.options.map((o) => [o.id, o.on]), [['1280x720', true], ['1920x1080', false]]);
  const k = sheetModel('keepAwake', ctx({ mode: 'never' }), T);
  assert.deepEqual(k.options.map((o) => [o.id, o.on]), [['auto', false], ['always', false], ['never', true]]); assert.equal(k.lead, T.keepAwakePost);
  const u = sheetModel('upload', ctx(), T);
  const c = sheetModel('clearHist', ctx({ histDays: 3, histSize: '812 KB' }), T);
  assert.equal(c.title, T.histClear); assert.match(c.lead, /3 days, 812 KB/); assert.equal(c.tone, 'act');
  assert.deepEqual(c.actions.map((a) => a.id), ['cancel', 'ok']); assert.equal(c.actions[1].label, T.histClearGo);
  assert.equal(u.lead, T.uploadWarn); assert.deepEqual(u.actions.map((a) => [a.id, a.primary]), [['cancel', false], ['ok', true]]);
});
