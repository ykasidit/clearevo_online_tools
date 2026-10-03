<img src="icon-512.png" width="72" align="left" alt="ClearEvo DICOM Viewer icon">

# ClearEvo.com DICOM Viewer

Open your MRI/CT scan CD (DICOM) in the browser - index-first reading of gigabyte CDs, series browser, Simple/Advanced modes (plain-language vs PACS toolbar, see `docs/adr/0001`), window/level + CT presets, measure/angle with undo, rotate/flip, multi-frame cine, tags, PNG export with save toasts, EN/ไทย. Codecs: uncompressed, RLE, JPEG Lossless, JPEG Baseline, JPEG 2000 (OpenJPEG WASM, MIT). Demo = the author's own anonymized scans (GPL), 150 MB SCDS-series demo + full CDs.

Live: **https://www.clearevo.com/dicom/**

Part of [ClearEvo online tools](../../README.md) - runs 100% in your browser, nothing uploaded.

## How the code is organised (1.8.0, 2026-10-03)

- `index.html` is markup and styles only; the shell is `app.js` (DOM, files, decode, paint), the decisions are in `logic.js` (pure, unit-tested in `test/fun.test.js` and `test/dicom.test.js`), the strings in `i18n.js` (EN + Thai, parity-tested), and `sync.js` is a link to BatRay's wait primitives (`sleep` with a stop signal).
- **Opening a CD is one lifecycle**: `openAny` aborts the open in progress and runs `openRun` under one `AbortController`; every await in the chain (archive index, DICOMDIR or header scan, first stack, series previews, preview retries) is followed by a signal check, so a slow first CD never paints its series over the second one, and the slice cache is emptied at each open (CDs name their files alike). Cine is a loop over `sleep(frameTime, signal)`; Stop aborts it. Before 1.8 three generation counters and a `setInterval` guarded the same things from four places.
- The same house rules as BatRay, enforced by the shared tests (`test/dicom_lint.test.js`, `dicom_typecheck`, `dicom_house_rules`, `dicom_i18n` are symlinks into `test/common/`, parameters in `test/rules/dicom.mjs`): every lint rule an error, zero type findings, a bare call of an async function is written `void f()`, a paint after an await re-checks state first, no `prompt()` / `confirm()` / `alert()` (the PNG name is asked in a dialog of the page), nothing read off the CD becomes markup (series labels and the source badge are built from DOM nodes), logic modules touch no browser API.
- Browser scenarios: `test/browser/clinician.mjs` (28, incl. the Save-as dialog and "the last open wins").

## Copyright & license

Copyright (C) 2026 Kasidit Yusuf.

This is free software: you can redistribute it and/or modify it under the terms of
the **GNU General Public License, version 2** (see [`LICENSE`](../../LICENSE) at the
repository root). Distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE.
