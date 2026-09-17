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

const CMD_DEVICE_INFO = 0x97;
const CMD_CELL_INFO = 0x96;

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

// A JK BMS answers every poll, so silence means the link is gone even while
// the GATT flag still says connected. Pure so both rules stay under test.
export const STALE_MS = 12000;

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
  const ownFrame = lastFrameAt && (!connectedAt || lastFrameAt >= connectedAt) ? lastFrameAt : null;
  if (ownFrame) return isStale(ownFrame, now, limitMs);
  if (connectedAt) return now - connectedAt > startupMs;
  return false;
}

/** May a new reconnect attempt start now? One attempt at a time: a connect in
 *  flight (manual tap or countdown), a live link, or a countdown already
 *  running all say no - two attempts in parallel supersede each other and the
 *  pack ends up connected for seconds, then dropped. */
export function reconnectAllowed({ connectPending, connected, countdownRunning }) {
  return !connectPending && !connected && !countdownRunning;
}

/** True when a chunk arrives after a gap no live link would produce - i.e.
 *  it was queued while the tab was frozen and is being flushed now. */
export function queuedAfterGap(lastRxAt, now = Date.now(), limitMs = STALE_MS) {
  return !!lastRxAt && now - lastRxAt > limitMs;
}

export class JkBms extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.char = null;
    this.buf = new Uint8Array(0);
    this.pollTimer = null;
    this.pollMs = 3000;
    this.info = null; // last decoded device-info frame
    this._listened = null;
    this._attempt = 0;
    this.settings = null;
  }

  get connected() {
    return !!(this.device && this.device.gatt && this.device.gatt.connected);
  }

  /**
   * Void this link: anything the BLE stack still has queued for it is history.
   * Bumping the attempt token makes late notifications no-ops. Emits
   * 'disconnected' itself when the GATT link is already down, so the UI never
   * sits on a dead "connected".
   */
  drop(reason) {
    this._attempt = (this._attempt || 0) + 1;
    this._stopPolling();
    this.buf = new Uint8Array(0);
    this.lastRxAt = null;
    const dev = this.device;
    this._log(`dropping link: ${reason}`);
    if (dev && dev.gatt && dev.gatt.connected) {
      this.char = null;
      try { dev.gatt.disconnect(); return; } catch { /* fall through to the manual emit */ }
    }
    this.char = null;
    this._emit('disconnected');
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

  // Connect with a real timeout: on expiry gatt.disconnect() is called, which
  // aborts the pending connect inside the browser (a merely abandoned promise
  // leaves it queued, and every later connect on the same device - even a
  // fresh chooser pick - waits behind it). A stale attempt that resolves after
  // a newer one started is dropped, not reported as connected.
  async connect(device, { timeoutMs = 20000 } = {}) {
    const token = (this._attempt = (this._attempt || 0) + 1);
    const stale = () => this._attempt !== token;
    this.device = device;
    this.info = null;
    this.settings = null;
    this.buf = new Uint8Array(0);
    this.lastRxAt = null;
    if (this._listened !== device) {
      // reconnecting to the same device must not stack listeners
      device.addEventListener('gattserverdisconnected', () => {
        this._stopPolling();
        this.char = null;
        this._emit('disconnected');
      });
      this._listened = device;
    }

    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { device.gatt.disconnect(); } catch { /* nothing to abort */ }
        reject(new Error(`no answer in ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
    });
    const work = (async () => {
      this._log(`connecting to ${device.name || device.id}`);
      const server = await device.gatt.connect();
      if (stale()) throw new Error('superseded');
      const service = await server.getPrimaryService(JK_SERVICE);
      if (stale()) throw new Error('superseded');
      this.char = await service.getCharacteristic(JK_CHAR);
      if (stale()) throw new Error('superseded');
      this.char.addEventListener('characteristicvaluechanged', (e) =>
        this._onNotify(new Uint8Array(e.target.value.buffer), token)
      );
      await this.char.startNotifications();
      if (stale()) throw new Error('superseded');
      this._log('notifications on');
      // Device info first: its firmware version selects the frame layout. Some
      // units only start streaming after they've been asked who they are.
      await this._write(buildCommand(CMD_DEVICE_INFO));
      await this._write(buildCommand(CMD_CELL_INFO));
    })();
    try {
      await Promise.race([work, timeout]);
    } catch (err) {
      // a link left half-open must be dropped; a connect that rejected on its own
      // is not touched again (GATT calls with the adapter off have crashed Chrome)
      if (!stale() && device.gatt.connected) { try { device.gatt.disconnect(); } catch { /* already down */ } }
      throw err;
    } finally {
      clearTimeout(timer);
    }
    this._startPolling();
    this._emit('connected', device);
  }

  async disconnect() {
    this._stopPolling();
    if (this.device && this.device.gatt && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
  }

  async _write(bytes) {
    if (!this.char) return;
    // writeValueWithoutResponse matches what the BMS expects and avoids a round
    // trip, but isn't on every Chrome build.
    if (this.char.writeValueWithoutResponse) {
      await this.char.writeValueWithoutResponse(bytes);
    } else {
      await this.char.writeValue(bytes);
    }
  }

  _startPolling() {
    this._stopPolling();
    this.pollTimer = setInterval(() => {
      if (!this.connected) return;
      this._write(buildCommand(CMD_CELL_INFO)).catch((e) => this._log(`poll failed: ${e.message}`));
    }, this.pollMs);
  }

  _stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  _onNotify(chunk, token) {
    if (token !== undefined && token !== this._attempt) return;   // a superseded link
    const now = Date.now();
    // Android freezes a backgrounded tab: the BLE stack keeps queueing
    // notifications and flushes them all when the tab wakes. Replaying them
    // would paint an hour-old battery as live, so a long gap voids the link
    // and the app reconnects for fresh readings.
    if (queuedAfterGap(this.lastRxAt, now)) {
      const gap = Math.round((now - this.lastRxAt) / 1000);
      this.lastRxAt = null;
      this.drop(`${gap} s without data - queued readings dropped`);
      return;
    }
    this.lastRxAt = now;
    const { buf, frames, notes } = feedFrames(this.buf, chunk);
    this.buf = buf;
    for (const n of notes) this._log(n);
    for (const frame of frames) this._handleFrame(frame);
  }

  _handleFrame(frame) {
    this._emit('frame', frame);
    switch (frame[4]) {
      case FRAME_DEVICE_INFO:
        this.info = decodeDeviceInfo(frame);
        this._emit('device', this.info);
        break;
      case FRAME_SETTINGS:
        this.settings = decodeSettings(frame);
        this._emit('settings', this.settings);
        break;
      case FRAME_CELL_INFO: {
        const data = decodeCellInfo(frame, this.info ? this.info.swMajor : null);
        if (data.ok) this._emit('data', data);
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
