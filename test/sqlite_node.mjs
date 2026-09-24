// BatRay by ClearEvo.com - test helper: the SQLite wasm build for node (the same sqlite3.wasm the page ships)
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
import { fileURLToPath } from 'node:url';
import init from './vendor/sqlite3-node.mjs';
let p = null;
/** The sqlite3 namespace (oo1 + capi), loaded once per process, wasm from the app directory. */
export function openSqlite() {
  return p || (p = init({ locateFile: (f) => fileURLToPath(new URL('../public/batray/' + f, import.meta.url)), print: () => {}, printErr: () => {} }));
}
