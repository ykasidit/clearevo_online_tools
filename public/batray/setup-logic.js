// BatRay by ClearEvo.com - the reader setup checklist: what a phone left next to the battery needs (pure, tested)
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
// Owner ask 2026-10-06: "a checklist of what the user must enable in Chrome for auto reconnect, like the pre-connect
// checklist of my bluetooth_gnss app; a step we cannot check gets a Done the user confirms; the user can continue
// anyway, the logs have it, and while running a warning sign right of 'updated' opens the list - done and not done,
// with the Chrome version and flags". Only Chrome and the page itself: no developer options, no extra apps (owner).
// Every item is checked by the page where it can be; MANUAL items are the person's word, said so in the log.

export const SETUP_DONE_KEY = 'batray_setup_done';      // localStorage: JSON array of the manual items confirmed
export const MANUAL = ['chromeUpdate', 'chromeBattery'];
export const ITEMS = ['compat', 'bluetooth', 'remember', 'known', 'notify', 'persist', 'history', 'wake', 'charging', 'resume', ...MANUAL];

export function parseDone(raw) {
  try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a.filter((x) => MANUAL.includes(x)) : []; } catch { return []; }
}
/** Toggle one manual item; returns the new list. */
export function toggleDone(done, id) { return !MANUAL.includes(id) ? done : done.includes(id) ? done.filter((x) => x !== id) : [...done, id]; }

const tri = (v) => (v === true ? 'ok' : v === false ? 'missing' : 'unknown');
/** The checklist. Each input is what the page could find out; null = it cannot tell (shown as such, never as ok).
 *  knownSaved: a BMS was remembered on this device; knownPermitted: Chrome still lists it (null without getDevices). */
export function checklist({
  compatOk = null, bluetooth = null, getDevices = null, knownSaved = false, knownPermitted = null, notifications = 'none',
  persisted = null, history = null, wakeLock = null, charging = null, resumeOn = true, done = [],
} = {}) {
  const items = [
    { id: 'compat', state: tri(compatOk) },
    { id: 'bluetooth', state: tri(bluetooth) },
    { id: 'remember', state: tri(getDevices) },
    { id: 'known', state: !knownSaved ? 'unknown' : tri(knownPermitted) },
    { id: 'notify', state: notifications === 'granted' ? 'ok' : notifications === 'none' ? 'unknown' : 'missing' },
    { id: 'persist', state: tri(persisted) },
    { id: 'history', state: history === 'opfs' ? 'ok' : history === 'memory' ? 'missing' : 'unknown' },
    { id: 'wake', state: tri(wakeLock) },
    { id: 'charging', state: tri(charging) },
    { id: 'resume', state: resumeOn ? 'ok' : 'missing' },
    ...MANUAL.map((id) => ({ id, state: done.includes(id) ? 'done' : 'todo', manual: true })),
  ];
  return items.map((i) => ({ manual: false, ...i }));
}
/** ready = ok or confirmed; the rest by kind. `ok` only when nothing is missing or left to confirm. */
export function checklistSummary(items) {
  const by = (s) => items.filter((i) => i.state === s).map((i) => i.id);
  const ready = items.filter((i) => i.state === 'ok' || i.state === 'done').length;
  const missing = by('missing'), todo = by('todo'), unknown = by('unknown');
  return { ready, total: items.length, missing, todo, unknown, ok: !missing.length && !todo.length };
}
export function checklistLine(items) {
  const s = checklistSummary(items);
  return `setup: ${s.ready}/${s.total} ready${s.missing.length ? ` - missing: ${s.missing.join(', ')}` : ''}${s.todo.length ? ` - not confirmed: ${s.todo.join(', ')}` : ''}${s.unknown.length ? ` - cannot tell: ${s.unknown.join(', ')}` : ''}${items.some((i) => i.state === 'done') ? ` - confirmed by the user: ${items.filter((i) => i.state === 'done').map((i) => i.id).join(', ')}` : ''}`;
}
/** The warning sign by "updated": a running reader with something missing or not confirmed. */
export function setupWarn({ items, reader, running }) { return !!(reader && running && !checklistSummary(items).ok); }
