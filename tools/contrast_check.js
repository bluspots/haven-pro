#!/usr/bin/env node
"use strict";
/**
 * Pro readability (founder approved smallest practical adjustments):
 * - White text on filled green buttons and chat bubbles uses T.cta, the same
 *   green hue darkened just enough for 4.5:1 in both themes.
 * - Muted gray text (T.tm) reaches 4.5:1 on cards and the page background.
 * - The palette is otherwise unchanged: pgb (chart and progress bars), pg,
 *   ts, backgrounds and the Online card keep their values.
 */
const fs = require("fs"), path = require("path"), assert = require("assert");
const root = path.resolve(__dirname, "..");
const tokSrc = fs.readFileSync(path.join(root, "theme_tokens.js"), "utf8");
const { LIGHT, DARK } = new Function(tokSrc + "\nreturn {LIGHT, DARK};")();
const app = fs.readFileSync(path.join(root, "home_services_pro_app.jsx"), "utf8");
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; console.log("  ✓ " + m); };
const lin = c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const L = h => { const v = [1, 3, 5].map(i => lin(parseInt(h.slice(i, i + 2), 16) / 255)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const cr = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
try {
  for (const [name, T] of [["light", LIGHT], ["dark", DARK]]) {
    ok(cr(T.cta, "#FFFFFF") >= 4.5, `${name}: white on button green ${T.cta} = ${cr(T.cta, "#FFFFFF").toFixed(2)}:1`);
    ok(cr(T.tm, T.w) >= 4.5 && cr(T.tm, T.bg) >= 4.5, `${name}: muted text ${T.tm} = ${cr(T.tm, T.w).toFixed(2)}:1 on cards, ${cr(T.tm, T.bg).toFixed(2)}:1 on page`);
    ok(cr(T.ts, T.w) > cr(T.tm, T.w), `${name}: secondary text still stronger than muted text (hierarchy kept)`);
  }
  ok(LIGHT.pgb === "#16A34A" && DARK.pgb === "#22C55E", "pgb unchanged (chart and progress bars keep their green)");
  ok(LIGHT.pg === "#0F6E4E" && DARK.pg === "#34C48E" && LIGHT.online === "#0F6E4E", "brand green and Online card unchanged");
  const whiteOnPgb = app.split("\n").filter(l => /T\.pgb/.test(l) && /#fff/i.test(l));
  ok(whiteOnPgb.length === 0, "no white text left on the old button green (" + whiteOnPgb.length + ")");
  ok((app.match(/T\.cta/g) || []).length >= 30, "buttons and bubbles use T.cta (" + (app.match(/T\.cta/g) || []).length + " places)");
  console.log("OK: contrast checks passed (" + passed + " assertions).");
} catch (e) { console.error("FAIL:", e.message); process.exit(1); }
