// BatRay by ClearEvo.com - tests (batray_conn.test.js): the Bluetooth connection loop replayed from live logs
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
// Two halves, as in the code: the pure tables of conn-logic.js, and the loop of conn.js driven over the real JkBms
// port and a fake Web Bluetooth device, on a fast clock (one "second" is 20 ms). Each replay names the log it came from.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { connState, cmdIn, retryDecision, afterEnd, connCard, connButton, packChipState, wakeWantedByConn, knownDevice, CONNECT_TRIES, CONNECT_GAP_MS, RECONNECT_S } from '../public/batray/conn-logic.js';
import { BleConn } from '../public/batray/conn.js';
import { JkBms } from '../public/batray/jkbms.js';
import { sleep } from '../public/batray/sync.js';
import * as F from './batray_frames.js';

const REFUSED = 'Connection Error: Connection attempt failed.';

// ---------------------------------------------------------------- the pure tables
test('what a command means in each phase: one attempt at a time, the chooser drops a link that is up, a stuck connect only explains itself', () => {
  const dev = { hasDevice: true }, none = { hasDevice: false };
  assert.equal(cmdIn('idle', 'connect', none), 'choose');
  assert.equal(cmdIn('connected', 'connect', dev), 'choose', 'Connect again while connected: the chooser (it closes the link first)');
  assert.equal(cmdIn('connecting', 'connect', dev), 'ignore', 'a double tap while an attempt runs (2026-09-17)');
  assert.equal(cmdIn('choosing', 'connect', dev), 'ignore');
  assert.equal(cmdIn('idle', 'known', none), 'go'); assert.equal(cmdIn('countdown', 'known', dev), 'go'); assert.equal(cmdIn('connected', 'known', dev), 'ignore');
  assert.equal(cmdIn('countdown', 'now', dev), 'go'); assert.equal(cmdIn('idle', 'now', none), 'ignore', 'nothing to reconnect');
  assert.equal(cmdIn('connecting', 'now', dev), 'ignore');
  for (const ph of ['choosing', 'connecting', 'connected', 'countdown']) { assert.equal(cmdIn(ph, 'cancel', dev), 'stop', ph); assert.equal(cmdIn(ph, 'disconnect', dev), 'stop', ph); }
  assert.equal(cmdIn('idle', 'cancel', dev), 'ignore');
  assert.equal(cmdIn('countdown', 'auto-off', dev), 'stop'); assert.equal(cmdIn('connected', 'auto-off', dev), 'ignore');
  assert.equal(cmdIn('countdown', 'adapter', dev), 'short'); assert.equal(cmdIn('idle', 'adapter', dev), 'ignore');
  // 2026-10-07: only closing the browser clears a stuck connect - a tap says so again, Disconnect ends the wait
  for (const c of ['connect', 'known', 'now']) assert.equal(cmdIn('stuck', c, dev), 'sheet', c);
  assert.equal(cmdIn('stuck', 'disconnect', dev), 'stop'); assert.equal(cmdIn('stuck', 'cancel', dev), 'ignore'); assert.equal(cmdIn('stuck', 'adapter', dev), 'ignore');
  assert.equal(cmdIn('idle', 'whatever', dev), 'ignore');
});

