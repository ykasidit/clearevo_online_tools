// BatRay by ClearEvo.com - the browser gate and the time stamps under "updated" (tests)
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
import { detectBrowser, detectPlatform, compatCheck, updateHelp, compatLogLine, fmtVersion, MIN, NEED } from '../public/batray/compat-logic.js';
import { sheetModel } from '../public/batray/ui-logic.js';
import { clockMs, stampLines } from '../public/batray/view-logic.js';
import { I18N } from '../public/batray/i18n.js';

// the two phones of the 2026-10-05 logs, verbatim
const SONY = 'Mozilla/5.0 (Linux; Android 11; SO-51A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.104 Mobile Safari/537.36';
const VIEWER = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36';
const ALL = Object.fromEntries(NEED.reader.map((k) => [k, true]));
const noBt = { ...ALL, bluetooth: false };

test('the reader phone of the 2026-10-05 log (Chrome 96 on a Sony) is refused with "too old", the viewer phone (Chrome 153) passes both roles', () => {
  const sony = detectBrowser({ ua: SONY });
  assert.deepEqual(sony, { name: 'chrome', engine: 'chromium', version: [96, 0], os: 'android', osKnown: true });
  const c = compatCheck('reader', sony, ALL);
  assert.equal(c.ok, false); assert.equal(c.why, 'too-old'); assert.deepEqual(c.tooOld, { have: [96, 0], min: MIN.chromium });
  assert.equal(compatLogLine('reader', sony, c), 'compat: reader chrome 96 (chromium) on android: BLOCKED - version 96 < 108');
  assert.equal(compatCheck('viewer', sony, ALL).why, 'too-old', 'the viewer stores history too: the same floor');
  const v = detectBrowser({ ua: VIEWER });
  for (const role of ['reader', 'viewer']) assert.equal(compatCheck(role, v, ALL).ok, true, role);
  assert.equal(compatLogLine('viewer', v, compatCheck('viewer', v, ALL)), 'compat: viewer chrome 153 (chromium) on android: ok');
  assert.deepEqual(updateHelp(sony, c), { url: 'https://play.google.com/store/apps/details?id=com.android.chrome', link: 'store', steps: 'playStore' });
});

