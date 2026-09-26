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

export const CAST_DISCOVERY_WAIT_MS = 8000;

export function castState() { return { events: 0, flipped: false, castState: null, requestAt: 0 }; }

/** A CAST_STATE_CHANGED event. Returns true once discovery has spoken (the third event). */
export function onCastStateEvent(cs, castState) {
  cs.events++; cs.castState = castState;
  if (castState === 'NO_DEVICES_AVAILABLE') cs.flipped = true;
  return discoveryKnown(cs);
}
export function discoveryKnown(cs) { return cs.events >= 3; }

/** What a Cast tap should do. inp: { loadedBeforeTap, hasSession, activationActive, now } */
export function castTapDecision(cs, inp) {
  if (inp.hasSession) return { action: 'load-media' };
  if (cs.requestAt) return { action: 'pending', ageS: Math.max(0, Math.round((inp.now - cs.requestAt) / 1000)) };
  if (!inp.loadedBeforeTap && !discoveryKnown(cs)) return { action: 'wait-discovery', ms: CAST_DISCOVERY_WAIT_MS };
  return castAfterDiscovery(cs, inp);
}
/** After the discovery wait (or when the library was already loaded before the tap). */
export function castAfterDiscovery(cs, inp) {
  // the owner's log 2026-09-26 00:09: a second tap requested while the first tap still waited for discovery; the
  // flip came 0.1 s later, the first tap's wait ended and it requested too -> invalid_parameter, "stuck" toast
  if (cs.requestAt) return { action: 'pending', ageS: Math.max(0, Math.round((inp.now - cs.requestAt) / 1000)) };
  if (cs.castState === 'NO_DEVICES_AVAILABLE') return { action: 'no-devices' };
  if (!inp.loadedBeforeTap && !cs.flipped) return { action: 'tap-again', why: 'discovery' };
  if (inp.activationActive === false) return { action: 'tap-again', why: 'activation' };
  return { action: 'request' };
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