test('retries and what follows the end of a round (2026-09-18: two refusals then a link; a picked device that refuses counts down, never back to the chooser)', () => {
  assert.deepEqual(retryDecision(1, REFUSED), { retry: true, gapMs: CONNECT_GAP_MS });
  assert.deepEqual(retryDecision(CONNECT_TRIES - 1, REFUSED), { retry: true, gapMs: CONNECT_GAP_MS });
  assert.deepEqual(retryDecision(CONNECT_TRIES, REFUSED), { retry: false });
  assert.deepEqual(retryDecision(1, 'User cancelled the requestDevice() chooser.'), { retry: false });
  assert.deepEqual(retryDecision(1, 'Bluetooth permission denied'), { retry: false });
  const on = { autoRe: true, hasDevice: true };
  assert.deepEqual(afterEnd('failed', { ...on, origin: 'chooser', msg: REFUSED }), { next: 'countdown', seconds: RECONNECT_S.chooser });
  assert.deepEqual(afterEnd('failed', { ...on, origin: 'known', msg: REFUSED }), { next: 'countdown', seconds: RECONNECT_S.auto });
  assert.deepEqual(afterEnd('failed', { ...on, origin: 'chooser', msg: 'cancelled' }), { next: 'idle' });
  assert.deepEqual(afterEnd('stalled', on), { next: 'countdown', seconds: RECONNECT_S.stalled });
  for (const e of ['down', 'gap', 'settled']) assert.deepEqual(afterEnd(e, on), { next: 'countdown', seconds: RECONNECT_S.auto }, e);
  assert.deepEqual(afterEnd('down', { autoRe: false, hasDevice: true }), { next: 'idle' });
  assert.deepEqual(afterEnd('down', { autoRe: true, hasDevice: false }), { next: 'idle' });
});

test('the card, the pack chip, the wake lock and the one Bluetooth button follow the phase', () => {
  const at = (phase, x = {}) => ({ ...connState(), phase, ...x });
  assert.deepEqual(connCard(at('idle'), { gattConnected: false, hasData: false }), { offline: false, loading: false, countdown: false, idle: true, reNow: false, disconnectEnabled: false });
  assert.deepEqual(connCard(at('connecting', { hasDevice: true }), { gattConnected: false, hasData: false }), { offline: true, loading: false, countdown: true, idle: false, reNow: false, disconnectEnabled: false });
  assert.deepEqual(connCard(at('connected', { hasDevice: true }), { gattConnected: true, hasData: false }), { offline: false, loading: true, countdown: false, idle: false, reNow: false, disconnectEnabled: true });
  assert.deepEqual(connCard(at('countdown', { hasDevice: true }), { gattConnected: false, hasData: true }), { offline: true, loading: false, countdown: true, idle: false, reNow: true, disconnectEnabled: false });
  assert.deepEqual(connCard(at('idle', { hasDevice: true }), { gattConnected: false, hasData: true }), { offline: true, loading: false, countdown: false, idle: true, reNow: false, disconnectEnabled: false });
  assert.equal(packChipState(at('connecting'), false, false), 'connecting'); assert.equal(packChipState(at('connected'), true, false), 'waiting');
  assert.equal(packChipState(at('connected'), true, true), 'live'); assert.equal(packChipState(at('idle'), false, true), 'offline');
  assert.equal(wakeWantedByConn(at('countdown'), false), true); assert.equal(wakeWantedByConn(at('idle'), false), false);
  assert.deepEqual(connButton(at('idle'), false), { on: false, busy: false, disabled: false, label: 'connect' });
  for (const ph of ['choosing', 'connecting', 'countdown']) assert.deepEqual(connButton(at(ph), false), { on: false, busy: true, disabled: false, label: 'connecting' }, ph);
  assert.deepEqual(connButton(at('connected'), true), { on: true, busy: false, disabled: false, label: 'disconnect' });
  assert.deepEqual(connButton(at('stuck'), false), { on: false, busy: false, disabled: false, label: 'connect' }, 'a tap while stuck explains it again');
});

test('the remembered BMS: a green Connect-to-NAME button only while the browser still lists the saved id as permitted', () => {
  const saved = { id: 'abc123', name: 'JK-B2A24S', at: 1 };
  assert.deepEqual(knownDevice(saved, ['xyz', 'abc123']), { show: true, id: 'abc123', name: 'JK-B2A24S' });
  assert.equal(knownDevice(saved, ['xyz']).show, false); assert.equal(knownDevice(saved, ['xyz']).why, 'not permitted any more');
  assert.equal(knownDevice(saved, null).why, 'no getDevices'); assert.equal(knownDevice(null, ['abc123']).show, false); assert.equal(knownDevice({ id: '' }, ['']).show, false);
  assert.equal(knownDevice({ id: 'abc123' }, ['abc123']).name, 'abc123', 'a device without a name is shown by its id');
});

