// BatRay by ClearEvo.com - JK BMS BLE protocol and frame decoder (pure, tested)
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
import { Flag } from './sync.js';

// JK BMS (JiKong) BLE protocol - Web Bluetooth.
//
// Transport
//   service        0xFFE0
//   characteristic 0xFFE1 (notify + write)
//
// Request frames are 20 bytes:
//   AA 55 90 EB <cmd> <len> <val:u32le> <9x 00> <checksum>
//   checksum = sum(bytes[0..18]) & 0xFF
//
// Response frames are 300 bytes, split across many notifications (20..128+ B),
// and the stream is a raw UART bridge: one notification can hold the tail of
// one frame and the head of the next, the BLE module may splice "AT\r\n" into
// it, and the BMS echoes a 20-byte command-style ACK (AA 55 90 EB C8 01 01 ..)
// after a command. So we resync on the header and consume frame by frame.
//   55 AA EB 90 <type> <counter> ...payload... <checksum>
//   checksum = sum(bytes[0..298]) & 0xFF
//   type 0x01 = settings, 0x02 = cell info, 0x03 = device info, 0x05 = logbook
//
// Layouts. Three generations of firmware share the header but not the payload:
//   JK04      hw <= 3.0 (sw 3.x/4.x): cell values are IEEE floats
//   JK02_24S  sw < 11: 24 cell slots; pack fields from byte 112
//   JK02_32S  sw >= 11 (incl. JK-PB inverter BMS, sw 14/15/19): 32 cell slots,
//             so every pack field sits +32 bytes; the error bitmask is 32 bit
// The offset tables below were checked against real frames from several
// firmwares (see test/jkbms.test.mjs for the captures and their sources).

export const JK_SERVICE = '0000ffe0-0000-1000-8000-00805f9b34fb';
export const JK_CHAR = '0000ffe1-0000-1000-8000-00805f9b34fb';

export const CMD_DEVICE_INFO = 0x97;
export const CMD_CELL_INFO = 0x96;

const RESP_HDR = [0x55, 0xaa, 0xeb, 0x90];
const FRAME_LEN = 300;

export const FRAME_SETTINGS = 0x01;
export const FRAME_CELL_INFO = 0x02;
export const FRAME_DEVICE_INFO = 0x03;
export const FRAME_LOGBOOK = 0x05;
const KNOWN_TYPES = new Set([FRAME_SETTINGS, FRAME_CELL_INFO, FRAME_DEVICE_INFO, FRAME_LOGBOOK]);

export function buildCommand(cmd, value = 0) {
  const f = new Uint8Array(20);
  f[0] = 0xaa; f[1] = 0x55; f[2] = 0x90; f[3] = 0xeb;
  f[4] = cmd;
  f[5] = 0x00; // length
  f[6] = value & 0xff;
  f[7] = (value >> 8) & 0xff;
  f[8] = (value >> 16) & 0xff;
  f[9] = (value >> 24) & 0xff;
  let sum = 0;
  for (let i = 0; i < 19; i++) sum += f[i];
  f[19] = sum & 0xff;
  return f;
}

export function hex(bytes, sep = ' ') {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(sep);
}

function view(frame) {
  return new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
}

function str(frame, at, len) {
  let end = at;
  while (end < at + len && frame[end] !== 0) end++;
  return new TextDecoder().decode(frame.subarray(at, end)).trim();
}

// "11.26" / "V11.48" / "3.3.0" -> 11 / 11 / 3; null when it is not a version
export function swMajor(sw) {
  const m = /(\d+)\./.exec(sw || '');
  return m ? +m[1] : null;
}

// Frame 0x03. Only the non-secret fields: the frame also carries the device
// passcode and setup passcode, which are deliberately not decoded.
export function decodeDeviceInfo(frame) {
  const dv = view(frame);
  const sw = str(frame, 30, 8);
  return {
    model: str(frame, 6, 16),
    hwVersion: str(frame, 22, 8),
    swVersion: sw,
    swMajor: swMajor(sw),
    uptimeS: dv.getUint32(38, true),
    powerOnCount: dv.getUint32(42, true),
    name: str(frame, 46, 16),
    mfgDate: str(frame, 78, 8), // YYMMDD, empty on JK04
    serial: str(frame, 86, 11),
    userData: str(frame, 102, 16),
  };
}

