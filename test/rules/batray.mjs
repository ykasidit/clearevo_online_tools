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
import { readdirSync } from 'node:fs';

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
    shells: ['app.js', 'live.js', 'tv.js', 'jkbms.js', 'conn.js', 'history.js', 'history-worker.js', 'history-chart.js', 'alerts.js', 'demo.js'],
    // `.then(` chains: the ceiling per file and why they are still there (round 2/3 of the conversion)
    then: {
      'app.js': [5, 'rollover -> maintain, span read, two sheet results, init chain: the app shell is round 3'],
      'history-worker.js': [1, 'the OPFS directory handle memo'],
      'alerts.js': [3, 'two fan-out sends with per-channel results, the service-worker registration lookup'],
    },
    // async callbacks (an `async (` after =, comma or paren): a callback that awaits is a lifecycle in disguise
    asyncCb: {
      'app.js': [14, 'button and sheet handlers in the app shell: round 3'],
      'live.js': [1, 'the j() fetch helper is an async arrow, not a callback'],
      'tv.js': [1, 'the j() fetch helper is an async arrow, not a callback'],
      'history.js': [1, 'the reopen IIFE awaited by every call'],
      'history-worker.js': [2, 'the init IIFE and the worker onmessage (one handler per op, a dispatcher)'],
      'alerts.js': [3, 'three settings handlers that await a send'],
    },
    // hand-rolled `new Promise(`: sync.js has Flag / Channel / sleep / select; what remains wraps a platform event
    promise: {
      'app.js': [4, 'the cast library script load, the cast discovery wait, the sheet result, the log upload XHR: the cast flow and the sheet are the app shell\'s round 3 (they work on phones; converted one per release with a phone test)'],
      'history.js': [2, 'the worker reply wait with its deadline; the slow() test hook of the memory backend'],
      'history-worker.js': [2, 'the pool install retry wait (the worker has no sync.js import); the slow() test hook'],
    },
    // timers belong to sync.js (sleep / select); a shell that sets its own is a lifecycle written as callbacks
    timers: { 'app.js': [15, 'one-shot UI timers (toast, three blob URL revokes, two reloads after a restore / reset, copy-label reset, the reach hold), the wake lock retry and keep-awake restart, and the cast flow (library load deadline, discovery wait, sheet tick, media poll) - the wake lock and the cast flow are round 3; the periodic jobs are every() loops since 0.9.84'], 'history.js': [2, 'the per-call reply deadline; the slow() test hook'], 'history-worker.js': [2, 'the pool install retry wait; the slow() test hook'], },
    // innerHTML built with interpolated values: BatRay's are language-table strings and numbers, never a BMS string
    innerHtml: { 'alerts.js': [1, 'the settings form: language-table strings and numbers; the four strings from storage (ntfy server, topic, token, watchdog name) go through esc() - a gate below holds that'], 'app.js': [6, 'sheet and chip templates filled from T (the language table) and formatted numbers; the BMS name goes through textContent'] },
    logic: (f) => /-logic\.js$/.test(f) || f === 'trend.js',          // the pure modules
    logicMin: 12,
    sync: 'sync.js',
    // BatRay-specific gates: the lifecycle loops in live.js, the boundary callbacks, the identity re-checks
    custom(test, h) {
      test('no location: no first-party BatRay file reads a position (owner 2026-10-06: "drop all location stuff"; the site also sends Permissions-Policy geolocation=())', () => {
        const dir = new URL('../../public/batray/', import.meta.url);
        const files = readdirSync(dir).filter((f) => /\.(js|html)$/.test(f) && !['mp4-muxer.js', 'uplot.js', 'sqlite3.js', 'qrcode.js'].includes(f));
        assert.ok(files.includes('app.js') && files.includes('index.html'), files.join(' '));
        for (const f of files) {
          const src = h.strip(h.read(f));
          assert.ok(!/navigator\.geolocation|getCurrentPosition|watchPosition|['"]geolocation['"]/.test(src), `${f}: reads a position`);
          assert.ok(!/location-logic/.test(src), `${f}: imports the removed location module`);
        }
      });
      test('the Bluetooth connection is ONE loop per pack (0.9.83): conn.js is its only writer, app.js only tells it, jkbms.js only sets Flags at the GATT boundary', () => {
        const conn = h.strip(h.read('conn.js')), app = h.strip(h.read('app.js')), bms = h.strip(h.read('jkbms.js'));
        assert.equal((conn.match(/async run\(signal\)/g) || []).length, 1, 'one run(signal)');
        assert.ok(/start\(\) \{\s*if \(this\.task !== null\) return;/.test(conn), 'start() refuses a second loop');
        assert.ok(/stop\(\) \{ if \(this\.ac\) this\.ac\.abort\(\);/.test(conn), 'stop() aborts it');
        assert.ok(!/\bcs\.\w+\s*(=[^=]|\+\+|--|[-+*]=)|\.cs\s*=[^=]/.test(app), 'app.js writes no connection state (it reads p.cs and calls p.conn.tell)');
        assert.ok(!/connAct|connEvent|watchLinks|reTimer|gapTimer|attemptTicker/.test(app), 'the event machine and its timers are gone');
        assert.ok(!/\bset(Timeout|Interval)\(|new Promise\(/.test(conn + bms), 'the loop waits through sync.js only; the port keeps no timers');
        const cb = bms.match(/addEventListener\('(gattserverdisconnected|characteristicvaluechanged)'[^\n]*/g) || [];
        assert.equal(cb.length, 2, cb.join('\n'));
        assert.ok(/down\.set\(true\)/.test(cb[0]) && !/_emit|await|this\.\w+\(/.test(cb[0].replace(/this\.down\.set\(true\)/, '')), `the disconnect callback only sets the Flag: ${cb[0]}`);
      });
      test('a channel arm of select() only waits (ready) and the loop takes the item after it won - next() inside a select loses the item whenever another arm wins the same turn (review 2026-11-01)', () => {
        for (const f of ['app.js', 'live.js', 'conn.js', 'tv.js']) {
          const src = h.strip(h.read(f));
          // every select( call through the end of its arms object (multi-line too), and every arms object built
          // beside it (`const arms = { ... }`): no arm may take from a channel
          const lines = src.split('\n'), bad = [];
          lines.forEach((l, i) => {
            if (!/\bselect\(|\barms\s*=\s*\{/.test(l)) return;
            let t = '', depth = 0, k = i;
            do { t += lines[k] + '\n'; depth += (lines[k].match(/[({]/g) || []).length - (lines[k].match(/[)}]/g) || []).length; k++; } while (k < lines.length && depth > 0 && k - i < 40);
            if (/=>\s*[\w.]*\.next\(|=>\s*this\.next\(/.test(t)) bad.push(`${f}:${i + 1} ${l.trim().slice(0, 80)}`);
          });
          assert.deepEqual(bad, [], `${f}: a Channel.next() as a select arm`);
        }
      });
      test('app.js reads the store\'s backend after `await hist.ready`, never the ready value (a store that opened on a later try was dropped for the session - Fable review 2026-11-01)', () => {
        const src = h.strip(h.read('app.js'));
        assert.ok(!/=\s*await hist\.ready/.test(src), 'a backend taken from hist.ready');
        assert.ok(/histS\.backend = hist\.backend/.test(src) && /logS\.backend = hist\.backend/.test(src), 'both inits read hist.backend');
      });
      test('alerts.js: settings strings from storage are escaped in the form (a restored settings file must not script the page - Fable review 2026-11-01)', () => {
        const src = h.strip(h.read('alerts.js'));
        assert.ok(!/value="\$\{(n|w|settings)\./.test(src), 'a settings value into markup without esc()');
        assert.ok((src.match(/value="\$\{esc\(/g) || []).length >= 4, 'server, topic, token, watchdog name escaped');
      });
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
        const calls = src.match(/\b(sleep|select)\([^;]*?\)|\.(wait|next|ready)\(\{?[^;]*?\)/g) || [];
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
      test('a hist-file envelope reaches rxChunk as its payload and only an assembled file reaches the store (viewer log 2026-10-04)', () => {
        const src = h.strip(h.read('app.js'));
        assert.ok(/if \(env\.k === 'hist-file'\) \{ rxHistFile\(env\); return; \}/.test(src));
        const fn = src.slice(src.indexOf('function rxHistFile('), src.indexOf('async function storeReceived('));
        assert.ok(/const c = env\.v \|\| \{\};/.test(fn) && /rxChunk\(histS, c\)/.test(fn) && /r\.action === 'file'\) storeReceived\(r\.file\)/.test(fn) && /r\.action === 'drop'/.test(fn), fn.slice(0, 400));
      });
      test('the wake lock request is announced to the state before the await (one in flight)', () => {
        const src = h.strip(h.read('app.js'));
        const i = src.indexOf('navigator.wakeLock.request('); assert.ok(i > 0);
        assert.ok(/wakeRequestStart\(wakeS\)/.test(src.slice(Math.max(0, i - 400), i)), 'wakeRequestStart(wakeS) must precede the request in the same function');
      });
    },
  },
};