// ---------------------------------------------------------------- the loop over a fake device
/** A JK BMS behind Web Bluetooth: refuses `refuse` connects (status 133), leaves `hang` connects pending (Bluetooth
 *  off), answers 0x97 with its device info, streams cell info once asked (0x96), finds its service after serviceMs. */
class FakeDev extends EventTarget {
  constructor(p = {}) {
    super();
    Object.assign(this, { id: 'fake-1', name: 'n11', refuse: 0, hang: 0, serviceMs: 0, answer: true, stream: true, connects: 0, disconnects: 0, writes: [], pending: [], timer: null }, p);
    const dev = this;
    this.char = {
      fns: [],
      addEventListener(_, fn) { this.fns.push(fn); },
      startNotifications: async () => {},
      writeValueWithoutResponse: async (bytes) => {
        dev.writes.push(bytes[4]);
        if (bytes[4] === 0x97 && dev.answer) setTimeout(() => dev.notify(F.AIO_32S_DEV), 5);
        if (bytes[4] === 0x96 && dev.stream) dev.startStream();
      },
    };
    this.gatt = {
      connected: false,
      connect: () => {
        dev.connects++;
        if (dev.hang > 0) { dev.hang--; return new Promise((resolve, reject) => { dev.pending.push({ resolve, reject }); }); }
        if (dev.refuse > 0) { dev.refuse--; return Promise.reject(new Error(REFUSED)); }
        dev.gatt.connected = true;
        return Promise.resolve(dev.server());
      },
      disconnect: () => { dev.disconnects++; if (!dev.gatt.connected) return; dev.gatt.connected = false; dev.stopStream(); dev.dispatchEvent(new Event('gattserverdisconnected')); },
    };
  }
  server() {
    return { getPrimaryService: async () => {
      if (this.serviceMs) await sleep(this.serviceMs);
      if (!this.gatt.connected) throw new Error('GATT Server is disconnected. Cannot retrieve services.');
      return { getCharacteristic: async () => this.char };
    } };
  }
  notify(bytes) { for (const fn of this.char.fns) fn({ target: { value: new DataView(Uint8Array.from(bytes).buffer) } }); }
  startStream() { if (!this.timer) this.timer = setInterval(() => { if (this.gatt.connected) this.notify(F.OWNER_32S_CELL); }, 30); }
  stopStream() { clearInterval(this.timer); this.timer = null; }
  fall() { this.gatt.disconnect(); }                                   // the BMS side drops the link
}

const open = [];                                                      // every harness, ended after its test whatever happened
afterEach(() => { for (const t of open.splice(0)) t.end(); });

/** The loop with an app that records what it was told. One "second" = 20 ms; the attempt gives up after 15 of them. */
function harness(dev, { autoRe = true, chooser = true, device = null, o = {} } = {}) {
  const bms = new JkBms(), log = [], ev = [];
  let dv = device;
  bms.addEventListener('log', (e) => log.push(e.detail));
  const h = {
    log: (m) => log.push(m), autoRe: () => autoRe, device: () => dv, changed: () => {},
    choose: async () => { ev.push('chooser'); await sleep(1); if (!chooser) return null; dv = dev; return dev; },
    fresh: async (d) => d, attempt: (n) => ev.push(`attempt ${n}`), connected: () => ev.push('connected'),
    failed: (m) => ev.push(`failed: ${m}`), stalled: () => ev.push('stalled'), down: (st) => ev.push(st ? 'down (stalled)' : 'down'), stuck: () => ev.push('stuck'),
  };
  const c = new BleConn(bms, h, { secMs: 20, tickMs: 10, gapMs: 30, downWaitMs: 100, writeMs: 200, stuckMs: 60_000, link: { staleMs: 300, startupMs: 600, handshakeMs: 60, nudgeMs: 100, quickMs: 40 }, ...o });
  const until = async (pred, what, ms = 4000) => {
    const t0 = Date.now();
    while (!pred()) { if (Date.now() - t0 > ms) throw new Error(`no ${what} in ${ms} ms: phase ${c.cs.phase}; ${ev.join(' | ')}\n${log.slice(-12).join('\n')}`); await sleep(5); }
  };
  const phase = (ph) => until(() => c.cs.phase === ph, `phase ${ph}`);
  const end = () => { c.stop(); dev.stopStream(); };
  const t = { bms, c, ev, log, until, phase, end, setAuto: (v) => { autoRe = v; } };
  open.push(t);
  return t;
}

