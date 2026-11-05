#!/bin/sh
# BatRay: a year of the reader in the real page (test/browser/batray_year.mjs) - run between review rounds and
# before every deploy. Own ports (Chrome 9361, page 8111) so other browser tests can run beside it.
#   test/longrun/year.sh                 a year (DAYS=365), about half an hour
#   DAYS=30 test/longrun/year.sh         a month
#   SERVE_DIR=dist test/longrun/year.sh  the hashed build (or an absolute path to another checkout's public/)
set -e
cd "$(dirname "$0")/../browser"
CHROME=$(command -v google-chrome || command -v chromium-browser || command -v chromium)
PROFILE=$(mktemp -d)
"$CHROME" --headless=new --no-sandbox --disable-gpu --remote-debugging-port=9361 --window-size=500,900 --autoplay-policy=no-user-gesture-required --enable-blink-features=ForceEagerMeasureMemory \
  --user-data-dir="$PROFILE" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
case "${SERVE_DIR:-public}" in /*) DIR="$SERVE_DIR" ;; *) DIR="../../${SERVE_DIR:-public}" ;; esac   # an absolute path: another checkout (an A/B run)
python3 serve.py 8111 "$DIR" >/dev/null 2>&1 &
SRV_PID=$!
trap 'kill $CHROME_PID $SRV_PID 2>/dev/null || true' EXIT
for i in $(seq 1 40); do curl -s localhost:9361/json/version >/dev/null && break; sleep 0.5; done
node batray_year.mjs
