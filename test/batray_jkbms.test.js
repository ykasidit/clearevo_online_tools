// BatRay by ClearEvo.com - tests (batray_jkbms.test.js)
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

// Decoder tests. Real captured frames live in frames.mjs (with their sources);
// the synthetic ones here prove framing, checksums and reassembly. Run:
// node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCommand, decodeCellInfo, decodeDeviceInfo, decodeSettings, errorLabels, feedFrames, swMajor, JkBms,
} from '../public/batray/jkbms.js';
import * as F from './batray_frames.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const volts = (d) => d.cells.map((c) => c.v);

// ---------------------------------------------------------------- commands
test('command checksum matches known-good frames', () => {
  assert.equal(buildCommand(0x97)[19], 0x11);
  assert.equal(buildCommand(0x96)[19], 0x10);
});

test('swMajor parses the version strings firmwares actually send', () => {
  assert.equal(swMajor('10.08'), 10);
  assert.equal(swMajor('V11.48'), 11);
  assert.equal(swMajor('3.3.0'), 3);
  assert.equal(swMajor(''), null);
});

// ------------------------------------------------- author's own 32S unit
test('owner unit (32S firmware, 14 cells): V/I/P consistent, confident without a hint', () => {
  const d = decodeCellInfo(F.OWNER_32S_CELL);
  assert.equal(d.ok, true);
  assert.equal(d.confident, true);
  assert.equal(d.variant, 'JK02_32S');
  assert.equal(d.layoutSource, 'cell-sum');
  assert.equal(d.cells.length, 14);
  assert.equal(d.maskCells, 14);
  near(d.packV, 50.667);
  near(d.cellSum, 50.669);
  near(d.current, 4.2);
  near(d.power, 212.8, 0.01);
  assert.equal(d.soc, 53);
  near(d.remainAh, 126.579);
  near(d.nominalAh, 238.0);
  assert.equal(d.cycles, 120);
  near(d.cycleAh, 28632.614);
  assert.equal(d.soh, 100);
  near(d.temp1, 30.4); near(d.temp2, 29.2); near(d.tempMos, 30.0);
  assert.equal(d.chgMos, true);
  assert.equal(d.dsgMos, true);
  assert.equal(d.cells[0].mOhm, 56);
  assert.equal(d.errors, 0);
  assert.equal(d.runtimeS, 74026709); // 0x04698ED5 s = 856.8 days
});

test('owner unit with the firmware hint takes the hinted layout', () => {
  const d = decodeCellInfo(F.OWNER_32S_CELL, 11);
  assert.equal(d.variant, 'JK02_32S');
  assert.equal(d.layoutSource, 'firmware');
  assert.equal(d.confident, true);
});

test('a wrong firmware hint is overruled by the cell-sum check', () => {
  const d = decodeCellInfo(F.OWNER_32S_CELL, 10); // claims 24S
  assert.equal(d.variant, 'JK02_32S');
  assert.equal(d.layoutSource, 'cell-sum');
  assert.equal(d.confident, true);
});

// ------------------------------------------------ aiobmsble captures (5 fw)
test('JK02_24S sw 10.08 (JK-B2A20S20P): matches aiobmsble expected values', () => {
  const info = decodeDeviceInfo(F.AIO_24S_DEV);
  assert.deepEqual(
    { model: info.model, hw: info.hwVersion, sw: info.swVersion, name: info.name, serial: info.serial.slice(0, 8) },
    { model: 'JK-B2A20S20P', hw: '10.XG', sw: '10.08', name: 'JK-BMS-A', serial: '20328160' }
  );
  assert.equal(info.swMajor, 10);
  const d = decodeCellInfo(F.AIO_24S_CELL, info.swMajor);
  assert.equal(d.variant, 'JK02_24S');
  assert.equal(d.confident, true);
  assert.equal(d.cells.length, 16);
  assert.deepEqual(volts(d), [3.310, 3.314, 3.313, 3.312, 3.312, 3.308, 3.312, 3.309, 3.309, 3.309, 3.309, 3.312, 3.313, 3.309, 3.310, 3.309]);
  near(d.packV, 52.971);
  near(d.current, 2.329);
  near(d.power, 123.369, 0.001);
  near(d.deltaCellV, 0.005);
  near(d.balanceA, 0.002);
  assert.equal(d.soc, 56);
  assert.equal(d.soh, 100);
  near(d.remainAh, 113.245);
  near(d.nominalAh, 202.0);
  assert.equal(d.cycles, 60);
  near(d.cycleAh, 12150.18, 0.001);
  near(d.temp1, 18.1); near(d.temp2, 18.6); near(d.tempMos, 22.8);
  assert.equal(d.tempMask, 7);
  assert.equal(d.errors, 0);
  assert.equal(d.chgMos, true); assert.equal(d.dsgMos, true);
  assert.equal(d.temp3, null); // 24S frames have no sensors 3..5
});

