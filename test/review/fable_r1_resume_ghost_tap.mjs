// BatRay by ClearEvo.com - review tests (fable, round 1) F3: a tap that lands as the resume sheet appears cancels the resume
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
// Evidence (an uploaded reader log, 0.9.89, numbers only): the page was opened by a tap, the resume sheet opened
// 180 ms after the page's first log line and was closed 82 ms later by "tap outside" - no person reads a sheet and
// answers in 82 ms; the tap was already on its way (the page had just appeared under the finger). The app took it
// as the person's answer: "resume: cancelled (dismissed) - nothing resumed". One of the four resume sheets in the
// logs ended this way. The reopen that the "reader stopped" push asks for is exactly such a moment: a tap opens
// the page, the sheet slides in under it, and the resume that would bring the reader back is silently off - the
// person walks away from a reader that will not share or reconnect.
//
// The real page, a seeded intent (share was on), a 3 s countdown; a click on the sheet's backdrop 80 ms after the
// sheet shows. Expected: a dismissal that early is not an answer - the countdown runs out and the share resumes.
// Run: CDP=9427 PORT=8412 node test/review/fable_r1_resume_ghost_tap.mjs
import { openTab, FAKE_RELAY, BASE, sleep, fakeBle } from './fable_cdp.mjs';

const GHOST_MS = 80;                                                  // the log's 82 ms
const t = await openTab();
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: await fakeBle() });
await t.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_RELAY + `
  if (sessionStorage.getItem('ghostTap')) document.addEventListener('DOMContentLoaded', () => {
    const sheet = document.getElementById('sheet');
    const mo = new MutationObserver(() => { if (sheet.hidden) return; mo.disconnect(); window.__sheetShownAt = Date.now(); setTimeout(() => { window.__ghostAt = Date.now(); document.getElementById('sheetBack').click(); }, ${GHOST_MS}); });
    mo.observe(sheet, { attributes: true, attributeFilter: ['hidden'] });
  });` });
await t.send('Page.navigate', { url: `${BASE}/batray/?test` }); await sleep(2500);
await t.evalJs(`localStorage.setItem(window.__batrayTest.tabKey('resume'), JSON.stringify({ share: true, packs: [], at: Date.now() })); localStorage.setItem(window.__batrayTest.tabKey('share_name'), 'seahut'); sessionStorage.setItem('ghostTap', '1'); 1`);
await t.send('Page.navigate', { url: `${BASE}/batray/?test&resumetest=3&n=1` }); await sleep(9000);
const r = await t.evalJs(`({ share: window.__batrayTest.shareState().phase, tapAfterMs: window.__ghostAt - window.__sheetShownAt, lines: window.__batrayTest.logLines().filter((l) => /resume: |sheet resume/.test(l)).map((l) => l.slice(14)) })`);
t.check('setup: the resume sheet opened and a backdrop click landed within 150 ms of it', r.tapAfterMs >= 0 && r.tapAfterMs < 150 && r.lines.some((l) => /ui: sheet resume$/.test(l)), r);
// threshold: 300 ms is under any human read-and-decide time for a sheet that has just appeared
t.check('F3: a tap outside 80 ms after the sheet appeared is not taken as "cancel": the reader still resumes its share', r.share === 'on' && !r.lines.some((l) => /resume: cancelled/.test(l)), r);
await t.done();
