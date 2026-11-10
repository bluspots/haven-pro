#!/usr/bin/env bash
# Builds the native app's web folder (native/www) from the repo's own build.
# The GitHub Pages pages are rebuilt exactly as usual; only the copy in
# native/www has the spike diagnostics switched on.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
( cd "$ROOT" && [ -d node_modules ] || npm install --no-audit --no-fund ) >/dev/null
( cd "$ROOT" && bash ./build-pro.sh )
rm -rf "$HERE/www" && mkdir -p "$HERE/www"
cp "$ROOT/index.html" "$HERE/www/index.html"
for f in manifest.json manifest.webmanifest apple-touch-icon.png icon-192.png icon-512.png; do [ -f "$ROOT/$f" ] && cp "$ROOT/$f" "$HERE/www/"; done
[ -d "$ROOT/splash" ] && cp -R "$ROOT/splash" "$HERE/www/splash"
# Switch the spike diagnostics on in the native copy only (counts and times, never coordinates).
python3 - "$HERE/www/index.html" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
s2, n = re.subn(r'HAVEN_NATIVE_SPIKE_DIAGNOSTICS\s*=\s*(false|!1)', 'HAVEN_NATIVE_SPIKE_DIAGNOSTICS = true', s)
if n != 1: sys.exit("expected exactly one HAVEN_NATIVE_SPIKE_DIAGNOSTICS flag in index.html, found %d" % n)
open(p, "w", encoding="utf-8").write(s2)
PY
echo "native/www ready (diagnostics on)"
