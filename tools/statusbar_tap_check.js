#!/usr/bin/env node
"use strict";
/**
 * Tap the status bar to scroll to the top (Pro, installed app), matching
 * Haven Customer. iOS scrolls the PAGE to the top on a status-bar tap, but
 * Pro scrolls inside its screens, so the tap did nothing. In phone mode the
 * page is one pixel taller than the screen and kept scrolled by that pixel;
 * when it lands at 0 (the tap), the visible screen scrolls to the top and the
 * pixel is re-armed. (Behavior verified in Chromium by simulating the page
 * scroll; the real tap needs an iPhone.)
 */
const fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "home_services_pro_app.jsx"), "utf8");
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; console.log("  ✓ " + m); };
try {
  const outer = src.slice(src.indexOf("const outerStyle = showFrameChrome"), src.indexOf("const frameStyle = showFrameChrome"));
  const [desk, phone] = [outer.slice(0, outer.indexOf(": {")), outer.slice(outer.indexOf(": {"))];
  ok(/height:\s*"calc\(100dvh \+ 1px\)"/.test(phone), "phone mode: the page is one pixel taller than the screen");
  ok(!/calc\(100dvh/.test(desk), "desktop preview frame unchanged");
  const fx = src.slice(src.indexOf("// Tap the status bar to scroll to the top"), src.indexOf("function isNearJob("));
  ok(/window\.addEventListener\("scroll", onScroll, \{ passive: true \}\)/.test(fx), "listens for the page scroll (passive)");
  ok(/armed && window\.scrollY <= 0/.test(fx) && /window\.scrollTo\(0, 1\)/.test(fx), "acts only when the armed page lands at 0, then re-arms at 1px");
  ok(/if \(!typing\(\)\)/.test(fx) && /INPUT.*TEXTAREA.*SELECT/.test(fx), "never while typing (iOS scrolls the page for the keyboard)");
  ok(/\[data-swipe-foreground\] \.hp-scroll/.test(fx) && /behavior: prefersReducedMotion\(\) \? "auto" : "smooth"/.test(fx), "scrolls the visible screen, smoothly unless Reduce Motion is on");
  ok(/canScroll = se\(\)\.scrollHeight > window\.innerHeight/.test(fx), "does nothing where the page cannot scroll (desktop preview)");
  ok(/return \(\) => \{ clearTimeout\(t0\); clearTimeout\(timer\); window\.removeEventListener\("scroll", onScroll\);/.test(fx), "cleans up its listeners");
  console.log("OK: status-bar tap checks passed (" + passed + " assertions).");
} catch (e) { console.error("FAIL:", e.message); process.exit(1); }