test('2026-09-18 log: one tap, Android refuses twice with status 133, the third attempt connects - one chooser, three attempts; 0x97, then 0x96 after the device info', async () => {
  const dev = new FakeDev({ refuse: 2 }), t = harness(dev);
  t.c.tell('connect');
  await t.phase('connected');
  assert.deepEqual(t.ev, ['chooser', 'attempt 1', 'attempt 2', 'attempt 3', 'connected']);
  assert.equal(dev.connects, 3); assert.equal(t.c.cs.origin, 'chooser'); assert.ok(t.c.cs.connectedAt > 0);
  await t.until(() => t.c.cs.gotData, 'data');
  assert.deepEqual(dev.writes.slice(0, 2), [0x97, 0x96], 'the JK app order (0.9.34): device info, then cell info once it answered');
  assert.ok(t.log.some((l) => /^handshake: device info in \d+ ms, asking for cell info \(0x96\)$/.test(l)), t.log.join('\n'));
  assert.equal(dev.writes.filter((w) => w === 0x96).length, 1, 'streaming: no poll (0.9.33 - the BMS beeps at each one)');
  await sleep(250);
  assert.equal(dev.writes.filter((w) => w === 0x96).length, 1, 'still none while frames flow');
  t.end();
});

test('handshake: no device-info answer -> cell info asked anyway after the wait; a BMS that only echoes is asked again until cell info flows (0.9.42 / 0.9.69)', async () => {
  const dev = new FakeDev({ answer: false, stream: false }), t = harness(dev);
  t.c.tell('connect');
  await t.until(() => t.log.some((l) => /^handshake: no device info in 60 ms, asking for cell info anyway/.test(l)), 'handshake without info');
  await t.until(() => dev.writes.filter((w) => w === 0x96).length >= 3, 'startup asks');
  assert.ok(t.log.some((l) => /^startup: no cell info [\d.]+ s after the ask \(not served\), asking again \(0x96, ask 2\)$/.test(l)), t.log.join('\n'));
  dev.stream = true; dev.startStream();
  await t.until(() => t.log.some((l) => /^startup: cell info after \d+ asks$/.test(l)), 'cell info');
  assert.equal(t.c.cs.phase, 'connected');
  t.end();
});

test('2026-09-16 frozen tab: a connected link that goes quiet is dropped by the loop that serves it, counts down 3 s and comes back', async () => {
  const dev = new FakeDev(), t = harness(dev);
  t.c.tell('connect');
  await t.until(() => t.c.cs.gotData, 'data');
  dev.stream = false; dev.stopStream();                                // the link stays up, nothing comes, nudges unanswered
  await t.until(() => t.ev.includes('down (stalled)'), 'the stall');
  assert.ok(t.log.some((l) => /^dropping link: no data for \d+ s$/.test(l)), t.log.join('\n'));
  assert.ok(t.log.some((l) => l === `conn: connected -> countdown (stalled, ${RECONNECT_S.stalled} s)`), t.log.join('\n'));
  assert.equal(t.c.cs.stalled, true);
  dev.stream = true;
  await t.until(() => t.ev.filter((e) => e === 'connected').length === 2, 'the reconnect');
  assert.equal(t.c.cs.origin, 'auto'); assert.equal(t.c.cs.stalled, false);
  t.end();
});

