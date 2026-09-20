// BatRay by ClearEvo.com - tests (batray_i18n.test.js): every string exists in every language, with the same shape
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
import { I18N } from '../public/batray/i18n.js';

test('every EN key exists in every other language with the same type and, for functions, the same arity', () => {
  const en = I18N.en;
  for (const [code, tbl] of Object.entries(I18N)) {
    if (code === 'en') continue;
    const missing = Object.keys(en).filter((k) => !(k in tbl));
    const extra = Object.keys(tbl).filter((k) => !(k in en));
    assert.deepEqual(missing, [], `${code} lacks ${missing.join(', ')}`);
    assert.deepEqual(extra, [], `${code} has keys EN lacks: ${extra.join(', ')}`);
    for (const k of Object.keys(en)) {
      assert.equal(typeof tbl[k], typeof en[k], `${code}.${k} type`);
      if (typeof en[k] === 'function') assert.equal(tbl[k].length, en[k].length, `${code}.${k} arity`);
      if (typeof en[k] === 'object' && en[k]) assert.deepEqual(Object.keys(tbl[k]).sort(), Object.keys(en[k]).sort(), `${code}.${k} sub-keys`);
    }
  }
});

test('no language table has an empty string, and the honesty-critical strings never claim what the code cannot do', () => {
  for (const [code, tbl] of Object.entries(I18N)) {
    for (const [k, v] of Object.entries(tbl)) if (typeof v === 'string') assert.notEqual(v.trim(), '', `${code}.${k} empty`);
    assert.ok(!/all rights reserved/i.test(JSON.stringify(tbl)), `${code}: GPL app must not say All rights reserved`);
    assert.ok(!/cloudflare|ntfy\.sh/i.test(JSON.stringify(Object.fromEntries(Object.entries(tbl).filter(([k]) => /tv|share|live|privacy|upload/i.test(k))))), `${code}: no vendor names in the TV / share / upload copy`);
  }
});
