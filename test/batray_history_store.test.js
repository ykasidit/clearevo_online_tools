// BatRay by ClearEvo.com - tests (batray_history_store.test.js)
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
// The store in front of the worker (owner rules 2026-09-24): every call has
// a deadline and never blocks forever, a failure or a timeout goes to the
// debug log, read/write statistics go to the debug log, three timeouts in a
// row restart the worker (pending calls fail at once, the next call works),
// reads and writes issued at the same time all complete. The worker here is
// a fake with the real message protocol; the memory backend is the real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HistoryStore, MemoryBackend } from '../public/batray/history.js';
import { OP_TIMEOUT_MS } from '../public/batray/history-logic.js';

const T0 = Date.UTC(2026, 8, 24, 10, 0, 0);
const mk = (i, p = 'm-00') => ({ t: T0 + i * 3000, p, soc: 50, v: 52, w: i % 2 ? 600 : -300 });

/** A fake worker: the protocol of the real one over a MemoryBackend, with a `hang` switch to swallow calls. */
function fakeWorkerFactory(state) {
  return () => {
    const be = new MemoryBackend(); const w = { onmessage: null, onerror: null, terminated: false };
    state.workers.push(w);
    w.postMessage = ({ id, op, args }) => {
      if (w.terminated) throw new Error('terminated');
      if (state.hang && w === state.workers[0]) return;                     // the first worker is stuck: never answers
      if (state.corrupt && op !== 'ping') { setTimeout(() => w.onmessage({ data: { id, ok: false, error: `${state.corrupt} database is corrupt (${op}): SQLITE_CORRUPT: sqlite3 result code 11: database disk image is malformed`, name: 'CorruptError', data: { day: state.corrupt, op } } }), 1); return; }
      if (state.locked && state.workers.length > 1 && w === state.workers[state.workers.length - 1]) { setTimeout(() => w.onmessage({ data: { id, ok: false, error: "Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.", name: 'InvalidStateError' } }), 1); return; }
      setTimeout(async () => { if (w.terminated) return; try { const r = await be[op](args || {}); w.onmessage({ data: { id, ok: true, r } }); } catch (e) { w.onmessage({ data: { id, ok: false, error: e.message, name: e.name } }); } }, state.delayMs || 1);
    };
    w.terminate = () => { w.terminated = true; };
    return w;
  };
}
const fakeNav = () => { globalThis.Worker = function () {}; Object.defineProperty(globalThis, 'navigator', { value: { storage: { getDirectory() {}, persist: async () => true } }, configurable: true, writable: true }); };
const store = (state, timeouts = {}) => { fakeNav(); return new HistoryStore({ log: (m) => state.logs.push(m), makeWorker: fakeWorkerFactory(state), timeouts }); };

test('insert then read through the worker protocol; ids handed out; the open line is logged', async () => {
  const st = { logs: [], workers: [] }; const h = store(st);
  assert.equal(await h.ready, 'opfs');
  assert.ok(st.logs.some((l) => /history: SQLite undefined over memory, undefined files, \d+ ms to open/.test(l)), st.logs);
  const r = await h.insert('2026-09-24', [{ ...mk(0), id: 1 }, { ...mk(1), id: 2 }]);
  assert.deepEqual(r, { inserted: 2, ignored: 0, maxId: 2 });
  assert.deepEqual((await h.rows('2026-09-24', 1)).map((x) => x.id), [2]);
  assert.deepEqual((await h.days()).map((d) => [d.day, d.rows, d.maxId]), [['2026-09-24', 2, 2]]);
  const q = await h.query({ p: 'm-00', from: T0, to: T0 + 10000, stepMs: 60000 });
  assert.equal(q.parts.length, 1); assert.equal(q.parts[0].n[0], 2); assert.equal(q.first, T0); assert.equal(q.last, T0 + 3000);
  assert.ok(Math.abs(q.energy.charged - 600 * 3000 / 3600000) < 1e-9);
});

test('same time: 30 inserts and 30 reads fired together all settle, nothing lost, nothing blocked', async () => {
  const st = { logs: [], workers: [], delayMs: 2 }; const h = store(st);
  const ps = [];
  for (let k = 0; k < 30; k++) {
    ps.push(h.insert('2026-09-24', [{ ...mk(k), id: k + 1 }]));
    ps.push(h.rows('2026-09-24', 0, 1000));
    if (k % 3 === 0) ps.push(h.query({ p: 'm-00', from: T0, to: T0 + 1e6, stepMs: 3000 }));
  }
  const t0 = Date.now(); const out = await Promise.all(ps); const ms = Date.now() - t0;
  assert.equal(out.length, ps.length); assert.ok(ms < 5000, `${ms} ms`);
  assert.equal((await h.info('2026-09-24')).rows, 30);
  const line = h.statsLine();
  assert.match(line, /^history stats: (ping|insert|rows|query|days)=/);
  assert.match(line, /insert=30\(30ok\) \d+\/\d+ms 30rows/);
  assert.match(line, /rows=30\(30ok\)/); assert.match(line, /query=10\(10ok\)/);
});

test('no block forever: a call past its deadline rejects, is logged as a timeout, and is counted', async () => {
  const st = { logs: [], workers: [] }; const h = store(st, { rows: 60, insert: 60 });
  await h.ready; st.hang = true;
  const t0 = Date.now();
  await assert.rejects(h.rows('2026-09-24'), (e) => e.name === 'TimeoutError' && /rows timed out after 0 s/.test(e.message));
  assert.ok(Date.now() - t0 < 1000, 'rejected at the deadline, not later');
  assert.ok(st.logs.some((l) => /history: rows TIMED OUT after \d+ ms/.test(l)), st.logs);
  assert.equal(h.stats.timeouts, 1); assert.equal(h.stats.ops.rows.timeout, 1);
  assert.match(h.statsLine(), /rows=1\(0ok\/1timeout\)/);
});

