// BatRay by ClearEvo.com - review round 2 (Opus), O2-2: a power cut that ends at 15 % now needs a person
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
// The 0.9.91 fix for round 1's O1 (wakePowerOk) lets the screen sleep at 20 % unplugged. Once the screen sleeps the
// page is hidden, Chrome freezes it about a minute later (0.9.91 then closes the share and drops the BMS link), and a
// hidden page can neither take the wake lock again nor run: when the power comes back the phone charges, but nothing
// lights the screen. The log line says "it is kept on again once the phone charges" - it is not, until a person
// unlocks the phone. On 0.9.90 the lock was never let go, so an outage that ended before the battery was empty healed
// by itself (the seahut phone drained ~9 %/h: the window from 20 % to empty is ~2 h of outages that used to heal and
// now wait for a person). This is a trade-off the fix made, not a crash: the phone is alive, and an unlock resumes it.
// The model here: a released lock = the screen sleeps (hidden + frozen); the power returns at 15 %; the reader must be
// connected, sharing and holding the screen again within 15 s, with nobody touching the phone.
// Run: CDP=9411 PORT=8411 node test/review/opus_r2_power_return.mjs
import { cdp, startReader, sleep, checker } from './opus_r1_lib.mjs';
const { check, done } = checker();
const c = await cdp();
// the browser's rule: no wake lock for a hidden page
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `
  addEventListener('DOMContentLoaded', () => { const wl = navigator.wakeLock, req = wl.request.bind(wl);
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async (t) => { if (document.visibilityState !== 'visible') { const e = new Error('The requesting page is not visible'); e.name = 'NotAllowedError'; throw e; } return req(t); } } }); });` });
await startReader(c, { debug: false });
await sleep(1500);
const st = () => c.evalJs(`({ lock: window.__batrayTest.wakeState().lock, conn: window.__batrayTest.connState() && window.__batrayTest.connState().phase, share: window.__batrayTest.shareState().phase, live: window.__socks.size > 0, vis: document.visibilityState })`);
check('start: connected, sharing, screen held', (await st()).lock === true);
// the power goes: unplugged, then the battery runs down to 15 %
await c.evalJs(`window.__bat.charging = false; window.__bat.dispatchEvent(new Event('chargingchange')); window.__bat.level = 0.15; window.__bat.dispatchEvent(new Event('levelchange')); 1`);
await sleep(2000);
const released = !(await st()).lock;
let other = null;
if (released) {                                                     // the phone's screen timeout: hidden, then frozen by Chrome
  await c.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {});
  other = await c.send('Target.createTarget', { url: 'about:blank', newWindow: false, background: false });
  await sleep(1000);
  await c.send('Page.setWebLifecycleState', { state: 'frozen' });
  await sleep(3000);
}
// the power comes back: the phone charges. Nobody is there to unlock it. On a phone the page stays frozen until it is
// shown again; the test lifts the freeze only so it can read the page (more generous than a phone), the page stays hidden
if (released) await c.send('Page.setWebLifecycleState', { state: 'active' });
await c.evalJs(`window.__bat.charging = true; window.__bat.dispatchEvent(new Event('chargingchange')); 1`);
await sleep(15000);
const s = await st();
console.log(`lock released at 15 %: ${released}; 15 s after the power returned: ${JSON.stringify(s)}`);
check('the power returns at 15 % with nobody at the phone: the reader holds the screen again (without it the page stays hidden and, on a phone, frozen)', s.lock === true, s);
if (other) await c.send('Target.closeTarget', { targetId: other.targetId }).catch(() => {});
c.close();
done('opus_r2_power_return');
