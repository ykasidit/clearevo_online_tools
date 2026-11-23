// BatRay by ClearEvo.com - review round 2 (Opus), O2-5: a charger that blinks for a few seconds at <= 20 % lets the screen go
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
// 0.9.91 releases the screen wake lock on the first chargingchange to "not charging" at or under 20 % (wakePowerOk,
// re-checked on every battery event). A loose cable, a cable brushed, a charger that resets, a brown-out of a second:
// charging=false for a few seconds, then true again. The lock is let go at once; if the phone's screen timeout runs
// out before the next look (a 15-30 s timeout is common), the page is hidden, Chrome freezes it a minute later, 0.9.91
// drops the share and the BMS link, and nothing comes back until a person unlocks the phone - for a blink that the
// power never actually lost. The lock should go only once the phone has been off the charger for a while.
// Here: 18 %, charging blinks off for 3 s and back on; the lock must never have been released.
// Run: CDP=9411 PORT=8411 node test/review/opus_r2_wake_flap.mjs
import { cdp, startReader, sleep, checker } from './opus_r1_lib.mjs';
const { check, done } = checker();
const c = await cdp();
await startReader(c, { debug: false });
await sleep(1000);
await c.evalJs(`window.__bat.level = 0.18; window.__bat.dispatchEvent(new Event('levelchange')); 1`);   // charging, at 18 %
await sleep(800);
check('charging at 18 %: the screen is held', (await c.evalJs('window.__batrayTest.wakeState().lock')) === true);
await c.evalJs(`window.__lockSeen = []; setInterval(() => window.__lockSeen.push(window.__batrayTest.wakeState().lock), 100);
  window.__bat.charging = false; window.__bat.dispatchEvent(new Event('chargingchange')); 1`);
await sleep(3000);
await c.evalJs(`window.__bat.charging = true; window.__bat.dispatchEvent(new Event('chargingchange')); 1`);
await sleep(1500);
const seen = await c.evalJs('window.__lockSeen');
const lines = await c.evalJs(`window.__batrayTest.logLines().filter((l) => /^\\S+\\s+wake: /.test(l))`);
check('a 3 s blink of the charger at 18 % never lets the screen go (a screen timeout could run out meanwhile)', seen.every(Boolean), { releasedSamples: seen.filter((x) => !x).length, of: seen.length, lines });
c.close();
done('opus_r2_wake_flap');
