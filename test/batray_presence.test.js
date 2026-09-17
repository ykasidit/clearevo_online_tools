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
import { readerPresent, dataFlowing, FRESH_MS, makeKeyB64, importKey, encrypt, envelope } from '../public/batray/live-logic.js';

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

test('readerPresent: fresh data overrides the server, otherwise the server decides', () => {
  const now = 1_000_000;
  assert.equal(readerPresent({ serverLive: false, lastRxAt: now - 3000, now }), true);     // data 3 s ago: present
  assert.equal(readerPresent({ serverLive: false, lastRxAt: now - FRESH_MS - 1, now }), false);
  assert.equal(readerPresent({ serverLive: true, lastRxAt: null, now }), true);
  assert.equal(readerPresent({ serverLive: null, lastRxAt: null, now }), null);
  assert.equal(dataFlowing(null, now), false);
});

test('viewer keeps the link and says "reader present" while readings arrive, drops it only once they stop', async () => {
  const keyB64 = makeKeyB64(); const key = await importKey(keyB64);
  const states = [], got = [], logs = [];
  const v = new Viewer({ room: 'r1', keyB64, log: (m) => logs.push(m), onState: (s) => states.push(s), onEnvelope: (e) => got.push(e) });
  let t = 5_000_000; v.now = () => t;
  await v.start();
  v.subscribe = async () => {};                 // no SFU in node; the direct link is what streams here
  const ws = sockets[sockets.length - 1]; ws.open();
  ws.push({ type: 'status', viewers: 1, live: true, session: 'S1', server: { conns: 1, limit: 1000 } });
  assert.equal(v.state.reader, true); assert.equal(v.pubSession, 'S1');
  v.state.live = true;                          // as the open data channel would set it
  const bytes = await encrypt(key, envelope('data', { id: 'p', name: 'n11' }, { soc: 50 }));
  await v.onBytes(bytes.buffer ? bytes.buffer : bytes);
  assert.equal(got.length, 1); assert.equal(v.lastRxAt, t);
  // the reader's presence socket blinks: the relay wipes the session and says so
  t += 3000;
  ws.push({ type: 'status', viewers: 1, live: false, server: { conns: 1, limit: 1000 } });
  assert.equal(v.state.reader, true, 'fresh data must beat the server');
  assert.equal(v.pubSession, 'S1', 'the session must not be forgotten while data flows');
  assert.equal(v.state.live, true, 'the stream must not be torn down');
  assert.ok(logs.some((l) => /readings are still arriving/.test(l)), logs.join('\n'));
  // readings keep coming for a while: still present
  t += 5000; await v.onBytes(bytes.buffer ? bytes.buffer : bytes);
  t += 5000; ws.push({ type: 'status', viewers: 1, live: false, server: { conns: 1, limit: 1000 } });
  assert.equal(v.state.reader, true);
  // ...then they stop for longer than FRESH_MS: now the server's word stands
  t += FRESH_MS + 1000;
  ws.push({ type: 'status', viewers: 1, live: false, server: { conns: 1, limit: 1000 } });
  assert.equal(v.state.reader, false); assert.equal(v.pubSession, null); assert.equal(v.state.live, false);
  // and a reading arriving again flips it back at once, before any status
  await v.onBytes(bytes.buffer ? bytes.buffer : bytes);
  assert.equal(v.state.reader, true);
  v.stop();
});

test('publisher re-registers its SFU session when its socket reopens and when the room says it has none', async () => {
  const p = new Publisher({ log: () => {}, onState: () => {} });
  p.room = 'r1'; p.pubToken = 'tok'; p.sid = 'SESS'; p.state.live = true;
  fetches.length = 0;
  p.onSigConn(true);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetches.length, 1);
  assert.match(fetches[0].url, /room\/r1\/session\?token=tok$/); assert.equal(fetches[0].method, 'PUT'); assert.deepEqual(fetches[0].body, { session: 'SESS' });
  p.onSignal({ type: 'status', viewers: 0, live: false, server: { conns: 0, limit: 1000 } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetches.length, 2);
  // not live (between retries): nothing to register
  p.state.live = false; p.onSigConn(true); await new Promise((r) => setTimeout(r, 0));
  assert.equal(fetches.length, 2);
});
