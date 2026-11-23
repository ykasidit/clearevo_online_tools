#!/bin/sh
# The review rounds' proofs (2026-11-23, reader tab loss): every file here failed on the version it was written
# against and must pass now. Own Chrome + page server on spare ports (CDP=9440 PORT=8440 by default).
# Run: test/review/run.sh
cd "$(dirname "$0")/../.."
CDP=${CDP:-9440}; PORT=${PORT:-8440}
CHROME=$(command -v google-chrome || command -v chromium-browser || command -v chromium)
PROFILE=$(mktemp -d)
"$CHROME" --headless=new --no-sandbox --disable-gpu --remote-debugging-port=$CDP --window-size=1200,800 --autoplay-policy=no-user-gesture-required --user-data-dir="$PROFILE" about:blank >/dev/null 2>&1 &
CP=$!
python3 test/browser/serve.py $PORT public >/dev/null 2>&1 &
SP=$!
trap 'kill $CP $SP 2>/dev/null; wait $CP 2>/dev/null; rm -rf "$PROFILE"' EXIT
sleep 3
rc=0
for f in test/review/*.test.js; do node --test "$f" >/dev/null 2>&1 && echo "ok    $f" || { echo "FAIL  $f"; rc=1; }; done
for f in test/review/*_r[0-9]*_*.mjs; do
  out=$(CDP=$CDP PORT=$PORT timeout 300 node "$f" 2>&1); r=$?
  if [ $r -eq 0 ]; then echo "ok    $f"; else echo "FAIL  $f"; echo "$out" | grep -E '^FAIL' | cut -c1-240 | sed 's/^/      /'; rc=1; fi
done
[ $rc -eq 0 ] && echo 'review tests ok' || echo 'REVIEW TESTS FAILED'
exit $rc
