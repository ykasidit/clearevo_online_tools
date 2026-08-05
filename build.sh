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
rm -rf dist
for dir in public/*/; do node --check "${dir}logic.js"; done
python3 - <<'PY'
import hashlib, re, shutil, sys
from pathlib import Path

KEEP = re.compile(r'^(index\.html|manifest\.json|README.*|icon-.*|clinic.*)$')
TEXT = ('.js', '.css', '.html')
def anchored(name):   # match the filename only at a path/quote boundary
    return re.compile(r'(?<![\w.\-])' + re.escape(name) + r'(?![\w\-])')

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
