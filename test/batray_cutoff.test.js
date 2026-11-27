// BatRay by ClearEvo.com - tests: the inverter's voltage cut-off, learned from the pack's own stored cuts
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
import { learnCut, cutDayFromRows, cutTol, cutSetting, viewerCut, effectiveCut, MIN_HOURS, USE_EVENTS, LEARN_DAYS } from '../public/batray/cutoff-logic.js';
import { timeToGo } from '../public/batray/trend.js';
import { etaModel, cutNote } from '../public/batray/view-logic.js';
import { I18N } from '../public/batray/i18n.js';

const T = I18N.en, H = 3600000, D0 = Date.UTC(2026, 10, 1), CUT = 46.0;
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
/** Rows of pack 'hut': `hours` of ordinary discharge (a row a minute here), then each cut: discharge rows 3 s apart
 *  down to the given volts at that %, then the load gone (0 A) and the voltage back up. */
function history({ hours = 30, t0 = D0, cuts = [] } = {}) {
  const rows = [];
  let t = t0;
  for (; t < t0 + hours * H; t += 60000) rows.push({ t, p: 'hut', soc: 60, v: 51.5, i: -8 });
  for (const { soc, tail, gapH = 6 } of cuts) {
    t += gapH * H;
    for (const v of tail) { rows.push({ t, p: 'hut', soc, v, i: -20 }); t += 3000; }
    for (const v of [47.6, 48.2, 48.5]) { rows.push({ t, p: 'hut', soc, v, i: 0 }); t += 3000; }
  }
  return rows;
}
/** What the store does: the rows split into UTC day files, one cutDay each, then learnCut. */
function learnRows(rows, volts = CUT) {
  const byDay = new Map();
  for (const r of rows) { const d = dayOf(r.t); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(r); }
  return learnCut([...byDay].map(([day, rs]) => ({ day, ...cutDayFromRows(rs, 'hut', volts) })), volts);
}

test('a cut: the BMS still read 46.1-46.3 V when the 46.0 V inverter dropped its load - learned at that %', () => {
  const l = learnRows(history({ cuts: [{ soc: 13, tail: [46.6, 46.4, 46.2, 46.1] }] }));
  assert.equal(l.ready, true, JSON.stringify(l)); assert.equal(l.soc, 13); assert.equal(l.n, 1);
  assert.equal(cutTol(46), 0.46); assert.equal(cutTol(12), 0.3);
});

test('a cut within 1-2 s leaves one stored row under the voltage - still a cut', () => {
  const l = learnRows(history({ cuts: [{ soc: 31, tail: [46.3, 46.1, 45.95] }] }));
  assert.equal(l.ready, true); assert.equal(l.soc, 31);
});

test('not a cut: a load that dips under the voltage and goes on discharging; a discharge that stops far above it (the sun came up at 50 V)', () => {
  const rows = history();
  let t = rows[rows.length - 1].t + 60000;
  for (const [v, i] of [[45.5, -60], [48.9, -9], [48.8, -9]]) { rows.push({ t, p: 'hut', soc: 40, v, i }); t += 3000; }   // a motor start
  for (const [v, i] of [[50.2, -6], [50.4, 3], [50.6, 9]]) { rows.push({ t, p: 'hut', soc: 45, v, i }); t += 3000; }     // dawn
  const l = learnRows(rows);
  assert.equal(l.ready, false); assert.equal(l.why, 'never');
  assert.match(cutNote(effectiveCut({ mode: 'v', volts: CUT, learn: l }), T, { days: LEARN_DAYS }), /no discharge of this pack stopped at or near 46\.0 V \(its lowest reading was 45\.5 V, at 40 %\)/);
});

test('a cut across UTC midnight (07:00 in Thailand, the pack\'s morning low) is stitched from the two day files and counts once', () => {
  const rows = history();
  const mid = D0 + 2 * 86400000;
  rows.push({ t: mid - 4000, p: 'hut', soc: 13, v: 46.1, i: -20 }, { t: mid - 1000, p: 'hut', soc: 13, v: 45.9, i: -20 }, { t: mid + 2000, p: 'hut', soc: 12, v: 47.7, i: 0 });
  const l = learnRows(rows);
  assert.equal(l.ready, true, JSON.stringify(l)); assert.equal(l.n, 1); assert.equal(l.soc, 13);
});

