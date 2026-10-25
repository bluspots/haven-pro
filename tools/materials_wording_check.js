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
  // Founder 2026-10-24 23:50 ET: describe the reimbursement policy (up to the customer-approved
  // amount) without implying money has been paid.
  const phrase = "Tips are 100% yours. Materials you buy for an approved request are reimbursed up to the amount the customer approved. Payments aren't processed in the app yet.";
  ok(src.split(phrase).length - 1 === 3, "the reimbursement policy phrase is used in the payout explainer, Earnings note and support reply (3)");
  ok(!/reimbursed in full|reimbursed the full amount|You're reimbursed/.test(src), "no 'reimbursed in full' promises");
  ok(!/Haven keeps nothing/.test(src), "no unproven 'Haven keeps nothing' claim");
  ok(!/Materials (reimbursement )?and tips are 100% yours/.test(src), "materials are no longer called 100% yours like tips");
  ok(/Reimbursement repays what you spent; it isn't extra earnings\./.test(src), "Help says reimbursement is repayment, not earnings");
  ok(!/reimbursed (to you )?100%|100% of approved cost|no platform fee|\(Haven \$0\)|reimbursement added, job continues/.test(src), "engineering-style phrases are gone");
  // FE-07 (founder 2026-10-24): fees are never described as paid while payments don't exist.
  ok(/the \$\$\{INSPECTION_VISIT_FEE\} inspection fee applies/.test(src) && /a \$\$\{CONVENIENCE_FEE\} convenience fee applies\. Payments aren't processed in the app yet\./.test(src), "declined-materials Help answer uses the existing fee constants and says fees apply (not paid)");
  ok(/Customer declined materials, so the job couldn't be finished\. A \$\$\{conv\} convenience fee applies\. Payments aren't processed in the app yet\./.test(src), "declined toast (backend path) is plain, keeps the backend amount, and doesn't say paid");
  ok(!/You're paid a \$|you're paid (the|a) \$/.test(src), "no 'you're paid' fee wording anywhere");
  ok(/Materials approved for \$\{currentJob\.title\}\. Buy them, then add your receipt to be reimbursed\./.test(src), "approved toast (backend path) is plain");
  ok(/convenience_fee_cents : CONVENIENCE_FEE \* 100/.test(src) && /inspection_fee_cents : Math\.round/.test(src), "fee calculations untouched");
  console.log("OK: materials wording checks passed (" + passed + " assertions).");
} catch (e) { console.error("FAIL:", e.message); process.exit(1); }