test('JK02_32S sw 11.48 (JK_B2A8S20P): matches aiobmsble expected values', () => {
  const info = decodeDeviceInfo(F.AIO_32S_DEV);
  assert.equal(info.model, 'JK_B2A8S20P');
  assert.equal(info.hwVersion, '11.XA');
  assert.equal(info.swVersion, '11.48');
  assert.equal(info.name, '12v420a');
  assert.equal(info.powerOnCount, 7);
  const d = decodeCellInfo(F.AIO_32S_CELL, info.swMajor);
  assert.equal(d.variant, 'JK02_32S');
  assert.equal(d.layoutSource, 'firmware');
  assert.equal(d.confident, true);
  assert.equal(d.cells.length, 8);
  assert.deepEqual(volts(d), [3.315, 3.315, 3.315, 3.312, 3.313, 3.312, 3.313, 3.313]);
  near(d.packV, 26.509);
  near(d.current, -7.063);
  near(d.power, -187.233, 0.001);
  near(d.deltaCellV, 0.003);
  assert.equal(d.soc, 68);
  assert.equal(d.soh, 100);
  near(d.remainAh, 142.464);
  near(d.nominalAh, 210);
  assert.equal(d.cycles, 21);
  near(d.cycleAh, 4481.724, 0.001);
  near(d.tempMos, 31.0); near(d.temp1, 28.4); near(d.temp2, 29.2); near(d.temp3, 31.0);
  assert.equal(d.tempMask, 255);
  assert.equal(d.balancing, 0);
  assert.equal(d.chgMos, true); assert.equal(d.dsgMos, true);
  assert.equal(d.chargeStatus, 0);
  assert.equal(d.batteryType, 0);
});

test('JK-PB sw 15.38 (JK_PB2A16S20P): 16 cells, float stage, 5 temperature sensors', () => {
  const info = decodeDeviceInfo(F.AIO_PB15_DEV);
  assert.equal(info.model, 'JK_PB2A16S20P');
  assert.equal(info.hwVersion, '15A');
  assert.equal(info.swVersion, '15.38');
  const d = decodeCellInfo(F.AIO_PB15_CELL, info.swMajor);
  assert.equal(d.variant, 'JK02_32S');
  assert.equal(d.confident, true);
  assert.equal(d.cells.length, 16);
  assert.deepEqual(volts(d), [3.333, 3.326, 3.326, 3.329, 3.329, 3.325, 3.323, 3.329, 3.324, 3.323, 3.326, 3.323, 3.32, 3.323, 3.323, 3.337]);
  near(d.packV, 53.224);
  near(d.current, 31.881);
  near(d.power, 1696.834, 0.001);
  assert.equal(d.soc, 25);
  near(d.remainAh, 49.286);
  near(d.nominalAh, 200);
  assert.equal(d.cycles, 9);
  near(d.deltaCellV, 0.016);
  near(d.tempMos, 12.9); near(d.temp1, 13.4); near(d.temp2, 12.8);
  near(d.temp3, 20.5); near(d.temp4, 19.5); near(d.temp5, 19.1);
  assert.equal(d.chargeStatus, 2); // Float
  assert.equal(d.chargeStatusS, 677);
});

