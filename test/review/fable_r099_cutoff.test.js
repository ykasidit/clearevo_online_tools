// BatRay by ClearEvo.com - review tests (0.9.99): the learned voltage cut-off; each test fails on the reviewed commit
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
import { readFileSync } from 'node:fs';
import { learnCut, cutDayFromRows, effectiveCut, LEARN_DAYS } from '../../public/batray/cutoff-logic.js';
import { cutNote } from '../../public/batray/view-logic.js';
import { I18N } from '../../public/batray/i18n.js';

const H = 3600000, D0 = Date.UTC(2026, 10, 1), CUT = 46.0;
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
/** 30 h of ordinary stored rows (a row per 3 s is thinned to one per minute here), then the given tail 3 s apart */
function history(tail, t0 = D0) {
  const rows = [];
  for (let t = t0; t < t0 + 30 * H; t += 60000) rows.push({ t, p: 'hut', soc: 60, v: 51.5, i: -8 });
  let t = t0 + 30 * H;
  for (const [v, i, soc] of tail) { rows.push({ t, p: 'hut', soc, v, i }); t += 3000; }
  return rows;
}
function learnRows(rows) {
  const byDay = new Map();
  for (const r of rows) { const d = dayOf(r.t); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(r); }
  return learnCut([...byDay].map(([day, rs]) => ({ day, ...cutDayFromRows(rs, 'hut', CUT) })), CUT);
}

// R1 (high): the inverter measures at its own terminals (cable drop, its own calibration) and cuts the moment IT sees
// the setting. The BMS's stored rows end a little above the setting and the current stops: no row is ever "at or under".
test('R1a: a real cut the BMS saw end at 46.1 V (inverter set to 46.0 V) is learned', () => {
  const l = learnRows(history([[46.6, -20, 14], [46.4, -20, 13], [46.2, -20, 13], [46.1, -20, 13], [47.6, 0, 13], [48.2, 0, 13], [48.5, 0, 13]]));
  assert.equal(l.ready, true, `the discharge ended at the cut-off and the load dropped to 0 A; got ${JSON.stringify(l)}`);
  assert.equal(l.soc, 13);
});
test('R1b: an inverter that cuts within 1-2 s leaves ONE stored row under the voltage, and that is a cut', () => {
  const l = learnRows(history([[46.3, -20, 13], [46.1, -20, 13], [45.95, -20, 13], [47.6, 0, 13], [48.2, 0, 13]]));
  assert.equal(l.ready, true, `one row under, then the load is gone; got ${JSON.stringify(l)}`);
});

// R2 (high): "counted from the top" takes the FIRST two rows of the day under the voltage, wherever they are. Two
// surge dips the inverter rode through (its cut has a delay) win over the forty rows where the discharge really ended.
test('R2: two separate one-row surge dips at 24 % / 23 % are not cuts; the discharge that stopped at 12 % is', () => {
  const rows = history([[45.8, -60, 24], [48.9, -9, 24], [45.8, -60, 23], [48.9, -9, 23], [46.2, -20, 12], [45.9, -20, 12], [47.6, 0, 12]]);
  const l = learnRows(rows);
  assert.equal(l.ready, true); assert.equal(l.soc, 12, `learned ${l.soc} %, the pack was cut at 12 %`);
});

test('R3: a discharge to the cut-off that straddles UTC midnight is one discharge, and it is learned', () => {
  const mid = D0 + 2 * 86400000, rows = history([]).concat([
    { t: mid - 4000, p: 'hut', soc: 13, v: 46.1, i: -20 }, { t: mid - 1000, p: 'hut', soc: 13, v: 45.9, i: -20 },
    { t: mid + 2000, p: 'hut', soc: 13, v: 45.8, i: -20 }, { t: mid + 5000, p: 'hut', soc: 13, v: 47.7, i: 0 }]);
  const l = learnRows(rows);
  assert.equal(l.ready, true, `two rows under the voltage, one each side of midnight; got why=${l.why}`);
  assert.equal(l.n, 1, 'and it counts once, not once per day');
});

