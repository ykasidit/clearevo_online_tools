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
// The live link since 0.9.60: one WebSocket per side through the relay room,
// replayed here over a fake socket. Rules under test: fresh data beats the
// room's word on the reader (2026-09-17), the heartbeat finds a half-open
// socket (2026-09-22), a retained message carries its age and is never
// "just now" (owner, 2026-10-01), a dead socket counts down and reopens, a
// resumed tab does not sit out the countdown, stop() ends everything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readerPresent, dataFlowing, FRESH_MS, makeKeyB64, importKey, encrypt, envelope, sigDecision, SIG_PING_MS, SIG_DEAD_MS } from '../public/batray/live-logic.js';

// ---- fakes for the browser globals live.js touches ----
const sockets = [];
class FakeWS {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.bufferedAmount = 0; sockets.push(this); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; this.onclose && this.onclose({ code, reason, wasClean: true }); }
  open() { this.readyState = 1; this.onopen && this.onopen(); }
  push(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }); }
  get pings() { return this.sent.filter((m) => m.type === 'ping').length; }
}
const fetches = [];
globalThis.WebSocket = FakeWS;
globalThis.location = { protocol: 'https:', host: 'test.local', origin: 'https://test.local' };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.fetch = async (url, init = {}) => { fetches.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }); return { ok: true, status: 200, json: async () => (init.method === 'POST' ? { room: 'r9', pub: 'tok' } : { type: 'status', viewers: 0, live: false }) }; };
const { Viewer, Publisher } = await import('../public/batray/live.js');
const settle = (ms = 15) => new Promise((r) => { setTimeout(r, ms); });
const last = () => sockets[sockets.length - 1];
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const cipher = async (key, env) => b64(await encrypt(key, env));

test('readerPresent: fresh data overrides the server, otherwise the server decides', () => {
  const now = 1_000_000;
  assert.equal(readerPresent({ serverLive: false, lastRxAt: now - 3000, now }), true);     // data 3 s ago: present
  assert.equal(readerPresent({ serverLive: false, lastRxAt: now - FRESH_MS - 1, now }), false);
  assert.equal(readerPresent({ serverLive: true, lastRxAt: null, now }), true);
  assert.equal(readerPresent({ serverLive: null, lastRxAt: null, now }), null);
  assert.equal(dataFlowing(null, now), false);
});

