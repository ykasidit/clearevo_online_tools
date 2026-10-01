// BatRay by ClearEvo.com - lint fixture: what the unawaited-call rules must and must not flag (not shipped)
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
async function work() { return 1; }
export function bare() { work(); }                       // FLAG: no-floating-promises (Dart unawaited_futures)
export function marked() { void work(); }                // ok: explicit fire-and-forget
export async function awaited() { await work(); }        // ok
export function asBool() { if (work()) return 1; return 0; }   // FLAG: no-misused-promises (a promise is always truthy)
export async function notThenable() { await 3; }         // FLAG: await-thenable
export class K { m() { return this; } }
export const ref = new K().m;                            // FLAG: unbound-method
export async function wrapped() { try { return work(); } catch { return 0; } }   // FLAG: return-await in try/catch
