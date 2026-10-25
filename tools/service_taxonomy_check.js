#!/usr/bin/env node
"use strict";
/**
 * CAT-01 F1 (Pro): shared service taxonomy registry.
 *
 * - service_taxonomy.js is byte-identical to the Customer app's copy: both repos
 *   pin the same SHA-256 (PARITY_SHA256 = bluspots.github.io service_taxonomy.test.js).
 * - 16 approved keys; all 61 catalog tasks map exactly as in the founder-approved
 *   matrix (encoded independently here); emergency mappings; legacy labels.
 * - Compatibility: every Pro work-category label (CATEGORY_GROUPS,
 *   DEFAULT_WORK_CATEGORIES, DIAGNOSIS_CATEGORIES) is covered; Furniture Assembly
 *   is a furniture-only capability; new keys are opt-in only.
 * - Behavior-neutral: not in the build or shipped pages; the board filter,
 *   category constants and preference saving are unchanged.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const assert = require("assert");
const root = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); pass++; console.log("  ✓ " + m); };

// Same constant in bluspots.github.io/service_taxonomy.test.js.
const PARITY_SHA256 = "3fc83215c0370f6ca10d3e56a10c0cc4654eb705ffbe3d16c665c1a9c5bbc697";

try {
  const src = read("service_taxonomy.js");
  ok(crypto.createHash("sha256").update(src).digest("hex") === PARITY_SHA256, "service_taxonomy.js matches the pinned shared hash (identical to the Customer copy)");
  const T = require(path.join(root, "service_taxonomy.js"));

  const APPROVED_KEYS = ["plumbing", "electrical", "hvac", "appliance", "handyman", "assembly", "installation", "tv_mounting", "smart_home", "cleaning", "landscaping", "painting", "flooring", "moving", "maintenance", "pest_control"];
  const APPROVED_MATRIX = {
    assembly: [1, 2, 3, 4, 5], installation: [7, 8, 9, 10], tv_mounting: [6], smart_home: [11, 12, 13, 14],
    plumbing: [15, 16, 17, 18, 19, 52], electrical: [20, 21, 22, 23, 54, 57], painting: [24, 25, 26], flooring: [27, 28, 29],
    cleaning: [30, 31, 32, 33, 59, 60, 61], landscaping: [34, 35, 36, 37], moving: [38, 39, 40], handyman: [41, 42, 43, 44, 56, 58],
    hvac: [45, 53], maintenance: [46, 47, 48], appliance: [49, 50, 55], pest_control: [51],
  };
  const keys = T.HAVEN_SERVICE_CATEGORIES.map(c => c.key);
  ok(JSON.stringify(keys) === JSON.stringify(APPROVED_KEYS), "16 approved keys, unique, in the approved order");
  ok(keys.every(k => /^[a-z]+(_[a-z]+)*$/.test(k)), "keys are lowercase snake_case");
  const mapped = Object.keys(T.HAVEN_TASK_SERVICE_KEYS).map(Number).sort((a, b) => a - b);
  ok(mapped.length === 61 && mapped.every((id, i) => id === i + 1), "task ids 1–61 each mapped exactly once");
  ok(Object.entries(APPROVED_MATRIX).every(([k, ids]) => ids.every(id => T.HAVEN_TASK_SERVICE_KEYS[id] === k)) && Object.values(APPROVED_MATRIX).flat().length === 61, "every task matches the founder-approved matrix");
  ok(T.HAVEN_EMERGENCY_SERVICE_KEYS.ac === "hvac" && T.HAVEN_EMERGENCY_SERVICE_KEYS.lock === null && T.HAVEN_EMERGENCY_SERVICE_KEYS.other === null, "emergency mappings present; custom emergencies unclassified");

  // Compatibility with the Pro app's current definitions.
  const sb = {}; vm.createContext(sb);
  vm.runInContext(read("locked_constants.js") + "\n;globalThis.__G = CATEGORY_GROUPS; globalThis.__D = DEFAULT_WORK_CATEGORIES; globalThis.__X = DIAGNOSIS_CATEGORIES;", sb);
  const proLabels = sb.__G.flatMap(g => g.categories.map(c => c.name));
  ok(proLabels.length === 12 && proLabels.every(l => T.havenLegacyLabelInfo(l, "pro")), "all 12 Pro work-category labels are in the registry");
  ok(Object.keys(T.HAVEN_LEGACY_PRO_LABELS).length === 12 && Object.keys(T.HAVEN_LEGACY_PRO_LABELS).every(l => proLabels.includes(l)), "the registry's Pro labels are exactly the app's labels");
  ok([...sb.__D, ...sb.__X].every(l => T.havenLegacyLabelInfo(l, "pro")), "default and diagnosis category labels are covered");
  const fa = T.havenLegacyLabelInfo("Furniture Assembly", "pro");
  ok(fa.key === "assembly" && fa.kind === "capability_subset" && fa.capability === "furniture_only", "Furniture Assembly maps to a furniture-only assembly capability (not home gym)");
  ok(T.HAVEN_OPT_IN_ONLY_KEYS.every(k => !Object.values(T.HAVEN_LEGACY_PRO_LABELS).some(i => i.key === k)), "opt-in-only keys (installation, flooring, maintenance, pest_control) have no legacy Pro equivalent");
  ok(["Repair", "Installation", "Maintenance", "Other", "General"].every(l => T.havenLegacyLabelInfo(l, "customer").key === null), "ambiguous Customer labels never resolve to a key");
  // Every exact Customer label the Pro board could receive maps to a key a Pro label also maps to,
  // except the opt-in-only keys (documented gap; F4/F5 handle it with the backend contract).
  const proKeys = new Set(Object.values(T.HAVEN_LEGACY_PRO_LABELS).map(i => i.key));
  const custExact = Object.values(T.HAVEN_LEGACY_CUSTOMER_LABELS).filter(i => i.kind === "exact").map(i => i.key);
  ok(custExact.every(k => proKeys.has(k) || T.HAVEN_OPT_IN_ONLY_KEYS.includes(k)), "every unambiguous Customer label has a Pro equivalent or is an opt-in-only key");

  // Behavior-neutral.
  ok(!/service_taxonomy/.test(read("build-pro.sh")), "not part of the build");
  for (const f of ["index.html", "prototype-pro.html"]) ok(!/HAVEN_SERVICE_CATEGORIES|HAVEN_TASK_SERVICE_KEYS|havenServiceKeyForTask/.test(read(f)), f + ": registry not shipped");
  const jsx = read("home_services_pro_app.jsx");
  ok(!/HAVEN_SERVICE_CATEGORIES|havenLegacyLabelInfo|havenServiceKeyForTask|service_key/.test(jsx + read("backend_adapter.js")), "app and adapter code don't use the registry");
  ok(/availableJobs\.filter\(j => workCategories\.has\(j\.category\)\)/.test(jsx), "board filter is unchanged (legacy label match)");
  ok(/const DEFAULT_WORK_CATEGORIES = \["Plumbing", "Electrical", "HVAC", "Appliance", "Handyman"\];/.test(read("locked_constants.js")), "Pro defaults unchanged in F1 (no-preselection is F5, gated)");
  console.log(`OK: CAT-01 F1 taxonomy registry checks passed (${pass} assertions).`);
} catch (e) { console.error("FAIL:", e.message); process.exit(1); }
