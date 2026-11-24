// BatRay by ClearEvo.com - JK BMS protocol (jkbms crate)
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

//! JK BMS (JiKong) BLE protocol: framing and decoding, the port of BatRay's jkbms.js (which it now
//! replaces in the browser through WebAssembly) and the decoder of BatRay's server side.
//! No standard library, no allocation: decoders read a 300-byte frame and write JSON with exactly the
//! keys and numbers jkbms.js produced (test/batray_jk_parity.test.js holds the two together).
//!
//! Request frames: AA 55 90 EB <cmd> <len> <val:u32le> <9x 00> <checksum>, checksum = sum(0..18).
//! Response frames: 55 AA EB 90 <type> <counter> ...payload... <checksum>, 300 bytes, sum(0..298);
//! type 0x01 settings, 0x02 cell info, 0x03 device info, 0x05 logbook. Three payload layouts:
//! JK04 (hw <= 3.0, float cells), JK02_24S (sw < 11), JK02_32S (sw >= 11, every pack field +32).
#![no_std]

pub mod json;
#[cfg(feature = "wasm-abi")]
mod abi;

use json::W;

pub const FRAME_LEN: usize = 300;
pub const HDR: [u8; 4] = [0x55, 0xaa, 0xeb, 0x90];
pub const CMD_DEVICE_INFO: u8 = 0x97;
pub const CMD_CELL_INFO: u8 = 0x96;
pub const FRAME_SETTINGS: u8 = 0x01;
pub const FRAME_CELL_INFO: u8 = 0x02;
pub const FRAME_DEVICE_INFO: u8 = 0x03;
pub const FRAME_LOGBOOK: u8 = 0x05;
/// A firmware hint of "unknown" (jkbms.js: null).
pub const NO_HINT: i32 = i32::MIN;

const CELL_MIN_MV: u16 = 1000;
const CELL_MAX_MV: u16 = 4500;
const TEMP_ABSENT: i16 = -2000;

pub fn build_command(cmd: u8, value: u32) -> [u8; 20] {
    let mut f = [0u8; 20];
    f[..4].copy_from_slice(&[0xaa, 0x55, 0x90, 0xeb]);
    f[4] = cmd;
    f[6..10].copy_from_slice(&value.to_le_bytes());
    f[19] = f[..19].iter().fold(0u8, |a, b| a.wrapping_add(*b));
    f
}

pub fn find_header(buf: &[u8], from: usize) -> Option<usize> {
    if buf.len() < HDR.len() {
        return None;
    }
    (from..=buf.len() - HDR.len()).find(|&i| buf[i..i + 4] == HDR)
}

