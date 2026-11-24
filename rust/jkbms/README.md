# jkbms - JK BMS (JiKong) BLE protocol in Rust

Framing and decoding of the JK BMS Bluetooth protocol: device info, settings and cell info in the
three payload layouts (JK04, JK02_24S, JK02_32S). `no_std`, no allocation. It is the parser of BatRay
(this repo's `public/batray/`, loaded as WebAssembly through `jkbms-wasm.js`) and of BatRay's server
side. It began as a port of BatRay's JavaScript decoder (`public/batray/jkbms.js`, kept frozen as
`test/batray_jk_oracle.js`), and `test/batray_jk_parity.test.js` holds the two equal value for value.

    cargo test              # tests on real frames
    ./build_wasm.sh         # rebuild the WebAssembly BatRay loads (after any change here)

Copyright (C) 2026 Kasidit Yusuf. GNU General Public License, version 2 or (at your option) any
later version: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html

## Credits

The decoder was written for BatRay and checked against real frames; the
protocol knowledge and the test frames come from these open projects, with thanks:

- **syssi/esphome-jk-bms** (Apache-2.0) - https://github.com/syssi/esphome-jk-bms - the reference
  write-up of the JK02 / JK04 layouts and the error / alarm bit names (`ERROR_BITS`); test frames from
  its source comments (JK02_24S cell info and settings, JK04 cell and device info, JK-PB 14.x device
  info).
- **patman15/aiobmsble** (Apache-2.0) - https://github.com/patman15/aiobmsble - test frames from its
  tests (JK02_24S sw 10.08, JK02_32S sw 11.48, JK-PB sw 15.38, 19.27 and 19.05).
- **jblance/mpp-solar** (MIT) - https://github.com/jblance/mpp-solar - test frames from its tests
  (JK02 with 16, 3 and 14 cells, absent temperature sensors).
- One capture from the author's own JK unit (32S firmware, 14 cells).

Every source above is under a permissive licence (Apache-2.0 or MIT), so the crate carries no
copyleft from them. (A JK-PB V19 settings frame from fancyui/Gobel-Battery-HA-Integration, which is
GPL-3.0, was left out on purpose; BatRay's own JavaScript tests still use it, see test/batray_frames.js.)

The frames are test data only (`src/tests_frames.rs`, generated from `test/batray_frames.js`, which
names the source of each one); they are not part of the library or of the WebAssembly BatRay ships.
