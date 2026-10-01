#!/bin/sh
# Content-hash build for the fun tools: public/<tool>/ -> dist/<tool>/.
# EVERY asset referenced by literal name (logic.js, vendor js, wasm glue + its
# wasm, css, fonts) is hashed in place (name.<sha8>.ext) and every reference
# rewritten - so one index.html always loads its exact matching set and a new
# deploy can never mix versions. index.html / manifest.json / icons keep stable
# names. Files whose name is constructed at runtime (webpack chunks like
# 814.ffmpeg.js) or referenced nowhere stay unhashed - renaming them would break
# or be pointless; they are reported. Replacements are boundary-anchored so
# ".ffmpeg.js" chunk-suffix fragments and .woff vs .woff2 never cross-corrupt.
# Hashing runs leaves-first (deps before referrers) so no file is ever modified
# after its hash is computed - a hashed name stays immutable across deploys.
set -e
cd "$(dirname "$0")"
# -Werror (owner 2026-10-01, as dart analyze in his Flutter build.sh): every unit test and every static-analysis
# finding (eslint incl. the type-aware rules, tsc --checkJs, the house-rules sweeps) fails the build before any hashing
./test.sh
rm -rf dist
for f in public/*/*.js; do case "$f" in *.min.js) ;; *) node --check "$f";; esac; done
python3 - <<'PY'
import hashlib, re, shutil, sys
from pathlib import Path

KEEP = re.compile(r'^(index\.html|manifest\.json|README.*|icon-.*|clinic.*|sw\.js)$')   # sw.js: a service worker URL must stay stable
TEXT = ('.js', '.css', '.html')
def anchored(name):   # match the filename only at a path/quote boundary
    # ... and never when the "file name" is a property chain: `sqlite3.wasm.module = ...` in the vendored SQLite
    # module is the object sqlite3's wasm property, not the file sqlite3.wasm. Rewriting it broke the deployed
    # module's syntax from 0.9.40 to 0.9.55 (every phone fell back to memory-only history) - the local tests run on
    # the unhashed public/ tree and never saw it. The dist syntax check below is the gate for that class.
    # A real reference sits right after a quote, a slash or an opening paren (JS strings, HTML attributes, CSS
    # url()); a bare `sqlite3.wasm` expression (`wasm = sqlite3.wasm,`) is code and stays.
    return re.compile(r'(?<=["\'`/(])' + re.escape(name) + r'(?![\w\-]|\.[A-Za-z_$])')

ntools = 0
for src in sorted(Path('public').iterdir()):
    if not src.is_dir():
        continue
    tool, dst = src.name, Path('dist') / src.name
    shutil.copytree(src, dst)
    texts = [p for p in dst.iterdir() if p.suffix in TEXT]
    cand = [p for p in dst.iterdir() if p.is_file() and not KEEP.match(p.name)]
    def refd(name):
        rx = anchored(name)
        return any(rx.search(t.read_text(errors='ignore')) for t in texts if t.name != name)
    todo = [p for p in cand if refd(p.name)]
    skipped = sorted(p.name for p in cand if p not in todo)
    while todo:
        progressed = False
        for p in list(todo):
            others = [q.name for q in todo if q is not p]
            if p.suffix in ('.js', '.css') and any(anchored(n).search(p.read_text(errors='ignore')) for n in others):
                continue        # still references a not-yet-hashed file - hash that first
            h = hashlib.sha256(p.read_bytes()).hexdigest()[:8]
            base, ext = p.name.split('.', 1)
            newname = f'{base}.{h}.{ext}'
            rx = anchored(p.name)
            newp = dst / newname
            p.rename(newp)
            texts = [t if t.name != p.name else newp for t in texts]
            for t in texts:
                s = t.read_text(errors='ignore')
                if rx.search(s):
                    t.write_text(rx.sub(newname, s))
            todo.remove(p)
            progressed = True
        if not progressed:
            sys.exit(f'{tool}: circular references among {[p.name for p in todo]}')
    if skipped:
        print(f'{tool}: left unhashed (runtime-constructed or unreferenced): {", ".join(skipped)}')
    ntools += 1
print(f'build ok -> dist/ ({ntools} tools, referenced assets content-hashed)')
PY
# the BUILT files must still parse: a hashed-name rewrite inside code (not a reference) is a syntax error that
# only the deployed site would hit (sqlite3.wasm.module, 2026-10-01)
for f in dist/*/*.js; do case "$f" in *.min.js) ;; *) node --check "$f" || { echo "build: $f does not parse after hashing"; exit 1; };; esac; done
echo "build: every hashed js parses"
# ... and no text file in dist still names a file that was renamed (a reference the anchor missed = a 404 live)
python3 - <<'PY'
import re, sys
from pathlib import Path
bad = 0
for tool in sorted(Path('dist').iterdir()):
    if not tool.is_dir(): continue
    renamed = {}
    for f in tool.iterdir():
        m = re.match(r'^(.+)\.([0-9a-f]{8})\.(\w+)$', f.name)
        if m: renamed[f'{m.group(1)}.{m.group(3)}'] = f.name
    for f in tool.rglob('*'):
        if f.suffix not in ('.js', '.css', '.html'): continue
        t = f.read_text(errors='ignore')
        for orig in renamed:
            for m in re.finditer(r'(?<=["\'`/(])' + re.escape(orig) + r'(?![\w\-]|\.[A-Za-z_$])', t):
                bad += 1; print(f'build: {f} still references {orig} (renamed to {renamed[orig]}): ...{t[max(0, m.start() - 40):m.end() + 10]!r}')
if bad: sys.exit(1)
print('build: no stale reference to a renamed file')
PY
