// BatRay by ClearEvo.com - BLE connection pure decisions: one state object per pack, no DOM, no GATT (tested)
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
// Functional core of the connect / retry / reconnect-countdown flow (house rule
// 2026-09-20: the state is one plain object, `connState()`, that the app owns
// and passes in; these functions update it and return what to do next; the app shell
// runs the chooser, the GATT calls, the timers and the card). Facts encoded
// here come from live logs: Android refuses the first GATT connect (status
// 133) and takes the next one 1.5 s later (2026-09-18); a link that goes quiet
// for STALE_MS is gone whatever gatt.connected says (2026-09-16); a tap while a
// countdown is pending must make exactly one attempt (2026-09-17).
//
// phases: idle | choosing | connecting | connected | countdown

export const CONNECT_TRIES = 3, CONNECT_GAP_MS = 1500, CONNECT_S = 15;
export const RECONNECT_S = { auto: 10, chooser: 5, stalled: 3, adapter: 3 };

export function connState() {
  return { phase: 'idle', hasDevice: false, attempt: 0, left: 0, count: 0, origin: null, userDisconnect: false, stalled: false, stalledAge: 0, connectedAt: null, gotData: false };
}
export const retryableConnectError = (msg) => !/cancel|not found|no such|permission/i.test(String(msg || ''));
export const cancelledError = (msg) => /cancel/i.test(String(msg || ''));

function beginAttempt(cs) { cs.phase = 'connecting'; cs.attempt = 1; cs.left = CONNECT_S; cs.count = 0; return { action: 'connect', attempt: 1 }; }
function startCountdown(cs, seconds) {
  if (cs.phase === 'connecting' || cs.phase === 'connected') return { action: 'ignore', why: 'an attempt is already in progress' };
  cs.phase = 'countdown'; cs.count = seconds;
  return { action: 'countdown', seconds };
}

/** One event in, one decision out. inp: { autoRe, now, msg, ageS } as the event needs. */
export function connEvent(cs, ev, inp = {}) {
  switch (ev) {
    case 'tap-connect':                                   // Connect, Connect again, Add BMS
      if (cs.phase === 'connecting') return { action: 'ignore', why: 'an attempt is in progress' };
      cs.userDisconnect = false; cs.phase = 'choosing'; cs.count = 0;   // an explicit tap lifts an earlier Cancel
      return { action: 'choose' };
    case 'picked':
      cs.hasDevice = true; cs.origin = 'chooser';
      return beginAttempt(cs);
    case 'chooser-cancelled':
      cs.phase = 'idle'; return { action: 'idle' };
    case 'connect-tick':
      if (cs.phase !== 'connecting') return { action: 'noop' };
      cs.left = Math.max(0, cs.left - 1); return { action: 'count', left: cs.left };
    case 'attempt-failed': {
      if (cs.phase !== 'connecting') return { action: 'ignore', why: 'not connecting' };
      const msg = inp.msg || '';
      if (cs.attempt < CONNECT_TRIES && retryableConnectError(msg) && !cs.userDisconnect) {
        cs.attempt++; cs.left = CONNECT_S;
        return { action: 'retry', attempt: cs.attempt, gapMs: CONNECT_GAP_MS };
      }
      // this tap or countdown attempt has failed for good: keep trying on the
      // countdown when a device was picked and auto reconnect is on, never
      // drop back to the chooser (2026-09-18)
      cs.phase = 'idle';
      if (cs.hasDevice && !cancelledError(msg) && inp.autoRe && !cs.userDisconnect) return { ...startCountdown(cs, cs.origin === 'chooser' ? RECONNECT_S.chooser : RECONNECT_S.auto), final: true };
      return { action: 'idle', final: true };
    }
    case 'gatt-connected':
      cs.phase = 'connected'; cs.userDisconnect = false; cs.stalled = false; cs.connectedAt = inp.now || 0; cs.attempt = 0; cs.count = 0;
      return { action: 'connected' };
    case 'gatt-disconnected': {
      const wasStalled = cs.stalled, byUser = cs.userDisconnect;
      cs.phase = 'idle'; cs.userDisconnect = false;
      if (inp.autoRe && cs.hasDevice && !byUser) return startCountdown(cs, wasStalled ? RECONNECT_S.stalled : RECONNECT_S.auto);
      return { action: 'idle' };
    }
    case 'link-stalled':                                  // silence past STALE_MS: the link is gone, whatever GATT says
      cs.stalled = true; cs.stalledAge = inp.ageS || 0; cs.connectedAt = null;
      return { action: 'drop-link', ageS: cs.stalledAge };
    case 'data': {
      const back = cs.stalled; cs.stalled = false; cs.gotData = true;
      return { action: back ? 'back' : 'noop' };
    }
    case 'countdown-tick':
      if (cs.phase !== 'countdown') return { action: 'ignore', why: 'no countdown' };
      cs.count -= 1;
      if (cs.count > 0) return { action: 'count', left: cs.count };
      cs.origin = 'auto'; return beginAttempt(cs);
    case 'reconnect-now':
      if (cs.phase === 'connecting') return { action: 'ignore', why: 'double tap' };
      if (cs.phase === 'connected') return { action: 'ignore', why: 'already connected' };
      cs.origin = 'manual'; return beginAttempt(cs);
    case 'cancel':                                        // Cancel on the countdown card
      cs.phase = 'idle'; cs.userDisconnect = true; cs.count = 0; return { action: 'disconnect-gatt' };
    case 'disconnect':                                    // the Disconnect button
      cs.phase = 'idle'; cs.userDisconnect = true; cs.count = 0; return { action: 'disconnect-bms' };
    case 'auto-off':                                      // auto reconnect unticked
      if (cs.phase === 'countdown') { cs.phase = 'idle'; cs.count = 0; return { action: 'idle' }; }
      return { action: 'noop' };
    case 'adapter-available':                             // Bluetooth came back: do not wait the full countdown
      if (cs.phase === 'countdown') { cs.count = RECONNECT_S.adapter; return { action: 'countdown', seconds: cs.count }; }
      return { action: 'noop' };
    default: return { action: 'ignore', why: `unknown event ${ev}` };
  }
}

/** What the offline / loading / reconnect card shows for a BLE pack. */
export function connCard(cs, { gattConnected, hasData }) {
  if (gattConnected) return { offline: false, loading: !hasData, countdown: false, idle: false, reNow: false, disconnectEnabled: true };
  const busy = cs.phase === 'connecting' || cs.phase === 'countdown';
  return { offline: cs.hasDevice || cs.gotData || busy, loading: false, countdown: busy, idle: !busy, reNow: cs.phase === 'countdown', disconnectEnabled: false };
}
/** 'live' | 'waiting' | 'connecting' | 'offline' for the pack chip. */
export function packChipState(cs, connected, hasData) {
  if (connected) return hasData ? 'live' : 'waiting';
  return cs.phase === 'connecting' || cs.phase === 'countdown' ? 'connecting' : 'offline';
}
/** The toolbar's Disconnect button: sunk while connected, pulsing while connecting or counting down (a tap then cancels), greyed otherwise. */
export function connButton(cs, connected) {
  const busy = !connected && (cs.phase === 'choosing' || cs.phase === 'connecting' || cs.phase === 'countdown');
  return { on: !!connected, busy, disabled: !connected && !busy };
}
/** A pack that is up, connecting or counting down keeps the screen awake. */
export function wakeWantedByConn(cs, connected) { return connected || cs.phase === 'connecting' || cs.phase === 'countdown'; }
