<img src="icon-512.png" width="72" align="left" alt="BatRay icon">

# BatRay by ClearEvo.com

JK (JiKong) BMS monitor over Web Bluetooth: pack voltage, state of charge, current, power, per-cell voltages, temperatures, capacity, cycles and the configured protection limits, live in Chrome. Frame layout chosen from the firmware version and cross-checked against the cell sum. Share live to any other browser (readings encrypted on the phone, key only in the link), several BMS in parallel, Chrome-notification alerts, EN/ไทย. The relay behind `/batray/api/` is a separate, private Cloudflare Worker; this app talks to it over a small JSON/WebSocket contract (see `live.js`).

Live: **https://www.clearevo.com/batray/**

Part of [ClearEvo online tools](../../README.md). Battery data stays on the device unless Share live is turned on.

## Copyright & license

Copyright (C) 2026 Kasidit Yusuf.

This is free software: you can redistribute it and/or modify it under the terms of
the **GNU General Public License, version 2** (see [`LICENSE`](../../LICENSE) at the
repository root). Distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. Not a safety device: it cannot be relied on to prevent damage or danger.
