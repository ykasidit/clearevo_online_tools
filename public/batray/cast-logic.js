// BatRay by ClearEvo.com - Cast to TV pure decisions: one state object, no DOM, no library (tested)
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
// House rule (owner, 2026-09-20): the state of a flow lives in ONE plain object
// the app owns and passes in; the functions here only read it or update its
// counters and return a decision. No DOM, no timers, no cast library, so the
// exact state sequences seen in real logs replay in node (test/batray_cast.test.js)
// before anything ships. Facts behind the rules, from Google's Android sender
// (gstatic.com/eureka/clank/cast_sender.js) and two phones' logs on 2026-09-20:
// - after init the availability goes NOT_CONNECTED (initial value) ->
//   NO_DEVICES_AVAILABLE -> NOT_CONNECTED, 1 to 6 s later; a picker opened
//   before that flip never settles;
// - while a request is pending, every requestSession() fails at once with
//   invalid_parameter ("Already requesting session") until the page reloads;
// - PresentationRequest.start() needs the tap's user activation (~5 s).

export const CAST_FLOW_TIMEOUT_MS = 20000;     // the whole tap flow's budget (owner 2026-09-26: a progress sheet with a 20 s timeout, cancellable)
export const CAST_DISCOVERY_WAIT_MS = CAST_FLOW_TIMEOUT_MS;
// How long the loading tap waits for the availability flip before it requests anyway. The 2026-09-20 phones flipped
// 1-6 s after init on their own; the owner's phone on 2026-09-26 and 2026-09-27 never flipped until a request was
// made, and then flipped 50-150 ms AFTER it and the picker worked - so the flip is not a precondition, only a hint.
// A 20 s wait for it (0.9.45) was 20 s of "looking for TVs" for nothing.
export const CAST_FLIP_WAIT_MS = 4000;

export function castState() { return { events: 0, flipped: false, castState: null, requestAt: 0, busy: false, phase: null, since: 0, dev: '', tvT: 0 }; }

// ---- the tap flow as the user sees it (owner 2026-09-26: "after the first tap there is no way to know that it is
// searching or waiting, so the user presses again"): one progress sheet from the tap to the TV's answer, phases
// loading -> looking -> picking -> sending, a 20 s timeout on loading/looking (picking is in the user's hands:
// Google's list is on the screen), Cancel, and both Cast buttons greyed with a wait icon meanwhile ----
/** May a tap start the flow? Not while one runs (the buttons are greyed then; a programmatic tap is ignored). */
export function castTapAllowed(cs) { return !cs.busy; }
export function castFlowStart(cs, now, phase = 'loading') { cs.busy = true; cs.phase = phase; cs.since = now; }
/** Next phase; with `now` the clock restarts (the TV wait has its own budget, counted from the accepted load). */
export function castFlowPhase(cs, phase, now) { cs.phase = phase; if (now !== undefined) cs.since = now; }
export function castFlowEnd(cs) { cs.busy = false; cs.phase = null; cs.since = 0; cs.tvT = 0; }
/** The flow is over but the sheet stays with the result ('playing' | 'nomedia' | 'error') until the user closes it
 *  (owner 2026-09-28: "not drop away, let the user read the state"); the buttons come back at once. */
export function castSettle(cs, result) { cs.busy = false; cs.phase = result; cs.since = 0; }
// How long each phase may take before the sheet gives up: the library and the TV list 20 s, the TV's player 60 s
// (the owner's TV buffered 19 s before its first picture, log 2026-09-28); picking is in the user's hands.
export const CAST_TV_WAIT_MS = 60000;
export function castPhaseBudgetMs(phase) {
  if (phase === 'loading' || phase === 'looking') return CAST_FLOW_TIMEOUT_MS;
  if (phase === 'waiting' || phase === 'buffering') return CAST_TV_WAIT_MS;
  return 0;
}
/** What the TV's player state means for a flow waiting on it: 'playing' settles it, 'buffering' is progress,
 *  'error' (IDLE with idleReason ERROR) settles it as a failure, anything else changes nothing. */
