// ClearEvo online tools - static analysis, the shared part: the rules must bite (fixtures), and the test files
// themselves pass the same lint (tests)
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
import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { uiAfterAwait } from './lint/ui_after_await.mjs';
import { RULES, TYPED_RULES } from './common/eslint_rules.mjs';

const plugins = { '@typescript-eslint': tseslint.plugin, house: { rules: { 'ui-after-await': uiAfterAwait } } };

test('eslint: every test file has zero findings', async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      js.configs.recommended,
      { linterOptions: { reportUnusedDisableDirectives: 'error' } },
      { files: ['test/*.test.js', 'test/browser/*.mjs', 'test/common/*.js', 'test/common/*.mjs', 'test/rules/*.mjs'], languageOptions: { parser: tseslint.parser, parserOptions: { project: './tsconfig.tests.json', tsconfigRootDir: process.cwd() } },
        plugins, rules: { ...TYPED_RULES, 'house/ui-after-await': 'off' } },
      { files: ['test/**/*.js', 'test/**/*.mjs'], ignores: ['test/lint/fixtures/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } }, rules: { ...RULES, 'no-unused-expressions': 'off', 'no-duplicate-imports': 'off', 'no-useless-assignment': 'off' } },   // tests import per section and keep replay values for reading
    ],
  });
  const results = await eslint.lintFiles(['test/*.test.js', 'test/browser/*.mjs', 'test/common/*.js', 'test/common/*.mjs', 'test/rules/*.mjs']);
  const lines = [];
  for (const r of results) for (const m of r.messages) lines.push(`${r.filePath.split('/').slice(-2).join('/')}:${m.line}:${m.column} ${m.ruleId || 'parse'} ${m.message}`);
  assert.equal(lines.length, 0, `eslint findings:\n${lines.join('\n')}`);
});

// The rules must bite: lint the fixtures (not shipped, excluded from the zero-findings runs) and expect exactly the
// marked lines. A rule that silently stopped working would otherwise pass the suite for ever.
async function fixtureFindings(name, rules) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{ files: ['test/lint/fixtures/*.js'], languageOptions: { parser: tseslint.parser, parserOptions: { project: './tsconfig.tests.json', tsconfigRootDir: process.cwd() }, ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } }, plugins, rules }],
  });
  const [r] = await eslint.lintFiles([`test/lint/fixtures/${name}`]);
  const src = r.source.split('\n');
  const flagged = src.map((l, i) => (/\/\/ FLAG/.test(l) ? i + 1 : 0)).filter(Boolean);
  const found = r.messages.map((m) => [m.line, (m.ruleId || 'parse').replace('@typescript-eslint/', '')]);
  return { flagged, found };
}

test('the unawaited-call rules bite: the fixture\'s FLAG lines, and only those, are reported', async () => {
  const { flagged, found } = await fixtureFindings('floating.js', TYPED_RULES);
  assert.deepEqual(found.map((f) => f[0]), flagged, JSON.stringify(found));
  assert.deepEqual(found.map((f) => f[1]), ['no-floating-promises', 'no-misused-promises', 'await-thenable', 'unbound-method', 'return-await']);
});

test('house/ui-after-await bites: a paint after an await is reported unless a guard, the wait itself, a toast, or a reasoned directive', async () => {
  const { flagged, found } = await fixtureFindings('ui_after_await.js', { 'house/ui-after-await': 'error' });
  assert.deepEqual(found.map((f) => f[0]), flagged, JSON.stringify(found));
  assert.ok(found.every((f) => f[1] === 'house/ui-after-await'));
});

test('house/ui-after-await takes a tool\'s own paint names (extra) and reports them too', async () => {
  const { found } = await fixtureFindings('ui_after_await.js', { 'house/ui-after-await': ['error', { extra: ['toast'] }] });
  assert.ok(found.length > 0);
  const { found: base } = await fixtureFindings('ui_after_await.js', { 'house/ui-after-await': 'error' });
  assert.ok(found.length > base.length, 'with toast listed as a paint, the fixture\'s toast-after-await lines are reported as well');
});
