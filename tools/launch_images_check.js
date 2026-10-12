#!/usr/bin/env node
"use strict";
/**
 * iPhone launch images (Pro). iOS ignores the manifest background for
 * home-screen apps and shows a blank screen until the page paints, unless an
 * apple-touch-startup-image matches the device exactly. Each image is the Pro
 * splash's first frame (plain green #0F6E4E).
 */
const fs = require("fs"), path = require("path"), assert = require("assert");
const root = path.resolve(__dirname, "..");
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; };
try {
  const pre = fs.readFileSync(path.join(root, "_shell_pre_pro.txt"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const tags = [...pre.matchAll(/<link rel="apple-touch-startup-image" media="screen and \(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\) and \(orientation: portrait\)" href="(splash\/[^"]+)"\/>/g)];
  ok(tags.length === 13, "13 iPhone screen sizes covered");
  ok(pre.indexOf("apple-touch-startup-image") < pre.indexOf("<script"), "declared in the head before any script");
  ok(html.includes("apple-touch-startup-image"), "the built index.html carries them");
  for (const [, w, h, r, href] of tags) {
    const buf = fs.readFileSync(path.join(root, href));
    ok(buf.readUInt32BE(16) === w * r && buf.readUInt32BE(20) === h * r, href + " is exactly " + (w * r) + "x" + (h * r));
    ok(buf.length < 2048, href + " is tiny");
  }
  ok(/#haven-splash\{[^}]*background:#0F6E4E/.test(pre), "splash first frame is green #0F6E4E");
  console.log("OK: launch image checks passed (" + passed + " assertions).");
} catch (e) { console.error("FAIL:", e.message); process.exit(1); }
