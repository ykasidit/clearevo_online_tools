// BatRay by ClearEvo.com - simulated JK BMS for the DEMO mode (pure, tested)
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

// Simulated JK BMS for the DEMO button. Builds real 300-byte frames (same
// header, offsets and checksum the BMS sends) so the demo exercises the exact
// reassembly + decode path a live unit does - nothing in the UI is
// special-cased for it. It is a simulation of a 16-cell LiFePO4 pack on the
// JK02_24S layout, not a recording of a real battery; the UI labels it DEMO
// throughout.

const HDR = [0x55, 0xaa, 0xeb, 0x90];
const FRAME_LEN = 300;

function finish(f) {
  let sum = 0;
  for (let i = 0; i < FRAME_LEN - 1; i++) sum += f[i];
  f[FRAME_LEN - 1] = sum & 0xff;
  return f;
}

function putStr(f, at, len, s) {
  for (let i = 0; i < len; i++) f[at + i] = i < s.length ? s.charCodeAt(i) : 0;
}

// Pack state the frames are generated from. Values move a little each tick so
// the meters visibly update.
export function demoState(t = 0) {
  const soc = Math.max(5, Math.min(100, 63 - t / 240));
  const current = -8.4 + 2.2 * Math.sin(t / 7) + 0.6 * Math.sin(t / 2.3); // A, negative = discharge
  const base = 3.27 + 0.03 * (soc - 60) / 40;
  const cells = [];
  for (let i = 0; i < 16; i++) {
    const spread = [0, 3, -2, 5, 1, -4, 2, 0, 6, -1, 3, -3, 1, 4, -2, 0][i] / 1000;
    cells.push(base + spread + 0.001 * Math.sin(t / 5 + i));
  }
  const packV = cells.reduce((a, v) => a + v, 0);
  return {
    cells, packV, current, soc: Math.round(soc),
    remainAh: 280 * soc / 100, nominalAh: 280, cycles: 57,
    temp1: 27.5 + 0.4 * Math.sin(t / 30), temp2: 28.1 + 0.3 * Math.sin(t / 25), tempMos: 33.4 + 0.8 * Math.sin(t / 20),
  };
}

// A device-info frame (0x03) naming the simulation, firmware "10.00" so the
// decoder's firmware hint selects the 24S layout the cell frames use.
export function buildDemoDeviceInfo() {
  const f = new Uint8Array(FRAME_LEN);
  f.set(HDR); f[4] = 0x03;
  putStr(f, 6, 16, 'DEMO-SIMULATED');
  putStr(f, 22, 8, '0.0');
  putStr(f, 30, 8, '10.00');
  new DataView(f.buffer).setUint32(38, 4_123_456, true); // uptime
  new DataView(f.buffer).setUint32(42, 1, true); // power-on count
  putStr(f, 46, 16, 'DEMO pack');
  return finish(f);
}

// A settings frame (0x01) with the limits a 16S 280 Ah LiFePO4 pack would carry.
export function buildDemoSettings() {
  const f = new Uint8Array(FRAME_LEN);
  f.set(HDR); f[4] = 0x01;
  const dv = new DataView(f.buffer);
  const u32 = (at, v) => dv.setUint32(at, v, true);
  u32(10, 2500); u32(14, 2900); u32(18, 3650); u32(22, 3400); // cell UVP / UVPR / OVP / OVPR (mV)
  u32(26, 10); u32(46, 2400); u32(50, 100000); u32(54, 3); u32(58, 60);
  u32(62, 100000); u32(66, 300); u32(70, 60); u32(74, 30); u32(78, 1000);
  u32(82, 600); u32(86, 550); u32(90, 600); u32(94, 550); dv.setInt32(98, 0, true); dv.setInt32(102, 50, true);
  dv.setInt32(106, 800, true); dv.setInt32(110, 700, true);
  u32(114, 16); u32(118, 1); u32(122, 1); u32(126, 1); u32(130, 280000); u32(134, 5); u32(138, 3300);
  return finish(f);
}

// Encode a state as a JK02_24S cell-info frame (offsets match jkbms.js).
export function buildDemoFrame(s, counter = 0) {
  const f = new Uint8Array(FRAME_LEN);
  f.set(HDR); f[4] = 0x02; f[5] = counter & 0xff;
  const dv = new DataView(f.buffer);
  s.cells.forEach((v, i) => { dv.setUint16(6 + i * 2, Math.round(v * 1000), true); dv.setUint16(64 + i * 2, 56 + (i % 3), true); });
  dv.setUint32(54, (1 << s.cells.length) - 1, true); // enabled-cells mask
  const mv = s.cells.map((v) => Math.round(v * 1000));
  dv.setUint16(58, Math.round(mv.reduce((a, b) => a + b, 0) / mv.length), true); // average
  dv.setUint16(60, Math.max(...mv) - Math.min(...mv), true); // delta
  f[62] = mv.indexOf(Math.max(...mv)); f[63] = mv.indexOf(Math.min(...mv));
  dv.setUint32(118, Math.round(s.packV * 1000), true);
  dv.setUint32(122, Math.round(Math.abs(s.packV * s.current) * 1000), true);
  dv.setInt32(126, Math.round(s.current * 1000), true);
  dv.setInt16(130, Math.round(s.temp1 * 10), true);
  dv.setInt16(132, Math.round(s.temp2 * 10), true);
  dv.setInt16(134, Math.round(s.tempMos * 10), true); // MOS temperature (24S position)
  f[141] = s.soc;
  dv.setUint32(142, Math.round(s.remainAh * 1000), true);
  dv.setUint32(146, Math.round(s.nominalAh * 1000), true);
  dv.setUint32(150, s.cycles, true);
  dv.setUint32(154, Math.round(s.cycles * s.nominalAh * 0.8 * 1000), true);
  f[158] = 100; // SOH
  dv.setUint32(162, 4_123_456, true); // runtime s
  f[166] = 1; f[167] = 1; // charge / discharge MOSFETs on
  dv.setUint16(182, 7, true); // MOS + 2 sensors present
  return finish(f);
}

// Delivers frames through `sink` in 20-byte notification-sized chunks: the
// device-info and settings frames once, then a cell-info frame every second until stop().
export function startDemo(sink, { intervalMs = 1000, setTimer = setInterval, clearTimer = clearInterval } = {}) {
  let t = 0;
  const send = (frame) => { for (let i = 0; i < frame.length; i += 20) sink(frame.slice(i, i + 20)); };
  send(buildDemoDeviceInfo());
  send(buildDemoSettings());
  const tick = () => {
    send(buildDemoFrame(demoState(t), t & 0xff));
    t += intervalMs / 1000;
  };
  tick();
  const timer = setTimer(tick, intervalMs);
  return { stop: () => clearTimer(timer) };
}
