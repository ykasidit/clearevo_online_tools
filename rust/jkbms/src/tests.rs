// BatRay by ClearEvo.com - JK BMS protocol (jkbms crate): tests on real frames
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

// The same expectations as test/batray_jkbms.test.js; the field-by-field match with the JavaScript
// decoder over every frame and thousands of mutations is test/batray_jk_parity.test.js.
extern crate std;
use super::*;
use serde_json::Value;
use std::vec::Vec;

#[path = "tests_frames.rs"]
mod fx;

fn json_of(f: impl FnOnce(&mut W)) -> Value {
    let mut buf = std::vec![0u8; 64 * 1024];
    let mut w = W::new(&mut buf);
    f(&mut w);
    assert!(!w.overflow);
    serde_json::from_slice(w.bytes()).expect("valid JSON")
}

fn cell(f: &[u8], hint: i32) -> Value {
    json_of(|w| cell_info_json(f, hint, w))
}

fn near(v: &Value, x: f64, tol: f64) {
    let got = v.as_f64().unwrap_or(f64::NAN);
    assert!((got - x).abs() <= tol, "{got} vs {x}");
}

#[test]
fn commands_carry_their_checksum() {
    assert_eq!(build_command(0x97, 0)[19], 0x11);
    assert_eq!(build_command(0x96, 0)[19], 0x10);
    assert_eq!(&build_command(0x96, 0x0102_0304)[..10], &[0xaa, 0x55, 0x90, 0xeb, 0x96, 0, 4, 3, 2, 1]);
}

#[test]
fn owner_unit_32s_without_a_hint() {
    let d = cell(&fx::OWNER_32S_CELL, NO_HINT);
    assert_eq!(d["ok"], true);
    assert_eq!(d["confident"], true);
    assert_eq!(d["variant"], "JK02_32S");
    assert_eq!(d["layoutSource"], "cell-sum");
    assert_eq!(d["cells"].as_array().unwrap().len(), 14);
    assert_eq!(d["maskCells"], 14);
    near(&d["packV"], 50.667, 0.001);
    near(&d["cellSum"], 50.669, 0.001);
    near(&d["current"], 4.2, 0.001);
    near(&d["power"], 212.8, 0.01);
    assert_eq!(d["soc"], 53);
    near(&d["remainAh"], 126.579, 0.001);
    near(&d["nominalAh"], 238.0, 0.001);
    assert_eq!(d["cycles"], 120);
    assert_eq!(d["soh"], 100);
    near(&d["temp1"], 30.4, 0.001);
    near(&d["temp2"], 29.2, 0.001);
    near(&d["tempMos"], 30.0, 0.001);
    assert_eq!(d["chgMos"], true);
    assert_eq!(d["cells"][0]["mOhm"], 56);
    assert_eq!(d["errors"], 0);
    assert_eq!(d["runtimeS"], 74026709);
}

#[test]
fn hints_are_taken_when_they_agree_and_overruled_when_wrong() {
    let d = cell(&fx::OWNER_32S_CELL, 11);
    assert_eq!((d["variant"].as_str(), d["layoutSource"].as_str()), (Some("JK02_32S"), Some("firmware")));
    let d = cell(&fx::OWNER_32S_CELL, 10);
    assert_eq!((d["variant"].as_str(), d["layoutSource"].as_str()), (Some("JK02_32S"), Some("cell-sum")));
}

#[test]
fn device_info_and_24s_layout() {
    let i = json_of(|w| device_info_json(&fx::AIO_24S_DEV, w));
    let major = i["swMajor"].as_f64().unwrap() as i32;
    assert!(major < 11);
    let d = cell(&fx::AIO_24S_CELL, major);
    assert_eq!(d["variant"], "JK02_24S");
    assert_eq!(d["temp3"], Value::Null);
    let i = json_of(|w| device_info_json(&fx::AIO_PB15_DEV, w));
    assert_eq!(i["swVersion"], "15.38");
    assert_eq!(i["swMajor"], 15);
}

#[test]
fn jk04_float_cells() {
    let d = cell(&fx::ESPHOME_JK04_CELL, NO_HINT);
    assert_eq!(d["ok"], true);
    assert_eq!(d["variant"], "JK04");
    assert_eq!(d["layoutSource"], "float-cells");
    assert_eq!(d["soc"], Value::Null);
    assert!(d.get("tempMos").is_none(), "JK04 objects have no tempMos key");
}

#[test]
fn settings_frame() {
    let s = json_of(|w| settings_json(&fx::ESPHOME_24S_SETTINGS, w));
    assert_eq!(s["cellCount"], 13);
    assert!(s["cellOvp"].as_f64().unwrap() > 3.0 && s["cellOvp"].as_f64().unwrap() < 4.5);
    assert_eq!(s["chargeSwitch"].as_bool().is_some(), true);
}