test('2026-10-29 seahut reader: a service discovery longer than the stall limit is never dropped - the stall check runs only on a link the loop serves', async () => {
  const dev = new FakeDev(), t = harness(dev, { o: { secMs: 100 } });   // an attempt has 1.5 s here, as a phone has 15 s
  t.c.tell('connect');
  await t.until(() => t.c.cs.gotData, 'data');
  dev.stream = false; dev.stopStream();
  await t.until(() => t.ev.includes('down (stalled)'), 'the stall');
  dev.stream = true;
  const before = dev.connects, drops = () => t.log.filter((l) => /^dropping link/.test(l)).length, d0 = drops();
  dev.serviceMs = 900;                                                 // 3x the stall limit, 1.5x the startup grace (the phone took 1.8 s)
  await t.until(() => t.ev.filter((e) => e === 'connected').length === 2, 'the slow reconnect');
  assert.equal(dev.connects - before, 1, 'one attempt, never dropped while it discovered the service');
  assert.equal(drops(), d0, 'no drop during the discovery');
  await t.until(() => t.c.cs.gotData, 'data');
  t.end();
});

test('2026-10-29 seahut reader: a link that falls during discovery is the attempt\'s to report - it retries, no countdown beside it', async () => {
  const dev = new FakeDev({ serviceMs: 120 }), t = harness(dev);
  t.c.tell('connect');
  await t.until(() => t.log.some((l) => /^gatt: server connected/.test(l)), 'the server');
  dev.fall();                                                          // during getPrimaryService
  await t.phase('connected');
  assert.deepEqual(t.ev, ['chooser', 'attempt 1', 'attempt 2', 'connected']);
  assert.ok(t.log.some((l) => /^connect: attempt 1 failed after \d+ ms: GATT Server is disconnected/.test(l)), t.log.join('\n'));
  assert.ok(!t.log.some((l) => /-> countdown/.test(l)), 'no countdown started beside the attempt');
  t.end();
});

test('a normal drop counts down 10 s; Reconnect now makes exactly one attempt; a second tap while it runs is ignored', async () => {
  const dev = new FakeDev(), t = harness(dev);
  t.c.tell('connect');
  await t.until(() => t.c.cs.gotData, 'data');
  dev.fall();
  await t.phase('countdown');
  assert.equal(t.c.cs.count, RECONNECT_S.auto);
  const before = dev.connects;
  dev.serviceMs = 80;
  t.c.tell('now'); await t.phase('connecting'); t.c.tell('now'); t.c.tell('connect');
  await t.phase('connected');
  await sleep(RECONNECT_S.auto * 20 + 100);                            // longer than the countdown would have run
  assert.equal(dev.connects - before, 1, 'exactly one attempt (2026-09-17)');
  assert.ok(t.log.includes('conn: now ignored (an attempt is in progress)') && t.log.includes('conn: connect ignored (an attempt is in progress)'), t.log.join('\n'));
  assert.equal(t.c.cs.origin, 'manual');
  t.end();
});

test('a picked device that refuses every attempt counts down 5 s and tries again on its own, never back to the chooser; then the BMS accepts', async () => {
  const dev = new FakeDev({ refuse: 99 }), t = harness(dev);
  t.c.tell('connect');
  await t.phase('countdown');
  assert.equal(t.c.cs.count, RECONNECT_S.chooser);
  assert.deepEqual(t.ev, ['chooser', 'attempt 1', 'attempt 2', 'attempt 3', `failed: ${REFUSED}`]);
  await t.until(() => dev.connects >= 6, 'the countdown\'s round');
  dev.refuse = 0;
  await t.phase('connected');
  assert.equal(t.ev.filter((e) => e === 'chooser').length, 1);
  t.end();
});

test('the remembered BMS connects without the chooser and counts down the auto 10 s after a failed round; Cancel and auto-off end a countdown; Bluetooth back shortens it', async () => {
  const dev = new FakeDev({ refuse: 99 }), t = harness(dev, { device: null });
  const t2 = harness(dev, { device: dev });
  t2.c.tell('known');
  await t2.phase('countdown');
  assert.equal(t2.c.cs.count, RECONNECT_S.auto); assert.equal(t2.c.cs.origin, 'known'); assert.ok(!t2.ev.includes('chooser'));
  t2.c.tell('adapter');
  await t2.until(() => t2.log.some((l) => /^reconnect: Bluetooth is back, in 3 s$/.test(l)), 'the shorter countdown');
  assert.ok(t2.c.cs.count <= RECONNECT_S.adapter);
  t2.c.tell('cancel');
  await t2.phase('idle');
  const n = dev.connects; await sleep(400); assert.equal(dev.connects, n, 'cancelled: no more attempts');
  t2.c.tell('now');
  await t2.until(() => dev.connects > n, 'Reconnect now from idle');
  await t2.phase('countdown');
  t2.c.tell('auto-off');
  await t2.phase('idle');
  t2.end(); t.end();
});

