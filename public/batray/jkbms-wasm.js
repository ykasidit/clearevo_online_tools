// BatRay by ClearEvo.com - the JK BMS parser from rust/jkbms (WebAssembly), shared with the server side
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

// Same functions and results as the JavaScript decoder they replace (test/batray_jk_parity.test.js):
// bytes go into the module's input buffer, one call, JSON comes back. NaN / Infinity come back as
// "\u0000NaN" / "\u0000Infinity" / "\u0000-Infinity" strings and are turned into numbers here.
import { WASM_B64 } from './jkbms-wasm-bytes.js';

/** @typedef {{ memory: WebAssembly.Memory, jk_in: () => number, jk_in_len: () => number, jk_out: () => number,
 *  jk_feed: (n: number) => number, jk_device: (n: number) => number, jk_settings: (n: number) => number,
 *  jk_cell: (n: number, hint: number) => number }} JkExports */

const FRAME_LEN = 300;
const NO_HINT = -2147483648;
const PIECE = 2048;     // feed at most this much new data per call (the parser's note / frame lists are fixed size)

const bytes = Uint8Array.from(atob(WASM_B64), (c) => c.charCodeAt(0));
const { instance } = await WebAssembly.instantiate(bytes);
const ex = /** @type {JkExports} */ (/** @type {unknown} */ (instance.exports));
const IN = ex.jk_in();
const IN_LEN = ex.jk_in_len();
const OUT = ex.jk_out();
const text = new TextDecoder();

function revive(_k, v) {
  if (typeof v !== 'string' || v.charCodeAt(0) !== 0) return v;
  if (v === '\u0000NaN') return NaN;
  return v === '\u0000Infinity' ? Infinity : -Infinity;
}

function call(fn, input) {
  if (input.length > IN_LEN) throw new RangeError(`jkbms: ${input.length} bytes is more than one call takes`);
  new Uint8Array(ex.memory.buffer, IN, input.length).set(input);
  const n = fn(input.length);
  if (n === -2) throw new RangeError('jkbms: a frame is 300 bytes');
  if (n < 0) throw new Error('jkbms: result larger than the output buffer');
  return JSON.parse(text.decode(new Uint8Array(ex.memory.buffer, OUT, n)), revive);
}

function frame300(frame) {
  if (frame.length < FRAME_LEN) throw new RangeError('jkbms: a frame is 300 bytes');
  return frame.length === FRAME_LEN ? frame : frame.subarray(0, FRAME_LEN);
}

/** Frame 0x03: the non-secret device fields. */
export function decodeDeviceInfo(frame) {
  return call(ex.jk_device, frame300(frame));
}

/** Frame 0x01 (JK02). */
export function decodeSettings(frame) {
  return call(ex.jk_settings, frame300(frame));
}

/** Frame 0x02; `hint` = the firmware major version (or null). */
export function decodeCellInfo(frame, hint = null) {
  const h = hint === null || hint === undefined ? NO_HINT : hint;
  return call((n) => ex.jk_cell(n, h), frame300(frame));
}

/** Framing: the kept bytes + a new notification -> the verified 300-byte frames, notes, the bytes to keep. */
export function feedFrames(buf, chunk) {
  const frames = [];
  const notes = [];
  let kept = buf;
  for (let at = 0; at === 0 || at < chunk.length; at += PIECE) {
    const piece = chunk.subarray(at, at + PIECE);
    const merged = new Uint8Array(kept.length + piece.length);
    merged.set(kept);
    merged.set(piece, kept.length);
    const r = call(ex.jk_feed, merged);
    for (const o of r.frames) frames.push(merged.slice(o, o + FRAME_LEN));
    for (const t of r.notes) notes.push(t);
    kept = merged.slice(r.rest);
  }
  return { buf: kept, frames, notes };
}
