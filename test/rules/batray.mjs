// BatRay by ClearEvo.com - the tool's parameters for the shared static-analysis and house-rule tests (tests)
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
// Read by test/common/*.test.js through the batray_*.test.js symlinks. Ceilings are ratchets: a file may only get
// better; to lower one, convert the code, never widen the number without a reason next to it.
import assert from 'node:assert/strict';

export default {
  name: 'BatRay', dir: 'public/batray',
  vendored: ['mp4-muxer.js', 'uplot.js', 'sqlite3.js', 'qrcode.js'],
  typedSkip: ['sw.js'],                                                  // outside the tsconfig (a classic worker script)
  globals: { cast: 'readonly', chrome: 'readonly', uPlot: 'readonly', qrcode: 'readonly' },
  uiExtra: [],                                                           // paint functions beyond the shared UI_CALLEE list
  i18n: 'i18n.js',
  typecheck: {
    // TS2339 ("property does not exist") is a bug on our own objects and noise on DOM elements the checker sees as a
    // bare Element/HTMLElement: those messages are allowed by pattern
    allow2339: /on type '(HTMLElement|Element|PerformanceEntry \| \{\}|Error|\{\}|Publisher|\(p: any\) => void)'/,
    ceilings: {
      'app.js': [16, 'querySelector results typed Element, setAttribute(boolean), a Publisher field set by the app, a function used as a bag'],
      'alerts.js': [9, 'form elements read as HTMLElement'],
      'live.js': [6, 'Error with status/body, ice config literal, a Publisher hook set by the app'],
      'tv.js': [5, 'Error with code, VideoEncoderConfig literal'],
      'storage-logic.js': [15, 'default {} parameters: JSDoc types pending'],
      'sync.js': [0, ''],
    },
    mustCover: 'app.js',
  },
  house: {
    // the first-party I/O shells (logic modules are checked for purity; vendored files are not ours)
    shells: ['app.js', 'live.js', 'tv.js', 'jkbms.js', 'history.js', 'history-worker.js', 'history-chart.js', 'alerts.js', 'demo.js'],
    // `.then(` chains: the ceiling per file and why they are still there (round 2/3 of the conversion)
    then: {
      'app.js': [5, 'rollover -> maintain, span read, two sheet results, init chain: the app shell is round 3'],
      'tv.js': [1, 'the upload chain (a serialised queue): round 2 makes it a Channel loop'],
      'history-worker.js': [1, 'the OPFS directory handle memo'],
      'alerts.js': [3, 'two fan-out sends with per-channel results, the service-worker registration lookup'],
    },
    // async callbacks (an `async (` after =, comma or paren): a callback that awaits is a lifecycle in disguise
    asyncCb: {
      'app.js': [14, 'button and sheet handlers in the app shell: round 3'],
      'live.js': [1, 'the j() fetch helper is an async arrow, not a callback'],
      'tv.js': [2, 'the j() helper and the upload chain step (round 2)'],
      'jkbms.js': [1, 'the connect attempt body is an IIFE awaited by connect()'],
      'history.js': [1, 'the reopen IIFE awaited by every call'],
      'history-worker.js': [2, 'the init IIFE and the worker onmessage (one handler per op, a dispatcher)'],
      'alerts.js': [3, 'three settings handlers that await a send'],
    },
    // hand-rolled `new Promise(`: sync.js has Flag / Channel / sleep / select; what remains wraps a platform event
    promise: {
      'app.js': [8, 'rAF, file reads, sheet results, timers in the app shell: round 3'],
      'jkbms.js': [2, 'GATT connect timeout and the handshake wait'],
      'history.js': [2, 'the worker reply wait with its deadline, the pool reopen'],
      'history-worker.js': [2, 'the sync access handle waits'],
    },
    // timers belong to sync.js (sleep / select); a shell that sets its own is a lifecycle written as callbacks
    timers: { 'app.js': [32, 'the app shell: round 3'], 'tv.js': [2, 'encoder cadence and upload retry: round 2'], 'jkbms.js': [3, 'GATT attempt pacing and the silence nudge'], 'history.js': [2, 'the per-call deadline and restart pacing'], 'history-worker.js': [2, 'pool retry pacing'], 'alerts.js': [1, 'the evaluator tick'] },
    // innerHTML built with interpolated values: BatRay's are language-table strings and numbers, never a BMS string
    innerHtml: { 'app.js': [6, 'sheet and chip templates filled from T (the language table) and formatted numbers; the BMS name goes through textContent'] },
    logic: (f) => /-logic\.js$/.test(f) || f === 'trend.js',          // the pure modules
    logicMin: 12,
    sync: 'sync.js',
    // BatRay-specific gates: the lifecycle loops in live.js, the boundary callbacks, the identity re-checks
    custom(test, h) {
      test('lifecycle loops: each link class has exactly one run(signal), start() refuses a second loop, stop() aborts it', () => {
        const src = h.strip(h.read('live.js'));
        const classes = src.split(/^export class /m).slice(1);
        const withLoops = classes.filter((c) => /async run\(signal\)/.test(c));
        assert.equal(withLoops.length, 2, 'Publisher and Viewer are loops');
        for (const c of withLoops) {
          const name = c.split(/\s/)[0];
          assert.equal(h.count(c, /async run\(signal\)/g), 1, `${name}: one run()`);
          assert.ok(/if \(this\.task !== null\) return/.test(c), `${name}: start() must refuse a second loop (one owner)`);
          assert.ok(/this\.task = this\.run\(this\.ac\.signal\)/.test(c), `${name}: start() launches run() under an AbortController`);
          assert.ok(/this\.ac\.abort\(\)/.test(c), `${name}: stop() aborts the loop`);
          assert.ok(/isAbort\(e\)\) throw e/.test(c), `${name}: the loop lets the stop signal through its catch`);
        }
        assert.ok(!/attemptOwns|linkEvent\(|RTCPeerConnection|connectSfu|offerP2P/.test(src), 'the ownership token, the event machine and the WebRTC transports are gone: one socket loop is the owner');
      });
      test('every wait in the live link takes the stop signal', () => {
        const src = h.strip(h.read('live.js'));
        const calls = src.match(/\b(sleep|select)\([^;]*?\)|\.(wait|next)\(\{?[^;]*?\)/g) || [];
        assert.ok(calls.length >= 12, `found ${calls.length} waits`);
        for (const c of calls) assert.ok(/\bsignal\b|\(s\)|, s\)|: s \}/.test(c), `a wait without the stop signal: ${c.slice(0, 80)}`);
      });
      test('callbacks at the platform boundary only set a flag, push a channel, log or drop - never the loop\'s state', () => {
        const src = h.strip(h.read('live.js'));
        const lines = src.split('\n').filter((l) => /\.on[a-z]+ = |addEventListener\(/.test(l));
        assert.ok(lines.length >= 5, `${lines.length} boundary callbacks (the socket's four and the two net listeners)`);
        for (const l of lines) assert.ok(!/state\.(live|error|path|retryIn)\b/.test(l), `a callback writes the loop's state: ${l.trim().slice(0, 100)}`);
      });
      test('the shells re-check identity after a start that awaited (publisher !== pub, tv !== t) until those flows are loops (round 3)', () => {
        const src = h.strip(h.read('app.js'));
        assert.ok(h.count(src, /publisher !== pub/g) >= 2); assert.ok(h.count(src, /tv !== t\b/g) >= 2);
      });
      test('the wake lock request is announced to the state before the await (one in flight)', () => {
        const src = h.strip(h.read('app.js'));
        const i = src.indexOf('navigator.wakeLock.request('); assert.ok(i > 0);
        assert.ok(/wakeRequestStart\(wakeS\)/.test(src.slice(Math.max(0, i - 400), i)), 'wakeRequestStart(wakeS) must precede the request in the same function');
      });
    },
  },
};
