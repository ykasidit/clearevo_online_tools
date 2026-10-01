// BatRay by ClearEvo.com - tests (batray_presence.test.js)
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
// Reader presence on the viewer: "reader offline" was shown over a screen that
// was updating every 3 s (live, 2026-09-17). The relay wipes the room session
// whenever the reader's presence socket blinks, and the reader never
// re-registered it. Rules under test: fresh data beats the server's word, and
// the publisher re-registers its session on every socket reopen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readerPresent, dataFlowing, FRESH_MS, makeKeyB64, importKey, encrypt, envelope, sigDecision, SIG_PING_MS, SIG_DEAD_MS } from '../public/batray/live-logic.js';
import { Flag, sleep } from '../public/batray/sync.js';

// ---- fakes for the browser globals live.js touches ----
const sockets = [];
class FakeWS {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen && this.onopen(); }
  push(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }); }
}
const fetches = [];
globalThis.WebSocket = FakeWS;
globalThis.location = { protocol: 'https:', host: 'test.local', origin: 'https://test.local' };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.fetch = async (url, init = {}) => { fetches.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }); return { ok: true, status: 200, json: async () => ({}) }; };
const { Viewer, Publisher } = await import('../public/batray/live.js');
// a transport as the loop sees it, without WebRTC
const fakeLink = (kind = 'sfu') => ({ kind, pc: { connectionState: 'connected', getStats: async () => [], close() {} }, dc: { readyState: 'open', close() {} }, ac: { close() {} }, session: 'S', path: { tier: 'udp', sub: null, label: 'direct UDP' }, closed: new Flag(false), open: true });
const settle = (ms = 15) => new Promise((r) => { setTimeout(r, ms); });
const server = { conns: 1, limit: 1000 };

test('readerPresent: fresh data overrides the server, otherwise the server decides', () => {
  const now = 1_000_000;
  assert.equal(readerPresent({ serverLive: false, lastRxAt: now - 3000, now }), true);     // data 3 s ago: present
  assert.equal(readerPresent({ serverLive: false, lastRxAt: now - FRESH_MS - 1, now }), false);
  assert.equal(readerPresent({ serverLive: true, lastRxAt: null, now }), true);
  assert.equal(readerPresent({ serverLive: null, lastRxAt: null, now }), null);
  assert.equal(dataFlowing(null, now), false);
});

test('viewer keeps the link and says "reader present" while readings arrive, drops it only once they stop; the loop reconnects when the reader is back', async () => {
  const keyB64 = makeKeyB64(); const key = await importKey(keyB64);
  const states = [], got = [], logs = [], links = [];
  const v = new Viewer({ room: 'r1', keyB64, log: (m) => logs.push(m), onState: (s) => states.push(s), onEnvelope: (e) => got.push(e), p2pWaitMs: 20, retryS: 1 });
  let t = 5_000_000; v.now = () => t;
  v.connectSfu = async (signal) => { signal.throwIfAborted(); const l = fakeLink(); links.push(l); return l; };   // no WebRTC in node
  await v.start();
  const ws = sockets[sockets.length - 1]; ws.open();
  ws.push({ type: 'status', viewers: 1, live: true, session: 'S1', server });
  assert.equal(v.state.reader, true); assert.equal(v.pubSession, 'S1');
  await settle(60);                                                          // the direct offer's head start passes, the SFU stub answers
  assert.equal(v.state.live, true); assert.equal(links.length, 1); assert.ok(logs.some((l) => /subscribed on direct UDP/.test(l)), logs.join('\n'));
  const bytes = await encrypt(key, envelope('data', { id: 'p', name: 'n11' }, { soc: 50 }));
  await v.onBytes(bytes.buffer ? bytes.buffer : bytes);
  assert.equal(got.length, 1); assert.equal(v.lastRxAt, t);
  // the reader's presence socket blinks: the relay wipes the session and says so
  t += 3000;
  ws.push({ type: 'status', viewers: 1, live: false, server }); await settle();
  assert.equal(v.state.reader, true, 'fresh data must beat the server');
  assert.equal(v.pubSession, 'S1', 'the session must not be forgotten while data flows');
  assert.equal(v.state.live, true, 'the stream must not be torn down');
  assert.ok(logs.some((l) => /readings are still arriving/.test(l)), logs.join('\n'));
  // readings keep coming for a while: still present
  t += 5000; await v.onBytes(bytes.buffer ? bytes.buffer : bytes);
  t += 5000; ws.push({ type: 'status', viewers: 1, live: false, server }); await settle();
  assert.equal(v.state.reader, true); assert.equal(v.state.live, true);
  // ...then they stop for longer than FRESH_MS: now the server's word stands and the loop ends the link
  t += FRESH_MS + 1000;
  ws.push({ type: 'status', viewers: 1, live: false, server }); await settle();
  assert.equal(v.state.reader, false); assert.equal(v.pubSession, null); assert.equal(v.state.live, false);
  assert.ok(logs.some((l) => /sfu link ended \(gone\)/.test(l)), logs.join('\n'));
  // a reading arriving again flips the display at once, before any status - but no reconnect without a session
  await v.onBytes(bytes.buffer ? bytes.buffer : bytes);
  assert.equal(v.state.reader, true); await settle(60); assert.equal(links.length, 1);
  ws.push({ type: 'status', viewers: 1, live: true, session: 'S1', server }); await settle(60);
  assert.equal(v.state.live, true); assert.equal(links.length, 2, 'the reader is back: the loop connected again');
  v.stop();
});

