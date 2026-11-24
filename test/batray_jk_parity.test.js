// BatRay by ClearEvo.com - tests: the Rust JK parser (WebAssembly) against the JavaScript decoder it replaced
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

// Every real frame and thousands of mutated ones through both decoders: the results must be equal
// value for value (NaN and -0 included: deepStrictEqual compares with Object.is), and framing over
// randomly chunked streams with junk, ACKs, bad checksums and splices must find the same frames,
// notes and kept bytes after every chunk. The wasm must be built from the current Rust sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import * as O from './batray_jk_oracle.js';
import * as W from '../public/batray/jkbms-wasm.js';
import * as F from './batray_frames.js';
import * as J from '../public/batray/jkbms.js';

const FRAMES = Object.entries(F).filter(([, v]) => v instanceof Uint8Array);
const HINTS = [null, undefined, 0, 3, 4, 10, 11, 14, 15, 19, -5];

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const fix = (f) => { let sum = 0; for (let i = 0; i < 299; i++) sum += f[i]; f[299] = sum & 0xff; return f; };

function same(f, why) {
  for (const h of HINTS) assert.deepStrictEqual(W.decodeCellInfo(f, h), O.decodeCellInfo(f, h), `${why} cell hint ${h}`);
  assert.deepStrictEqual(W.decodeDeviceInfo(f), O.decodeDeviceInfo(f), `${why} device`);
  assert.deepStrictEqual(W.decodeSettings(f), O.decodeSettings(f), `${why} settings`);
}

test('the wasm was built from the current Rust sources (run rust/jkbms/build_wasm.sh after a change)', () => {
  const dir = new URL('../rust/jkbms/', import.meta.url);
  const src = readdirSync(new URL('src/', dir)).filter((f) => f.endsWith('.rs')).sort();
  const h = createHash('sha256');
  h.update(readFileSync(new URL('Cargo.toml', dir)));
  for (const f of src) h.update(readFileSync(new URL(`src/${f}`, dir)));
  assert.equal(h.digest('hex'), readFileSync(new URL('wasm.sha256', dir), 'utf8').trim());
});

test('every real frame decodes the same in Rust and in JavaScript, with every hint', () => {
  for (const [name, f] of FRAMES) same(f, name);
});

test('mutated frames (random bytes, absent temps, masks, floats NaN / Inf / -0, extremes) decode the same', () => {
  const r = rng(20261124);
  let n = 0;
  for (const [name, base] of FRAMES) {
    for (let k = 0; k < 120; k++) {
      const f = base.slice();
      for (let j = 1 + Math.floor(r() * 8); j > 0; j--) f[Math.floor(r() * 300)] = Math.floor(r() * 256);
      same(f, `${name} random ${k}`);
      n++;
    }
    const dv = (f) => new DataView(f.buffer);
    const t = base.slice(); for (const o of [130, 132, 134, 144, 162, 164, 254, 256, 258]) dv(t).setInt16(o, -2000, true); same(t, `${name} temps absent`);
    const m = base.slice(); dv(m).setUint32(54, 0, true); dv(m).setUint32(70, 0xffffffff, true); same(m, `${name} masks`);
    for (const val of [NaN, Infinity, -Infinity, -0, 0.5, 5, 1e-40, 3.4e38]) {
      const g = base.slice();
      for (const o of [6, 10, 102, 106, 202, 206, 222]) dv(g).setFloat32(o, val, true);
      same(g, `${name} floats ${val}`);
    }
    const s = base.slice(); s[141] = 101; s[173] = 255; dv(s).setInt32(126, -2147483648, true); dv(s).setInt32(158, 2000000, true); same(s, `${name} extremes`);
    n += 12;
  }
  for (const fill of [0, 0xff, 0x7f, 0x80]) same(new Uint8Array(300).fill(fill), `fill ${fill}`);
  for (let k = 0; k < 200; k++) same(Uint8Array.from({ length: 300 }, () => Math.floor(r() * 256)), `noise ${k}`);
  const txt = F.AIO_PB15_DEV.slice();
  const bad = [0xff, 0xc3, 0x28, 0xe2, 0x82, 0x20, 0xc2, 0xa0, 0xef, 0xbb, 0xbf, 0x0d, 0x0a, 0x09, 0x41, 0xf0];
  for (const o of [6, 22, 30, 46, 78, 86, 102]) txt.set(bad, o);
  same(txt, 'text fields: bad UTF-8, NBSP, BOM, CR LF, tab');
  assert.ok(n > 2000);
});

