// BatRay by ClearEvo.com - tests (batray_alerts.test.js)
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, REPEAT_S, defaultSettings, loadSettings, conditionHolds, Evaluator, formatEvent, ntfyOk, TICK_GAP_S } from '../public/batray/alerts-logic.js';

const A = { title: (p) => `BatRay: ${p}`, recoveredTitle: (p) => `BatRay: ${p} recovered`, recovered: (t) => `recovered - ${t}`,
  socLow: (e) => `SOC ${e.soc} below ${e.value}%`, socCritical: (e) => `SOC ${e.soc} critical`, noCharge: (e) => `no charge in daylight (${e.cur})`, cellDelta: (e) => `cell delta ${e.dv}`, silent: (e) => `no data for ${e.value} s` };
const noon = new Date(2026, 8, 14, 12, 0, 0).getTime();   // local noon
const night = new Date(2026, 8, 14, 22, 0, 0).getTime();
const ok = { soc: 80, current: 5, cellDelta: 0.01, ageS: 1, connected: true };

test('defaults: every rule on, thresholds as documented', () => {
  const s = defaultSettings();
  assert.equal(Object.keys(s.rules).length, RULES.length);
  assert.deepEqual([s.rules.socLow.value, s.rules.socCritical.value, s.rules.noCharge.value, s.rules.cellDelta.value, s.rules.silent.value], [40, 25, 1, 0.1, 300]);
  assert.ok(Object.values(s.rules).every((r) => r.on));
  assert.equal(s.channels.ntfy, false); assert.equal(s.channels.chrome, false);
});

test('loadSettings merges and clamps', () => {
  const s = loadSettings({ channels: { ntfy: 1 }, ntfy: { topic: ' my-topic ', server: 'https://ntfy.sh' }, watchdog: { on: true, timeoutS: 10 }, rules: { socLow: { on: false, value: '35', holdS: -5 }, bogus: { on: true } } });
  assert.equal(s.channels.ntfy, true); assert.equal(s.ntfy.topic, 'my-topic');
  assert.equal(s.watchdog.timeoutS, 120, 'clamped up to 2 min');
  assert.deepEqual(s.rules.socLow, { on: false, value: 35, holdS: 0 });
  assert.equal(s.rules.bogus, undefined);
  assert.deepEqual(loadSettings(null), defaultSettings());
});

test('socLow fires after the hold time, repeats, recovers once', () => {
  const ev = new Evaluator(defaultSettings());
  const low = { ...ok, soc: 38 };
  assert.deepEqual(ev.tick('p', 'n11', low, noon), [], 'not yet: hold is 5 min');
  assert.deepEqual(ev.tick('p', 'n11', low, noon + 299 * 1000), []);
  const fired = ev.tick('p', 'n11', low, noon + 300 * 1000);
  assert.equal(fired.length, 1); assert.equal(fired[0].rule, 'socLow'); assert.equal(fired[0].event, 'fire'); assert.equal(fired[0].priority, 3);
  assert.deepEqual(ev.tick('p', 'n11', low, noon + 400 * 1000), [], 'no spam');
  const rep = ev.tick('p', 'n11', low, noon + (300 + REPEAT_S) * 1000);
  assert.equal(rep[0].event, 'repeat');
  const rec = ev.tick('p', 'n11', { ...ok, soc: 45 }, noon + (400 + REPEAT_S) * 1000);
  assert.equal(rec.length, 1); assert.equal(rec[0].event, 'recover'); assert.equal(rec[0].priority, 2);
  assert.deepEqual(ev.tick('p', 'n11', { ...ok, soc: 45 }, noon + (500 + REPEAT_S) * 1000), [], 'recover only once');
});

test('a dip that does not last the hold time never fires', () => {
  const ev = new Evaluator(defaultSettings());
  ev.tick('p', 'n', { ...ok, soc: 30 }, noon);
  ev.tick('p', 'n', { ...ok, soc: 30 }, noon + 100 * 1000);
  assert.deepEqual(ev.tick('p', 'n', { ...ok, soc: 50 }, noon + 200 * 1000), []);
  assert.deepEqual(ev.tick('p', 'n', { ...ok, soc: 30 }, noon + 400 * 1000), [], 'timer restarted');
});

