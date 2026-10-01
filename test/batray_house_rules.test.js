// BatRay by ClearEvo.com - the house rules as a gate: lifecycles are loops, callbacks only set flags, waits carry
// the stop signal, logic modules stay pure; everything else is a ratchet with a listed reason (tests)
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
// Owner's rules (2026-10-01): reduce entropy. A thing with a lifecycle is ONE async function with a loop (the state
// is the program counter, one writer); every wait in it takes the stop signal; platform callbacks only set a Flag
// or push into a Channel; `await` everywhere else, no `.then` chains, no hand-rolled Promises where sync.js has the
// primitive. Exceptions are listed here per file with a reason and a ceiling, so a new one fails the build until
// it is either converted or written down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../public/batray/', import.meta.url);
const read = (f) => readFileSync(new URL(f, DIR), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
const count = (s, re) => (s.match(re) || []).length;

// the first-party I/O shells (logic modules are checked for purity below; vendored files are not ours)
const SHELLS = ['app.js', 'live.js', 'tv.js', 'jkbms.js', 'history.js', 'history-worker.js', 'history-chart.js', 'alerts.js', 'demo.js'];

// `.then(` chains: the ceiling per file and why they are still there (round 2/3 of the conversion)
const THEN_CEILING = {
  'app.js': [5, 'rollover -> maintain, span read, two sheet results, init chain: the app shell is round 3'],
  'tv.js': [1, 'the upload chain (a serialised queue): round 2 makes it a Channel loop'],
  'history-worker.js': [1, 'the OPFS directory handle memo'],
  'alerts.js': [3, 'two fan-out sends with per-channel results, the service-worker registration lookup'],
};
// async callbacks (an `async (` after =, comma or paren): a callback that awaits is a lifecycle in disguise
const ASYNC_CB_CEILING = {
  'app.js': [14, 'button and sheet handlers in the app shell: round 3'],
  'live.js': [1, 'the j() fetch helper is an async arrow, not a callback'],
  'tv.js': [2, 'the j() helper and the upload chain step (round 2)'],
  'jkbms.js': [1, 'the connect attempt body is an IIFE awaited by connect()'],
  'history.js': [1, 'the reopen IIFE awaited by every call'],
  'history-worker.js': [2, 'the init IIFE and the worker onmessage (one handler per op, a dispatcher)'],
  'alerts.js': [3, 'three settings handlers that await a send'],
};
// hand-rolled `new Promise(`: sync.js has Flag / Channel / sleep / select; what remains wraps a platform event
const PROMISE_CEILING = {
  'app.js': [8, 'rAF, file reads, sheet results, timers in the app shell: round 3'],
  'live.js': [2, 'waitConnected / waitOpen: adapters from RTCPeerConnection and RTCDataChannel events (they take the signal)'],
  'jkbms.js': [2, 'GATT connect timeout and the handshake wait'],
  'history.js': [2, 'the worker reply wait with its deadline, the pool reopen'],
  'history-worker.js': [2, 'the sync access handle waits'],
};

test('lifecycle loops: each link class has exactly one run(signal), start() refuses a second loop, stop() aborts it', () => {
  const src = strip(read('live.js'));
  const classes = src.split(/^export class /m).slice(1);
  const withLoops = classes.filter((c) => /async run\(signal\)/.test(c));
  assert.equal(withLoops.length, 2, 'Publisher and Viewer are loops');
  for (const c of withLoops) {
    const name = c.split(/\s/)[0];
    assert.equal(count(c, /async run\(signal\)/g), 1, `${name}: one run()`);
    assert.ok(/if \(this\.task\) return/.test(c), `${name}: start() must refuse a second loop (one owner)`);
    assert.ok(/this\.task = this\.run\(this\.ac\.signal\)/.test(c), `${name}: start() launches run() under an AbortController`);
    assert.ok(/this\.ac\.abort\(\)/.test(c), `${name}: stop() aborts the loop`);
    assert.ok(/isAbort\(e\)\) throw e/.test(c), `${name}: the loop lets the stop signal through its catch`);
  }
  assert.ok(!/attemptOwns|linkEvent\(/.test(src), 'the ownership token and the event machine are gone: the loop is the owner');
});

test('every wait in the live link takes the stop signal', () => {
  const src = strip(read('live.js'));
  const calls = src.match(/\b(sleep|select|waitOpen|waitConnected|connectTransport)\([^;]*?\)|\.(wait|next)\(\{?[^;]*?\)/g) || [];
  assert.ok(calls.length >= 15, `found ${calls.length} waits`);
  for (const c of calls) assert.ok(/\bsignal\b|\(s\)|, s\)|: s \}/.test(c), `a wait without the stop signal: ${c.slice(0, 80)}`);
});

test('callbacks at the platform boundary only set a flag, push a channel, log or drop - never the loop\'s state', () => {
  const src = strip(read('live.js'));
  const lines = src.split('\n').filter((l) => /\.on[a-z]+ = |addEventListener\(/.test(l));
  assert.ok(lines.length >= 10);
  for (const l of lines) assert.ok(!/state\.(live|error|path|retryIn)\b/.test(l), `a callback writes the loop's state: ${l.trim().slice(0, 100)}`);
});

test('ratchet: .then( chains, async callbacks and hand-rolled Promises do not grow beyond the listed exceptions', () => {
  for (const f of SHELLS) {
    const src = strip(read(f));
    const checks = [['.then(', count(src, /\.then\(/g), THEN_CEILING], ['async callback', count(src, /(=|,|\()\s*async\s*\(/g), ASYNC_CB_CEILING], ['new Promise(', count(src, /new Promise\(/g), PROMISE_CEILING]];
    for (const [what, n, table] of checks) {
      const [ceiling, why] = table[f] || [0, 'none listed'];
      assert.ok(n <= ceiling, `${f}: ${n} x ${what}, ceiling ${ceiling} (${why}) - convert it to await / a sync.js primitive, or list it here with a reason`);
    }
  }
});

test('the shells re-check identity after a start that awaited (publisher !== pub, tv !== t) until those flows are loops (round 3)', () => {
  const src = strip(read('app.js'));
  assert.ok(count(src, /publisher !== pub/g) >= 2); assert.ok(count(src, /tv !== t\b/g) >= 2);
});

test('the wake lock request is announced to the state before the await (one in flight)', () => {
  const src = strip(read('app.js'));
  const i = src.indexOf('navigator.wakeLock.request('); assert.ok(i > 0);
  assert.ok(/wakeRequestStart\(wakeS\)/.test(src.slice(Math.max(0, i - 400), i)), 'wakeRequestStart(wakeS) must precede the request in the same function');
});

test('every *-logic.js module (and trend.js) is pure: no DOM, timers, storage or network; sync.js owns the timers', () => {
  const files = readdirSync(DIR).filter((f) => /-logic\.js$/.test(f) || f === 'trend.js');
  assert.ok(files.length >= 12, `${files.length} logic modules found`);
  const bad = /\b(document|window|navigator|localStorage|sessionStorage)\.|\bfetch\(|new (WebSocket|RTCPeerConnection|Worker|XMLHttpRequest)\(|\bset(Timeout|Interval)\(|\brequestAnimationFrame\(/;
  for (const f of files) { const m = strip(read(f)).match(bad); assert.equal(m, null, `${f} touches a browser API: ${m && m[0]} - decisions stay pure, the shell acts on them`); }
  const sync = strip(read('sync.js'));
  assert.ok(!/\b(document|window|navigator|localStorage)\.|\bfetch\(/.test(sync), 'sync.js knows timers and signals, nothing else');
});
