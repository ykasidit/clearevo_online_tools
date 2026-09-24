// BatRay by ClearEvo.com - tests (batray_backup.test.js)
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
import { gzipSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tarPack, tarParse, backupDays, backupName, BACKUP_DIR, BACKUP_MAX_BYTES } from '../public/batray/backup-logic.js';

const day = (d, n) => Buffer.from(Array.from({ length: n }, (_, i) => JSON.stringify({ t: i * 3000, p: 'n11', soc: 50 })).join('\n') + '\n');   // any bytes stand in for a database here

test('the backup is a plain ustar tar of the day databases that system tar (and so 7-Zip) reads back byte for byte', () => {
  const a = day('2026-09-19', 500), b = day('2026-09-20', 1234);
  const tar = tarPack([{ name: `${BACKUP_DIR}2026-09-19.sqlite`, bytes: new Uint8Array(a) }, { name: `${BACKUP_DIR}2026-09-20.sqlite`, bytes: new Uint8Array(b) }], 1_800_000_000);
  assert.equal(tar.length % 512, 0);
  const back = tarParse(tar);
  assert.deepEqual(back.map((e) => e.name), [`${BACKUP_DIR}2026-09-19.sqlite`, `${BACKUP_DIR}2026-09-20.sqlite`]);
  assert.ok(Buffer.from(back[1].bytes).equals(b));
  const dir = mkdtempSync(join(tmpdir(), 'batray-tar-')); const file = join(dir, 'b.tar'); writeFileSync(file, tar);
  const listed = execFileSync('tar', ['-tvf', file]).toString();
  assert.match(listed, /batray-history\/2026-09-19\.sqlite/); assert.match(listed, new RegExp(` ${b.length} .*2026-09-20\\.sqlite`));
  const out = execFileSync('tar', ['-xOf', file, `${BACKUP_DIR}2026-09-20.sqlite`]);
  assert.ok(out.equals(b), 'system tar extracts the member unchanged');
  const days = backupDays(back); assert.deepEqual(days.map((d) => d.day), ['2026-09-19', '2026-09-20']);
  assert.deepEqual(backupDays([{ name: 'notes.txt', bytes: new Uint8Array(1) }, { name: '2026-09-21.sqlite', bytes: new Uint8Array(1) }]).map((d) => d.day), ['2026-09-21'], 'members without the directory count too');
  assert.throws(() => tarParse(new Uint8Array(1024).fill(7)), /not a tar/);
  assert.deepEqual(tarParse(new Uint8Array(1024)), []);
  assert.equal(backupName('2026-09-21'), 'batray-history-2026-09-21.tar'); assert.ok(BACKUP_MAX_BYTES >= 100 * 1048576);
});
