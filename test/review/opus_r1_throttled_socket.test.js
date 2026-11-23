// BatRay by ClearEvo.com - review round 1 (Opus), O-throttle: a half-open share socket is never judged in a hidden tab
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
// The heartbeat (0.9.32) exists because a Wi-Fi change leaves the reader's socket half-open: no close event, nothing
// arrives, the relay has dropped it. serve() (live.js) closes it after SIG_DEAD_MS of silence - but since 0.9.84 a
// turn gap over 2 x SIG_PING_MS is taken for the page's own sleep: it pings, resets lastMsgAt and goes on. Chrome
// runs the timers of a page hidden for 5 minutes once a minute (intensive wake-up throttling), so in a hidden reader
// that is NOT frozen - the 0.9.80 tombstone of 2026-10-09: vis=no, ticking, connected, sharing - EVERY turn is a
// 60 s gap: every turn is "slept", lastMsgAt is reset every time, and the dead socket is never reopened. The share
// stays dead (the relay says "no reader") for as long as the tab stays hidden, while the BMS link and the store run.
// Here the relay never answers; turns come 60 s apart for 15 minutes; the reader must reopen its socket.
// Run: node --test test/review/opus_r1_throttled_socket.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

const sockets = [];
class FakeWS {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.bufferedAmount = 0; sockets.push(this); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; if (this.onclose) this.onclose({ code, reason, wasClean: true }); }
  open() { this.readyState = 1; if (this.onopen) this.onopen(); }
}
globalThis.WebSocket = FakeWS;
globalThis.location = { protocol: 'https:', host: 'test.local', origin: 'https://test.local' };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.fetch = async (url, init = {}) => ({ ok: true, status: 200, json: async () => ((init.method || 'GET') === 'POST' ? { room: 'r9', pub: 'tok' } : {}) });
const { Publisher } = await import('../../public/batray/live.js');
const settle = (ms = 15) => new Promise((r) => { setTimeout(r, ms); });

test('a hidden, throttled reader (turns 60 s apart) whose share socket went half-open reopens it within 15 minutes', async () => {
  const logs = [];
  const p = new Publisher({ log: (m) => logs.push(m), onState: () => {}, retryS: 1 });
  let t = 7_000_000; p.now = () => t;
  await p.start(null); await settle();
  const ws = sockets[sockets.length - 1]; ws.open(); await settle();
  // the Wi-Fi changed: the socket stays "open", the relay never answers again. The tab is hidden: Chrome runs its
  // timers once a minute, so each turn of the serve loop comes 60 s after the one before.
  for (let i = 0; i < 15 && ws.readyState !== 3; i++) { t += 60_000; p.nudge(); await settle(); }
  const slept = logs.filter((m) => /the page slept/.test(m)).length, state = ws.readyState, pings = ws.sent.filter((m) => m.type === 'ping').length;
  await p.stop();
  assert.equal(state, 3, `15 minutes with no answer to ${pings} pings and the socket is still open (${slept} turns taken for the page's own sleep)`);
});