// Frame 0x01 (JK02 only; the JK04 settings frame is floats and not decoded).
// Same offsets on 24S and 32S up to the per-wire calibration array.
export function decodeSettings(frame) {
  const dv = view(frame);
  const u32 = (o) => dv.getUint32(o, true);
  const i32 = (o) => dv.getInt32(o, true);
  return {
    smartSleepV: u32(6) * 0.001,
    cellUvp: u32(10) * 0.001,
    cellUvpr: u32(14) * 0.001,
    cellOvp: u32(18) * 0.001,
    cellOvpr: u32(22) * 0.001,
    balanceTriggerV: u32(26) * 0.001,
    soc100V: u32(30) * 0.001, // JK-PB only, 0 elsewhere
    soc0V: u32(34) * 0.001,
    requestChargeV: u32(38) * 0.001,
    requestFloatV: u32(42) * 0.001,
    powerOffV: u32(46) * 0.001,
    maxChargeA: u32(50) * 0.001,
    chargeOcpDelayS: u32(54),
    chargeOcpRecoveryS: u32(58),
    maxDischargeA: u32(62) * 0.001,
    dischargeOcpDelayS: u32(66),
    dischargeOcpRecoveryS: u32(70),
    scpRecoveryS: u32(74),
    maxBalanceA: u32(78) * 0.001,
    chargeOtp: u32(82) * 0.1,
    chargeOtpRecovery: u32(86) * 0.1,
    dischargeOtp: u32(90) * 0.1,
    dischargeOtpRecovery: u32(94) * 0.1,
    chargeUtp: i32(98) * 0.1,
    chargeUtpRecovery: i32(102) * 0.1,
    mosOtp: i32(106) * 0.1,
    mosOtpRecovery: i32(110) * 0.1,
    cellCount: u32(114),
    chargeSwitch: frame[118] === 1,
    dischargeSwitch: frame[122] === 1,
    balanceSwitch: frame[126] === 1,
    capacityAh: u32(130) * 0.001, // the user-configured pack capacity
    scpDelayUs: u32(134),
    balanceStartV: u32(138) * 0.001,
  };
}

// Error / alarm bit labels for the JK02 bitmask (16 bits on 24S, 32 on 32S),
// as decoded by the JK app and documented by the esphome-jk-bms project.
// Shown next to the raw hex so nothing is lost if a label is off.
export const ERROR_BITS = [
  'Wire resistance', 'MOSFET overtemperature', 'Cell count is not equal to settings', '',
  'Battery is fully charged', 'Battery pack overvoltage', 'Charge overcurrent', 'Charge short circuit',
  'Charge overtemperature', 'Charge undertemperature', 'Coprocessor communication error', 'Cell undervoltage',
  'Battery pack undervoltage', 'Discharge overcurrent', 'Discharge short circuit', 'Discharge overtemperature',
  'Charging MOSFET abnormal', 'Discharging MOSFET abnormal', 'GPS disconnected', 'Modify password in time',
  'Discharge on failed', 'Battery overtemperature', 'Temperature sensor anomaly', 'PL module anomaly',
  'SCP release failed', 'Discharge OCP II', 'Discharge OCP III', 'Discharge undertemperature alarm',
  'GPS remote lock', '', '', '',
];

export function errorLabels(bits) {
  const out = [];
  for (let i = 0; i < 32; i++) if ((bits >>> i) & 1) out.push(ERROR_BITS[i] || `bit ${i}`);
  return out;
}

export const CHARGE_STATUS = ['Bulk', 'Absorption', 'Float'];
export const BATTERY_TYPE = ['LiFePO4', 'Li-ion', 'LTO'];

// JK02 layouts: `o` shifts every pack field, `o16` the per-cell arrays.
const JK02 = {
  JK02_24S: { slots: 24, o16: 0, o: 0, mos: 134, errorsLen: 2 },
  JK02_32S: { slots: 32, o16: 16, o: 32, mos: 144, errorsLen: 4 },
};

const CELL_MIN_MV = 1000;
const CELL_MAX_MV = 4500;
const TEMP_ABSENT = -2000; // raw 0.1 degC value the firmware uses for "no sensor"

