#!/bin/sh
# Browser test harness for the fun tools - drives REAL pages in headless Chrome
# via CDP (real mouse/touch/wheel input, screenshot-verified drawing):
#   smoke.mjs     - every tool page loads with no console errors / failed requests
#   clinician.mjs - 24-scenario DICOM viewer suite (measure landing under
#                   zoom/pan/rotate/flip/hi-DPI, wheel/keys/slider, cine,
#                   multi-frame US, tags, capture-with-overlay)
#   probe.mjs     - trackpad pinch (ctrl+wheel), touch-pinch during measure, slider (diagnostic)
#   repro.mjs     - measure landing incl. persisted A-/A+ body zoom (diagnostic)
#
# Local (default, serves public/ on :8077):  ./run.sh
# Against the deployed site:                 BASE=https://www.clearevo.com ./run.sh
# Against the hashed build:                  ./build.sh && SERVE_DIR=dist ./run.sh
# Needs: google-chrome/chromium, node >= 22, python3 + pydicom + numpy (test data gen).
set -e
cd "$(dirname "$0")"
[ -f data/ct1.dcm ] || python3 gen_dicom.py
CHROME=$(command -v google-chrome || command -v chromium-browser || command -v chromium)
PROFILE=$(mktemp -d)
"$CHROME" --headless=new --disable-gpu --remote-debugging-port=9333 --window-size=1200,800 \
  --user-data-dir="$PROFILE" about:blank >/dev/null 2>&1 &
CHROME_PID=$!
SRV_PID=""
if [ -z "$BASE" ]; then
  python3 -m http.server 8077 --directory "../../${SERVE_DIR:-public}" >/dev/null 2>&1 &
  SRV_PID=$!
fi
cleanup() { kill $CHROME_PID $SRV_PID 2>/dev/null; wait $CHROME_PID 2>/dev/null; rm -rf "$PROFILE"; }
trap cleanup EXIT
sleep 3
rc=0
node smoke.mjs || rc=1
node clinician.mjs || rc=1
node probe.mjs
node repro.mjs
[ $rc -eq 0 ] && echo 'browser tests ok' || echo 'BROWSER TESTS FAILED'
exit $rc
