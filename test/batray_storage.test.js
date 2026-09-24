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
import { settingsSnapshot, settingsBytes, settingsFileName, settingsFile, settingsRestorePlan, usagePct, storageModel, browseItems, memoryModel, memoryParts, MEM_LOG_MS, SETTINGS_MAX_BYTES } from '../public/batray/storage-logic.js';

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
  const hi = browseItems('hist', { days: [{ day: '2026-09-21', gz: true, bytes: 900 }, { day: '2026-09-23', raw: true, bytes: 50 }], today: '2026-09-23' });
  assert.deepEqual(hi.map((i) => [i.id, i.name, i.bytes, i.del]), [['2026-09-23', '2026-09-23.sqlite (today, live)', 50, true], ['2026-09-21', '2026-09-21.sqlite', 900, true]], 'newest first, today marked');
  assert.deepEqual(browseItems('set', { snapshot: { batray_lang: 'th', batray_cutoff_pct: '12' } }).map((i) => [i.id, i.bytes]), [['batray_cutoff_pct', 19], ['batray_lang', 13]]);
  assert.deepEqual(browseItems('log', { files: [{ name: 'log-a-x.txt', bytes: 1 }, { name: 'log-b-y.txt', bytes: 2 }], current: 'log-b-y.txt' }).map((i) => i.name), ['log-b-y.txt (this session, live)', 'log-a-x.txt']);
  assert.deepEqual(browseItems('other', {}), []);
  assert.equal(memoryModel(undefined), null); assert.equal(memoryModel({}), null);
  assert.deepEqual(memoryModel({ usedJSHeapSize: 48e6, totalJSHeapSize: 64e6, jsHeapSizeLimit: 2147e6 }), { used: 48e6, heap: 48e6, total: 64e6, limit: 2147e6, pct: 2.2, near: false, precise: true, parts: null, measuredAt: null });
  // not cross-origin isolated: Chrome's figure is stale (the owner's phone: 10 MB with 327k rows) and the model says so
  assert.equal(memoryModel({ usedJSHeapSize: 10e6, totalJSHeapSize: 10e6, jsHeapSizeLimit: 2995e6 }, { precise: false }).precise, false);
  // measureUserAgentSpecificMemory() on the isolated page, as the sandbox probe returned it (2026-09-24)
  const measured = { bytes: 4964185, at: 5, breakdown: [
    { bytes: 329005, types: ['JavaScript'], attribution: [{ scope: 'DedicatedWorkerGlobalScope', url: 'history-worker.js' }] },
    { bytes: 650035, types: ['Shared'], attribution: [] }, { bytes: 0, types: [], attribution: [] },
    { bytes: 222816, types: ['DOM'], attribution: [] },
    { bytes: 3762329, types: ['JavaScript'], attribution: [{ scope: 'Window', url: 'batray' }] }] };
  const mm = memoryModel({ usedJSHeapSize: 5450953, totalJSHeapSize: 7882953, jsHeapSizeLimit: 4294705152 }, { precise: true, measured });
  assert.equal(mm.used, 4964185, 'the measured whole-tab figure is what is shown'); assert.equal(mm.heap, 5450953);
  assert.deepEqual(mm.parts, { window: 3762329, worker: 329005, dom: 222816, other: 650035 }); assert.equal(mm.measuredAt, 5);
  const T = { memWindow: 'page', memWorker: 'history worker', memDom: 'DOM', memOther: 'other', fmtSize: (b) => `${Math.round(b / 1024)} KB` };
  assert.equal(memoryParts(mm, T), 'page 3674 KB, other 635 KB, history worker 321 KB, DOM 218 KB');
  assert.equal(memoryParts(memoryModel({ usedJSHeapSize: 1, totalJSHeapSize: 1, jsHeapSizeLimit: 9 }), T), '', 'no breakdown without a measurement');
  assert.equal(memoryModel({ usedJSHeapSize: 1800e6, totalJSHeapSize: 1900e6, jsHeapSizeLimit: 2147e6 }).near, true, '80 % of the limit is near');
  assert.equal(MEM_LOG_MS, 15000);
  const empty = storageModel({ backend: 'memory' });
  assert.ok(!empty.stored && empty.rows.every((r) => !r.canDelete) && !empty.rows[0].canRestore && empty.rows[1].canRestore, 'memory only: nothing to back up or delete except settings');
});
