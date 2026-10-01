// BatRay by ClearEvo.com - latches, channels, sleep and select (tests)
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
import { Flag, Channel, sleep, select, isAbort, TIMEOUT } from '../public/batray/sync.js';

test('Flag: a wait for the current level returns at once, a set wakes the waiters, nothing is lost between a callback and the loop', async () => {
  const f = new Flag(false);
  assert.equal(await f.wait(false), 'set');
  const p = f.wait(true, { ms: 1000 });
  f.set(true);                                                                 // the callback, before the loop even looked
  assert.equal(await p, 'set');
  assert.equal(await f.wait(true), 'set', 'a level, not an edge: still true');
  assert.equal(await f.wait(false, { ms: 20 }), TIMEOUT, 'a deadline');
  assert.equal(f.w.length, 0, 'the timed-out waiter was removed');
  const ac = new AbortController(); const q = f.wait(false, { signal: ac.signal }); ac.abort();
  await assert.rejects(q, (e) => isAbort(e)); assert.equal(f.w.length, 0, 'the aborted waiter was removed');
  await assert.rejects(f.wait(false, { signal: ac.signal }), (e) => isAbort(e), 'an already aborted signal rejects at once');
});

test('Channel: pushes before anyone waits are kept in order; next() takes a deadline and a signal', async () => {
  const c = new Channel();
  c.push('a'); c.push('b');
  assert.equal(await c.next(), 'a'); assert.equal(await c.next(), 'b');
  assert.equal(await c.next({ ms: 20 }), TIMEOUT);
  const p = c.next(); c.push('c'); assert.equal(await p, 'c');
  const ac = new AbortController(); const q = c.next({ signal: ac.signal }); ac.abort(); await assert.rejects(q, (e) => isAbort(e));
});

test('select: the first arm wins, the losers are aborted through their signal, the outer signal aborts the whole select', async () => {
  const f = new Flag(false); const c = new Channel();
  const aborted = [];
  const r = await select(undefined, {
    flag: (s) => f.wait(true, { signal: s }).catch((e) => { aborted.push('flag'); throw e; }),
    item: (s) => c.next({ signal: s }).catch((e) => { aborted.push('item'); throw e; }),
    timer: (s) => sleep(30, s),
  });
  assert.deepEqual(r, { key: 'timer', value: TIMEOUT });
  await sleep(5);
  assert.deepEqual(aborted.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), ['flag', 'item'], 'the losing arms were cancelled, no waiter leaks');
  assert.equal(f.w.length, 0); assert.equal(c.w.length, 0);
  const p = select(undefined, { flag: (s) => f.wait(true, { signal: s }), timer: (s) => sleep(1000, s) }); f.set(true);
  assert.deepEqual(await p, { key: 'flag', value: 'set' });
  const ac = new AbortController(); const q = select(ac.signal, { timer: (s) => sleep(1000, s) }); ac.abort();
  await assert.rejects(q, (e) => isAbort(e), 'stop aborts the select');
  await assert.rejects(select(undefined, { bad: async () => { throw new Error('boom'); }, timer: (s) => sleep(1000, s) }), /boom/, 'an arm that throws rejects the select');
});

test('sleep resolves TIMEOUT and honours the signal', async () => {
  assert.equal(await sleep(5), TIMEOUT);
  const ac = new AbortController(); const p = sleep(1000, ac.signal); ac.abort(); await assert.rejects(p, (e) => isAbort(e));
});