test('several cuts on one day count each; the median of the latest USE_EVENTS, older ones age out; the note gives the count and spread', () => {
  const cuts = [20, 22, 30, 33, 29, 31, 34].map((soc) => ({ soc, tail: [46.4, 46.1], gapH: 2 }));
  const l = learnRows(history({ cuts }));
  assert.equal(l.ready, true); assert.equal(l.n, USE_EVENTS); assert.equal(l.soc, 31, 'median of 34 31 29 33 30'); assert.equal(l.min, 29); assert.equal(l.max, 34);
  assert.match(cutNote(effectiveCut({ mode: 'v', volts: CUT, learn: l }), T), /about 31 % on this pack: the middle of the last 5 times a discharge stopped at or near 46\.0 V \(29 to 34 %\)/);
  const one = learnRows(history({ cuts: [{ soc: 31, tail: [46.2] }] }));
  assert.match(cutNote(effectiveCut({ mode: 'v', volts: CUT, learn: one }), T), /about 31 % on this pack, learned from the one time a discharge stopped at or near 46\.0 V/);
});

test('hours are hours of stored readings: gaps over 5 min (a frozen tab, the store off) do not count; under 24 h it is not ready and says so', () => {
  const rows = [];
  for (const k of [0, 1]) for (let j = 0; j < 100; j++) rows.push({ t: D0 + k * 86400000 + H + j * 3000, p: 'hut', soc: 50, v: 51, i: -5 }, { t: D0 + k * 86400000 + 14 * H + j * 3000, p: 'hut', soc: 13, v: 45.9, i: -20 });
  const l = learnRows(rows);
  assert.ok(l.hours < 1, `${l.hours}`); assert.equal(l.ready, false); assert.equal(l.why, 'hours');
  assert.match(cutNote(effectiveCut({ mode: 'v', volts: CUT, learn: l }), T), new RegExp(`0 h of stored readings so far, it needs ${MIN_HOURS} h`));
});

test('not ready: no number, the picture says "learning" while discharging, charging still counts to full', () => {
  const l = learnRows(history());
  const cut = effectiveCut({ mode: 'v', volts: CUT, learn: l });
  assert.equal(cut.pct, null);
  assert.equal(timeToGo({ remainAh: 120, nominalAh: 230, currentA: -3.5, cutoffPct: cut.pct }).kind, 'unknown');
  const e = etaModel({ remainAh: 120, nominalAh: 230, currentA: -3.5, cutoffPct: cut.pct, cutoffV: CUT }, T);
  assert.equal(e.kind, 'learning'); assert.equal(e.hidden, false); assert.match(e.text, /learning where 46\.0 V is/);
  assert.equal(etaModel({ remainAh: 120, nominalAh: 230, currentA: 8, cutoffPct: null, cutoffV: CUT }, T).kind, 'full');
});

test('the owner\'s case: at 52 % and 3.5 A the 10 % default said over a day; cuts learned at ~31 % say about half', () => {
  const l = learnRows(history({ cuts: [30, 31, 32].map((soc) => ({ soc, tail: [46.2] })) }));
  const now = { remainAh: 230 * 0.52, nominalAh: 230, currentA: -3.5 };
  const byPct = timeToGo({ ...now, cutoffPct: 10 }).hours, byV = timeToGo({ ...now, cutoffPct: effectiveCut({ mode: 'v', volts: CUT, learn: l }).pct }).hours;
  assert.ok(byPct > 27, `${byPct}`); assert.ok(byV > 12 && byV < 15, `${byV}`);
});