function temp(dv, at) {
  const raw = dv.getInt16(at, true);
  return raw === TEMP_ABSENT ? null : raw * 0.1;
}

function popcount(x) {
  let n = 0;
  for (; x; x >>>= 1) n += x & 1;
  return n;
}

function decodeJk02(frame, name) {
  const L = JK02[name];
  const dv = view(frame);
  const { o, o16 } = L;
  const mask = dv.getUint32(54 + o16, true);
  const cells = [];
  for (let i = 0; i < L.slots; i++) {
    const mv = dv.getUint16(6 + i * 2, true);
    const on = mask ? (mask >>> i) & 1 : mv >= CELL_MIN_MV && mv <= CELL_MAX_MV;
    if (on && mv > 0) cells.push({ n: i + 1, v: mv / 1000, mOhm: dv.getUint16(64 + o16 + i * 2, true) });
  }
  const cellSum = cells.reduce((a, c) => a + c.v, 0);
  const packV = dv.getUint32(118 + o, true) * 0.001;
  const current = dv.getInt32(126 + o, true) * 0.001;
  const soc = frame[141 + o];
  const errors = L.errorsLen === 4 ? dv.getUint32(134 + o, true) : dv.getUint16(136, true);
  const tempMask = dv.getUint16(182 + o, true); // bit0 MOS, bit1..5 sensors 1..5 present

  const d = {
    variant: name,
    cells,
    cellSum,
    maskCells: mask ? popcount(mask) : null,
    avgCellV: dv.getUint16(58 + o16, true) * 0.001,
    deltaCellV: dv.getUint16(60 + o16, true) * 0.001,
    maxCell: frame[62 + o16] + 1,
    minCell: frame[63 + o16] + 1,
    wireWarnMask: dv.getUint32(114 + o, true),
    packV,
    current,
    power: packV * current, // byte 122 holds |P| unsigned; sign comes from the current
    tempMos: temp(dv, L.mos),
    temp1: temp(dv, 130 + o),
    temp2: temp(dv, 132 + o),
    errors,
    balanceA: dv.getInt16(138 + o, true) * 0.001,
    balancing: frame[140 + o], // 0 off, 1 charging balancer, 2 discharging balancer
    soc,
    remainAh: dv.getUint32(142 + o, true) * 0.001,
    nominalAh: dv.getUint32(146 + o, true) * 0.001, // BMS-derived full capacity
    cycles: dv.getUint32(150 + o, true),
    cycleAh: dv.getUint32(154 + o, true) * 0.001,
    soh: frame[158 + o],
    precharge: frame[159 + o] === 1,
    runtimeS: dv.getUint32(162 + o, true),
    chgMos: frame[166 + o] === 1,
    dsgMos: frame[167 + o] === 1,
    precharging: frame[168 + o] === 1,
    balancerWorking: frame[169 + o] === 1,
    tempMask,
    heating: frame[183 + o] === 1,
    emergencyS: dv.getUint16(186 + o, true),
    heatingA: dv.getInt16(204 + o, true) * 0.001,
    chargerPlugged: frame[213 + o] === 1,
    temp3: null, temp4: null, temp5: null,
    logCount: null, smartSleepS: null, batteryType: null, chargeStatus: null, chargeStatusS: null,
  };
  if (o) {
    // 32S-only tail (JK-PB extras; harmless zeros on plain 11.x units)
    d.temp3 = tempMask & 8 ? temp(dv, 254) : null;
    d.temp4 = tempMask & 16 ? temp(dv, 256) : null;
    d.temp5 = tempMask & 32 ? temp(dv, 258) : null;
    d.logCount = dv.getUint32(266, true);
    d.smartSleepS = dv.getUint32(270, true);
    d.batteryType = frame[275];
    d.chargeStatusS = dv.getUint16(278, true);
    d.chargeStatus = frame[280];
  }
  d.plausible = soc <= 100 && packV > 1 && cells.length > 0 && Math.abs(current) < 2000;
  d.agreement = Math.abs(packV - cellSum);
  return d;
}

