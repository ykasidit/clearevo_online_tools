// BatRay by ClearEvo.com - review round 2 (Opus), O2-4: a share socket still opening at the freeze stays in the room
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
// 0.9.91 (round 1's F1): on `freeze` the reader closes its share socket with 4004 'frozen', so the relay learns the
// reader stopped instead of keeping a frozen page's socket live for hours. Publisher.suspend() closes `this.sock` -
// which is null while openSock() is still opening the next socket (the 10 s after a drop, e.g. a Wi-Fi blip as the
// screen goes off). That socket is not closed: the browser's network side completes the handshake while the page is
// frozen, the relay counts a live publisher that never answers (its pings are answered by the relay itself), viewers
// see "reader online" and no "reader stopped" push fires - round 1's F1, back for a reader frozen mid-reconnect.
// Here the publisher's socket drops, the loop opens the next one, and the page is frozen before it opens.
// Run: node --test test/review/opus_r2_freeze_opening.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

const sockets = [];
class FakeWS {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.bufferedAmount = 0; sockets.push(this); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; this.closedWith = code; if (this.onclose) this.onclose({ code, reason, wasClean: true }); }
  open() { if (this.readyState !== 0) return; this.readyState = 1; if (this.onopen) this.onopen(); }
}
globalThis.WebSocket = FakeWS;
globalThis.location = { protocol: 'https:', host: 'test.local', origin: 'https://test.local' };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.fetch = async (url, init = {}) => ({ ok: true, status: 200, json: async () => ((init.method || 'GET') === 'POST' ? { room: 'r9', pub: 'tok' } : {}) });
const { Publisher } = await import('../../public/batray/live.js');
const settle = (ms = 15) => new Promise((r) => { setTimeout(r, ms); });

test('freeze while the share socket is still opening: that socket is closed (or never opens) instead of joining the room for the frozen page', async () => {
  const p = new Publisher({ log: () => {}, onState: () => {}, retryS: 0.05 });
  await p.start(null); await settle();
  const first = sockets[sockets.length - 1]; first.open(); await settle();
  first.close(1006, '');                                               // the Wi-Fi blinked: the socket died
  for (let i = 0; i < 40 && sockets[sockets.length - 1] === first; i++) await settle(10);   // the loop counts down, then opens the next one
  const next = sockets[sockets.length - 1];
  assert.notEqual(next, first, 'the loop is opening a new socket');
  assert.equal(next.readyState, 0, 'it is still opening');
  p.suspend();                                                          // the freeze event, 0.9.91's handler
  next.open();                                                          // the handshake completes in the network process while the page is frozen
  await settle();
  const state = next.readyState, code = next.closedWith;
  await p.stop();
  assert.equal(state, 3, `the socket that was opening at the freeze is ${state === 1 ? 'OPEN in the room' : `in state ${state}`} after the freeze (close code ${code})`);
});
