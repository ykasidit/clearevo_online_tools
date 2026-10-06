// BatRay by ClearEvo.com - tests (batray_push.mjs): the reader signs up for the "reader stopped" push; the service worker shows it
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
// Owner ask 2026-10-06: "web push - reader not running, tap to reopen". The open-source Chromium here has no push
// service, so pushManager.subscribe is stubbed to hand back an FCM-shaped endpoint, and the relay calls are stubbed and
// recorded; the push itself is delivered to the REAL service worker with CDP ServiceWorker.deliverPushMessage, and the
// notification it shows is read back from the registration.
const PORT = +(process.env.PORT || 8077), CDP = +(process.env.CDP || 9333);
const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;
const targets = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { ok, err } = pending.get(d.id); pending.delete(d.id); if (d.error) err(new Error(JSON.stringify(d.error))); else ok(d.result); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((ok, err) => { const i = ++id; pending.set(i, { ok, err }); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((ok) => { ws.onopen = ok; });
await send('Runtime.enable'); await send('Page.enable'); await send('ServiceWorker.enable');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
let fails = 0;
const check = (name, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` - got ${JSON.stringify(got).slice(0, 700)}`}`); if (!cond) fails++; };
const logs = (re) => evalJs(`window.__batrayTest.logLines().filter((l) => ${re}.test(l))`);

await send('Browser.grantPermissions', { origin: BASE, permissions: ['notifications'] }).catch((e) => console.log('grant:', e.message));
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__calls = [];
  const rf = window.fetch.bind(window);
  window.fetch = async (u, i = {}) => {
    const url = String(u), m = (i.method || 'GET').toUpperCase();
    if (url.endsWith('/batray/api/room') && m === 'POST') return new Response(JSON.stringify({ room: 'testroom0000000000000A', pub: 'testpub00000000000000A' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/batray/api/push/key')) return new Response(JSON.stringify({ key: 'BPm3' + 'A'.repeat(83) }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (/\\/batray\\/api\\/room\\/[^/]+\\/push/.test(url)) { window.__calls.push({ url, m, body: i.body || null }); return new Response('{"ok":true,"afterS":180}', { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    return rf(u, i);
  };
  if (typeof PushManager !== 'undefined') {
    PushManager.prototype.getSubscription = async () => null;
    PushManager.prototype.subscribe = async (o) => { window.__subOpts = { userVisibleOnly: o.userVisibleOnly, keyLen: o.applicationServerKey.byteLength }; return { endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint' }; };
  }
  window.WebSocket = class { constructor(url) { this.url = url; this.readyState = 0; this.bufferedAmount = 0; setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen(); }, 20); } send() {} close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; if (this.onclose) this.onclose({ code, reason, wasClean: true }); } };` });

// ---- 1. sharing with notifications allowed: the page signs up and gives the room its endpoint ----
await send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(2000);
check('notifications are allowed in this test', (await evalJs('Notification.permission')) === 'granted');
await evalJs(`localStorage.removeItem('batray_share_last'); localStorage.setItem('batray_share_name', 'seahut'); document.getElementById('share').click(); 1`); await sleep(300);
await evalJs(`document.getElementById('shareName').value = 'seahut'; document.getElementById('shareGo').click(); 1`); await sleep(3500);
const calls = await evalJs('window.__calls');
check('the room gets this phone\'s push endpoint, with the publisher token', calls.length === 1 && calls[0].m === 'PUT' && /\/room\/testroom0000000000000A\/push\?token=testpub00000000000000A$/.test(calls[0].url) && JSON.parse(calls[0].body).endpoint === 'https://fcm.googleapis.com/fcm/send/test-endpoint', calls);
check('subscribed with userVisibleOnly and the server\'s 65-byte key', JSON.stringify(await evalJs('window.__subOpts')) === JSON.stringify({ userVisibleOnly: true, keyLen: 65 }), await evalJs('window.__subOpts'));
const lines = await logs('/push: set up/');
check('the log says it is set up, and by which push service', lines.length === 1 && /fcm\.googleapis\.com wakes Chrome here with "BatRay: seahut stopped"/.test(lines[0]), lines);
const cfg = await evalJs(`(async () => { const r = await (await caches.open('batray-push')).match('/batray/push-config'); return r ? r.json() : null; })()`);
check('the words for the notification are left in the cache (title with the channel name, body, the reader URL)', cfg && cfg.title === 'BatRay: seahut stopped' && /offline for 3 minutes/.test(cfg.body) && cfg.url === '/batray/?from=push', cfg);
const items = await evalJs(`(() => { window.__batrayTest.statusTick('tick'); return window.__batrayTest.statusState().last.setup; })()`);
check('the checklist counts the push as set up', items && !items.missing.includes('push'), items);

// ---- 2. a push arrives (the relay's, after 3 min offline): the real service worker shows the stopped notification ----
const regs = events.filter((e) => e.method === 'ServiceWorker.workerRegistrationUpdated').flatMap((e) => e.params.registrations).filter((r) => /\/batray\/$/.test(r.scopeURL));
const reg = regs[regs.length - 1];
check('the service worker is registered for /batray/', !!reg, regs);
if (reg) {
  await send('ServiceWorker.deliverPushMessage', { origin: BASE, registrationId: reg.registrationId, data: '' });
  await sleep(1500);
  const shown = await evalJs(`(async () => { const r = await navigator.serviceWorker.getRegistration('/batray/'); const n = await r.getNotifications({ tag: 'batray-reader-stopped' }); return n.map((x) => ({ title: x.title, body: x.body, url: x.data && x.data.url, push: x.data && x.data.push, ri: x.requireInteraction })); })()`);
  check('the push shows "BatRay: seahut stopped", the body, stays until tapped, and carries the reader URL', shown.length === 1 && shown[0].title === 'BatRay: seahut stopped' && /Tap to reopen/.test(shown[0].body) && shown[0].url === '/batray/?from=push' && shown[0].push === true && shown[0].ri === true, shown);
}

// ---- 3. a deliberate stop: the room forgets this phone (no "stopped" push for a stop on purpose) ----
await evalJs(`document.getElementById('share').click(); 1`); await sleep(800);
const after = await evalJs('window.__calls');
check('stopping the share deletes the endpoint from the room', after.length === 2 && after[1].m === 'DELETE' && /\/push\?token=testpub00000000000000A$/.test(after[1].url), after);
check('...and says so in the log', (await logs('/push: the room forgets this phone/')).length === 1);

// ---- 4. opened from the notification: logged, and the countdown is the normal resume ----
await send('Page.navigate', { url: `${BASE}/batray/?test&from=push` }); await sleep(2000);
check('a start from the notification is logged', (await logs('/start: opened from the "reader stopped" notification/')).length === 1);

const thrown = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text);
check('no page exceptions', thrown.length === 0, thrown);
ws.close();
console.log(fails ? 'BATRAY PUSH TEST FAILED' : 'batray push test ok');
process.exit(fails ? 1 : 0);