test('JK-PB sw 19.27 (JK-PB2A16S20P): 8 cells, discharging, balancer active', () => {
  const info = decodeDeviceInfo(F.AIO_PB19_DEV);
  assert.equal(info.model, 'JK-PB2A16S20P');
  assert.equal(info.swVersion, '19.27');
  assert.equal(info.name, 'DG Smart BMS');
  const d = decodeCellInfo(F.AIO_PB19_CELL, info.swMajor);
  assert.equal(d.variant, 'JK02_32S');
  assert.equal(d.confident, true);
  assert.deepEqual(volts(d), [3.308, 3.312, 3.312, 3.307, 3.311, 3.311, 3.312, 3.309]);
  near(d.packV, 26.481);
  near(d.current, -12.684);
  near(d.power, -335.885, 0.001);
  near(d.balanceA, 1.99);
  assert.equal(d.balancing, 1);
  assert.equal(d.soc, 78);
  near(d.remainAh, 244.296);
  near(d.nominalAh, 314);
  assert.equal(d.cycles, 15);
  near(d.tempMos, 26.2); near(d.temp1, 23.3); near(d.temp2, 23.6);
  near(d.temp3, 26.2); near(d.temp4, 24.5); near(d.temp5, 24.0);
  assert.equal(d.chargeStatus, 0); // Bulk
  assert.equal(d.runtimeS, 2174479);
});

// ---------------------------------------------- esphome-jk-bms captures
test('esphome JK02_24S example: 16 cells idle, 81 Ah pack', () => {
  const d = decodeCellInfo(F.ESPHOME_24S_CELL);
  assert.equal(d.variant, 'JK02_24S');
  assert.equal(d.confident, true);
  assert.equal(d.layoutSource, 'cell-sum');
  assert.equal(d.cells.length, 16);
  assert.equal(d.maskCells, 16);
  near(d.packV, 53.251);
  near(d.current, 0);
  assert.equal(d.soc, 84);
  near(d.remainAh, 68.494);
  near(d.nominalAh, 81.0);
  near(d.tempMos, 21.0); near(d.temp1, 19.0); near(d.temp2, 19.1);
  assert.equal(d.cells[0].mOhm, 413);
  assert.equal(d.chgMos, true); assert.equal(d.dsgMos, true);
});

test('esphome device-info examples across three generations', () => {
  const jk04 = decodeDeviceInfo(F.ESPHOME_JK04_DEV);
  assert.equal(jk04.model, 'JK-B2A16S'); assert.equal(jk04.hwVersion, '3.0'); assert.equal(jk04.swVersion, '3.3.0');
  assert.equal(jk04.swMajor, 3); assert.equal(jk04.uptimeS, 36867600); assert.equal(jk04.powerOnCount, 19);
  assert.equal(jk04.mfgDate, '');
  const s24 = decodeDeviceInfo(F.ESPHOME_24S_DEV);
  assert.equal(s24.model, 'JK-B2A24S15P'); assert.equal(s24.hwVersion, '10.XW'); assert.equal(s24.swVersion, '10.07');
  assert.equal(s24.mfgDate, '220407'); assert.equal(s24.serial, '2021602096');
  const pb = decodeDeviceInfo(F.ESPHOME_PB14_DEV);
  assert.equal(pb.model, 'JK_PB2A16S15P'); assert.equal(pb.hwVersion, '14.XA'); assert.equal(pb.swVersion, '14.20');
  assert.equal(pb.swMajor, 14); assert.equal(pb.powerOnCount, 156);
});

test('esphome JK04 example: float cells decode when both JK02 layouts fail', () => {
  const d = decodeCellInfo(F.ESPHOME_JK04_CELL, 3);
  assert.equal(d.ok, true);
  assert.equal(d.variant, 'JK04');
  assert.equal(d.layoutSource, 'float-cells');
  assert.equal(d.cells.length, 16);
  near(d.cells[0].v, 3.3497, 0.0001); // 0x405661C0
  near(d.cells[15].v, 3.3512, 0.0001); // 0x405679E0
  assert.equal(d.cells[0].mOhm, 159); // 0x3E231D7C = 0.1593 Ohm
  assert.equal(d.runtimeS, 1873491); // 0x001C9653
  assert.equal(d.soc, null);
  assert.equal(d.current, null);
  near(d.packV, d.cellSum);
});

