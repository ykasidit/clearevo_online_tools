// BatRay by ClearEvo.com - tests (batray_conn.test.js): the BLE connect / retry / countdown rules replayed from live logs
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
import { connState, connEvent, connCard, connButton, packChipState, wakeWantedByConn, CONNECT_TRIES, CONNECT_GAP_MS, RECONNECT_S, CONNECT_S, knownDevice, watchDecision } from '../public/batray/conn-logic.js';
import { linkGone, STALE_MS } from '../public/batray/jkbms.js';

const A = (cs, ev, inp) => connEvent(cs, ev, { autoRe: true, now: 1000, ...inp }).action;

test('2026-09-18 log: one tap, Android refuses twice with status 133, the third attempt connects - one chooser, three attempts', () => {
  const cs = connState();
  assert.equal(A(cs, 'tap-connect'), 'choose'); assert.equal(cs.phase, 'choosing');
  assert.deepEqual(connEvent(cs, 'picked'), { action: 'connect', attempt: 1 });
  let d = connEvent(cs, 'attempt-failed', { autoRe: true, msg: 'Connection Error: Connection attempt failed.' });
  assert.deepEqual(d, { action: 'retry', attempt: 2, gapMs: CONNECT_GAP_MS });
  d = connEvent(cs, 'attempt-failed', { autoRe: true, msg: 'Connection Error: Connection attempt failed.' });
  assert.deepEqual(d, { action: 'retry', attempt: 3, gapMs: CONNECT_GAP_MS });
  assert.equal(A(cs, 'gatt-connected', { now: 5000 }), 'connected');
  assert.equal(cs.phase, 'connected'); assert.equal(cs.connectedAt, 5000); assert.equal(cs.attempt, 0);
  assert.equal(A(cs, 'tap-connect'), 'choose');            // Connect again while connected: allowed (the chooser drops the link first)
});

test('a picked device that refuses all attempts goes to a 5 s countdown, never back to the chooser; the countdown connects', () => {
  const cs = connState(); A(cs, 'tap-connect'); A(cs, 'picked');
  for (let i = 1; i < CONNECT_TRIES; i++) assert.equal(A(cs, 'attempt-failed', { msg: 'Connection attempt failed.' }), 'retry');
  const d = connEvent(cs, 'attempt-failed', { autoRe: true, msg: 'Connection attempt failed.' });
  assert.deepEqual(d, { action: 'countdown', seconds: RECONNECT_S.chooser, final: true });
  assert.equal(cs.phase, 'countdown'); assert.equal(cs.count, 5);
  for (let i = 0; i < 4; i++) assert.equal(A(cs, 'countdown-tick'), 'count');
  assert.deepEqual(connEvent(cs, 'countdown-tick'), { action: 'connect', attempt: 1 });
  assert.equal(cs.origin, 'auto');
  // that attempt fails for good: the countdown restarts at the auto length
  for (let i = 1; i < CONNECT_TRIES; i++) A(cs, 'attempt-failed', { msg: 'x' });
  assert.deepEqual(connEvent(cs, 'attempt-failed', { autoRe: true, msg: 'x' }), { action: 'countdown', seconds: RECONNECT_S.auto, final: true });
});

test('a non-retryable error, a cancelled chooser, or auto reconnect off ends on the idle card', () => {
  let cs = connState(); A(cs, 'tap-connect'); A(cs, 'picked');
  assert.deepEqual(connEvent(cs, 'attempt-failed', { autoRe: true, msg: 'User cancelled the requestDevice() chooser.' }), { action: 'idle', final: true });
  cs = connState(); A(cs, 'tap-connect');
  assert.equal(A(cs, 'chooser-cancelled'), 'idle'); assert.equal(cs.hasDevice, false);
  cs = connState(); A(cs, 'tap-connect'); A(cs, 'picked');
  for (let i = 1; i < CONNECT_TRIES; i++) A(cs, 'attempt-failed', { msg: 'x' });
  assert.deepEqual(connEvent(cs, 'attempt-failed', { autoRe: false, msg: 'x' }), { action: 'idle', final: true });
});

