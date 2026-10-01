// BatRay by ClearEvo.com - the ownership gate: every flow that writes shared state after an await must check a
// token (link-logic), and every *-logic.js module stays free of browser APIs (tests)
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
// Owner's rule (2026-10-01, after the 12:55 viewer log): "after an await, the first line re-checks ownership, and
// the check is a pure decision". This file is the gate for it, the way site_checks.py gates the page rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../public/batray/', import.meta.url);
const read = (f) => readFileSync(new URL(f, DIR), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');

/** The async functions and methods of a file: name + body text (house style: 2-space class methods, 0-space top level). */
function asyncFunctions(src) {
  const out = []; const re = /^( *)(?:async function (\w+)|async (\w+)\(|(\w+)\s*=\s*async)/gm; let m;
  while ((m = re.exec(src))) {
    const indent = m[1]; const name = m[2] || m[3] || m[4];
    const end = src.indexOf(`\n${indent}}`, m.index); if (end < 0) continue;
    out.push({ name, body: src.slice(m.index, end) });
  }
  return out;
}

test('every async function in the live link that opens a transport checks attempt ownership after its awaits', () => {
  const src = stripComments(read('live.js'));
  const fns = asyncFunctions(src).filter((f) => /new RTCPeerConnection\(/.test(f.body));
  assert.ok(fns.length >= 2, 'the viewer and the publisher each open a transport');
  for (const f of fns) {
    const awaits = (f.body.match(/\bawait\b/g) || []).length;
    if (/sfu\/session/.test(f.body)) {                                        // the SFU attempt: a token, re-checked after (almost) every await, the catch through the decision
      const checks = (f.body.match(/\bown\(\)/g) || []).length;
      assert.ok(/attemptOwns\(/.test(f.body), `${f.name}: no attemptOwns() - an attempt that awaited must ask whether it still owns the link`);
      assert.ok(/linkEvent\(this\.ls, 'sfu-failed'/.test(f.body), `${f.name}: the catch must go through the 'sfu-failed' decision`);
      assert.ok(checks >= awaits - 3, `${f.name}: ${awaits} awaits but only ${checks} ownership checks`);
    } else {                                                                 // a direct peer: the object it made is its token, re-checked by identity after each await
      const checks = (f.body.match(/!== (p|peer)\)/g) || []).length;
      assert.ok(checks >= awaits, `${f.name}: ${awaits} awaits but only ${checks} identity re-checks (this.p2p !== p / this.peers.get(id) !== peer)`);
    }
  }
});

test('every signalling socket handler ignores an older socket (generation check)', () => {
  const src = stripComments(read('live.js'));
  const handlers = src.match(/ws\.on(open|message|error) = [^\n]*/g) || [];
  assert.equal(handlers.length, 3, 'open, message, error handlers');
  for (const h of handlers) assert.ok(/socketOwns\(this\.ss, tok\)/.test(h), `handler without a generation check: ${h.slice(0, 60)}`);
  const close = src.slice(src.indexOf('ws.onclose = '), src.indexOf('ws.onerror = '));
  assert.ok(/socketClosed\(this\.ss, tok/.test(close), 'the close handler decides through socketClosed()');
});

test('the wake lock request is announced to the state before the await (one in flight)', () => {
  const src = stripComments(read('app.js'));
  const i = src.indexOf('navigator.wakeLock.request(');
  assert.ok(i > 0);
  const before = src.slice(Math.max(0, i - 400), i);
  assert.ok(/wakeRequestStart\(wakeS\)/.test(before), 'wakeRequestStart(wakeS) must precede the request in the same function');
});

test('the shells re-check identity after a start that awaited (publisher !== pub, tv !== t)', () => {
  const src = stripComments(read('app.js'));
  assert.ok((src.match(/publisher !== pub/g) || []).length >= 2, 'beginShare re-checks the publisher after each await');
  assert.ok((src.match(/tv !== t\b/g) || []).length >= 2, 'startTv re-checks the stream after each await');
});

test('every *-logic.js module (and trend.js) is pure: no DOM, timers, storage or network', () => {
  const files = readdirSync(DIR).filter((f) => /-logic\.js$/.test(f) || f === 'trend.js');
  assert.ok(files.length >= 12, `${files.length} logic modules found`);
  const bad = /\b(document|window|navigator|localStorage|sessionStorage)\.|\bfetch\(|new (WebSocket|RTCPeerConnection|Worker|XMLHttpRequest)\(|\bset(Timeout|Interval)\(|\brequestAnimationFrame\(/;
  for (const f of files) {
    const src = stripComments(read(f));
    const m = src.match(bad);
    assert.equal(m, null, `${f} touches a browser API: ${m && m[0]} - decisions stay pure, the shell acts on them`);
  }
});