#[test]
fn garbage_is_no_plausible_layout() {
    let d = cell(&[0xffu8; 300], NO_HINT);
    assert_eq!(d["ok"], false);
    assert_eq!(d["reason"], "no plausible layout");
    assert_eq!(d["candidates"].as_array().unwrap().len(), 2);
}

fn frames_of(buf: &[u8]) -> (Vec<usize>, Vec<Note>, usize) {
    let (mut f, mut n) = (Vec::new(), Vec::new());
    let rest = feed(buf, |o| f.push(o), |x| n.push(x));
    (f, n, rest)
}

#[test]
fn framing_resyncs_on_junk_acks_and_bad_checksums() {
    let ack = [0xaa, 0x55, 0x90, 0xeb, 0xc8, 0x01, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x44];
    let mut s = Vec::new();
    s.extend_from_slice(b"AT\r\n");
    s.extend_from_slice(&fx::AIO_PB15_DEV);
    s.extend_from_slice(&ack);
    s.extend_from_slice(&fx::AIO_PB15_CELL);
    let (f, n, rest) = frames_of(&s);
    assert_eq!(f.len(), 2);
    assert!(n.is_empty());
    assert_eq!(rest, s.len(), "nothing left after the last frame");
    let mut bad = fx::AIO_32S_CELL;
    bad[299] ^= 0xff;
    let mut s2 = bad.to_vec();
    s2.extend_from_slice(&fx::AIO_32S_CELL);
    let (f, n, _) = frames_of(&s2);
    assert_eq!((f, n), (std::vec![300], std::vec![Note::Checksum]));
    let mut odd = fx::MPP_24S_16CELL;
    odd[4] = 7;
    odd[299] = odd[..299].iter().fold(0u8, |a, b| a.wrapping_add(*b));
    assert_eq!(frames_of(&odd).1, std::vec![Note::Unknown(7)]);
    let mut sp = fx::MPP_24S_16CELL[..150].to_vec();
    sp.extend_from_slice(&fx::MPP_24S_16CELL[..150]);
    sp[299] = sp[..299].iter().fold(0u8, |a, b| a.wrapping_add(*b));
    assert_eq!(frames_of(&sp).1, std::vec![Note::Spliced]);
    assert_eq!(frames_of(&fx::OWNER_32S_CELL[..120]), (std::vec![], std::vec![], 0), "a partial frame is kept whole");
    assert_eq!(frames_of(&[1, 2, 3, 4]).2, 0, "four bytes without a header are kept");
    assert_eq!(frames_of(&[1, 2, 3, 4, 5]).2, 2, "past four, only the last three");
}

#[test]
fn js_rules_for_numbers_and_text() {
    assert_eq!(js_round(2.5), 3.0);
    assert_eq!(js_round(-2.5), -2.0);
    assert!(js_round(-0.4).is_sign_negative() && js_round(-0.4) == 0.0);
    assert_eq!(js_round(0.49999999999999994), 0.0);
    assert!(js_round(f64::NAN).is_nan());
    assert_eq!(sw_major(b"V11.48"), Some(11.0));
    assert_eq!(sw_major(b"3.3.0"), Some(3.0));
    assert_eq!(sw_major(b"a1b22.3"), Some(22.0));
    assert_eq!(sw_major(b"11"), None);
    assert_eq!(sw_major(b""), None);
    let mut t = [0u8; json::TEXT_MAX];
    let n = json::lossy_trim(b"  JK\xffBMS \t", &mut t);
    assert_eq!(&t[..n], "JK\u{fffd}BMS".as_bytes());
    let n = json::lossy_trim("\u{feff}x\u{3000}".as_bytes(), &mut t);
    assert_eq!(&t[..n], b"x");
    let v = json_of(|w| {
        w.open();
        w.key_num("a", f64::NAN);
        w.key_num("b", -0.0);
        w.key_num("c", 0.1 + 0.2);
        w.key_text("d", b"q\"\\\x01");
        w.close();
    });
    assert_eq!(v["a"], "\u{0}NaN");
    assert_eq!(v["c"].as_f64(), Some(0.1 + 0.2), "shortest round trip");
    assert_eq!(v["d"], "q\"\\\u{1}");
}

#[test]
fn every_fixture_decodes_without_overflow() {
    for f in [&fx::OWNER_32S_CELL, &fx::AIO_24S_CELL, &fx::AIO_32S_CELL, &fx::AIO_PB15_CELL, &fx::AIO_PB19_CELL,
              &fx::ESPHOME_24S_CELL, &fx::ESPHOME_JK04_CELL, &fx::MPP_24S_16CELL, &fx::MPP_24S_3CELL, &fx::MPP_24S_14CELL] {
        for h in [NO_HINT, 3, 10, 11, 19] {
            assert_eq!(cell(f, h)["ok"], true);
        }
    }
}