test('2026-09-16 frozen tab: a quiet link is dropped, the disconnect that follows counts down 3 s, a data frame clears the stall', () => {
  const cs = connState(); A(cs, 'tap-connect'); A(cs, 'picked'); A(cs, 'gatt-connected', { now: 100 });
  assert.equal(A(cs, 'data'), 'noop'); assert.equal(cs.gotData, true);
  assert.deepEqual(connEvent(cs, 'link-stalled', { ageS: 14 }), { action: 'drop-link', ageS: 14 });
  assert.equal(cs.connectedAt, 100, 'the dropped link keeps its connect time until the next attempt starts');
  assert.deepEqual(connEvent(cs, 'gatt-disconnected', { autoRe: true }), { action: 'countdown', seconds: RECONNECT_S.stalled });
  A(cs, 'countdown-tick'); A(cs, 'countdown-tick'); assert.equal(A(cs, 'countdown-tick'), 'connect');
  assert.equal(cs.connectedAt, null, 'the link the attempt builds has no connect time yet');
  A(cs, 'gatt-connected', { now: 9000 });
  assert.equal(cs.stalled, false);
  cs.stalled = true; assert.equal(A(cs, 'data'), 'back');    // amber "no data" goes back to green on the first frame
});

test('a normal drop counts down 10 s; Reconnect now during the countdown makes exactly one attempt; a double tap is ignored', () => {
  const cs = connState(); A(cs, 'tap-connect'); A(cs, 'picked'); A(cs, 'gatt-connected');
  assert.deepEqual(connEvent(cs, 'gatt-disconnected', { autoRe: true }), { action: 'countdown', seconds: RECONNECT_S.auto });
  assert.equal(A(cs, 'countdown-tick'), 'count');
  assert.deepEqual(connEvent(cs, 'reconnect-now'), { action: 'connect', attempt: 1 });
  assert.equal(cs.origin, 'manual');
  assert.deepEqual(connEvent(cs, 'reconnect-now'), { action: 'ignore', why: 'double tap' });
  assert.deepEqual(connEvent(cs, 'countdown-tick'), { action: 'ignore', why: 'no countdown' });   // a late timer tick changes nothing
  assert.equal(A(cs, 'gatt-connected'), 'connected');
  assert.deepEqual(connEvent(cs, 'reconnect-now'), { action: 'ignore', why: 'already connected' });
});

test('Cancel and Disconnect are the user\'s word: no countdown follows, and the next Connect tap lifts it', () => {
  const cs = connState(); A(cs, 'tap-connect'); A(cs, 'picked'); A(cs, 'gatt-connected');
  A(cs, 'gatt-disconnected'); assert.equal(cs.phase, 'countdown');
  assert.equal(A(cs, 'cancel'), 'disconnect-gatt'); assert.equal(cs.userDisconnect, true); assert.equal(cs.phase, 'idle');
  assert.equal(A(cs, 'gatt-disconnected'), 'idle');           // the GATT close that follows our own disconnect
  assert.equal(cs.userDisconnect, false);
  A(cs, 'tap-connect'); A(cs, 'picked'); A(cs, 'gatt-connected');
  assert.equal(A(cs, 'disconnect'), 'disconnect-bms');
  assert.equal(A(cs, 'gatt-disconnected'), 'idle');
  A(cs, 'tap-connect'); assert.equal(cs.userDisconnect, false);
});

test('auto reconnect unticked ends a countdown; the adapter coming back shortens one to 3 s', () => {
  const cs = connState(); A(cs, 'tap-connect'); A(cs, 'picked'); A(cs, 'gatt-connected'); A(cs, 'gatt-disconnected');
  assert.deepEqual(connEvent(cs, 'adapter-available'), { action: 'countdown', seconds: RECONNECT_S.adapter });
  assert.equal(A(cs, 'auto-off'), 'idle'); assert.equal(cs.phase, 'idle');
  assert.equal(A(cs, 'auto-off'), 'noop'); assert.equal(A(cs, 'adapter-available'), 'noop');
});

test('the connecting status counts the attempt timeout down', () => {
  const cs = connState(); A(cs, 'tap-connect'); A(cs, 'picked');
  assert.equal(cs.left, CONNECT_S);
  assert.deepEqual(connEvent(cs, 'connect-tick'), { action: 'count', left: CONNECT_S - 1 });
  A(cs, 'gatt-connected'); assert.equal(A(cs, 'connect-tick'), 'noop');
});

