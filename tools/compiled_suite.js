#!/usr/bin/env node
"use strict";
/**
 * Runs every check in `npm run verify` against the compiled production page
 * (index.html) instead of the JSX source page.
 *
 * The checks boot the app from prototype-pro.html's <script type="text/babel">
 * block. This makes a temporary copy of the repo whose prototype-pro.html IS
 * the built index.html, with the compiled app block relabelled text/babel so
 * the checks find it (the code inside is byte-for-byte what ships), then runs
 * every check there. A check that only passes on the source page fails here.
 *
 * HAVEN_COMPILED_SUITE=1 tells a1_backend_connect_check to skip its one
 * "index.html is the build of prototype-pro.html" comparison, which the
 * normal run already makes and which can't hold inside the copy.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const checks = [...pkg.scripts.verify.matchAll(/node (tools\/[\w.-]+\.js)/g)].map(m => m[1])
  .concat(pkg.scripts["boot-check"].match(/tools\/[\w.-]+\.js/)[0])
  // These two check the build itself (they already run on the real index.html).
  .filter(c => !/(compiled_suite|production_build_check)\.js$/.test(c));

const built = fs.readFileSync(path.join(root, "index.html"), "utf8");
const OPEN = '<script type="text/plain" id="haven-app">';
if (built.split(OPEN).length !== 2) throw new Error("compiled app block not found in index.html; run npm run build");
if (built.includes('type="text/babel"') || /babel(\.min)?\.js/.test(built)) throw new Error("index.html still references Babel");
const asSource = built.replace(OPEN, '<script type="text/babel" id="haven-app">');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "haven-pro-compiled-"));
for (const name of fs.readdirSync(root)) {
  if (name === ".git" || name === "node_modules") continue;
  fs.cpSync(path.join(root, name), path.join(tmp, name), { recursive: true });
}
fs.symlinkSync(path.join(root, "node_modules"), path.join(tmp, "node_modules"));
fs.writeFileSync(path.join(tmp, "prototype-pro.html"), asSource);
fs.writeFileSync(path.join(tmp, "index.html"), asSource);

let failed = 0;
for (const c of [...new Set(checks)]) {
  try {
    execFileSync(process.execPath, [path.join(tmp, c)], { cwd: tmp, stdio: "pipe", env: { ...process.env, HAVEN_COMPILED_SUITE: "1" }, timeout: 300000 });
    console.log("  compiled ok: " + c);
  } catch (e) {
    failed++;
    console.log("  COMPILED FAIL: " + c + "\n" + String(e.stdout || "").slice(-800) + String(e.stderr || "").slice(-1500));
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.error(`--- Compiled build: ${failed} check(s) failed ---`); process.exit(1); }
console.log(`OK: all ${new Set(checks).size} checks pass on the compiled production page.`);
