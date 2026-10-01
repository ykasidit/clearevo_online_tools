// BatRay by ClearEvo.com - static analysis, part 1: ESLint over every first-party file (the semantic-pattern side,
// what coccinelle is to the kernel). Zero findings is the bar; the rule set is the runtime-safety subset (tests)
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
// Owner ask 2026-10-01: "search for static code analysis like coccinelle used for C in the kernel, cover the most
// common JS runtime issues as rustc would at build time". ESLint's recommended set catches the undefined names,
// unreachable code, duplicate keys, bad regexes, misuse of await / promises; the rules added below are the ones
// that find bugs rather than style. The pattern rules at the end are house rules (no confirm() / alert(): the
// UI uses sheets). The vendored files keep their own authors' habits and are skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import js from '@eslint/js';
import globals from 'globals';

const VENDORED = ['mp4-muxer.js', 'uplot.js', 'sqlite3.js', 'qrcode.js'];
const RULES = {
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
  'no-useless-assignment': 'error',
  eqeqeq: ['error', 'smart'],
  'no-var': 'error', 'prefer-const': ['error', { destructuring: 'all' }],
  'no-duplicate-imports': 'error',
  'array-callback-return': 'error', 'no-constant-binary-expression': 'error', 'no-self-compare': 'error',
  'no-template-curly-in-string': 'error', 'no-unreachable-loop': 'error', 'no-async-promise-executor': 'error',
  'default-case-last': 'error', 'no-return-assign': 'error', 'no-sequences': 'error', 'no-throw-literal': 'error',
  'no-new-wrappers': 'error', 'no-extend-native': 'error', 'no-eval': 'error', 'no-implied-eval': 'error', 'no-script-url': 'error',
  'no-proto': 'error', 'no-iterator': 'error', 'no-caller': 'error', 'no-with': 'error', 'no-void': 'error',
  radix: 'error', 'no-undef-init': 'error', 'no-label-var': 'error', 'no-lone-blocks': 'error',
  'no-new-native-nonconstructor': 'error', 'no-unused-private-class-members': 'error', 'guard-for-in': 'error',
  'no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
  'no-restricted-globals': ['error', 'event', 'name', { name: 'confirm', message: 'no confirm(): the UI uses sheets (owner 2026-09-20)' }, { name: 'alert', message: 'no alert(): the UI uses sheets and toasts' }, { name: 'prompt', message: 'no prompt(): the UI uses sheets' }],
  'no-restricted-properties': ['error', { object: 'document', property: 'write' }],
};

test('eslint: every first-party BatRay module and every test file has zero findings', async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      js.configs.recommended,
      { files: ['public/batray/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, ...globals.worker, cast: 'readonly', chrome: 'readonly', uPlot: 'readonly', qrcode: 'readonly' } }, rules: RULES },
      { files: ['test/**/*.js', 'test/**/*.mjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } }, rules: { ...RULES, 'no-unused-expressions': 'off', 'no-duplicate-imports': 'off', 'no-useless-assignment': 'off' } },   // tests import per section and keep replay values for reading
    ],
  });
  const results = (await eslint.lintFiles(['public/batray/*.js', 'test/*.test.js', 'test/browser/*.mjs'])).filter((r) => !VENDORED.includes(r.filePath.split('/').pop()));
  const lines = [];
  for (const r of results) for (const m of r.messages) lines.push(`${r.filePath.split('/').slice(-2).join('/')}:${m.line}:${m.column} ${m.ruleId || 'parse'} ${m.message}`);
  assert.equal(lines.length, 0, `eslint findings:\n${lines.join('\n')}`);
});
