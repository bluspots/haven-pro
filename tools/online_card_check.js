#!/usr/bin/env node
"use strict";

/**
 * "You're Online" card color (Pro Home).
 *
 * In dark mode the card used the bright dark-mode accent (#34C48E), which
 * Alex found too neon. It now uses the same deep green as light mode in both
 * themes. Other dark-mode accents are unchanged.
 *
 * (1) LIGHT.online and DARK.online are the deep green #0F6E4E.
 * (2) White card text on it has a contrast ratio of at least 4.5:1 (AA).
 * (3) The Online card uses T.online. Offline still uses T.soonBg, and the
 *     general accent T.pg is untouched in both themes.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log("  ✓ " + msg); }
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function lum(hex) {
  const v = hex.replace("#", "").match(/../g).map(h => parseInt(h, 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

try {
  const { LIGHT, DARK } = new Function(read("theme_tokens.js") + "\nreturn { LIGHT, DARK };")();
  console.log("(1)(2) Deep green in both themes");
  for (const [name, T] of [["light", LIGHT], ["dark", DARK]]) {
    ok(T.online === "#0F6E4E", name + ": Online card is deep green #0F6E4E");
    const ratio = 1.05 / (lum(T.online) + 0.05);
    ok(ratio >= 4.5, name + ": white text on it has contrast " + ratio.toFixed(1) + ":1 (>= 4.5)");
  }
  console.log("(3) Only the Online card changed");
  const src = read("home_services_pro_app.jsx");
  ok(/background: online \? T\.online : T\.soonBg/.test(src), "Online card uses T.online, offline keeps T.soonBg");
  ok(LIGHT.pg === "#0F6E4E" && DARK.pg === "#34C48E", "general accent colors unchanged (light #0F6E4E, dark #34C48E)");
  console.log("OK: Online card color checks passed (" + passed + " assertions).");
} catch (err) {
  console.error("FAIL:", err && err.message ? err.message : err);
  process.exit(1);
}
