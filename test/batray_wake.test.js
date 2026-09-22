// BatRay by ClearEvo.com - tests (batray_wake.test.js): the screen wake lock rules replayed from the old Sony phone (2026-09-19)
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
import { wakeState, wakeMode, wakeShouldRequest, wakeAcquired, wakeReleased, wakeRefused, wakeRetryDelayMs, wakeVideoWanted, WAKE_RETRY_MAX_MS } from '../public/batray/wake-logic.js';

test('old Sony: a lock the system drops while in front is asked for again with a growing delay; the second drop starts the video', () => {
  const ws = wakeState(true); ws.wanted = true; ws.mode = 'auto';
  assert.equal(wakeShouldRequest(ws, true), true);
  wakeAcquired(ws); assert.equal(wakeShouldRequest(ws, true), false);
  assert.equal(wakeReleased(ws, true), 'dropped'); assert.equal(ws.drops, 1);
  assert.equal(wakeShouldRequest(ws, true), true); assert.equal(wakeRetryDelayMs(ws), 2000); assert.equal(wakeVideoWanted(ws), false);
  wakeAcquired(ws); assert.equal(wakeReleased(ws, true), 'dropped'); assert.equal(ws.drops, 2);
  assert.equal(wakeRetryDelayMs(ws), 4000); assert.equal(wakeVideoWanted(ws), true);
});

test('a release because the tab left the front, or because nothing wants the screen, is not a drop', () => {
  const ws = wakeState(true); ws.wanted = true; wakeAcquired(ws);
  assert.equal(wakeReleased(ws, false), 'released'); assert.equal(ws.drops, 0);
  assert.equal(wakeShouldRequest(ws, false), false);
  wakeAcquired(ws); ws.wanted = false;
  assert.equal(wakeReleased(ws, true), 'released'); assert.equal(ws.drops, 0); assert.equal(wakeVideoWanted(ws), false);
});

test('a refused lock (battery saver) or a browser without the API starts the video at once in auto; the delay caps at 30 s', () => {
  const ws = wakeState(true); ws.wanted = true; ws.mode = 'auto';
  assert.equal(wakeRefused(ws, false), 'hidden'); assert.equal(ws.refusals, 0, '2026-09-22 viewer log: "page is not visible" is not a refusal');
  assert.equal(wakeRefused(ws), 'refused'); assert.equal(ws.refusals, 1); assert.equal(wakeVideoWanted(ws), true);
  for (let i = 0; i < 10; i++) wakeRefused(ws);
  assert.equal(wakeRetryDelayMs(ws), WAKE_RETRY_MAX_MS);
  const none = wakeState(false); none.wanted = true; none.mode = 'auto';
  assert.equal(wakeShouldRequest(none, true), false); assert.equal(wakeVideoWanted(none), true);
});

test('the default is the wake lock alone (never); never and always override the counters; a viewer never plays the video', () => {
  const ws = wakeState(true); ws.wanted = true;
  assert.equal(ws.mode, 'never'); wakeRefused(ws); ws.drops = 5; assert.equal(wakeVideoWanted(ws), false, 'no video by default however often the lock drops');
  ws.mode = 'always'; assert.equal(wakeVideoWanted(ws), true);
  ws.mode = 'never'; assert.equal(wakeVideoWanted(ws), false);
  assert.equal(wakeMode('sometimes'), 'never'); assert.equal(wakeMode(null), 'never'); assert.equal(wakeMode('always'), 'always'); assert.equal(wakeMode('auto'), 'auto');
  ws.wanted = false; ws.mode = 'always'; assert.equal(wakeVideoWanted(ws), false);
  const v = wakeState(true, true); v.wanted = true; v.mode = 'always'; v.drops = 9; assert.equal(wakeVideoWanted(v), false, 'a viewer never plays it');
});