test('the floor is exactly the minimum: 107 refused, 108 accepted; Firefox 113 / 114; Safari 16.3 / 16.4', () => {
  const chrome = (n) => detectBrowser({ ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${n}.0.0.0 Safari/537.36` });
  assert.equal(compatCheck('reader', chrome(107), ALL).why, 'too-old'); assert.equal(compatCheck('reader', chrome(108), ALL).ok, true);
  const ff = (n) => detectBrowser({ ua: `Mozilla/5.0 (Android 13; Mobile; rv:${n}.0) Gecko/${n}.0 Firefox/${n}.0` });
  assert.equal(compatCheck('viewer', ff(113), noBt).why, 'too-old'); assert.equal(compatCheck('viewer', ff(114), noBt).ok, true);
  const ios = (maj, min) => detectBrowser({ ua: `Mozilla/5.0 (iPhone; CPU iPhone OS ${maj}_${min} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${maj}.${min} Mobile/15E148 Safari/604.1` });
  assert.equal(compatCheck('viewer', ios(16, 3), noBt).why, 'too-old'); assert.equal(compatCheck('viewer', ios(16, 4), noBt).ok, true);
  assert.equal(fmtVersion([16, 4]), '16.4'); assert.equal(fmtVersion([108, 0]), '108'); assert.equal(fmtVersion(null), '?');
});

test('a reader needs Web Bluetooth: Firefox and every iPhone browser are told to use another browser or device, never "update"; Firefox can still be a viewer', () => {
  const ff = detectBrowser({ ua: 'Mozilla/5.0 (Android 13; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0' });
  const r = compatCheck('reader', ff, noBt);
  assert.equal(r.why, 'no-bluetooth');
  assert.deepEqual(updateHelp(ff, r), { url: 'https://play.google.com/store/apps/details?id=com.android.chrome', link: 'store', steps: 'useChromeAndroid' });
  assert.equal(compatCheck('viewer', ff, noBt).ok, true);
  const crios = detectBrowser({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1' });
  assert.deepEqual([crios.name, crios.engine, crios.version, crios.os], ['chrome', 'webkit', [17, 5], 'ios'], 'Chrome on an iPhone is Safari\'s engine at the iOS version');
  const rc = compatCheck('reader', crios, noBt);
  assert.equal(rc.why, 'no-bluetooth'); assert.deepEqual(updateHelp(crios, rc), { url: null, link: null, steps: 'iphoneReader' });
  assert.equal(compatCheck('viewer', crios, noBt).ok, true);
  const macFf = detectBrowser({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0' });
  assert.deepEqual(updateHelp(macFf, compatCheck('reader', macFf, noBt)), { url: 'https://www.google.com/chrome', link: 'site', steps: 'useChromeDesktop' });
  // an old Chrome without Bluetooth gets it by updating: that is "too old", not "another browser"
  const ancient = detectBrowser({ ua: SONY.replace('Chrome/96', 'Chrome/50') });
  assert.equal(compatCheck('reader', ancient, noBt).why, 'too-old');
});

test('Chromium derivatives are read by their Chromium version and sent to their own store page; unknown platform -> Android', () => {
  const edge = detectBrowser({ ua: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Mobile Safari/537.36 EdgA/104.0.1293.70' });
  assert.deepEqual([edge.name, edge.engine, edge.version], ['edge', 'chromium', [104, 0]]);
  assert.equal(updateHelp(edge, compatCheck('reader', edge, ALL)).url, 'https://play.google.com/store/apps/details?id=com.microsoft.emmx');
  const sam = detectBrowser({ ua: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36' });
  assert.deepEqual([sam.name, sam.version], ['samsung', [115, 0]]);
  const opera = detectBrowser({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36 OPR/86.0.0.0' });
  assert.deepEqual([opera.name, opera.version, opera.os], ['opera', [100, 0], 'windows']);
  assert.deepEqual(updateHelp(opera, compatCheck('reader', opera, ALL)), { url: null, link: null, steps: 'deskOpera' });
  const brave = detectBrowser({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', brave: true });
  assert.equal(brave.name, 'brave'); assert.equal(compatCheck('reader', brave, noBt).why, 'no-bluetooth', 'Brave keeps Web Bluetooth off');
  const edgeDesk = detectBrowser({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36 Edg/99.0.1150.36' });
  assert.deepEqual(updateHelp(edgeDesk, compatCheck('reader', edgeDesk, ALL)), { url: 'https://www.microsoft.com/edge', link: 'site', steps: 'deskEdge' });
  const cros = detectBrowser({ ua: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36' });
  assert.deepEqual(updateHelp(cros, compatCheck('reader', cros, ALL)), { url: null, link: null, steps: 'chromeos' });
  assert.deepEqual(detectPlatform('SomethingElse/1.0'), { os: 'android', known: false });
  assert.deepEqual(detectPlatform('', 'macOS'), { os: 'mac', known: true });
  assert.deepEqual(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', '', 5), { os: 'ios', known: true }, 'an iPad asks for the desktop site');
  const odd = detectBrowser({ ua: 'SomethingElse/1.0' });
  assert.deepEqual(odd, { name: 'unknown', engine: 'unknown', version: null, os: 'android', osKnown: false });
  assert.equal(compatCheck('viewer', odd, ALL).ok, true, 'an engine we do not know is judged by its features alone');
  assert.equal(updateHelp(odd, { why: 'missing' }).url, 'https://play.google.com/store/apps/details?id=com.android.chrome');
});

test('a missing API is named, also when the version looks fine; insecure page or no worker blocks both roles', () => {
  const v = detectBrowser({ ua: VIEWER });
  const c = compatCheck('viewer', v, { ...ALL, opfs: false, compression: false });
  assert.equal(c.why, 'missing'); assert.deepEqual(c.missing, ['opfs', 'compression']);
  assert.equal(compatLogLine('viewer', v, c), 'compat: viewer chrome 153 (chromium) on android: BLOCKED - missing opfs, compression');
  assert.equal(compatCheck('reader', v, { ...ALL, secure: false }).why, 'missing');
  const sony = detectBrowser({ ua: SONY });
  const both = compatCheck('reader', sony, { ...ALL, opfs: false });
  assert.match(compatLogLine('reader', sony, both), /version 96 < 108 \(also missing opfs\)$/);
});

test('the compat sheet says why, what to do and offers the store or download page, in both languages', () => {
  const sony = detectBrowser({ ua: SONY });
  const check = compatCheck('reader', sony, ALL);
  for (const [lang, T] of Object.entries(I18N)) {
    const m = sheetModel('compat', { compat: { role: 'reader', browser: sony, check, help: updateHelp(sony, check) } }, T);
    assert.equal(m.title, T.compatTitle(true), lang);
    assert.ok(m.lead.includes('96') && m.lead.includes('108') && m.lead.includes(T.compatSteps.playStore), `${lang}: ${m.lead}`);
    assert.deepEqual(m.actions.map((a) => a.id), ['update', 'ok']); assert.equal(m.actions[0].label, T.compatOpenStore);
    assert.ok(m.rows.some(([k, val]) => k === T.shBrowser && val === 'Chrome 96') && m.rows.some(([k, val]) => k === T.shDevice && val === 'Android'), JSON.stringify(m.rows));
    for (const key of ['playStore', 'iosUpdate', 'chromeos', 'deskChrome', 'deskChromium', 'deskBrave', 'deskOpera', 'deskEdge', 'deskFirefox', 'deskSafari', 'useChromeAndroid', 'useChromeDesktop', 'iphoneReader']) assert.ok(T.compatSteps[key], `${lang} ${key}`);
  }
  const iph = detectBrowser({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  const ci = compatCheck('reader', iph, noBt);
  const mi = sheetModel('compat', { compat: { role: 'reader', browser: iph, check: ci, help: updateHelp(iph, ci) } }, I18N.en);
  assert.deepEqual(mi.actions.map((a) => a.id), ['ok'], 'no store to send an iPhone to: Close only');
  assert.ok(mi.lead.includes(I18N.en.compatSteps.iphoneReader));
  assert.deepEqual(sheetModel('compat', {}, I18N.en).actions, [], 'no check, nothing to say');
});

test('time stamps under "updated": three-digit milliseconds, the reader line always, the local line on a viewer only', () => {
  const t = new Date(2026, 9, 5, 4, 5, 6, 7).getTime();
  assert.equal(clockMs(t), '04:05:06.007');
  assert.equal(clockMs(t + 993), '04:05:07.000');
  assert.equal(clockMs(new Date(2026, 9, 5, 23, 59, 59, 120).getTime()), '23:59:59.120');
  const T = I18N.en;
  assert.deepEqual(stampLines({ readerAt: t, localAt: t + 412, viewer: true }, T), ['reader 04:05:06.007', 'local  04:05:06.419']);
  assert.deepEqual(stampLines({ readerAt: t, localAt: t, viewer: false }, T), ['reader 04:05:06.007']);
  assert.deepEqual(stampLines({ readerAt: null, localAt: null, viewer: true }, T), []);
  assert.deepEqual(stampLines({ readerAt: t, localAt: t + 1, viewer: true }, I18N.th), ['อ่าน 04:05:06.007', 'รับ  04:05:06.008']);
});
