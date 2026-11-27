// BatRay by ClearEvo.com - review tests, round 2 (0.9.99): the learned voltage cut-off; each fails on the reviewed commit
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

const H = 3600000, DAY = 86400000, D0 = Date.UTC(2026, 10, 1), CUT = 46.0;
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
/** rows 3 s apart from [v, i, soc] */
const rows = (list, t0 = D0 + H) => list.map(([v, i, soc], k) => ({ t: t0 + k * 3000, p: 'hut', v, i, soc }));

// S1 (medium): after its low-voltage cut an inverter still feeds itself (display, MPPT, fan): the load falls from
// 20 A to a standby draw, not to 0 A. A BMS that reports that draw never shows "next row above -0.1 A".
test('S1a: 20 A falling to a 0.9 A standby draw at the voltage is a cut', () => {
  const d = cutDayFromRows(rows([[46.4, -20, 13], [46.1, -20, 13], [47.5, -0.9, 13], [47.9, -0.9, 13], [48.0, -0.9, 13]]), 'hut', CUT);
  assert.equal(d.ends.length, 1, 'the load dropped by 95 % in one row at 46.1 V');
});
test('S1b: a next row of -0.15 A (between "discharging" -0.2 and "stopped" -0.1) does not hide the cut', () => {
  const d = cutDayFromRows(rows([[46.1, -20, 13], [47.5, -0.15, 13], [47.9, -0.15, 13]]), 'hut', CUT);
  assert.equal(d.ends.length, 1);
});

// S2 (medium): the rule has no lower side. A voltage set above where the inverter really cuts turns every load that
// switches off under it into "a discharge stopped at or near V (the inverter cutting)".
test('S2: with 52.0 V set, a kettle switching off at 49.0 V is not a stop "at or near 52.0 V"', () => {
  const d = cutDayFromRows(rows([[49.1, -30, 41], [49.0, -30, 41], [50.6, 0, 41], [50.8, 0, 41]]), 'hut', 52.0);
  assert.equal(d.ends.length, 0, `counted as a cut at ${d.ends[0] && d.ends[0].v} V, 3 V under the setting`);
});

// ---- the shell: learnFor / learnDue lifted out of app.js and run over stubs ----
const SRC = readFileSync(new URL('../../public/batray/app.js', import.meta.url), 'utf8');
function shell({ cutDays, clock, set }) {
  const a = SRC.indexOf('const LEARN_MS'), b = SRC.indexOf('function renderEta(', a);
  assert.ok(a > 0 && b > a, 'app.js: learnFor / learnDue not found');
  const p = { label: 'hut', demo: false, data: {}, learn: null, learnV: null, learnAt: 0, learnLoading: false, cutCache: null, cutCacheV: null, cutCacheAt: 0, cutDirty: false, plog: () => {} };
  const env = { hist: { cutDays }, dayKey: dayOf, daysInRange: (from, to) => { const o = []; for (let t = Math.floor(from / DAY) * DAY; t <= to; t += DAY) o.push(dayOf(t)); return o; }, LEARN_DAYS, learnCut, isCorrupt: () => false, corruptDb: async () => {}, active: p, renderFlow: () => {}, cutSet: () => set, histMem: { ready: true }, histS: { backend: 'opfs' }, Date: { now: () => clock.t } };
  return { p, ...new Function(...Object.keys(env), `${SRC.slice(a, b)}\nfunction renderEta(p) { learnDue(p); }\nreturn { learnDue };`)(...Object.values(env)) };
}
const turns = async (n = 5) => { for (let k = 0; k < n; k++) await new Promise((r) => { setImmediate(r); }); };
/** what the picture uses, as cutFor() in app.js builds it */
const shown = (p, set) => effectiveCut({ mode: set.mode, pct: set.pct, volts: set.v, learn: p.learnV === set.v ? p.learn : null });
const cutDayFacts = (t0, soc) => ({ day: dayOf(t0), n: 30000, ms: 25 * H, ends: [{ t: t0 + H, soc, v: 46.1 }], first: { t: t0, i: -5 }, last: { t: t0 + 23 * H, soc: 60, v: 52, i: 2 }, low: { v: 46.1, soc } });

// S3 (high): a failed read marks the NEW voltage as read (learnV = volts) and keeps the OLD voltage's result, so the
// picture, the chart line and the time to go use the % learned for another voltage - until a read succeeds.
test('S3: after the voltage changes and the read fails, the % learned for the old voltage is not shown for the new one', async () => {
  const clock = { t: D0 + 40 * DAY + 12 * H }, set = { mode: 'v', pct: 10, v: 46.0 };
  let fail = false;
  const s = shell({ clock, set, cutDays: () => (fail ? Promise.reject(new Error('timeout')) : Promise.resolve([cutDayFacts(clock.t - 2 * DAY, 13)])) });
  s.learnDue(s.p); await turns();
  assert.equal(shown(s.p, set).pct, 13, 'learned at 46.0 V');
  set.v = 50.0; s.p.learnAt = 0; s.p.cutCache = null; fail = true;          // cutChanged(), then the store times out
  s.learnDue(s.p); await turns();
  assert.equal(shown(s.p, set).pct, null, `50.0 V shown at ${shown(s.p, set).pct} %, which was learned for 46.0 V`);
});

// S4 (medium): all 31 days go to the worker in ONE call under one 15 s deadline; a failure keeps nothing. A phone
// too slow for that read never learns, and repeats the whole read every minute (the worker runs it to the end each
// time, with the inserts queued behind it).
test('S4: a store too slow for 31 days in one call still learns, a few days at a time', async () => {
  const clock = { t: D0 + 40 * DAY + 12 * H }, set = { mode: 'v', pct: 10, v: 46.0 };
  let most = 0;
  const s = shell({ clock, set, cutDays: (p, v, days) => { most = Math.max(most, days.length); return days.length > 8 ? Promise.reject(new Error('timeout')) : Promise.resolve(days.includes(dayOf(clock.t - 2 * DAY)) ? [cutDayFacts(clock.t - 2 * DAY, 13)] : []); } });
  for (let k = 0; k < 60; k++) { s.learnDue(s.p); await turns(2); clock.t += 61000; }      // an hour of frames
  assert.ok(s.p.learn && s.p.learn.ready, `nothing learned after an hour of retries; the largest call named ${most} days`);
});

// S5 (medium): the day that was "today" at the last read is kept as a finished past day after UTC midnight
// (07:00 in Thailand). A cut in the last minutes of the day, and a cut across midnight, are not seen for 6 h.
test('S5: after UTC midnight, yesterday is read once more', async () => {
  const mid = D0 + 41 * DAY, clock = { t: mid - 5 * 60000 }, set = { mode: 'v', pct: 10, v: 46.0 }, asked = [];
  const s = shell({ clock, set, cutDays: (p, v, days) => { asked.push(...days.map((d) => `${clock.t > mid ? 'after' : 'before'}:${d}`)); return Promise.resolve([]); } });
  s.learnDue(s.p); await turns();
  clock.t = mid + 6 * 60000; s.learnDue(s.p); await turns();
  const after = asked.filter((x) => x.startsWith('after:')).map((x) => x.slice(6));
  assert.deepEqual(after.sort(), [dayOf(mid - 1), dayOf(mid)].sort(), `the read after midnight asked for ${after.join(', ')}`);
});