test('esphome JK02_24S settings example: 13 cells, 5 Ah, 2.9/4.3 V protection', () => {
  const s = decodeSettings(F.ESPHOME_24S_SETTINGS);
  assert.equal(s.cellCount, 13);
  near(s.capacityAh, 5.0);
  near(s.cellUvp, 2.9); near(s.cellUvpr, 3.2); near(s.cellOvp, 4.3); near(s.cellOvpr, 4.2);
  near(s.balanceTriggerV, 0.01); near(s.balanceStartV, 3.3);
  near(s.maxChargeA, 25); near(s.maxDischargeA, 150); near(s.maxBalanceA, 2);
  near(s.chargeOtp, 70); near(s.chargeUtp, -20); near(s.mosOtp, 90);
  assert.equal(s.chargeSwitch, true); assert.equal(s.dischargeSwitch, true); assert.equal(s.balanceSwitch, true);
  assert.equal(s.scpDelayUs, 1500);
});

// ---------------------------------------------------- mpp-solar captures
test('mpp-solar JK02 16-cell 200 Ah pack, idle', () => {
  const d = decodeCellInfo(F.MPP_24S_16CELL);
  assert.equal(d.variant, 'JK02_24S'); assert.equal(d.confident, true);
  assert.equal(d.cells.length, 16);
  near(d.packV, 53.692); near(d.current, 0);
  assert.equal(d.soc, 99); near(d.remainAh, 199.787); near(d.nominalAh, 200);
  near(d.tempMos, 31.6); near(d.temp1, 28.6); near(d.temp2, 27.8);
});

test('mpp-solar JK02 3-cell pack: absent temperature sensors read as null', () => {
  const d = decodeCellInfo(F.MPP_24S_3CELL);
  assert.equal(d.variant, 'JK02_24S'); assert.equal(d.confident, true);
  assert.equal(d.cells.length, 3);
  near(d.packV, 11.089);
  assert.equal(d.temp1, null); assert.equal(d.temp2, null); near(d.tempMos, 33.9);
  near(d.nominalAh, 6.0);
});

test('mpp-solar JK02 14-cell pack discharging: power magnitude equals |V x I|', () => {
  const d = decodeCellInfo(F.MPP_24S_14CELL);
  assert.equal(d.variant, 'JK02_24S'); assert.equal(d.confident, true);
  assert.equal(d.cells.length, 14); assert.equal(d.maskCells, 14);
  near(d.packV, 52.953); near(d.current, -6.822);
  near(Math.abs(d.power), 361.24, 0.01);
  assert.equal(d.soc, 83); assert.equal(d.cycles, 19); near(d.nominalAh, 166);
});

// -------------------------------------------- JK-PB settings (Gobel doc)
test('JK-PB V19 setup frame (Gobel protocol document): 16S 100 Ah, OVP 3.65 V', () => {
  const s = decodeSettings(F.GOBEL_PB19_SETTINGS);
  assert.equal(s.cellCount, 16);
  near(s.capacityAh, 100);
  near(s.cellUvp, 2.5); near(s.cellUvpr, 2.9); near(s.cellOvp, 3.65); near(s.cellOvpr, 3.4);
  near(s.smartSleepV, 3.54); near(s.soc100V, 3.445); near(s.soc0V, 2.7);
  near(s.requestChargeV, 3.45); near(s.requestFloatV, 3.4); near(s.powerOffV, 2.49);
  near(s.maxChargeA, 30); near(s.maxDischargeA, 100); near(s.maxBalanceA, 1);
  assert.equal(s.chargeOcpDelayS, 3); assert.equal(s.dischargeOcpDelayS, 300);
  near(s.chargeOtp, 60); near(s.chargeUtpRecovery, 5); near(s.mosOtp, 80);
  assert.equal(s.scpDelayUs, 5); near(s.balanceStartV, 3.3);
});

