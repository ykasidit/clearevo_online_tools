// BatRay by ClearEvo.com - tests (batray_tv.test.js)
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
import { BoxSplitter, takeSegments, tvLink, isSegmentStart } from '../public/batray/tv-logic.js';
import { Muxer, StreamTarget } from '../public/batray/mp4-muxer.js';

const box = (type, payload = []) => { const n = 8 + payload.length; const u = new Uint8Array(n); new DataView(u.buffer).setUint32(0, n); u.set([...type].map((c) => c.charCodeAt(0)), 4); u.set(payload, 8); return u; };

test('BoxSplitter is a positioned buffer: split writes, 64-bit sizes, and a patch that seeks back', () => {
  const s = new BoxSplitter();
  const a = box('ftyp', [1, 2, 3, 4]), b = box('moov', new Array(20).fill(9));
  const all = new Uint8Array(a.length + b.length); all.set(a); all.set(b, a.length);
  s.push(all.subarray(0, 5), 0); assert.equal(s.scan().length, 0);
  s.push(all.subarray(5, 13), 5); assert.equal(s.scan().length, 1); assert.equal(s.scan()[0].type, 'ftyp');
  s.push(all.subarray(13), 13); assert.equal(s.scan().length, 2); assert.equal(s.scan()[1].end - s.scan()[1].start, 28);
  const big = new Uint8Array(16 + 3); new DataView(big.buffer).setUint32(0, 1); big.set([109, 100, 97, 116], 4); new DataView(big.buffer).setBigUint64(8, 19n);
  s.push(big, all.length); assert.equal(s.scan()[2].type, 'mdat'); assert.equal(s.scan()[2].end - s.scan()[2].start, 19);
  // the muxer rewrites a header it wrote earlier: the patch lands in place
  s.push(box('moov', new Array(20).fill(7)), a.length); assert.equal(s.buf[a.length + 8], 7); assert.equal(s.scan().length, 3);
  s.consume(a.length); assert.equal(s.base, a.length); assert.equal(s.scan()[0].type, 'moov');
  assert.throws(() => s.push(new Uint8Array(4), 0), /below consumed/);
  const bad = new BoxSplitter(); bad.push(box('xxxx').map((v, i) => (i === 3 ? 2 : v)), 0); assert.throws(() => bad.scan(), /bad box size/);
});

test('takeSegments: init once, then one segment per moof+mdat pair, partial pairs wait', () => {
  const s = new BoxSplitter();
  s.push(box('ftyp')); s.push(box('moov', [1]));
  s.push(box('moof', [2])); s.push(box('mdat', [3, 3]));
  s.push(box('moof', [4]));
  let r = takeSegments(s);
  assert.equal(r.init.length, 8 + 9); assert.equal(r.segments.length, 1); assert.equal(r.segments[0].length, 9 + 10);
  assert.equal(s.scan().length, 1, 'the lone moof waits for its mdat');
  s.push(box('mdat', [5]));
  r = takeSegments(s);
  assert.equal(r.init, null); assert.equal(r.segments.length, 1); assert.equal(s.len, 0);
});

test('the real muxer in fragmented mode yields an init segment and one media segment per key frame', () => {
  const s = new BoxSplitter();
  const muxer = new Muxer({ target: new StreamTarget({ onData: (d, pos) => s.push(d, pos) }), video: { codec: 'avc', width: 320, height: 180 }, fastStart: 'fragmented', minFragmentDuration: 1.5, firstTimestampBehavior: 'strict' });
  const avcC = new Uint8Array([1, 0x42, 0xE0, 0x1E, 0xFF, 0xE1, 0, 4, 0x67, 0x42, 0xE0, 0x1E, 1, 0, 2, 0x68, 0xCE]);
  const fps = 1, segS = 2;
  for (let f = 0; f < 8; f++) {
    const key = isSegmentStart(f, fps, segS);
    muxer.addVideoChunkRaw(new Uint8Array(key ? 400 : 40).fill(f), key ? 'key' : 'delta', f * 1e6, 1e6, f === 0 ? { decoderConfig: { codec: 'avc1.42E01E', description: avcC } } : undefined);
  }
  muxer.finalize();
  const r = takeSegments(s);
  assert.ok(r.init && r.init.length > 100, 'init segment present');
  assert.equal(String.fromCharCode(...r.init.subarray(4, 8)), 'ftyp');
  assert.equal(r.segments.length, 4, `8 frames at 1 fps with a key frame every 2 s = 4 segments, got ${r.segments.length}`);
  for (const seg of r.segments) { assert.equal(String.fromCharCode(...seg.subarray(4, 8)), 'moof'); }
  assert.equal(s.len, 0);
});

test('links and segment boundaries', () => {
  assert.equal(tvLink('https://www.clearevo.com', 'abc'), 'https://www.clearevo.com/batray/api/tv/abc/index.m3u8');
  assert.ok(isSegmentStart(0, 1, 4) && !isSegmentStart(3, 1, 4) && isSegmentStart(4, 1, 4) && isSegmentStart(8, 2, 4) && !isSegmentStart(7, 2, 4));
});