test('critical fires independently of low', () => {
  const ev = new Evaluator(defaultSettings());
  const crit = { ...ok, soc: 20 };
  ev.tick('p', 'n', crit, noon);
  const out = ev.tick('p', 'n', crit, noon + 120 * 1000);
  assert.deepEqual(out.map((e) => e.rule), ['socCritical']);
  const out2 = ev.tick('p', 'n', crit, noon + 300 * 1000);
  assert.deepEqual(out2.map((e) => e.rule), ['socLow']);
});

test('no charge in daylight only counts between 09:00 and 15:00 local', () => {
  const cfg = defaultSettings().rules.noCharge;
  const rule = RULES.find((r) => r.id === 'noCharge');
  assert.equal(conditionHolds(rule, cfg, { ...ok, current: 0.2 }, new Date(noon)), true);
  assert.equal(conditionHolds(rule, cfg, { ...ok, current: 0.2 }, new Date(night)), false);
  assert.equal(conditionHolds(rule, cfg, { ...ok, current: 3 }, new Date(noon)), false, 'charging is fine');
  assert.equal(conditionHolds(rule, cfg, { ...ok, current: -8 }, new Date(noon)), true, 'discharging at noon is suspicious');
});

test('2026-09-30 viewer log replay: a frozen tab resuming after 6.7 h must not fire "no data for over 5 min" and "recovered" 4 s apart - silence counts only while the page was awake and its link up', () => {
  const ev = new Evaluator(defaultSettings());
  let t = noon;
  for (let i = 0; i < 10; i++) { assert.deepEqual(ev.tick('s-01', 'n', { ...ok, ageS: 1 }, t), []); t += 5000; }   // ticking every 5 s, frames fresh
  t += 24190 * 1000;                                                                                                 // the tab was frozen (hidden) for 6.7 h
  assert.deepEqual(ev.tick('s-01', 'n', { ...ok, ageS: 24190, connected: true }, t), [], 'the first tick after the freeze: the gap was ours');
  t += 4000;
  assert.deepEqual(ev.tick('s-01', 'n', { ...ok, ageS: 1 }, t), [], 'fresh data: nothing fired, so nothing recovers');
  // a real silence: the page keeps ticking, frames stop
  let age = 1;
  for (; age <= 299; age += 5) { assert.deepEqual(ev.tick('s-01', 'n', { ...ok, ageS: age, connected: false }, t += 5000), []); }
  const out = ev.tick('s-01', 'n', { ...ok, ageS: 304, connected: false }, t += 5000);
  assert.deepEqual(out.map((e) => e.event), ['fire'], 'five awake minutes without a frame is the real thing');
  // the viewer's own link drops while the alert stands: neither a repeat nor a false "recovered"
  assert.deepEqual(ev.tick('s-01', 'n', { ...ok, ageS: 400, connected: false, ownLinkDown: true }, t += 5000), []);
  assert.deepEqual(ev.tick('s-01', 'n', { ...ok, ageS: 1, connected: true }, t += 5000).map((e) => e.event), ['recover'], 'the link is back and a frame came: recovered');
  // the link down for a long stretch, then back with an old frame: the silence is counted from the link's return
  t += 3600 * 1000; assert.deepEqual(ev.tick('s-01', 'n', { ...ok, ageS: 3600, ownLinkDown: true }, t), []);
  assert.deepEqual(ev.tick('s-01', 'n', { ...ok, ageS: 3605, connected: false }, t += 5000), [], 'link just returned: not yet');
  assert.equal(TICK_GAP_S, 30);
});

