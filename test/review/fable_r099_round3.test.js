// BatRay by ClearEvo.com - review tests, round 3 (0.9.99): the learned voltage cut-off; each fails on the reviewed commit
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
import { learnCut, cutDayFromRows, LEARN_DAYS } from '../../public/batray/cutoff-logic.js';

const H = 3600000, DAY = 86400000, D0 = Date.UTC(2026, 10, 1);
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const SRC = readFileSync(new URL('../../public/batray/app.js', import.meta.url), 'utf8');
/** the body of a top-level function of app.js */
function body(head) { const a = SRC.indexOf(`\n${head}`); assert.ok(a > 0, head); return SRC.slice(a, SRC.indexOf('\n}\n', a)); }

// T1 (medium): cutStale() is the FIRST line of restoreHistory / browseDelete, before their awaits. It sets learnAt = 0,
// so the next frame (0.3 s) reads the days and clears the dirty mark while the restore is still importing day after
// day (seconds) or the delete still waits for the flush: the days that change after that read stay cached for 6 h.
for (const [head, op] of [['async function restoreHistory(', 'hist.importDay('], ['async function browseDelete(', 'hist.remove(']]) {
  test(`T1: ${head.slice(15, -1)} marks the learned cut-off stale AFTER its last ${op.slice(0, -1)}, not only before it`, () => {
    const b = body(head);
    assert.ok(b.lastIndexOf('cutStale()') > b.lastIndexOf(op), 'the only cutStale() runs before the store has changed');
  });
}

// T2 (low-medium): the standby rule needs the load to fall under a fifth. At dawn a hut draws a few amps; the same
// 0.9 A standby draw after the cut is then more than a fifth of the load, and the cut is not seen.
test('T2: a 4 A night load falling to a 0.9 A standby draw at the voltage is a cut', () => {
  const rows = [[46.2, -4, 13], [46.1, -4, 13], [46.9, -0.9, 13], [47.2, -0.9, 13], [47.3, -0.9, 13]].map(([v, i, soc], k) => ({ t: D0 + H + k * 3000, p: 'hut', v, i, soc }));
  assert.equal(cutDayFromRows(rows, 'hut', 46.0).ends.length, 1, 'load fell 78 % in one row and the voltage rose 0.8 V');
});

// T3 (low): cutChanged() sets p.cutCache = null while a chunked read is between two awaits; the read then throws on
// the null map and logs "reading the stored history failed" for a store that did not fail.
test('T3: a voltage change while a read is in flight is not logged as a failed read', async () => {
  const a = SRC.indexOf('const LEARN_MS'), b = SRC.indexOf('function renderEta(', a), logs = [], set = { mode: 'v', pct: 10, v: 46.0 }, clock = { t: D0 + 40 * DAY + 12 * H };
  const p = { label: 'hut', demo: false, data: {}, learn: null, learnV: null, learnAt: 0, learnLoading: false, cutCache: null, cutCacheV: null, cutCacheAt: 0, cutDirty: false, cutToday: null, plog: (m) => logs.push(m) };
  const env = { hist: { cutDays: () => new Promise((r) => { setImmediate(() => r([])); }) }, dayKey: dayOf, daysInRange: (from, to) => { const o = []; for (let t = Math.floor(from / DAY) * DAY; t <= to; t += DAY) o.push(dayOf(t)); return o; }, LEARN_DAYS, learnCut, isCorrupt: () => false, corruptDb: async () => {}, active: p, renderFlow: () => {}, cutSet: () => set, histMem: { ready: true }, histS: { backend: 'opfs' }, Date: { now: () => clock.t } };
  const { learnDue } = new Function(...Object.keys(env), `${SRC.slice(a, b)}\nfunction renderEta(p) { learnDue(p); }\nreturn { learnDue };`)(...Object.values(env));
  learnDue(p);
  set.v = 48.0; p.learnAt = 0; p.cutCache = null; p.learn = null;            // cutChanged() during the first chunk
  for (let k = 0; k < 40; k++) await new Promise((r) => { setImmediate(r); });
  assert.deepEqual(logs.filter((m) => /failed/.test(m)), []);
});
