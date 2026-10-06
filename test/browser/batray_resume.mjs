// BatRay by ClearEvo.com - tests (batray_resume.mjs): a reopened reader resumes after a countdown; the setup checklist and its sign
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
// Owner ask 2026-10-06: "auto reconnect in a 30 s countdown on reopen; a checklist of what to enable in Chrome, Continue
// anyway, a warning sign right of 'updated' that lists what is done and not". The real page runs over the freeze test's
// fake Bluetooth device (its getDevices is the "flag on" case) and a fake relay socket. `?resumetest=N` shortens the
// countdown to N s; `?setupgate` turns the checklist gate on (the other browser tests tap Connect without it).
import { readFile } from 'node:fs/promises';
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
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` - got ${JSON.stringify(got).slice(0, 700)}`}`); if (!cond) fails++; };
const logs = (re) => evalJs(`window.__batrayTest.logLines().filter((l) => ${re}.test(l))`);
const sheet = () => evalJs(`({ kind: window.__batrayTest.uiState().sheet && window.__batrayTest.uiState().sheet.kind, title: document.getElementById('sheetTitle').textContent, lead: document.getElementById('sheetLead').textContent, acts: [...document.querySelectorAll('#sheetActs [data-act]')].map((b) => b.dataset.act), bar: document.getElementById('sheetBar').style.width })`);
const act = async (which) => { await evalJs(`document.querySelector('#sheetActs [data-act="${which}"]').click(); 1`); await sleep(400); };

const FAKE = (await readFile(new URL('./batray_freeze.mjs', import.meta.url), 'utf8')).match(/const FAKE = `([\s\S]*?)\n`;/)[1];
await send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  if (sessionStorage.getItem('noGetDevices')) delete navigator.bluetooth.getDevices;
  const rf = window.fetch.bind(window);
  window.fetch = async (u, i = {}) => { const url = String(u); if (url.endsWith('/batray/api/room') && (i.method || 'GET').toUpperCase() === 'POST') return new Response(JSON.stringify({ room: 'testroom0000000000000A', pub: 'testpub00000000000000A' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); return rf(u, i); };
  window.__wsAll = [];
  window.WebSocket = class { constructor(url) { this.url = url; this.readyState = 0; this.bufferedAmount = 0; window.__wsAll.push(this); setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 20); } send() {} close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; if (this.onclose) this.onclose({ code, reason, wasClean: true }); } };` });
const seed = (intent) => evalJs(`localStorage.setItem('batray_resume', JSON.stringify(${JSON.stringify(intent)})); localStorage.setItem('batray_share_name', 'seahut'); localStorage.removeItem('batray_share_last'); 1`);
const intent = { share: true, packs: [{ id: 'fake-1', name: 'n11' }], at: Date.now() };

// ---- 1. a reopened reader: the countdown says what it will do; Now does it, without the chooser ----
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(1500);
await seed(intent);
await send('Page.navigate', { url: `${BASE}/batray/?test&resumetest=30` }); await sleep(3500);
let sh = await sheet();
check('reopened: the resume sheet counts down from 30 s: share again, reconnect n11, Now / Cancel', sh.kind === 'resume' && /^In 2\d s: share live again on the last link · reconnect n11$/.test(sh.lead) && sh.acts.join('|') === 'now|cancel' && parseInt(sh.bar, 10) > 0, sh);
let lines = await logs('/resume: in 30 s/');
check('the plan is logged', lines.length === 1 && /share again on the last link; reconnect n11/.test(lines[0]), lines);
await act('now'); await sleep(3500);
const st = await evalJs(`({ share: window.__batrayTest.shareState().phase, pub: window.__wsAll.some((w) => /role=pub/.test(w.url)), chooser: window.__requestDevices, connects: window.__connects || 0, conn: window.__batrayTest.connState(), sheet: window.__batrayTest.uiState().sheet })`);
check('Now: sharing again (the pub socket opened) and n11 reconnected with no chooser', st.share === 'on' && st.pub && st.chooser === 0 && st.connects >= 1 && st.conn && st.conn.phase === 'connected' && !st.sheet, st);
lines = await logs('/resume: (Now tapped|sharing again|reconnecting n11 without the chooser)/');
check('...each step logged', lines.length === 3, lines);

// ---- 2. Cancel resumes nothing ----
await seed(intent);
await send('Page.navigate', { url: `${BASE}/batray/?test&resumetest=30&n=2` }); await sleep(2500);
await act('cancel'); await sleep(1500);
const c = await evalJs(`({ share: window.__batrayTest.shareState().phase, packs: window.__batrayTest.connState(), connects: window.__connects || 0 })`);
check('Cancel: no share, no connect', c.share === 'off' && c.packs === null && c.connects === 0, c);
check('...and the log says so', (await logs('/resume: cancelled/')).length === 1);

// ---- 3. the countdown runs out by itself ----
await seed({ share: true, packs: [], at: Date.now() });
await send('Page.navigate', { url: `${BASE}/batray/?test&resumetest=2&n=3` }); await sleep(4500);
const run = await evalJs(`({ share: window.__batrayTest.shareState().phase, sheet: window.__batrayTest.uiState().sheet })`);
check('left alone, the countdown runs out and the share resumes', run.share === 'on' && !run.sheet, run);

