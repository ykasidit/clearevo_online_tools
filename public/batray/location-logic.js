// BatRay by ClearEvo.com - the reader phone's location in its status: when to ask, when to read, how it is kept (pure, tested)
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
// Owner ask 2026-10-06: "a checkbox under the logging checkbox in the History tab, default on, for location; the
// checklist checks it is on and approved"; 0.9.75: off until ticked. The fix goes only into the reader's status, which reaches its viewers
// encrypted with the share key; it is never written into a log line (logs can be uploaded) - the log says only that a
// fix was taken and how accurate it was. Chrome asks the person before the first fix; the page asks only right after a
// tap (the checkbox, or starting a share), never by itself.

export const LOC_KEY = 'batray_location';      // localStorage: '1' = the person ticked it; off until then (0.9.75)
export const LOC_EVERY_MS = 10 * 60000;        // a fresh fix at most this often (a phone left by a battery does not move)

/** Owner 2026-10-06: off until the person ticks the box - consent first, nothing by default. */
export const locOn = (raw) => raw === '1';

/** Read a fix now, ask for permission now, or wait. permission: 'granted' | 'prompt' | 'denied' | 'none' (no API).
 *  gesture: this call follows a tap - the only time a permission prompt is shown. */
export function locDecision({ on, permission, lastFixAt = 0, now, gesture = false, asking = false }) {
  if (!on) return { action: 'none', why: 'turned off' };
  if (asking) return { action: 'none', why: 'a request is open' };
  if (permission === 'none') return { action: 'none', why: 'this browser has no location' };
  if (permission === 'denied') return { action: 'none', why: 'not allowed in Chrome' };
  if (permission === 'prompt') return gesture ? { action: 'ask', why: 'after a tap' } : { action: 'none', why: 'waits for a tap to ask' };
  if (!lastFixAt || now - lastFixAt >= LOC_EVERY_MS || gesture) return { action: 'fetch', why: lastFixAt ? 'due' : 'first fix' };
  return { action: 'none', why: 'fresh' };
}
/** A position as kept: 5 decimals (about 1 m), accuracy in whole metres, when it was taken. */
export function locFix(pos, now) {
  const c = pos && pos.coords; if (!c || typeof c.latitude !== 'number' || typeof c.longitude !== 'number') return null;
  const r5 = (x) => Math.round(x * 1e5) / 1e5;
  return { lat: r5(c.latitude), lon: r5(c.longitude), acc: typeof c.accuracy === 'number' ? Math.round(c.accuracy) : null, at: typeof pos.timestamp === 'number' ? pos.timestamp : now };
}
/** The checklist row: on and allowed. Off is the person's choice, not a warning (owner 2026-10-06: "warn on location
 *  only if on but not allowed"); on but not (yet) allowed is missing; no API: cannot tell. */
export function locState({ on, permission }) {
  if (!on) return 'off';
  if (permission === 'none') return null;
  return permission === 'granted';
}
/** For a log line: never the coordinates, only that there is a fix and how good. */
export function locLogText(fix) { return fix ? `fix ±${fix.acc ?? '?'} m` : 'no fix'; }
/** For the viewer's sheet. */
export function locCoords(fix) { return fix ? `${fix.lat.toFixed(5)}, ${fix.lon.toFixed(5)}` : ''; }
