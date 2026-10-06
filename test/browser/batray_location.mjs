// BatRay by ClearEvo.com - tests (batray_location.mjs): the reader's location in its status; history greyed out when nothing can be kept
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
// Owner asks 2026-10-06: (1) "a location checkbox under the logging checkbox in the History tab, default on; the
// checklist checks it is on and approved"; (2) "without SQLite file storage, drop and grey out with the reason instead
// of risking the RAM limit". The position is emulated over CDP and the permission granted; the share runs over a fake
// relay socket and its status envelopes are decrypted with the link key. The memory-only store is forced with the
// store's own lock-out (what a stuck pool does on a phone).
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

await send('Browser.grantPermissions', { origin: BASE, permissions: ['geolocation'] });
await send('Emulation.setGeolocationOverride', { latitude: 13.756331, longitude: 100.501765, accuracy: 18 });
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  const rf = window.fetch.bind(window);
  window.fetch = async (u, i = {}) => { const url = String(u); if (url.endsWith('/batray/api/room') && (i.method || 'GET').toUpperCase() === 'POST') return new Response(JSON.stringify({ room: 'testroom0000000000000A', pub: 'testpub00000000000000A' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); return rf(u, i); };
  window.__wsSent = [];
  window.WebSocket = class { constructor(url) { this.url = url; this.readyState = 0; this.bufferedAmount = 0; setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 20); } send(s) { window.__wsSent.push(JSON.parse(s)); } close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; if (this.onclose) this.onclose({ code, reason, wasClean: true }); } };` });
const decryptStatus = `(async () => {
  const L = await import('/batray/live-logic.js');
  const key = await L.importKey(new URL(window.__batrayTest.pubLink()).hash.replace('#k=', ''));
  const out = [];
  for (const m of window.__wsSent.filter((x) => x.type === 'd' && x.slot === 'status')) out.push((await L.decrypt(key, Uint8Array.from(atob(m.b), (c) => c.charCodeAt(0)))).v);
  return out;
})()`;

// ---- 1. location: off by default, read once ticked and allowed, into the encrypted status, never into a log line ----
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(1500);
await evalJs(`localStorage.removeItem('batray_location'); localStorage.removeItem(window.__batrayTest.tabKey('share_last')); 1`);
await send('Page.navigate', { url: `${BASE}/batray/?test&n=1` }); await sleep(3000);
let st = await evalJs(`({ box: document.getElementById('locKeep').checked, inHistory: !!document.getElementById('locKeep').closest('#trendCard'), afterLog: document.getElementById('logKeep').closest('.check').nextElementSibling.contains(document.getElementById('locKeep')), loc: window.__batrayTest.locState() })`);
check('the checkbox is OFF by default (consent first, 0.9.75), right under "keep debug logs" in the History card', !st.box && st.inHistory && st.afterLog, st);
check('...so no fix is read, even with Chrome already allowing it', st.loc.on === false && st.loc.fix === null, st.loc);
check('...and the log says nothing about a fix', (await logs('/location: fix/')).length === 0);
await evalJs(`document.getElementById('locKeep').click(); 1`); await sleep(1500);
st = await evalJs(`({ stored: localStorage.getItem('batray_location'), loc: window.__batrayTest.locState() })`);
check('ticked: saved as 1, the fix is read (Chrome allows it already)', st.stored === '1' && st.loc.perm === 'granted' && st.loc.fix && st.loc.fix.lat === 13.75633 && st.loc.fix.lon === 100.50177 && st.loc.fix.acc === 18, st);
await send('Page.navigate', { url: `${BASE}/batray/?test&n=2` }); await sleep(3000);
check('after a reload the choice holds and a fix is read at start', !!(await evalJs(`document.getElementById('locKeep').checked && window.__batrayTest.locState().fix`)));
await evalJs(`document.getElementById('share').click(); 1`); await sleep(300);
await evalJs(`document.getElementById('shareGo').click(); 1`); await sleep(2000);
let sent = await evalJs(decryptStatus);
check('the status sent to viewers carries the position (encrypted with the link key)', sent.length >= 1 && sent[0].loc && sent[0].loc.lat === 13.75633 && sent[0].loc.lon === 100.50177, sent.map((x) => x.loc));
const all = (await evalJs(`window.__batrayTest.logLines().join('\\n')`));
check('no log line holds the coordinates', !all.includes('13.756') && !all.includes('100.50'), (all.match(/.*13\.756.*|.*100\.50.*/g) || []).slice(0, 3));
check('...the log says a fix was taken and how good', (await logs('/location: fix ±18 m/')).length >= 1 && (await logs('/status: .*loc=fix ±18 m/')).length >= 1);
let setup = await evalJs(`(() => { window.__batrayTest.statusTick('tick'); return window.__batrayTest.statusState().last.setup; })()`);
check('the checklist counts location as on and allowed', setup && !setup.missing.includes('location'), setup);

// ---- 2. turned off: no position anywhere, the checklist names it ----
await evalJs(`document.getElementById('locKeep').click(); 1`); await sleep(300);
st = await evalJs(`({ stored: localStorage.getItem('batray_location'), loc: window.__batrayTest.locState() })`);
check('unticked: saved off, the fix dropped', st.stored === '0' && st.loc.on === false && st.loc.fix === null, st);
await evalJs(`(() => { window.__batrayTest.statusTick('visible'); return 1; })()`); await sleep(600);
sent = await evalJs(decryptStatus);
check('the next status carries no position', sent.length >= 2 && sent[sent.length - 1].loc === null, sent.map((x) => x.loc));
setup = await evalJs(`window.__batrayTest.statusState().last.setup`);
check('...and the checklist takes it as the person\'s choice: not missing, "off", no warning for it (0.9.76)', !setup.missing.includes('location') && setup.off.includes('location'), setup);
await evalJs(`document.getElementById('locKeep').click(); 1`); await sleep(1500);
check('ticked again: a fix at once (the tap)', !!(await evalJs('window.__batrayTest.locState().fix')));
// ticked but Chrome blocks it: that is the one case worth the warning
await send('Browser.setPermission', { origin: BASE, permission: { name: 'geolocation' }, setting: 'denied' }); await sleep(800);
setup = await evalJs(`(() => { window.__batrayTest.statusTick('tick'); return window.__batrayTest.statusState().last.setup; })()`);
check('ticked but blocked in Chrome: the checklist says location is missing', setup.missing.includes('location'), { setup, loc: await evalJs('window.__batrayTest.locState()') });
await send('Browser.setPermission', { origin: BASE, permission: { name: 'geolocation' }, setting: 'granted' }); await sleep(500);

// ---- 3. no file storage: nothing kept, the card greyed with the reason ----
await send('Page.navigate', { url: `${BASE}/batray/?test&n=3` }); await sleep(2500);
await evalJs(`window.__batrayTest.histLockOut(); 1`); await sleep(500);
await evalJs(`(() => { const T = window.__batrayTest; const d = { soc: 77, packV: 52.1, current: -4.2, power: -219, cells: [{ v: 3.25 }, { v: 3.26 }], cellSum: 6.51, plausible: true, variant: 'JK02_32S' }; for (let i = 0; i < 5; i++) T.remoteTake('far', d, Date.now() - (5 - i) * 3000, { t: Date.now() - (5 - i) * 3000, id: i + 1, p: 'far' }); return 1; })()`);
await sleep(1500);
st = await evalJs(`({ h: window.__batrayTest.histState(), off: window.__batrayTest.histOffState(), log: window.__batrayTest.logState() })`);
check('memory-only: no rows queued, nothing pending in RAM', st.h.backend === 'memory' && st.h.pending === 0, { backend: st.h.backend, pending: st.h.pending });
check('the History card shows, greyed, with the reason (reload: storage did not start)', st.off.off && st.off.grey && st.off.cardShown && /did not start in this tab\. Reload the page/.test(st.off.text), st.off);
check('the debug log keeps nothing in memory either (the ring buffer is all)', st.log.pending === 0, st.log.pending);
check('the log says readings are not kept', (await logs('/history: no file storage in this tab - readings are shown but not kept/')).length === 1);
for (const [w, h] of [[500, 900], [1440, 900]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 }); await sleep(400);
  const r = await evalJs(`(() => { const b = document.getElementById('histOff').getBoundingClientRect(); return { w: b.width, right: b.right, vw: innerWidth, h: b.height }; })()`);
  check(`${w}px: the reason fits the width`, r.w > 0 && r.right <= r.vw && r.h >= 12, r);
}
await send('Emulation.clearDeviceMetricsOverride');

// ---- 4. the Sony of 2026-10-05 (Chrome 96, no file storage for SQLite): the reason names the update ----
await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 11; SO-51A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.104 Mobile Safari/537.36', platform: 'Linux armv8l' });
await send('Page.navigate', { url: `${BASE}/batray/?test&n=4` }); await sleep(2500);
await evalJs(`window.__batrayTest.histLockOut(); 1`); await sleep(500);
const old = await evalJs('window.__batrayTest.histOffState()');
check('Chrome 96: "History is not kept on this phone: Chrome 96 ... needs Chrome 108 or newer. Update Chrome"', old.off && /not kept on this phone: Chrome 96 cannot store files for BatRay \(it needs Chrome 108 or newer\)\. Update Chrome from the Play Store/.test(old.text), old);
await send('Emulation.setUserAgentOverride', { userAgent: '' });

const thrown = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
check('no page exceptions', thrown.length === 0, thrown);
ws.close();
console.log(fails ? 'BATRAY LOCATION TEST FAILED' : 'batray location test ok');
process.exit(fails ? 1 : 0);
