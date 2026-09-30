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
import { tvUiState, tvTapDecision, tvCloseDecision, tvStartDecision, tvStarted, tvStartFailed, tvStopped, tvButtons, tvPreviewWanted, BoxSplitter, takeSegments, tvLink, isSegmentStart , tvPreviewToggle , tvMp4Link, previewState, previewEvent, previewSource, PREVIEW_GRACE_MS } from '../public/batray/tv-logic.js';
import { TvStream } from '../public/batray/tv.js';
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
  assert.equal(tvMp4Link('https://www.clearevo.com', 'abc'), 'https://www.clearevo.com/batray/api/tv/abc/stream.mp4');
  assert.ok(isSegmentStart(0, 1, 4) && !isSegmentStart(3, 1, 4) && isSegmentStart(4, 1, 4) && isSegmentStart(8, 2, 4) && !isSegmentStart(7, 2, 4));
});

test('Show on TV button: opens and closes the card; sunk while streaming; pressing it, or Close, then stops the stream', () => {
  const ts = tvUiState();
  assert.deepEqual(tvTapDecision(ts), { action: 'open-panel' }); assert.equal(tvButtons(ts).panelHidden, false);
  assert.deepEqual(tvTapDecision(ts), { action: 'close-panel' }); assert.equal(tvButtons(ts).panelHidden, true);
  tvTapDecision(ts);
  assert.deepEqual(tvStartDecision(ts), { action: 'start' });
  assert.deepEqual(tvStartDecision(ts), { action: 'ignore', why: 'starting' });
  let b = tvButtons(ts); assert.equal(b.on, false); assert.equal(b.busy, true); assert.equal(b.startDisabled, true); assert.equal(b.resDisabled, true);
  assert.deepEqual(tvTapDecision(ts), { action: 'cancel', why: 'starting' }); assert.equal(ts.phase, 'off');   // the busy button is a cancel
  tvStartDecision(ts);
  tvStarted(ts);
  b = tvButtons(ts);
  assert.deepEqual(b, { on: true, busy: false, startHidden: true, startDisabled: false, stopHidden: false, resDisabled: true, liveHidden: false, noteHidden: false, panelHidden: false });
  assert.deepEqual(tvTapDecision(ts), { action: 'stop', why: 'toolbar' });
  tvStopped(ts); assert.equal(tvButtons(ts).on, false); assert.equal(tvButtons(ts).stopHidden, true);
  tvStartDecision(ts); tvStarted(ts);
  assert.deepEqual(tvCloseDecision(ts), { action: 'stop', why: 'close' });
  tvStopped(ts); assert.equal(tvButtons(ts).panelHidden, true);
  tvStartDecision(ts); tvStartFailed(ts); assert.equal(ts.phase, 'off');
  assert.deepEqual(tvCloseDecision(ts), { action: 'close-panel' });
});

test('the preview waits for three segments and is started once', () => {
  assert.equal(tvPreviewWanted({ segs: 2 }, true, false), false);
  assert.equal(tvPreviewWanted({ segs: 3 }, true, false), true);
  assert.equal(tvPreviewWanted({ segs: 3 }, true, true), false);
  assert.equal(tvPreviewWanted({ segs: 9 }, false, false), false);
});

test('tvPreviewToggle: collapsing the TV card unloads a running preview, expanding loads it again; no stream, nothing', () => {
  assert.equal(tvPreviewToggle(false, true, true), 'unload');
  assert.equal(tvPreviewToggle(false, true, false), 'none');
  assert.equal(tvPreviewToggle(true, true, false), 'load');
  assert.equal(tvPreviewToggle(true, true, true), 'none', 'already showing');
  assert.equal(tvPreviewToggle(true, false, false), 'none', 'no stream to preview');
});

test('the local preview never goes blank (owner 2026-09-30): the stream player shows only while it really plays, a short stall is tolerated, an error or an unload falls back to the frame drawn on the phone; no HLS support = always local', () => {
  const ps = previewState();
  assert.equal(previewSource(ps, true, 0), 'local', 'before the player starts');
  assert.equal(previewSource(ps, false, 0), 'local', 'desktop: no HLS');
  previewEvent(ps, 'playing', 1000); assert.equal(previewSource(ps, true, 1000), 'video');
  assert.equal(previewSource(ps, false, 1000), 'local', 'a browser without HLS never shows the video');
  previewEvent(ps, 'waiting', 5000); assert.equal(previewSource(ps, true, 6000), 'video', 'a rebuffer inside the grace keeps the video');
  assert.equal(previewSource(ps, true, 5000 + PREVIEW_GRACE_MS), 'local', 'a stall past the grace shows the local frame');
  previewEvent(ps, 'playing', 9000); assert.equal(previewSource(ps, true, 30000), 'video');
  previewEvent(ps, 'error', 31000); assert.equal(previewSource(ps, true, 31000), 'local');
  previewEvent(ps, 'playing', 32000); previewEvent(ps, 'unload', 33000); assert.equal(previewSource(ps, true, 33000), 'local');
  assert.equal(PREVIEW_GRACE_MS, 3000);
});

test('TvStream revives a stream the relay dropped (0.9.50, replay of the 2026-09-29 log: 10k 404s after a Wi-Fi gap): a 404/409 on a segment sends init.mp4 again on the same id, segments queued meanwhile are skipped, the error is logged once with a repeat count', async () => {
  const lines = []; const calls = [];
  const t = new TvStream({ log: (l) => lines.push(l) });
  t.id = 'tvid'; t.token = 'tok'; t.initBytes = new Uint8Array([1, 2, 3, 4]); t.initSent = true;
  const settle = async () => { let c; do { c = t.chain; await c; } while (c !== t.chain); };   // the revival appends to the chain while a step runs
  let status = 404;
  globalThis.fetch = async (url, init) => { const p = String(url).replace(/^.*\/tv\/tvid\//, '').replace(/\?.*$/, ''); calls.push(p); if (p === 'init.mp4') return { ok: true, status: 200 }; return { ok: status === 200, status }; };
  t.upload('seg/7', new Uint8Array([7]), '&dur=1.000'); t.upload('seg/8', new Uint8Array([8]), '&dur=1.000');   // 8 was queued before the 404 came back
  await settle();
  assert.deepEqual(calls, ['seg/7', 'init.mp4'], 'the 404 triggers init again; the queued segment 8 is skipped, not sent into the dead stream');
  assert.equal(t.state.episodes, 1); assert.equal(t.state.segs, 0); assert.equal(t.reviving, false);
  assert.ok(lines.some((l) => /relay dropped the stream \(seg\/7: 404\) - sending the init segment again, same link \(revival 1\)/.test(l)), lines.join('\n'));
  status = 200; calls.length = 0;
  t.upload('seg/9', new Uint8Array([9]), '&dur=1.000'); await settle();
  assert.deepEqual(calls, ['seg/9']); assert.equal(t.state.segs, 1); assert.equal(t.state.error, null);
  // errors are logged when they change, plus one repeat count when they stop
  status = 500; lines.length = 0;
  for (let i = 0; i < 4; i++) t.upload(`seg/${10 + i}`, new Uint8Array([1]), '&dur=1.000');
  await settle();
  assert.equal(lines.filter((l) => /upload failed/.test(l)).length, 4, 'four different paths = four lines');
  t.uploadFailed('x'); t.uploadFailed('x'); t.uploadFailed('x'); lines.length = 0; t.uploadOk();
  assert.deepEqual(lines, ['tv: (that upload error repeated 2 more times)', 'tv: uploads ok again']);
  delete globalThis.fetch;
});
