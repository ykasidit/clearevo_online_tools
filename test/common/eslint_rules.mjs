// ClearEvo online tools - the ESLint rule set every opted-in tool is held to (tests)
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
// common JS runtime issues as rustc would at build time" and, the same day, "-Werror: any warning not sanely exempt
// fails the build, like dart analyze in my build.sh; cover what the Dart analyzer catches - an async function not
// awaited (unawaited_futures), UI work when the view is not mounted (use_build_context_synchronously)". So:
// - EVERY rule is an error and ANY message fails the lint test (there is no warn level); build.sh runs test.sh first.
// - TYPED_RULES need the tsconfig program: no-floating-promises = unawaited_futures (a call returning a promise must be
//   awaited or marked `void f()`, the explicit fire-and-forget, Dart's unawaited()); no-misused-promises; await-
//   thenable; unbound-method; only-throw-error; return-await in try/catch.
// - house/ui-after-await (test/lint/ui_after_await.mjs) = use_build_context_synchronously: a paint after an await
//   needs a re-check first or a reasoned disable directive on the line.
// - Exemptions are inline `// eslint-disable-next-line <rule> -- <why>`; a directive without a reason, or one that no
//   longer disables anything, fails. Rules switched OFF with a reason are listed in OFF.
export const RULES = {
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
export const OFF = {
  'no-void': '`void f()` is the explicit fire-and-forget marker (Dart unawaited()); no-floating-promises rejects a bare call',
  'no-unmodified-loop-condition': 'the transfer loops await inside; `publisher === pub` changes from another flow between awaits (the ownership re-check)',
  'no-loop-func': 'T (the language table) is a module-level let that closures must read live',
  'require-atomic-updates': 'documented false positives (every `s.x = f(await ...)`); the house-rules test checks the one-writer rule instead',
  'no-empty-function': '`(_x) => {}` is the default for a boundary callback',
  'require-await': 'an async function without an await is the explicit way to make a method promise-returning by contract (MemoryBackend mirrors the worker backend); Dart does not flag it either',
};
// The type-aware rules (need the tsconfig program): what the Dart analyzer catches about futures.
export const TYPED_RULES = {
  '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true, ignoreIIFE: false }],
  '@typescript-eslint/no-misused-promises': ['error', { checksConditionals: true, checksVoidReturn: true, checksSpreads: true }],
  '@typescript-eslint/await-thenable': 'error', '@typescript-eslint/unbound-method': 'error',
  '@typescript-eslint/only-throw-error': 'error', '@typescript-eslint/prefer-promise-reject-errors': ['error', { allowThrowingAny: true, allowThrowingUnknown: true }],
  '@typescript-eslint/return-await': ['error', 'in-try-catch'], '@typescript-eslint/no-for-in-array': 'error', '@typescript-eslint/no-array-delete': 'error',
  '@typescript-eslint/no-unnecessary-type-assertion': 'error', '@typescript-eslint/no-base-to-string': 'error',
  '@typescript-eslint/no-meaningless-void-operator': 'error', '@typescript-eslint/require-array-sort-compare': 'error',
  '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
  'house/ui-after-await': 'error',
};
