#!/usr/bin/env node
/**
 * Minimal verification for the Pro prototype build.
 * - Ensures tightened claimable-only query exists in built HTML outputs.
 * - Prints a clear message and exits nonzero on failure.
 */
const fs = require('fs');

const files = ['prototype-pro.html', 'index.html'];
const required = 'status=eq.posted&pro_id=is.null&order=posted_at.desc';

function checkFile(path) {
  try {
    const text = fs.readFileSync(path, 'utf8');
    if (!text.includes(required)) {
      console.error(`Missing tightened query in ${path}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`Unable to read ${path}:`, e.message);
    return false;
  }
}

const ok = files.every(checkFile);
if (!ok) {
  process.exit(1);
}
console.log('verify: OK');

