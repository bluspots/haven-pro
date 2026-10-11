#!/usr/bin/env node
"use strict";
/**
 * Materials reimbursement wording (founder-approved direction): plain words,
 * and reimbursement is repayment for what the Pro spent, not extra earnings.
 * Only copy changes; amounts come from the existing fee constants.
 */
const fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "home_services_pro_app.jsx"), "utf8");
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; console.log("  ✓ " + m); };
try {
  const phrase = "Tips are 100% yours, and materials you purchase are reimbursed in full.";
  ok(src.split(phrase).length - 1 === 3, "the founder's phrase is used in the payout explainer, Earnings note and support reply (3)");
  ok(!/Materials (reimbursement )?and tips are 100% yours/.test(src), "materials are no longer called 100% yours like tips");
  ok(/Reimbursement repays what you spent; it isn't extra earnings\./.test(src), "Help says reimbursement is repayment, not earnings");
  ok(!/reimbursed (to you )?100%|100% of approved cost|no platform fee|\(Haven \$0\)|reimbursement added, job continues/.test(src), "engineering-style phrases are gone");
  ok(/you're paid the \$\$\{INSPECTION_VISIT_FEE\} inspection fee/.test(src) && /you're paid a \$\$\{CONVENIENCE_FEE\} convenience fee\. Haven keeps nothing either way\./.test(src), "declined-materials Help answer uses the existing fee constants");
  ok(/Customer declined materials, so the job couldn't be finished\. You're paid a \$\$\{conv\} convenience fee\./.test(src), "declined toast (backend path) is plain and keeps the backend amount");
  ok(/Materials approved for \$\{currentJob\.title\}\. Buy them, then add your receipt to be reimbursed\./.test(src), "approved toast (backend path) is plain");
  ok(/convenience_fee_cents : CONVENIENCE_FEE \* 100/.test(src) && /inspection_fee_cents : Math\.round/.test(src), "fee calculations untouched");
  console.log("OK: materials wording checks passed (" + passed + " assertions).");
} catch (e) { console.error("FAIL:", e.message); process.exit(1); }
