// BatRay by ClearEvo.com - review round 1 (Opus), O-resume-ghost: a stray tap cancels the reader's whole resume
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
// A reader log of 2026-11-22 (0.9.89, Android Chrome 158): the reopened reader opened its resume sheet and 82 ms later
// the sheet was "closed (tap outside)" and the log said "resume: cancelled (dismissed) - nothing resumed". No person
// decides in 82 ms: it is the tail of the tap that opened or woke the page landing on the backdrop. The resume is the
// only thing that brings a 24/7 reader back after Chrome restores its tab, and one stray touch anywhere around the
// sheet throws it away. Here a click lands on the backdrop 80 ms after the sheet shows; the share must still resume.
// Run: CDP=9411 PORT=8411 node test/review/opus_r1_resume_ghost.mjs
import { cdp, BASE, sleep, world, checker } from './opus_r1_lib.mjs';
const { check, done } = checker();
const c = await cdp();
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: world() });
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `
  if (sessionStorage.getItem('ghost')) addEventListener('DOMContentLoaded', () => {
    const s = document.getElementById('sheet');
    new MutationObserver(() => { if (!s.hidden && !window.__ghosted) { window.__ghosted = true; setTimeout(() => document.getElementById('sheetBack').click(), 80); } }).observe(s, { attributes: true, attributeFilter: ['hidden'] });
  });` });
await c.send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(2000);
await c.evalJs(`localStorage.setItem(window.__batrayTest.tabKey('resume'), JSON.stringify({ share: true, packs: [{ id: 'fake-opus-1', name: 'n11' }], at: Date.now() })); localStorage.setItem(window.__batrayTest.tabKey('share_name'), 'seahut'); sessionStorage.setItem('ghost', '1'); 1`);
await c.send('Page.navigate', { url: `${BASE}/batray/?test&resumetest=3&n=ghost` });
await sleep(7000);
const lines = await c.evalJs(`window.__batrayTest.logLines().filter((l) => /ui: sheet resume|resume: /.test(l))`);
const st = await c.evalJs(`({ ghosted: !!window.__ghosted, share: window.__batrayTest.shareState().phase, conn: window.__batrayTest.connState() && window.__batrayTest.connState().phase })`);
check('the ghost tap was delivered (80 ms after the resume sheet showed)', st.ghosted, st);
check('a backdrop tap 80 ms after the resume sheet opened does not cancel the resume: the share is on again and the BMS reconnected', st.share === 'on' && st.conn === 'connected' && !lines.some((l) => /resume: cancelled/.test(l)), { st, lines });
c.close();
done('opus_r1_resume_ghost');
