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
//
// Owner ask, same day: "-Werror: any warning not sanely exempt fails the build, like dart analyze in my build.sh;
// cover what the Dart analyzer catches - an async function not awaited (unawaited_futures), UI work when the view is
// not mounted (use_build_context_synchronously), and the rest". So:
// - EVERY rule is an error and ANY message fails this test (there is no warn level); build.sh runs test.sh first.
// - The type-aware block (typescript-eslint over the tsconfig the typecheck test uses) is what needs types:
//   no-floating-promises = unawaited_futures: a call returning a promise must be awaited, or marked `void f()` (the
//   explicit fire-and-forget, Dart's unawaited()); no-misused-promises (a promise as a boolean / an async callback
//   where a sync one is expected); await-thenable; unbound-method; only-throw-error; return-await in try/catch.
// - batray/ui-after-await (test/lint/ui_after_await.mjs) = use_build_context_synchronously: a paint after an await
//   needs a re-check first (`if (publisher !== pub) return`) or a reasoned disable directive on the line.
// - Exemptions are inline `// eslint-disable-next-line <rule> -- <why>`; a directive without a reason, or one that
//   no longer disables anything, fails the test. Rules switched OFF with a reason are listed in OFF below.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ESLint } from 'eslint';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { uiAfterAwait } from './lint/ui_after_await.mjs';

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
  'no-proto': 'error', 'no-iterator': 'error', 'no-caller': 'error', 'no-with': 'error',
  radix: 'error', 'no-undef-init': 'error', 'no-label-var': 'error', 'no-lone-blocks': 'error',
  'no-new-native-nonconstructor': 'error', 'no-unused-private-class-members': 'error', 'guard-for-in': 'error',
  'no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
  'no-restricted-globals': ['error', 'event', 'name', { name: 'confirm', message: 'no confirm(): the UI uses sheets (owner 2026-09-20)' }, { name: 'alert', message: 'no alert(): the UI uses sheets and toasts' }, { name: 'prompt', message: 'no prompt(): the UI uses sheets' }],
  'no-restricted-properties': ['error', { object: 'document', property: 'write' }],
  // Dart-analyzer class (owner 2026-10-01): dead code / missing returns / shadowing / TDZ use / executor misuse
  'consistent-return': 'error', 'no-promise-executor-return': 'error', 'no-constructor-return': 'error',
  'no-shadow': 'error', 'no-use-before-define': ['error', { functions: false, classes: true, variables: false }],
  'no-implicit-globals': 'error', 'no-invalid-this': 'error', 'default-case': 'error',
  'no-unneeded-ternary': 'error', 'no-useless-return': 'error', 'no-useless-call': 'error', 'no-useless-concat': 'error',
  'no-unmodified-loop-condition': 'off', 'no-loop-func': 'off', 'require-atomic-updates': 'off', 'no-empty-function': 'off', 'require-await': 'off',
};
// Rules that stay OFF, with the reason (the "sanely exempt" list):
const OFF = {
  'no-void': '`void f()` is the explicit fire-and-forget marker (Dart unawaited()); no-floating-promises rejects a bare call',
  'no-unmodified-loop-condition': 'the transfer loops await inside; `publisher === pub` changes from another flow between awaits (the ownership re-check)',
  'no-loop-func': 'T (the language table) is a module-level let that closures must read live',
  'require-atomic-updates': 'documented false positives (every `s.x = f(await ...)`); the house-rules test checks the one-writer rule instead',
  'no-empty-function': '`(_x) => {}` is the default for a boundary callback',
  'require-await': 'an async function without an await is the explicit way to make a method promise-returning by contract (MemoryBackend mirrors the worker backend); Dart does not flag it either',
};
// The type-aware rules (need the tsconfig program): what the Dart analyzer catches about futures.
const TYPED_RULES = {
  '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true, ignoreIIFE: false }],
  '@typescript-eslint/no-misused-promises': ['error', { checksConditionals: true, checksVoidReturn: true, checksSpreads: true }],
  '@typescript-eslint/await-thenable': 'error', '@typescript-eslint/unbound-method': 'error',
  '@typescript-eslint/only-throw-error': 'error', '@typescript-eslint/prefer-promise-reject-errors': ['error', { allowThrowingAny: true, allowThrowingUnknown: true }],
  '@typescript-eslint/return-await': ['error', 'in-try-catch'], '@typescript-eslint/no-for-in-array': 'error', '@typescript-eslint/no-array-delete': 'error',
  '@typescript-eslint/no-unnecessary-type-assertion': 'error', '@typescript-eslint/no-base-to-string': 'error',
  '@typescript-eslint/no-meaningless-void-operator': 'error', '@typescript-eslint/require-array-sort-compare': 'error',
  '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
  'batray/ui-after-await': 'error',
};
const TYPED_SKIP = [...VENDORED, 'sw.js'];                            // sw.js is outside the tsconfig (a classic worker script)

