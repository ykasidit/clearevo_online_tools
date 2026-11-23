// BatRay by ClearEvo.com - tests (batray_review_r1.test.js): the pure decisions added for review round 1 (0.9.91)
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
//
// The browser and long-run proofs are the reviewers' own tests in test/review/; these pin the decisions themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { backdropDecision, SHEET_GHOST_MS } from '../public/batray/ui-logic.js';
import { dataPublishDue, IDLE_PUBLISH_MS } from '../public/batray/share-logic.js';
import { endReason } from '../public/batray/status-logic.js';
import { afterEnd, backoffS, RECONNECT_MAX_S, RECONNECT_S } from '../public/batray/conn-logic.js';
import { queueMerge, askDelayMs, HIST_ASK_GAP_MS, GAP_REQ_MS } from '../public/batray/history-logic.js';
import { wakePowerOk, WAKE_LOW_PCT, wakePowerStep, WAKE_UNPLUG_MS, WAKE_BAND_PCT } from '../public/batray/wake-logic.js';

test('backdrop: a tap outside within 500 ms of opening is a ghost; the resume sheet ignores the backdrop for good', () => {
  assert.equal(SHEET_GHOST_MS, 500);
  assert.equal(backdropDecision('resume', 82), 'ignore', 'the reader log: 82 ms after it opened');
  assert.equal(backdropDecision('resume', 60000), 'ignore', 'only its own buttons end the resume');
  assert.equal(backdropDecision('soc', 80), 'ignore');
  assert.equal(backdropDecision('soc', 499), 'ignore');
  assert.equal(backdropDecision('soc', 500), 'close');
  assert.equal(backdropDecision(null, 9000), 'close', 'no sheet kind known: an old tap still closes');
});

test('publish rate: every frame with viewers, one per 3 s per pack without; garbage times never block the first', () => {
  assert.equal(IDLE_PUBLISH_MS, 3000);
  assert.equal(dataPublishDue({ viewers: 2, lastAt: 1000, now: 1001 }), true);
  assert.equal(dataPublishDue({ viewers: 0, lastAt: null, now: 5 }), true, 'the first reading always goes (the room retains it)');
  assert.equal(dataPublishDue({ viewers: 0, lastAt: 1000, now: 3999 }), false);
  assert.equal(dataPublishDue({ viewers: 0, lastAt: 1000, now: 4000 }), true);
  assert.equal(dataPublishDue({ viewers: 0, lastAt: 5000, now: 1000 }), false, 'a clock set back: not a flood');
  assert.equal(dataPublishDue({ viewers: 0, lastAt: NaN, now: 1000 }), true, 'a broken stamp never silences the reader');
});

test('the relay\'s close code 4004 reads as "Chrome froze its page" on the viewer', () => {
  assert.equal(endReason({ code: 4004 }), 'frozen');
  assert.equal(endReason({ code: 4004, lastWhy: 'tick', lastVis: true }), 'frozen');
  assert.equal(endReason({ code: 1001 }), 'closed', 'a closed page still wins');
  assert.equal(endReason({ code: 4002 }), 'unknown', 'a socket that never opened is not a freeze');
});

test('reconnect back-off: doubles per failed round to a 60 s cap; the first round and other ends unchanged', () => {
  assert.equal(RECONNECT_MAX_S, 60);
  assert.deepEqual([1, 2, 3, 4, 5, 10, 40].map((f) => backoffS(RECONNECT_S.auto, f)), [10, 20, 40, 60, 60, 60, 60]);
  assert.equal(backoffS(RECONNECT_S.chooser, 1), 5);
  assert.equal(backoffS(10, 0), 10, 'no count: the base'); assert.equal(backoffS(10, undefined), 10);
  assert.deepEqual(afterEnd('failed', { autoRe: true, hasDevice: true, fails: 4 }), { next: 'countdown', seconds: 60 });
  assert.deepEqual(afterEnd('failed', { autoRe: true, hasDevice: true }), { next: 'countdown', seconds: 10 }, 'an old caller: as before');
  assert.deepEqual(afterEnd('down', { autoRe: true, hasDevice: true, fails: 0 }), { next: 'countdown', seconds: 10 }, 'a link that gave readings and fell: the plain countdown');
  // review round 2 (F2-2): a link that came up but gave no reading counts as a failed round too
  assert.deepEqual(afterEnd('stalled', { autoRe: true, hasDevice: true, fails: 1 }), { next: 'countdown', seconds: 3 });
  assert.deepEqual(afterEnd('stalled', { autoRe: true, hasDevice: true, fails: 5 }), { next: 'countdown', seconds: 48 });
  assert.deepEqual(afterEnd('stalled', { autoRe: true, hasDevice: true, fails: 9 }), { next: 'countdown', seconds: 60 });
  assert.deepEqual(afterEnd('down', { autoRe: true, hasDevice: true, fails: 9 }), { next: 'countdown', seconds: 60 }, 'nine rounds in a row without a reading');
  assert.deepEqual(afterEnd('failed', { autoRe: true, hasDevice: true, fails: 9, msg: 'User cancelled the requestDevice() chooser.' }), { next: 'idle' });
});

