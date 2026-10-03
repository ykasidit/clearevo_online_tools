// BatRay by ClearEvo.com - lint fixture: what house/ui-after-await must and must not flag (not shipped)
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
/* global $, renderCard, openSheet, toast, setStatus, signal, own */
let owner = null;
async function io() { return 1; }
export async function unguarded() { await io(); renderCard(); }                        // FLAG
export async function unguardedDom() { await io(); $('x').hidden = true; }             // FLAG: a DOM write
export async function readOnly() { await io(); return $('x').hidden; }                 // ok: a read
export async function guardedReturn(me) { await io(); if (owner !== me) return; renderCard(); }   // ok
export async function guardedIf(me) { await io(); if (owner === me) { setStatus(); renderCard(); } }   // ok: the if ran after the await
export async function staleIf(me) { if (owner === me) { await io(); renderCard(); } }  // FLAG: the if ran before the await
export async function aborted() { await io(); signal.throwIfAborted(); renderCard(); } // ok
export async function owned() { await io(); own(); renderCard(); }                     // ok
export async function theWait() { const r = await openSheet('x'); return r; }          // ok: the sheet is the wait
export async function toasts() { await io(); toast('done'); }                          // ok: a toast reports the result
export async function sayWhy() {
  await io();
  // eslint-disable-next-line house/ui-after-await -- fixture: the reason goes here
  renderCard();
}
export function sync() { io(); renderCard(); }                                         // not async: never flagged here
