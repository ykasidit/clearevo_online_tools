// BatRay by ClearEvo.com - tests (batray_compat.mjs): the browser gate on the real page, and the time stamps under "updated"
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
//
// Owner ask 2026-10-05. The page runs under a user agent the gate must refuse (the Sony's Chrome 96, an old Firefox
// opening a share link) and one it must let through (current Firefox as a viewer, this Chromium as a reader); a
// refused reader tap never reaches the Bluetooth chooser, a refused viewer never opens its socket, and the sheet's
// update button opens the store page for that platform. Then the reader's "updated" corner carries the reading's time
// to the millisecond, and a viewer's pack a second line with the arrival time.
const PORT = +(process.env.PORT || 8077), CDP = +(process.env.CDP || 9333);
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); if (d.error) err(new Error(JSON.stringify(d.error))); else ok(d.result); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let fails = 0;
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` - got ${JSON.stringify(got).slice(0, 600)}`}`); if (!cond) fails++; };
const SONY = 'Mozilla/5.0 (Linux; Android 11; SO-51A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.104 Mobile Safari/537.36';
const OLD_FF = 'Mozilla/5.0 (Android 12; Mobile; rv:110.0) Gecko/110.0 Firefox/110.0';
const NEW_FF = 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0';
const VIEW = `${BASE}/batray/?view=AbCdEfGhIjKlMnOpQrStUv&test#k=AbCdEfGhIjKlMnOpQrStUv`;
// window.open is recorded, not followed: the store page must not load inside the test
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; };' });
const asUa = (userAgent) => send('Emulation.setUserAgentOverride', { userAgent, platform: /Android/.test(userAgent) ? 'Linux armv8l' : '' });
const logSince = (re) => evalJs(`window.__batrayTest.logLines().filter((l) => ${re}.test(l))`);

// ---- 1. the reader phone of the 2026-10-05 log: Chrome 96 - the Connect tap opens the sheet, never the chooser ----
await asUa(SONY);
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(2500);
await evalJs(`document.getElementById('connectBig').click(); 1`); await sleep(500);
let st = await evalJs(`({ sheet: window.__batrayTest.uiState().sheet, title: document.getElementById('sheetTitle').textContent, lead: document.getElementById('sheetLead').textContent, acts: [...document.querySelectorAll('#sheetActs [data-act]')].map((b) => b.dataset.act + ':' + b.textContent), shown: !document.getElementById('sheet').hidden })`);
check('Chrome 96 + Connect: the compat sheet, saying version 96, needing 108, with the Play Store steps', st.shown && st.sheet && st.sheet.kind === 'compat' && st.title === 'This browser cannot be the reader' && /96/.test(st.lead) && /108/.test(st.lead) && /Play Store/.test(st.lead) && st.acts.join('|') === 'update:Open the Play Store|ok:Close', st);
let logs = await logSince('/compat: reader|conn: tap-connect|chooser/');
check('the log names the verdict, and no connect step ran', logs.some((l) => /compat: reader chrome 96 \(chromium\) on android: BLOCKED - version 96 < 108/.test(l)) && !logs.some((l) => /conn: tap-connect|chooser/.test(l)), logs);
await evalJs(`document.querySelector('#sheetActs [data-act="update"]').click(); 1`); await sleep(300);
const opened = await evalJs('window.__opened');
check('"Open the Play Store" opens Chrome\'s store page', opened.length === 1 && opened[0] === 'https://play.google.com/store/apps/details?id=com.android.chrome', opened);

// ---- 1b. a current Firefox as the reader: no Web Bluetooth there, the tap says to use Chrome or Edge ----
await asUa(NEW_FF);
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(2500);
await evalJs(`document.getElementById('connectBig').click(); 1`); await sleep(500);
st = await evalJs(`({ sheet: window.__batrayTest.uiState().sheet, lead: document.getElementById('sheetLead').textContent, acts: [...document.querySelectorAll('#sheetActs [data-act]')].map((b) => b.dataset.act) })`);
check('Firefox 131 + Connect: the sheet says it cannot reach Bluetooth, use Chrome or Edge, can still watch', st.sheet && st.sheet.kind === 'compat' && /cannot reach Bluetooth/.test(st.lead) && /Chrome or Edge/.test(st.lead) && st.acts.join('|') === 'update|ok', st);
await evalJs(`document.querySelector('#sheetActs [data-act="ok"]').click(); 1`); await sleep(300);

// ---- 2. an old Firefox opening a share link: the live view does not start, its socket never opens ----
await asUa(OLD_FF);
await send('Page.navigate', { url: VIEW }); await sleep(2500);
st = await evalJs(`({ sheet: window.__batrayTest.uiState().sheet, title: document.getElementById('sheetTitle').textContent, lead: document.getElementById('sheetLead').textContent, stat: document.getElementById('stat') ? document.getElementById('stat').textContent : '', acts: [...document.querySelectorAll('#sheetActs [data-act]')].map((b) => b.dataset.act) })`);
check('Firefox 110 + a share link: the viewer sheet (needs 114) and the status says the view did not start', st.sheet && st.sheet.kind === 'compat' && st.title === 'This browser cannot open the live view' && /110/.test(st.lead) && /114/.test(st.lead) && st.acts.join('|') === 'update|ok', st);
logs = await logSince('/compat: viewer|signal: socket/');
check('the viewer verdict is logged at start and no signalling socket was opened', logs.some((l) => /compat: viewer firefox 110 \(gecko\) on android: BLOCKED - version 110 < 114/.test(l)) && !logs.some((l) => /signal: socket/.test(l)), logs);
await evalJs(`document.querySelector('#sheetActs [data-act="update"]').click(); 1`); await sleep(300);
check('its update button opens Firefox\'s store page', (await evalJs('window.__opened')).join() === 'https://play.google.com/store/apps/details?id=org.mozilla.firefox', await evalJs('window.__opened'));

