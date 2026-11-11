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
# Bundle the libraries the page loads (Quagon V7): React, ReactDOM and
# supabase-js come from this folder's pinned npm packages (byte-identical to
# the CDN files the website uses), so the native app loads no code from a CDN.
( cd "$HERE" && [ -d node_modules/react ] || npm install --no-audit --no-fund ) >/dev/null
mkdir -p "$HERE/www/vendor"
cp "$HERE/node_modules/react/umd/react.production.min.js" "$HERE/www/vendor/react.production.min.js"
cp "$HERE/node_modules/react-dom/umd/react-dom.production.min.js" "$HERE/www/vendor/react-dom.production.min.js"
cp "$HERE/node_modules/@supabase/supabase-js/dist/umd/supabase.js" "$HERE/www/vendor/supabase.js"
python3 - "$HERE/www/index.html" <<'PY'
import sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
swaps = [
  ('https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js', 'vendor/react.production.min.js'),
  ('https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js', 'vendor/react-dom.production.min.js'),
  ('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js', 'vendor/supabase.js'),
]
for cdn, local in swaps:
    if s.count('src="%s"' % cdn) != 1: sys.exit("expected the CDN script %s exactly once (versions changed? update native/package.json too)" % cdn)
    s = s.replace('src="%s"' % cdn, 'src="%s"' % local)
if '<script' in s and ('src="https://' in s or "src='https://" in s): sys.exit("native/www/index.html still loads a remote script")
open(p, "w", encoding="utf-8").write(s)
PY
# Switch the spike diagnostics on in the native copy only (counts and times, never coordinates).
python3 - "$HERE/www/index.html" <<'PY'
import re, sys
p = sys.argv[1]; s = open(p, encoding="utf-8").read()
s2, n = re.subn(r'HAVEN_NATIVE_SPIKE_DIAGNOSTICS\s*=\s*(false|!1)', 'HAVEN_NATIVE_SPIKE_DIAGNOSTICS = true', s)
if n != 1: sys.exit("expected exactly one HAVEN_NATIVE_SPIKE_DIAGNOSTICS flag in index.html, found %d" % n)
open(p, "w", encoding="utf-8").write(s2)
PY
echo "native/www ready (diagnostics on)"
