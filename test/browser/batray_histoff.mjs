// BatRay by ClearEvo.com - tests (batray_histoff.mjs): no location, ever; history greyed out when nothing can be kept
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
// Owner asks 2026-10-06: (1) "drop all location stuff" (0.9.80, after 0.9.74-0.9.79 had it): this checks that none is
// taken even with Chrome allowing it, and that the browser itself refuses it; (2) "without SQLite file storage, drop and
// grey out with the reason instead of risking the RAM limit". The position is emulated over CDP and the permission granted; the share runs over a fake
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

// ---- 1. NO LOCATION (owner 2026-10-06, 0.9.80: "drop all location stuff ... coherent and trustable"): even with Chrome
// allowing it to this origin and an old setting left from 0.9.74-0.9.78, nothing asks, the browser refuses, nothing is sent
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(1500);
await evalJs(`localStorage.setItem('batray_location', '1'); localStorage.removeItem(window.__batrayTest.tabKey('share_last')); 1`);
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__geoCalls = 0; if (navigator.geolocation) { const g = navigator.geolocation; for (const m of ['getCurrentPosition', 'watchPosition']) { const f = g[m].bind(g); g[m] = (...a) => { window.__geoCalls++; return f(...a); }; } }` });
await send('Page.navigate', { url: `${BASE}/batray/?test&n=1` }); await sleep(3000);
let st = await evalJs(`(async () => ({ box: !!document.getElementById('locKeep'), calls: window.__geoCalls, oldSetting: localStorage.getItem('batray_location'), header: (await fetch('/batray/', { method: 'HEAD' })).headers.get('permissions-policy'), allowed: document.featurePolicy ? document.featurePolicy.allowsFeature('geolocation') : null }))()`);
check('the page is served with Permissions-Policy geolocation=() and Chrome reports location as not allowed for it', st.header === 'geolocation=()' && st.allowed === false, st);
check('no location control, no position ever asked for, the old 0.9.74-0.9.78 setting removed', !st.box && st.calls === 0 && st.oldSetting === null, st);
await evalJs(`document.getElementById('share').click(); 1`); await sleep(300);
await evalJs(`document.getElementById('shareGo').click(); 1`); await sleep(2000);
const sent = await evalJs(decryptStatus);
check('the statuses sent to viewers have no location field at all, and starting a share asks for none', sent.length >= 1 && sent.every((x) => !('loc' in x)) && (await evalJs('window.__geoCalls')) === 0, sent.map((x) => Object.keys(x)));
check('the log has no location lines', (await logs('/location|loc=/')).length === 0, await logs('/location|loc=/'));
const setup = await evalJs(`(() => { window.__batrayTest.statusTick('tick'); return window.__batrayTest.statusState().last.setup; })()`);
check('the checklist has no location row (13 rows)', setup && setup.total === 13, setup);

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
console.log(fails ? 'BATRAY HISTOFF TEST FAILED' : 'batray histoff test ok');
process.exit(fails ? 1 : 0);
