// BatRay by ClearEvo.com - log review 2026-11-27 (Fable), L2: a remembered BMS after a reload is "no longer in range"
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
// Reader pd5c11 (0.9.96, Android 10, Chrome 158, getDevices=yes) 11-26 12:03: the resume sheet reconnects the known
// BMS without the chooser and every gatt.connect() is refused in 5-60 ms with "Bluetooth Device is no longer in
// range." - 3 tries x 4 rounds, back-off growing, until the person opened the chooser (connected in 1.3 s; the pack had
// been read 25 s before the reload). Chrome only connects a device from getDevices() after it has seen it advertise in
// this page: device.watchAdvertisements() first, connect on 'advertisementreceived'. The code never calls it, so the
// 0.9.72 resume and the 0.9.73 "tap to reopen" push cannot bring a reader back without a person at the phone.
// Run: node --test test/review/fable_logs_known_out_of_range.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { BleConn } from '../../public/batray/conn.js';
import { JkBms } from '../../public/batray/jkbms.js';
import { sleep } from '../../public/batray/sync.js';

const OUT = 'Bluetooth Device is no longer in range.';
class Remembered extends EventTarget {                       // a device from getDevices() after a reload
  constructor() {
    super(); this.id = 'known-1'; this.name = 'JK-known'; this.connects = 0; this.watched = 0; this.seen = false;
    this.gatt = { connected: false, disconnect: () => {}, connect: () => { this.connects++; return Promise.reject(Object.assign(new Error(this.seen ? 'test: connect allowed' : OUT), { name: 'NetworkError' })); } };
  }
  watchAdvertisements() { this.watched++; setTimeout(() => { this.seen = true; this.dispatchEvent(new Event('advertisementreceived')); }, 5); return Promise.resolve(); }
}

test('a known device refused as "no longer in range" is looked for (watchAdvertisements) before the next connect', async () => {
  const SEC = 4, dev = new Remembered(), bms = new JkBms(), log = [];
  const h = { log: (m) => log.push(m), autoRe: () => true, device: () => dev, changed: () => {}, choose: async () => dev, fresh: async (d) => d, attempt: () => {}, connected: () => {}, failed: () => {}, stalled: () => {}, down: () => {}, stuck: () => {} };
  const c = new BleConn(bms, h, { secMs: SEC, gapMs: 1.5 * SEC, downWaitMs: 2 * SEC, freshMs: 2 * SEC, stuckMs: 45 * SEC });
  c.tell('known');
  const t0 = Date.now();
  while (dev.connects < 9 && dev.watched === 0 && Date.now() - t0 < 15000) await sleep(10);   // three rounds of three tries, as in the log
  c.stop();
  assert.ok(dev.watched > 0, `${dev.connects} connects refused as out of range and watchAdvertisements() never called`);
});