fn known_type(t: u8) -> bool {
    matches!(t, FRAME_SETTINGS | FRAME_CELL_INFO | FRAME_DEVICE_INFO | FRAME_LOGBOOK)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Note {
    Checksum,
    Spliced,
    Unknown(u8),
}

/// Framing over the kept bytes plus the new chunk (`buf`): `on_frame(offset)` for every verified
/// 300-byte frame, `on_note` for what was thrown away; returns where the bytes to keep start.
/// The stream is a raw UART bridge: frames straddle notifications, the module splices "AT\r\n",
/// the BMS echoes 20-byte command ACKs - so it resyncs on the header, frame by frame.
pub fn feed(buf: &[u8], mut on_frame: impl FnMut(usize), mut on_note: impl FnMut(Note)) -> usize {
    let keep_tail = buf.len().saturating_sub(HDR.len() - 1);
    let mut s = 0;
    loop {
        match find_header(&buf[s..], 0) {
            None => {
                // a header may straddle two notifications: keep a short tail
                if buf.len() - s > HDR.len() {
                    s = keep_tail;
                }
                break;
            }
            Some(st) => s += st,
        }
        if buf.len() - s < FRAME_LEN {
            break;
        }
        let frame = &buf[s..s + FRAME_LEN];
        let crc_ok = frame[..FRAME_LEN - 1].iter().fold(0u8, |a, b| a.wrapping_add(*b)) == frame[FRAME_LEN - 1];
        // a second header inside the window = a dropped notification spliced two frames
        let spliced = find_header(frame, 1).is_some();
        if crc_ok && known_type(frame[4]) && !spliced {
            on_frame(s);
            s += FRAME_LEN;
            continue;
        }
        on_note(if !crc_ok { Note::Checksum } else if spliced { Note::Spliced } else { Note::Unknown(frame[4]) });
        match find_header(&buf[s..], 1) {
            None => {
                s = keep_tail;
                break;
            }
            Some(n) => s += n,
        }
    }
    s
}

fn u16le(f: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([f[o], f[o + 1]])
}
fn i16le(f: &[u8], o: usize) -> i16 {
    i16::from_le_bytes([f[o], f[o + 1]])
}
fn u32le(f: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([f[o], f[o + 1], f[o + 2], f[o + 3]])
}
fn i32le(f: &[u8], o: usize) -> i32 {
    i32::from_le_bytes([f[o], f[o + 1], f[o + 2], f[o + 3]])
}
fn f32le(f: &[u8], o: usize) -> f64 {
    f32::from_le_bytes([f[o], f[o + 1], f[o + 2], f[o + 3]]) as f64
}

/// The text field at `at`: up to the first 0 byte, lossy UTF-8, trimmed as JavaScript trims.
pub fn text(f: &[u8], at: usize, len: usize) -> &[u8] {
    let field = &f[at..at + len];
    let end = field.iter().position(|&b| b == 0).unwrap_or(len);
    &field[..end]
}

/// "11.26" / "V11.48" / "3.3.0" -> 11 / 11 / 3; None when it is not a version (jkbms.js swMajor).
pub fn sw_major(s: &[u8]) -> Option<f64> {
    let mut i = 0;
    while i < s.len() {
        if s[i].is_ascii_digit() {
            let mut j = i;
            let mut v = 0f64;
            while j < s.len() && s[j].is_ascii_digit() {
                v = v * 10.0 + (s[j] - b'0') as f64;
                j += 1;
            }
            if j < s.len() && s[j] == b'.' {
                return Some(v);
            }
            i = j;
        } else {
            i += 1;
        }
    }
    None
}

/// Frame 0x03, the non-secret fields only (the passcodes in it are deliberately not decoded).
pub fn device_info_json(f: &[u8], w: &mut W) {
    let mut sw = [0u8; json::TEXT_MAX];
    let swl = json::lossy_trim(text(f, 30, 8), &mut sw);
    w.open();
    w.key_text("model", text(f, 6, 16));
    w.key_text("hwVersion", text(f, 22, 8));
    w.key_raw_text("swVersion", &sw[..swl]);
    w.key_opt_num("swMajor", sw_major(&sw[..swl]));
    w.key_u("uptimeS", u32le(f, 38) as u64);
    w.key_u("powerOnCount", u32le(f, 42) as u64);
    w.key_text("name", text(f, 46, 16));
    w.key_text("mfgDate", text(f, 78, 8));
    w.key_text("serial", text(f, 86, 11));
    w.key_text("userData", text(f, 102, 16));
    w.close();
}

/// Frame 0x01 (JK02; the JK04 settings frame is floats and not decoded).
pub fn settings_json(f: &[u8], w: &mut W) {
    let m = |o: usize| u32le(f, o) as f64 * 0.001;
    let d = |o: usize| u32le(f, o) as f64 * 0.1;
    let di = |o: usize| i32le(f, o) as f64 * 0.1;
    let u = |o: usize| u32le(f, o) as u64;
    w.open();
    for (k, o) in [("smartSleepV", 6), ("cellUvp", 10), ("cellUvpr", 14), ("cellOvp", 18), ("cellOvpr", 22),
                   ("balanceTriggerV", 26), ("soc100V", 30), ("soc0V", 34), ("requestChargeV", 38),
                   ("requestFloatV", 42), ("powerOffV", 46), ("maxChargeA", 50)] {
        w.key_num(k, m(o));
    }
    w.key_u("chargeOcpDelayS", u(54));
    w.key_u("chargeOcpRecoveryS", u(58));
    w.key_num("maxDischargeA", m(62));
    w.key_u("dischargeOcpDelayS", u(66));
    w.key_u("dischargeOcpRecoveryS", u(70));
    w.key_u("scpRecoveryS", u(74));
    w.key_num("maxBalanceA", m(78));
    w.key_num("chargeOtp", d(82));
    w.key_num("chargeOtpRecovery", d(86));
    w.key_num("dischargeOtp", d(90));
    w.key_num("dischargeOtpRecovery", d(94));
    w.key_num("chargeUtp", di(98));
    w.key_num("chargeUtpRecovery", di(102));
    w.key_num("mosOtp", di(106));
    w.key_num("mosOtpRecovery", di(110));
    w.key_u("cellCount", u(114));
    w.key_bool("chargeSwitch", f[118] == 1);
    w.key_bool("dischargeSwitch", f[122] == 1);
    w.key_bool("balanceSwitch", f[126] == 1);
    w.key_num("capacityAh", m(130));
    w.key_u("scpDelayUs", u(134));
    w.key_num("balanceStartV", m(138));
    w.close();
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cell {
    pub n: u32,
    pub v: f64,
    pub m_ohm: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Variant {
    Jk02_24S,
    Jk02_32S,
    Jk04,
}

impl Variant {
    pub fn name(self) -> &'static str {
        match self {
            Variant::Jk02_24S => "JK02_24S",
            Variant::Jk02_32S => "JK02_32S",
            Variant::Jk04 => "JK04",
        }
    }
}

/// One decoded cell-info frame. The fields JK04 frames lack are None and are not written for JK04.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CellInfo {
    pub variant: Variant,
    pub cells: [Cell; 32],
    pub n_cells: usize,
    pub cell_sum: f64,
    pub mask_cells: Option<u32>,
    pub avg_cell_v: f64,
    pub delta_cell_v: f64,
    pub max_cell: u32,
    pub min_cell: u32,
    pub wire_warn_mask: u32,
    pub pack_v: f64,
    pub current: Option<f64>,
    pub power: Option<f64>,
    pub temp_mos: Option<f64>,
    pub temp1: Option<f64>,
    pub temp2: Option<f64>,
    pub errors: u32,
    pub balance_a: f64,
    pub balancing: u8,
    pub soc: Option<u8>,
    pub remain_ah: f64,
    pub nominal_ah: f64,
    pub cycles: u32,
    pub cycle_ah: f64,
    pub soh: u8,
    pub precharge: bool,
    pub runtime_s: u32,
    pub chg_mos: bool,
    pub dsg_mos: bool,
    pub precharging: bool,
    pub balancer_working: bool,
    pub temp_mask: u16,
    pub heating: bool,
    pub emergency_s: u16,
    pub heating_a: f64,
    pub charger_plugged: bool,
    pub temp3: Option<f64>,
    pub temp4: Option<f64>,
    pub temp5: Option<f64>,
    pub log_count: Option<u32>,
    pub smart_sleep_s: Option<u32>,
    pub battery_type: Option<u8>,
    pub charge_status: Option<u8>,
    pub charge_status_s: Option<u16>,
    pub plausible: bool,
    pub agreement: f64,
}

const NO_CELL: Cell = Cell { n: 0, v: 0.0, m_ohm: 0.0 };

fn temp(f: &[u8], at: usize) -> Option<f64> {
    let raw = i16le(f, at);
    if raw == TEMP_ABSENT {
        None
    } else {
        Some(raw as f64 * 0.1)
    }
}

pub fn decode_jk02(f: &[u8], v: Variant) -> CellInfo {
    let (slots, o16, o, mos, errors_len) = match v {
        Variant::Jk02_32S => (32usize, 16usize, 32usize, 144usize, 4),
        _ => (24, 0, 0, 134, 2),
    };
    let mask = u32le(f, 54 + o16);
    let mut cells = [NO_CELL; 32];
    let mut n = 0;
    for i in 0..slots {
        let mv = u16le(f, 6 + i * 2);
        let on = if mask != 0 { (mask >> i) & 1 == 1 } else { (CELL_MIN_MV..=CELL_MAX_MV).contains(&mv) };
        if on && mv > 0 {
            cells[n] = Cell { n: i as u32 + 1, v: mv as f64 / 1000.0, m_ohm: u16le(f, 64 + o16 + i * 2) as f64 };
            n += 1;
        }
    }
    let cell_sum = cells[..n].iter().fold(0.0, |a, c| a + c.v);
    let pack_v = u32le(f, 118 + o) as f64 * 0.001;
    let current = i32le(f, 126 + o) as f64 * 0.001;
    let soc = f[141 + o];
    let errors = if errors_len == 4 { u32le(f, 134 + o) } else { u16le(f, 136) as u32 };
    let temp_mask = u16le(f, 182 + o);
    let t = o > 0;
    CellInfo {
        variant: v,
        cells,
        n_cells: n,
        cell_sum,
        mask_cells: if mask != 0 { Some(mask.count_ones()) } else { None },
        avg_cell_v: u16le(f, 58 + o16) as f64 * 0.001,
        delta_cell_v: u16le(f, 60 + o16) as f64 * 0.001,
        max_cell: f[62 + o16] as u32 + 1,
        min_cell: f[63 + o16] as u32 + 1,
        wire_warn_mask: u32le(f, 114 + o),
        pack_v,
        current: Some(current),
        power: Some(pack_v * current),
        temp_mos: temp(f, mos),
        temp1: temp(f, 130 + o),
        temp2: temp(f, 132 + o),
        errors,
        balance_a: i16le(f, 138 + o) as f64 * 0.001,
        balancing: f[140 + o],
        soc: Some(soc),
        remain_ah: u32le(f, 142 + o) as f64 * 0.001,
        nominal_ah: u32le(f, 146 + o) as f64 * 0.001,
        cycles: u32le(f, 150 + o),
        cycle_ah: u32le(f, 154 + o) as f64 * 0.001,
        soh: f[158 + o],
        precharge: f[159 + o] == 1,
        runtime_s: u32le(f, 162 + o),
        chg_mos: f[166 + o] == 1,
        dsg_mos: f[167 + o] == 1,
        precharging: f[168 + o] == 1,
        balancer_working: f[169 + o] == 1,
        temp_mask,
        heating: f[183 + o] == 1,
        emergency_s: u16le(f, 186 + o),
        heating_a: i16le(f, 204 + o) as f64 * 0.001,
        charger_plugged: f[213 + o] == 1,
        temp3: if t && temp_mask & 8 != 0 { temp(f, 254) } else { None },
        temp4: if t && temp_mask & 16 != 0 { temp(f, 256) } else { None },
        temp5: if t && temp_mask & 32 != 0 { temp(f, 258) } else { None },
        log_count: if t { Some(u32le(f, 266)) } else { None },
        smart_sleep_s: if t { Some(u32le(f, 270)) } else { None },
        battery_type: if t { Some(f[275]) } else { None },
        charge_status: if t { Some(f[280]) } else { None },
        charge_status_s: if t { Some(u16le(f, 278)) } else { None },
        plausible: soc <= 100 && pack_v > 1.0 && n > 0 && js_abs(current) < 2000.0,
        agreement: js_abs(pack_v - cell_sum),
    }
}

/// Old JK04 firmware: 24 float cells, 24 float resistances, no SOC / current.
pub fn decode_jk04(f: &[u8]) -> CellInfo {
    let mut cells = [NO_CELL; 32];
    let mut n = 0;
    let mut finite = true;
    for i in 0..24 {
        let v = f32le(f, 6 + i * 4);
        if v == 0.0 {
            continue;
        }
        if !(v > 0.5 && v < 5.0) {
            finite = false;
        }
        cells[n] = Cell { n: i as u32 + 1, v, m_ohm: js_round(f32le(f, 102 + i * 4) * 1000.0) };
        n += 1;
    }
    let cell_sum = cells[..n].iter().fold(0.0, |a, c| a + c.v);
    CellInfo {
        variant: Variant::Jk04,
        cells,
        n_cells: n,
        cell_sum,
        mask_cells: None,
        avg_cell_v: f32le(f, 202),
        delta_cell_v: f32le(f, 206),
        max_cell: 0,
        min_cell: 0,
        wire_warn_mask: 0,
        pack_v: cell_sum,
        current: None,
        power: None,
        temp_mos: None,
        temp1: None,
        temp2: None,
        errors: 0,
        balance_a: f32le(f, 222),
        balancing: f[220],
        soc: None,
        remain_ah: 0.0,
        nominal_ah: 0.0,
        cycles: 0,
        cycle_ah: 0.0,
        soh: 0,
        precharge: false,
        runtime_s: u32le(f, 286),
        chg_mos: false,
        dsg_mos: false,
        precharging: false,
        balancer_working: false,
        temp_mask: 0,
        heating: false,
        emergency_s: 0,
        heating_a: 0.0,
        charger_plugged: false,
        temp3: None,
        temp4: None,
        temp5: None,
        log_count: None,
        smart_sleep_s: None,
        battery_type: None,
        charge_status: None,
        charge_status_s: None,
        plausible: finite && n > 0,
        agreement: 0.0,
    }
}

fn js_abs(x: f64) -> f64 {
    if x < 0.0 {
        -x
    } else {
        x
    }
}

fn floor(x: f64) -> f64 {
    let t = x as i64 as f64;
    if t > x {
        t - 1.0
    } else {
        t
    }
}

/// JavaScript's Math.round (halves go up, -0 kept), without libm.
pub fn js_round(x: f64) -> f64 {
    if x.is_nan() || x.is_infinite() || js_abs(x) >= 4503599627370496.0 {
        return x;
    }
    if x < 0.0 && x >= -0.5 || (x == 0.0 && x.is_sign_negative()) {
        return -0.0;
    }
    let fl = floor(x);
    if x - fl >= 0.5 {
        fl + 1.0
    } else {
        fl
    }
}

/// Math.min / Math.max over the cell volts: NaN wins, -0 is below +0.
fn js_min_max(c: &[Cell]) -> (f64, f64) {
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for x in c.iter().map(|c| c.v) {
        if x.is_nan() {
            return (f64::NAN, f64::NAN);
        }
        if x < lo || (x == 0.0 && lo == 0.0 && x.is_sign_negative()) {
            lo = x;
        }
        if x > hi || (x == 0.0 && hi == 0.0 && hi.is_sign_negative()) {
            hi = x;
        }
    }
    (lo, hi)
}

pub fn confident(c: &CellInfo) -> bool {
    c.plausible && c.agreement < 0.5
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Firmware,
    CellSum,
    FloatCells,
}

impl Source {
    pub fn name(self) -> &'static str {
        match self {
            Source::Firmware => "firmware",
            Source::CellSum => "cell-sum",
            Source::FloatCells => "float-cells",
        }
    }
}

