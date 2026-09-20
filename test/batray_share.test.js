// BatRay by ClearEvo.com - tests (batray_share.test.js): Share live / viewer / reachability decisions
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
import test from 'node:test';
import assert from 'node:assert/strict';
import { shareState, shareTapDecision, shareSetupModel, shareSetupCancelled, shareBegin, shareStarted, shareFailed, shareStopped, shareButton, viewersChange, liveText, reachState, reachEvent, reachSettle, REACH_HOLD_MS, viewState, viewerEvent, viewHello, viewerDataSeen } from '../public/batray/share-logic.js';
import { suggestChannelName } from '../public/batray/live-logic.js';

test('the Share button: opens the setup, is sunk and stops on the next press, greyed while starting', () => {
  const ss = shareState();
  assert.deepEqual(shareButton(ss), { on: false, busy: false, disabled: false });
  assert.deepEqual(shareTapDecision(ss), { action: 'setup' }); assert.equal(ss.phase, 'setup');
  shareSetupCancelled(ss); assert.equal(ss.phase, 'off');
  shareTapDecision(ss);
  const b = shareBegin(ss, { typedName: '  Home bank  ', reuseChecked: true, saved: { room: 'r', pub: 'p', key: 'k', at: 1 }, suggest: suggestChannelName });
  assert.deepEqual(b, { action: 'start', name: 'Home bank', reuse: { room: 'r', pub: 'p', key: 'k', at: 1 } });
  assert.deepEqual(shareButton(ss), { on: false, busy: true, disabled: false });
  assert.deepEqual(shareTapDecision(ss), { action: 'cancel' }); assert.equal(ss.phase, 'off');   // the busy button is a cancel
  shareTapDecision(ss); shareBegin(ss, { typedName: 'Home bank', reuseChecked: true, saved: { room: 'r', pub: 'p', key: 'k', at: 1 }, suggest: suggestChannelName });
  assert.deepEqual(shareBegin(ss, { typedName: 'x', reuseChecked: false, saved: null, suggest: suggestChannelName }), { action: 'ignore', why: 'starting' });
  assert.deepEqual(shareStarted(ss, { link: 'https://x/?view=r#k=k', reused: false }), { toastNewLink: true });   // asked to reuse, relay had forgotten it
  assert.deepEqual(shareButton(ss), { on: true, busy: false, disabled: false });
  assert.deepEqual(shareTapDecision(ss), { action: 'stop' });
  shareStopped(ss); assert.equal(ss.phase, 'off'); assert.equal(ss.link, '');
});

test('a blank name falls back to a cat; a failed start goes back to off; an unticked reuse means a new room', () => {
  const ss = shareState(); shareTapDecision(ss);
  const b = shareBegin(ss, { typedName: '', reuseChecked: false, saved: { room: 'r', pub: 'p', key: 'k', at: 1 }, suggest: suggestChannelName });
  assert.equal(b.reuse, null); assert.match(b.name, /^[A-Z][a-z]+$/);
  shareFailed(ss); assert.equal(ss.phase, 'off');
});

test('the setup card: saved name first, then the BMS name; the last-link box only when something is saved', () => {
  const m1 = shareSetupModel({ savedName: 'Home bank', deviceName: 'JK-B2A24S', saved: { at: 1000 }, now: 3600000 + 1000, suggest: suggestChannelName });
  assert.equal(m1.name, 'Home bank'); assert.equal(m1.reuseEnabled, true); assert.equal(m1.reuseChecked, true); assert.equal(m1.savedAgeH, 1);
  const m2 = shareSetupModel({ savedName: '', deviceName: 'JK-B2A24S', saved: null, now: 0, suggest: suggestChannelName });
  assert.equal(m2.name, 'JK-B2A24S'); assert.equal(m2.reuseEnabled, false); assert.equal(m2.reuseChecked, false); assert.equal(m2.savedAgeH, null);
});