test('framing over chunked streams with junk, ACKs, bad checksums and splices: same frames, notes and kept bytes', () => {
  const r = rng(7);
  const ACK = Uint8Array.from([0xaa, 0x55, 0x90, 0xeb, 0xc8, 0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x44]);
  const AT = Uint8Array.from([0x41, 0x54, 0x0d, 0x0a]);
  const HDR = Uint8Array.from([0x55, 0xaa, 0xeb, 0x90]);
  for (let round = 0; round < 150; round++) {
    const parts = [];
    for (let k = 0; k < 12; k++) {
      const pick = r();
      const f = FRAMES[Math.floor(r() * FRAMES.length)][1].slice();
      if (pick < 0.5) parts.push(f);
      else if (pick < 0.6) parts.push(ACK);
      else if (pick < 0.7) parts.push(AT);
      else if (pick < 0.75) parts.push(HDR);
      else if (pick < 0.85) { f[Math.floor(r() * 300)] ^= 0x5a; parts.push(f); }
      else if (pick < 0.9) { const g = f.slice(0, 150); const sp = new Uint8Array(300); sp.set(g); sp.set(f.slice(0, 150), 150); parts.push(fix(sp)); }
      else if (pick < 0.95) { f[4] = 0x07; parts.push(fix(f)); }
      else parts.push(Uint8Array.from({ length: Math.floor(r() * 40) }, () => Math.floor(r() * 256)));
    }
    const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let at = 0; for (const p of parts) { all.set(p, at); at += p.length; }
    let bo = new Uint8Array(0), bw = new Uint8Array(0);
    for (let i = 0; i < all.length;) {
      const n = r() < 0.1 ? 0 : 1 + Math.floor(r() * (r() < 0.2 ? 3000 : 300));
      const chunk = all.subarray(i, i + n);
      const a = O.feedFrames(bo, chunk), b = W.feedFrames(bw, chunk);
      assert.deepStrictEqual(b.frames.map((x) => Array.from(x)), a.frames.map((x) => Array.from(x)), `round ${round} at ${i}: frames`);
      assert.deepStrictEqual(b.notes, a.notes, `round ${round} at ${i}: notes`);
      assert.deepStrictEqual(Array.from(b.buf), Array.from(a.buf), `round ${round} at ${i}: kept bytes`);
      bo = a.buf; bw = b.buf;
      i += Math.max(n, 1);
    }
  }
});

test('frames shorter than 300 bytes are refused (the JavaScript decoder read past their end)', () => {
  assert.throws(() => W.decodeCellInfo(F.OWNER_32S_CELL.subarray(0, 299)), RangeError);
  assert.throws(() => W.decodeDeviceInfo(new Uint8Array(10)), RangeError);
  const long = new Uint8Array(400); long.set(F.OWNER_32S_CELL);
  assert.deepStrictEqual(W.decodeCellInfo(long), O.decodeCellInfo(F.OWNER_32S_CELL), 'a longer buffer: its first 300 bytes');
});

test('the tables JavaScript still keeps (alarm labels, command frames) match the Rust ones', () => {
  const rs = readFileSync(new URL('../rust/jkbms/src/lib.rs', import.meta.url), 'utf8');
  const block = rs.slice(rs.indexOf('pub const ERROR_BITS'), rs.indexOf('];', rs.indexOf('pub const ERROR_BITS')));
  assert.deepStrictEqual([...block.matchAll(/"([^"]*)"/g)].map((m) => m[1]), J.ERROR_BITS);
  assert.deepStrictEqual(J.ERROR_BITS, O.ERROR_BITS);
  for (const c of [0x96, 0x97]) for (const v of [0, 1, 0x01020304, 0xffffffff]) assert.deepStrictEqual(J.buildCommand(c, v), O.buildCommand(c, v));
  assert.equal(J.decodeCellInfo, W.decodeCellInfo, 'jkbms.js hands out the wasm decoder');
  assert.equal(J.feedFrames, W.feedFrames);
});
