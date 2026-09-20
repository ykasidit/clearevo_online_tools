// BatRay by ClearEvo.com - Share live / viewer pure decisions: one state object each, no DOM, no sockets (tested)
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
// Functional core of the share flow (the reader's side), the viewer's reader
// presence bookkeeping and the internet/server reachability hold. Envelopes,
// keys and `readerPresent` live in the live-logic module; the sockets in the live module.
// House rule 2026-09-20: one plain state object, pure decisions, the app shell acts.
//
// share phases: off | setup | starting | on

export function shareState() { return { phase: 'off', name: '', reuse: false, link: '', reused: false, viewers: 0 }; }

/** The toolbar button: pressed while sharing means stop (with a toast), otherwise open the setup. */
export function shareTapDecision(ss) {
  if (ss.phase === 'on') return { action: 'stop' };
  if (ss.phase === 'starting') return { action: 'ignore', why: 'starting' };
  ss.phase = 'setup'; return { action: 'setup' };
}
/** What the setup card shows. `suggest` is suggestChannelName from live-logic.js. */
export function shareSetupModel({ savedName, deviceName, saved, now, suggest }) {
  return { name: suggest({ saved: savedName || '', deviceName: deviceName || '' }), reuseEnabled: !!saved, reuseChecked: !!saved, savedAgeH: saved ? (now - saved.at) / 3600000 : null };
}
export function shareSetupCancelled(ss) { if (ss.phase === 'setup') ss.phase = 'off'; }
/** Start pressed on the setup card. Returns what to start with, or an ignore. */
export function shareBegin(ss, { typedName, reuseChecked, saved, suggest }) {
  if (ss.phase === 'on' || ss.phase === 'starting') return { action: 'ignore', why: ss.phase };
  ss.name = String(typedName || '').trim().slice(0, 40) || suggest({ saved: '', deviceName: '' });
  ss.reuse = !!(reuseChecked && saved);
  ss.phase = 'starting'; ss.viewers = 0;
  return { action: 'start', name: ss.name, reuse: ss.reuse ? saved : null };
}
export function shareStarted(ss, { link, reused }) {
  ss.phase = 'on'; ss.link = link; ss.reused = !!reused;
  return { toastNewLink: ss.reuse && !reused };        // asked to reuse, but the relay had forgotten the room
}
export function shareFailed(ss) { ss.phase = 'off'; ss.link = ''; }
export function shareStopped(ss) { ss.phase = 'off'; ss.link = ''; ss.viewers = 0; }
/** The toolbar button look: sunk while sharing, greyed while starting. */
export function shareButton(ss) { return { on: ss.phase === 'on', disabled: ss.phase === 'starting' }; }
/** A viewer count change worth telling the reader about. */
export function viewersChange(ss, n) {
  if (n === ss.viewers) return null;
  const joined = n > ss.viewers; ss.viewers = n;
  return { joined, viewers: n };
}

/** One line for the live / view chips. s = Publisher or Viewer state, T = strings. */
export function liveText(s, T, fmtChip) {
  const srv = s.server && s.server.limit ? ' · ' + T.serverConns(s.server.conns, s.server.limit) : '';
  if (!s.net) return T.netOffline;                            // this device has no internet: nothing else can be judged
  if (s.sig === false) return T.serverUnreachable + srv;      // internet ok, but the server does not answer (null = first connect in progress)
  if (s.reader === false) return T.readerOffline + srv;       // viewer only: server says the reader is not there
  if (s.retryIn !== null && s.retryIn !== undefined) return `${s.error ? T.liveError(s.error) + ' · ' : ''}${T.retryIn(s.retryIn)}${srv}`;
  if (!s.live) return (s.error ? T.liveError(s.error) : T.liveConnecting) + srv;
  const path = (T.path[s.path.tier] || s.path.label) + (s.path.sub && T.pathSub[s.path.sub] ? ` · ${T.pathSub[s.path.sub]}` : '');
  const extra = [];
  if (s.p2p) extra.push(T.p2pCount(s.p2p));
  return fmtChip(s.viewers, path) + (extra.length ? ' · ' + extra.join(' · ') : '') + srv;
}

// ---- internet / server reachability of THIS device, same on both sides. A
// state must hold REACH_HOLD_MS before it is announced, so a socket reopen is
// not an outage. ----
export const REACH_HOLD_MS = 10000;
export function reachOf(s) { return !s.net ? 'net' : (s.sig === false ? 'server' : 'ok'); }
export function reachState() { return { cur: 'ok', pending: null, since: 0 }; }
/** A state update. Returns { hold: ms } when a timer should be armed, { clear: true } when a pending one should be dropped, null otherwise. */
export function reachEvent(rs, s, now) {
  const seen = reachOf(s);
  if (seen === rs.cur) { const blink = !!rs.pending; rs.pending = null; return blink ? { clear: true } : null; }   // back before the hold ran out: forget it
  if (rs.pending) return null;                                 // a hold is already running
  rs.pending = seen; rs.since = now;
  return { hold: REACH_HOLD_MS };
}
/** The hold timer fired. Returns { announce, prev } when the change held, null otherwise. */
export function reachSettle(rs, s, now) {
  rs.pending = null;
  const seen = s ? reachOf(s) : rs.cur;
  if (seen === rs.cur || now - rs.since < REACH_HOLD_MS - 1) return null;
  const prev = rs.cur; rs.cur = seen;
  return { announce: seen, prev };
}

// ---- viewer side: the reader's presence and the channel name ----
export function viewState() { return { readerLive: false, readerSeen: false, channel: '' }; }
/** A Viewer state update. Returns { readerAlert: 'on' | 'off' } when the reader's presence changed and is worth an alert. */
export function viewerEvent(vs, s) {
  // reader online/offline is the server's word (its session registered or
  // not), judged only while our own socket is up - our internet dropping is
  // reported as that, never as the reader vanishing
  if (!(s.sig && s.reader !== null && s.reader !== undefined && s.reader !== vs.readerLive)) return null;
  vs.readerLive = s.reader;
  const alert = vs.readerSeen ? (vs.readerLive ? 'on' : 'off') : null;
  if (vs.readerLive) vs.readerSeen = true;
  return alert ? { readerAlert: alert } : null;
}
/** A hello envelope. Returns the new channel name when it changed, null otherwise. */
export function viewHello(vs, env) {
  const name = env && env.v && typeof env.v.channel === 'string' ? env.v.channel.slice(0, 40) : '';
  if (name === vs.channel) return null;
  vs.channel = name; return { name, version: env.v && env.v.version ? String(env.v.version) : '' };
}
/** A reading arrived: that proves the reader (the live module already judges freshness before it says reader=false). */
export function viewerDataSeen(vs) { vs.readerSeen = true; vs.readerLive = true; }
