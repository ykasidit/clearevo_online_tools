// BatRay by ClearEvo.com - static analysis, part 2: the TypeScript checker over the JavaScript (the rustc side:
// names that do not exist, wrong argument counts, comparisons that can never be true, typos it can name). Hard
// codes must be zero; what is left is DOM typing noise, ratcheted per file with a reason (tests)
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
// tsconfig.json at the repo root is the same configuration (so an editor shows the same findings); the ambient
// declarations in test/types/ tell the checker about Web Bluetooth, the cast library and the other browser APIs
// its own DOM library lacks. The ceilings below are a ratchet: a file may only get better. To lower one, add a
// JSDoc type where the checker lost track (a default `{}` parameter, an Error with extra fields, a querySelector
// result) - never a cast to silence a real finding.
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// codes a human would call a bug: a name that does not exist, a property the checker can name the right spelling
// of, a wrong argument count, an impossible comparison or operator, an assignment to a constant, a use before
// assignment, an unknown property in an object literal passed to a typed API
const HARD = new Set([2304, 2551, 2552, 2554, 2367, 2365, 2588, 2448, 2454, 2353, 2693, 2349, 2339 /* on non-DOM types: see ALLOW_2339 */]);
// TS2339 ("property does not exist") is a bug on our own objects and noise on DOM elements the checker sees as a
// bare Element/HTMLElement: those messages are allowed by pattern
const ALLOW_2339 = /on type '(HTMLElement|Element|PerformanceEntry \| \{\}|Error|\{\}|Publisher|\(p: any\) => void)'/;
const CEILING = {
  'app.js': [16, 'querySelector results typed Element, setAttribute(boolean), a Publisher field set by the app, a function used as a bag'],
  'alerts.js': [9, 'form elements read as HTMLElement'],
  'live.js': [6, 'Error with status/body, ice config literal, a Publisher hook set by the app'],
  'tv.js': [5, 'Error with code, VideoEncoderConfig literal'],
  'storage-logic.js': [15, 'default {} parameters: JSDoc types pending'],
  'sync.js': [0, ''],
};

test('tsc --checkJs: no hard finding in any first-party module, and no file is worse than its ceiling', () => {
  const cfg = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, 'tsconfig.json'), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); } });
  const program = ts.createProgram(cfg.fileNames, cfg.options);
  const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.file && d.file.fileName.includes('/public/batray/') && !/mp4-muxer|uplot|sqlite3|qrcode/.test(d.file.fileName));
  const perFile = {}; const hard = [];
  for (const d of diags) {
    const f = path.basename(d.file.fileName); const { line } = d.file.getLineAndCharacterOfPosition(d.start);
    const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
    const text = `${f}:${line + 1} TS${d.code} ${msg.slice(0, 160)}`;
    (perFile[f] = perFile[f] || []).push(text);
    if (HARD.has(d.code) && !(d.code === 2339 && ALLOW_2339.test(msg))) hard.push(text);
  }
  assert.equal(hard.length, 0, `hard findings (a name, a count, a comparison the checker can prove wrong):\n${hard.join('\n')}`);
  for (const [f, list] of Object.entries(perFile)) {
    const [ceiling, why] = CEILING[f] || [0, 'no ceiling listed'];
    assert.ok(list.length <= ceiling, `${f}: ${list.length} findings, ceiling ${ceiling} (${why}):\n${list.join('\n')}`);
  }
  assert.ok(program.getSourceFiles().some((s) => /batray\/app\.js$/.test(s.fileName)), 'the program covered the app');
});
