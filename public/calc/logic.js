// ClearEvo.com Calc - logic
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

// 'almost' Emacs calc - RPN stack engine. Pure, tested.
export function createCalc() {
  return { stack: [], entry: '', trail: [], undoStack: [] };
}

function snapshot(s) {
  s.undoStack.push(s.stack.slice());
  if (s.undoStack.length > 100) s.undoStack.shift();
}

export function undo(s) {
  if (!s.undoStack.length) return 'No further undo information available';
  s.stack = s.undoStack.pop();
  s.entry = '';
  return null;
}

export function pressDigit(c, s) {
  if (!/^[0-9.e-]$/.test(c)) return;
  if (c === '-' && s.entry !== '' && !s.entry.endsWith('e')) return; // minus only leading or after e
  if (c === '.' && s.entry.includes('.')) return;
  s.entry += c;
}

// RET: push entry, or dup top when entry empty (like calc)
export function enter(s) {
  if (s.entry !== '') {
    const n = Number(s.entry);
    if (isNaN(n)) { s.entry = ''; return 'Bad format'; }
    snapshot(s);
    s.stack.push(n);
    s.trail.push(`      ${fmt(n)}`);
    s.entry = '';
  } else if (s.stack.length) {
    snapshot(s);
    s.stack.push(s.stack[s.stack.length - 1]);
  }
  return null;
}

export function op(sym, s) {
  if (s.entry !== '') { const err = enter(s); if (err) return err; }
  const unary = { n: (a) => -a, '&': (a) => 1 / a, Q: (a) => Math.sqrt(a), L: (a) => Math.log(a), E: (a) => Math.exp(a) };
  const binary = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b, '^': (a, b) => Math.pow(a, b), '%': (a, b) => a % b };
  if (sym in unary) {
    if (!s.stack.length) return 'Stack empty';
    snapshot(s);
    const r = unary[sym](s.stack.pop());
    s.stack.push(r);
    s.trail.push(`${sym.padEnd(2)}    ${fmt(r)}`);
  } else if (sym in binary) {
    if (s.stack.length < 2) return 'Need 2 stack entries';
    snapshot(s);
    const b = s.stack.pop(), a = s.stack.pop();
    const r = binary[sym](a, b);
    s.stack.push(r);
    s.trail.push(`${sym.padEnd(2)}    ${fmt(r)}`);
  } else if (sym === 'TAB') {
    if (s.stack.length < 2) return 'Need 2 stack entries';
    const b = s.stack.pop(), a = s.stack.pop();
    s.stack.push(b, a);
  } else if (sym === 'DEL') {
    if (s.entry !== '') s.entry = s.entry.slice(0, -1);
    else s.stack.pop();
  } else if (sym === 'C') {
    s.stack.length = 0; s.entry = '';
  } else {
    return `Unknown op ${sym}`;
  }
  return null;
}

export function fmt(n) {
  if (!isFinite(n)) return String(n);
  const r = Math.round(n * 1e10) / 1e10;
  return String(r);
}

// render like calc buffer: "2:  3\n1:  4\n    ." with entry line
export function render(s, depth = 6) {
  const lines = [];
  const st = s.stack.slice(-depth);
  for (let i = 0; i < st.length; i++) {
    lines.push(`${st.length - i}:  ${fmt(st[i])}`);
  }
  lines.push(s.entry !== '' ? `    ${s.entry}_` : '    .');
  return lines.join('\n');
}
