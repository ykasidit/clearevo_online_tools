// BatRay by ClearEvo.com - tests (longrun_fable.test.js): what stops a reader that runs for a month or a year
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
// Long-run review (Fable, 2026-11-05): the reader phone runs 24/7 next to the pack for a month to a year. Each test
// states what the code must do for that to work and fails on the current code for the reason in the review report.
// The year is driven as iterations of the real code path, never as wall time.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { openSqlite } from './sqlite_node.mjs';
import { ensureSchema, insertRows, dayCount } from '../public/batray/history-sql.js';
import { OP_TIMEOUT_MS, rowDue, MIN_ROW_MS } from '../public/batray/history-logic.js';
import { HistoryStore, MemoryBackend } from '../public/batray/history.js';
import { BleConn } from '../public/batray/conn.js';
import { JkBms } from '../public/batray/jkbms.js';
import { RECONNECT_S } from '../public/batray/conn-logic.js';
import { sleep } from '../public/batray/sync.js';
import * as F from './batray_frames.js';

// ---------------------------------------------------------------- L-F1: the day listing walks every file; its per-file cost must not scale with the rows
// Round 1: history-worker.js `days()` ran history-sql.js `dayInfo()` (the contiguous-id scan, min/max t) on every file under
// ONE 8 s deadline: 18.8 ms per two-pack day here, 6.9 s for a year, 3-4x that on a phone. Round 2 (325e484): the listing
// calls `dayCount()` (count + max id, index-only) and caches past days' facts in the worker and in dayinfo-<store>.json;
// what the reader pays for the real `days` op over a year of OPFS files is measured in the browser test
// (longrun_fable_history.mjs, L-F1). This keeps the per-file property under test on the real wasm.
const sqlite3 = await openSqlite();
const T0 = Date.UTC(2026, 8, 24);
function dayDb(rowsPerPack) {
  const db = new sqlite3.oo1.DB(':memory:'); ensureSchema(db);
  const rows = []; let id = 0;
  for (let i = 0; i < rowsPerPack; i++) for (const p of ['m-00', 's-01']) rows.push({ id: ++id, t: T0 + i * 3000 + (p === 'm-00' ? 0 : 1), p, soc: 50, v: 52.1, i: 1, w: 50, ah: 150, tm: 30, t1: 25, t2: 26, ch: 1, ds: 1, bal: 0, err: 0, c: Array.from({ length: 16 }, () => 3300) });
  for (let k = 0; k < rows.length; k += 5000) insertRows(db, rows.slice(k, k + 5000));
  return db;
}
function msOf(fn, reps = 5) { let best = Infinity; for (let r = 0; r < reps; r++) { const t = performance.now(); fn(); best = Math.min(best, performance.now() - t); } return best; }

test('L-F1: what the day listing runs on each file (dayCount) is cheap enough that a cold listing of a year of two-pack day files fits the 8 s deadline of days() on a phone', () => {
  const small = dayDb(2880), full = dayDb(28800);                              // 10 % of a two-pack day, and a whole one (57,600 rows)
  try {
    const msSmall = msOf(() => dayCount(small)), msFull = msOf(() => dayCount(full));
    const yearMs = msFull * 365;
    const note = `dayCount: ${msSmall.toFixed(2)} ms at ${2880 * 2} rows, ${msFull.toFixed(2)} ms at ${28800 * 2} rows; 365 such files = ${yearMs.toFixed(0)} ms of counting per cold days() call against a ${OP_TIMEOUT_MS.days} ms deadline (this machine; a phone is 3-4x slower)`;
    assert.ok(yearMs * 4 < OP_TIMEOUT_MS.days, `a cold listing of a year on a phone (4x this machine) passes the deadline: ${note}`);   // count(*) walks the smallest index, so it still grows with the rows (0.3 -> 2.5 ms): the margin is this budget
  } finally { small.close(); full.close(); }
});

// ---------------------------------------------------------------- L-F2: memory-only is for ever after an hour of retries
// history.js retryLater(): after a lock-out (a worker killed while busy keeps its OPFS handles - Chrome, probed
// 2026-09-24) the store tries a fresh worker every RETRY_MS = 2 min, RETRY_TRIES = 30 times, then logs "giving up until
// a reload" and never tries again. A reader nobody reloads then keeps NOTHING for the rest of its run (0.9.74: no rows
// and no debug log without the file store). The expectation for a 24/7 page: a store that becomes available again is
// taken again, however long it was locked.
function fakeWorkerFactory(state) {
  return () => {
    const be = new MemoryBackend(); const w = { onmessage: null, onerror: null, terminated: false };
    state.workers.push(w);
    w.postMessage = ({ id, op, args }) => {
      if (w.terminated) throw new Error('terminated');
      if (state.locked) { setTimeout(() => { if (!w.terminated) w.onmessage({ data: { id, ok: false, error: "Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.", name: 'InvalidStateError' } }); }, 1); return; }
      setTimeout(async () => { if (w.terminated) return; try { const r = await be[op](args || {}); w.onmessage({ data: { id, ok: true, r } }); } catch (e) { w.onmessage({ data: { id, ok: false, error: e.message, name: e.name } }); } }, 1);
    };
    w.terminate = () => { w.terminated = true; };
    return w;
  };
}
const fakeNav = () => { globalThis.Worker = function () {}; Object.defineProperty(globalThis, 'navigator', { value: { storage: { getDirectory() {}, persist: async () => true } }, configurable: true, writable: true }); };

