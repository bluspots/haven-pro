#!/usr/bin/env node
"use strict";
/**
 * Opening splash (Pro), same behavior as Haven Customer, in Pro green.
 * (1) Shell: splash styles and markup come before the app; the library
 *     scripts are deferred (in their original order) so the splash paints
 *     at once; Reduce Motion turns off the animation and the fade.
 * (2) App: holds while connecting, then hides on the frame after the first
 *     real screen; the ErrorBoundary hides it too; no timer hides it early.
 * (3) Shell hide script: fades (0.3 s) and removes the splash; a slow load
 *     only adds "Still loading…"; a script that fails to download shows a
 *     clear message on the splash.
 */
const fs = require("fs"), path = require("path"), assert = require("assert");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const pre = fs.readFileSync(path.join(root, "_shell_pre_pro.txt"), "utf8");
const jsx = fs.readFileSync(path.join(root, "home_services_pro_app.jsx"), "utf8");
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; console.log("  ✓ " + m); };
try {
  console.log("(1) Shell");
  ok(/#haven-splash\{[^}]*background:#0F6E4E/.test(pre), "Pro green splash background (#0F6E4E)");
  ok(pre.indexOf("#haven-splash{") < pre.indexOf("<script") && pre.indexOf('<div id="haven-splash">') < pre.indexOf('<div id="root">'), "splash styles and markup come before the app");
  const scripts = [...pre.matchAll(/<script([^>]*)src="([^"]+)"/g)].map(m => ({ defer: /\bdefer\b/.test(m[1]), src: m[2] }));
  ok(scripts.length === 4 && scripts.every(s => s.defer), "all 4 library scripts are deferred");
  ok(["react.development", "react-dom.development", "babel.min", "supabase"].every((k, i) => scripts[i].src.includes(k)), "library order unchanged (React, ReactDOM, Babel, Supabase)");
  ok(/@media \(prefers-reduced-motion:reduce\)\{#haven-splash \.hs-mark,#haven-splash \.hs-pro,#haven-splash \.hs-line\{animation:none[^}]*\}#haven-splash\{transition:none\}/.test(pre), "Reduce Motion: no animation, no fade");
  console.log("(2) App");
  const fx = jsx.slice(jsx.indexOf("// Opening splash = the loading screen."), jsx.indexOf("}, [backendState]);") + 20);
  ok(/if \(backendState === "connecting"\) return;/.test(fx) && /requestAnimationFrame : setTimeout\)\(hideOpeningSplash\)/.test(fx), "holds while connecting; hides on the frame after the first real screen");
  ok(/hideOpeningSplash\(\);\n  \}/.test(jsx.slice(jsx.indexOf("componentDidCatch"), jsx.indexOf("componentDidCatch") + 200)), "ErrorBoundary hides it too");
  ok(!/setTimeout\(hideOpeningSplash/.test(jsx) && !/function havenHideSplash/.test(jsx), "no early timer; the app never redefines window.havenHideSplash");
  console.log("(3) Shell hide script");
  const js = pre.slice(pre.indexOf("<script>\n/* Hides the splash.") + 8, pre.indexOf("</script>", pre.indexOf("/* Hides the splash.")));
  for (const still of [false, true]) {
    const dom = new JSDOM('<div id="haven-splash"><div class="hs-note"></div></div>');
    const w = dom.window, doc = w.document, timers = [], listeners = [];
    const realAdd = doc.addEventListener.bind(doc);
    doc.addEventListener = (t, f, c) => { listeners.push([t, f, c]); realAdd(t, f, c); };
    w.matchMedia = () => ({ matches: still });
    new Function("window", "document", "performance", "setTimeout", js)(w, doc, { mark() {} }, (f, ms) => { timers.push([f, ms]); return timers.length; });
    const slow = timers.shift();
    if (!still) {
      ok(slow[1] === 10000 && !timers.length, "no timeout ever hides the splash; after 10 s it only adds a note");
      slow[0](); ok(/Still loading/.test(doc.querySelector(".hs-note").textContent), 'slow load: "Still loading…" on the splash');
      listeners.find(l => l[0] === "error" && l[2] === true)[1]({ target: { tagName: "SCRIPT" } });
      ok(/couldn't finish loading/.test(doc.querySelector(".hs-note").textContent), "a failed download shows a clear message");
    }
    w.havenHideSplash(); w.havenHideSplash();
    ok(doc.getElementById("haven-splash").classList.contains("hs-out") && timers.length === 1 && timers[0][1] === (still ? 0 : 320), still ? "Reduce Motion: removed with no fade" : "fades for 0.3 s, once");
    timers[0][0](); ok(!doc.getElementById("haven-splash"), "then removed (no lingering overlay)");
  }
  console.log("OK: splash checks passed (" + passed + " assertions).");
} catch (e) { console.error("FAIL:", e.message); process.exit(1); }
