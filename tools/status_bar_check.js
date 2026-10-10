#!/usr/bin/env node
"use strict";

/**
 * iPhone status-bar check (Pro, installed home-screen app).
 *
 * The installed app uses a black-translucent status bar: iOS draws the clock
 * and battery in white directly over the page. Before this fix, the page's
 * light background sat behind the clock in light mode, which made it hard to
 * read.
 *
 * (1) The shell has exactly one manifest link, theme-color, and status-bar
 *     style, and they keep the values that were in effect: manifest.webmanifest,
 *     #0b1a16, black-translucent. (The removed duplicates came second, so
 *     browsers and iOS ignored them.)
 * (2) viewport-fit=cover is kept, and pinch zoom is not disabled.
 * (3) Phone mode renders a status strip as the first child of the outer
 *     container, sized to the top safe-area inset, with a dark background in
 *     BOTH themes. The white clock on that color has a contrast ratio of at
 *     least 7:1.
 * (4) Desktop preview renders no strip.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log("  ✓ " + msg); }
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function lum(hex) {
  const v = hex.replace("#", "").match(/../g).map(h => parseInt(h, 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function rgbToHex(rgb) {
  const m = rgb.match(/\d+/g); return "#" + m.slice(0, 3).map(n => (+n).toString(16).padStart(2, "0")).join("");
}

async function render(width, theme) {
  const { JSDOM } = require("jsdom");
  const babel = require("@babel/core");
  const React = require("react");
  const ReactDOM = Object.assign({}, require("react-dom"), require("react-dom/client"));
  let html = read("prototype-pro.html");
  if (theme === "dark") {
    const from = 'const [theme, setTheme] = useState("light");';
    assert.ok(html.includes(from), "theme state anchor present");
    html = html.replace(from, 'const [theme, setTheme] = useState("dark");');
  }
  const dom = new JSDOM(html, { url: "https://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
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
    console.log("(1) One copy of each setting, keeping the values in effect");
    const shell = read("_shell_pre_pro.txt");
    const manifests = shell.match(/<link[^>]+rel="manifest"[^>]*>/gi) || [];
    ok(manifests.length === 1 && /manifest\.webmanifest/.test(manifests[0]), "one manifest link: manifest.webmanifest");
    const themes = shell.match(/<meta[^>]+name="theme-color"[^>]*>/gi) || [];
    ok(themes.length === 1 && /content="#0b1a16"/i.test(themes[0]), "one theme-color: #0b1a16");
    const bars = shell.match(/<meta[^>]+name="apple-mobile-web-app-status-bar-style"[^>]*>/gi) || [];
    ok(bars.length === 1 && /content="black-translucent"/.test(bars[0]), "one status-bar style: black-translucent");
    ok((shell.match(/name="apple-mobile-web-app-capable"/g) || []).length === 1, "one apple-mobile-web-app-capable");
    ok(/name="apple-mobile-web-app-title" content="Haven Pro"/.test(shell), "home-screen title kept");
    const wm = JSON.parse(read("manifest.webmanifest"));
    ok(wm.theme_color.toLowerCase() === "#0b1a16" && wm.display === "standalone", "manifest.webmanifest still standalone with #0b1a16");

    console.log("(2) Viewport");
    const vp = (shell.match(/<meta[^>]+name="viewport"[^>]*>/i) || [""])[0];
    ok(/viewport-fit=cover/.test(vp), "viewport-fit=cover kept");
    ok(!/maximum-scale|user-scalable\s*=\s*(no|0)/i.test(vp), "pinch zoom not disabled");

    console.log("(3) Dark strip behind the status bar in both themes");
    const src = read("home_services_pro_app.jsx");
    ok(/className="hp-status-strip"[^>]*height:\s*"env\(safe-area-inset-top\)"/.test(src), "strip is sized to the top safe-area inset");
    for (const theme of ["light", "dark"]) {
      const w = await render(393, theme);
      const outer = w.document.querySelector(".haven-pro-frame-outer");
      const strip = outer && outer.firstElementChild;
      ok(strip && strip.classList.contains("hp-status-strip"), theme + ": strip is the first thing in the outer container, above the app frame");
      ok(strip.getAttribute("aria-hidden") === "true", theme + ": strip is hidden from screen readers");
      const hex = rgbToHex(w.getComputedStyle(strip).backgroundColor);
      const ratio = (1.05) / (lum(hex) + 0.05);
      ok(ratio >= 7, theme + ": white status-bar text on " + hex + " has contrast " + ratio.toFixed(1) + ":1 (>= 7)");
      w.close();
    }

    console.log("(4) Desktop preview has no strip");
    const wd = await render(1280, "light");
    ok(!wd.document.querySelector(".hp-status-strip"), "no strip in the desktop phone frame");
    wd.close();

    console.log("OK: status-bar checks passed (" + passed + " assertions).");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err && err.message ? err.message : err);
    process.exit(1);
  }
})();
