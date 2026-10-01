// BatRay by ClearEvo.com - the live link's pure decisions: attempt ownership, the viewer / publisher link phases,
// the signalling socket's generation. One state object, no DOM, no network (tested by replaying real logs).
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
// THE OWNERSHIP RULE (owner, 2026-10-01, after the 2026-09-30 12:55 viewer log). JavaScript runs one thread, so
// nothing races in memory; flows interleave at every `await`. A flow that awaited can wake up after another flow
// took the link - the reader's direct channel opened while an SFU attempt was in flight, the attempt then failed
// with "signalingState is 'closed'" and wrote "reconnecting" over a stream that flowed. A lock would serialize what
// must preempt (the direct link SHOULD win), so the primitive is preempt + cooperative cancel, the kernel's
// kthread_should_stop() / Go's context.Done(): every flow that will write shared state after an await takes a
// token when it starts (`attemptStart`) and asks `attemptOwns` before each write; whoever supersedes it bumps the
// token (`attemptCancel`, or a newer attemptStart). The superseded flow exits without a word on the state.
// The same rule as a generation counter protects the signalling socket (an old socket's late close must not
// reopen a second one) and, in wake-logic, the wake lock request (two overlapping requests held two locks).

import { sfuFailureDecision } from './live-logic.js';

// ---- attempt ownership ----
export function linkState() { return { phase: 'idle', attempt: 0, p2p: false, sfu: false }; }
export function attemptStart(ls, phase) { ls.attempt++; ls.phase = phase; return ls.attempt; }
export function attemptOwns(ls, token) { return ls.attempt === token; }
export function attemptCancel(ls) { ls.attempt++; }

/**
 * The link machine, shared by the Viewer (direct p2p or SFU, one at a time) and the Publisher (SFU; its direct
 * peers are independent). phases: idle | sfu-connecting | sfu | p2p | retry. Returns { action, why?, token? }.
 * inp: { hasReader, stopped, token, status, message, relayOnly, seconds }.
 */
export function linkEvent(ls, ev, inp = {}) {
  switch (ev) {
    case 'sfu-start': {
      if (inp.stopped) return { action: 'none', why: 'stopped' };
      if (inp.hasReader === false) return { action: 'none', why: 'no reader session' };
      if (ls.p2p) return { action: 'none', why: 'the direct link is up' };
      ls.sfu = false;
      return { action: 'connect', token: attemptStart(ls, 'sfu-connecting') };   // a newer attempt supersedes any in flight
    }
    case 'sfu-open':
      if (!attemptOwns(ls, inp.token)) return { action: 'ignore', why: 'superseded' };
      if (ls.p2p) return { action: 'ignore', why: 'the direct link is up' };
      ls.phase = 'sfu'; ls.sfu = true; return { action: 'live' };
    case 'sfu-failed': {
      const d = sfuFailureDecision({ stopped: inp.stopped, mine: attemptOwns(ls, inp.token), p2pOpen: ls.p2p, status: inp.status, message: inp.message, relayOnly: inp.relayOnly });
      if (d.action === 'retry') { ls.phase = 'retry'; ls.sfu = false; attemptCancel(ls); }
      return d;
    }
    case 'transport-down':
      if (!attemptOwns(ls, inp.token) || ls.phase !== 'sfu') return { action: 'ignore', why: 'not the live transport' };
      ls.phase = 'retry'; ls.sfu = false; attemptCancel(ls); return { action: 'retry' };
    case 'retry':                                                            // the shell starts a countdown
      if (inp.stopped || ls.p2p) return { action: 'none', why: ls.p2p ? 'the direct link is up' : 'stopped' };
      ls.phase = 'retry'; ls.sfu = false; attemptCancel(ls); return { action: 'countdown' };
    case 'retry-fired': case 'resume':
      return ls.phase === 'retry' && !inp.stopped ? { action: 'subscribe' } : { action: 'none', why: ls.phase };
    case 'p2p-open':
      ls.p2p = true; ls.sfu = false; ls.phase = 'p2p'; attemptCancel(ls);     // any SFU attempt in flight finds itself superseded
      return { action: 'use-p2p' };
    case 'p2p-closed':
      ls.p2p = false;
      if (ls.phase === 'p2p') ls.phase = 'idle';
      if (inp.stopped || !inp.hasReader) return { action: 'none', why: inp.stopped ? 'stopped' : 'no reader session' };
      return ls.sfu || ls.phase === 'sfu-connecting' ? { action: 'none', why: 'the SFU link stands' } : { action: 'subscribe' };
    case 'p2p-timeout':                                                      // no direct link within the wait
      if (inp.stopped || !inp.hasReader || ls.p2p || ls.sfu || ls.phase === 'sfu-connecting') return { action: 'none' };
      return { action: 'subscribe' };
    case 'no-reader': case 'stop':
      ls.phase = 'idle'; ls.sfu = false; ls.p2p = false; attemptCancel(ls); return { action: 'drop' };
    default: return { action: 'none', why: 'unknown event ' + ev };
  }
}

// ---- the signalling socket: one generation per socket, a late event from an old one is ignored ----
export function socketState() { return { gen: 0 }; }
export function socketOpen(ss) { return ++ss.gen; }
export function socketOwns(ss, token) { return ss.gen === token; }
/** A close from the current socket reopens (unless closed for good); a close from an old one is nothing. */
export function socketClosed(ss, token, closedForGood) { return !socketOwns(ss, token) ? 'ignore' : closedForGood ? 'done' : 'reopen'; }
/** The tab resumed: open now unless a socket is connecting or open. readyState: 0 connecting, 1 open, 2 closing, 3 closed. */
export function socketNudge(closedForGood, readyState) { return closedForGood || (readyState !== null && readyState !== undefined && readyState <= 1) ? 'none' : 'open'; }