// ---- 3. a current Firefox as a viewer passes (it cannot be a reader: no Web Bluetooth there, the unit test covers it) ----
await asUa(NEW_FF);
await send('Page.navigate', { url: VIEW.replace('&test', '&test&again') }); await sleep(2500);
st = await evalJs(`({ sheet: window.__batrayTest.uiState().sheet, logs: window.__batrayTest.logLines().filter((l) => /compat: viewer/.test(l)) })`);
check('Firefox 131 as a viewer: ok, no sheet', !st.sheet && st.logs.length === 1 && /firefox 131 \(gecko\) on android: ok$/.test(st.logs[0]), st);

// ---- 4. this Chromium as a reader passes the gate: the tap goes on to the connect flow ----
await send('Emulation.setUserAgentOverride', { userAgent: '' });
// this headless Chromium has no Web Bluetooth: a chooser that never answers stands in for it
const fakeBt = await send('Page.addScriptToEvaluateOnNewDocument', { source: 'navigator.bluetooth = { requestDevice: () => new Promise(() => {}), getAvailability: async () => true, getDevices: async () => [] };' });
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(2500);
await evalJs(`document.getElementById('connectBig').click(); 1`); await sleep(800);
logs = await logSince('/compat: reader|conn: tap-connect/');
check('a current Chromium: the start line says ok and the tap reaches the connect flow', logs.some((l) => /compat: reader chrom\w+ \d+ \(chromium\) on \w+: ok/.test(l)) && logs.some((l) => /conn: tap-connect/.test(l)), logs);
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: fakeBt.identifier });

// ---- 5. the time under "updated": the reader's line with three-digit milliseconds; a viewer pack adds the arrival time ----
await send('Page.navigate', { url: `${BASE}/batray/?test&demo` }); await sleep(4000);
st = await evalJs(`({ upd: document.getElementById('updated').textContent, r: document.getElementById('updR').textContent, l: document.getElementById('updL').textContent, ry: +document.getElementById('updR').getAttribute('y'), uy: +document.getElementById('updated').getAttribute('y'), rs: getComputedStyle(document.getElementById('updR')).fontSize, us: getComputedStyle(document.getElementById('updated')).fontSize })`);
check('reader: one line "reader HH:MM:SS.mmm" under "updated", smaller text, no local line', /^reader \d\d:\d\d:\d\d\.\d{3}$/.test(st.r) && st.l === '' && st.ry > st.uy && parseFloat(st.rs) < parseFloat(st.us), st);
const r1 = st.r; await sleep(1500);
check('the reader line moves with new readings', (await evalJs(`document.getElementById('updR').textContent`)) !== r1, r1);
st = await evalJs(`(async () => {
  const T = window.__batrayTest; const t = Date.now() - 1234;
  T.remoteTake("far", JSON.parse(JSON.stringify(T.packData ? T.packData() : {})), t, null);
  document.querySelector('#packBar [data-pack="r-far"]').click();
  await new Promise((r) => { setTimeout(r, 1300); });
  const p2 = (n, w = 2) => String(n).padStart(w, '0'); const d = new Date(t);
  return { r: document.getElementById('updR').textContent, l: document.getElementById('updL').textContent, want: \`reader \${p2(d.getHours())}:\${p2(d.getMinutes())}:\${p2(d.getSeconds())}.\${p2(d.getMilliseconds(), 3)}\` };
})()`);
check('a viewer pack: the reader\'s own time on the first line, the arrival time on the second', st.r === st.want && /^local {2}\d\d:\d\d:\d\d\.\d{3}$/.test(st.l), st);
for (const [w, h] of [[500, 900], [1440, 900]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 }); await sleep(700);
  const box = await evalJs(`(() => { const b = (id) => document.getElementById(id).getBBox(); const r = b('updR'), l = b('updL'), u = b('updated'), hit = (a, c) => a.right > c.left && a.left < c.right && a.bottom > c.top && a.top < c.bottom, parts = [...document.querySelectorAll('#gBatt > rect')].map((e) => e.getBoundingClientRect()), lines = ['updR', 'updL'].map((i) => document.getElementById(i).getBoundingClientRect()); return { r: [r.x, r.y, r.width], l: [l.x, l.y, l.width], u: [u.x, u.y], overlapBatt: lines.some((a) => parts.some((c) => hit(a, c))) }; })()`);
  check(`${w}px: the two lines stack under "updated" and stay clear of the battery`, box.r[1] > box.u[1] && box.l[1] > box.r[1] && !box.overlapBatt, box);
}
await send('Emulation.clearDeviceMetricsOverride');

const thrown = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
check('no page exceptions', thrown.length === 0, thrown);
ws.close();
console.log(fails ? 'BATRAY COMPAT TEST FAILED' : 'batray compat test ok');
process.exit(fails ? 1 : 0);