// ------------------------------------------------------------ error bits
test('error bit labels', () => {
  assert.deepEqual(errorLabels(0), []);
  assert.deepEqual(errorLabels(1 << 11), ['Cell undervoltage']);
  assert.deepEqual(errorLabels((1 << 6) | (1 << 13)), ['Charge overcurrent', 'Discharge overcurrent']);
  assert.deepEqual(errorLabels(1 << 29), ['bit 29']);
});

// --------------------------------------------------------------- framing
const ACK = Uint8Array.from([0xaa, 0x55, 0x90, 0xeb, 0xc8, 0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x44]);
const AT = Uint8Array.from([0x41, 0x54, 0x0d, 0x0a]); // "AT\r\n"
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
function collect(chunks) {
  const bms = new JkBms();
  const seen = { data: [], device: [], settings: [], log: [] };
  for (const k of Object.keys(seen)) bms.addEventListener(k, (e) => seen[k].push(e.detail));
  for (const c of chunks) bms._onNotify(c);
  return seen;
}
const split = (bytes, n) => { const out = []; for (let i = 0; i < bytes.length; i += n) out.push(bytes.slice(i, i + n)); return out; };

test('reassembles a frame split across 20-byte notifications, leading junk', () => {
  const seen = collect([Uint8Array.from([0x11, 0x22, 0x33]), ...split(F.OWNER_32S_CELL, 20)]);
  assert.equal(seen.data.length, 1);
  assert.equal(seen.data[0].soc, 53);
});

test('reassembles 128-byte notifications with AT\\r\\n junk and the command ACK interleaved (JK-PB behaviour)', () => {
  const stream = cat(AT, F.AIO_PB15_DEV, ACK, AT, AT, F.AIO_PB15_CELL, AT, ACK);
  const seen = collect(split(stream, 128));
  assert.equal(seen.device.length, 1);
  assert.equal(seen.device[0].swVersion, '15.38');
  assert.equal(seen.data.length, 1);
  assert.equal(seen.data[0].variant, 'JK02_32S');
  assert.equal(seen.data[0].layoutSource, 'firmware'); // device info arrived first
});

test('device info followed by settings then cell info: each frame type dispatched once', () => {
  const stream = cat(F.AIO_24S_DEV, F.ESPHOME_24S_SETTINGS, F.AIO_24S_CELL);
  const seen = collect(split(stream, 244));
  assert.equal(seen.device.length, 1);
  assert.equal(seen.settings.length, 1);
  assert.equal(seen.settings[0].cellCount, 13);
  assert.equal(seen.data.length, 1);
  assert.equal(seen.data[0].variant, 'JK02_24S');
});

test('rejects a frame with a bad checksum and recovers on the next one', () => {
  const bad = F.AIO_32S_CELL.slice(); bad[299] ^= 0xff;
  const seen = collect([bad, F.AIO_32S_CELL]);
  assert.equal(seen.data.length, 1);
  assert.equal(seen.data[0].soc, 68);
  assert.ok(seen.log.some((l) => /checksum/.test(l)));
});

test('a spliced window (dropped notification) is rejected even if its 8-bit sum happens to match', () => {
  // tail of one frame + head of the next, forced to a matching checksum
  const spliced = cat(F.MPP_24S_16CELL.slice(0, 150), F.MPP_24S_16CELL.slice(0, 150));
  let sum = 0; for (let i = 0; i < 299; i++) sum += spliced[i]; spliced[299] = sum & 0xff;
  const r = feedFrames(new Uint8Array(0), spliced);
  assert.equal(r.frames.length, 0);
  assert.ok(r.notes.some((n) => /spliced|checksum/.test(n)));
});

test('an unknown frame type with a valid checksum is skipped', () => {
  const odd = F.MPP_24S_16CELL.slice(); odd[4] = 0x07;
  let sum = 0; for (let i = 0; i < 299; i++) sum += odd[i]; odd[299] = sum & 0xff;
  const r = feedFrames(new Uint8Array(0), odd);
  assert.equal(r.frames.length, 0);
  assert.ok(r.notes.some((n) => /unknown frame type 0x7/.test(n)));
});