test('silent: stale frames, whether or not Bluetooth says connected', () => {
  const ev = new Evaluator(defaultSettings());
  let w = noon - 400000; for (let i = 0; i < 20; i++) { ev.tick('w', 'n', ok, w); w += 20000; }                     // the evaluator has been awake for a while
  assert.deepEqual(ev.tick('p', 'n', { ...ok, connected: false, ageS: 20 }, noon), [], 'a fresh drop is not silence yet');
  const out = ev.tick('p', 'n', { ...ok, connected: false, ageS: 301 }, noon + 1000);
  assert.deepEqual(out.map((e) => e.rule), ['silent'], 'hold is 0: fires as soon as the last frame is older than the threshold');
  assert.deepEqual(ev.tick('p', 'n', { ...ok, connected: true, ageS: 400 }, noon + 2000), [], 'still silent (stale), no repeat yet');
  assert.equal(ev.tick('p', 'n', ok, noon + 3000)[0].event, 'recover');
  assert.deepEqual(ev.tick('q', 'n', { ...ok, connected: false, ageS: null }, noon), [], 'never had a frame: no age, no alert');
});

test('presence event toggles load with defaults on', () => {
  assert.deepEqual(defaultSettings().events, { viewers: true, reader: true, net: true });
  assert.deepEqual(loadSettings({ events: { viewers: false } }).events, { viewers: false, reader: true, net: true });
  assert.deepEqual(loadSettings({ events: { reader: 'no', net: false } }).events, { viewers: true, reader: true, net: false }, 'non-boolean ignored');
});

test('disabled rules never fire; forget clears state', () => {
  const s = defaultSettings(); s.rules.socLow.on = false;
  const ev = new Evaluator(s);
  ev.tick('p', 'n', { ...ok, soc: 30 }, noon);
  assert.deepEqual(ev.tick('p', 'n', { ...ok, soc: 30 }, noon + 400 * 1000).map((e) => e.rule), ['socCritical'].filter(() => false), 'socCritical needs <25');
  ev.forget('p');
  assert.equal(ev.state.size, 0);
});

test('formatEvent and ntfy validation', () => {
  const ev = new Evaluator(defaultSettings());
  ev.tick('p', 'n11', { ...ok, soc: 38 }, noon);
  const [e] = ev.tick('p', 'n11', { ...ok, soc: 38 }, noon + 300 * 1000);
  const m = formatEvent(e, A);
  assert.equal(m.title, 'BatRay: n11'); assert.equal(m.body, 'SOC 38% below 40%');
  const [r] = ev.tick('p', 'n11', ok, noon + 400 * 1000);
  assert.match(formatEvent(r, A).body, /^recovered - /);
  assert.ok(ntfyOk({ server: 'https://ntfy.sh', topic: 'hut-batt_1' }));
  assert.ok(!ntfyOk({ server: 'ntfy.sh', topic: 'x' }));
  assert.ok(!ntfyOk({ server: 'https://ntfy.sh', topic: 'bad topic' }));
});

test('bmsAlarm: a protection bit fires after 10 s, recovers, and is off for a clean pack', () => {
  const ev = new Evaluator(defaultSettings());
  const clean = { soc: 80, current: -2, cellDelta: 0.01, ageS: 3, connected: true, alarm: '' };
  const tripped = { ...clean, alarm: 'Cell overvoltage protection' };
  let t = 1_000_000;
  assert.deepEqual(ev.tick('p', 'n11', tripped, t).filter((e) => e.rule === 'bmsAlarm'), []);
  t += 11000;
  const fired = ev.tick('p', 'n11', tripped, t).filter((e) => e.rule === 'bmsAlarm');
  assert.equal(fired.length, 1); assert.equal(fired[0].event, 'fire'); assert.equal(fired[0].priority, 5);
  const msg = formatEvent(fired[0], { title: (p) => p, recoveredTitle: (p) => p, recovered: (x) => x, bmsAlarm: (e) => `BMS alarm: ${e.alarm}` });
  assert.equal(msg.body, 'BMS alarm: Cell overvoltage protection');
  t += 5000;
  const rec = ev.tick('p', 'n11', clean, t).filter((e) => e.rule === 'bmsAlarm');
  assert.equal(rec.length, 1); assert.equal(rec[0].event, 'recover');
  assert.deepEqual(ev.tick('p', 'n11', clean, t + 60000).filter((e) => e.rule === 'bmsAlarm'), []);
});
