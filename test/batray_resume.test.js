// BatRay by ClearEvo.com - tests (batray_resume.test.js): the resume after a reopen and the reader setup checklist
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
import { parseIntent, emptyIntent, intentEvent, resumePlan, resumeLine, RESUME_S } from '../public/batray/resume-logic.js';
import { checklist, checklistSummary, checklistLine, setupWarn, parseDone, toggleDone, MANUAL, ITEMS } from '../public/batray/setup-logic.js';
import { statusSnapshot, statusLine } from '../public/batray/status-logic.js';
import { sheetModel } from '../public/batray/ui-logic.js';
import { I18N } from '../public/batray/i18n.js';

test('the intent: what the person asked for, not what happened to the link', () => {
  let i = emptyIntent();
  i = intentEvent(i, 'connected', { id: 'Xgde3', name: 'm-00' }, 1);
  i = intentEvent(i, 'connected', { id: 'hLIrt', name: 's-01' }, 2);
  i = intentEvent(i, 'share-on', {}, 3);
  assert.deepEqual(i, { share: true, packs: [{ id: 'Xgde3', name: 'm-00' }, { id: 'hLIrt', name: 's-01' }], at: 3 });
  i = intentEvent(i, 'connected', { id: 'Xgde3', name: 'm-00' }, 4);
  assert.deepEqual(i.packs.map((p) => p.name), ['s-01', 'm-00'], 'a reconnect does not duplicate');
  i = intentEvent(i, 'disconnected', { id: 'hLIrt' }, 5);
  assert.deepEqual(i.packs.map((p) => p.name), ['m-00'], 'the person disconnected s-01');
  i = intentEvent(i, 'share-off', {}, 6); assert.equal(i.share, false);
  assert.deepEqual(parseIntent(JSON.stringify(i)), i);
  assert.deepEqual(parseIntent('not json'), emptyIntent()); assert.deepEqual(parseIntent(null), emptyIntent());
  assert.deepEqual(parseIntent({ share: 1, packs: [{ id: '' }, { id: 'a', name: 'x'.repeat(99) }, 7] }).packs, [{ id: 'a', name: 'x'.repeat(40) }]);
});

test('the plan on start: count down only for a reader that was running; name what needs a tap and why', () => {
  const intent = { share: true, packs: [{ id: 'A', name: 'm-00' }, { id: 'B', name: 's-01' }], at: 1 };
  assert.equal(resumePlan({ intent, viewer: true }).action, 'none');
  assert.equal(resumePlan({ intent, demo: true }).action, 'none');
  assert.equal(resumePlan({ intent, enabled: false }).why, 'resuming is turned off');
  assert.equal(resumePlan({ intent: emptyIntent() }).why, 'nothing was running');
  // the flag on, both allowed: share and reconnect both
  let p = resumePlan({ intent, permittedIds: ['A', 'B'] });
  assert.deepEqual([p.action, p.seconds, p.share, p.connect.map((x) => x.name), p.cannot.length], ['countdown', RESUME_S, true, ['m-00', 's-01'], 0]);
  // the h46 phones today (getDevices=no): the share resumes, both packs need a tap - said so
  p = resumePlan({ intent, permittedIds: null });
  assert.deepEqual([p.connect.length, p.cannot.map((x) => x.why)], [0, ['no-getdevices', 'no-getdevices']]);
  assert.match(resumeLine(p), /share again on the last link; reconnect none; needs a tap: m-00 \(Chrome does not remember Bluetooth permissions: the flag is off\)/);
  p = resumePlan({ intent, permittedIds: ['A'] });
  assert.deepEqual([p.connect.map((x) => x.name), p.cannot.map((x) => `${x.name}:${x.why}`)], [['m-00'], ['s-01:not-permitted']]);
  assert.equal(resumeLine(resumePlan({ intent, viewer: true })), 'resume: none (a viewer has nothing to resume)');
  assert.equal(RESUME_S, 30, 'owner: a 30 s countdown');
});

test('the resume sheet: what will happen, the seconds left, Now and Cancel, in both languages', () => {
  const plan = resumePlan({ intent: { share: true, packs: [{ id: 'A', name: 'm-00' }, { id: 'B', name: 's-01' }], at: 1 }, permittedIds: ['A'] });
  for (const [lang, T] of Object.entries(I18N)) {
    const m = sheetModel('resume', { resume: { plan, left: 21 } }, T);
    assert.equal(m.title, T.resumeTitle, lang);
    assert.ok(m.lead.startsWith(T.resumeIn(21)) && m.lead.includes(T.resumeShare) && m.lead.includes(T.resumeConnect('m-00')) && m.lead.includes(T.resumeCannot('s-01')), `${lang}: ${m.lead}`);
    assert.equal(m.progress, 30);
    assert.deepEqual(m.actions.map((a) => a.id), ['now', 'cancel']);
  }
});