test('eslint: every first-party BatRay module and every test file has zero findings (every rule an error: -Werror)', async () => {
  for (const k of Object.keys(OFF)) assert.ok(RULES[k] === 'off' || !(k in RULES), `${k} is listed OFF but set in RULES`);
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      js.configs.recommended,
      { linterOptions: { reportUnusedDisableDirectives: 'error' } },
      { files: ['public/batray/*.js'], ignores: TYPED_SKIP.map((f) => `public/batray/${f}`),
        languageOptions: { parser: tseslint.parser, parserOptions: { project: './tsconfig.json', tsconfigRootDir: process.cwd() } },
        plugins: { '@typescript-eslint': tseslint.plugin, batray: { rules: { 'ui-after-await': uiAfterAwait } } }, rules: TYPED_RULES },
      { files: ['public/batray/*.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, ...globals.worker, cast: 'readonly', chrome: 'readonly', uPlot: 'readonly', qrcode: 'readonly' } }, rules: RULES },
      { files: ['test/*.test.js', 'test/browser/*.mjs'], languageOptions: { parser: tseslint.parser, parserOptions: { project: './tsconfig.tests.json', tsconfigRootDir: process.cwd() } },
        plugins: { '@typescript-eslint': tseslint.plugin, batray: { rules: { 'ui-after-await': uiAfterAwait } } }, rules: { ...TYPED_RULES, 'batray/ui-after-await': 'off' } },
      { files: ['test/**/*.js', 'test/**/*.mjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } }, rules: { ...RULES, 'no-unused-expressions': 'off', 'no-duplicate-imports': 'off', 'no-useless-assignment': 'off' } },   // tests import per section and keep replay values for reading
    ],
  });
  const results = (await eslint.lintFiles(['public/batray/*.js', 'test/*.test.js', 'test/browser/*.mjs'])).filter((r) => !VENDORED.includes(r.filePath.split('/').pop()));
  const lines = [];
  for (const r of results) for (const m of r.messages) lines.push(`${r.filePath.split('/').slice(-2).join('/')}:${m.line}:${m.column} ${m.ruleId || 'parse'} ${m.message}`);
  for (const r of results) for (const m of r.messages) if (m.severity !== 2) lines.push(`${r.filePath}:${m.line} ${m.ruleId} is a warning - every rule is an error here`);
  assert.equal(lines.length, 0, `eslint findings:\n${lines.join('\n')}`);
});

// The rules must bite: lint the two fixtures (not shipped, excluded from the zero-findings run) and expect exactly the
// marked lines. A rule that silently stopped working would otherwise pass the suite for ever.
async function fixtureFindings(name, rules) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{ files: ['test/lint/fixtures/*.js'], languageOptions: { parser: tseslint.parser, parserOptions: { project: './tsconfig.tests.json', tsconfigRootDir: process.cwd() }, ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } },
      plugins: { '@typescript-eslint': tseslint.plugin, batray: { rules: { 'ui-after-await': uiAfterAwait } } }, rules }],
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

test('batray/ui-after-await bites: a paint after an await is reported unless a guard, the wait itself, a toast, or a reasoned directive', async () => {
  const { flagged, found } = await fixtureFindings('ui_after_await.js', { 'batray/ui-after-await': 'error' });
  assert.deepEqual(found.map((f) => f[0]), flagged, JSON.stringify(found));
  assert.ok(found.every((f) => f[1] === 'batray/ui-after-await'));
});

test('eslint: every disable directive in the app carries a reason (-- why), and only for a rule this test runs', async () => {
  const bad = [];
  const known = new Set([...Object.keys(RULES), ...Object.keys(TYPED_RULES), ...Object.keys(js.configs.recommended.rules)]);
  for (const f of fs.readdirSync('public/batray').filter((n) => n.endsWith('.js') && !VENDORED.includes(n))) {
    const src = fs.readFileSync(`public/batray/${f}`, 'utf8').split('\n');
    src.forEach((l, i) => {
      const m = l.match(/eslint-disable(?:-next-line|-line)?\s+([^\s]+)(.*)$/); if (!m) return;
      if (!/\s--\s\S/.test(m[2])) bad.push(`${f}:${i + 1} directive without a reason (write: // eslint-disable-next-line <rule> -- <why>)`);
      if (!known.has(m[1])) bad.push(`${f}:${i + 1} directive for a rule this test does not run (${m[1]})`);
    });
  }
  assert.deepEqual(bad, []);
});
