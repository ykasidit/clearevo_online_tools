// BatRay by ClearEvo.com - Show on TV pure logic: fMP4 box splitting into HLS segments, links (tested)
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

// The muxer writes one byte stream - ftyp, moov, then moof+mdat pairs - but
// not strictly forward: it seeks back to patch a box header or a moof after
// its samples are written, all synchronously inside the call that closed the
// fragment. So the splitter is a positioned buffer, and the app takes segments
// only after such a call returned (a key chunk was added, or finalize ran).
// HLS wants ftyp+moov as the init segment and each moof+mdat as a media segment.

const ascii = (u8, at) => String.fromCharCode(u8[at], u8[at + 1], u8[at + 2], u8[at + 3]);

export class BoxSplitter {
  constructor() { this.buf = new Uint8Array(1 << 16); this.len = 0; this.base = 0; }
  /** A write at an absolute file position (the muxer's StreamTarget onData). */
  push(u8, position = this.base + this.len) {
    if (!(u8 instanceof Uint8Array)) u8 = new Uint8Array(u8);
    if (position < this.base) throw new Error(`write at ${position} below consumed data (${this.base})`);
    const off = position - this.base, need = off + u8.length;
    if (need > this.buf.length) { const n = new Uint8Array(Math.max(need, this.buf.length * 2)); n.set(this.buf.subarray(0, this.len)); this.buf = n; }
    this.buf.set(u8, off);
    this.len = Math.max(this.len, need);
  }
  /** Complete boxes from the front of the buffer: [{ type, start, end }]. */
  scan() {
    const out = []; let at = 0;
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    while (at + 8 <= this.len) {
      let size = dv.getUint32(at), head = 8;
      const type = ascii(this.buf, at + 4);
      if (size === 1) { if (at + 16 > this.len) break; size = Number(dv.getBigUint64(at + 8)); head = 16; }
      if (size === 0 || size < head) throw new Error(`bad box size ${size} for ${type}`);
      if (at + size > this.len) break;
      out.push({ type, start: at, end: at + size });
      at += size;
    }
    return out;
  }
  /** Drop the first n bytes (they were handed out). */
  consume(n) {
    this.buf.copyWithin(0, n, this.len); this.len -= n; this.base += n;
  }
}

/** Take whatever complete segments are available: { init, segments[] }.
 *  init = ftyp+moov once (null afterwards); each segment = moof+mdat. Call
 *  only when the muxer is between fragments (see above). */
export function takeSegments(splitter) {
  const out = { init: null, segments: [] };
  for (;;) {
    const boxes = splitter.scan();
    if (!boxes.length) break;
    const b0 = boxes[0];
    if (b0.type === 'ftyp') {
      const i = boxes.findIndex((b) => b.type === 'moov');
      if (i < 0) break;
      out.init = splitter.buf.slice(0, boxes[i].end); splitter.consume(boxes[i].end);
      continue;
    }
    if (b0.type === 'moof') {
      if (boxes.length < 2) break;
      if (boxes[1].type !== 'mdat') throw new Error(`moof followed by ${boxes[1].type}`);
      out.segments.push(splitter.buf.slice(0, boxes[1].end)); splitter.consume(boxes[1].end);
      continue;
    }
    splitter.consume(b0.end);                              // free / mfra / other boxes: not part of a segment
  }
  return out;
}

/** The playlist URL a TV fetches. */
export function tvLink(origin, id) { return `${origin}/batray/api/tv/${id}/index.m3u8`; }

/** Segment boundary rule: frame k starts a new segment (key frame) every segS seconds. */
export function isSegmentStart(frame, fps, segS) { return frame % Math.max(1, Math.round(fps * segS)) === 0; }