pub enum Decoded {
    Ok { info: CellInfo, confident: bool, source: Source },
    Failed { candidates: [CellInfo; 2] },
}

/// The cell-info frame. `hint` = the firmware major version from the device-info frame (or
/// NO_HINT): >= 11 means JK02_32S, else JK02_24S. The pack-voltage-vs-cell-sum check still runs, so a
/// wrong hint cannot produce garbage silently: the cross-check winner is used instead.
pub fn decode_cell_info(f: &[u8], hint: i32) -> Decoded {
    let c = [decode_jk02(f, Variant::Jk02_24S), decode_jk02(f, Variant::Jk02_32S)];
    let viable = match (c[0].plausible, c[1].plausible) {
        (true, true) => Some(if c[1].agreement < c[0].agreement { 1 } else { 0 }),
        (true, false) => Some(0),
        (false, true) => Some(1),
        _ => None,
    };
    let hinted = if hint == NO_HINT { None } else if hint >= 11 { Some(1) } else { Some(0) };
    let best = match hinted {
        Some(h) if confident(&c[h]) => Some((h, Source::Firmware)),
        _ => viable.map(|v| (v, Source::CellSum)),
    };
    match best {
        Some((b, source)) => Decoded::Ok { info: c[b], confident: confident(&c[b]), source },
        None => {
            let j = decode_jk04(f);
            if j.plausible {
                Decoded::Ok { info: j, confident: true, source: Source::FloatCells }
            } else {
                Decoded::Failed { candidates: c }
            }
        }
    }
}

