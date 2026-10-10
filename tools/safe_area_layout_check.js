#!/usr/bin/env node
"use strict";

/**
 * iPhone safe-area layout check (Pro, phone / home-screen mode).
 *
 * Bug this guards against: the outer container padded the top and bottom
 * safe areas AND the app frame inside it was a full 100dvh tall, so on an
 * iPhone the page was taller than the screen by the status bar + home
 * indicator (~93px on iPhone 15 Pro). The bottom nav was pushed partly off
 * screen and its labels sat on the home indicator.
 *
 * Rules checked (jsdom has no layout engine, so this checks the styles that
 * produce the layout; the PR includes a headless-Chromium measurement with
 * simulated insets):
 * (1) Phone mode: outer container is exactly 100dvh tall, pads the top inset
 *     (status bar / Dynamic Island) and does NOT pad the bottom inset.
 * (2) The app frame fills the remaining space (flex: 1) instead of claiming
 *     its own 100dvh.
 * (3) The home-indicator inset is applied once by the bottom nav, and
 *     .hp-scroll content clears the nav plus that inset.
 * (4) The shell keeps viewport-fit=cover (required for env() insets).
 * (5) Desktop preview mode keeps its 390x844 phone frame.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log("  ✓ " + msg); }
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function render(width) {
  const { JSDOM } = require("jsdom");
  const babel = require("@babel/core");
  const React = require("react");
  const ReactDOM = Object.assign({}, require("react-dom"), require("react-dom/client"));
  const dom = new JSDOM(read("prototype-pro.html"), { url: "https://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.localStorage.clear();
  window.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => "[]" });
  window.supabase = { createClient() { return { auth: {
    async getSession() { return { data: { session: null }, error: null }; },
    async getUser() { return { data: { user: null }, error: { name: "AuthSessionMissingError", status: 400 } }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
  } }; } };
  window.React = React; window.ReactDOM = ReactDOM;
  global.window = window; global.document = window.document; global.React = React; global.ReactDOM = ReactDOM;
  const code = babel.transformSync(window.document.querySelector('script[type="text/babel"]').textContent, {
    filename: "pro.jsx", babelrc: false, configFile: false,
    presets: [[require.resolve("@babel/preset-env"), { targets: { node: "current" } }], [require.resolve("@babel/preset-react"), { runtime: "classic" }]],
  }).code;
  window.eval(code);
  for (let i = 0; i < 100 && !window.document.querySelector(".hp-phone-frame"); i++) await sleep(20);
  await sleep(60);
  return window;
}

(async () => {
  try {
    console.log("(1)(2) Phone mode: one screen tall, frame fills, no double bottom inset");
    let w = await render(393);
    const frame = w.document.querySelector(".hp-phone-frame");
    const outer = w.document.querySelector(".haven-pro-frame-outer");
    ok(!!frame && !!outer, "outer container and app frame rendered");
    const os = outer.getAttribute("style") || "", fsx = frame.getAttribute("style") || "";
    ok(/(^|;)\s*height:\s*100dvh/.test(os), "outer container is exactly 100dvh tall");
    // jsdom drops env() values when serializing styles, so the inset rules
    // are read from the phone-mode style object in the source.
    const src = read("home_services_pro_app.jsx");
    const phoneOuter = src.slice(src.indexOf("const outerStyle = showFrameChrome"), src.indexOf("const frameStyle = showFrameChrome"));
    const phoneOuterBranch = phoneOuter.slice(phoneOuter.indexOf(": {"));
    ok(/paddingTop:\s*"env\(safe-area-inset-top\)"/.test(phoneOuterBranch), "outer container pads the status-bar inset");
    ok(!/paddingBottom:\s*"env\(safe-area-inset-bottom\)"/.test(phoneOuterBranch), "outer container does not pad the home-indicator inset");
    ok(/flex:\s*1/.test(fsx) && !/100dvh/.test(fsx), "app frame fills the remaining space (flex: 1, no own 100dvh)");
    w.close();

    console.log("(3) Home-indicator inset applied once");
    const jsx = read("home_services_pro_app.jsx");
    const nav = jsx.slice(jsx.indexOf("function bottomNav()"), jsx.indexOf("function pill("));
    ok(/padding:\s*"6px 4px max\(6px, calc\(env\(safe-area-inset-bottom\) - 12px\)\)"/.test(nav), "bottom nav pads the home indicator itself (low, Instagram-style height)");
    ok(/\.hp-scroll \{[^}]*padding-bottom:\s*calc\(60px \+ env\(safe-area-inset-bottom\)\)/.test(jsx), ".hp-scroll content clears the nav and home indicator");

    console.log("(4) Shell");
    ok(/name="viewport"[^>]*viewport-fit=cover/.test(read("_shell_pre_pro.txt")), "viewport-fit=cover kept (env() insets work)");

    console.log("(5) Desktop preview unchanged");
    w = await render(1280);
    const f2 = w.document.querySelector(".hp-phone-frame").getAttribute("style") || "";
    ok(/width:\s*390px/.test(f2) && /height:\s*844px/.test(f2), "desktop keeps the 390x844 phone frame");
    w.close();

    console.log("OK: safe-area layout checks passed (" + passed + " assertions).");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err && err.message ? err.message : err);
    process.exit(1);
  }
})();
