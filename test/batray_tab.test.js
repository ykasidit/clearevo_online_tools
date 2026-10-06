// BatRay by ClearEvo.com - tests (batray_tab.test.js): one store per tab - which store a page uses, adopts, frees
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
import { TAB_PREFIX, LEGACY, tabKey, metaKey, tabLock, newTabId, validTabId, storeDirs, storeOfDir, storeOfLogDir, tabMeta, parseMeta, tabRecords, chooseTab, orphanDrops, ORPHAN_VIEWER_MS, legacyMoves, storeRows } from '../public/batray/tab-logic.js';

const H = 3600000, NOW = Date.UTC(2026, 9, 6, 12);
const rec = (id, role, room, atAgo, channel = '') => tabMeta({ id, role, room, channel, at: NOW - atAgo });

test('ids, keys and directories: per-tab state stays outside the batray_* settings; the legacy store keeps its old place', () => {
  const id = newTabId(() => 0.5); assert.ok(validTabId(id) && id.length === 8, id);
  assert.ok(!validTabId('ABCDEFGH') && !validTabId('abc') && !validTabId(null) && validTabId(LEGACY));
  assert.equal(tabKey('a1b2c3d4', 'lastrun'), 'batrayTab:a1b2c3d4:lastrun');
  assert.ok(!tabKey('a1b2c3d4', 'x').startsWith('batray_'), 'never in a settings backup (settingsSnapshot takes batray_*)');
  assert.equal(metaKey('a1b2c3d4'), 'batrayTab:a1b2c3d4'); assert.equal(tabLock('a1b2c3d4'), 'batray-tab-a1b2c3d4');
  assert.deepEqual(storeDirs('a1b2c3d4'), { db: 'batray-db-a1b2c3d4', logs: 'logs-a1b2c3d4' });
  assert.deepEqual(storeDirs(LEGACY), { db: 'batray-history-db', logs: 'logs' }, 'the 0.9.40-0.9.76 pool and logs, where they are');
  assert.equal(storeOfDir('batray-db-a1b2c3d4'), 'a1b2c3d4'); assert.equal(storeOfDir('batray-history-db'), LEGACY); assert.equal(storeOfDir('batray-history'), null);
  assert.equal(storeOfLogDir('logs-a1b2c3d4'), 'a1b2c3d4'); assert.equal(storeOfLogDir('logs'), LEGACY); assert.equal(storeOfLogDir('x'), null);
});

test('records: only `batrayTab:<id>` metas with a role and a time; state keys and junk are skipped', () => {
  const entries = [
    [metaKey('a1b2c3d4'), JSON.stringify({ role: 'reader', at: NOW, channel: 'seahut-n11' })],
    [tabKey('a1b2c3d4', 'lastrun'), '{}'],
    [metaKey('v0000001'), JSON.stringify({ role: 'viewer', room: 'NI_BBB8UXBmtmhhPBYFGYQ', at: NOW - H })],
    [metaKey('bad'), JSON.stringify({ role: 'reader', at: NOW })],
    [metaKey('z0000000'), 'not json'], [metaKey('y0000000'), JSON.stringify({ role: 'admin', at: 1 })],
    ['batray_lang', 'th'],
  ];
  const r = tabRecords(entries);
  assert.deepEqual(r.map((x) => x.id), ['a1b2c3d4', 'v0000001']);
  assert.equal(r[0].room, null, 'a reader has no room'); assert.equal(r[1].room, 'NI_BBB8UXBmtmhhPBYFGYQ');
  assert.equal(parseMeta('a1b2c3d4', JSON.stringify({ role: 'viewer', room: 5, at: 1 })).room, null);
  assert.equal(TAB_PREFIX, 'batrayTab:');
});

