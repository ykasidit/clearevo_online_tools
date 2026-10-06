// BatRay by ClearEvo.com - what a reopened reader page picks up again, after a 30 s countdown (pure, tested)
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
// Owner ask 2026-10-06: "auto reconnect in a 30 sec countdown on reopen". A reader page that Chrome restores, that
// someone reopens, or that the "reader stopped" notification opens, sat at "ready" until a person tapped Connect and
// Share. Now the page keeps an INTENT (what the person last asked for: which BMS connected, sharing on or off) and,
// on the next start, counts down RESUME_S with Now and Cancel, then shares again on the last link and reconnects
// each remembered BMS that Chrome still allows without a tap (getDevices: the "new permissions backend" flag).
// A BMS Chrome does not remember is named, with "tap Connect": requestDevice needs a tap, no page can skip that.

export const RESUME_KEY = 'batray_resume';
export const RESUME_ON_KEY = 'batray_auto_resume';      // '0' = the person turned resuming off
export const RESUME_S = 30;

/** The stored intent, or an empty one for anything unreadable. */
export function parseIntent(raw) {
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!j || typeof j !== 'object') return emptyIntent();
    const packs = Array.isArray(j.packs) ? j.packs.filter((p) => p && typeof p.id === 'string' && p.id).map((p) => ({ id: p.id, name: String(p.name || '').slice(0, 40) })).slice(0, 8) : [];
    return { share: !!j.share, packs, at: typeof j.at === 'number' ? j.at : 0 };
  } catch { return emptyIntent(); }
}
export function emptyIntent() { return { share: false, packs: [], at: 0 }; }

/** What the person did, folded into the intent: 'connected' {id, name}, 'disconnected' {id} (by the person: the
 *  toolbar Disconnect or the pack's ✕), 'share-on', 'share-off' (by the person). A drop, a crash or a reload changes
 *  nothing - that is exactly what a resume is for. Returns a new intent. */
export function intentEvent(intent, ev, inp = {}, now = Date.now()) {
  const i = { share: intent.share, packs: intent.packs.map((p) => ({ ...p })), at: now };
  if (ev === 'connected' && inp.id) { i.packs = i.packs.filter((p) => p.id !== inp.id); i.packs.push({ id: inp.id, name: String(inp.name || '').slice(0, 40) }); i.packs = i.packs.slice(-8); }
  else if (ev === 'disconnected' && inp.id) i.packs = i.packs.filter((p) => p.id !== inp.id);
  else if (ev === 'share-on') i.share = true;
  else if (ev === 'share-off') i.share = false;
  return i;
}

/** On start: count down to a resume, or not (and why not, for the log).
 *  permittedIds = getDevices() ids, null when this Chrome has no getDevices (the flag is off). */
export function resumePlan({ intent, enabled = true, viewer = false, demo = false, permittedIds = null }) {
  if (viewer) return { action: 'none', why: 'a viewer has nothing to resume' };
  if (demo) return { action: 'none', why: 'demo' };
  if (!enabled) return { action: 'none', why: 'resuming is turned off' };
  if (!intent || (!intent.share && !intent.packs.length)) return { action: 'none', why: 'nothing was running' };
  const connect = [], cannot = [];
  for (const p of intent.packs) {
    if (permittedIds === null) cannot.push({ ...p, why: 'no-getdevices' });
    else if (permittedIds.includes(p.id)) connect.push(p);
    else cannot.push({ ...p, why: 'not-permitted' });
  }
  return { action: 'countdown', seconds: RESUME_S, share: intent.share, connect, cannot };
}

/** One log line for the plan. */
export function resumeLine(plan) {
  if (plan.action !== 'countdown') return `resume: none (${plan.why})`;
  return `resume: in ${plan.seconds} s - share ${plan.share ? 'again on the last link' : 'no'}; reconnect ${plan.connect.length ? plan.connect.map((p) => p.name || p.id).join(', ') : 'none'}${plan.cannot.length ? `; needs a tap: ${plan.cannot.map((p) => `${p.name || p.id} (${p.why === 'no-getdevices' ? 'Chrome does not remember Bluetooth permissions: the flag is off' : 'Chrome no longer allows it'})`).join(', ')}` : ''}`;
}