for (const lang of ['en', 'th']) test(`(${lang}) the "not ready" note never contradicts itself: a reading under the voltage without a cut is named as the lowest reading, not as "not reached"`, () => {
  const rows = history();
  let t = rows[rows.length - 1].t + 60000;
  for (const [v, i] of [[45.9, -60], [48.9, -9]]) { rows.push({ t, p: 'hut', soc: 40, v, i }); t += 3000; }
  const txt = cutNote(effectiveCut({ mode: 'v', volts: CUT, learn: learnRows(rows) }), I18N[lang], { days: LEARN_DAYS });
  assert.ok(!/not yet to|ยังไม่ถึง/.test(txt), txt);
});

test('in-memory rows and garbage: other packs, rows without SOC, null rows left out; empty input is not ready', () => {
  const d = cutDayFromRows([{ p: 'a', t: 1000, soc: 31, v: 45.9, i: -9 }, { p: 'a', t: 4000, soc: 31, v: 47, i: 0 }, { p: 'b', t: 2000, soc: 31, v: 40, i: -9 }, { p: 'a', t: 9000, soc: null, v: 40, i: -9 }, null], 'a', 46);
  assert.deepEqual(d, { n: 3, ms: 8000, ends: [{ t: 1000, soc: 31, v: 45.9 }], first: { t: 1000, i: -9 }, last: { t: 9000, soc: null, v: 40, i: -9 }, low: { v: 45.9, soc: 31 } });
  assert.deepEqual(cutDayFromRows([], 'a', 46), { n: 0, ms: 0, ends: [], first: null, last: null, low: null });
  for (const bad of [null, 'x', [null, { day: 5 }, { day: '2026-11-01', ms: 'x', ends: 'nope', low: { v: NaN } }]]) { const l = learnCut(bad, 46); assert.equal(l.ready, false); assert.equal(l.hours, 0); assert.equal(l.low, null); }
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

test('effectiveCut and the note: % mode untouched; no voltage; loading; no store; the demo', () => {
  assert.deepEqual(effectiveCut({ mode: 'pct', pct: 10 }), { pct: 10, mode: 'pct', v: null, learn: null });
  assert.deepEqual(effectiveCut({ mode: 'pct', pct: NaN }), { pct: 0, mode: 'pct', v: null, learn: null });
  assert.equal(effectiveCut({ mode: 'v', volts: null }).pct, null);
  assert.equal(cutNote(effectiveCut({ mode: 'v', volts: null }), T), T.cutNoteNoV);
  assert.equal(cutNote(effectiveCut({ mode: 'v', volts: 46, learn: null }), T, { loading: true }), T.cutNoteLoading);
  assert.equal(cutNote(effectiveCut({ mode: 'v', volts: 46, learn: { ready: false, why: 'store' } }), T), T.cutNoteStore);
  assert.equal(cutNote(effectiveCut({ mode: 'v', volts: 46, learn: { ready: false, why: 'demo' } }), T), T.cutNoteDemo);
  assert.equal(cutNote(effectiveCut({ mode: 'pct', pct: 10 }), T), '');
});

test('Fable round 2: a cut where the inverter\'s standby draw stays on the BMS (20 A -> 0.9 A) counts; a motor start (60 A -> 9 A) does not; a load that stops far under the setting is not "near" it', () => {
  const at = (tail) => learnRows((() => { const rows = history(); let t = rows[rows.length - 1].t + 60000; for (const [v, i, soc] of tail) { rows.push({ t, p: 'hut', soc, v, i }); t += 3000; } return rows; })());
  assert.equal(at([[46.2, -20, 14], [46.1, -20, 14], [47.4, -0.9, 14]]).soc, 14, 'standby draw after the cut');
  assert.equal(at([[46.2, -20, 14], [46.1, -20, 14], [47.4, -0.15, 14]]).soc, 14, 'the old dead zone between -0.2 and -0.1 A');
  assert.equal(at([[46.0, -60, 40], [48.9, -9, 40]]).why, 'never', 'a motor start');
  const far = learnRows((() => { const rows = history(); let t = rows[rows.length - 1].t + 60000; for (const [v, i] of [[49.0, -12], [49.4, 0]]) { rows.push({ t, p: 'hut', soc: 45, v, i }); t += 3000; } return rows; })(), 52.0);
  assert.equal(far.why, 'never', 'a 52.0 V setting does not learn a load switching off at 49.0 V');
});