fn cell_fields_json(c: &CellInfo, w: &mut W) {
    w.key_str("variant", c.variant.name());
    w.key("cells");
    w.arr_open();
    for cell in &c.cells[..c.n_cells] {
        w.item();
        w.open();
        w.key_u("n", cell.n as u64);
        w.key_num("v", cell.v);
        w.key_num("mOhm", cell.m_ohm);
        w.close();
    }
    w.arr_close();
    w.key_num("cellSum", c.cell_sum);
    match c.mask_cells {
        Some(m) => w.key_u("maskCells", m as u64),
        None => w.key_null("maskCells"),
    }
    w.key_num("avgCellV", c.avg_cell_v);
    w.key_num("deltaCellV", c.delta_cell_v);
    if c.variant == Variant::Jk04 {
        w.key_num("packV", c.pack_v);
        w.key_null("current");
        w.key_null("power");
        w.key_null("soc");
        w.key_u("balancing", c.balancing as u64);
        w.key_num("balanceA", c.balance_a);
        w.key_u("runtimeS", c.runtime_s as u64);
        w.key_u("errors", 0);
        w.key_bool("plausible", c.plausible);
        w.key_num("agreement", c.agreement);
        return;
    }
    w.key_u("maxCell", c.max_cell as u64);
    w.key_u("minCell", c.min_cell as u64);
    w.key_u("wireWarnMask", c.wire_warn_mask as u64);
    w.key_num("packV", c.pack_v);
    w.key_opt_num("current", c.current);
    w.key_opt_num("power", c.power);
    w.key_opt_num("tempMos", c.temp_mos);
    w.key_opt_num("temp1", c.temp1);
    w.key_opt_num("temp2", c.temp2);
    w.key_u("errors", c.errors as u64);
    w.key_num("balanceA", c.balance_a);
    w.key_u("balancing", c.balancing as u64);
    w.key_opt_num("soc", c.soc.map(|s| s as f64));
    w.key_num("remainAh", c.remain_ah);
    w.key_num("nominalAh", c.nominal_ah);
    w.key_u("cycles", c.cycles as u64);
    w.key_num("cycleAh", c.cycle_ah);
    w.key_u("soh", c.soh as u64);
    w.key_bool("precharge", c.precharge);
    w.key_u("runtimeS", c.runtime_s as u64);
    w.key_bool("chgMos", c.chg_mos);
    w.key_bool("dsgMos", c.dsg_mos);
    w.key_bool("precharging", c.precharging);
    w.key_bool("balancerWorking", c.balancer_working);
    w.key_u("tempMask", c.temp_mask as u64);
    w.key_bool("heating", c.heating);
    w.key_u("emergencyS", c.emergency_s as u64);
    w.key_num("heatingA", c.heating_a);
    w.key_bool("chargerPlugged", c.charger_plugged);
    w.key_opt_num("temp3", c.temp3);
    w.key_opt_num("temp4", c.temp4);
    w.key_opt_num("temp5", c.temp5);
    w.key_opt_num("logCount", c.log_count.map(|x| x as f64));
    w.key_opt_num("smartSleepS", c.smart_sleep_s.map(|x| x as f64));
    w.key_opt_num("batteryType", c.battery_type.map(|x| x as f64));
    w.key_opt_num("chargeStatus", c.charge_status.map(|x| x as f64));
    w.key_opt_num("chargeStatusS", c.charge_status_s.map(|x| x as f64));
    w.key_bool("plausible", c.plausible);
    w.key_num("agreement", c.agreement);
}