test('L-F2: a store locked out longer than the old retry budget (30 x 2 min) is taken again once its pool is free - a reader nobody reloads must not stay memory-only for the rest of the year', async () => {
  fakeNav();
  const st = { logs: [], workers: [], locked: true };
  const h = new HistoryStore({ log: (m) => st.logs.push(m), makeWorker: fakeWorkerFactory(st), retryTries: 3, retryMs: 10 });   // the real 30 x 120 s, scaled: 3 tries 10 ms apart (then the slower rhythm, 75 ms here = 15 min there)
  try {
    assert.equal(await h.ready, 'memory', 'the first open found the pool locked');
    await sleep(120);                                                           // the whole first retry budget passes with the pool still locked
    assert.equal(h.backend, 'memory', 'still locked: still memory');
    st.locked = false;                                                          // the pool is free again (the lock went with whatever held it)
    for (let i = 0; i < 100 && h.backend !== 'opfs'; i++) await sleep(10);     // up to 1 s = many slow-rhythm periods
    assert.equal(h.backend, 'opfs', `the pool has been free for 1 s (a dozen retry periods of the slow rhythm) and the store is still '${h.backend}': readings and the debug log are dropped until a human reloads the page`);
    assert.ok(st.logs.some((l) => /the store opened on a later try/.test(l)), st.logs.join('\n'));
  } finally { h.release(); }                                                    // the retry loop lives as long as the store (0.9.86): release() ends it, so node exits
});

// ---------------------------------------------------------------- L-F3: a BMS out of range looks like "Bluetooth was off" every round
// conn.js stuckNow(): the oldest browser connect still unsettled past STUCK_MS = 45 s means phase 'stuck' (0.9.81: a
// connect issued with Bluetooth off never settles; the sheet says only closing Chrome clears it). But jkbms.js _track()
// keeps ONE pending group as long as any connect in it is unsettled, and Android settles a direct connect to a device
// that is out of range (or switched off) only after ~30 s (GATT connection timeout, status 133), while an attempt gives
// up after CONNECT_S = 15 s and the next one starts 1.5 s later: connect #1 at 0 s, #2 at 16.5 s, #3 at 33 s - the group
// is never empty before 63 s, so at 45 s every round against an absent BMS ends in 'stuck' instead of the countdown.
const CONN_TIMEOUT = 'GATT operation failed for unknown reason.';
class AbsentDev extends EventTarget {
  /** A BMS that is not there: Android rejects each direct connect after rejectMs. */
  constructor(rejectMs) {
    super();
    this.id = 'absent-1'; this.name = 'n11'; this.connects = 0; this.disconnects = 0; this.rejectMs = rejectMs;
    const dev = this;
    this.gatt = {
      connected: false,
      connect: () => { dev.connects++; return new Promise((_, reject) => { setTimeout(() => reject(new Error(CONN_TIMEOUT)), dev.rejectMs); }); },
      disconnect: () => { dev.disconnects++; },
    };
  }
}
const harnesses = [];
afterEach(() => { for (const c of harnesses.splice(0)) c.stop(); });
/** The loop on a fast clock: one "second" = 20 ms. */
function loopOver(dev, hooks = {}) {
  const bms = new JkBms(), log = [], ev = [];
  bms.addEventListener('log', (e) => log.push(e.detail));
  const h = {
    log: (m) => log.push(m), autoRe: () => true, device: () => dev, changed: () => {}, choose: async () => dev, fresh: async (d) => d,
    attempt: (n) => ev.push(`attempt ${n}`), connected: () => ev.push('connected'), failed: (m) => ev.push(`failed: ${m}`),
    stalled: () => ev.push('stalled'), down: () => ev.push('down'), stuck: () => ev.push('stuck'), ...hooks,
  };
  const c = new BleConn(bms, h, { secMs: 20, tickMs: 10, gapMs: 30, downWaitMs: 100, writeMs: 200, freshMs: 100, stuckMs: 45 * 20, link: { staleMs: 300, startupMs: 600, handshakeMs: 60, nudgeMs: 100, quickMs: 40 } });
  harnesses.push(c);
  const until = async (pred, what, ms = 4000) => {
    const t0 = performance.now();
    while (!pred()) { if (performance.now() - t0 > ms) throw new Error(`no ${what} in ${ms} ms: phase ${c.cs.phase}; ${ev.join(' | ')}\n${log.slice(-12).join('\n')}`); await sleep(5); }
  };
  return { bms, c, ev, log, until };
}

