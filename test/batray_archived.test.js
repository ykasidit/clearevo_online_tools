// BatRay by ClearEvo.com - tests: BatRay is archived, its sources are frozen
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

// Owner decision 2026-11-24: BatRay is archived. Any change under public/batray fails
// the build. Lifting the archive is the owner's call; then:
//   node test/batray_archived.test.js --update
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIR = join(ROOT, 'public/batray');
const SUM = join(ROOT, 'test/batray_archived.sha256');

function files(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		return e.isDirectory() ? files(p) : [p];
	});
}

function digest() {
	const h = createHash('sha256');
	for (const p of files(DIR).map((f) => relative(DIR, f)).sort()) {
		h.update(p + '\0');
		h.update(readFileSync(join(DIR, p)));
		h.update('\0');
	}
	return h.digest('hex');
}

if (process.argv.includes('--update')) {
	writeFileSync(SUM, digest() + '\n');
	console.log('batray archive: digest updated');
} else {
	test('BatRay is archived: public/batray is unchanged', () => {
		assert.equal(digest(), readFileSync(SUM, 'utf8').trim(),
			'BatRay is ARCHIVED (owner, 2026-11-24): public/batray must not change. ' +
			'Lifting the archive is the owner\'s call.');
	});
}
