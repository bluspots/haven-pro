#!/usr/bin/env node
"use strict";

/**
 * iPhone status-bar check (Pro, installed home-screen app).
 *
 * The installed app uses a black-translucent status bar: iOS draws the clock
 * and battery in white directly over the page. Alex reviewed a dark strip
 * behind the clock and chose to keep the current look, so this only removes
 * the duplicate settings that browsers and iOS were ignoring.
 *
 * (1) The shell has exactly one manifest link, theme-color, and status-bar
 *     style, and they keep the values that were in effect: manifest.webmanifest,
 *     #0b1a16, black-translucent. (The removed duplicates came second, so
 *     browsers and iOS ignored them.)
 * (2) viewport-fit=cover is kept, and pinch zoom is not disabled.
 * (3) Appearance is unchanged: Alex chose to keep the page background
 *     behind the status bar (no separate dark strip).
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log("  ✓ " + msg); }
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }

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

    console.log("(3) Appearance unchanged (founder preference)");
    const src = read("home_services_pro_app.jsx");
    ok(!/hp-status-strip/.test(src), "no separate strip behind the status bar");
    ok(/paddingTop:\s*"env\(safe-area-inset-top\)"/.test(src), "app still starts below the status bar inset, on the page background");

    console.log("OK: status-bar checks passed (" + passed + " assertions).");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err && err.message ? err.message : err);
    process.exit(1);
  }
})();
