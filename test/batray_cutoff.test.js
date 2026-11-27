// BatRay by ClearEvo.com - tests: the inverter's voltage cut-off, learned from the pack's own stored discharges
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
import { dayCutSoc, learnCut, cutDayFromRows, cutSetting, viewerCut, effectiveCut, MIN_HOURS, BELOW_ROWS, USE_EVENTS } from '../public/batray/cutoff-logic.js';
import { timeToGo } from '../public/batray/trend.js';
import { etaModel, cutNote } from '../public/batray/view-logic.js';
import { I18N } from '../public/batray/i18n.js';

const T = I18N.en, H = 3600000, D0 = Date.UTC(2026, 10, 1);
const day = (k) => new Date(D0 + k * 86400000).toISOString().slice(0, 10);
/** a stored day: 20 h of readings, optionally a discharge that sat under the cut-off at `cutAt` % for `rows` rows */
const stored = (k, { cutAt = null, rows = 4, low = null } = {}) => ({ day: day(k), first: D0 + k * 86400000, last: D0 + k * 86400000 + 20 * H, n: 24000, below: cutAt === null ? [] : [{ s: cutAt, n: rows - 1 }, { s: cutAt - 1, n: 1 }], low: low || (cutAt === null ? { v: 49.9, soc: 52 } : { v: 45.6, soc: cutAt - 1 }) });

test('a day\'s evidence: the highest % with BELOW_ROWS rows at or under the cut-off counted from the top - a single surge is not a cut', () => {
  assert.equal(dayCutSoc([{ s: 31, n: 1 }, { s: 30, n: 5 }]), 30, 'one row at 31 % is not enough on its own');
  assert.equal(dayCutSoc([{ s: 32, n: 1 }, { s: 31, n: 1 }]), 31, 'two rows, counted from the top');
  assert.equal(dayCutSoc([{ s: 60, n: 1 }]), null, 'one surge row');
  assert.equal(dayCutSoc([{ s: 40, n: BELOW_ROWS }]), 40);
  for (const bad of [null, [], [null, { s: 'x', n: 9 }, { s: 30, n: 0 }, { s: 30, n: -4 }]]) assert.equal(dayCutSoc(bad), null);
});

test('not ready under a day of readings: says how many hours are stored and how many are needed', () => {
  const l = learnCut([{ day: day(0), first: D0, last: D0 + 5 * H, n: 6000, below: [{ s: 31, n: 9 }], low: { v: 45.8, soc: 31 } }]);
  assert.deepEqual({ ready: l.ready, why: l.why, hours: l.hours }, { ready: false, why: 'hours', hours: 5 });
  assert.match(cutNote(effectiveCut({ mode: 'v', volts: 46, learn: l }), T), new RegExp(`5 h of stored readings so far, it needs ${MIN_HOURS} h`));
});

test('not ready without a discharge to the cut-off: says how low the pack went and that it needs one discharge there; no number, no time to go', () => {
  const l = learnCut([stored(0), stored(1), stored(2, { low: { v: 47.52, soc: 34 } })]);
  assert.equal(l.ready, false); assert.equal(l.why, 'never'); assert.deepEqual(l.low, { v: 47.52, soc: 34 });
  const cut = effectiveCut({ mode: 'v', volts: 46, learn: l });
  assert.equal(cut.pct, null);
  assert.match(cutNote(cut, T), /went down to 47\.5 V \(at 34 %\), not yet to 46\.0 V\. It needs one discharge to 46\.0 V/);
  assert.equal(timeToGo({ remainAh: 120, nominalAh: 230, currentA: -3.5, cutoffPct: cut.pct }).kind, 'unknown');
  const e = etaModel({ remainAh: 120, nominalAh: 230, currentA: -3.5, cutoffPct: cut.pct, cutoffV: 46 }, T);
  assert.equal(e.kind, 'learning'); assert.equal(e.hidden, false); assert.match(e.text, /learning where 46\.0 V is/);
  assert.equal(etaModel({ remainAh: 120, nominalAh: 230, currentA: 8, cutoffPct: null, cutoffV: 46 }, T).kind, 'full', 'charging still counts to full');
});

test('learned: one discharge gives its %, more give the median of the latest USE_EVENTS (older ones age out); the note says how many and the spread', () => {
  const one = learnCut([stored(0), stored(1, { cutAt: 31 })]);
  assert.equal(one.ready, true); assert.equal(one.soc, 31); assert.equal(one.n, 1);
  assert.match(cutNote(effectiveCut({ mode: 'v', volts: 46, learn: one }), T), /about 31 % on this pack, learned from its last discharge to 46\.0 V/);
  const many = learnCut([stored(0, { cutAt: 20 }), stored(1, { cutAt: 22 }), stored(2, { cutAt: 30 }), stored(3, { cutAt: 33 }), stored(4, { cutAt: 29 }), stored(5, { cutAt: 31 }), stored(6, { cutAt: 34 })]);
  assert.equal(many.n, USE_EVENTS); assert.equal(many.soc, 31, 'median of 34 31 29 33 30'); assert.equal(many.min, 29); assert.equal(many.max, 34);
  assert.deepEqual(many.days, [day(6), day(5), day(4), day(3), day(2)]);
  assert.match(cutNote(effectiveCut({ mode: 'v', volts: 46, learn: many }), T), /about 31 % on this pack: the middle of its last 5 discharges to 46\.0 V \(29 to 34 %\)/);
  const two = learnCut([stored(0, { cutAt: 30 }), stored(1, { cutAt: 33 })]);
  assert.equal(two.soc, 31.5); assert.equal(effectiveCut({ mode: 'v', volts: 46, learn: two }).pct, 32);
});