// Old JK04 firmware: 24 float cells, 24 float resistances, no SOC/current.
function decodeJk04(frame) {
  const dv = view(frame);
  const cells = [];
  let finite = true;
  for (let i = 0; i < 24; i++) {
    const v = dv.getFloat32(6 + i * 4, true);
    if (v === 0) continue;
    if (!(v > 0.5 && v < 5)) finite = false;
    cells.push({ n: i + 1, v, mOhm: Math.round(dv.getFloat32(102 + i * 4, true) * 1000) });
  }
  const cellSum = cells.reduce((a, c) => a + c.v, 0);
  return {
    variant: 'JK04',
    cells, cellSum,
    maskCells: null,
    avgCellV: dv.getFloat32(202, true),
    deltaCellV: dv.getFloat32(206, true),
    packV: cellSum, // JK04 has no pack-voltage field; the sum is all there is
    current: null, power: null, soc: null,
    balancing: frame[220],
    balanceA: dv.getFloat32(222, true),
    runtimeS: dv.getUint32(286, true),
    errors: 0,
    plausible: finite && cells.length > 0,
    agreement: 0,
  };
}

// Decode the cell-info frame. `hint` is the firmware major version from the
// device-info frame when known: >= 11 means JK02_32S, < 11 JK02_24S (or JK04
// on 3.x/4.x). The pack-voltage-vs-cell-sum check still runs on the result,
// so a wrong hint cannot silently produce garbage: `confident` is false and
// the winner of the cross-check is reported instead.
export function decodeCellInfo(frame, hint = null) {
  const candidates = [decodeJk02(frame, 'JK02_24S'), decodeJk02(frame, 'JK02_32S')];
  const viable = candidates.filter((c) => c.plausible).sort((a, b) => a.agreement - b.agreement);

  let hinted = null;
  if (hint !== null && hint !== undefined) hinted = hint >= 11 ? candidates[1] : candidates[0];

  // Cells should add up to the pack voltage. Anything past a few hundred mV of
  // drift means the wrong layout, or a firmware we don't know.
  const isConfident = (c) => c && c.plausible && c.agreement < 0.5;

  let best = null;
  let source = 'cell-sum';
  if (isConfident(hinted)) { best = hinted; source = 'firmware'; }
  else if (viable.length) best = viable[0];

  if (!best) {
    const jk04 = decodeJk04(frame);
    if (jk04.plausible) return finish(jk04, true, 'float-cells');
    return { ok: false, reason: 'no plausible layout', candidates };
  }
  return finish(best, isConfident(best), source);
}

function finish(best, confident, source) {
  const volts = best.cells.map((c) => c.v);
  return {
    ok: true,
    confident,
    layoutSource: source,
    ...best,
    cellMin: volts.length ? Math.min(...volts) : null,
    cellMax: volts.length ? Math.max(...volts) : null,
    cellDelta: volts.length ? Math.max(...volts) - Math.min(...volts) : null,
  };
}

// Pure, testable framing: feeds raw notification bytes into `buf`, returns the
// checksum-verified 300-byte frames found and what was discarded.
export function feedFrames(buf, chunk) {
  const merged = new Uint8Array(buf.length + chunk.length);
  merged.set(buf);
  merged.set(chunk, buf.length);
  buf = merged;
  const frames = [];
  const notes = [];
  for (;;) {
    const start = findHeader(buf, 0);
    if (start < 0) {
      // Keep a short tail in case a header straddles two notifications.
      if (buf.length > RESP_HDR.length) buf = buf.slice(buf.length - (RESP_HDR.length - 1));
      break;
    }
    if (start > 0) buf = buf.slice(start);
    if (buf.length < FRAME_LEN) break;

    const frame = buf.slice(0, FRAME_LEN);
    let sum = 0;
    for (let i = 0; i < FRAME_LEN - 1; i++) sum += frame[i];
    const crcOk = (sum & 0xff) === frame[FRAME_LEN - 1];
    // A second header inside the window means a notification was dropped and
    // this window is the tail of one frame plus the head of the next; the
    // 8-bit sum passes such a splice once in 256, so it is checked explicitly.
    const spliced = findHeader(frame, 1) >= 0;
    if (crcOk && KNOWN_TYPES.has(frame[4]) && !spliced) {
      frames.push(frame);
      buf = buf.slice(FRAME_LEN);
      continue;
    }
    notes.push(!crcOk ? 'checksum mismatch, resyncing' : spliced ? 'spliced frame dropped' : `unknown frame type 0x${frame[4].toString(16)}`);
    const next = findHeader(buf, 1);
    if (next < 0) { buf = buf.slice(buf.length - (RESP_HDR.length - 1)); break; }
    buf = buf.slice(next);
  }
  return { buf, frames, notes };
}

