// BatRay by ClearEvo.com - tests (batray_demo.test.js)
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

// The demo must go through the real decoder and come out confident, so a
// screenshot or a first look never shows numbers the decoder would not
// produce for a real 16-cell pack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JkBms, decodeCellInfo, decodeDeviceInfo, decodeSettings } from '../public/batray/jkbms.js';
import { demoState, buildDemoFrame, buildDemoDeviceInfo, buildDemoSettings, startDemo } from '../public/batray/demo.js';

test('demo frame decodes as a confident 24S-layout 16-cell pack', () => {
  const s = demoState(0);
  const d = decodeCellInfo(buildDemoFrame(s));
  assert.equal(d.ok, true);
  assert.equal(d.confident, true);
  assert.equal(d.variant, 'JK02_24S');
  assert.equal(d.cells.length, 16);
  assert.equal(d.maskCells, 16);
  assert.equal(d.soc, s.soc);
  assert.ok(Math.abs(d.packV - s.packV) < 0.02);
  assert.ok(d.current < 0, 'demo pack is discharging');
  assert.equal(d.cycles, 57);
  assert.equal(d.soh, 100);
  assert.ok(Math.abs(d.tempMos - s.tempMos) < 0.1);
  assert.equal(d.tempMask, 7);
});

test('demo device-info frame names itself and hints the 24S layout', () => {
  const i = decodeDeviceInfo(buildDemoDeviceInfo());
  assert.equal(i.model, 'DEMO-SIMULATED');
  assert.equal(i.swMajor, 10);
});

test('demo settings frame decodes as a 16S 280 Ah pack with 3.65 / 2.5 V protection', () => {
  const s = decodeSettings(buildDemoSettings());
  assert.equal(s.cellCount, 16);
  assert.ok(Math.abs(s.capacityAh - 280) < 1e-6);
  assert.ok(Math.abs(s.cellOvp - 3.65) < 1e-6);
  assert.ok(Math.abs(s.cellUvp - 2.5) < 1e-6);
  assert.equal(s.balanceSwitch, true);
});

test('demo stream survives the 20-byte notification path: device info then cell frames', () => {
  const bms = new JkBms();
  const seen = { data: [], device: [], settings: [] };
  for (const k of Object.keys(seen)) bms.addEventListener(k, (e) => seen[k].push(e.detail));
  const timers = [];
  const run = startDemo((chunk) => bms._onNotify(chunk), {
    setTimer: (fn) => { timers.push(fn); return 1; },
    clearTimer: () => {},
  });
  timers[0]();
  run.stop();
  assert.equal(seen.device.length, 1);
  assert.equal(seen.settings.length, 1);
  assert.equal(seen.data.length, 2);
  assert.ok(seen.data.every((d) => d.confident && d.layoutSource === 'firmware'));
});
