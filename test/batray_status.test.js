// BatRay by ClearEvo.com - tests (batray_status.test.js): the reader status, how a reader went away, the boot trail
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
import { statusSnapshot, statusChanged, statusDue, endReason, offlineModel, statusLine, STATUS_EVERY_MS } from '../public/batray/status-logic.js';
import { fmtAgo, fmtWhen, offlineLines } from '../public/batray/view-logic.js';
import { bootReport, lastRunRecord, lastRunReport, uploadBody } from '../public/batray/log-logic.js';
import { sheetModel } from '../public/batray/ui-logic.js';
import { I18N } from '../public/batray/i18n.js';

const t0 = Date.parse('2026-10-05T03:30:00Z');
const base = {
  now: t0, startedAt: t0 - 3600_000, ver: '0.9.71', sid: 'abc123', visible: true, batt: { level: 0.97, charging: true },
  mem: { used: 31 * 1048576, limit: 4096 * 1048576, pct: 1 }, usage: 26 * 1048576, quota: 60000 * 1048576,
  hist: { backend: 'opfs', days: 5, rows: 8174, pend: 3, fails: 0 }, log: { on: true, files: 4, bytes: 5323 * 1024 },
  browser: { name: 'chrome', version: '154', os: 'android' }, missing: [], wake: true, net: { online: true, type: 'wifi' },
  packs: [{ name: 'm-00', connected: true, at: t0 - 2000, soc: 9, v: 51.5, a: -5.65 }, { name: 's-01', connected: true, at: t0 - 1500, soc: 10, v: 51.6, a: -5.2 }],
  prev: { clean: true, at: t0 - 7200_000 }, sharing: true,
};

test('the snapshot: plain facts, rounded, a missing API is null (never a guess)', () => {
  const s = statusSnapshot({ ...base, why: 'tick' });
  assert.equal(s.up, 3600); assert.deepEqual(s.bat, { pct: 97, chg: true }); assert.deepEqual(s.mem, { used: 31, limit: 4096, pct: 1 });
  assert.deepEqual(s.sto, { used: 26, quota: 60000 }); assert.equal(s.br, 'chrome 154'); assert.equal(s.packs.length, 2);
  assert.ok(JSON.stringify(s).length < 1200, `small enough to send every minute: ${JSON.stringify(s).length} B`);
  const bare = statusSnapshot({ now: t0 });
  assert.equal(bare.bat, null); assert.equal(bare.mem, null); assert.equal(bare.hist, null); assert.equal(bare.up, null); assert.deepEqual(bare.sto, { used: null, quota: null });
  const line = statusLine(s);
  for (const part of ['why=tick', 'vis=yes', 'phone=97% charging', 'mem=31/4096MB', 'hist=opfs/5d/8174r/3pend', 'log=4f/5323KB', 'chrome 154 android', 'missing=none', 'wake=held', 'share=on', 'net=online wifi', 'v0.9.71', 'sid=abc123', 'm-00 on 9% 51.5V -5.65A @03:29:58']) assert.ok(line.includes(part), `${part} in: ${line}`);
});

test('when to send: last words and the first at once, a change that matters at once, else once a minute', () => {
  const a = statusSnapshot({ ...base }); const now = t0;
  assert.equal(statusDue({ lastSentAt: 0, now, changed: false }), true, 'nothing sent yet');
  assert.equal(statusDue({ lastSentAt: now - 20_000, now, changed: false }), false);
  assert.equal(statusDue({ lastSentAt: now - STATUS_EVERY_MS, now, changed: false }), true, 'the minute');
  assert.equal(statusDue({ lastSentAt: now - 1000, now, changed: true }), true);
  assert.equal(statusDue({ lastSentAt: now - 1000, now, changed: false, why: 'hidden' }), true, 'last words go now');
  assert.equal(statusChanged(a, statusSnapshot({ ...base, now: t0 + 15_000, packs: base.packs.map((p) => ({ ...p, at: p.at + 15_000, soc: p.soc })) })), false, 'a newer reading is not a change');
  assert.equal(statusChanged(a, statusSnapshot({ ...base, visible: false })), true, 'screen off / background');
  assert.equal(statusChanged(a, statusSnapshot({ ...base, batt: { level: 0.97, charging: false } })), true, 'unplugged');
  assert.equal(statusChanged(a, statusSnapshot({ ...base, batt: { level: 0.89, charging: true } })), true, 'a 10 % step');
  assert.equal(statusChanged(a, statusSnapshot({ ...base, batt: { level: 0.95, charging: true } })), false, 'within the step');
  assert.equal(statusChanged(a, statusSnapshot({ ...base, packs: [{ ...base.packs[0], connected: false }, base.packs[1]] })), true, 'a pack dropped');
  assert.equal(statusChanged(a, statusSnapshot({ ...base, hist: { ...base.hist, backend: 'memory' } })), true, 'history fell back to memory');
  assert.equal(statusChanged(null, a), true);
});