export function castTvUpdate(cs, playerState, idleReason) {
  if (!cs.busy || (cs.phase !== 'waiting' && cs.phase !== 'buffering')) return 'none';
  if (playerState === 'PLAYING') return 'playing';
  if (playerState === 'BUFFERING') return 'buffering';
  if (playerState === 'IDLE' && idleReason === 'ERROR') return 'error';
  return 'none';
}
/** Progress of the running flow: percent of the budget used, seconds left, and whether the budget is spent. The
 *  picking phase never times out (the user is in Google's list). */
export function castProgress(cs, now, timeoutMs) {
  const budget = timeoutMs === undefined ? castPhaseBudgetMs(cs.phase) : timeoutMs;
  const el = cs.busy && budget ? Math.max(0, now - cs.since) : 0;
  const timesOut = castPhaseBudgetMs(cs.phase) > 0;
  if (!budget) return { pct: 0, leftS: 0, timedOut: false };
  return { pct: Math.min(100, Math.round(el * 100 / budget)), leftS: Math.max(0, Math.ceil((budget - el) / 1000)), timedOut: timesOut && el >= budget };
}
/** Both Cast buttons: greyed with the wait icon while the flow runs or a picker request is still open. */
export function castButtons(cs) { const busy = cs.busy || !!cs.requestAt; return { disabled: busy, busy }; }
/** What a CAST_STATE_CHANGED event may touch: while the flow runs, only the sheet - never the hint or the buttons
 *  (the owner's log 2026-09-26: NOT_CONNECTED 0.2 s after the library loaded rewrote the hint to "tap Cast to pick
 *  it" and re-enabled the button while the wait ran, which is why the second tap came). */
export function castStateUi(cs) { return cs.busy || cs.requestAt ? 'sheet' : 'hint'; }

/** A CAST_STATE_CHANGED event. Returns true once discovery has spoken (the third event). */
export function onCastStateEvent(cs, state) {
  cs.events++; cs.castState = state;
  if (state === 'NO_DEVICES_AVAILABLE') cs.flipped = true;
  return discoveryKnown(cs);
}
export function discoveryKnown(cs) { return cs.events >= 3; }

/** What a Cast tap should do. inp: { loadedBeforeTap, hasSession, activationActive, now } */
export function castTapDecision(cs, inp) {
  if (inp.hasSession) return { action: 'load-media' };
  if (cs.requestAt) return { action: 'pending', ageS: Math.max(0, Math.round((inp.now - cs.requestAt) / 1000)) };
  if (!inp.loadedBeforeTap && !discoveryKnown(cs)) return { action: 'wait-discovery', ms: CAST_FLIP_WAIT_MS };
  return castAfterDiscovery(cs, inp);
}
/** After the discovery wait (or when the library was already loaded before the tap). */
export function castAfterDiscovery(cs, inp) {
  // the owner's log 2026-09-26 00:09: a second tap requested while the first tap still waited for discovery; the
  // flip came 0.1 s later, the first tap's wait ended and it requested too -> invalid_parameter, "stuck" toast
  if (cs.requestAt) return { action: 'pending', ageS: Math.max(0, Math.round((inp.now - cs.requestAt) / 1000)) };
  if (cs.castState === 'NO_DEVICES_AVAILABLE') return { action: 'no-devices' };
  if (inp.activationActive === false) return { action: 'tap-again', why: 'activation' };
  return { action: 'request' };                        // flipped or not: the request itself starts discovery on some phones
}
/** Returns the request's token (its start time); only the request that set it may clear it. */
export function castRequestStarted(cs, now) { cs.requestAt = now; return now; }
export function castRequestEnded(cs, token) { if (token === undefined || cs.requestAt === token) cs.requestAt = 0; }

/** 'closed' (picker dismissed), 'stuck' (library holds an earlier request), 'failed'. */
export function castErrorDecision(code) {
  const c = String(code || '');
  if (/cancel/i.test(c)) return 'closed';
  if (/invalid_parameter/.test(c)) return 'stuck';
  return 'failed';
}
