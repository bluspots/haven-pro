#!/bin/bash
# Haven Pro prototype regeneration pipeline — mirrors the Customer App's
# build.sh convention exactly (same sync rule, same rationale).
#
# Regenerates prototype-pro.html from home_services_pro_app.jsx as a single
# self-contained file: no external <script src="*.jsx"> reference. That
# external-reference approach is what caused the blank-screen bug — Babel
# fetches an external .jsx via XHR at runtime, which silently fails under
# file:// (double-clicked HTML) and on hosts that don't serve the sibling
# file. Inlining removes the failure mode entirely.
#
# home_services_pro_app.jsx keeps `import React, {...} from "react"` and
# `export default function HavenProApp(){` so it stays portable to a real
# bundler-based project. Neither line is valid inside a plain
# <script type="text/babel"> tag (no module loader, React is already a
# global from the CDN tag). This script strips exactly those two lines.
# Phase 3 Modularization — Step 0 (Option A): introduce ordered concat source list.
set -e
cd "$(dirname "$0")"

SRC="home_services_pro_app.jsx"
OUT="prototype-pro.html"
OUT_INDEX="index.html"

# Ordered list of source files to concatenate (behavior-identical: currently one file).
# See Customer docs: PHASE3_MODULARIZATION_ORDER.md — Step 0.
SOURCE_FILES=("locked_constants.js" "$SRC")

# Concatenate in order, then apply the existing strip/rename transforms.
BODY=$(cat "${SOURCE_FILES[@]}" | grep -v '^import React' | sed 's/^export default function HavenProApp/function HavenProApp/')

cat _shell_pre_pro.txt > "$OUT"
echo "$BODY" >> "$OUT"
cat _shell_post_pro.txt >> "$OUT"

echo "Built $OUT ($(wc -l < "$OUT") lines)"

# Also publish as index.html for GitHub Pages entrypoint
cp "$OUT" "$OUT_INDEX"
echo "Synced $OUT_INDEX"
