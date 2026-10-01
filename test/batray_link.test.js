// BatRay by ClearEvo.com - link-logic replays: attempt ownership, the viewer / publisher link phases, the socket
// generation (tests)
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
import { linkState, linkEvent, attemptStart, attemptOwns, attemptCancel, socketState, socketOpen, socketOwns, socketClosed, socketNudge } from '../public/batray/link-logic.js';
import { wakeState, wakeShouldRequest, wakeRequestStart, wakeAcquired, wakeRefused, wakeReleased } from '../public/batray/wake-logic.js';

test('attempt ownership: a newer start or a cancel supersedes the token in flight', () => {
  const ls = linkState();
  const a = attemptStart(ls, 'sfu-connecting'); assert.equal(attemptOwns(ls, a), true);
  const b = attemptStart(ls, 'sfu-connecting'); assert.equal(attemptOwns(ls, a), false); assert.equal(attemptOwns(ls, b), true);
  attemptCancel(ls); assert.equal(attemptOwns(ls, b), false);
});

test('viewer, replay of the 2026-09-30 12:55 log: transport down -> retry; resume -> an SFU attempt; the direct channel opens 0.6 s later and the attempt\'s failure is dropped, the link stays p2p, no retry', () => {
  const ls = linkState(); const closed = "Failed to execute 'addTransceiver' on 'RTCPeerConnection': The RTCPeerConnection's signalingState is 'closed'.";
  const inp = { hasReader: true, stopped: false };
  // 06:10 the SFU link had been live
  const t1 = linkEvent(ls, 'sfu-start', inp).token; assert.deepEqual(linkEvent(ls, 'sfu-open', { token: t1 }), { action: 'live' }); assert.equal(ls.phase, 'sfu');
  // 12:55:10.9 ice disconnected on that transport
  assert.deepEqual(linkEvent(ls, 'transport-down', { token: t1 }), { action: 'retry' });
  assert.deepEqual(linkEvent(ls, 'retry', { stopped: false }), { action: 'countdown' }); assert.equal(ls.phase, 'retry');
  assert.deepEqual(linkEvent(ls, 'transport-down', { token: t1 }), { action: 'ignore', why: 'not the live transport' }, 'the same transport again: nothing');
  // 12:55:12.1 tab resumed -> retry now -> attempt 2
  assert.deepEqual(linkEvent(ls, 'resume', inp), { action: 'subscribe' });
  const d2 = linkEvent(ls, 'sfu-start', inp); assert.equal(d2.action, 'connect'); const t2 = d2.token; assert.equal(ls.phase, 'sfu-connecting');
  // 12:55:13.6 the direct channel opened while attempt 2 awaited the session POST
  assert.deepEqual(linkEvent(ls, 'p2p-open'), { action: 'use-p2p' }); assert.equal(ls.phase, 'p2p'); assert.equal(attemptOwns(ls, t2), false, 'attempt 2 is superseded');
  // 12:55:14.3 attempt 2 wakes up with the error
  const f = linkEvent(ls, 'sfu-failed', { token: t2, stopped: false, message: closed }); assert.equal(f.action, 'ignore'); assert.equal(f.why, 'the direct link is up');
  assert.equal(ls.phase, 'p2p'); assert.equal(ls.sfu, false);
  assert.deepEqual(linkEvent(ls, 'retry', { stopped: false }), { action: 'none', why: 'the direct link is up' }, 'and no retry can start over a direct link');
  assert.deepEqual(linkEvent(ls, 'sfu-start', inp), { action: 'none', why: 'the direct link is up' });
  // later the direct link drops: back to the SFU
  assert.deepEqual(linkEvent(ls, 'p2p-closed', inp), { action: 'subscribe' }); assert.equal(ls.phase, 'idle');
  const t3 = linkEvent(ls, 'sfu-start', inp).token; assert.deepEqual(linkEvent(ls, 'sfu-open', { token: t3 }), { action: 'live' });
  assert.deepEqual(linkEvent(ls, 'sfu-open', { token: t2 }), { action: 'ignore', why: 'superseded' }, 'a very late open of attempt 2');
  linkEvent(ls, 'no-reader'); assert.equal(ls.phase, 'idle'); assert.equal(attemptOwns(ls, t3), false);
  assert.deepEqual(linkEvent(ls, 'p2p-timeout', inp), { action: 'subscribe' });
  assert.deepEqual(linkEvent(ls, 'p2p-closed', { hasReader: false, stopped: false }), { action: 'none', why: 'no reader session' });
  assert.deepEqual(linkEvent(ls, 'sfu-start', { hasReader: true, stopped: true }), { action: 'none', why: 'stopped' });
});

test('publisher: a retry countdown and a tab resume both want an attempt - the second start supersedes the first, the first\'s open is ignored, a real failure retries, 429 is "server full", "not connected" moves to TURN', () => {
  const ls = linkState();
  const t1 = linkEvent(ls, 'sfu-start', { stopped: false }).token; assert.deepEqual(linkEvent(ls, 'sfu-open', { token: t1 }), { action: 'live' });
  assert.deepEqual(linkEvent(ls, 'transport-down', { token: t1 }), { action: 'retry' });
  assert.deepEqual(linkEvent(ls, 'retry', { stopped: false }), { action: 'countdown' });
  assert.deepEqual(linkEvent(ls, 'retry-fired', { stopped: false }), { action: 'subscribe' });
  const t2 = linkEvent(ls, 'sfu-start', { stopped: false }).token;             // the countdown's attempt
  assert.deepEqual(linkEvent(ls, 'resume', { stopped: false }), { action: 'none', why: 'sfu-connecting' }, 'a resume during an attempt starts nothing');
  const t3 = linkEvent(ls, 'sfu-start', { stopped: false }).token;             // say something started another anyway
  assert.deepEqual(linkEvent(ls, 'sfu-open', { token: t2 }), { action: 'ignore', why: 'superseded' });
  assert.deepEqual(linkEvent(ls, 'sfu-open', { token: t3 }), { action: 'live' });
  assert.deepEqual(linkEvent(ls, 'sfu-failed', { token: t2, stopped: false, message: 'channel closed' }), { action: 'ignore', why: 'a newer attempt replaced it' });
  assert.deepEqual(linkEvent(ls, 'transport-down', { token: t3 }), { action: 'retry' });
  const t4 = linkEvent(ls, 'sfu-start', { stopped: false }).token;
  assert.deepEqual(linkEvent(ls, 'sfu-failed', { token: t4, stopped: false, status: 429, message: 'sfu/session: 429' }), { action: 'retry', full: true, toRelay: false }); assert.equal(ls.phase, 'retry');
  const t5 = linkEvent(ls, 'sfu-start', { stopped: false }).token;
  assert.deepEqual(linkEvent(ls, 'sfu-failed', { token: t5, stopped: false, message: 'not connected in 20 s (failed)', relayOnly: false }), { action: 'retry', full: false, toRelay: true });
  assert.deepEqual(linkEvent(ls, 'sfu-failed', { token: t5, stopped: true, message: 'x' }), { action: 'stop' });
  linkEvent(ls, 'stop'); assert.equal(ls.phase, 'idle');
});

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