test('publisher re-registers its SFU session when its socket reopens and when the room says it has none', async () => {
  const p = new Publisher({ log: () => {}, onState: () => {} });
  p.room = 'r1'; p.pubToken = 'tok'; p.sid = 'SESS'; p.state.live = true;
  fetches.length = 0;
  p.onSigConn(true);
  await new Promise((r) => { setTimeout(r, 0); });
  assert.equal(fetches.length, 1);
  assert.match(fetches[0].url, /room\/r1\/session\?token=tok$/); assert.equal(fetches[0].method, 'PUT'); assert.deepEqual(fetches[0].body, { session: 'SESS' });
  p.onSignal({ type: 'status', viewers: 0, live: false, server: { conns: 0, limit: 1000 } });
  await new Promise((r) => { setTimeout(r, 0); });
  assert.equal(fetches.length, 2);
  // not live (between retries): nothing to register
  p.state.live = false; p.onSigConn(true); await new Promise((r) => { setTimeout(r, 0); });
  assert.equal(fetches.length, 2);
});

test('channel name: saved, else the BMS name, else a cat; placeholders never win', async () => {
  const { suggestChannelName, CAT_NAMES, parseSavedShare } = await import('../public/batray/live-logic.js');
  assert.equal(suggestChannelName({ saved: ' Home bank ', deviceName: 'n11' }), 'Home bank');
  assert.equal(suggestChannelName({ saved: '', deviceName: 'n11' }), 'n11');
  assert.equal(suggestChannelName({ saved: '', deviceName: 'DEMO', rand: () => 0 }), CAT_NAMES[0]);
  assert.equal(suggestChannelName({ saved: '', deviceName: 'BMS 2', rand: () => 0.999 }), CAT_NAMES[CAT_NAMES.length - 1]);
  assert.equal(suggestChannelName({ saved: 'x'.repeat(60), deviceName: '' }).length, 40);
  assert.equal(parseSavedShare('garbage'), null);
  assert.equal(parseSavedShare(JSON.stringify({ room: 'r', pub: 'p', key: 'short', at: 1 })), null);
  const ok = parseSavedShare(JSON.stringify({ room: 'r', pub: 'p', key: makeKeyB64(), at: 1 }));
  assert.equal(ok && ok.room, 'r');
});

