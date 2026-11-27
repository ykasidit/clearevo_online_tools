// BatRay by ClearEvo.com - log review 2026-11-27 (Fable), L1 + L3: alerts judged on stale or full-battery samples
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
// L1: viewer logs 11-23..26 (four viewer sessions, six wakes): a tab frozen for hours fires 4-8 alerts in the first
// 100 ms after "tab visible", from the reading it held before the freeze ("Battery 7%", "Not charging in daylight ...
// for 30 min", "Cell voltage spread 140 mV"), and "recovered" 5 s later when live data arrives. The hold and the
// repeat clocks count the frozen hours, and a viewer whose own link is down still judges its old sample (only the
// silent rule looks at ownLinkDown / awake time, 0.9.51).
// L3: sea-hut reader 11-25 and 11-27: "Not charging in daylight: current 0.0 A for 30 min, battery 100%" - a full
// battery takes no charge.
// Run: node --test test/review/fable_logs_alerts.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { Evaluator, defaultSettings, conditionHolds, RULES } from '../../public/batray/alerts-logic.js';

const noon = new Date(2026, 10, 26, 12, 0, 0).getTime();   // local noon: inside the daylight window
const low = { soc: 7, current: -0.8, cellDelta: 0.14, ageS: 1, connected: true, ownLinkDown: false };
const kinds = (evs) => evs.map((e) => `${e.rule}:${e.event}`).join(' ');

test('L1 a hold does not run while the page is frozen: no first alert from the pre-freeze sample at the wake', () => {
  const ev = new Evaluator(defaultSettings());
  const t0 = noon - 4 * 3600e3;                             // 08:00 local, the tab is about to freeze
  for (let t = t0; t <= t0 + 20e3; t += 5000) ev.tick('p', 'm-00', low, t);   // 20 s awake: every hold (120 s .. 30 min) still running
  const woke = ev.tick('p', 'm-00', { ...low, ageS: 4 * 3600, ownLinkDown: true }, noon);   // 4 h later, link not yet back
  assert.equal(kinds(woke), '', `alerts at the wake from a 4 h old sample: ${kinds(woke)}`);
});

test('L1 no repeat from the old sample while the viewer link is down after a freeze', () => {
  const ev = new Evaluator(defaultSettings());
  const t0 = noon - 4 * 3600e3;
  let fired = [];
  for (let t = t0; t <= t0 + 400e3; t += 5000) fired = fired.concat(ev.tick('p', 'm-00', low, t));
  assert.ok(fired.some((e) => e.rule === 'socCritical' && e.event === 'fire'), 'setup: the critical rule fired before the freeze');
  const woke = ev.tick('p', 'm-00', { ...low, ageS: 4 * 3600, ownLinkDown: true }, noon);
  assert.equal(kinds(woke), '', `repeats at the wake from a 4 h old sample: ${kinds(woke)}`);
});

test('L3 a full battery is not "not charging in daylight"', () => {
  const rule = RULES.find((r) => r.id === 'noCharge'), cfg = defaultSettings().rules.noCharge;
  assert.equal(conditionHolds(rule, cfg, { soc: 100, current: 0, cellDelta: 0.01, ageS: 1, connected: true }, new Date(noon)), false);
  assert.equal(conditionHolds(rule, cfg, { soc: 54, current: -9.3, cellDelta: 0.01, ageS: 1, connected: true }, new Date(noon)), true, 'a half-empty pack that discharges at noon still counts');
});
