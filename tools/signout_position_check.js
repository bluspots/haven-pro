#!/usr/bin/env node
"use strict";
/**
 * Profile layout (founder's call): Account sits above Settings, and Sign Out
 * is on its own at the very bottom of Profile, below every other option.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "home_services_pro_app.jsx"), "utf8");
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log("  ✓ " + m); };
const fnBody = name => { const i = src.indexOf(`function ${name}(`); assert.ok(i >= 0, name); const j = src.indexOf("\n  function ", i + 10); return src.slice(i, j).replace(/^\s*\/\/.*$/gm, ""); };
try {
  const acc = src.indexOf("{accountSection()}");
  const settings = src.indexOf('{sectionLabel("Settings")}', acc);
  const signout = src.indexOf("{profileSignOut()}", settings);
  ok(acc > 0 && settings > acc, "Account section comes before Settings on Profile");
  ok(signout > settings, "Sign Out comes after Settings");
  const after = src.slice(signout + "{profileSignOut()}".length, src.indexOf("\n    );\n  }", signout));
  ok(/^\s*<\/div>\s*<\/div>\s*$/.test(after), "nothing follows Sign Out on Profile (it is the last item)");
  ok(!/signOutHavenAccount|Sign Out/.test(fnBody("accountSection")), "the Account section no longer holds Sign Out");
  const so = fnBody("profileSignOut");
  ok(/onClick=\{signOutHavenAccount\}/.test(so), "the bottom Sign Out still opens the confirmation (signOutHavenAccount)");
  ok((src.match(/\{profileSignOut\(\)\}/g) || []).length === 1, "Sign Out appears once on Profile");
  console.log("OK: Sign Out position checks passed (" + passed + " assertions).");
} catch (e) { console.error("FAIL:", e.message); process.exit(1); }
