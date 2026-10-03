// ClearEvo.com DICOM Viewer - the decisions moved out of the shell in 1.8.0 (tests)
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
import { sniffArchive, isArchiveName, cineNext, clampZoom, wlDrag, browseSteps } from '../public/dicom/logic.js';
import { I18N } from '../public/dicom/i18n.js';

test('sniffArchive names the five archive kinds by magic bytes, and every refusal has a message in both languages', () => {
  const at = (sig, pos = 0) => { const b = new Uint8Array(264); b.set(sig, pos); return b; };
  assert.equal(sniffArchive(at([0x50, 0x4b, 0x03, 0x04])), 'zip');
  assert.equal(sniffArchive(at([0x50, 0x4b, 0x05, 0x06])), 'zip');       // an empty zip is still a zip
  assert.equal(sniffArchive(at([0x75, 0x73, 0x74, 0x61, 0x72], 257)), 'tar');
  assert.equal(sniffArchive(at([0x1f, 0x8b])), 'gz');
  assert.equal(sniffArchive(at([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])), '7z');
  assert.equal(sniffArchive(at([0x52, 0x61, 0x72, 0x21])), 'rar');
  assert.equal(sniffArchive(at([0x44, 0x49, 0x43, 0x4d])), 'unknown');
  assert.equal(sniffArchive(new Uint8Array(3)), 'unknown');                // shorter than any signature
  for (const kind of ['gz', '7z', 'rar', 'unknown']) for (const lang of Object.keys(I18N)) assert.ok(I18N[lang].archiveRefused[kind].length > 20, `${lang} ${kind}`);
  assert.ok(isArchiveName('CD.ZIP') && isArchiveName('a.tar.gz') && isArchiveName('x.7z') && !isArchiveName('IMG0001') && !isArchiveName('a.dcm'));
});

test('cineNext wraps to the first frame; clampZoom keeps 0.2..12', () => {
  assert.equal(cineNext(0, 8), 1); assert.equal(cineNext(7, 8), 0); assert.equal(cineNext(0, 1), 0);
  assert.equal(clampZoom(0.01), 0.2); assert.equal(clampZoom(50), 12); assert.equal(clampZoom(2.5), 2.5);
});

test('wlDrag: left-right widens, up-down shifts the level, the width never drops below 1', () => {
  const a = wlDrag(40, 400, 100, 0);
  assert.equal(a.wc, 40); assert.ok(a.ww > 400);
  const b = wlDrag(40, 400, 0, -50);
  assert.equal(b.ww, 400); assert.ok(b.wc < 40);
  assert.equal(wlDrag(0, 1, -10000, 0).ww, 1);
});

test('browseSteps emits whole steps and keeps the remainder, in both directions', () => {
  let r = browseSteps(0, 50, 24);
  assert.deepEqual(r, { acc: 2, steps: 2 });
  r = browseSteps(r.acc, -60, 24);                       // 2 - 60 = -58 -> two steps back, -10 left
  assert.deepEqual(r, { acc: -10, steps: -2 });
  r = browseSteps(r.acc, 5, 24);
  assert.deepEqual(r, { acc: -5, steps: 0 });            // nothing emitted below one step
});
