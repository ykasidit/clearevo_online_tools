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
// The pure half of the Bluetooth connection (house rules 2026-09-20 and 2026-10-01). Since 0.9.83 the flow itself is
// ONE loop per pack in conn.js (idle -> choosing -> connecting -> connected -> countdown, and stuck): the phase is the
// loop's program counter, the loop is the only writer of `connState()`, and a person's tap only queues a command.
// What a command means in each phase, whether a failed attempt is tried again, and what follows the end of a link
// are decided here, as tables over plain values, so the rules stay replayable in node. Facts encoded here come from
// live logs: Android refuses the first GATT connect (status 133) and takes the next one 1.5 s later (2026-09-18); a
// link that goes quiet for STALE_MS is gone whatever gatt.connected says (2026-09-16); a tap while a countdown is
// pending makes exactly one attempt (2026-09-17); a connect the browser cannot finish (it ran with Bluetooth off) is
// never cancelled and never retried, only explained (2026-10-07, phase stuck); the link an attempt is building is the
// attempt's alone - the stall check runs inside the loop that serves a connected link, so it cannot judge a link
// still being built (the seahut reader, 2026-10-29: 1760 links dropped mid service discovery by a watchdog timer).
//
// phases: idle | choosing | connecting | connected | countdown | stuck

export const CONNECT_TRIES = 3, CONNECT_GAP_MS = 1500, CONNECT_S = 15;
export const RECONNECT_S = { auto: 10, chooser: 5, stalled: 3, adapter: 3 };
export const SERVE_TICK_MS = 250;          // the connected loop looks at the link this often (the quick startup re-ask is 1 s)
export const DOWN_WAIT_MS = 2000;          // a closed link reports itself down within this, or the loop marks it down

/** What the UI reads (the loop writes it): the phase, the attempt and its seconds left, the countdown, where the
 *  device came from, whether the last link went quiet, this link's connect time, whether data has come. */
export function connState() {
  return { phase: 'idle', hasDevice: false, attempt: 0, left: 0, count: 0, origin: null, stalled: false, stalledAge: 0, connectedAt: null, gotData: false };
}
export const retryableConnectError = (msg) => !/cancel|not found|no such|permission/i.test(String(msg || ''));
export const cancelledError = (msg) => /cancel/i.test(String(msg || ''));

/** A command in a phase -> what the loop does: 'choose' (the chooser) | 'go' (connect the device it has) | 'stop'
 *  (back to idle; a link that is up is closed) | 'short' (the countdown to RECONNECT_S.adapter) | 'sheet' (stuck:
 *  say why again) | 'ignore'. Commands: connect (Connect, Connect again, Add BMS), known (the remembered BMS, the
 *  resume), now (Reconnect now), cancel (the busy button, Cancel on the countdown), disconnect (the sunk button),
 *  auto-off (auto reconnect unticked), adapter (Bluetooth came back). */
export function cmdIn(phase, cmd, { hasDevice = false } = {}) {
  if (phase === 'stuck') return /^(connect|known|now)$/.test(cmd) ? 'sheet' : cmd === 'disconnect' ? 'stop' : 'ignore';
  switch (cmd) {
    case 'connect': return phase === 'connecting' || phase === 'choosing' ? 'ignore' : 'choose';   // while connected: the chooser drops the link first
    case 'known': return phase === 'idle' || phase === 'countdown' ? 'go' : 'ignore';
    case 'now': return (phase === 'idle' || phase === 'countdown') && hasDevice ? 'go' : 'ignore';
    case 'cancel': case 'disconnect': return phase === 'idle' ? 'ignore' : 'stop';
    case 'auto-off': return phase === 'countdown' ? 'stop' : 'ignore';
    case 'adapter': return phase === 'countdown' ? 'short' : 'ignore';
    default: return 'ignore';
  }
}

/** After a failed attempt: the same tap tries again CONNECT_GAP_MS later, up to CONNECT_TRIES (2026-09-18). */
export function retryDecision(attempt, msg) {
  return attempt < CONNECT_TRIES && retryableConnectError(msg) ? { retry: true, gapMs: CONNECT_GAP_MS } : { retry: false };
}

/** How a round ended -> the next phase. end: 'failed' (every try of this round) | 'down' (the link fell) | 'stalled'
 *  (quiet past STALE_MS, dropped) | 'gap' (queued readings of a frozen tab, dropped) | 'settled' (a stuck connect
 *  ended after all). A picked device that refuses goes to the countdown, never back to the chooser (2026-09-18). */
export function afterEnd(end, { autoRe, hasDevice, origin = null, msg = '' }) {
  if (!autoRe || !hasDevice) return { next: 'idle' };
  if (end === 'failed') return cancelledError(msg) ? { next: 'idle' } : { next: 'countdown', seconds: origin === 'chooser' ? RECONNECT_S.chooser : RECONNECT_S.auto };
  if (end === 'stalled') return { next: 'countdown', seconds: RECONNECT_S.stalled };
  return { next: 'countdown', seconds: RECONNECT_S.auto };
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
/** The one Bluetooth button: Connect when idle, pulsing Connecting while choosing / connecting / counting down (a tap cancels), sunk Disconnect when connected. */
export function connButton(cs, connected) {
  const busy = !connected && (cs.phase === 'choosing' || cs.phase === 'connecting' || cs.phase === 'countdown');
  return { on: !!connected, busy, disabled: false, label: connected ? 'disconnect' : busy ? 'connecting' : 'connect' };
}
/** A pack that is up, connecting or counting down keeps the screen awake. */
export function wakeWantedByConn(cs, connected) { return connected || cs.phase === 'connecting' || cs.phase === 'countdown'; }

/** The green "Connect to NAME" button (owner ask 2026-09-21): shown when a BMS was picked before on this device and the
 *  browser still lists it as permitted (getDevices), so a tap connects without the chooser. `permitted` = the ids
 *  getDevices() returned, or null when the browser has no getDevices (older Chrome Android: the chooser it is). */
export function knownDevice(saved, permitted) {
  if (!saved || typeof saved.id !== 'string' || !saved.id) return { show: false };
  if (!Array.isArray(permitted) || !permitted.includes(saved.id)) return { show: false, why: permitted === null ? 'no getDevices' : 'not permitted any more' };
  return { show: true, id: saved.id, name: saved.name || saved.id };
}
