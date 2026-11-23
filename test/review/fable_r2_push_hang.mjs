// BatRay by ClearEvo.com - review tests (fable, round 2) F2-3: a push sign-up that never answers is started again at every socket reopen, and nothing says so
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
//
// Since 0.9.91 the "reader stopped - tap to reopen" push is what brings a frozen reader back (the freeze closes the
// socket with 4004, the relay pushes 3 min later), so its sign-up matters more than before. syncPush() runs at
// every socket open (0.9.91: also after every freeze/resume) and every minute while the room has no endpoint; it
// awaits navigator.serviceWorker.ready, getSubscription() and pushManager.subscribe() with no deadline and no
// single flight. A subscribe() that never settles (a phone with no working push service, no network to it - old
// phones without current Google services are what readers run on) is not a failure to push-logic (failedAt stays
// 0), so: every reopen and every minute start another register + key fetch + subscribe beside the ones still
// pending, for as long as the page lives, and the log never gets a "push: setup failed" line - the checklist says
// "push missing" with no reason. Not seen in the uploaded logs (notifications are "default" on every reader there,
// so the sign-up never ran); proven here with a subscribe() that never settles.
//
// The real page, notifications granted, the relay's key stubbed, four freeze/resume cycles (four socket reopens).
// Expected: one sign-up in flight at a time, and a logged failure once it has had 30 s.
// Run: CDP=9427 PORT=8412 node test/review/fable_r2_push_hang.mjs
import { openTab, FAKE_RELAY, BASE, sleep } from './fable_cdp.mjs';

const t = await openTab();
await t.send('Browser.grantPermissions', { origin: BASE, permissions: ['notifications'] }).catch((e) => console.log('grant:', e.message));
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_RELAY + `
  { const f1 = window.fetch; window.fetch = async (u, i = {}) => (String(u).endsWith('/batray/api/push/key') ? new Response(JSON.stringify({ key: 'BPm3' + 'A'.repeat(83) }), { status: 200, headers: { 'Content-Type': 'application/json' } }) : f1(u, i)); }
  window.__subs = 0;
  if (typeof PushManager !== 'undefined') { PushManager.prototype.getSubscription = async () => null; PushManager.prototype.subscribe = () => { window.__subs++; return new Promise(() => {}); }; }` });
await t.send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(3000);
t.check('setup: notifications are allowed in this test', (await t.evalJs('Notification.permission')) === 'granted');
await t.evalJs(`document.getElementById('share').click(); 1`); await sleep(300);
await t.evalJs(`document.getElementById('shareGo').click(); 1`); await sleep(4000);
t.check('setup: the share is on and the sign-up reached subscribe()', (await t.evalJs('window.__subs')) === 1 && (await t.evalJs(`window.__batrayTest.shareState().phase`)) === 'on', await t.evalJs('window.__subs'));
for (let i = 0; i < 4; i++) {
  await t.send('Page.setWebLifecycleState', { state: 'frozen' }); await sleep(600);
  await t.send('Page.setWebLifecycleState', { state: 'active' }); await sleep(3500);
}
const opens = await t.evalJs(`window.__wsAll.filter((w) => /role=pub/.test(w.url)).length`);
const subs = await t.evalJs('window.__subs');
t.check('setup: the socket reopened after each freeze', opens >= 5, opens);
t.check(`F2-3: one push sign-up in flight at a time (subscribe() called once while the first has not answered, after ${opens - 1} reopens)`, subs === 1, { subscribeCalls: subs, socketOpens: opens });
await sleep(16000);                                                   // 30 s and more since the first subscribe()
const lines = await t.logs('/push: setup failed/');
t.check('F2-3: a sign-up that has not answered in 30 s is logged as failed (so the checklist\'s "push missing" has a reason)', lines.length >= 1, lines);
await t.done();