test('publisher keeps the earlier room when the check itself fails (0.9.50: a Wi-Fi blink is not a lost room - the relay stores the token; the viewer then waited on a room the reader had left, 2026-09-30)', async () => {
  const oldKey = makeKeyB64(); const posts = [];
  globalThis.fetch = async (/** @type {string} */ url, init = {}) => { if (/\/room$/.test(String(url)) && (init.method || 'GET') === 'POST') posts.push(url); throw new TypeError('Failed to fetch'); };
  const lines = []; const p = new Publisher({ log: (l) => lines.push(l), onState: () => {} });
  p.connectSfu = async () => fakeLink();
  const link = await p.start({ room: 'oldroom', pub: 'oldpub', key: oldKey, at: 1 });
  assert.equal(p.reused, true); assert.equal(p.room, 'oldroom'); assert.equal(p.pubToken, 'oldpub'); assert.equal(p.keyB64, oldKey); assert.match(link, /view=oldroom#k=/);
  assert.equal(posts.length, 0, 'no new room asked for'); assert.ok(lines.some((l) => /could not check the earlier room \(Failed to fetch\) - keeping it/.test(l)), lines.join('\n'));
  await p.stop();
});

test('publisher reuses an earlier room when the relay still has it, else makes a new one', async () => {
  const oldKey = makeKeyB64();
  const stubFetch = (roomAlive) => async (url, init = {}) => {
    const u = String(url); const m = (init.method || 'GET').toUpperCase();
    fetches.push({ url: u, method: m });
    if (/\/room$/.test(u) && m === 'POST') return { ok: true, status: 200, json: async () => ({ room: 'newroom', pub: 'newpub' }) };
    if (/\/room\/oldroom$/.test(u)) return { ok: roomAlive, status: roomAlive ? 200 : 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  for (const alive of [true, false]) {
    globalThis.fetch = stubFetch(alive);
    const p = new Publisher({ log: () => {}, onState: () => {} });
    p.connectSfu = async () => fakeLink();                                // no WebRTC in node
    const link = await p.start({ room: 'oldroom', pub: 'oldpub', key: oldKey, at: 1 });
    if (alive) {
      assert.equal(p.reused, true); assert.equal(p.room, 'oldroom'); assert.equal(p.pubToken, 'oldpub'); assert.equal(p.keyB64, oldKey);
      assert.match(link, /view=oldroom#k=/); assert.ok(!fetches.some((f) => f.method === 'POST' && /\/room$/.test(f.url)), 'no new room asked for');
    } else {
      assert.equal(p.reused, false); assert.equal(p.room, 'newroom'); assert.notEqual(p.keyB64, oldKey); assert.match(link, /view=newroom#k=/);
    }
    assert.deepEqual(Object.keys(p.credentials).sort(), ['at', 'key', 'pub', 'room']);
    await p.stop(); fetches.length = 0;
  }
});

test('publisher.publish before start() has imported the key drops the envelope instead of throwing', async () => {
  const p = new Publisher({ log: () => {}, onState: () => {} });
  await p.publish({ t: 'data', x: 1 });                    // the BMS can emit before start() resolves (live log 2026-09-20)
  assert.equal(p.state.dropped, 1);
});

test('2026-09-22 reader log: the signalling socket pings the relay every 10 s and reopens itself after 30 s without any answer (a half-open socket after a Wi-Fi change)', async () => {
  assert.equal(SIG_PING_MS, 10000); assert.equal(SIG_DEAD_MS, 30000);
  assert.deepEqual(sigDecision({ lastMsgAt: 0, lastPingAt: 0, now: SIG_PING_MS - 1 }), { action: 'wait' });
  assert.deepEqual(sigDecision({ lastMsgAt: 0, lastPingAt: 0, now: SIG_PING_MS }), { action: 'ping' });
  assert.deepEqual(sigDecision({ lastMsgAt: 0, lastPingAt: SIG_PING_MS, now: SIG_DEAD_MS }), { action: 'reopen', silentS: 30 });
  assert.deepEqual(sigDecision({ lastMsgAt: SIG_DEAD_MS - 1000, lastPingAt: SIG_PING_MS, now: SIG_DEAD_MS }), { action: 'ping' }, 'a pong (any message) keeps it alive');
  const logs = [];
  const p = new Publisher({ log: (m) => logs.push(m), onState: () => {} });
  p.room = 'r9'; p.pubToken = 'tok'; p.sig = null;
  const { Viewer: ViewerCls } = await import('../public/batray/live.js');
  const v = new ViewerCls({ room: 'r1', keyB64: makeKeyB64(), log: (m) => logs.push(m), onState: () => {}, onEnvelope: () => {} });
  let t = 7_000_000; v.now = () => t;
  await v.start();
  const sig = v.sig; sig.now = () => t; clearInterval(sig.tick);
  const ws = sockets[sockets.length - 1]; ws.open();
  t += SIG_PING_MS; sig.check();
  assert.deepEqual(ws.sent.filter((m) => m.type === 'ping').length, 1, 'a ping goes out after 10 s of silence');
  t += 1000; ws.push({ type: 'pong' });
  t += SIG_PING_MS; sig.check(); assert.equal(ws.sent.filter((m) => m.type === 'ping').length, 2, 'the pong kept it alive; the next ping is due');
  let closed = false; ws.close = () => { closed = true; ws.readyState = 3; ws.onclose && ws.onclose({ code: 4001, reason: 'no pong', wasClean: true }); };
  t += SIG_DEAD_MS; sig.check();
  assert.ok(closed, 'no message for 30 s: the socket is closed');
  assert.ok(logs.some((m) => /the socket is dead, reopening/.test(m)), logs.slice(-3));
  assert.ok(logs.some((m) => /reopening in 4 s/.test(m)), 'and the normal reopen follows');
  v.stop();
});

test('2026-09-30 12:55 replayed on the loop: the direct channel opens while the SFU attempt is in flight - the attempt is abandoned, the link is the direct one, no error, no countdown; then the direct link drops, the SFU takes over, a transport failure counts down and a resume ends the countdown', async () => {
  const logs = []; let attempts = 0;
  const v = new Viewer({ room: 'r2', keyB64: makeKeyB64(), log: (m) => logs.push(m), onState: () => {}, onEnvelope: () => {}, p2pWaitMs: 20, retryS: 1 });
  v.connectSfu = async (signal) => { attempts++; await sleep(300, signal); return fakeLink(); };   // a slow attempt that honours the stop signal
  await v.start();
  const ws = sockets[sockets.length - 1]; ws.open();
  ws.push({ type: 'status', viewers: 1, live: true, session: 'S1', server }); await settle(60);   // the head start passed, the attempt is in flight
  assert.equal(attempts, 1); assert.equal(v.state.live, false);
  const p = { kind: 'p2p', pc: { getStats: async () => [], close() {} }, dc: null, open: false, closed: new Flag(false), path: null };
  v.p2p = p; await v.p2pUp(p, p.pc); await settle();                        // 12:55:13.6 the direct channel opened
  assert.equal(v.state.live, true); assert.equal(v.state.path.tier, 'p2p'); assert.equal(v.state.error, null); assert.equal(v.state.retryIn, null);
  assert.ok(logs.some((l) => /direct link came up during the SFU attempt/.test(l)), logs.join('\n'));
  await settle(350);
  assert.equal(v.state.live, true, 'the abandoned attempt changed nothing when its time came'); assert.equal(v.sfu, null);
  assert.ok(!logs.some((l) => /live: Failed|reconnecting|link loop died/.test(l)), logs.join('\n'));
  // the direct link drops: the loop goes to the SFU at once (same session: no head start)
  v.dropP2P(); await settle(400);
  assert.ok(logs.some((l) => /p2p link ended \(closed\)/.test(l)));
  assert.equal(attempts, 2); assert.equal(v.state.live, true); assert.equal(v.state.path.tier, 'udp');
  // the SFU transport fails: the countdown shows on the chip, a resume ends it early and the loop connects again
  v.sfu.closed.set(true); await settle(20);
  assert.equal(v.state.live, false); assert.equal(v.state.retryIn, 1); assert.ok(logs.some((l) => /sfu link ended \(closed\)/.test(l)));
  v.nudge(); await settle(400);
  assert.ok(logs.some((l) => /tab resumed, retrying now/.test(l)));
  assert.equal(attempts, 3); assert.equal(v.state.live, true); assert.equal(v.state.retryIn, null);
  v.stop(); await settle();
  assert.equal(v.state.live, false);
});

test('publisher loop: connect, publish until the transport drops, count down, connect again; stop aborts the countdown', async () => {
  const logs = []; const links = [];
  const p = new Publisher({ log: (m) => logs.push(m), onState: () => {}, retryS: 1 });
  p.connectSfu = async (signal) => { signal.throwIfAborted(); const l = fakeLink(); links.push(l); return l; };
  await p.start(); await settle(20);
  assert.equal(p.state.live, true); assert.equal(p.sid, 'S'); assert.equal(links.length, 1);
  links[0].closed.set(true); await settle(20);
  assert.equal(p.state.live, false); assert.equal(p.state.retryIn, 1); assert.ok(logs.some((l) => /live: transport connected \(closed\)/.test(l)));
  await settle(1100);
  assert.equal(links.length, 2); assert.equal(p.state.live, true, 'connected again after the countdown');
  links[1].closed.set(true); await settle(20); assert.equal(p.state.retryIn, 1);
  await p.stop(); await settle(20);
  assert.equal(p.state.live, false); assert.equal(p.state.retryIn, null); assert.equal(links.length, 2, 'stop aborted the countdown: no third attempt');
});
