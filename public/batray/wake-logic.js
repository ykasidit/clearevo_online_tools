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
export function wakeState(hasApi, viewer = false) { return { hasApi: !!hasApi, viewer: !!viewer, wanted: false, held: false, drops: 0, refusals: 0, mode: 'never', videoOn: false }; }
export function wakeMode(v) { return ['auto', 'always', 'never'].includes(v) ? v : 'never'; }

export function wakeShouldRequest(ws, visible) { return ws.hasApi && ws.wanted && !ws.held && visible; }
export function wakeAcquired(ws) { ws.held = true; }
/** The lock went away. 'dropped' = the system took it while we still wanted it in front. */
export function wakeReleased(ws, visible) {
  ws.held = false;
  if (ws.wanted && visible) { ws.drops++; return 'dropped'; }
  return 'released';
}
/** A refusal counts only while the tab is in front: "the requesting page is not visible" is the browser's rule, not a
 *  phone that refuses the lock (the 2026-09-22 viewer log counted one and started the video). */
export function wakeRefused(ws, visible = true) { ws.held = false; if (!visible) return 'hidden'; ws.refusals++; return 'refused'; }
export function wakeRetryDelayMs(ws) { return Math.min(WAKE_RETRY_MAX_MS, 1000 * 2 ** Math.min(5, ws.drops + ws.refusals)); }
/** Layer 2: the near-silent video, by mode and by what the lock has done so far. */
export function wakeVideoWanted(ws) {
  if (!ws.wanted || ws.mode === 'never' || ws.viewer) return false;
  if (ws.mode === 'always') return true;
  return !ws.hasApi || ws.refusals > 0 || ws.drops >= WAKE_DROPS_FOR_VIDEO;
}
