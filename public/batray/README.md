<img src="icon-512.png" width="72" align="left" alt="BatRay icon">

# BatRay by ClearEvo.com

JK (JiKong) BMS monitor over Web Bluetooth: pack voltage, state of charge, current, power, per-cell voltages, temperatures, capacity, cycles and the configured protection limits, live in Chrome. Frame layout chosen from the firmware version and cross-checked against the cell sum. Share live to any other browser (readings encrypted on the phone, key only in the link), several BMS in parallel, Chrome-notification alerts, EN/ไทย. The relay behind `/batray/api/` is a separate, private Cloudflare Worker; this app talks to it over a small JSON/WebSocket contract (see `live.js`).

Live: **https://www.clearevo.com/batray/**

Part of [ClearEvo online tools](../../README.md). Battery data stays on the device unless Share live is turned on.

## Code layout: functional core, imperative shell

Every flow with state follows one rule, decided 2026-09-20 after flaky state
had bitten reconnect, viewer presence and Cast in turn. The author's habit
from Linux kernel driver work, Go and Rust (a context struct is passed to every
function, the function stays pure) and from a QGIS plugin (one global map
passed to every function) is the house style here:

- **One plain state object per flow**, made by a factory: `connState()` per
  BMS pack, `shareState()`, `viewState()`, `reachState()`, `tvUiState()`,
  `castState()`, `wakeState()`. No hidden state anywhere else.
- **Pure decision functions take that object as a parameter** and return a
  decision (`{ action: 'countdown', seconds: 5 }`) or update its counters.
  They never touch the DOM, timers, sockets, GATT or a library. In JS terms
  this is a reducer / "functional core, imperative shell"; the same shape as
  a kernel `struct foo *ctx` handed to `foo_do_thing(ctx, ...)`.
- **`app.js` is the shell**: it owns the timers, the chooser, the sockets,
  the encoder, the DOM; it asks the decision function, acts on the answer,
  and logs it (`conn: attempt-failed -> retry attempt 2 [connecting]`,
  `cast: tap -> request`). Buttons render from the state object too: the
  Share and Show on TV toolbar buttons are sunk while running, pressing them
  (or Close on the card) stops the thing with a toast.
- **File names**: `<flow>-logic.js` is the functional core (no imports of
  browser APIs), `<flow>.js` is the I/O for that flow (`live.js` sockets,
  `tv.js` encoder, `jkbms.js` GATT, `alerts.js` notifications),
  `test/batray_<flow>.test.js` replays the exact sequence from a real log
  (the two phones' cast state events, the old Sony's wake-lock drops,
  Android's three GATT refusals) so the flaky sequence is reproduced in node
  before the fix ships and stays reproduced. `test/browser/*.mjs` drive the
  real page in headless Chrome as integration checks on top.

| flow | state object | functional core | I/O shell | replay test |
|---|---|---|---|---|
| BLE connect / retry / countdown | `p.cs` = `connState()` | `conn-logic.js` | `jkbms.js`, `app.js` | `batray_conn.test.js`, `browser/batray_freeze.mjs` |
| Share live (reader) | `shareS` | `share-logic.js`, `live-logic.js` | `live.js`, `app.js` | `batray_share.test.js`, `batray_presence.test.js`, `browser/batray_log.mjs` |
| Viewer + reachability | `viewS`, `reachS` | `share-logic.js`, `live-logic.js` | `live.js`, `app.js` | `batray_share.test.js`, `batray_presence.test.js` |
| Show on TV card and button | `tvS` | `tv-logic.js` | `tv.js`, `app.js` | `batray_tv.test.js`, `browser/batray_tv.mjs` |
| Cast to TV picker | `castS` | `cast-logic.js` | `app.js` (Google's sender) | `batray_cast.test.js`, `browser/batray_tv.mjs` |
| Screen wake lock + keep-awake video | `wakeS` | `wake-logic.js` | `app.js` | `batray_wake.test.js`, `browser/batray_freeze.mjs` |
| Alerts, time-to-go, trend | rule tables | `alerts-logic.js`, `trend.js` | `alerts.js`, `app.js` | `batray_alerts.test.js`, `batray_trend.test.js` |

No store library or framework: the app has no build step beyond content
hashing, and explicit `render…()` calls after each decision keep it obvious
when the screen repaints.

## Copyright & license

Copyright (C) 2026 Kasidit Yusuf.

This is free software: you can redistribute it and/or modify it under the terms of
the **GNU General Public License, version 2** (see [`LICENSE`](../../LICENSE) at the
repository root). Distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. Not a safety device: it cannot be relied on to prevent damage or danger.