// A JK BMS streams cell-info frames 2-3 times a second on its own, so silence
// means the link is gone even while the GATT flag still says connected. Pure
// so both rules stay under test.
export const STALE_MS = 12000;
// A gatt.connect() still pending this long was issued with Bluetooth off (or still turning on): Android itself settles
// a direct connect within ~30 s when the adapter is on. Chrome Android then holds a null GATT handle for the device
// for the life of the browser process (crash 2026-10-07, Chromium BluetoothDeviceWrapper.connectGatt wraps Android's
// null without a check): any disconnect() on it, or the handle's own eviction, kills the whole browser.
export const STUCK_MS = 45000;

/** Has this link gone quiet for longer than a working link ever does? */
export function isStale(lastFrameAt, now = Date.now(), limitMs = STALE_MS) {
  if (!lastFrameAt) return false;              // nothing read yet: not stale, just new
  return now - lastFrameAt > limitMs;
}

/** Is this link gone? Silence past the limit once data has flowed, or a
 *  connection that never answered at all within `startupMs`. */
export function linkGone(lastFrameAt, connectedAt, now = Date.now(), limitMs = STALE_MS, startupMs = 20000) {
  // A frame older than this link's own connect belongs to the previous link:
  // right after a reconnect the fresh link gets the startup grace, or the
  // watchdog kills it before its first frame (live bug, 2026-09-17).
  // No connect time = no link of ours to judge (an attempt still building it, 0.9.82: the old frame time had been
  // taken as this link's and the link was dropped mid service discovery, over and over).
  if (!connectedAt) return false;
  const ownFrame = lastFrameAt && lastFrameAt >= connectedAt ? lastFrameAt : null;
  if (ownFrame) return isStale(ownFrame, now, limitMs);
  return now - connectedAt > startupMs;
}


/** True when a chunk arrives after a gap no live link would produce - i.e.
 *  it was queued while the tab was frozen and is being flushed now. */
export function queuedAfterGap(lastRxAt, now = Date.now(), limitMs = STALE_MS) {
  return !!lastRxAt && now - lastRxAt > limitMs;
}

// A JK BMS streams cell-info frames on its own, 2-3 per second, once it has
// been asked who it is at connect. The old 3 s "poll" (command 0x96) did not
// fetch cell data at all: the owner's logs of 2026-09-22/23 show the BMS
// answering EVERY poll with a settings frame (0x01) plus a device-info frame
// (0x03), 228 pairs per session on both packs, one per 3.02 s - the same read
// the JK app does once at connect, and the BMS beeps each time it serves it
// (owner: "BatRay beeps every few seconds, the JK app once"). So no periodic
// command any more: the stream itself proves the link, and 0x96 is re-sent
// only as a nudge while the stream is quiet (every NUDGE_MS of silence, so at
// most three before the STALE_MS drop). A beep then means the link is sick.
// 0.9.34 (owner's log 2026-09-23 23:04): a 0x96 written right behind 0x97 is
// ignored by the BMS (it is busy serving the 300 B device-info answer), so
// the stream never started and the link fell ~10 s after connect; the JK
// app's order is 0x97, wait for the answer, then 0x96 - see connect().
export const NUDGE_MS = 3000;
export const HANDSHAKE_WAIT_MS = 1500;
// 0.9.69 (owner's n11 log 2026-10-05 07:36, JK_B1A24S15P fw 11.38: "values took time to show"): the handshake's 0x96
// got only the 20 B command echo, the re-ask 3 s later started the stream (0x01 at +0.18 s, first 0x02 at +0.75 s),
// first reading 4.8 s after connect. An ask the BMS has not served (no settings frame since) is repeated after
// STARTUP_QUICK_MS, up to STARTUP_QUICK_ASKS times, then every NUDGE_MS; a served one waits the full NUDGE_MS.
export const STARTUP_QUICK_MS = 1000;
export const STARTUP_QUICK_ASKS = 3;

