// BatRay by ClearEvo.com - review tests (fable, round 2) F2-2: a BMS that connects but never streams is reconnected for ever with no back-off
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
//
// 0.9.91 backs off after rounds that FAIL to connect (backoffS: 10/20/40/60 s). conn.js resets the count on every
// other end ("any other end means a link was up"), so a link that comes up and never gives one reading - the m-00
// pack of 2026-09-23..25 (connected, answered the handshake, never streamed, fell ~10 s later, for days), a BMS
// whose module is up while its MCU is not, a link the stack reports connected and never delivers on - is dropped
// by the stall rule and reconnected 3 s later, again and again: the same GATT client churn round 1 limited for
// refused connects, plus one settings read per connect, which is what makes a JK BMS beep. Nothing slows it down.
// Policy asserted, the one 0.9.91 adopted for failed rounds: after 10 rounds in a row that never produced a
// reading, the rounds come no faster than one a minute; a round that did read starts over.
// Run: node --test test/review/fable_r2_stall_storm.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { BleConn } from '../../public/batray/conn.js';
import { JkBms } from '../../public/batray/jkbms.js';
import { sleep } from '../../public/batray/sync.js';

/** A BMS whose GATT link comes up at once and never sends a byte. */
class Mute extends EventTarget {
  constructor() {
    super(); this.id = 'mute-1'; this.name = 'm-00'; this.connects = 0;
    const char = new EventTarget();
    Object.assign(char, { startNotifications: async () => char, writeValueWithoutResponse: async () => {} });
    const gatt = { connected: false, connect: async () => { this.connects++; gatt.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => char }) }; },
      disconnect: () => { if (!gatt.connected) return; gatt.connected = false; this.dispatchEvent(new Event('gattserverdisconnected')); } };
    this.gatt = gatt;
  }
}

test('a link that never streams: after 10 such rounds the loop backs off to at most one round a minute (simulated hour)', async () => {
  const SEC = 4;                                                       // one simulated second = 4 ms: an hour is 14.4 s
  const dev = new Mute(), bms = new JkBms();
  const h = { log: () => {}, autoRe: () => true, device: () => dev, changed: () => {}, choose: async () => dev, fresh: async (d) => d, attempt: () => {}, connected: () => {}, failed: () => {}, stalled: () => {}, down: () => {}, stuck: () => {} };
  const c = new BleConn(bms, h, { secMs: SEC, tickMs: SEC / 4, gapMs: 1.5 * SEC, downWaitMs: 2 * SEC, freshMs: 2 * SEC, stuckMs: 45 * SEC, writeMs: 2 * SEC,
    link: { staleMs: 12 * SEC, startupMs: 20 * SEC, handshakeMs: 1.5 * SEC, nudgeMs: 3 * SEC, quickMs: SEC } });
  c.tell('known');
  const t0 = Date.now();
  let after10 = null, at10 = 0;
  while (Date.now() - t0 < 3600 * SEC) {
    await sleep(20);
    if (after10 === null && dev.connects >= 10) { after10 = Date.now(); at10 = dev.connects; }
  }
  c.stop();
  assert.ok(after10 !== null, `the loop made ${dev.connects} connects in the hour`);
  const minutes = (Date.now() - after10) / (60 * SEC);
  const roundsPerMin = (dev.connects - at10) / minutes;
  console.log(`connects in the simulated hour: ${dev.connects}; after round 10: ${roundsPerMin.toFixed(2)} rounds a minute`);
  assert.ok(roundsPerMin <= 1.05, `after 10 rounds without one reading the loop still connects ${roundsPerMin.toFixed(2)} times a minute`);
});
