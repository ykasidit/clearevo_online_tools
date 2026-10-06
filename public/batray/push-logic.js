// BatRay by ClearEvo.com - when the reader signs up for the "reader stopped" push (pure, tested)
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
// Owner ask 2026-10-06: "web push - reader not running, tap to reopen, which then does the auto reconnect". While the
// reader shares with Chrome notifications allowed, it subscribes to push and gives the room its endpoint; when its
// socket has been gone 3 minutes the relay sends one push with no data, the service worker shows "reader stopped -
// tap to reopen", and the tap opens the page, which resumes after its countdown (resume-logic.js).

export const PUSH_RETRY_MS = 5 * 60000;        // a failed sign-up is tried again at most this often

/** Sign up now? `subscribedRoom` = the room the relay already has this phone's endpoint for. */
export function pushDecision({ supported, permission, sharing, room, subscribedRoom, failedAt = 0, now = 0 }) {
  if (!supported) return { action: 'none', why: 'this browser has no push' };
  if (!sharing || !room) return { action: 'none', why: 'not sharing' };
  if (permission !== 'granted') return { action: 'none', why: `notifications ${permission || 'not asked'}` };
  if (subscribedRoom === room) return { action: 'none', why: 'set up' };
  if (failedAt && now - failedAt < PUSH_RETRY_MS) return { action: 'none', why: 'waiting after a failure' };
  return { action: 'subscribe', why: 'sharing with notifications allowed' };
}
/** The checklist row: ok once the relay has the endpoint for this share; cannot tell while not sharing. */
export function pushState({ sharing, permission, subscribed }) {
  if (!sharing) return null;
  return permission === 'granted' && subscribed;
}
/** applicationServerKey from the relay's base64url public key. */
export function b64uBytes(s) {
  const b = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const pad = b.length % 4 ? '='.repeat(4 - (b.length % 4)) : '';
  return Uint8Array.from(atob(b + pad), (c) => c.charCodeAt(0));
}