/** Send a nudge command now? Quiet for NUDGE_MS since the last frame (or since
 *  connect when nothing has arrived yet) and since the previous nudge. */
export function nudgeDecision(lastRxAt, connectedAt, nudgedAt, now = Date.now(), quietMs = NUDGE_MS) {
  const since = lastRxAt || connectedAt;
  if (!since) return false;
  return now - Math.max(since, nudgedAt || 0) >= quietMs;
}
/** Before the first cell-info frame the clock runs from the LAST ASK, not from the last byte received: the owner's
 *  m-00 (PB1A16S15P fw 19.16, log 2026-09-25 01:19) answered the handshake's 0x96 with a 20 B command echo and
 *  "AT\r\n" chatter for seconds (each one bumped lastRxAt, so the silence nudge came only at +7 s and +10 s,
 *  which it ignored, then dropped the link), while the 0.9.31 poll at +3 s had always started its stream. So
 *  until cell info flows: ask again every NUDGE_MS after the previous ask, whatever else arrives. */
export function startupAskDecision(firstCellAt, askedAt, now = Date.now(), everyMs = NUDGE_MS, { settingsAt = null, asks = 0, quickMs = STARTUP_QUICK_MS } = {}) {
  if (firstCellAt || !askedAt) return false;
  const served = settingsAt !== null && settingsAt >= askedAt;      // the settings frame came: the stream is starting, no second ask (a beep)
  return now - askedAt >= (!served && asks < STARTUP_QUICK_ASKS ? quickMs : everyMs);
}

/** One look at a connected link (the connection loop asks every SERVE_TICK_MS and when the device-info answer arrives): what the
 *  loop does now. l = { now, connectedAt, askedAt (the last 0x96, null before the handshake), asks, info (the device
 *  info came), firstCellAt, settingsAt, lastRxAt, lastDataAt } of THIS link. Returns { act: 'stall', ageS } (quiet past
 *  the limit, or never answered: drop it) | { act: 'handshake' } (the first 0x96: after the device info, or after
 *  HANDSHAKE_WAIT_MS without it - 0.9.34) | { act: 'ask' } (no cell info yet - 0.9.42 / 0.9.69) | { act: 'nudge', quietS }
 *  (streaming went quiet - 0.9.33: never a periodic poll, the BMS beeps at each one) | { act: null }. */
export function linkStep(l, { staleMs = STALE_MS, startupMs = 20000, handshakeMs = HANDSHAKE_WAIT_MS, nudgeMs = NUDGE_MS, quickMs = STARTUP_QUICK_MS } = {}) {
  const { now, connectedAt } = l;
  if (linkGone(l.lastDataAt, connectedAt, now, staleMs, startupMs)) return { act: 'stall', ageS: Math.round((now - (l.lastDataAt || connectedAt)) / 1000) };
  if (l.askedAt === null) return l.info || now - connectedAt >= handshakeMs ? { act: 'handshake' } : { act: null };
  if (startupAskDecision(l.firstCellAt, l.askedAt, now, nudgeMs, { settingsAt: l.settingsAt, asks: l.asks, quickMs })) return { act: 'ask' };
  if (l.firstCellAt !== null && nudgeDecision(l.lastRxAt, connectedAt, l.askedAt, now, nudgeMs)) return { act: 'nudge', quietS: Math.round((now - (l.lastRxAt || connectedAt)) / 1000) };
  return { act: null };
}

/** The GATT port of ONE link at a time, and the frame codec on its notifications (0.9.83). No lifecycle in here: the
 *  connect / serve / reconnect flow is the pack's connection loop, the only writer of the connection state. This
 *  class does the GATT calls when the loop asks, and at the boundary (the browser's callbacks) it only sets Flags:
 *  `down` (no GATT link), `voided` (a notification after a gap no live link has: queued while the tab was frozen),
 *  `infoSeen` (the device-info answer of this link). The per-frame decode stays synchronous (the hot path) and emits
 *  'frame' / 'device' / 'settings' / 'data' / 'log' for the app to paint. */
