// BatRay by ClearEvo.com - review of 0.9.98 (Fable, 2026-11-27): R1 throttled ticks silence every alert, R2 a hold counts unjudged time, R3 a dead assembly blocks gap asks
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
// R1 (regression in 0.9.98): Evaluator.tick restarts every hold and repeat clock when two ticks of a pack are more
// than TICK_GAP_S (30 s) apart. A hidden tab that is NOT frozen is throttled by Chrome to one timer wake-up a minute
// (intensive throttling after 5 min hidden: a desktop reader or viewer left in a background tab, which is where a
// person relies on notifications). Its 5 s tick loop then runs every 60 s, every tick is a "wake", no hold ever
// completes and nothing repeats: no alert at all, with readings arriving the whole time. 0.9.97 fired here. (The
// silent rule has had the same hole since 0.9.51 through awakeSince.) A frozen page shows as a gap of many minutes;
// a throttled one as about 60 s - the two need different limits, or awake time counted as min(gap, cap).
// R2: a hold keeps running while the reading is not judged (stale / own link down): one reading before a 31 min
// Bluetooth outage and one after it make "Not charging in daylight ... for 30 min".
// R3: histReqDecision refuses every gap ask while hs.rx is non-null, however old: an answer that stopped mid-file
// (chunk lost, reader page reloaded, same socket) leaves the assembly for good and the hole waits for the 10 min ask
// (0.9.97: 5 s).
// Run: node --test test/review/fable_r098_review.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Evaluator, defaultSettings } from '../../public/batray/alerts-logic.js';
import { historyState, histReqDecision, rxChunk, GAP_REQ_MS } from '../../public/batray/history-logic.js';

const noon = new Date(2026, 10, 27, 12, 0, 0).getTime();
const fresh = { soc: 7, current: -9, cellDelta: 0.01, ageS: 1, connected: true, ownLinkDown: false };

test('R1 a throttled background tab (one tick a minute, fresh readings) still alerts', () => {
  const ev = new Evaluator(defaultSettings()), out = [];
  for (let t = noon; t <= noon + 20 * 60e3; t += 60e3) out.push(...ev.tick('p', 'm-00', fresh, t));
  assert.ok(out.some((e) => e.rule === 'socCritical' && e.event === 'fire'), `20 min at 7 % with a tick a minute: ${out.length} alerts`);
});

test('R1 ... and repeats', () => {
  const ev = new Evaluator(defaultSettings()), out = [];
  for (let t = noon; t <= noon + 400e3; t += 5000) out.push(...ev.tick('p', 'm-00', fresh, t));          // visible: fires
  const n = out.length;
  for (let t = noon + 460e3; t <= noon + 460e3 + 45 * 60e3; t += 60e3) out.push(...ev.tick('p', 'm-00', fresh, t));   // then hidden for 45 min
  assert.ok(out.slice(n).some((e) => e.event === 'repeat'), 'no repeat in 45 min of a throttled tab');
});

test('R2 a hold does not count the time the reading was not judged', () => {
  const ev = new Evaluator(defaultSettings()), s = { ...fresh, soc: 60 };                                // only noCharge can hold
  ev.tick('p', 'n11', s, noon - 3600e3);
  let age = 1;
  for (let t = noon - 3600e3 + 5000; t < noon - 3600e3 + 31 * 60e3; t += 5000) { age += 5; assert.deepEqual(ev.tick('p', 'n11', { ...s, ageS: age, connected: false }, t).filter((e) => e.rule !== 'silent'), []); }   // 'no data' rightly fires during the outage   // Bluetooth down 31 min
  const back = ev.tick('p', 'n11', s, noon - 3600e3 + 31 * 60e3);
  assert.deepEqual(back.filter((e) => e.rule === 'noCharge').map((e) => `${e.rule}:${e.event}`), [], 'two readings 31 min apart are not "for 30 min"');
});

test('R3 an assembly that stopped arriving does not block the gap ask for good', () => {
  const hs = historyState(), t0 = 1e6;
  histReqDecision(hs, { live: true, now: t0 });
  rxChunk(hs, { day: '2026-11-27', after: 0, n: 0, of: 5, b64: 'AAAA' }, t0 + 1000);                     // chunk 1 of 5, then nothing
  assert.equal(histReqDecision(hs, { live: true, now: t0 + 1000 + GAP_REQ_MS - 1, gap: true }).action, 'noop', 'still arriving');
  assert.equal(histReqDecision(hs, { live: true, now: t0 + 60e3, gap: true }).action, 'request', 'nothing for a minute: ask');
});
