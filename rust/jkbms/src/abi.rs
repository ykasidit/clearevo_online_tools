// BatRay by ClearEvo.com - JK BMS protocol (jkbms crate): WebAssembly entry points
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

//! What BatRay's jkbms-wasm.js calls: the page copies bytes into IN, calls one function, reads the
//! JSON it wrote into OUT. One wasm instance per page and JavaScript is single-threaded, so the two
//! static buffers are never used by two calls at once (that is what makes the `unsafe` below sound).
use crate::json::W;

const IN_LEN: usize = 64 * 1024;
const OUT_LEN: usize = 128 * 1024;
static mut IN: [u8; IN_LEN] = [0; IN_LEN];
static mut OUT: [u8; OUT_LEN] = [0; OUT_LEN];

#[no_mangle]
pub extern "C" fn jk_in() -> *mut u8 {
    core::ptr::addr_of_mut!(IN) as *mut u8
}

#[no_mangle]
pub extern "C" fn jk_in_len() -> usize {
    IN_LEN
}

#[no_mangle]
pub extern "C" fn jk_out() -> *const u8 {
    core::ptr::addr_of!(OUT) as *const u8
}

/// Runs `f` over IN[..len] writing into OUT; the JSON length, -1 when it did not fit, -2 for bad input.
fn run(len: usize, min: usize, f: impl FnOnce(&[u8], &mut W)) -> i32 {
    if len > IN_LEN || len < min {
        return -2;
    }
    // SAFETY: single-threaded wasm, one call at a time (see the module comment); IN and OUT do not overlap.
    let (inp, out): (&[u8], &mut [u8; OUT_LEN]) = unsafe { (&(&*core::ptr::addr_of!(IN))[..len], &mut *core::ptr::addr_of_mut!(OUT)) };
    let mut w = W::new(out);
    f(inp, &mut w);
    if w.overflow {
        -1
    } else {
        w.len() as i32
    }
}

#[no_mangle]
pub extern "C" fn jk_feed(len: usize) -> i32 {
    run(len, 0, crate::feed_json)
}

#[no_mangle]
pub extern "C" fn jk_device(len: usize) -> i32 {
    run(len, crate::FRAME_LEN, crate::device_info_json)
}

#[no_mangle]
pub extern "C" fn jk_settings(len: usize) -> i32 {
    run(len, crate::FRAME_LEN, crate::settings_json)
}

#[no_mangle]
pub extern "C" fn jk_cell(len: usize, hint: i32) -> i32 {
    run(len, crate::FRAME_LEN, |f, w| crate::cell_info_json(f, hint, w))
}

#[cfg(not(test))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