// R4 (medium): "24 h of stored readings" is the sum of (last - first) per day, whatever lies between.
test('R4: two 5-minute sessions 13 h apart on each of two days are not "24 h of stored readings"', () => {
  const days = [0, 1].map((k) => {
    const a = D0 + k * 86400000 + H, rows = [];
    for (let j = 0; j < 100; j++) rows.push({ t: a + j * 3000, p: 'hut', soc: 50, v: 51, i: -5 }, { t: a + 13 * H + j * 3000, p: 'hut', soc: 13, v: 45.9, i: -20 });
    return { day: dayOf(a), ...cutDayFromRows(rows, 'hut', CUT) };
  });
  const l = learnCut(days, CUT);
  assert.ok(l.hours < 1, `20 minutes of rows counted as ${l.hours.toFixed(1)} h`);
  assert.equal(l.ready, false);
});

// R5 (medium, text): one stored row under the voltage -> 'never', and the note then contradicts itself.
for (const lang of ['en', 'th']) test(`R5 (${lang}): the note never says the pack has not reached a voltage it names a lower reading for`, () => {
  const rows = history([[46.2, -20, 13], [45.9, -20, 13], [47.6, 0, 13]]);
  const l = learnRows(rows), txt = cutNote(effectiveCut({ mode: 'v', pct: 10, volts: CUT, learn: l }), I18N[lang], { days: LEARN_DAYS });
  assert.ok(!(l.ready === false && l.low && l.low.v <= CUT && /45\.9/.test(txt)), `"${txt}"`);
});

// ---- the shell: learnFor / learnDue / learnSoon lifted out of app.js and run over stubs ----
const SRC = readFileSync(new URL('../../public/batray/app.js', import.meta.url), 'utf8');
function shell({ cutDays, clock }) {
  const a = SRC.indexOf('const LEARN_MS'), b = SRC.indexOf('function renderEta(', a);
  assert.ok(a > 0 && b > a, 'app.js: learnFor / learnDue not found');
  const code = `${SRC.slice(a, b)}\nfunction renderEta(p) { learnDue(p); }\nreturn { learnDue };`;
  const p = { label: 'hut', demo: false, data: {}, learn: null, learnV: null, learnAt: 0, learnLoading: false, cutCache: null, cutCacheV: null, cutDirty: false, plog: () => {} };
  const env = { hist: { cutDays }, daysInRange: (from, to) => { const o = []; for (let t = from; t <= to; t += 86400000) o.push(dayOf(t)); return o; }, dayKey: (t) => dayOf(t), LEARN_DAYS, learnCut, active: p, renderFlow: () => {}, cutSet: () => ({ mode: 'v', pct: 10, v: CUT }), histMem: { ready: true }, histS: { backend: 'opfs' }, isCorrupt: () => false, corruptDb: async () => {}, Date: { now: () => clock.t } };
  return { p, ...new Function(...Object.keys(env), code)(...Object.values(env)) };
}
const turns = async (n = 20) => { for (let k = 0; k < n; k++) await new Promise((r) => { setImmediate(r); }); };

test('R6: a failed read of the stored history is tried again in a minute, not at once', async () => {
  let calls = 0;
  const s = shell({ clock: { t: D0 + 40 * 86400000 }, cutDays: () => { calls++; return calls > 50 ? new Promise(() => {}) : Promise.reject(new Error('database is corrupt')); } });
  s.learnDue(s.p);
  await turns();
  for (let k = 0; k < 5; k++) { s.learnDue(s.p); await turns(2); }               // five more frames, same second
  assert.equal(calls, 1, `the store was asked ${calls} times within the same second`);
});

test('R7: a night of frames re-reads the past days once; only today again every 10 minutes', async () => {
  const clock = { t: D0 + 40 * 86400000 + 12 * H }, today = dayOf(clock.t);
  let past = 0, todays = 0;
  const s = shell({ clock, cutDays: (p, v, days) => { past += days.filter((x) => x !== today).length; todays += days.filter((x) => x === today).length; return Promise.resolve([]); } });
  s.learnDue(s.p); await turns(3);
  for (let k = 0; k < 1200; k++) { clock.t += 3000; s.learnDue(s.p); await turns(1); }   // an hour of frames
  assert.ok(past <= LEARN_DAYS + 1, `${past} past-day reads in an hour (each past day is needed once)`);
  assert.ok(todays <= 8, `${todays} reads of today in an hour`);
});
