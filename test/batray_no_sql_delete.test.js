// BatRay by ClearEvo.com - tests (batray_no_sql_delete.test.js)
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
//
// Owner rule 2026-09-24: one SQLite file per day is the space rule - a day is
// freed by unlinking its file, never by SQL DELETE (which leaves free pages
// behind until a VACUUM, and VACUUM rewrites the whole file). This test keeps
// the rule: no DELETE FROM, no VACUUM, no DROP TABLE in the BatRay sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../public/batray/', import.meta.url));
const VENDORED = /^(sqlite3|uplot|mp4-muxer)\./;
const BANNED = /\b(DELETE\s+FROM|VACUUM|DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i;

test('no SQL DELETE / VACUUM / DROP TABLE in any first-party BatRay source: days are freed as whole files', () => {
  const files = readdirSync(dir).filter((n) => n.endsWith('.js') && !VENDORED.test(n));
  assert.ok(files.includes('history-sql.js') && files.includes('history-worker.js') && files.includes('app.js'), files);
  const hits = [];
  for (const n of files) {
    const lines = readFileSync(dir + n, 'utf8').split('\n');
    lines.forEach((l, i) => { if (BANNED.test(l)) hits.push(`${n}:${i + 1}: ${l.trim().slice(0, 100)}`); });
  }
  assert.deepEqual(hits, []);
});

test('the guard itself catches a DELETE FROM', () => {
  assert.match("db.exec('DELETE FROM readings WHERE t < ?')", BANNED);
  assert.match('db.exec("VACUUM")', BANNED);
  assert.doesNotMatch("pool.unlink(dbName(day))", BANNED);
  assert.doesNotMatch("PRAGMA wal_checkpoint(TRUNCATE)", BANNED, 'a WAL checkpoint is not a table truncate');
});
