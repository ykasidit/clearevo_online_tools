# ClearEvo online tools

Free, privacy-respecting tools that run **100% in your browser** - nothing is uploaded.
Live at **https://www.clearevo.com/tools/**

Copyright (C) 2026 Kasidit Yusuf. Free software under the **GNU GPL v2** (see [`LICENSE`](LICENSE)).

## Structure - one app per subdirectory

Each tool is a self-contained app under `public/<app>/`, with its own `index.html`
(inline UI), a pure, tested `logic.js`, a `manifest.json` + icons (PWA-pinnable), and
a per-app `README.md` carrying the copyright/licence notice:

| App | Path | What it is |
|-----|------|-----------|
| 🩻 ClearEvo.com DICOM Viewer | [`public/dicom`](public/dicom) | Open/stream a DICOM CT/MRI scan CD in the browser |
| 🔢 ClearEvo.com Hex Editor | [`public/hex`](public/hex) | Hex view/edit + hex/text/number/bit search |
| 🌍 ClearEvo.com GIS Converter | [`public/geo`](public/geo) | GDAL `ogr2ogr` (WebAssembly) format converter |
| 🔳 ClearEvo.com QR Code Generator | [`public/qr`](public/qr) | Static QR that never expires, 12 languages |
| 🎵 ClearEvo.com Audio Converter | [`public/audio`](public/audio) | ffmpeg.wasm audio extract/convert |
| 🩺 ClearEvo.com Doctor | [`public/doctor`](public/doctor) | Emacs `M-x doctor` (ELIZA) |
| 🧮 ClearEvo.com Calc | [`public/calc`](public/calc) | Emacs `M-x calc` RPN calculator |
| 🔍 ClearEvo.com iSearch | [`public/isearch`](public/isearch) | Emacs incremental search |

Sibling repos (their own build pipelines, deployed alongside these under the same
site) hold the remaining ClearEvo online tools: [`web_gnss`](https://github.com/ykasidit/web_gnss)
→ /gnss/, [`hyperterminal`](https://github.com/ykasidit/hyperterminal) → /hyperterminal/,
[`web_at`](https://github.com/ykasidit/web_at) → /at/.

## Build / test / deploy

- `./build.sh` - content-hash build of every `public/<app>/` into `dist/<app>/`.
- `./test.sh` - `node --test` over `test/` (pure-logic + streaming integration tests).
- The whole site (these apps + the sibling tools + the Jekyll blog) is assembled and
  deployed to Cloudflare by `../ykasidit.github.io/deploy.sh`.

## Design standard (every app)

Windows XP theme (xp.css window + title bar), A-/A+ font-size buttons top-right,
PWA manifest + icons, an emoji favicon, and a status bar with the privacy note +
"verify" link. See the app READMEs for details.

## Copyright & license

Copyright (C) 2026 Kasidit Yusuf.

This program is free software: you can redistribute it and/or modify it under the
terms of the **GNU General Public License, version 2**, as published by the Free
Software Foundation - see [`LICENSE`](LICENSE). It is distributed in the hope that it
will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.

The MRI/CT CD Viewer's demo scans are the author's own CT/MRI, anonymized, and likewise
released under GPL v2 (see [`public/dicom/README.md`](public/dicom)).