test('the person\'s Disconnect closes the link and stays idle; Connect while connected opens the chooser after closing it; a cancelled chooser stays idle', async () => {
  const dev = new FakeDev(), t = harness(dev);
  t.c.tell('connect');
  await t.until(() => t.c.cs.gotData, 'data');
  t.c.tell('connect');
  await t.until(() => t.ev.filter((e) => e === 'connected').length === 2, 'the second pick');
  assert.deepEqual(t.ev.slice(0, 7), ['chooser', 'attempt 1', 'connected', 'down', 'chooser', 'attempt 1', 'connected']);
  t.c.tell('disconnect');
  await t.phase('idle');
  assert.equal(dev.gatt.connected, false);
  await sleep(300); assert.equal(t.c.cs.phase, 'idle', 'no countdown after the person\'s own Disconnect');
  t.end();
  const t3 = harness(new FakeDev(), { chooser: false });
  t3.c.tell('connect');
  await t3.until(() => t3.ev.includes('chooser'), 'the chooser');
  await t3.phase('idle');
  assert.deepEqual(t3.ev, ['chooser']);
  t3.end();
});

test('queued readings of a frozen tab void the link (the boundary sets the Flag): the loop drops it and counts down the auto 10 s', async () => {
  const dev = new FakeDev(), t = harness(dev);
  t.c.tell('connect');
  await t.until(() => t.c.cs.gotData, 'data');
  t.bms.voidGapS = 3600; t.bms.voided.set(true);                       // what _onNotify does on a chunk after a long gap
  await t.phase('countdown');
  assert.equal(t.c.cs.count <= RECONNECT_S.auto && t.c.cs.count > RECONNECT_S.stalled, true);
  assert.ok(t.log.includes('dropping link: 3600 s without data - queued readings dropped'), t.log.join('\n'));
  t.end();
});

test('2026-10-07 crash: a connect that ran with Bluetooth off is never cancelled - past stuckMs no retries, no countdown, a tap explains it again; settled -> on we go', async () => {
  const dev = new FakeDev({ hang: 99 }), t = harness(dev, { o: { stuckMs: 700 } });
  t.c.tell('connect');
  await t.phase('stuck');
  assert.ok(t.log.some((l) => /^connect: attempt 1 failed after \d+ ms: no answer in 15 s$/.test(l)), 'the attempt gave up on its side (15 "seconds")');
  assert.equal(dev.disconnects, 0, 'gatt.disconnect() on a pending connect crashes Chrome Android: never called');
  const n = dev.connects;
  t.c.tell('connect'); t.c.tell('now');
  await t.until(() => t.ev.filter((e) => e === 'stuck').length === 3, 'the sheet again');
  await sleep(300);
  assert.equal(dev.connects, n, 'no retry while stuck'); assert.equal(t.c.cs.phase, 'stuck');
  assert.equal(t.ev.filter((e) => e === 'chooser').length, 1);
  dev.hang = 0;
  for (const p of dev.pending) p.reject(new Error('gone'));            // the stack settles every queued connect together
  await t.phase('connected');
  assert.ok(t.log.includes('gatt: the pending connect settled after all') && t.log.some((l) => /-> countdown \(settled, 10 s\)/.test(l)), t.log.join('\n'));
  assert.equal(dev.disconnects, 0);
  t.end();
});

test('stop() ends the loop wherever it waits; start() refuses a second loop', async () => {
  const dev = new FakeDev(), t = harness(dev);
  t.c.tell('connect');
  const task = t.c.task;
  t.c.start(); assert.equal(t.c.task, task, 'one loop');
  await t.until(() => t.c.cs.gotData, 'data');
  t.c.stop(); await task;
  assert.equal(t.c.running, false);
  dev.stopStream();
});