export class JkBms extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.char = null;
    this.buf = new Uint8Array(0);
    this.info = null;                 // last decoded device-info frame
    this.settings = null;
    this._listened = null;
    this._link = 0;                   // the link token: notifications of an older link are no-ops
    this.down = new Flag(true);
    this.voided = new Flag(false);
    this.voidGapS = 0;
    this.infoSeen = new Flag(false);
    this.pending = null;              // the oldest browser connect still unsettled: { since, n, done: Flag }
    this._charTokens = new WeakMap(); // characteristic -> the link token it serves (one listener per object)
    this.openedAt = null;             // when this link's notifications came on
    this._resetLink();
  }

  get connected() {
    return !!(this.device && this.device.gatt && this.device.gatt.connected);
  }

  _resetLink() {
    this.buf = new Uint8Array(0);
    this.lastRxAt = null; this.lastDataAt = null; this.firstCellAt = null; this.settingsAt = null; this.openedAt = null;
    this.rxOther = 0; this.rxOtherAll = 0; this.rxOtherAt = null;     // non-frame notifications: logged (capped), counted
    this.voided.set(false); this.voidGapS = 0;
    this.infoSeen.set(false);
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _log(msg) {
    this._emit('log', msg);
  }

  async requestDevice() {
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth is not available. Use Chrome or Edge (Android or desktop) over HTTPS.');
    }
    // No name filter: JK units advertise plain names ("n11") as often as "JK-..."
    return navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [JK_SERVICE] });
  }

  /** One link set up, step by step: GATT connect, the service, the characteristic, notifications, then the device-info
   *  command (0x97: its answer selects the frame layout, and the BMS takes the cell-info ask only after serving it -
   *  owner's log 2026-09-23). Every step re-checks the signal and that the link is still up (it can drop during the
   *  last write without that write failing - 0.9.82). The browser's own connect is never cancelled: gatt.disconnect()
   *  on a connect still pending crashes Chrome Android when it ran with Bluetooth off (2026-10-07, see STUCK_MS); the
   *  caller stops waiting instead, and the pending connect is tracked in `pending` until the browser settles it. */
  async open(device, signal) {
    const token = ++this._link;
    const own = () => { signal.throwIfAborted(); if (token !== this._link) throw new Error('superseded'); };
    this.device = device; this.info = null; this.settings = null; this.char = null;
    this._resetLink();
    if (this._listened !== device) {                                  // one listener per device: reconnects must not stack them
      device.addEventListener('gattserverdisconnected', () => { if (device.gatt.connected) return; this.char = null; this.down.set(true); });   // a late event of an older link while a new one is up: not ours
      this._listened = device;
    }
    this._log(`connecting to ${device.name || device.id}`);
    const t0 = Date.now();
    const server = await this._track(device.gatt.connect());
    // The attempt gave up (cancel, its 15 s) but the browser connected after all: the connect has SETTLED, so closing
    // it is safe now (only a pending one must never be closed) - else the link stays up with nobody serving it and
    // the BMS's one Bluetooth slot taken (BLE review 2026-11-01).
    if (signal.aborted && token === this._link && device.gatt.connected) { this._log('gatt: connected after its attempt gave up - closing it'); try { device.gatt.disconnect(); } catch { /* already down */ } }
    own();
    this._log(`gatt: server connected in ${Date.now() - t0} ms`);
    this.down.set(!device.gatt.connected);
    const up = () => { own(); if (!device.gatt.connected) throw new Error('GATT Server is disconnected (the link dropped during setup)'); };
    const service = await server.getPrimaryService(JK_SERVICE);
    up();
    this._log(`gatt: service found in ${Date.now() - t0} ms`);
    const char = await service.getCharacteristic(JK_CHAR);
    up();
    if (!this._charTokens.has(char)) char.addEventListener('characteristicvaluechanged', (e) => this._onNotify(new Uint8Array(e.target.value.buffer), this._charTokens.get(char)));   // once per characteristic object
    this._charTokens.set(char, token);
    await char.startNotifications();
    up();
    this.char = char; this.openedAt = Date.now();
    this._log('notifications on');
    await this.write(buildCommand(CMD_DEVICE_INFO));
    up();
  }

  /** The browser queues every gatt.connect() behind the oldest unsettled one; that group is `pending` until all of
   *  them settle (a slow stack settles them together). */
  _track(p) {
    if (!this.pending) this.pending = { since: Date.now(), n: 0, done: new Flag(false) };
    const g = this.pending; g.n++;
    void this._settle(p, g);
    return p;
  }
  async _settle(p, g) {
    try { await p; } catch { /* the attempt reports its own failure */ }
    if (--g.n === 0) { g.done.set(true); if (this.pending === g) this.pending = null; }
  }

  /** Void this link: anything the BLE stack still has queued for it is history (the token makes late notifications
   *  no-ops). A link that is up is closed - a connected link, never a pending connect. */
  drop(reason) {
    this._link++;
    this.buf = new Uint8Array(0);
    this.lastRxAt = null;
    this.char = null;
    this._log(`dropping link: ${reason}`);
    this.close();
  }

  /** Close a link that is up (the person's Disconnect, the chooser, a drop). Nothing to do for a link that is down. */
  close() {
    const dev = this.device;
    if (dev && dev.gatt && dev.gatt.connected) {
      try { dev.gatt.disconnect(); } catch { /* already down */ }
    }
    if (!this.connected) { this.char = null; this.down.set(true); }    // no event comes for a link that was not up
  }

  async write(bytes) {
    if (!this.char) return;
    // writeValueWithoutResponse matches what the BMS expects and avoids a round
    // trip, but isn't on every Chrome build.
    if (this.char.writeValueWithoutResponse) {
      await this.char.writeValueWithoutResponse(bytes);
    } else {
      await this.char.writeValue(bytes);
    }
  }

  _onNotify(chunk, token) {
    if (token !== undefined && token !== this._link) return;    // a superseded link
    const now = Date.now();
    // Android freezes a backgrounded tab: the BLE stack keeps queueing
    // notifications and flushes them all when the tab wakes. Replaying them
    // would paint an hour-old battery as live, so a long gap voids the link
    // (the loop drops it and reconnects for fresh readings).
    if (this.voided.v) return;
    // measured from the last chunk only: before a link's first chunk the 20 s startup grace applies (a BMS that is
    // slow to answer is not a frozen tab - 2026-09-17; the freeze test holds that)
    if (token !== undefined && queuedAfterGap(this.lastRxAt, now)) {         // a GATT link (the demo feeds frames without one)
      this.voidGapS = Math.round((now - this.lastRxAt) / 1000);
      this.voided.set(true);
      return;
    }
    this.lastRxAt = now;
    const { buf, frames, notes } = feedFrames(this.buf, chunk);
    // A notification that is not part of a 300 B frame (the 20 B command ACK,
    // an "AT" splice, whatever the module says on its own): the first few are
    // logged in full - the 2026-09-23 log had something arriving 4 s after
    // connect that was not a frame, and nothing said what.
    if (!frames.length && chunk.length <= 40 && findHeader(chunk, 0) < 0) {
      this.rxOtherAll++; this.rxOtherAt = now;
      if (this.rxOther < 5) { this.rxOther++; this._log(`rx ${chunk.length}B not a frame: ${hex(chunk)}`); }
    }
    this.buf = buf;
    for (const n of notes) this._log(n);
    for (const frame of frames) this._handleFrame(frame);
  }

  _handleFrame(frame) {
    this._emit('frame', frame);
    switch (frame[4]) {
      case FRAME_DEVICE_INFO:
        this.info = decodeDeviceInfo(frame);
        this.infoSeen.set(true);
        this._emit('device', this.info);
        break;
      case FRAME_SETTINGS:
        this.settings = decodeSettings(frame); this.settingsAt = Date.now();
        this._emit('settings', this.settings);
        break;
      case FRAME_CELL_INFO: {
        if (this.firstCellAt === null) this.firstCellAt = Date.now();
        const data = decodeCellInfo(frame, this.info ? this.info.swMajor : null);
        if (data.ok) { this.lastDataAt = Date.now(); this._emit('data', data); }
        else this._log(`cell-info decode failed: ${data.reason}`);
        break;
      }
      default:
        break; // logbook (0x05): not decoded
    }
  }
}

function findHeader(buf, from) {
  for (let i = from; i + RESP_HDR.length <= buf.length; i++) {
    if (buf[i] === RESP_HDR[0] && buf[i + 1] === RESP_HDR[1] && buf[i + 2] === RESP_HDR[2] && buf[i + 3] === RESP_HDR[3]) {
      return i;
    }
  }
  return -1;
}
