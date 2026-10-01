// BatRay by ClearEvo.com - latches, channels, sleep and select: the only way a platform callback talks to a
// lifecycle loop (the house rule, owner 2026-10-01)
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
// THE HOUSE RULE. A thing with a lifecycle (a link, a stream, a Bluetooth connection) is ONE async function with a
// loop: the state is the program counter, there is one writer, and every wait inside it takes the stop signal and
// a timeout. Platform callbacks (socket messages, channel open, transport state) exist only at the boundary and
// do one thing: set a Flag or push into a Channel. Nothing else is written from a callback. This is the kernel's
// kthread looping on wait_event_timeout / wait_for_completion_timeout, Go's goroutine with select over channels,
// Java's CountDownLatch.await(timeout) - and it replaced the event-dispatch machine plus ownership token that the
// 2026-09-30 race needed (two writers of one state; a loop has one).

export const abortError = () => { const e = new Error('aborted'); e.name = 'AbortError'; return e; };
export const isAbort = (e) => !!e && e.name === 'AbortError';
export const TIMEOUT = 'timeout';

/** Wait on a list of wakers with an optional deadline and stop signal. Resolves `value` when woken, TIMEOUT after
 *  ms, rejects AbortError on the signal. The waker is removed whichever way it ends.
 *  @param {Function[]} wakers @param {{ ms?: number, signal?: AbortSignal }} [opts] @param {string} [value] */
function waitOn(wakers, { ms, signal } = {}, value = 'set') {
  return new Promise((res, rej) => {
    if (signal && signal.aborted) { rej(abortError()); return; }
    let timer = null;
    const end = (fn) => { const i = wakers.indexOf(wake); if (i >= 0) wakers.splice(i, 1); if (timer) clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); fn(); };
    const wake = () => end(() => res(value));
    const onAbort = () => end(() => rej(abortError()));
    wakers.push(wake);
    if (ms !== undefined && ms !== null) timer = setTimeout(() => end(() => res(TIMEOUT)), ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** A level (true/false) you can wait for. set() wakes everyone waiting for that value; a wait for the current value
 *  returns at once, so nothing is lost between a callback and the loop (the kernel's completion, not a bare event). */
export class Flag {
  constructor(v = false) { this.v = v; this.w = []; }
  set(v) { if (this.v === v) return; this.v = v; const w = this.w; this.w = []; for (const f of w) f(); }
  wait(v, opts = {}) { return this.v === v ? (opts.signal && opts.signal.aborted ? Promise.reject(abortError()) : Promise.resolve('set')) : waitOn(this.w, opts, 'set'); }
}

/** A queue: a callback pushes, the loop awaits next(). Items pushed while nobody waits are kept. */
export class Channel {
  constructor() { this.q = []; this.w = []; }
  push(x) { this.q.push(x); const w = this.w; this.w = []; for (const f of w) f(); }
  get size() { return this.q.length; }
  async next(opts = {}) {
    while (!this.q.length) { const r = await waitOn(this.w, opts, 'item'); if (r === TIMEOUT) return TIMEOUT; }
    return this.q.shift();
  }
}

/** Resolves TIMEOUT after ms; rejects AbortError on the signal. */
export const sleep = (ms, signal) => waitOn([], { ms, signal }, TIMEOUT);

/** Go's select: arms are { name: (signal) => Promise }. Resolves { key, value } of the first arm to settle and
 *  aborts the others through the signal they were given; rejects when the outer signal aborts or an arm throws. */
export async function select(signal, arms) {
  if (signal && signal.aborted) throw abortError();
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race(Object.entries(arms).map(([key, f]) => Promise.resolve().then(() => f(ac.signal)).then((value) => ({ key, value }))));
  } finally { ac.abort(); if (signal) signal.removeEventListener('abort', onAbort); }
}
