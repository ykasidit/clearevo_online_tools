// ClearEvo.com DICOM Viewer - the tool's parameters for the shared static-analysis and house-rule tests (tests)
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
//
// Read by test/common/*.test.js through the dicom_*.test.js symlinks (owner ask 2026-10-03: "grill the dicom viewer
// src against house rules and add tests like batray"). The shell was an inline <script> in index.html until 1.8.0;
// as app.js it is held to the same -Werror lint, type check and house rules as BatRay.
import assert from 'node:assert/strict';

export default {
  name: 'DICOM Viewer', dir: 'public/dicom',
  vendored: ['dicomParser.min.js', 'lossless-min.js', 'openjpegwasm_decode.js'],
  typedSkip: [],
  globals: { dicomParser: 'readonly', OpenJPEGWASM: 'readonly' },
  // the viewer's paint functions: a call to one of these after an await needs a re-check first (ui-after-await)
  uiExtra: ['stat', 'busy', 'show', 'render', 'drawEmpty', 'renderSeriesList', 'seriesLabel', 'setSource', 'setBrowseLock', 'setCineUI', 'showGesture', 'hideGesture', 'patientBanner', 'selectSeries', 'drawBufBar'],
  i18n: 'i18n.js',
  typecheck: {
    allow2339: /on type '(HTMLElement|Element|\{\}|Error|Uint8Array<ArrayBuffer>|Int16Array<ArrayBuffer>|Uint16Array<ArrayBuffer>)'/,
    ceilings: { 'app.js': [0, ''], 'logic.js': [0, ''], 'i18n.js': [0, ''], 'sync.js': [0, ''] },
    mustCover: 'app.js',
  },
  house: {
    shells: ['app.js'],
    then: {},
    asyncCb: { 'app.js': [3, 'the three range readers (readRange over fetch / File.slice / a whole file) are async arrows handed to the pure archive readers, not callbacks'] },
    promise: { 'app.js': [1, 'the JPEG 2000 decoder <script> load: a platform onload/onerror pair'] },
    timers: { 'app.js': [2, 'toast and gesture-hint auto-hide'] },
    innerHtml: {},
    logic: (f) => f === 'logic.js' || f === 'i18n.js',
    logicMin: 2,
    sync: 'sync.js',
    custom(test, h) {
      test('the open flow is one loop under one AbortController: a new open aborts the previous, every await in the chain is followed by a signal check, no generation counters remain', () => {
        const src = h.strip(h.read('app.js'));
        assert.ok(/if \(opening\) opening\.abort\(\);/.test(src), 'openAny aborts the open in progress');
        assert.ok(/await openRun\(src, ac\.signal\)/.test(src), 'openAny runs openRun under its controller');
        const run = src.slice(src.indexOf('async function openRun('), src.indexOf('async function metasFromDicomdir('));
        assert.ok(h.count(run, /\bawait\b/g) >= 3, 'openRun awaits the index, the first show and the previews');
        assert.ok(h.count(run, /signal\.throwIfAborted\(\)/g) >= h.count(run, /\bawait\b/g) - 1, 'a signal check after each await in openRun (the Promise.all pair shares one)');
        for (const fn of ['listEntries', 'metasFromDicomdir', 'scanHeaders', 'fillDescriptions', 'decodePreviews']) assert.ok(new RegExp(`async function ${fn}\\([^)]*\\bsignal\\b`).test(src), `${fn} takes the open's signal`);
        assert.ok(!/thumbGen|seriesGen|cineTimer/.test(src), 'the three generation counters and the cine timer are gone');
        assert.ok(/cache\.clear\(\); inflight\.clear\(\)/.test(run), 'the slice cache is emptied at every open (CDs name their files alike)');
      });
      test('cine is a loop over sleep(signal), not a timer; Stop aborts it', () => {
        const src = h.strip(h.read('app.js'));
        assert.ok(/async function cineRun\(signal\)/.test(src) && /await sleep\(cur\.frameTimeMs \|\| 110, signal\)/.test(src), 'cineRun sleeps on the signal');
        assert.ok(/if \(cine\) \{ cine\.abort\(\); cine = null; \}/.test(src), 'stopCine aborts the controller');
        assert.ok(!/setInterval/.test(src));
      });
      test('every bare call of an async function from a handler is marked void (fire-and-forget) - show / selectSeries / openAny / shareTool / showTags', () => {
        const src = h.strip(h.read('app.js'));
        for (const fn of ['show', 'selectSeries', 'openAny', 'shareTool', 'showTags']) {
          const bare = src.match(new RegExp(`(^|[^.\\w])(?<!void |await |function |return )${fn}\\(`, 'gm')) || [];
          assert.equal(bare.length, 0, `${fn}() called without await or void: ${bare.length} place(s)`);
        }
      });
      test('what comes off the CD never becomes markup: series labels and the source badge are built from nodes', () => {
        const src = h.strip(h.read('app.js'));
        assert.ok(/function seriesLabel\(s, countText\)/.test(src) && /replaceChildren\(b, document\.createElement\('br'\)/.test(src));
        assert.ok(!/\.lbl'\)\.innerHTML/.test(src), 'no series label via innerHTML');
        assert.ok(/\/\^https\?:\\\/\\\/\/\.test\(url\)/.test(src), 'the remote badge links only http(s) URLs');
      });
    },
  },
};