test('the card and the pack chip follow the state object', () => {
  const cs = connState();
  assert.deepEqual(connCard(cs, { gattConnected: false, hasData: false }), { offline: false, loading: false, countdown: false, idle: true, reNow: false, disconnectEnabled: false });
  A(cs, 'tap-connect'); A(cs, 'picked');
  assert.deepEqual(connCard(cs, { gattConnected: false, hasData: false }), { offline: true, loading: false, countdown: true, idle: false, reNow: false, disconnectEnabled: false });
  assert.equal(packChipState(cs, false, false), 'connecting'); assert.equal(wakeWantedByConn(cs, false), true);
  A(cs, 'gatt-connected');
  assert.deepEqual(connCard(cs, { gattConnected: true, hasData: false }), { offline: false, loading: true, countdown: false, idle: false, reNow: false, disconnectEnabled: true });
  assert.equal(packChipState(cs, true, false), 'waiting'); assert.equal(packChipState(cs, true, true), 'live');
  A(cs, 'gatt-disconnected');
  assert.deepEqual(connCard(cs, { gattConnected: false, hasData: true }), { offline: true, loading: false, countdown: true, idle: false, reNow: true, disconnectEnabled: false });
  A(cs, 'cancel');
  assert.deepEqual(connCard(cs, { gattConnected: false, hasData: true }), { offline: true, loading: false, countdown: false, idle: true, reNow: false, disconnectEnabled: false });
  assert.equal(packChipState(cs, false, true), 'offline'); assert.equal(wakeWantedByConn(cs, false), false);
});

test('the one Bluetooth button: Connect when idle, pulsing Connecting (a cancel) while connecting or counting down, sunk Disconnect when connected', () => {
  const cs = connState();
  assert.deepEqual(connButton(cs, false), { on: false, busy: false, disabled: false, label: 'connect' });
  A(cs, 'tap-connect'); assert.deepEqual(connButton(cs, false), { on: false, busy: true, disabled: false, label: 'connecting' });
  A(cs, 'picked'); assert.deepEqual(connButton(cs, false), { on: false, busy: true, disabled: false, label: 'connecting' });
  A(cs, 'gatt-connected'); assert.deepEqual(connButton(cs, true), { on: true, busy: false, disabled: false, label: 'disconnect' });
  A(cs, 'gatt-disconnected'); assert.equal(cs.phase, 'countdown'); assert.deepEqual(connButton(cs, false), { on: false, busy: true, disabled: false, label: 'connecting' });
  assert.equal(A(cs, 'cancel'), 'disconnect-gatt'); assert.deepEqual(connButton(cs, false), { on: false, busy: false, disabled: false, label: 'connect' });
});

test('the remembered BMS: a green Connect-to-NAME button only while the browser still lists the saved id as permitted; the known event connects without a chooser and retries like an auto reconnect', () => {
  const saved = { id: 'abc123', name: 'JK-B2A24S', at: 1 };
  assert.deepEqual(knownDevice(saved, ['xyz', 'abc123']), { show: true, id: 'abc123', name: 'JK-B2A24S' });
  assert.equal(knownDevice(saved, ['xyz']).show, false); assert.equal(knownDevice(saved, ['xyz']).why, 'not permitted any more');
  assert.equal(knownDevice(saved, null).why, 'no getDevices'); assert.equal(knownDevice(null, ['abc123']).show, false); assert.equal(knownDevice({ id: '' }, ['']).show, false);
  assert.equal(knownDevice({ id: 'abc123' }, ['abc123']).name, 'abc123', 'a device without a name is shown by its id');
  const cs = connState();
  const d = connEvent(cs, 'known', { now: 0 });
  assert.equal(d.action, 'connect'); assert.equal(cs.phase, 'connecting'); assert.equal(cs.origin, 'known'); assert.equal(cs.hasDevice, true);
  assert.equal(connEvent(cs, 'known', { now: 1 }).action, 'ignore', 'a double tap is ignored');
  for (let i = 0; i < 3; i++) connEvent(cs, 'attempt-failed', { msg: 'Connection attempt failed', autoRe: true, now: 1000 * (i + 1) });
  assert.equal(cs.phase, 'countdown'); assert.equal(cs.count, RECONNECT_S.auto, 'a known device counts down the auto 10 s, not the chooser 5 s');
});

