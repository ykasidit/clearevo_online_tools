// ClearEvo.com Hex Editor - logic
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

// ClearEvo hex viewer/editor logic. Pure, tested.

// "DE AD be-ef, 0x01" -> Uint8Array or null on bad input
export function parseHexBytes(str) {
  const clean = str.replace(/0x/gi, '').replace(/[\s,;:-]/g, '');
  if (!clean.length || clean.length % 2 || /[^0-9a-f]/i.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

// "10110011..." (spaces ok) -> {bits: '0101...'} or null
export function parseBitString(str) {
  const clean = str.replace(/\s/g, '');
  if (!clean.length || /[^01]/.test(clean)) return null;
  return clean;
}

// forward byte search with wrap; returns index or -1
export function searchBytes(hay, needle, from = 0) {
  if (!needle.length || needle.length > hay.length) return -1;
  const scan = (start, end) => {
    outer: for (let i = start; i <= end - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  };
  const r = scan(from, hay.length);
  return r !== -1 ? r : scan(0, Math.min(hay.length, from + needle.length - 1 + needle.length));
}

// bless-style bit-sequence search: find a bit pattern at ANY bit offset,
// not just byte-aligned. Returns {byte, bit} of the first match at/after
// byte `from`, or null. bits = string of '0'/'1'.
export function searchBits(hay, bits, from = 0) {
  const n = bits.length;
  if (!n || n > hay.length * 8) return null;
  const want = bits.split('').map((c) => c === '1' ? 1 : 0);
  const bitAt = (pos) => (hay[pos >> 3] >> (7 - (pos & 7))) & 1;
  const total = hay.length * 8;
  const startBit = from * 8;
  const tryFrom = (s0, s1) => {
    outer: for (let s = s0; s <= s1 - n; s++) {
      for (let k = 0; k < n; k++) if (bitAt(s + k) !== want[k]) continue outer;
      return { byte: s >> 3, bit: s & 7 };
    }
    return null;
  };
  return tryFrom(startBit, total) ?? (from > 0 ? tryFrom(0, Math.min(total, startBit + n)) : null);
}

// ---- number search (octet-aligned; unaligned matching is the bit search's job) ----

// "123", "-42", "0x1F4" -> BigInt or null
export function parseNumber(str) {
  const s = str.trim();
  if (!/^-?(0x[0-9a-f]+|\d+)$/i.test(s)) return null;
  const neg = s.startsWith('-');
  const v = BigInt(neg ? s.slice(1) : s);
  return neg ? -v : v;
}

export function numFits(v, type) {
  const bits = BigInt(type.slice(1));
  return type[0] === 'u'
    ? v >= 0n && v < (1n << bits)
    : v >= -(1n << (bits - 1n)) && v < (1n << (bits - 1n));
}

// smallest rust-ish type that fits; negative -> iN. null if beyond 64 bits.
export function autoNumType(v) {
  for (const t of v < 0n ? ['i8', 'i16', 'i32', 'i64'] : ['u8', 'u16', 'u32', 'u64']) {
    if (numFits(v, t)) return t;
  }
  return null;
}

// two's-complement encode to bytes, little or big endian
export function numToBytes(v, type, littleEndian) {
  const bits = +type.slice(1);
  let u = BigInt.asUintN(bits, v);
  const out = new Uint8Array(bits / 8);
  for (let i = 0; i < out.length; i++) { out[i] = Number(u & 0xffn); u >>= 8n; }
  return littleEndian ? out : out.reverse();
}

// unsigned value of a '0101' bit string, MSB first - numeric preview for bit search
export function bitsToNumber(bits) {
  let v = 0n;
  for (const c of bits) v = (v << 1n) | (c === '1' ? 1n : 0n);
  return v;
}

export function toHex(b) { return b.toString(16).toUpperCase().padStart(2, '0'); }
export function toAscii(b) { return b >= 32 && b < 127 ? String.fromCharCode(b) : '.'; }
export function offsetHex(n, w = 8) { return n.toString(16).toUpperCase().padStart(w, '0'); }

// render one row: {off, hex: [..16 strings], ascii: '...'}
export function rowData(bytes, rowStart, width = 16) {
  const hex = [], ascii = [];
  for (let i = rowStart; i < Math.min(rowStart + width, bytes.length); i++) {
    hex.push(toHex(bytes[i]));
    ascii.push(toAscii(bytes[i]));
  }
  return { off: offsetHex(rowStart), hex, ascii: ascii.join('') };
}

// edit model: tracks modified offsets for highlighting + dirty state
export function createEdit(bytes) {
  return { bytes, modified: new Set() };
}
export function setByte(ed, offset, value) {
  if (offset < 0 || offset >= ed.bytes.length) return false;
  if (ed.bytes[offset] === value) return true;
  ed.bytes[offset] = value;
  ed.modified.add(offset);
  return true;
}
