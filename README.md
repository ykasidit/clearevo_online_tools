# ClearEvo online tools

Free, privacy-respecting tools that run **100% in your browser**. No upload is the
default: your files and readings stay on your device. The few features that need a
server say so clearly where you turn them on, and each app's status bar carries a
privacy note with a "verify" link so you can check for yourself.
Live at **https://www.clearevo.com/tools/**

Copyright (C) 2026 Kasidit Yusuf. Free software under the **GNU GPL v2** (see [`LICENSE`](LICENSE)).
Every first-party source file carries the GPL notice, so the licence ships with the
code to every browser. Vendored third-party files keep their own licences and headers.

## Where things are

One app per directory under `public/`, each with its own `README.md`: what it does,
how it is built and tested, its privacy notes, and the coding rules it follows. The
author adds those rules gradually, one per lesson learned, each with a test that fails
the build; the newest app follows all of them, older apps only partly or not yet.

## Build / test / deploy

- `./build.sh` - content-hash build of every `public/<app>/` into `dist/<app>/` (runs `./test.sh` first).
- `./test.sh` - `node --test` over `test/`.
- `./test/browser/run.sh` - headless-Chrome suites driving the real pages.
- The whole site is assembled and deployed to Cloudflare by `../ykasidit.github.io/deploy.sh`.

## Copyright & license

Copyright (C) 2026 Kasidit Yusuf.

This program is free software: you can redistribute it and/or modify it under the
terms of the **GNU General Public License, version 2**, as published by the Free
Software Foundation - see [`LICENSE`](LICENSE). It is distributed in the hope that it
will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