test('2026-10-07 crash: a connect that ran with Bluetooth off is stuck in the browser - no retries, no countdown, a tap shows the sheet again; connected or settled clears it', () => {
  const cs = connState(); A(cs, 'tap-connect'); A(cs, 'picked');
  assert.deepEqual(connEvent(cs, 'connect-stuck', { autoRe: true }), { action: 'stuck' });
  assert.equal(cs.phase, 'stuck'); assert.equal(cs.attempt, 0);
  assert.equal(A(cs, 'countdown-tick'), 'ignore'); assert.equal(A(cs, 'connect-tick'), 'ignore'); assert.equal(A(cs, 'attempt-failed', { msg: 'no answer in 15 s' }), 'ignore');
  assert.equal(A(cs, 'adapter-available'), 'ignore'); assert.equal(A(cs, 'gatt-disconnected'), 'ignore');
  assert.equal(A(cs, 'tap-connect'), 'stuck', 'Connect again: the sheet, not the chooser'); assert.equal(A(cs, 'known'), 'stuck'); assert.equal(A(cs, 'reconnect-now'), 'stuck');
  assert.equal(cs.phase, 'stuck');
  assert.deepEqual(connCard(cs, { gattConnected: false, hasData: false }), { offline: true, loading: false, countdown: false, idle: true, reNow: false, disconnectEnabled: false });
  assert.equal(packChipState(cs, false, false), 'offline'); assert.equal(wakeWantedByConn(cs, false), false, 'nothing to keep the screen on for');
  // it was only a slow stack: settled -> the auto countdown as after any drop
  assert.deepEqual(connEvent(cs, 'connect-settled', { autoRe: true }), { action: 'countdown', seconds: RECONNECT_S.auto });
  assert.equal(A(cs, 'connect-settled'), 'noop', 'settled while not stuck is nothing');
  // a stuck connect that connects after all is simply connected
  A(cs, 'countdown-tick'); cs.count = 1; A(cs, 'countdown-tick'); A(cs, 'connect-stuck');
  assert.equal(A(cs, 'gatt-connected', { now: 9000 }), 'connected'); assert.equal(cs.phase, 'connected');
  // settled with auto reconnect off: idle
  A(cs, 'connect-stuck'); assert.equal(connEvent(cs, 'connect-settled', { autoRe: false }).action, 'idle');
  // the Disconnect button still works while stuck (its GATT call is guarded by gatt.connected in the app)
  A(cs, 'connect-stuck'); assert.equal(A(cs, 'disconnect'), 'disconnect-bms'); assert.equal(cs.phase, 'idle');
});

// The seahut reader, 0.9.80, 2026-10-29 20:53 - 2026-10-30 10:28 (owner: "connecting and reconnecting very frequently"):
// 2561 GATT server connects, 2 reached the service. 1760 were dropped by the stall watchdog (every 4 s) a median 1.7 s
// (p10 0.5 s, p90 3.7 s) after the server connected, judged by the last frame of the link before - 34 h old:
//   20:53:43.333 connecting to n11 / 43.638 gatt: server connected in 304 ms
//   20:53:45.159 no data for 122196 s (watchdog) / conn: link-stalled -> drop-link [connecting]
//   20:53:45.159 conn: gatt-disconnected -> countdown 3 s [countdown]   (a countdown beside the attempt still in flight)
//   20:53:45.172 connect: attempt 2 failed: GATT Server is disconnected / conn: attempt-failed -> ignore (not connecting)
// Successful discovery on that phone took 1.4-1.8 s, so a link survived only when no watchdog tick fell in its window.
const H = 3600e3;
function seahut(t0) {
  // a link that streamed, went quiet, was dropped; the reconnect attempt is building a new one
  const lastFrameAt = t0 - 122196e3, quiet = lastFrameAt + 30e3;
  const cs = connState(); A(cs, 'tap-connect'); A(cs, 'picked'); A(cs, 'gatt-connected', { now: lastFrameAt - H });
  const w = watchDecision(cs, { gattUp: true, gone: linkGone(lastFrameAt, cs.connectedAt, quiet), lastFrameAt, now: quiet });
  assert.equal(w.drop, true, 'a connected link that went quiet IS dropped');
  assert.equal(connEvent(cs, 'link-stalled', { ageS: w.ageS }).action, 'drop-link');
  assert.equal(A(cs, 'gatt-disconnected'), 'countdown');
  while (cs.phase === 'countdown') A(cs, 'countdown-tick');
  assert.equal(cs.phase, 'connecting');
  return { cs, lastFrameAt };
}