test('the owner\'s case: at 52 % and 3.5 A the 10 % default said over a day; a learned 31 % cut-off says half that', () => {
  const l = learnCut([stored(0), stored(1, { cutAt: 31 }), stored(2, { cutAt: 30 }), stored(3, { cutAt: 32 })]);
  const now = { remainAh: 230 * 0.52, nominalAh: 230, currentA: -3.5 };
  const byPct = timeToGo({ ...now, cutoffPct: 10 }).hours, byV = timeToGo({ ...now, cutoffPct: effectiveCut({ mode: 'v', volts: 46, learn: l }).pct }).hours;
  assert.ok(byPct > 27, `${byPct}`); assert.ok(byV > 12 && byV < 15, `${byV}`);
});

test('in-memory rows give the same day facts as the SQL; other packs, charging and rows without SOC are left out', () => {
  const rows = [{ p: 'a', t: 1, soc: 31.4, v: 45.9, i: -9 }, { p: 'a', t: 2, soc: 30.6, v: 45.8, i: -9 }, { p: 'a', t: 3, soc: 31, v: 45.0, i: 2 }, { p: 'b', t: 4, soc: 31, v: 40, i: -9 }, { p: 'a', t: 9, soc: null, v: 40, i: -9 }, null];
  assert.deepEqual(cutDayFromRows(rows, 'a', 46), { first: 1, last: 9, n: 4, below: [{ s: 31, n: 2 }], low: { v: 45.8, soc: 30.6 } });
  assert.deepEqual(cutDayFromRows([], 'a', 46), { first: null, last: null, n: 0, below: [], low: null });
});

test('settings: sane numbers or null; a viewer uses its own for the room, else the reader\'s, else the default', () => {
  assert.deepEqual(cutSetting({ mode: 'v', pct: 12.4, v: 46.04 }), { mode: 'v', pct: 12, v: 46 });
  assert.deepEqual(cutSetting({ mode: 'x', pct: 200, v: -3 }), { mode: 'pct', pct: 95, v: null });
  assert.deepEqual(cutSetting({ pct: NaN, v: '46' }), { mode: 'pct', pct: 10, v: null });
  for (const bad of [null, undefined, 5, 'v']) assert.equal(cutSetting(bad), null);
  const reader = { mode: 'v', pct: 10, v: 46 };
  assert.deepEqual(viewerCut(undefined, reader), { mode: 'v', pct: 10, v: 46, from: 'reader' });
  assert.deepEqual(viewerCut({ mode: 'pct', pct: 20, v: null }, reader), { mode: 'pct', pct: 20, v: null, from: 'own' });
  assert.deepEqual(viewerCut(null, null), { mode: 'pct', pct: 10, v: null, from: 'default' });
  assert.deepEqual(viewerCut(null, 'junk'), { mode: 'pct', pct: 10, v: null, from: 'default' });
});

test('effectiveCut: % mode untouched; voltage mode without a voltage, or with nothing learned yet, gives no %; garbage days are skipped', () => {
  assert.deepEqual(effectiveCut({ mode: 'pct', pct: 10 }), { pct: 10, mode: 'pct', v: null, learn: null });
  assert.deepEqual(effectiveCut({ mode: 'pct', pct: NaN }), { pct: 0, mode: 'pct', v: null, learn: null });
  assert.equal(effectiveCut({ mode: 'v', volts: null }).pct, null);
  assert.equal(effectiveCut({ mode: 'v', volts: 46, learn: null }).pct, null);
  assert.equal(cutNote(effectiveCut({ mode: 'v', volts: null }), T), T.cutNoteNoV);
  assert.equal(cutNote(effectiveCut({ mode: 'v', volts: 46, learn: null }), T, { loading: true }), T.cutNoteLoading);
  assert.equal(cutNote(effectiveCut({ mode: 'v', volts: 46, learn: { ready: false, why: 'store' } }), T), T.cutNoteStore);
  assert.equal(cutNote(effectiveCut({ mode: 'v', volts: 46, learn: { ready: false, why: 'demo' } }), T), T.cutNoteDemo);
  assert.equal(cutNote(effectiveCut({ mode: 'pct', pct: 10 }), T), '');
  const l = learnCut([null, { day: 5 }, { day: day(0), first: 'x', last: null, below: 'nope', low: { v: NaN } }]);
  assert.equal(l.ready, false); assert.equal(l.hours, 0); assert.equal(l.low, null);
  assert.equal(learnCut(null).why, 'hours');
});
