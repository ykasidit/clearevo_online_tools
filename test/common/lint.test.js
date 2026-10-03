// ClearEvo online tools - static analysis, part 1: ESLint over every first-party file of ONE tool (the semantic-
// pattern side, what coccinelle is to the kernel). Zero findings is the bar, every rule an error (tests)
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
// Shared body: test/<tool>_lint.test.js is a symlink here; the tool and its rules come from test/common/tool.mjs.
// The test files themselves and the rule fixtures are linted once, in test/lint_common.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ESLint } from 'eslint';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { uiAfterAwait } from '../lint/ui_after_await.mjs';
import { RULES, OFF, TYPED_RULES } from './eslint_rules.mjs';
import { TOOL, RULES as R, DIR } from './tool.mjs';

const typedSkip = [...R.vendored, ...(R.typedSkip || [])];

test(`eslint: every first-party ${R.name} module has zero findings (every rule an error: -Werror)`, async () => {
  for (const k of Object.keys(OFF)) assert.ok(RULES[k] === 'off' || !(k in RULES), `${k} is listed OFF but set in RULES`);
  const typed = { ...TYPED_RULES, 'house/ui-after-await': ['error', { extra: R.uiExtra || [] }] };
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      js.configs.recommended,
      { linterOptions: { reportUnusedDisableDirectives: 'error' } },
      { files: [`${DIR}/*.js`], ignores: typedSkip.map((f) => `${DIR}/${f}`),
        languageOptions: { parser: tseslint.parser, parserOptions: { project: './tsconfig.json', tsconfigRootDir: process.cwd() } },
        plugins: { '@typescript-eslint': tseslint.plugin, house: { rules: { 'ui-after-await': uiAfterAwait } } }, rules: typed },
      { files: [`${DIR}/*.js`], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, ...globals.worker, ...(R.globals || {}) } }, rules: RULES },
    ],
  });
  const results = (await eslint.lintFiles([`${DIR}/*.js`])).filter((r) => !R.vendored.includes(r.filePath.split('/').pop()));
  assert.ok(results.length >= 2, `${results.length} files linted`);
  const lines = [];
  for (const r of results) for (const m of r.messages) lines.push(`${r.filePath.split('/').slice(-2).join('/')}:${m.line}:${m.column} ${m.ruleId || 'parse'} ${m.message}`);
  for (const r of results) for (const m of r.messages) if (m.severity !== 2) lines.push(`${r.filePath}:${m.line} ${m.ruleId} is a warning - every rule is an error here`);
  assert.equal(lines.length, 0, `eslint findings:\n${lines.join('\n')}`);
});

test(`eslint: every disable directive in ${R.name} carries a reason (-- why), and only for a rule this test runs`, () => {
  const bad = [];
  const known = new Set([...Object.keys(RULES), ...Object.keys(TYPED_RULES), ...Object.keys(js.configs.recommended.rules)]);
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.js') && !R.vendored.includes(n))) {
    const src = fs.readFileSync(`${DIR}/${f}`, 'utf8').split('\n');
    src.forEach((l, i) => {
      const m = l.match(/eslint-disable(?:-next-line|-line)?\s+([^\s]+)(.*)$/); if (!m) return;
      if (!/\s--\s\S/.test(m[2])) bad.push(`${f}:${i + 1} directive without a reason (write: // eslint-disable-next-line <rule> -- <why>)`);
      if (!known.has(m[1])) bad.push(`${f}:${i + 1} directive for a rule this test does not run (${m[1]})`);
    });
  }
  assert.deepEqual(bad, [], `${TOOL}: ${bad.join('; ')}`);
});