test('transfer queue: the asker\'s items replaced, at most `keepIds` askers kept (the newest), never zero', () => {
  const plan = (to, days) => days.map((day) => ({ day, after: 0, rows: 10, to }));
  let q = plan('A1', ['d3', 'd2', 'd1']);
  q = queueMerge(q, plan('A2', ['d3', 'd2', 'd1']), 'A2', 1);          // the same viewer back with a new socket id
  assert.deepEqual([...new Set(q.map((x) => x.to))], ['A2'], 'one viewer in the room: only its newest socket\'s plan');
  q = queueMerge(q, plan('B1', ['d1']), 'B1', 2);
  assert.deepEqual(q.map((x) => x.to), ['A2', 'A2', 'A2', 'B1']);
  q = queueMerge(q, plan('A2', ['d1']), 'A2', 2);
  assert.deepEqual(q.map((x) => `${x.to}:${x.day}`), ['B1:d1', 'A2:d1'], 'a newer ask replaces that asker\'s items, keeps the other viewer\'s');
  assert.equal(queueMerge(q, plan('C', ['d1']), 'C', 0).length, 1, 'a viewer count of 0 (the status not in yet) still keeps the asker');
  assert.deepEqual(queueMerge([], [], 'X', 1), []);
});

test('wake lock and the phone\'s power: off at 20 % or less without charging, on while charging or unknown', () => {
  assert.equal(WAKE_LOW_PCT, 20);
  assert.equal(wakePowerOk({ pct: 15, chg: false }), false);
  assert.equal(wakePowerOk({ pct: 20, chg: false }), false);
  assert.equal(wakePowerOk({ pct: 21, chg: false }), true);
  assert.equal(wakePowerOk({ pct: 5, chg: true }), true, 'charging: keep it on');
  assert.equal(wakePowerOk(null), true, 'no Battery API: unknown is not low');
  assert.equal(wakePowerOk({ pct: undefined, chg: false }), true);
});

test('history asks: one per socket per 4 s, a viewer\'s own rhythm never waits, a clock set back answers now', () => {
  assert.equal(HIST_ASK_GAP_MS, 4000);
  assert.ok(GAP_REQ_MS >= HIST_ASK_GAP_MS, 'a viewer\'s gap asks are spaced wider than the limit');
  assert.equal(askDelayMs(undefined, 1000), 0);
  assert.equal(askDelayMs(1000, 1015), 3985, '15 ms after an answered ask: wait out the rest');
  assert.equal(askDelayMs(1000, 5000), 0);
  assert.equal(askDelayMs(9000, 1000), 0, 'clock set back: never a long wait');
  assert.equal(askDelayMs(NaN, 1000), 0);
});

test('review round 2: the power rule is steady - 5 min off the charger before the screen goes, back above 25 % or on charge', () => {
  assert.equal(WAKE_UNPLUG_MS, 300000); assert.equal(WAKE_BAND_PCT, 5);
  const ps = { offSince: null, ok: true }; const t0 = 1_000_000;
  assert.equal(wakePowerStep(ps, { pct: 18, chg: true }, t0), true);
  assert.equal(wakePowerStep(ps, { pct: 18, chg: false }, t0 + 1000), true, 'the charger blinked');
  assert.equal(wakePowerStep(ps, { pct: 18, chg: true }, t0 + 4000), true, '3 s later it charges again: the screen never went');
  assert.equal(ps.offSince, null);
  assert.equal(wakePowerStep(ps, { pct: 18, chg: false }, t0 + 10_000), true);
  assert.equal(wakePowerStep(ps, { pct: 18, chg: false }, t0 + 10_000 + WAKE_UNPLUG_MS - 1), true, 'not yet 5 min');
  assert.equal(wakePowerStep(ps, { pct: 18, chg: false }, t0 + 10_000 + WAKE_UNPLUG_MS), false, '5 min off the charger at 18 %: let the screen go');
  assert.equal(wakePowerStep(ps, { pct: 22, chg: false }, t0 + 999_000), false, 'within the band: stays let go (no flapping at 20/21 %)');
  assert.equal(wakePowerStep(ps, { pct: 26, chg: false }, t0 + 999_500), true, 'above 25 %: kept on again');
  assert.equal(wakePowerStep(ps, { pct: 50, chg: false }, t0 + 2_000_000), true, 'off the charger but well charged');
  const q = { offSince: null, ok: true };
  wakePowerStep(q, { pct: 10, chg: false }, 5_000_000); assert.equal(wakePowerStep(q, { pct: 10, chg: false }, 5_000_000 + WAKE_UNPLUG_MS), false);
  assert.equal(wakePowerStep(q, { pct: 10, chg: true }, 5_000_000 + WAKE_UNPLUG_MS + 1), true, 'charging again');
  const r = { offSince: null, ok: true };
  wakePowerStep(r, { pct: 10, chg: false }, 9_000_000); assert.equal(wakePowerStep(r, { pct: 10, chg: false }, 1_000), true, 'a clock set back restarts the wait');
  assert.equal(wakePowerStep({ offSince: null, ok: true }, null, 1), true, 'no Battery API: on');
  assert.equal(wakePowerStep({ offSince: null, ok: true }, { pct: undefined, chg: false }, 1), true, 'no level: on');
});

// review round 6 (F6-1): a today file numbered from above 1 (after a wipe or a renewed file) was asked for again and
// again: the copy's run from id 1 never closed. A received file that follows the copy's run closes it to its last id.
import { receivedContig } from '../public/batray/history-logic.js';
test('receivedContig: a file that follows the run makes the copy complete to its last id', () => {
  assert.equal(receivedContig(0, 0, 0, 150), 150);            // nothing of today, the reader's ids start at 101
  assert.equal(receivedContig(50, 50, 50, 150), 150);         // held 1..50, the reader lost 51..100
  assert.equal(receivedContig(0, 0, 120, 200), 0);            // a later file of a transfer whose first file was lost: no
  assert.equal(receivedContig(10, 180, 0, 150), 180);         // the db's own run is longer: kept
  assert.equal(receivedContig(10, 10, null, 150), 10);        // garbage after / last id: unchanged
  assert.equal(receivedContig(10, 10, 5, Number.NaN), 10);
});