test('a failure goes to the debug log once per distinct message, and is counted', async () => {
  const st = { logs: [], workers: [] }; const h = store(st);
  await h.ready;
  await assert.rejects(h.importDay('2026-09-24', new Uint8Array(3)), /cannot store files/);
  await assert.rejects(h.importDay('2026-09-24', new Uint8Array(3)), /cannot store files/);
  assert.equal(st.logs.filter((l) => /history: import failed after \d+ ms: this browser cannot store files/.test(l)).length, 1, 'the same failure again is not logged again');
  assert.equal(h.stats.fails, 2); assert.match(h.statsLine(), /import=2\(0ok\/2fail\)/);
});

test('three timeouts in a row restart the worker: pending calls fail at once, the next call answers, restarts are counted and logged', async () => {
  const st = { logs: [], workers: [] }; const h = store(st, { rows: 40, insert: 40, days: 40 });
  await h.ready; assert.equal(st.workers.length, 1);
  st.hang = true;
  await assert.rejects(h.rows('d')); await assert.rejects(h.days());
  const pending = h.insert('d', [mk(0)]);                                  // in flight when the third timeout restarts the worker
  await assert.rejects(h.rows('d'));
  assert.equal(st.workers.length, 2, 'a fresh worker'); assert.ok(st.workers[0].terminated, 'the stuck one was terminated');
  await assert.rejects(pending, (e) => e.name === 'RestartError' || e.name === 'TimeoutError');
  assert.ok(st.logs.some((l) => /the worker looks stuck: restarting it \(restart 1\)/.test(l)), st.logs);
  assert.deepEqual(await h.days(), [], 'the new worker answers (after its ping)');
  assert.ok(st.logs.some((l) => /history: fresh worker answers, SQLite over memory/.test(l)), st.logs);
  assert.equal(h.stats.restarts, 1); assert.match(h.statsLine(), /restarts=1$/);
  h.statsReset(5); assert.equal(h.statsLine(), 'history stats: no calls yet · restarts=1');
});

test('a pool still locked after the restart (a worker killed while busy): the store goes memory-only, says so once, tells the app, and the call is answered', async () => {
  const st = { logs: [], workers: [] }; const h = store(st, { rows: 40, days: 40 });
  await h.ready; const seen = []; h.onBackend = (b) => seen.push(b);
  st.hang = true;
  st.locked = true;
  await assert.rejects(h.rows('d')); await assert.rejects(h.days()); await assert.rejects(h.rows('d'));
  assert.equal(st.workers.length, 2);
  st.locked = true;                                                         // the fresh worker cannot take the pool: its ping fails
  assert.deepEqual(await h.days(), [], 'answered from memory');
  assert.equal(h.backend, 'memory'); assert.deepEqual(seen, ['memory']); assert.ok(st.workers[1].terminated);
  assert.equal(st.logs.filter((l) => /storage pool stayed locked \d+ s after the worker restart \(a killed worker keeps its files open\): .* reload the page to store again/.test(l)).length, 1, st.logs);
  await h.insert('2026-09-24', [mk(0)]); assert.equal((await h.info('2026-09-24')).rows, 1, 'memory store works on');
  assert.equal(h.stats.lockouts, 1);
});

test('a corrupt day database: the worker names the day, the store logs it and raises a CorruptError carrying day + op for the caller to decide', async () => {
  const st = { logs: [], workers: [] }; const h = store(st);
  await h.ready; st.corrupt = '2026-09-24';
  await assert.rejects(h.insert('2026-09-24', [{ ...mk(0), id: 1 }]), (e) => e.name === 'CorruptError' && e.day === '2026-09-24' && e.op === 'insert' && /database is corrupt \(insert\): SQLITE_CORRUPT/.test(e.message));
  await assert.rejects(h.rows('2026-09-24'), (e) => e.name === 'CorruptError' && e.day === '2026-09-24' && e.op === 'rows');
  assert.ok(st.logs.some((l) => /history: insert failed after \d+ ms: 2026-09-24 database is corrupt \(insert\): SQLITE_CORRUPT/.test(l)), st.logs);
  assert.ok(st.logs.some((l) => /history: rows failed after \d+ ms: 2026-09-24 database is corrupt \(rows\)/.test(l)), st.logs);
  assert.equal(h.stats.fails, 2); assert.equal(h.stats.restarts, 0, 'corruption is not a stuck worker');
});

test('the memory-only store answers the same calls (and says export gives nothing, import is refused)', async () => {
  const logs = []; const h = new HistoryStore({ log: (m) => logs.push(m), forceMemory: true });
  assert.equal(await h.ready, 'memory');
  await h.insert('2026-09-24', [mk(0), mk(1), mk(2)]);
  assert.deepEqual((await h.days())[0].rows, 3);
  assert.equal((await h.info('2026-09-24')).contig, 3, 'ids handed out 1..3');
  assert.equal(await h.exportDay('2026-09-24'), null);
  await assert.rejects(h.importDay('2026-09-24', new Uint8Array(1)));
  assert.deepEqual(await h.oldFiles(), { files: 0, bytes: 0 });
  await h.remove('2026-09-24'); assert.deepEqual(await h.days(), []);
});

test('deadlines per kind are the documented ones', () => {
  assert.equal(OP_TIMEOUT_MS.insert, 8000); assert.equal(OP_TIMEOUT_MS.query, 15000); assert.equal(OP_TIMEOUT_MS.export, 60000);
});