test('viewer count changes are reported once, with direction', () => {
  const ss = shareState();
  assert.equal(viewersChange(ss, 0), null);
  assert.deepEqual(viewersChange(ss, 2), { joined: true, viewers: 2 });
  assert.equal(viewersChange(ss, 2), null);
  assert.deepEqual(viewersChange(ss, 1), { joined: false, viewers: 1 });
});

const T = { serverConns: (c, l) => `${c}/${l}`, netOffline: 'no internet', serverUnreachable: 'server unreachable', readerOffline: 'reader offline', liveError: (e) => `error ${e}`, retryIn: (s) => `retry in ${s}`, liveConnecting: 'connecting', path: { p2p: 'direct', udp: 'server' }, pathSub: {}, p2pCount: (n) => `${n} direct` };
test('liveText: internet first, then the server, then the reader, then the live path', () => {
  const base = { net: true, sig: true, live: true, viewers: 2, path: { tier: 'udp', label: 'x' }, p2p: 1, server: { conns: 3, limit: 1000 }, retryIn: null, error: null };
  assert.equal(liveText({ ...base, net: false }, T, () => ''), 'no internet');
  assert.equal(liveText({ ...base, sig: false }, T, () => ''), 'server unreachable · 3/1000');
  assert.equal(liveText({ ...base, reader: false }, T, () => ''), 'reader offline · 3/1000');
  assert.equal(liveText({ ...base, live: false, retryIn: 4, error: 'boom' }, T, () => ''), 'error boom · retry in 4 · 3/1000');
  assert.equal(liveText(base, T, (v, p) => `${v} watching via ${p}`), '2 watching via server · 1 direct · 3/1000');
});

test('reachability: a change must hold 10 s; a blink is cleared; the settle names the previous state', () => {
  const rs = reachState();
  assert.equal(reachEvent(rs, { net: true, sig: true }, 0), null);
  assert.deepEqual(reachEvent(rs, { net: true, sig: false }, 100), { hold: REACH_HOLD_MS });
  assert.equal(reachEvent(rs, { net: true, sig: false }, 200), null);                 // hold already running
  assert.deepEqual(reachEvent(rs, { net: true, sig: true }, 300), { clear: true });   // a 200 ms blink: forget it
  assert.equal(reachSettle(rs, { net: true, sig: true }, 20000), null);
  reachEvent(rs, { net: false, sig: false }, 1000);
  assert.deepEqual(reachSettle(rs, { net: false, sig: false }, 1000 + REACH_HOLD_MS), { announce: 'net', prev: 'ok' });
  reachEvent(rs, { net: true, sig: true }, 30000);
  assert.deepEqual(reachSettle(rs, { net: true, sig: true }, 30000 + REACH_HOLD_MS), { announce: 'ok', prev: 'net' });
});

test('viewer: the reader\'s presence alerts only after it was seen once and only on the server\'s word; hello names the channel once', () => {
  const vs = viewState();
  assert.equal(viewerEvent(vs, { sig: true, reader: null }), null);
  assert.equal(viewerEvent(vs, { sig: true, reader: true }), null);           // first sight: no alert, now seen
  assert.equal(vs.readerSeen, true);
  assert.equal(viewerEvent(vs, { sig: false, reader: false }), null);         // our own socket is down: not the reader's fault
  assert.deepEqual(viewerEvent(vs, { sig: true, reader: false }), { readerAlert: 'off' });
  assert.deepEqual(viewerEvent(vs, { sig: true, reader: true }), { readerAlert: 'on' });
  const vs2 = viewState(); viewerDataSeen(vs2);
  assert.deepEqual(viewerEvent(vs2, { sig: true, reader: false }), { readerAlert: 'off' });   // data proved the reader before the server spoke
  assert.deepEqual(viewHello(vs, { v: { channel: 'm-00', version: '0.9.21' } }), { name: 'm-00', version: '0.9.21' });
  assert.equal(viewHello(vs, { v: { channel: 'm-00' } }), null);
  assert.deepEqual(viewHello(vs, { v: {} }), { name: '', version: '' });
});
