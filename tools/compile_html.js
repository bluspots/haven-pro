#!/usr/bin/env node
"use strict";
/**
 * Production build step (Haven Pro).
 *
 *   node tools/compile_html.js prototype-pro.html index.html
 *
 * prototype-pro.html stays the readable source page: its app code is JSX in a
 * <script type="text/babel"> block that Babel compiles in the browser. That
 * compile took ~7 s on every launch. This step does it once, at build time,
 * and writes the page that GitHub Pages serves (index.html):
 *
 *   1. The app's JSX is compiled to plain JavaScript with esbuild (a build
 *      tool only; nothing from it ships to the phone). Names, text and layout
 *      are kept as written (no renaming or minifying).
 *   2. Babel (3 MB) is no longer loaded.
 *   3. React and ReactDOM switch to their production builds (same version).
 *   4. The compiled code runs exactly when and how Babel ran it before: once
 *      the page and its libraries have loaded (DOMContentLoaded), as an
 *      ordinary page script. Its code sits in an inert
 *      <script type="text/plain" id="haven-app"> block and a 1-line loader runs
 *      it, the same mechanism Babel used.
 *
 * Everything else in the page (splash, launch images, manifest, Supabase
 * library) is copied unchanged. The build fails if anything unexpected is
 * found, rather than shipping a half-converted page.
 */
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const OPEN = '<script type="text/babel">';
const BABEL_TAG = /<script defer src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/babel-standalone\/[0-9.]+\/babel\.min\.js"><\/script>\n?/;
const REACT_DEV = [
  ["/umd/react.development.js", "/umd/react.production.min.js"],
  ["/umd/react-dom.development.js", "/umd/react-dom.production.min.js"],
];
const LOADER = '<script>document.addEventListener("DOMContentLoaded",function(){var c=document.getElementById("haven-app"),s=document.createElement("script");s.text=c.textContent;document.body.appendChild(s);});</script>';

function fail(msg) { throw new Error("compile_html: " + msg); }

function compileHtml(src) {
  const start = src.indexOf(OPEN);
  if (start < 0) fail("no <script type=\"text/babel\"> block in the source page");
  if (src.indexOf(OPEN, start + 1) >= 0) fail("more than one text/babel block");
  const codeStart = start + OPEN.length;
  const end = src.indexOf("</script>", codeStart);
  if (end < 0) fail("text/babel block is not closed");
  const jsx = src.slice(codeStart, end);

  const out = esbuild.transformSync(jsx, {
    loader: "jsx",
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    target: "safari15",
    charset: "utf8",
    legalComments: "none",
  }).code;
  if (/<\/script/i.test(out) || out.includes("<!--")) fail("compiled code contains </script or <!-- and can't be inlined");

  let head = src.slice(0, start);
  if (!BABEL_TAG.test(head)) fail("Babel script tag not found (shell changed?)");
  head = head.replace(BABEL_TAG, "");
  for (const [dev, prod] of REACT_DEV) {
    if (!head.includes(dev)) fail("React development build not found: " + dev);
    head = head.replace(dev, prod);
  }
  const tail = src.slice(end + "</script>".length);
  return head + '<script type="text/plain" id="haven-app">' + out + "</script>\n" + LOADER + tail;
}

module.exports = { compileHtml };

if (require.main === module) {
  const [, , inFile, outFile] = process.argv;
  if (!inFile || !outFile) { console.error("usage: compile_html.js <in.html> <out.html>"); process.exit(2); }
  const root = process.cwd();
  const src = fs.readFileSync(path.join(root, inFile), "utf8");
  const html = compileHtml(src);
  fs.writeFileSync(path.join(root, outFile), html);
  console.log(`Compiled ${outFile} (${Math.round(html.length / 1024)} KB, was ${Math.round(src.length / 1024)} KB source; no Babel, production React)`);
}