test('2026-10-29 seahut reader: the watchdog never judges a link an attempt is still building, at any tick offset in any discovery time from the log', () => {
  const t0 = Date.UTC(2026, 9, 29, 20, 53, 43, 333);
  for (const discoveryMs of [497, 1694, 1822, 3678, 14000]) {           // the log's kill times, the real 1.8 s discovery, a slow one
    for (let offset = 0; offset < 4000; offset += 250) {                // the 4 s watchdog tick lands anywhere in the window
      const { cs, lastFrameAt } = seahut(t0);
      for (let t = t0 + 305 + offset; t < t0 + 305 + discoveryMs; t += 4000) {
        assert.equal(linkGone(lastFrameAt, cs.connectedAt, t), false, 'no connect time of its own: not stale');
        const w = watchDecision(cs, { gattUp: true, gone: true, lastFrameAt, now: t });  // even if a caller thought it gone
        assert.equal(w.drop, false, `discovery ${discoveryMs} ms, tick +${offset} ms: the attempt owns the link`);
        assert.equal(connEvent(cs, 'link-stalled', { ageS: 122196 }).action, 'ignore');
      }
      const now = t0 + 305 + discoveryMs;
      assert.equal(A(cs, 'gatt-connected', { now }), 'connected');
      // its own startup grace now: the 34 h old frame is the link before's
      assert.equal(watchDecision(cs, { gattUp: true, gone: linkGone(lastFrameAt, cs.connectedAt, now + 4000), lastFrameAt, now: now + 4000 }).drop, false);
      // and a link of its own that goes silent is still dropped (the 2026-09-16 rule stands)
      const own = now + 1000;
      const later = own + STALE_MS + 1;
      const w = watchDecision(cs, { gattUp: true, gone: linkGone(own, cs.connectedAt, later), lastFrameAt: own, now: later });
      assert.deepEqual(w, { drop: true, ageS: Math.round((later - own) / 1000) });
    }
  }
});

test('2026-10-29 seahut reader: a link that drops during discovery is the attempt\'s to report - no countdown beside it, the attempt retries', () => {
  const { cs } = seahut(Date.UTC(2026, 9, 29, 20, 53, 43, 333));
  assert.equal(cs.attempt, 1);
  assert.deepEqual(connEvent(cs, 'gatt-disconnected', { autoRe: true }), { action: 'ignore', why: 'the attempt in flight owns the link' });
  assert.equal(cs.phase, 'connecting', 'no second flow started');
  assert.deepEqual(connEvent(cs, 'attempt-failed', { msg: 'GATT Server is disconnected. Cannot retrieve services.' }), { action: 'retry', attempt: 2, gapMs: CONNECT_GAP_MS });
  A(cs, 'attempt-failed', { msg: 'Connection Error: Connection attempt failed.' });
  assert.deepEqual(connEvent(cs, 'attempt-failed', { autoRe: true, msg: 'Connection Error: Connection attempt failed.' }), { action: 'countdown', seconds: RECONNECT_S.auto, final: true });
  // the chooser drops the old link before it opens: that disconnect is not a reason to count down either
  const c2 = connState(); A(c2, 'tap-connect'); A(c2, 'picked'); A(c2, 'gatt-connected', { now: 5 });
  A(c2, 'tap-connect');
  assert.equal(A(c2, 'gatt-disconnected'), 'ignore'); assert.equal(c2.phase, 'choosing');
  // outside an attempt the disconnect still counts down as before
  const c3 = connState(); A(c3, 'tap-connect'); A(c3, 'picked'); A(c3, 'gatt-connected', { now: 5 });
  assert.deepEqual(connEvent(c3, 'gatt-disconnected', { autoRe: true }), { action: 'countdown', seconds: RECONNECT_S.auto });
});
