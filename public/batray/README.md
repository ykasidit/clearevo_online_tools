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
| Alerts, time-to-go | rule tables | `alerts-logic.js`, `trend.js` | `alerts.js`, `app.js` | `batray_alerts.test.js`, `batray_trend.test.js` |
| Stored history: day files, rollover, retention by free space, the transfer plan, chart windows | `histS` | `history-logic.js` | `history.js` + `history-worker.js` (OPFS), `history-chart.js` (uPlot), `app.js` | `batray_history.test.js`, `browser/batray_history.mjs` (files survive a reload, gzip, torn tail, backup/restore, received file, delete sheet) |
| Backup / restore (.tar of the daily gz) | bytes in, bytes out | `backup-logic.js` | `app.js` (download, file input), the worker | `batray_backup.test.js` (round trip through system tar) |
| Remembered BMS button | saved id + name, getDevices | `conn-logic.js` `knownDevice`, event `known` | `app.js` | `batray_conn.test.js`, `browser/batray_history.mjs` |
| The picture, chips, cell line, "updated", TV frame model | a decoded reading | `view-logic.js` | `app.js` paints, `tv-draw.js` draws | `batray_view.test.js` (the owner's real frame) |
| UI chrome: tabs, bottom sheets, Back, low power, sheet contents | `uiS` | `ui-logic.js` | `app.js` (history API, DOM) | `batray_ui.test.js`, `browser/batray_ui.mjs` (48 px audit, sheets, tabs) |
| BMS frames (reassembly, CRC, decoding by variant) | a byte buffer | `jkbms.js` pure half | `jkbms.js` GATT half | `batray_jkbms.test.js` (real frames from 6 units), `browser/batray_freeze.mjs` |
| Strings EN / TH | `I18N` | `i18n.js` | `app.js` | `batray_i18n.test.js` (parity of keys, types, arities) |

The look and the interaction rules are in [UI_GUIDELINES.md](UI_GUIDELINES.md).

No store library or framework: the app has no build step beyond content
hashing, and explicit `render…()` calls after each decision keep it obvious
when the screen repaints.

## Stored history (0.9.29, owner decisions 2026-09-21)

The reader appends one NDJSON row per reading (short keys, cell millivolts
included) to `batray-history/<YYYY-MM-DD>.ndjson` in the browser's private
origin file system (OPFS, written from a worker with sync access handles,
flushed every 10 s and on hide). At the day change the previous day is
gzipped in place with `CompressionStream` to `.ndjson.gz`. NDJSON because
it appends (Parquet cannot), gzip because it needs no library; a Parquet
conversion is a later, server-side step.

0.9.30 (owner asks 2026-09-21): no day limit - the oldest days are deleted
only while the browser reports less than 100 MB free (`HEADROOM_BYTES`), a
`QuotaExceededError` deletes the oldest day and retries once, and the card
shows days, used of the browser's maximum and the estimated days left.
Every append lands on a newline boundary (a torn tail from a crash is
closed first) and reads, compaction and transfers cut at the last newline.
Viewers keep their own copy as the reader's files: the viewer sends
`hist-req` with its day listing over the signalling socket, the relay
forwards it, and the reader answers with the gzipped day files it lacks
(newest first, today as a gzip of its clean prefix, 40 MB per request)
in `hist-file` base64 chunks over the encrypted link, paced by the data
channels' backlog and only while live; then every live reading. Backup is
one `.tar` (ustar, verified against system tar) of the daily gz files, up
to 512 MB; restore adds missing days and never replaces a fuller one. The
picked BMS's id and name are remembered (localStorage + `devices.ndjson`;
Chrome exposes no Bluetooth address to a page) and a green "Connect to
NAME" button connects without the chooser while `getDevices()` still lists
it. The History card draws with vendored uPlot (MIT): 1 h / 6 h / 24 h /
7 d / all, two-finger pinch, mouse drag, the inverter cut-off as a dashed
line, charged / discharged Wh for the window. DEMO readings never touch
the files. "Delete stored history" is a sheet. Without OPFS (or a failed
worker) the same store runs in memory for the session and the card says so.

## Copyright & license

Copyright (C) 2026 Kasidit Yusuf.

This is free software: you can redistribute it and/or modify it under the terms of
the **GNU General Public License, version 2** (see [`LICENSE`](../../LICENSE) at the
repository root). Distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. Not a safety device: it cannot be relied on to prevent damage or danger.