/// jkbms.js decodeCellInfo(frame, hint) as JSON.
pub fn cell_info_json(f: &[u8], hint: i32, w: &mut W) {
    match decode_cell_info(f, hint) {
        Decoded::Ok { info, confident, source } => {
            w.open();
            w.key_bool("ok", true);
            w.key_bool("confident", confident);
            w.key_str("layoutSource", source.name());
            cell_fields_json(&info, w);
            if info.n_cells == 0 {
                w.key_null("cellMin");
                w.key_null("cellMax");
                w.key_null("cellDelta");
            } else {
                let (lo, hi) = js_min_max(&info.cells[..info.n_cells]);
                w.key_num("cellMin", lo);
                w.key_num("cellMax", hi);
                w.key_num("cellDelta", hi - lo);
            }
            w.close();
        }
        Decoded::Failed { candidates } => {
            w.open();
            w.key_bool("ok", false);
            w.key_str("reason", "no plausible layout");
            w.key("candidates");
            w.arr_open();
            for c in &candidates {
                w.item();
                w.open();
                cell_fields_json(c, w);
                w.close();
            }
            w.arr_close();
            w.close();
        }
    }
}

/// jkbms.js feedFrames as JSON: {"rest": offset of the bytes to keep, "frames": [offsets],
/// "notes": [texts]}.
pub fn feed_json(buf: &[u8], w: &mut W) {
    let mut frames = [0usize; 256];
    let mut nf = 0;
    let mut notes = [Note::Checksum; 256];
    let mut nn = 0;
    let rest = feed(
        buf,
        |o| {
            if nf < frames.len() {
                frames[nf] = o;
                nf += 1;
            }
        },
        |n| {
            if nn < notes.len() {
                notes[nn] = n;
                nn += 1;
            }
        },
    );
    w.open();
    w.key_u("rest", rest as u64);
    w.key("frames");
    w.arr_open();
    for o in &frames[..nf] {
        w.item();
        w.u(*o as u64);
    }
    w.arr_close();
    w.key("notes");
    w.arr_open();
    for n in &notes[..nn] {
        w.item();
        match n {
            Note::Checksum => w.str("checksum mismatch, resyncing"),
            Note::Spliced => w.str("spliced frame dropped"),
            Note::Unknown(t) => w.str_unknown_type(*t),
        }
    }
    w.arr_close();
    w.close();
}

pub const ERROR_BITS: [&str; 32] = [
    "Wire resistance", "MOSFET overtemperature", "Cell count is not equal to settings", "",
    "Battery is fully charged", "Battery pack overvoltage", "Charge overcurrent", "Charge short circuit",
    "Charge overtemperature", "Charge undertemperature", "Coprocessor communication error", "Cell undervoltage",
    "Battery pack undervoltage", "Discharge overcurrent", "Discharge short circuit", "Discharge overtemperature",
    "Charging MOSFET abnormal", "Discharging MOSFET abnormal", "GPS disconnected", "Modify password in time",
    "Discharge on failed", "Battery overtemperature", "Temperature sensor anomaly", "PL module anomaly",
    "SCP release failed", "Discharge OCP II", "Discharge OCP III", "Discharge undertemperature alarm",
    "GPS remote lock", "", "", "",
];

#[cfg(test)]
mod tests;