test('choose: a reload keeps the tab; a copied tab gets its own; a reopened reader takes over the closed one; viewers by room', () => {
  const rooms = { sea: 'NI_BBB8UXBmtmhhPBYFGYQ', yard: 'G7Mqt_nv_te5Vq3Ye8DfyA' };
  const records = [rec('r0000001', 'reader', null, 2 * H, 'seahut-n11'), rec('r0000002', 'reader', null, 9 * H), rec('v0000001', 'viewer', rooms.sea, H), rec('v0000002', 'viewer', rooms.yard, H)];
  const rand = () => 0.123;
  // a reload: sessionStorage kept the id, nobody holds its lock (the page before is gone)
  assert.deepEqual(chooseTab({ sessionId: 'v0000001', live: new Set(), role: 'viewer', room: rooms.sea, records, rand }).how, 'same');
  // Chrome closed the reader tab; someone opens BatRay again in a new tab: it takes the NEWEST closed reader store
  let c = chooseTab({ sessionId: null, live: new Set(), role: 'reader', records, rand });
  assert.deepEqual([c.id, c.how], ['r0000001', 'adopt']); assert.match(c.why, /closed reader tab/);
  // the 2026-10-05 phone: the backyard viewer tab is open while a seahut viewer tab starts - each its own store
  c = chooseTab({ sessionId: null, live: new Set(['v0000002']), role: 'viewer', room: rooms.sea, records, rand });
  assert.deepEqual([c.id, c.how], ['v0000001', 'adopt'], 'the closed seahut viewer copy, never the open backyard one');
  c = chooseTab({ sessionId: null, live: new Set(['v0000001', 'v0000002']), role: 'viewer', room: rooms.sea, records, rand });
  assert.equal(c.how, 'new', 'every same-room store is open: a new one');
  // "duplicate tab" copies sessionStorage: the id is live in the other tab -> not shared, adopt or new
  c = chooseTab({ sessionId: 'r0000001', live: new Set(['r0000001', 'r0000002']), role: 'reader', records, rand });
  assert.equal(c.how, 'new'); assert.match(c.why, /copy of a tab that is still open/); assert.notEqual(c.id, 'r0000001');
  // a viewer never takes a reader's store or another room's copy
  c = chooseTab({ sessionId: null, live: new Set(), role: 'viewer', room: 'OTHERroomOTHERroomOTHE', records, rand });
  assert.equal(c.how, 'new');
});

test('the store from before 0.9.77: the first reader page takes it (with its history); a viewer never does', () => {
  let c = chooseTab({ sessionId: null, live: new Set(), role: 'reader', records: [], legacy: true });
  assert.deepEqual([c.id, c.how], [LEGACY, 'legacy']);
  c = chooseTab({ sessionId: null, live: new Set(), role: 'viewer', room: 'NI_BBB8UXBmtmhhPBYFGYQ', records: [], legacy: true });
  assert.equal(c.how, 'new', 'a viewer re-downloads (owner: "re download db per tab is fine")');
  c = chooseTab({ sessionId: null, live: new Set([LEGACY]), role: 'reader', records: [], legacy: true });
  assert.equal(c.how, 'new', 'a second reader tab while the first holds it');
  c = chooseTab({ sessionId: null, live: new Set(), role: 'reader', records: [rec(LEGACY, 'reader', null, H)], legacy: true });
  assert.deepEqual([c.id, c.how], [LEGACY, 'legacy'], 'once claimed it is a closed reader store like any other');
  assert.deepEqual(legacyMoves(LEGACY).map(([from]) => from).sort(), ['batray_boot', 'batray_hist_spill', 'batray_known_dev', 'batray_lastrun', 'batray_resume', 'batray_share_last', 'batray_share_name']);
  assert.ok(legacyMoves(LEGACY).every(([, to]) => to.startsWith('batrayTab:legacy:')));
  assert.equal(legacyMoves(LEGACY).find(([f]) => f === 'batray_boot')[1], 'batrayTab:legacy:boot_prev', 'the old boot trail is the load before this one');
});

test('orphans: closed viewer copies go after 30 days, or all (oldest first) when space is low; readers and open tabs never', () => {
  const records = [rec('v0000001', 'viewer', 'a', ORPHAN_VIEWER_MS + H), rec('v0000002', 'viewer', 'b', H), rec('v0000003', 'viewer', 'c', 2 * H), rec('r0000001', 'reader', null, ORPHAN_VIEWER_MS * 3), rec('v0000004', 'viewer', 'd', ORPHAN_VIEWER_MS * 2)];
  assert.deepEqual(orphanDrops({ records, live: new Set(['v0000004']), own: 'v0000002', now: NOW }), ['v0000001']);
  assert.deepEqual(orphanDrops({ records, live: new Set(['v0000004']), own: 'v0000002', now: NOW, lowSpace: true }), ['v0000001', 'v0000003']);
});

test('browse rows: every other store, open ones first and not deletable, the legacy one named', () => {
  const records = [rec('v0000001', 'viewer', 'NI_BBB8UXBmtmhhPBYFGYQ', H, 'seahut-n11'), rec('r0000001', 'reader', null, 2 * H, 'backyard')];
  const rows = storeRows({ stores: [{ id: 'own00000', bytes: 9 }, { id: 'v0000001', bytes: 100, logBytes: 20 }, { id: 'r0000001', bytes: 5 }, { id: LEGACY, bytes: 7000 }, { id: 'x0000000', bytes: 1 }], records, live: new Set(['r0000001']), own: 'own00000' });
  assert.deepEqual(rows.map((r) => [r.id, r.inUse, r.bytes]), [['v0000001', false, 120], [LEGACY, false, 7000], ['x0000000', false, 1], ['r0000001', true, 5]]);
  assert.equal(rows[0].channel, 'seahut-n11'); assert.ok(rows[1].legacy); assert.equal(rows[2].role, null, 'a store without a record (its tab state was cleared) is still listed');
});
