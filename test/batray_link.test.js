// BatRay by ClearEvo.com - the socket generation and the wake lock's one-request-in-flight (tests)
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
import { socketState, socketOpen, socketOwns, socketClosed, socketNudge } from '../public/batray/link-logic.js';
import { wakeState, wakeShouldRequest, wakeRequestStart, wakeAcquired, wakeRefused, wakeReleased } from '../public/batray/wake-logic.js';

test('signalling socket generation: a nudge during a closing socket opens a new one, the old socket\'s late close must not reopen a third', () => {
  const ss = socketState();
  const g1 = socketOpen(ss); assert.equal(socketOwns(ss, g1), true);
  assert.equal(socketNudge(false, 1), 'none', 'open socket: nothing to do');
  assert.equal(socketNudge(false, 0), 'none', 'connecting: nothing to do');
  assert.equal(socketNudge(false, 2), 'open', 'closing: open a new one now');
  const g2 = socketOpen(ss);
  assert.equal(socketClosed(ss, g1, false), 'ignore', 'the old socket closes late: no reopen (this made viewers=2 blips)');
  assert.equal(socketOwns(ss, g1), false); assert.equal(socketOwns(ss, g2), true);
  assert.equal(socketClosed(ss, g2, false), 'reopen');
  assert.equal(socketClosed(ss, g2, true), 'done', 'closed for good: no reopen');
  assert.equal(socketNudge(true, 3), 'none');
});

test('wake lock: one request in flight at a time (two overlapping requests held two locks)', () => {
  const ws = wakeState(true); ws.wanted = true;
  assert.equal(wakeShouldRequest(ws, true), true);
  wakeRequestStart(ws); assert.equal(wakeShouldRequest(ws, true), false, 'a second call while the first awaits asks nothing');
  wakeAcquired(ws); assert.equal(ws.requesting, false); assert.equal(wakeShouldRequest(ws, true), false, 'held');
  wakeReleased(ws, false); assert.equal(wakeShouldRequest(ws, true), true);
  wakeRequestStart(ws); assert.equal(wakeRefused(ws, true), 'refused'); assert.equal(ws.requesting, false); assert.equal(wakeShouldRequest(ws, true), true, 'a refusal frees the slot for the retry');
});
