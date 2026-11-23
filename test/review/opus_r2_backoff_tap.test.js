// BatRay by ClearEvo.com - review round 2 (Opus), O2-3: the back-off outlives a stop; a fresh tap gets a minute
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
// 0.9.91 (round 1's O4): cs.failRounds counts failed rounds in a row and the countdown doubles to 60 s. It is reset only
// when a round ends some other way (after(): r.end !== 'failed'); a stop (Cancel, Disconnect, auto reconnect off) goes
// to idle with the count kept. A BMS that was off all night leaves failRounds high; the person comes, cancels, taps
// Connect, picks the BMS - and when Android refuses that round (status 133, common on a first connect) the countdown is
// the full minute, not the chooser's 5 s (RECONNECT_S.chooser): a person standing at the phone waits a minute.
// Run: node --test test/review/opus_r2_backoff_tap.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { BleConn } from '../../public/batray/conn.js';
import { JkBms } from '../../public/batray/jkbms.js';
import { RECONNECT_S } from '../../public/batray/conn-logic.js';
import { sleep } from '../../public/batray/sync.js';

const REFUSED = 'Connection Error: Connection attempt failed.';
class Refuser extends EventTarget {
  constructor() { super(); this.id = 'gone-1'; this.name = 'n11'; this.connects = 0; this.gatt = { connected: false, connect: () => { this.connects++; return Promise.reject(new Error(REFUSED)); }, disconnect: () => {} }; }
}

test('a fresh tap after a stop starts the back-off again: a refused round after the chooser counts down RECONNECT_S.chooser, not a minute', async () => {
  const SEC = 4, dev = new Refuser(), bms = new JkBms(), log = [];
  const h = { log: (m) => log.push(m), autoRe: () => true, device: () => dev, changed: () => {}, choose: async () => dev, fresh: async (d) => d, attempt: () => {}, connected: () => {}, failed: () => {}, stalled: () => {}, down: () => {}, stuck: () => {} };
  const c = new BleConn(bms, h, { secMs: SEC, gapMs: 1.5 * SEC, downWaitMs: 2 * SEC, freshMs: 2 * SEC, stuckMs: 45 * SEC });
  c.tell('known');
  const t0 = Date.now();
  while (c.cs.failRounds < 7 && Date.now() - t0 < 20000) await sleep(10);   // a night of refusals: the back-off is at its cap
  c.tell('cancel');
  while (c.cs.phase !== 'idle') await sleep(5);
  c.tell('connect');                                                         // the person: Connect, picks the BMS; Android refuses the round
  while (!(c.cs.phase === 'countdown' && log.some((l, i) => i > log.lastIndexOf('conn: idle -> choosing') && /-> countdown/.test(l)))) await sleep(5);
  const line = log.filter((l) => /-> countdown/.test(l)).pop();
  c.stop();
  assert.equal(c.cs.count <= RECONNECT_S.chooser, true, `after a stop and a fresh Connect tap the countdown is ${c.cs.count} s (${line}); failRounds ${c.cs.failRounds}`);
});