test('viewer loop: socket, reader presence by the room\'s word and by fresh data, a retained message with its age, a dead socket counts down and reopens, a resume ends the countdown, stop', async () => {
  const keyB64 = makeKeyB64(); const key = await importKey(keyB64);
  const states = [], got = [], logs = [];
  const v = new Viewer({ room: 'r1', keyB64, log: (m) => logs.push(m), onState: (s) => states.push(s), onEnvelope: (e) => got.push(e), retryS: 1 });
  let t = 5_000_000; v.now = () => t;
  await v.start(); await settle();
  const ws = last(); assert.match(ws.url, /\/batray\/api\/room\/r1\/ws\?role=view$/);
  assert.equal(v.state.sig, null, 'not open yet');
  ws.open(); await settle();
  assert.equal(v.state.sig, true); assert.equal(v.state.live, false, 'no reader known yet');
  ws.push({ type: 'status', viewers: 1, live: true }); await settle();
  assert.equal(v.state.reader, true); assert.equal(v.state.live, true);
  // a reading arrives: delivered decrypted, counted, fresh
  const env = envelope('data', { id: 'p1', name: 'JK' }, { soc: 50 }); env.t = t - 1000;
  ws.push({ type: 'd', b: await cipher(key, env) }); await settle();
  assert.equal(got.length, 1); assert.equal(got[0].v.soc, 50); assert.equal(got[0].stale, false); assert.equal(got[0].retained, undefined); assert.equal(v.state.received, 1);
  // the room says no reader while readings are fresh: still live (2026-09-17)
  ws.push({ type: 'status', viewers: 1, live: false }); await settle();
  assert.equal(v.state.reader, true); assert.equal(v.state.live, true);
  // ... until they stop: the next tick re-judges
  t += FRESH_MS + 1; v.judgeReader();
  assert.equal(v.state.reader, false); assert.equal(v.state.live, false);
  assert.ok(logs.some((l) => /reader offline/.test(l)), logs.join('\n'));
  ws.push({ type: 'status', viewers: 1, live: true }); await settle();
  assert.equal(v.state.live, true);
  // a retained message from the room: 5 min old, so marked stale with its age (never "just now"), stored not live
  const old = envelope('data', { id: 'p1', name: 'JK' }, { soc: 49 }); old.t = t - 300_000;
  ws.push({ type: 'd', b: await cipher(key, old), slot: 'data0', ago: 300_000 }); await settle();
  assert.equal(got.length, 2); assert.equal(got[1].retained, true); assert.equal(got[1].ageS, 300); assert.equal(got[1].stale, true); assert.equal(v.state.stale, 1);
  const fresh = envelope('hello', { id: '*', name: '*' }, { channel: 'H46' });
  ws.push({ type: 'd', b: await cipher(key, fresh), slot: 'hello', ago: 2000 }); await settle();
  assert.equal(got[2].retained, true); assert.equal(got[2].ageS, 2); assert.equal(got[2].stale, false, 'a retained message under FRESH_MS is as good as live');
  // a queued reading replayed after a freeze (old by its own timestamp) is stale too
  const queued = envelope('data', { id: 'p1', name: 'JK' }, { soc: 48 }); queued.t = t - FRESH_MS - 1;
  ws.push({ type: 'd', b: await cipher(key, queued) }); await settle();
  assert.equal(got[3].stale, true); assert.equal(v.state.stale, 2);
  // the socket dies: sig and live drop, the chip counts down, a new socket is opened
  const n = sockets.length;
  ws.close(1006, ''); await settle();
  assert.equal(v.state.sig, false); assert.equal(v.state.live, false); assert.equal(v.state.retryIn, 1);
  assert.ok(logs.some((l) => /socket closed code=1006.*reopening in 1 s/.test(l)), logs.join('\n'));
  await settle(1100);
  assert.equal(sockets.length, n + 1, 'reopened after the countdown'); assert.equal(v.state.retryIn, null);
  last().open(); await settle();
  assert.equal(v.state.sig, true);
  // a resumed tab ends the next countdown at once
  last().close(1006, ''); await settle();
  assert.equal(v.state.retryIn, 1);
  v.nudge(); await settle();
  assert.equal(sockets.length, n + 2); assert.ok(logs.some((l) => /tab resumed, reconnecting now/.test(l)));
  v.stop(); await settle();
  assert.equal(v.state.live, false); assert.equal(v.state.sig, false); assert.equal(last().readyState, 3, 'stop closed the socket');
  await settle(1100);
  assert.equal(sockets.length, n + 2, 'nothing reopens after stop');
});

test('a message that cannot be decrypted sets the error once and is never delivered', async () => {
  const v = new Viewer({ room: 'r5', keyB64: makeKeyB64(), log: () => {}, onState: () => {}, onEnvelope: () => { throw new Error('must not deliver'); } });
  await v.start(); await settle(); last().open(); await settle();
  const other = await importKey(makeKeyB64());
  last().push({ type: 'd', b: await cipher(other, envelope('data', { id: 'p', name: 'x' }, {})) }); await settle();
  assert.equal(v.state.error, 'cannot decrypt: wrong or missing key'); assert.equal(v.state.received, 0);
  v.stop();
});

