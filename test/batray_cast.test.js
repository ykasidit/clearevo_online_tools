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
import { castState, onCastStateEvent, discoveryKnown, castTapDecision, castAfterDiscovery, castRequestStarted, castRequestEnded, castErrorDecision, CAST_DISCOVERY_WAIT_MS, CAST_FLOW_TIMEOUT_MS, castFlowStart, castFlowPhase, castFlowEnd, castProgress, castButtons, castStateUi, castTapAllowed, CAST_FLIP_WAIT_MS, castSettle, castPhaseBudgetMs, castTvUpdate, CAST_TV_WAIT_MS } from '../public/batray/cast-logic.js';

test('new phone: the loading tap waits for discovery; the flip 6 s in is past the tap, so it asks for another; the next tap requests once; a third tap while pending does not', () => {
  const cs = castState(); const t0 = 1000;
  let d = castTapDecision(cs, { loadedBeforeTap: false, hasSession: false, activationActive: true, now: t0 });
  assert.deepEqual(d, { action: 'wait-discovery', ms: CAST_FLIP_WAIT_MS });
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

test('availability that never flips on its own (the owner\'s phone, logs 2026-09-26 and 2026-09-27): after the short flip wait the loading tap requests anyway - the request is what starts discovery there', () => {
  const cs = castState(); onCastStateEvent(cs, 'NOT_CONNECTED');
  assert.equal(CAST_FLIP_WAIT_MS, 4000);
  assert.deepEqual(castAfterDiscovery(cs, { loadedBeforeTap: false, activationActive: true, now: 4000 }), { action: 'request' });
  assert.deepEqual(castAfterDiscovery(cs, { loadedBeforeTap: false, activationActive: false, now: 4000 }), { action: 'tap-again', why: 'activation' }, 'only an expired activation asks for another tap');
  onCastStateEvent(cs, 'NO_DEVICES_AVAILABLE');
  assert.deepEqual(castAfterDiscovery(cs, { loadedBeforeTap: false, activationActive: true, now: 4100 }), { action: 'no-devices' });
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

test('replay 2026-09-26 00:09: a second tap requests while the first still waits for discovery; the flip 0.1 s later must NOT make the first tap request too (it did: invalid_parameter, "stuck" toast), and the failed call must not clear the pending request', () => {
  const cs = castState(); const t = (s) => Math.round(s * 1000);
  let d = castTapDecision(cs, { loadedBeforeTap: false, hasSession: false, activationActive: true, now: t(19.390) });   // tap 1 loads the library
  assert.deepEqual(d, { action: 'wait-discovery', ms: CAST_FLIP_WAIT_MS });
  assert.equal(onCastStateEvent(cs, 'NOT_CONNECTED'), false);                                                          // 19.625
  d = castTapDecision(cs, { loadedBeforeTap: true, hasSession: false, activationActive: true, now: t(26.610) });        // tap 2, 7 s later: the picker
  assert.deepEqual(d, { action: 'request' });
  const tok = castRequestStarted(cs, t(26.610));
  assert.equal(onCastStateEvent(cs, 'NO_DEVICES_AVAILABLE'), false);                                                   // 26.650
  assert.equal(onCastStateEvent(cs, 'NOT_CONNECTED'), true);                                                            // 26.752: tap 1's wait ends
  d = castAfterDiscovery(cs, { loadedBeforeTap: false, activationActive: false, now: t(26.753) });
  assert.deepEqual(d, { action: 'pending', ageS: 0 }, 'tap 1 sees the request tap 2 opened and does nothing');
  castRequestEnded(cs, t(26.753));                                                                                      // a stray end with another token
  assert.equal(cs.requestAt, t(26.610), 'the pending request is still pending');
  castRequestEnded(cs, tok);                                                                                            // 34.818: the session started
  assert.equal(cs.requestAt, 0);
  assert.equal(castTapDecision(cs, { loadedBeforeTap: true, hasSession: true, now: t(40) }).action, 'load-media');
});

test('the tap flow (owner 2026-09-26): from the tap on, a second tap is "busy", both buttons are greyed with the wait icon, a state event may only touch the sheet - replay of the 00:09 log where NOT_CONNECTED 0.2 s after the load rewrote the hint and re-enabled the button', () => {
  const cs = castState(); const t = (s) => Math.round(s * 1000);
  assert.deepEqual(castButtons(cs), { disabled: false, busy: false }); assert.equal(castStateUi(cs), 'hint');
  castFlowStart(cs, t(19.390), 'loading');
  assert.deepEqual(castButtons(cs), { disabled: true, busy: true });
  assert.equal(castTapAllowed(cs), false, 'a second tap does nothing');
  assert.equal(castTapDecision(cs, { loadedBeforeTap: true, hasSession: false, activationActive: true, now: t(19.5) }).action, 'request', 'the running flow itself still decides normally');
  onCastStateEvent(cs, 'NOT_CONNECTED');                                                                               // 19.625
  assert.equal(castStateUi(cs), 'sheet', 'the state event must not rewrite the hint or free the button');
  castFlowPhase(cs, 'looking');
  assert.deepEqual(castProgress(cs, t(19.390 + 5), 20000), { pct: 25, leftS: 15, timedOut: false });
  assert.deepEqual(castProgress(cs, t(19.390 + 20), 20000), { pct: 100, leftS: 0, timedOut: true }, 'looking times out at 20 s');
  castFlowPhase(cs, 'picking'); castRequestStarted(cs, t(30));
  assert.equal(castProgress(cs, t(60), 20000).timedOut, false, 'picking never times out: the list is on the screen');
  castFlowEnd(cs);
  assert.deepEqual(castButtons(cs), { disabled: true, busy: true }, 'a request still open keeps the buttons greyed');
  assert.equal(castStateUi(cs), 'sheet');
  castRequestEnded(cs);
  assert.deepEqual(castButtons(cs), { disabled: false, busy: false }); assert.equal(castStateUi(cs), 'hint'); assert.equal(castTapAllowed(cs), true);
  assert.equal(castProgress(cs, t(99)).pct, 0, 'no flow, no progress');
  assert.equal(CAST_FLOW_TIMEOUT_MS, 20000); assert.equal(CAST_DISCOVERY_WAIT_MS, 20000);
});

test('the TV wait (owner 2026-09-28, "waits the full minute, clean cancel, not drop away"): after the accepted load the flow stays busy in "waiting" on its own 60 s clock, BUFFERING is progress, PLAYING settles it with the sheet still up and the buttons free, 60 s without a player is "nomedia" - replay of the 00:55 log where the media session came 19 s after the load', () => {
  const cs = castState(); const t = (s) => Math.round(s * 1000);
  assert.equal(castPhaseBudgetMs('loading'), 20000); assert.equal(castPhaseBudgetMs('looking'), 20000);
  assert.equal(castPhaseBudgetMs('picking'), 0); assert.equal(castPhaseBudgetMs('sending'), 0);
  assert.equal(castPhaseBudgetMs('waiting'), CAST_TV_WAIT_MS); assert.equal(castPhaseBudgetMs('buffering'), CAST_TV_WAIT_MS); assert.equal(CAST_TV_WAIT_MS, 60000);
  assert.equal(castPhaseBudgetMs('playing'), 0); assert.equal(castPhaseBudgetMs('nomedia'), 0);
  castFlowStart(cs, t(0), 'loading'); castFlowPhase(cs, 'picking'); const tok = castRequestStarted(cs, t(3));
  castFlowPhase(cs, 'sending'); castRequestEnded(cs, tok);
  assert.deepEqual(castProgress(cs, t(30)), { pct: 0, leftS: 0, timedOut: false }, 'sending has no clock');
  castFlowPhase(cs, 'waiting', t(30));                                            // loadMedia accepted at +30 s: the clock restarts
  assert.equal(cs.since, t(30));
  assert.deepEqual(castButtons(cs), { disabled: true, busy: true }, 'still busy while the TV is silent');
  assert.equal(castStateUi(cs), 'sheet');
  assert.deepEqual(castProgress(cs, t(45)), { pct: 25, leftS: 45, timedOut: false });
  assert.equal(castTvUpdate(cs, 'IDLE', undefined), 'none', 'IDLE without a reason (the receiver before the media) changes nothing');
  assert.equal(castTvUpdate(cs, 'BUFFERING', undefined), 'buffering');
  castFlowPhase(cs, 'buffering');
  assert.equal(castProgress(cs, t(49)).pct, 32, 'buffering keeps the waiting clock');
  assert.equal(castTvUpdate(cs, 'PLAYING', undefined), 'playing');                 // +19 s in the log
  castSettle(cs, 'playing');
  assert.deepEqual(castButtons(cs), { disabled: false, busy: false }, 'the buttons come back at once');
  assert.equal(castTapAllowed(cs), true);
  assert.equal(cs.phase, 'playing', 'the sheet keeps the result until the user closes it');
  assert.deepEqual(castProgress(cs, t(99)), { pct: 0, leftS: 0, timedOut: false });
  assert.equal(castTvUpdate(cs, 'BUFFERING', undefined), 'none', 'a settled flow ignores later states');
  castFlowEnd(cs); assert.equal(cs.phase, null);
  // the silent TV
  castFlowStart(cs, t(100), 'waiting');
  assert.deepEqual(castProgress(cs, t(159)), { pct: 98, leftS: 1, timedOut: false });
  assert.deepEqual(castProgress(cs, t(160)), { pct: 100, leftS: 0, timedOut: true }, 'a minute without a player');
  assert.equal(castTvUpdate(cs, 'IDLE', 'ERROR'), 'error');
  castSettle(cs, 'nomedia'); assert.equal(castStateUi(cs), 'hint'); assert.equal(cs.phase, 'nomedia');
});
