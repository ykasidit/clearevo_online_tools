// BatRay by ClearEvo.com - JK BMS protocol (jkbms crate): JSON writer
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

//! A JSON writer into a caller's buffer (no allocation). Numbers are printed shortest-round-trip, so
//! JSON.parse gives back the exact double. NaN / Infinity, which JSON lacks, are written as the
//! strings "\u0000NaN", "\u0000Infinity", "\u0000-Infinity" (a decoded text field never holds a NUL);
//! the JavaScript side turns them back into numbers.
use core::fmt::Write;

/// Longest text field (16 bytes) after lossy decoding: every byte can become U+FFFD (3 bytes).
pub const TEXT_MAX: usize = 48;

pub struct W<'a> {
    buf: &'a mut [u8],
    n: usize,
    comma: bool,
    pub overflow: bool,
}

impl Write for W<'_> {
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        self.raw(s.as_bytes());
        Ok(())
    }
}

impl<'a> W<'a> {
    pub fn new(buf: &'a mut [u8]) -> Self {
        W { buf, n: 0, comma: false, overflow: false }
    }
    pub fn len(&self) -> usize {
        self.n
    }
    pub fn is_empty(&self) -> bool {
        self.n == 0
    }
    pub fn bytes(&self) -> &[u8] {
        &self.buf[..self.n]
    }
    fn raw(&mut self, b: &[u8]) {
        if self.overflow || self.n + b.len() > self.buf.len() {
            self.overflow = true;
            return;
        }
        self.buf[self.n..self.n + b.len()].copy_from_slice(b);
        self.n += b.len();
    }
    pub fn open(&mut self) {
        self.raw(b"{");
        self.comma = false;
    }
    pub fn close(&mut self) {
        self.raw(b"}");
        self.comma = true;
    }
    pub fn arr_open(&mut self) {
        self.raw(b"[");
        self.comma = false;
    }
    pub fn arr_close(&mut self) {
        self.raw(b"]");
        self.comma = true;
    }
    pub fn item(&mut self) {
        if self.comma {
            self.raw(b",");
        }
        self.comma = false;
    }
    pub fn key(&mut self, k: &str) {
        self.item();
        self.str(k);
        self.raw(b":");
        self.comma = false;
    }
    pub fn u(&mut self, v: u64) {
        let _ = write!(self, "{v}");
        self.comma = true;
    }
    pub fn num(&mut self, v: f64) {
        if v.is_nan() {
            self.raw(b"\"\\u0000NaN\"");
        } else if v.is_infinite() {
            self.raw(if v > 0.0 { b"\"\\u0000Infinity\"" } else { b"\"\\u0000-Infinity\"" });
        } else if v == 0.0 && v.is_sign_negative() {
            self.raw(b"-0");
        } else {
            let _ = write!(self, "{v}");
        }
        self.comma = true;
    }
    pub fn null(&mut self) {
        self.raw(b"null");
        self.comma = true;
    }
    pub fn bool(&mut self, b: bool) {
        self.raw(if b { b"true" } else { b"false" });
        self.comma = true;
    }
    pub fn str(&mut self, s: &str) {
        self.escaped(s.as_bytes());
    }
    fn escaped(&mut self, s: &[u8]) {
        self.raw(b"\"");
        for &c in s {
            match c {
                b'"' => self.raw(b"\\\""),
                b'\\' => self.raw(b"\\\\"),
                0..=0x1f => {
                    let _ = write!(self, "\\u{:04x}", c);
                }
                _ => self.raw(&[c]),
            }
        }
        self.raw(b"\"");
        self.comma = true;
    }
    pub fn str_unknown_type(&mut self, t: u8) {
        let _ = write!(self, "\"unknown frame type 0x{t:x}\"");
        self.comma = true;
    }
    pub fn key_u(&mut self, k: &str, v: u64) {
        self.key(k);
        self.u(v);
    }
    pub fn key_num(&mut self, k: &str, v: f64) {
        self.key(k);
        self.num(v);
    }
    pub fn key_opt_num(&mut self, k: &str, v: Option<f64>) {
        self.key(k);
        match v {
            Some(x) => self.num(x),
            None => self.null(),
        }
    }
    pub fn key_null(&mut self, k: &str) {
        self.key(k);
        self.null();
    }
    pub fn key_bool(&mut self, k: &str, b: bool) {
        self.key(k);
        self.bool(b);
    }
    pub fn key_str(&mut self, k: &str, s: &str) {
        self.key(k);
        self.str(s);
    }
    /// A raw text field: lossy UTF-8 decoded and trimmed the JavaScript way, then written.
    pub fn key_text(&mut self, k: &str, raw: &[u8]) {
        let mut t = [0u8; TEXT_MAX];
        let n = lossy_trim(raw, &mut t);
        self.key_raw_text(k, &t[..n]);
    }
    /// Text that is already valid UTF-8.
    pub fn key_raw_text(&mut self, k: &str, s: &[u8]) {
        self.key(k);
        self.escaped(s);
    }
}

/// JavaScript's String.prototype.trim whitespace: WhiteSpace (incl. U+FEFF and the Zs spaces) and
/// LineTerminator.
fn js_space(c: char) -> bool {
    matches!(c, '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}'
        | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

/// TextDecoder (UTF-8, replacement characters for bad bytes) then trim, into `out`; returns the length.
pub fn lossy_trim(raw: &[u8], out: &mut [u8; TEXT_MAX]) -> usize {
    let mut n = 0;
    for chunk in raw.utf8_chunks() {
        for b in chunk.valid().bytes() {
            out[n] = b;
            n += 1;
        }
        if !chunk.invalid().is_empty() {
            out[n..n + 3].copy_from_slice("\u{fffd}".as_bytes());
            n += 3;
        }
    }
    let s = core::str::from_utf8(&out[..n]).unwrap_or("");
    let t = s.trim_matches(js_space);
    let start = t.as_ptr() as usize - s.as_ptr() as usize;
    let len = t.len();
    out.copy_within(start..start + len, 0);
    len
}