test('the checklist: each item checked where the page can, manual steps by the person\'s word, a summary for the log', () => {
  // the h46 phone of 2026-10-05: Chrome 154, no getDevices, SQLite, notifications not asked, charging
  const h46 = { compatOk: true, bluetooth: true, getDevices: false, knownSaved: true, knownPermitted: null, notifications: 'default', persisted: true, history: 'opfs', wakeLock: true, charging: true, resumeOn: true, done: [] };
  let items = checklist(h46);
  assert.deepEqual(items.map((i) => i.id), ITEMS);
  const st = Object.fromEntries(items.map((i) => [i.id, i.state]));
  assert.deepEqual(st, { compat: 'ok', bluetooth: 'ok', remember: 'missing', known: 'unknown', notify: 'missing', persist: 'ok', history: 'ok', wake: 'ok', charging: 'ok', resume: 'ok', chromeUpdate: 'todo', chromeBattery: 'todo' });
  let sum = checklistSummary(items);
  assert.deepEqual([sum.ready, sum.total, sum.missing, sum.todo, sum.ok], [7, 12, ['remember', 'notify'], ['chromeUpdate', 'chromeBattery'], false]);
  assert.equal(checklistLine(items), 'setup: 7/12 ready - missing: remember, notify - not confirmed: chromeUpdate, chromeBattery - cannot tell: known');
  items = checklist({ ...h46, getDevices: true, knownPermitted: true, notifications: 'granted', done: [...MANUAL] });
  sum = checklistSummary(items);
  assert.deepEqual([sum.ready, sum.ok], [12, true]);
  assert.ok(checklistLine(items).endsWith('confirmed by the user: chromeUpdate, chromeBattery'), 'the log says which were the person\'s word');
  const bare = checklistSummary(checklist({}));
  assert.ok(!bare.ok && bare.unknown.includes('charging') && bare.unknown.includes('notify'), 'nothing known is never "ok"');
  assert.deepEqual(checklist({ history: 'memory' }).find((i) => i.id === 'history').state, 'missing');
});

test('manual steps: Done toggles and survives storage; the warning sign shows on a running reader with something left', () => {
  let d = parseDone('["chromeUpdate","bogus"]'); assert.deepEqual(d, ['chromeUpdate']);
  d = toggleDone(d, 'chromeBattery'); assert.deepEqual(d, ['chromeUpdate', 'chromeBattery']);
  d = toggleDone(d, 'chromeUpdate'); assert.deepEqual(d, ['chromeBattery']);
  assert.deepEqual(toggleDone(d, 'compat'), d, 'only manual items toggle');
  assert.deepEqual(parseDone('junk'), []);
  const items = checklist({ compatOk: true });
  assert.equal(setupWarn({ items, reader: true, running: true }), true);
  assert.equal(setupWarn({ items, reader: true, running: false }), false, 'not before it runs');
  assert.equal(setupWarn({ items, reader: false, running: true }), false, 'never on a viewer');
  const all = checklist({ compatOk: true, bluetooth: true, getDevices: true, notifications: 'granted', persisted: true, history: 'opfs', wakeLock: true, charging: true, done: [...MANUAL] });
  assert.equal(setupWarn({ items: all, reader: true, running: true }), false, 'nothing left: no sign');
});

test('the checklist sheet: on Connect "Continue anyway" + Cancel, from the sign a Close; how to fix each, Chrome and the flag', () => {
  const items = checklist({ compatOk: true, bluetooth: true, getDevices: false, notifications: 'default', persisted: true, history: 'opfs', wakeLock: true, charging: true, done: ['chromeUpdate'] });
  const facts = { browser: 'chrome 154 (chromium)', os: 'android', getDevices: false, ver: '0.9.72' };
  for (const [lang, T] of Object.entries(I18N)) {
    const m = sheetModel('checklist', { setup: { items, mode: 'connect', facts } }, T);
    assert.equal(m.title, T.setupTitle, lang);
    assert.ok(m.lead.includes(T.setupContinueNote), lang);
    assert.deepEqual(m.actions.map((a) => `${a.id}:${a.label}`), [`go:${T.setupAnyway}`, `cancel:${T.cancel}`]);
    const remember = m.items.find((i) => i.id === 'remember');
    assert.ok(remember.kind === 'check' && remember.state === 'missing' && remember.hint === T.setupHow.remember && remember.hint.includes('chrome://flags'), lang);
    const upd = m.items.find((i) => i.id === 'chromeUpdate'); assert.ok(upd.tog && upd.togLabel === T.setupUndo && upd.hint === '', `${lang}: a confirmed step offers Not done`);
    assert.ok(m.items.find((i) => i.id === 'chromeBattery').togLabel === T.setupMark);
    assert.ok(m.rows.some(([k, v]) => k === T.setupFlag && v === T.setupFlagOff) && m.rows.some(([, v]) => v.startsWith('chrome 154 (chromium) · Android')), lang);
    const v = sheetModel('checklist', { setup: { items, mode: 'view', facts } }, T);
    assert.deepEqual(v.actions.map((a) => a.id), ['ok']);
    for (const id of ITEMS) assert.ok(T.setupItem[id] && T.setupHow[id], `${lang}: ${id}`);
  }
});

test('the status carries the checklist summary to the viewers and the log', () => {
  const sum = checklistSummary(checklist({ compatOk: true, bluetooth: true, getDevices: false }));
  const s = statusSnapshot({ now: 1, setup: sum });
  assert.deepEqual([s.setup.ready, s.setup.total], [sum.ready, 12]);
  assert.match(statusLine(s), /setup=\d+\/12 missing:remember/);
  const m = sheetModel('reader', { reader: { status: s, live: true, model: null } }, I18N.en);
  assert.ok(m.rows.some(([k, v]) => k === 'Reader setup' && v.startsWith(`${sum.ready} of 12 ready · not ready: `) && v.includes('Chrome remembers the BMS')), JSON.stringify(m.rows));
});
