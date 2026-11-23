// BatRay by ClearEvo.com - review tests (fable, round 1) F1: a frozen reader tells the relay nothing, so nobody is told
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
// Evidence (uploaded reader logs, numbers only): a reader tab that goes to the background is frozen by Chrome
// Android 60 s later (two cases on Chrome 156: hidden -> "status: why=freeze" after 60 s and 61 s; one on Chrome 158
// after 88 s) and stays frozen until a person brings the tab back: 4.6 h, 22.3 h and 1.7 h in those logs. It is the
// most common way a run ends in the logs. A frozen page keeps its WebSocket open (nothing closes it, and a phone
// behind NAT sends no FIN), and the relay arms the "reader stopped - tap to reopen" push and the viewers' `gone`
// record ONLY in websocket_close / websocket_error (relay lib.rs record_pub_end). So for the commonest loss the
// push that exists to recover it never fires, and viewers get no "since when / how" from the relay.
//
// This freezes the real page with CDP (Page.setWebLifecycleState, the same freeze event Chrome Android fires) while
// it shares over a fake relay socket, and expects the reader's last act before the freeze to be closing its socket
// (so the room records the end and its 3 min push alarm starts), and a new socket after the resume.
// Run: CDP=9427 PORT=8412 node test/review/fable_r1_freeze_socket.mjs
import { openTab, FAKE_RELAY, BASE, sleep } from './fable_cdp.mjs';

const t = await openTab();
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_RELAY });
await t.send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(3000);
await t.evalJs(`document.getElementById('share').click(); 1`); await sleep(300);
await t.evalJs(`document.getElementById('shareGo').click(); 1`); await sleep(1500);
const before = await t.evalJs(`({ share: window.__batrayTest.shareState().phase, socks: window.__wsAll.filter((w) => /role=pub/.test(w.url)).map((w) => w.readyState) })`);
t.check('setup: the reader shares over one open publisher socket', before.share === 'on' && before.socks.length === 1 && before.socks[0] === 1, before);

await t.send('Page.setWebLifecycleState', { state: 'frozen' });
const frozenAt = Date.now();
await sleep(3000);                                                    // frozen: nothing in the page runs
const resumedAt = Date.now();
await t.send('Page.setWebLifecycleState', { state: 'active' });
await sleep(500);
const first = await t.evalJs(`(() => { const w = window.__wsAll.filter((x) => /role=pub/.test(x.url))[0]; return { closedWith: w.closedWith, state: w.readyState, freezeLogged: window.__batrayTest.logLines().some((l) => /status: why=freeze/.test(l)) }; })()`);
t.check('sanity: the page saw the freeze (its last-words status is in the log)', first.freezeLogged, first);
// the threshold: closed BEFORE the page stopped (the relay can only act on a close it receives); 1 s of slack for the freeze handler
t.check('F1: the freeze closes the publisher socket before the page stops, so the relay records the end and can push "reader stopped"',
  !!first.closedWith && first.closedWith.at <= frozenAt + 1000 && first.closedWith.at < resumedAt, { closedWith: first.closedWith, frozenAt, resumedAt });
await sleep(7000);                                                    // the 4 s reopen countdown
const after = await t.evalJs(`window.__wsAll.filter((x) => /role=pub/.test(x.url)).map((w) => w.readyState)`);
t.check('after the resume the reader publishes again (an open publisher socket)', after.includes(1), after);
await t.done();
