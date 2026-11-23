// BatRay by ClearEvo.com - review round 1 (Opus), O-storm: an unreachable BMS is retried at full rate for ever
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
// The seahut reader's night of 2026-10-29/30 (0.9.80): ~650 GATT connects an hour for 13.5 h, almost all refused by
// Android (status 133, "Connection attempt failed"), two links in the whole night. 0.9.82 fixed the watchdog that
// caused some of them, but the loop still has no back-off: three attempts 1.5 s apart, a 10 s countdown, again, for
// as long as the page lives. A BMS that is switched off, out of range or held by the JK app for a day costs ~17000
// connectGatt calls, each a GATT client registration in Android's stack - the stack the owner's phones wedge
// ("only closing Chrome clears it"). That the rate itself wedges the stack is NOT shown here; what is shown is that
// nothing slows it down. Back-off policy asserted: after 10 failed rounds the rounds come no faster than 1 a minute.
// Run: node --test test/review/opus_r1_conn_storm.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { BleConn } from '../../public/batray/conn.js';
import { JkBms } from '../../public/batray/jkbms.js';
import { sleep } from '../../public/batray/sync.js';

const REFUSED = 'Connection Error: Connection attempt failed.';
/** A BMS that Android refuses every time (status 133, at once). */
class Refuser extends EventTarget {
  constructor() { super(); this.id = 'gone-1'; this.name = 'n11'; this.connects = 0; this.gatt = { connected: false, connect: () => { this.connects++; return Promise.reject(new Error(REFUSED)); }, disconnect: () => {} }; }
}

test('an unreachable BMS: after 10 failed rounds the loop backs off to at most one round a minute (simulated hour)', async () => {
  const SEC = 4;                                                       // one simulated second = 4 ms: an hour is 14.4 s
  const dev = new Refuser(), bms = new JkBms();
  const h = { log: () => {}, autoRe: () => true, device: () => dev, changed: () => {}, choose: async () => dev, fresh: async (d) => d, attempt: () => {}, connected: () => {}, failed: () => {}, stalled: () => {}, down: () => {}, stuck: () => {} };
  const c = new BleConn(bms, h, { secMs: SEC, gapMs: 1.5 * SEC, downWaitMs: 2 * SEC, freshMs: 2 * SEC, stuckMs: 45 * SEC });
  c.tell('known');
  const t0 = Date.now();
  let after10 = null, at10 = 0;
  while (Date.now() - t0 < 3600 * SEC) {
    await sleep(20);
    if (after10 === null && dev.connects >= 30) { after10 = Date.now(); at10 = dev.connects; }
  }
  c.stop();
  const hours = (Date.now() - after10) / (3600 * SEC);
  const roundsPerMin = (dev.connects - at10) / 3 / (hours * 60);
  console.log(`connects in the simulated hour: ${dev.connects} (${Math.round(dev.connects / ((Date.now() - t0) / (3600 * SEC)))} per hour); after round 10: ${roundsPerMin.toFixed(2)} rounds a minute`);
  assert.ok(roundsPerMin <= 1.05, `after 10 refused rounds the loop still runs ${roundsPerMin.toFixed(2)} rounds (x3 connects) a minute`);
});