test('publisher loop: room, socket, publish with a retain slot or to one viewer, backlog drop, history request in, socket death and reopen, stop', async () => {
  const logs = [], reqs = [];
  const p = new Publisher({ log: (m) => logs.push(m), onState: () => {}, onRequest: (m) => reqs.push(m), retryS: 1 });
  fetches.length = 0;
  await p.start(); await settle();
  assert.equal(p.room, 'r9'); assert.equal(p.pubToken, 'tok'); assert.match(p.link, /#k=/);
  assert.deepEqual(fetches.map((f) => [f.method, f.url]), [['POST', '/batray/api/room']]);
  const ws = last(); assert.match(ws.url, /\/room\/r9\/ws\?role=pub&token=tok$/);
  ws.open(); await settle();
  assert.equal(p.state.live, true); assert.equal(p.state.sig, true);
  await p.publish(envelope('hello', { id: '*', name: '*' }, { channel: 'H46' }));
  await p.publish(envelope('data', { id: 'bms-a', name: 'A' }, { soc: 1 }));
  await p.publish(envelope('data', { id: 'bms-b', name: 'B' }, { soc: 2 }));
  await p.publish(envelope('info', { id: 'bms-a', name: 'A' }, { model: 'x' }));
  await p.publish(envelope('hist-file', { id: '*', name: '*' }, { day: 'd', n: 0 }), 'viewer7');
  const d = ws.sent.filter((m) => m.type === 'd');
  assert.deepEqual(d.map((m) => [m.slot, m.to]), [['hello', undefined], ['data0', undefined], ['data1', undefined], ['info0', undefined], [undefined, 'viewer7']], 'slots by kind and pack index (no pack id reaches the relay); a history chunk is addressed and never retained');
  assert.ok(d.every((m) => /^[A-Za-z0-9+/=]+$/.test(m.b)), 'base64 ciphertext');
  assert.equal(p.state.sent, 5);
  ws.bufferedAmount = 300 * 1024;
  await p.publish(envelope('data', { id: 'bms-a', name: 'A' }, { soc: 3 }));
  assert.equal(p.state.dropped, 1, 'a congested socket drops the envelope instead of queueing it'); assert.equal(p.backlog(), 300 * 1024);
  ws.bufferedAmount = 0;
  ws.push({ type: 'status', viewers: 2, live: true }); await settle();
  assert.equal(p.state.viewers, 2);
  ws.push({ type: 'hist-req', from: 'viewer7', have: [{ day: '2026-09-20' }] }); await settle();
  assert.equal(reqs.length, 1); assert.equal(reqs[0].from, 'viewer7');
  const n = sockets.length;
  ws.close(4000, 'replaced'); await settle();
  assert.equal(p.state.live, false); assert.equal(p.state.retryIn, 1);
  await p.publish(envelope('data', { id: 'bms-a', name: 'A' }, { soc: 4 }));
  assert.equal(p.state.dropped, 2, 'nothing to send on while the socket is down');
  await settle(1100);
  assert.equal(sockets.length, n + 1); last().open(); await settle();
  assert.equal(p.state.live, true);
  await p.stop(); await settle();
  assert.equal(p.state.live, false); assert.equal(p.state.retryIn, null);
  await settle(1100);
  assert.equal(sockets.length, n + 1, 'stop: no reopen');
});

test('channel name: saved, else the BMS name, else a cat; placeholders never win', async () => {
  const { suggestChannelName, CAT_NAMES, parseSavedShare } = await import('../public/batray/live-logic.js');
  assert.equal(suggestChannelName({ saved: 'Home bank', deviceName: 'JK-B2A24S' }), 'Home bank');
  assert.equal(suggestChannelName({ saved: '', deviceName: 'JK-B2A24S' }), 'JK-B2A24S');
  assert.ok(CAT_NAMES.includes(suggestChannelName({ saved: '', deviceName: 'DEMO', rand: () => 0.5 })));
  assert.ok(CAT_NAMES.includes(suggestChannelName({ saved: '', deviceName: 'BMS 2', rand: () => 0 })));
  assert.equal(suggestChannelName({ saved: 'x'.repeat(80), deviceName: '' }).length, 40);
  assert.deepEqual(parseSavedShare('{"room":"AbCdEfGhIjKlMnOpQrStUv","pub":"AbCdEfGhIjKlMnOpQrStUv","key":"AbCdEfGhIjKlMnOpQrStUv","at":5}'), { room: 'AbCdEfGhIjKlMnOpQrStUv', pub: 'AbCdEfGhIjKlMnOpQrStUv', key: 'AbCdEfGhIjKlMnOpQrStUv', at: 5 });
  assert.equal(parseSavedShare('{"room":"short"}'), null); assert.equal(parseSavedShare('nope'), null);
});

test('publisher keeps the earlier room when the check itself fails (0.9.50: a Wi-Fi blink is not a lost room - the relay stores the token; the viewer waits on the old link)', async () => {
  const lines = []; const posts = [];
  globalThis.fetch = async (/** @type {string} */ url, init = {}) => { if (/\/room$/.test(String(url)) && (init.method || 'GET') === 'POST') posts.push(url); throw new TypeError('Failed to fetch'); };
  const p = new Publisher({ log: (m) => lines.push(m), onState: () => {} });
  await p.start({ room: 'oldroom', pub: 'oldpub', key: makeKeyB64() });
  assert.equal(p.reused, true); assert.equal(p.room, 'oldroom'); assert.equal(p.pubToken, 'oldpub');
  assert.equal(posts.length, 0, 'no new room asked for'); assert.ok(lines.some((l) => /could not check the earlier room .* keeping it/.test(l)), lines.join('\n'));
  await p.stop();
});

test('publisher reuses an earlier room when the relay still has it, else makes a new one', async () => {
  let roomAlive = true; const posts = [];
  globalThis.fetch = async (/** @type {string} */ url, init = {}) => {
    const u = String(url), m = init.method || 'GET';
    if (/\/room$/.test(u) && m === 'POST') { posts.push(u); return { ok: true, status: 200, json: async () => ({ room: 'newroom', pub: 'newpub' }) }; }
    if (/\/room\/oldroom$/.test(u)) return { ok: roomAlive, status: roomAlive ? 200 : 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  for (const alive of [true, false]) {
    roomAlive = alive; posts.length = 0;
    const p = new Publisher({ log: () => {}, onState: () => {} });
    const key = makeKeyB64();
    await p.start({ room: 'oldroom', pub: 'oldpub', key });
    if (alive) { assert.equal(p.reused, true); assert.equal(p.room, 'oldroom'); assert.equal(p.keyB64, key); assert.equal(posts.length, 0); }
    else { assert.equal(p.reused, false); assert.equal(p.room, 'newroom'); assert.notEqual(p.keyB64, key); assert.equal(posts.length, 1); }
    assert.deepEqual(Object.keys(p.credentials).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), ['at', 'key', 'pub', 'room']);
    await p.stop();
  }
});

test('publisher.publish before start() has imported the key drops the envelope instead of throwing', async () => {
  const p = new Publisher({ log: () => {}, onState: () => {} });
  await p.publish({ t: 'data', x: 1 });                    // the BMS can emit before start() resolves (live log 2026-09-20)
  assert.equal(p.state.dropped, 1);
});

test('2026-09-22 reader log: the socket pings the relay every 10 s and reopens itself after 30 s without any answer (a half-open socket after a Wi-Fi change)', async () => {
  assert.equal(SIG_PING_MS, 10000); assert.equal(SIG_DEAD_MS, 30000);
  assert.deepEqual(sigDecision({ lastMsgAt: 0, lastPingAt: 0, now: SIG_PING_MS - 1 }), { action: 'wait' });
  assert.deepEqual(sigDecision({ lastMsgAt: 0, lastPingAt: 0, now: SIG_PING_MS }), { action: 'ping' });
  assert.deepEqual(sigDecision({ lastMsgAt: 0, lastPingAt: SIG_PING_MS, now: SIG_DEAD_MS }), { action: 'reopen', silentS: 30 });
  assert.deepEqual(sigDecision({ lastMsgAt: SIG_DEAD_MS - 1000, lastPingAt: SIG_PING_MS, now: SIG_DEAD_MS }), { action: 'ping' }, 'a pong (any message) keeps it alive');
  const logs = [];
  const v = new Viewer({ room: 'r1', keyB64: makeKeyB64(), log: (m) => logs.push(m), onState: () => {}, onEnvelope: () => {}, retryS: 1 });
  let t = 7_000_000; v.now = () => t;
  await v.start(); await settle();
  const ws = last(); ws.open(); await settle();
  // the loop's own tick is 2 s of real time; a nudge wakes it now, the clock below is the loop's
  t += SIG_PING_MS; v.nudge(); await settle();
  assert.equal(ws.pings, 1, 'a ping goes out after 10 s of silence');
  t += 1000; ws.push({ type: 'pong' }); await settle();
  t += SIG_PING_MS; v.nudge(); await settle(); assert.equal(ws.pings, 2, 'the pong kept it alive; the next ping is due');
  t += SIG_DEAD_MS; v.nudge(); await settle();
  assert.equal(ws.readyState, 3, 'no message for 30 s: the socket is closed');
  assert.ok(logs.some((m) => /the socket is dead, reopening/.test(m)), logs.slice(-3));
  assert.ok(logs.some((m) => /socket dead - reopening in 1 s/.test(m)), 'and the normal countdown follows');
  v.stop();
});