test('L-F3: a BMS that is out of range (Android rejects each direct connect after 30 s) is retried and counted down, never taken for a connect made with Bluetooth off (phase stuck)', async () => {
  const dev = new AbsentDev(30 * 20), t = loopOver(dev);                       // the phone's 30 s, on the 20 ms clock
  t.c.tell('known');
  await t.until(() => t.c.cs.phase === 'countdown' || t.c.cs.phase === 'stuck', 'the end of the round', 4000);
  assert.equal(t.c.cs.phase, 'countdown', `the round against an absent BMS ended in phase '${t.c.cs.phase}' after ${dev.connects} connects (${t.ev.join(' | ')}): the sheet now says Bluetooth was off and only closing Chrome clears it`);
  assert.ok(!t.ev.includes('stuck'), t.ev.join(' | '));
});

// ---------------------------------------------------------------- L-F4: a clock set back stretches every wall-clock deadline by the jump (round 2: sync.js deadline() and rowDue fixed)
// conn.js secsLeft() and the countdown's deadline, live.js retryWait() and history-logic.js rowDue() all take
// Date.now() differences. A phone clock corrected backwards (NTP after weeks without network, a manual change) makes
// `deadline - Date.now()` grow by the jump: a 10 s reconnect countdown waits out the jump before it reconnects, and
// rowDue() stores no row until the clock has caught up with the last stored row. The expectation: a deadline or a
// cadence measured on a monotonic clock (performance.now()) is unmoved by a step of the wall clock.
class FallingDev extends EventTarget {
  /** A BMS that connects and streams, then is dropped by the test. */
  constructor() {
    super();
    this.id = 'fall-1'; this.name = 'n11'; this.connects = 0; this.disconnects = 0; this.timer = null;
    const dev = this;
    this.char = {
      fns: [], addEventListener(_, fn) { this.fns.push(fn); }, startNotifications: async () => {},
      writeValueWithoutResponse: async (bytes) => { if (bytes[4] === 0x97) setTimeout(() => dev.notify(F.AIO_32S_DEV), 5); if (bytes[4] === 0x96) dev.startStream(); },
    };
    this.gatt = {
      connected: false,
      connect: async () => { dev.connects++; dev.gatt.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => dev.char }) }; },
      disconnect: () => { dev.disconnects++; if (!dev.gatt.connected) return; dev.gatt.connected = false; dev.stopStream(); dev.dispatchEvent(new Event('gattserverdisconnected')); },
    };
  }
  notify(bytes) { for (const fn of this.char.fns) fn({ target: { value: new DataView(Uint8Array.from(bytes).buffer) } }); }
  startStream() { if (!this.timer) this.timer = setInterval(() => { if (this.gatt.connected) this.notify(F.OWNER_32S_CELL); }, 30); }
  stopStream() { clearInterval(this.timer); this.timer = null; }
  fall() { this.gatt.disconnect(); }
}
const realNow = Date.now;
afterEach(() => { Date.now = realNow; });

test('L-F4: a reconnect countdown ends on time when the phone clock is set back by an hour while it runs', async () => {
  const dev = new FallingDev(), t = loopOver(dev);
  t.c.tell('known');
  await t.until(() => t.c.cs.gotData, 'data');
  dev.fall();
  await t.until(() => t.c.cs.phase === 'countdown', 'the countdown');
  const back = 3600e3;
  Date.now = () => realNow() - back;                                            // the clock steps back one hour (the countdown had 10 "seconds" = 200 ms to go)
  await sleep(RECONNECT_S.auto * 20 * 3 + 200);                                 // three times the countdown
  const count = t.c.cs.count;
  Date.now = realNow;
  dev.stopStream();
  assert.notEqual(t.c.cs.phase, 'countdown', `still counting down ${count} s after the clock was set back one hour: the reconnect waits out the whole jump`);
});

test('L-F4: the one-row-per-3-s cadence keeps storing rows after the clock is set back', () => {
  const t = Date.UTC(2026, 10, 5, 12, 0, 0);
  assert.equal(rowDue(t, t + MIN_ROW_MS), true, 'a row 3 s later is due');
  assert.equal(rowDue(t, t - 120e3), true, 'the clock stepped back two minutes: a reading now is still the first in 3 s of readings, not "too soon" - rowDue says no row until the clock catches up');
});
