#!/bin/sh
set -e
cd "$(dirname "$0")"
# the static analyzers (eslint, typescript) are dev dependencies: install them once per checkout
[ -d node_modules/eslint ] && [ -d node_modules/typescript ] || npm ci --no-audit --no-fund
node --test "test/*.test.js"
