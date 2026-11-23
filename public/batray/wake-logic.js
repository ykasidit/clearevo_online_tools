// BatRay by ClearEvo.com - screen wake lock pure decisions: one state object, no DOM (tested)
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
// Same house rule as cast-logic.js: `wakeState()` is the one object the app
// owns; these functions update its counters and answer "ask for the lock?",
// "how long until the retry?", "play the keep-awake video?". Replayed from the
// old Sony phone that let the screen lock after hours (2026-09-19) in
// test/batray_wake.test.js.

export const WAKE_DROPS_FOR_VIDEO = 2;
export const WAKE_RETRY_MAX_MS = 30000;

/** Owner decision 2026-09-22: the screen wake lock alone by default; the near-silent video is an opt-in ('auto' =
 *  when the lock keeps dropping, 'always'), and a viewer never plays it. */
export function wakeState(hasApi, viewer = false) { return { hasApi: !!hasApi, viewer: !!viewer, wanted: false, held: false, requesting: false, drops: 0, refusals: 0, mode: 'never', videoOn: false, powerOk: true }; }
/** Whether the phone can afford a lit screen (review round 1: a reader unplugged in a power cut kept the screen on until
 *  the phone died at 1 % - a dead phone needs a person, Chrome and a BMS pick to come back; one left alive resumes when
 *  it is unlocked). Not charging and at or under WAKE_LOW_PCT: let the screen sleep. bat = {pct, chg} or null (unknown). */
export const WAKE_LOW_PCT = 20;
export function wakePowerOk(bat) { return !(bat && bat.chg === false && typeof bat.pct === 'number' && bat.pct <= WAKE_LOW_PCT); }
/** The same, held steady (review round 2: a 3 s blink of the charger at 18 % let the screen go - a screen timeout can
 *  run out meanwhile, and then the page freezes for power that never went): the screen is let go only after the phone
 *  has been off the charger WAKE_UNPLUG_MS without a break at or under WAKE_LOW_PCT, and taken back when it charges or
 *  is above WAKE_LOW_PCT + WAKE_BAND_PCT. ps = { offSince, ok } (the wake loop's own), bat = {pct, chg} or null. */
export const WAKE_UNPLUG_MS = 5 * 60000;
export const WAKE_BAND_PCT = 5;
export function wakePowerStep(ps, bat, now) {
  if (!bat || bat.chg !== false || typeof bat.pct !== 'number') { ps.offSince = null; ps.ok = true; return ps.ok; }
  if (ps.offSince === null || ps.offSince === undefined || now < ps.offSince) ps.offSince = now;   // a clock set back starts the wait again
  if (ps.ok === false) { if (bat.pct > WAKE_LOW_PCT + WAKE_BAND_PCT) ps.ok = true; return ps.ok; }
  ps.ok = !(bat.pct <= WAKE_LOW_PCT && now - ps.offSince >= WAKE_UNPLUG_MS);
  return ps.ok;
}
export function wakeMode(v) { return ['auto', 'always', 'never'].includes(v) ? v : 'never'; }

/** Ownership rule (link-logic): one request in flight at a time - two overlapping requests held two locks and only
 *  the last was ever released, so the screen stayed on after the stop (audit 2026-10-01). */
export function wakeShouldRequest(ws, visible) { return ws.hasApi && ws.wanted && !ws.held && !ws.requesting && visible; }
export function wakeRequestStart(ws) { ws.requesting = true; }
export function wakeAcquired(ws) { ws.held = true; ws.requesting = false; }
/** The lock went away. 'dropped' = the system took it while we still wanted it in front. */
export function wakeReleased(ws, visible) {
  ws.held = false;
  if (ws.wanted && visible) { ws.drops++; return 'dropped'; }
  return 'released';
}
/** A refusal counts only while the tab is in front: "the requesting page is not visible" is the browser's rule, not a
 *  phone that refuses the lock (the 2026-09-22 viewer log counted one and started the video). */
export function wakeRefused(ws, visible = true) { ws.held = false; ws.requesting = false; if (!visible) return 'hidden'; ws.refusals++; return 'refused'; }
export function wakeRetryDelayMs(ws) { return Math.min(WAKE_RETRY_MAX_MS, 1000 * 2 ** Math.min(5, ws.drops + ws.refusals)); }
/** Layer 2: the near-silent video, by mode and by what the lock has done so far. */
export function wakeVideoWanted(ws) {
  if (!ws.wanted || ws.mode === 'never' || ws.viewer) return false;
  if (ws.mode === 'always') return true;
  return !ws.hasApi || ws.refusals > 0 || ws.drops >= WAKE_DROPS_FOR_VIDEO;
}