// ---- 4. no getDevices (the flag off, as on both phones today): the share resumes, the BMS needs a tap, said so ----
await evalJs(`sessionStorage.setItem('noGetDevices', '1'); 1`);
await seed(intent);
await send('Page.navigate', { url: `${BASE}/batray/?test&resumetest=2&n=4` }); await sleep(1200);
sh = await sheet();
check('without getDevices the sheet says n11 needs a tap on Connect', sh.kind === 'resume' && /n11: needs a tap on Connect/.test(sh.lead), sh);
await sleep(3500);
const nf = await evalJs(`({ share: window.__batrayTest.shareState().phase, toast: document.getElementById('toast').textContent, connects: window.__connects || 0 })`);
check('...the share resumes, no connect is tried, the toast says to tap Connect', nf.share === 'on' && nf.connects === 0 && /Tap Connect for n11/.test(nf.toast), nf);
await evalJs(`sessionStorage.removeItem('noGetDevices'); localStorage.removeItem('batray_resume'); 1`);

// ---- 5. the checklist on Connect: Continue anyway, a Done that sticks, all in the log ----
await evalJs(`localStorage.removeItem('batray_setup_done'); 1`);
await send('Page.navigate', { url: `${BASE}/batray/?test&setupgate&n=5` }); await sleep(2500);
await evalJs(`document.getElementById('connectBig').click(); 1`); await sleep(600);
sh = await sheet();
const items = await evalJs(`[...document.querySelectorAll('#sheetItems .item.ck')].map((i) => ({ cls: i.className, txt: i.textContent, tog: !!i.querySelector('[data-tog]') }))`);
check('tap Connect: the checklist, with Continue anyway and Cancel', sh.kind === 'checklist' && sh.acts.join('|') === 'go|cancel' && /of 14 ready/.test(sh.lead), sh);
check('...14 rows; the flag row is ok here (getDevices), the two Chrome steps wait for Done', items.length === 14 && /ck-ok/.test(items[2].cls) && items.filter((i) => i.tog).length === 2 && items.filter((i) => /ck-todo/.test(i.cls)).length === 2, items);
await evalJs(`document.querySelector('#sheetItems [data-tog="chromeUpdate"]').click(); 1`); await sleep(400);
const after = await evalJs(`({ cls: document.querySelector('#sheetItems [data-tog="chromeUpdate"]').closest('.item').className, done: localStorage.getItem('batray_setup_done') })`);
check('Done on "Chrome auto-update off" marks it in place and keeps it', /ck-done/.test(after.cls) && after.done === '["chromeUpdate"]', after);
await act('go'); await sleep(1500);
const go = await evalJs(`({ chooser: window.__requestDevices, conn: window.__batrayTest.connState() })`);
check('Continue anyway goes on to the chooser and connects', go.chooser === 1 && go.conn && go.conn.phase === 'connected', go);
lines = await logs('/setup: (chromeUpdate confirmed|continue anyway)/');
check('the log has the Done and the continue-anyway with what was missing', lines.length === 2 && /continue anyway - setup: \d+\/14 ready/.test(lines[1]), lines);

// ---- 6. the sign by "updated" while running; tap -> the list with Close; the status carries the summary ----
await sleep(1500);
const sign = await evalJs(`(() => { const g = document.getElementById('setupWarn'), u = document.getElementById('updated'); const gb = g.getBoundingClientRect(), ub = u.getBoundingClientRect(); return { hidden: g.hasAttribute('hidden'), gx: gb.left, ux: ub.right, gy: gb.top, uy: ub.top, w: gb.width }; })()`);
check('the ⚠ shows right of "updated" on a running reader with steps left', !sign.hidden && sign.gx >= sign.ux && Math.abs(sign.gy - sign.uy) < 12 && sign.w > 0, sign);
await evalJs(`document.getElementById('setupWarn').dispatchEvent(new MouseEvent('click', { bubbles: true })); 1`); await sleep(400);
sh = await sheet();
const rows = await evalJs(`[...document.querySelectorAll('#sheetRows .k')].map((e) => e.textContent)`);
check('tapping it opens the list with Close, the Chrome version and the flag row', sh.kind === 'checklist' && sh.acts.join('|') === 'ok' && rows.includes('Browser') && rows.includes('Chrome remembers Bluetooth permissions'), { sh, rows });
await act('ok');
const ss = await evalJs(`(() => { window.__batrayTest.statusTick('tick'); return window.__batrayTest.statusState().last.setup; })()`);
check('the reader status carries the checklist summary', ss && ss.total === 14 && ss.ready >= 1, ss);
for (const [w, h] of [[500, 900], [1440, 900]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 }); await sleep(1500);
  const r = await evalJs(`(() => { const g = document.getElementById('setupWarn').getBoundingClientRect(), svg = document.getElementById('flow').getBoundingClientRect(), body = document.querySelectorAll('#gBatt > rect')[1].getBoundingClientRect(); const hit = g.right > body.left && g.left < body.right && g.bottom > body.top && g.top < body.bottom; return { inside: g.left >= svg.left && g.right <= svg.right, hit }; })()`);
  check(`${w}px: the sign sits inside the picture, clear of the battery`, r.inside && !r.hit, r);
}
await send('Emulation.clearDeviceMetricsOverride');

const thrown = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
check('no page exceptions', thrown.length === 0, thrown);
ws.close();
console.log(fails ? 'BATRAY RESUME TEST FAILED' : 'batray resume test ok');
process.exit(fails ? 1 : 0);
