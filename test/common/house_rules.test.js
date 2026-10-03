// ClearEvo online tools - the house rules as a gate for ONE tool: logic modules stay pure, lifecycles are loops over
// sync.js primitives, everything else is a ratchet with a listed reason (tests)
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
// or push into a Channel; `await` everywhere else, no `.then` chains, no hand-rolled Promises and no own timers
// where sync.js has the primitive. Exceptions are listed per file in test/rules/<tool>.mjs with a reason and a
// ceiling, so a new one fails the build until it is either converted or written down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { RULES as R, DIR } from './tool.mjs';

const read = (f) => readFileSync(`${DIR}/${f}`, 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '');
const count = (s, re) => (s.match(re) || []).length;
const H = R.house;

test(`ratchet: .then( chains, async callbacks, hand-rolled Promises and own timers in ${R.name}'s shells do not grow beyond the listed exceptions`, () => {
  for (const f of H.shells) {
    const src = strip(read(f));
    const checks = [['.then(', count(src, /\.then\(/g), H.then], ['async callback', count(src, /(=|,|\()\s*async\s*\(/g), H.asyncCb], ['new Promise(', count(src, /new Promise\(/g), H.promise], ['setTimeout/setInterval', count(src, /\bset(Timeout|Interval)\(/g), H.timers || {}]];
    for (const [what, n, table] of checks) {
      const [ceiling, why] = table[f] || [0, 'none listed'];
      assert.ok(n <= ceiling, `${f}: ${n} x ${what}, ceiling ${ceiling} (${why}) - convert it to await / a sync.js primitive, or list it in test/rules with a reason`);
    }
  }
});

test(`every logic module of ${R.name} is pure: no DOM, timers, storage or network; sync.js owns the timers`, () => {
  const files = readdirSync(DIR).filter(H.logic);
  assert.ok(files.length >= H.logicMin, `${files.length} logic modules found, expected at least ${H.logicMin}`);
  const bad = /\b(document|window|navigator|localStorage|sessionStorage)\.|\bfetch\(|new (WebSocket|RTCPeerConnection|Worker|XMLHttpRequest)\(|\bset(Timeout|Interval)\(|\brequestAnimationFrame\(/;
  for (const f of files) { const m = strip(read(f)).match(bad); assert.equal(m, null, `${f} touches a browser API: ${m && m[0]} - decisions stay pure, the shell acts on them`); }
  if (H.sync) {
    const sync = strip(read(H.sync));
    assert.ok(!/\b(document|window|navigator|localStorage)\.|\bfetch\(/.test(sync), 'sync.js knows timers and signals, nothing else');
  }
});

test(`no innerHTML built from data in ${R.name}'s shells (a crafted file must not script the page): constant markup only`, () => {
  for (const f of H.shells) {
    const lines = strip(read(f)).split('\n');
    const [ceiling, why] = (H.innerHtml || {})[f] || [0, 'none listed'];
    const hits = lines.map((l, i) => (/\.innerHTML\s*(\+?=)/.test(l) && /\$\{|\+ *[a-zA-Z_]/.test(l) ? `${f}:${i + 1} ${l.trim().slice(0, 90)}` : null)).filter(Boolean);
    assert.ok(hits.length <= ceiling, `${f}: ${hits.length} innerHTML assignments with interpolated data, ceiling ${ceiling} (${why}):\n${hits.join('\n')}`);
  }
});

if (H.custom) H.custom(test, { read, strip, count });
