// BatRay by ClearEvo.com - tests (batray_storage.test.js)
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
import { settingsSnapshot, settingsBytes, settingsFileName, settingsFile, settingsRestorePlan, usagePct, storageModel, SETTINGS_MAX_BYTES } from '../public/batray/storage-logic.js';

test('settings: only the app keys are snapshotted, a settings file is checked before it is applied', () => {
  const snap = settingsSnapshot([['batray_cutoff_pct', '12'], ['ce_zoom', '110'], ['other_app', 'x'], ['batray_lang', 'th'], ['batray_bad', 5]]);
  assert.deepEqual(snap, { batray_cutoff_pct: '12', ce_zoom: '110', batray_lang: 'th' });
  assert.equal(settingsBytes({ a: 'b' }), 2); assert.equal(settingsBytes({ batray_x: 'แบต' }), 8 + 9);
  assert.equal(settingsFileName('2026-09-23'), 'batray-settings-2026-09-23.json');
  const f = settingsFile(snap, '0.9.32', '2026-09-23T00:00:00Z');
  assert.deepEqual(f, { app: 'BatRay', version: '0.9.32', saved: '2026-09-23T00:00:00Z', settings: snap });
  const plan = settingsRestorePlan({ ...f, settings: { ...snap, evil_key: 'x', batray_num: 3 } });
  assert.equal(plan.ok, true); assert.deepEqual(plan.apply, snap); assert.equal(plan.skipped, 2);
  assert.equal(settingsRestorePlan({ app: 'Other', settings: snap }).ok, false);
  assert.equal(settingsRestorePlan({ app: 'BatRay', settings: {} }).why, 'no settings in it');
  assert.equal(settingsRestorePlan({ app: 'BatRay', settings: { batray_big: 'x'.repeat(SETTINGS_MAX_BYTES) } }).why, 'too big');
  assert.equal(settingsRestorePlan('junk').ok, false);
});

test('the Storage box: percent readable at both ends, three rows with what each can do', () => {
  assert.equal(usagePct(0, 0), null); assert.equal(usagePct(27e6, 151e9), 0.02); assert.equal(usagePct(3.4e9, 151e9), 2.3); assert.equal(usagePct(80e9, 151e9), 53);
  const m = storageModel({ usage: 27e6, quota: 151e9, hist: { bytes: 26e6, days: 2, oldest: '2026-09-21' }, settings: { bytes: 300, count: 7 }, logs: { bytes: 1e6, files: 3, session: 20000, sid: 'abc123' } });
  assert.equal(m.pct, 0.02); assert.equal(m.stored, true); assert.deepEqual(m.rows.map((r) => r.id), ['hist', 'set', 'log']);
  const [h, s, l] = m.rows;
  assert.ok(h.canBackup && h.canRestore && h.canDelete && h.days === 2 && h.since === '2026-09-21');
  assert.ok(s.canBackup && s.canRestore && s.canDelete && s.count === 7);
  assert.ok(l.canBackup && !l.canRestore && l.canDelete && l.files === 3 && l.sid === 'abc123');
  const empty = storageModel({ backend: 'memory' });
  assert.ok(!empty.stored && empty.rows.every((r) => !r.canDelete) && !empty.rows[0].canRestore && empty.rows[1].canRestore, 'memory only: nothing to back up or delete except settings');
});