test('how a reader went away: replays of the h46 (screen off, tab gone) and n11 (killed with the screen on) endings', () => {
  // h46, 2026-10-05: the page went to the background (screen off), its last words said so, then nothing; the relay saw 1006
  assert.equal(endReason({ code: 1006, lastWhy: 'hidden', lastVis: false }), 'hidden');
  // n11, 2026-10-05 07:32: last a minute tick with the page in front, then the socket dropped
  assert.equal(endReason({ code: 1006, lastWhy: 'tick', lastVis: true }), 'vanished');
  assert.equal(endReason({ code: 1001, lastWhy: 'tick', lastVis: true }), 'closed', 'going away = unload');
  assert.equal(endReason({ code: 1006, lastWhy: 'pagehide' }), 'closed', 'its last words were pagehide');
  assert.equal(endReason({ code: 1006, lastWhy: 'freeze' }), 'frozen');
  assert.equal(endReason({ code: 4001, lastWhy: 'tick', lastVis: true }), 'unanswered');
  assert.equal(endReason({}), 'unknown');
});

test('the viewer box: since when (the relay\'s word first), how, the last reading and the phone, in both languages', () => {
  const st = statusSnapshot({ ...base, why: 'hidden', visible: false, batt: { level: 0.34, charging: false } });
  const goneAt = t0 + 60_000, now = goneAt + (13 * 3600 + 2 * 60) * 1000;
  const m = offlineModel({ status: st, statusAt: t0, gone: { at: goneAt, code: 1006, reason: '' }, now });
  assert.equal(m.since, goneAt); assert.equal(m.reason, 'hidden'); assert.equal(m.code, 1006); assert.equal(m.lastReading, t0 - 1500);
  const en = offlineLines(m, I18N.en);
  assert.equal(en.head, `Reader offline since ${fmtWhen(goneAt)} (13 h 2 min ago)`);
  assert.equal(en.how, I18N.en.readerOffHow.hidden);
  assert.ok(en.last.startsWith('last reading: m-00 9 % · 51.5 V · -5.65 A ('), en.last);
  assert.equal(en.phone, 'phone battery 34 %, not charging');
  const th = offlineLines(m, I18N.th);
  assert.equal(th.head, `เครื่องอ่านออฟไลน์ตั้งแต่ ${fmtWhen(goneAt)} (13 ชม. 2 นาทีที่แล้ว)`);
  assert.equal(offlineModel({ status: st, statusAt: t0, gone: null, now: t0 + 90_000 }).since, t0, 'no word from the relay: the last status');
  assert.equal(offlineModel({ status: null, gone: null, now }), null, 'nothing known: no box');
  assert.equal(offlineModel({ status: null, statusAt: null, gone: { at: goneAt, code: 1001, reason: 'bye' }, now }).reason, 'closed', 'an old reader (no status) still gets the relay\'s word');
  assert.equal(fmtAgo(42_000, I18N.en), '42 s'); assert.equal(fmtAgo(5 * 60_000, I18N.en), '5 min'); assert.equal(fmtAgo(3 * 86_400_000 + 4 * 3600_000, I18N.en), '3 d 4 h');
  assert.equal(fmtAgo(3600_000, I18N.th), '1 ชม.'); assert.equal(fmtAgo(null, I18N.en), '-');
  assert.match(fmtWhen(t0), /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
});

test('the Reader phone sheet: every fact, in both languages; online, offline and no status yet', () => {
  const st = statusSnapshot({ ...base, why: 'hidden', visible: false });
  for (const [lang, T] of Object.entries(I18N)) {
    const m = sheetModel('reader', { reader: { status: st, live: false, model: offlineModel({ status: st, statusAt: t0, gone: { at: t0 + 1000, code: 1006, reason: '' }, now: t0 + 600_000 }) } }, T);
    assert.equal(m.title, T.readerSheetTitle, lang);
    assert.ok(m.lead.includes(T.readerOffHow.hidden), `${lang}: ${m.lead}`);
    const keys = m.rows.map(([k]) => k);
    for (const k of [T.rsStatusAt, 'm-00', 's-01', T.rsPhone, T.rsBrowser, T.rsHistory, T.rsMemory, T.rsStorage, T.rsLog, T.rsMissing, T.rsScreen, T.rsNet, T.rsRunning, T.rsPrev, T.rsVersion, T.rsCode]) assert.ok(keys.includes(k), `${lang}: row ${k}`);
    assert.ok(m.rows.find(([k]) => k === T.rsHistory)[1].includes('8174'));
    assert.deepEqual(m.actions.map((a) => a.id), ['ok']);
    const on = sheetModel('reader', { reader: { status: st, live: true, model: null } }, T);
    assert.equal(on.lead, T.readerOnline);
    const none = sheetModel('reader', { reader: { status: null, live: false, model: null } }, T);
    assert.equal(none.lead, T.rsNone); assert.equal(none.rows.length, 0);
  }
});

test('the boot trail: a load that never finished starting is named, with its error; a normal one says nothing', () => {
  const at = Date.parse('2026-10-05T03:45:00Z');
  assert.deepEqual(bootReport({ t: at, st: [['html', 0], ['module', 120], ['ready', 900]], err: null }), []);
  assert.deepEqual(bootReport(null), []); assert.deepEqual(bootReport({ t: at }), []);
  const blank = bootReport({ t: at, st: [['html', 0], ['stuck', 12000]], err: null });
  assert.ok(blank[0].startsWith('PREVIOUS PAGE LOAD at 2026-10-05T03:45:00.000Z NEVER FINISHED STARTING: it got as far as \'stuck\' (html +0 ms, stuck +12000 ms)'), blank[0]);
  assert.ok(blank.some((l) => l.includes('the app module never ran')));
  const failed = bootReport({ t: at, st: [['html', 0], ['error', 300]], err: 'load failed app.1234abcd.js' });
  assert.ok(failed.some((l) => l === '  its error: load failed app.1234abcd.js'), failed.join('\n'));
  assert.ok(bootReport({ t: at, st: [['html', 0], ['module', 100], ['ready', 800]], err: 'x is not defined @app.js:10' })[0].includes('started but logged an error'));
});

test('the last-run record carries the last status, and the next start logs it', () => {
  const st = statusSnapshot({ ...base, why: 'hidden', visible: false });
  const rec = lastRunRecord({ sid: 'abc123', now: t0 + 5000, mem: null, rows: 0, state: 'reader connected, sharing on', file: 'log-x.txt', clean: false, browser: 'chrome 154', status: st });
  const lines = lastRunReport(rec, t0 + 600_000, { browser: 'chrome 154' });
  assert.ok(lines.some((l) => l.startsWith('  its last status (600 s before this start): why=hidden vis=no')), lines.join('\n'));
  assert.equal(lastRunRecord({ sid: 's', now: 1, mem: null, rows: 0, state: '', file: null }).status, null);
});

test('upload of a stored file: one without the header line gets it on top (the relay takes only "BatRay v" text)', () => {
  assert.equal(uploadBody({ header: ['BatRay v0.9.71 · x'], ring: '', stored: 'BatRay v0.9.70 · old\n---\nlines' }).body, 'BatRay v0.9.70 · old\n---\nlines');
  assert.equal(uploadBody({ header: ['BatRay v0.9.71 · x'], ring: '', stored: '10:00:00.000  lines' }).body, 'BatRay v0.9.71 · x\n---\n10:00:00.000  lines');
});
