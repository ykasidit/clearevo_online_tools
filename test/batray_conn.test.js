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
import { connState, connEvent, connCard, connButton, packChipState, wakeWantedByConn, CONNECT_TRIES, CONNECT_GAP_MS, RECONNECT_S, CONNECT_S, knownDevice } from '../public/batray/conn-logic.js';

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
  assert.equal(cs.connectedAt, null);
  assert.deepEqual(connEvent(cs, 'gatt-disconnected', { autoRe: true }), { action: 'countdown', seconds: RECONNECT_S.stalled });
  A(cs, 'countdown-tick'); A(cs, 'countdown-tick'); assert.equal(A(cs, 'countdown-tick'), 'connect');
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
