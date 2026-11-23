// BatRay by ClearEvo.com - review round 1 (Opus), O-battery: the screen lock drains an unplugged reader phone to death
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
// The best-documented loss of a 0.9.86 reader (its tombstone in the log of 2026-11-22 11:08): up 40 h, then the power
// went (the viewer saw its socket end at the moment the last status said 100 %, charging; the next statuses say "not
// charging" and the network OFFLINE), and the page kept the screen on with its wake lock until the phone died: the
// last status, ~11 h later, says phone=1% not charging wake=held vis=yes. A dead phone comes back only when a person
// powers it on and opens Chrome, and then - getDevices off - taps Connect and picks the BMS. A phone whose screen was
// allowed to sleep near empty would still be alive when the power returns, with the page and its BluetoothDevice
// handle (an unlock resumes it, no chooser). 0.9.91-0.9.94 let the screen sleep at 20 % unplugged; the owner reversed
// that on 2026-11-23 ("no screen sleep"): a slept screen lets Chrome freeze the page, which ends the readings, so the
// reader keeps the screen on to the end and the phone's own alerts (unplugged / low) tell the viewers.
// Here the fake phone battery goes unplugged and down to 15 %: the lock must stay held throughout.
// Run: CDP=9411 PORT=8411 node test/review/opus_r1_battery_wake.mjs
import { cdp, startReader, sleep, checker } from './opus_r1_lib.mjs';
const { check, done } = checker();
const c = await cdp();
await startReader(c, { debug: false });
const held = () => c.evalJs(`window.__batrayTest.wakeState().lock`);
await sleep(1000);
check('connected and sharing: the screen wake lock is held', await held() === true, await c.evalJs('window.__batrayTest.wakeState()'));
await c.evalJs(`window.__bat.charging = false; window.__bat.dispatchEvent(new Event('chargingchange')); 1`); await sleep(1500);
check('unplugged at 90 %: the lock stays (the outage is worth recording while the battery lasts)', await held() === true);
// the battery runs down: 15 %, still unplugged (Chrome reports levelchange); give the page a minute's heartbeat worth
// 0.9.92 (review round 2, O2-1): the screen goes only after 5 min off the charger without a break - the page's clock is
// moved 6 min on, as a real run-down from 90 % to 15 % takes hours
await c.evalJs(`(() => { const real = Date.now.bind(Date); Date.now = () => real() + 6 * 60000; return 1; })()`);
await c.evalJs(`window.__bat.level = 0.15; window.__bat.dispatchEvent(new Event('levelchange')); 1`);
await sleep(3000);
const w = await c.evalJs('window.__batrayTest.wakeState()');
check('unplugged at 15 % for 6 min: the screen is still held (no screen sleep, owner 2026-11-23)', w.lock === true, w);
c.close();
done('opus_r1_battery_wake');
