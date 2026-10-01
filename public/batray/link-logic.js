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
// The link lifecycles themselves are loops over the sync primitives (house rule 2026-10-01); what stays here is
// the socket generation: an event from an old socket must not act for the current one.

// ---- the signalling socket: one generation per socket, a late event from an old one is ignored ----
export function socketState() { return { gen: 0 }; }
export function socketOpen(ss) { return ++ss.gen; }
export function socketOwns(ss, token) { return ss.gen === token; }
/** A close from the current socket reopens (unless closed for good); a close from an old one is nothing. */
export function socketClosed(ss, token, closedForGood) { return !socketOwns(ss, token) ? 'ignore' : closedForGood ? 'done' : 'reopen'; }
/** The tab resumed: open now unless a socket is connecting or open. readyState: 0 connecting, 1 open, 2 closing, 3 closed. */
export function socketNudge(closedForGood, readyState) { return closedForGood || (readyState !== null && readyState !== undefined && readyState <= 1) ? 'none' : 'open'; }
