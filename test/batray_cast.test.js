// BatRay by ClearEvo.com - tests (batray_cast.test.js): the cast picker rules replayed from the two phones' logs of 2026-09-20
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
import { castState, onCastStateEvent, discoveryKnown, castTapDecision, castAfterDiscovery, castRequestStarted, castRequestEnded, castErrorDecision, CAST_DISCOVERY_WAIT_MS } from '../public/batray/cast-logic.js';

test('new phone: the loading tap waits for discovery; the flip 6 s in is past the tap, so it asks for another; the next tap requests once; a third tap while pending does not', () => {
  const cs = castState(); const t0 = 1000;
  let d = castTapDecision(cs, { loadedBeforeTap: false, hasSession: false, activationActive: true, now: t0 });
  assert.deepEqual(d, { action: 'wait-discovery', ms: CAST_DISCOVERY_WAIT_MS });
  assert.equal(onCastStateEvent(cs, 'NOT_CONNECTED'), false);        // the initial value, not discovery
  assert.equal(onCastStateEvent(cs, 'NO_DEVICES_AVAILABLE'), false);  // +6 s in the log
  assert.equal(onCastStateEvent(cs, 'NOT_CONNECTED'), true);          // +6.5 s: discovery has spoken
  assert.equal(discoveryKnown(cs), true);
  d = castAfterDiscovery(cs, { loadedBeforeTap: false, activationActive: false, now: t0 + 6500 });
  assert.deepEqual(d, { action: 'tap-again', why: 'activation' });
  d = castTapDecision(cs, { loadedBeforeTap: true, hasSession: false, activationActive: true, now: t0 + 20000 });
  assert.deepEqual(d, { action: 'request' });
  castRequestStarted(cs, t0 + 20000);
  d = castTapDecision(cs, { loadedBeforeTap: true, hasSession: false, activationActive: true, now: t0 + 44000 });
  assert.deepEqual(d, { action: 'pending', ageS: 24 });               // the old code asked again here and got invalid_parameter
  castRequestEnded(cs);
  assert.equal(castTapDecision(cs, { loadedBeforeTap: true, hasSession: true, now: t0 + 50000 }).action, 'load-media');
});

test('old phone: the flip comes 1 s after init, inside the tap, so the same tap opens the picker', () => {
  const cs = castState();
  assert.equal(castTapDecision(cs, { loadedBeforeTap: false, hasSession: false, activationActive: true, now: 0 }).action, 'wait-discovery');
  onCastStateEvent(cs, 'NOT_CONNECTED'); onCastStateEvent(cs, 'NO_DEVICES_AVAILABLE'); onCastStateEvent(cs, 'NOT_CONNECTED');
  assert.deepEqual(castAfterDiscovery(cs, { loadedBeforeTap: false, activationActive: true, now: 1010 }), { action: 'request' });
});

test('no TV on the Wi-Fi: the picker is never opened (it would never settle)', () => {
  const cs = castState(); onCastStateEvent(cs, 'NOT_CONNECTED'); onCastStateEvent(cs, 'NO_DEVICES_AVAILABLE');
  assert.deepEqual(castAfterDiscovery(cs, { loadedBeforeTap: false, activationActive: true, now: 8000 }), { action: 'no-devices' });
  assert.deepEqual(castTapDecision(cs, { loadedBeforeTap: true, hasSession: false, activationActive: true, now: 9000 }), { action: 'no-devices' });
});

test('availability that never flips: the loading tap asks for another, the next tap requests', () => {
  const cs = castState(); onCastStateEvent(cs, 'NOT_CONNECTED');
  assert.deepEqual(castAfterDiscovery(cs, { loadedBeforeTap: false, activationActive: true, now: 8000 }), { action: 'tap-again', why: 'discovery' });
  assert.deepEqual(castTapDecision(cs, { loadedBeforeTap: true, hasSession: false, activationActive: true, now: 9000 }), { action: 'request' });
});

test('a browser without userActivation (undefined) is not treated as expired', () => {
  const cs = castState(); onCastStateEvent(cs, 'NOT_CONNECTED'); onCastStateEvent(cs, 'NO_DEVICES_AVAILABLE'); onCastStateEvent(cs, 'NOT_CONNECTED');
  assert.deepEqual(castAfterDiscovery(cs, { loadedBeforeTap: false, activationActive: undefined, now: 500 }), { action: 'request' });
});

test('error codes: cancel is a closed picker, invalid_parameter a stuck library, the rest a failure', () => {
  assert.equal(castErrorDecision('cancel'), 'closed');
  assert.equal(castErrorDecision('invalid_parameter'), 'stuck');
  assert.equal(castErrorDecision('session_error'), 'failed');
  assert.equal(castErrorDecision(undefined), 'failed');
});
