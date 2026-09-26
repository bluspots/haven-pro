#!/usr/bin/env node
/**
 * Minimal verification for Haven Pro changes:
 * - Built HTML contains the hardened Supabase filter `pro_id=is.null`
 * - Backend adapter fetch uses `pro_id=is.null`
 * - Home app filters out active jobs on refresh/load and clears SIM seeds when Supabase is configured
 */
import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

function fileContains(path, pattern) {
  const src = readFileSync(path, "utf8");
  return (pattern instanceof RegExp) ? pattern.test(src) : src.includes(pattern);
}

// 1) Built artifacts must include the claimable filter
assert(fileContains("prototype-pro.html", "pro_id=is.null"), "prototype-pro.html missing 'pro_id=is.null'");
assert(fileContains("index.html", "pro_id=is.null"), "index.html missing 'pro_id=is.null'");

// 2) backend_adapter hardens fetch to claimable rows
assert(fileContains("backend_adapter.js", /status=eq\.posted&pro_id=is\.null&order=posted_at\.desc/), "backend_adapter.js fetch missing claimable filter");

// 3) Home app clears SIM seeds and excludes active ids when applying fetched lists
assert(fileContains("home_services_pro_app.jsx", /Clear SIM seeds.*setAvailableJobs\\(\\[\\]\\)/s), "home_services_pro_app.jsx did not clear SIM seeds before loading when Supabase is configured");
assert(fileContains("home_services_pro_app.jsx", /activeJobsRef\\.current\\.map\\(j => j\\.id\\)/), "home_services_pro_app.jsx did not reference activeJobsRef when filtering posted jobs");

console.log("VERIFY_EXIT_0=yes");
