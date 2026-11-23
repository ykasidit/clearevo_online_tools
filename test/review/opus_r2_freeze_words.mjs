// BatRay by ClearEvo.com - review round 1 (Opus), O2-1: the "last words" status on freeze is never sent since 0.9.91
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
// 0.9.71 "every outage explains itself": on hidden / freeze / pagehide the reader sends its status as last words. In
// round 1 this test PASSED on 0.9.90 (the freeze status left the page +1 ms after the freeze event). 0.9.91's freeze
// handler runs statusTick('freeze') and then freezeLinks() -> publisher.suspend(), which closes the socket at once;
// publish() is still awaiting crypto.subtle.encrypt, then finds the same Sock object closing (readyState 2) and
// Sock.send() drops the message without a word. The room keeps the status of up to a minute before, the viewers never
// get the freeze status (battery, packs, memory at that moment), and state.sent still counts it.
// Run: CDP=9411 PORT=8411 node test/review/opus_r2_freeze_words.mjs
import { cdp, startReader, sleep, checker } from './opus_r1_lib.mjs';
const { check, done } = checker();
const c = await cdp();
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `
  // after the world's fake socket: note when each message leaves (wall clock of the test machine)
  window.__sends = [];
  const W = () => window.WebSocket.prototype.send;
  addEventListener('DOMContentLoaded', () => { const orig = W(); window.WebSocket.prototype.send = function (s) { try { const m = JSON.parse(s); if (m.type === 'd') window.__sends.push({ at: Date.now(), slot: m.slot || '' }); } catch { /* not json */ } return orig.call(this, s); }; });
` });
await startReader(c, { debug: false });
await sleep(2000);
// the phone's screen goes off: another tab of the same window comes to the front (Chrome freezes only a hidden page)
await c.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {});
const other = await c.send('Target.createTarget', { url: 'about:blank', newWindow: false, background: false });
await sleep(1500);
console.log('visibility before the freeze:', await c.evalJs('document.visibilityState'));
const t0 = Date.now();
await c.send('Page.setWebLifecycleState', { state: 'frozen' });
const frozenAt = Date.now();
await sleep(8000);
const resumedAt = Date.now();
await c.send('Page.setWebLifecycleState', { state: 'active' });
await c.send('Target.closeTarget', { targetId: other.targetId }).catch(() => {}); await c.send('Page.bringToFront').catch(() => {});
await sleep(1500);
const sends = await c.evalJs(`window.__sends.filter((s) => s.slot === 'status' && s.at >= ${t0 - 50})`);
const lines = await c.evalJs(`window.__batrayTest.logLines().filter((l) => /status: why=freeze/.test(l)).length`);
console.log(`freeze status logged: ${lines}; status sends after the freeze began: ${JSON.stringify(sends.map((s) => s.at - frozenAt))} ms from the freeze (resumed at +${resumedAt - frozenAt} ms)`);
check('the freeze was seen by the page (its status line is logged)', lines >= 1, lines);
check('the freeze status left the page before it froze (not first after the resume)', sends.length > 0 && sends[0].at - frozenAt < 1000, { sends: sends.map((s) => s.at - frozenAt), resumedAfter: resumedAt - frozenAt });
c.close();
done('opus_r2_freeze_words');
