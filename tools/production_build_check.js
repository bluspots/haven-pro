#!/usr/bin/env node
"use strict";
/**
 * Production build guard (index.html is what GitHub Pages serves).
 * (1) No Babel: no babel script, no text/babel block, no JSX left in the app code.
 * (2) Production React/ReactDOM 18.3.1 from cdnjs, in the original order, deferred,
 *     before Supabase; Supabase library unchanged.
 * (3) The compiled app block parses as plain JavaScript and is run by the
 *     DOMContentLoaded loader, after the deferred libraries (as Babel did).
 * (4) Everything outside the scripts is unchanged from the source page:
 *     splash, launch images, manifest, icons, metadata.
 * (5) index.html is current: rebuilding the source gives the same bytes.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const { compileHtml } = require("./compile_html.js");
const root = path.resolve(__dirname, "..");
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
const idx = fs.readFileSync(path.join(root, "index.html"), "utf8");
const src = fs.readFileSync(path.join(root, "prototype-pro.html"), "utf8");

// (1)
ok(!/babel/i.test(idx.replace(/<script type="text\/plain" id="haven-app">[\s\S]*?<\/script>/, "")), "no Babel script or text/babel block in index.html");
const m = idx.match(/<script type="text\/plain" id="haven-app">([\s\S]*?)<\/script>/);
ok(m && idx.split('id="haven-app"').length === 2, "exactly one compiled app block");
const code = m[1];
ok(!/<[A-Z][A-Za-z]*[\s/>]/.test(code.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""')), "no JSX tags left in the compiled code");
ok(code.includes("React.createElement(") && code.includes("function HavenProApp("), "compiled to React.createElement; app function present by name");
// (2)
const scripts = [...idx.matchAll(/<script([^>]*)>/g)].map(x => x[1]);
const srcs = scripts.map(a => (a.match(/src="([^"]+)"/) || [])[1]).filter(Boolean);
ok(JSON.stringify(srcs) === JSON.stringify([
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js",
]), "libraries: production React + ReactDOM 18.3.1, then the same Supabase library");
ok(scripts.filter(a => /src=/.test(a)).every(a => /\bdefer\b/.test(a)), "library scripts stay deferred (splash paints first)");
ok(!idx.includes(".development.js"), "no React development build");
// (3)
new vm.Script(code, { filename: "haven-app.js" });
ok(true, "compiled app code parses as plain JavaScript");
const loaderAt = idx.indexOf('document.addEventListener("DOMContentLoaded",function(){var c=document.getElementById("haven-app")');
ok(loaderAt > idx.indexOf('id="haven-app"'), "loader runs the app block on DOMContentLoaded (after deferred libraries)");
// (4)
const strip = h => h.replace(/<script[\s\S]*?<\/script>\n?/g, "");
ok(strip(idx) === strip(src), "markup, styles, splash, launch images and metadata identical to the source page");
ok(idx.indexOf("#haven-splash{") < idx.indexOf("<script") && idx.indexOf('<div id="haven-splash">') < idx.indexOf('<div id="root">'), "splash styles before any script; splash markup before the app root");
// (5)
ok(compileHtml(src) === idx, "index.html is up to date with prototype-pro.html");
console.log(`OK: production build checks passed (${pass} assertions).`);
