#!/usr/bin/env node
"use strict";
/**
 * Pro Job Earnings Statement document (founder requirements):
 * matches Customer receipts' document system; earnings, tips and materials
 * reimbursement are separate; consistent currency; no fabricated statement
 * numbers, payment confirmations or email-delivery status; amounts come
 * from jobAmount() (no pay calculation changed).
 */
const fs = require("fs"), path = require("path"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "home_services_pro_app.jsx"), "utf8");
const helpers = fs.readFileSync(path.join(__dirname, "..", "pure_helpers.js"), "utf8");
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed++; console.log("  ✓ " + m); };
try {
  const body = src.slice(src.indexOf("function earningsStatementBody(job)"), src.indexOf("function statementShareText(job)"));
  const screen = src.slice(src.indexOf("function earningsStatementScreen(jobId)"), src.indexOf("function earningsScreen("));
  ok(/HAVEN<\/div>/.test(body) && /EARNINGS STATEMENT/.test(body) && /borderBottom: `2px solid \$\{STMT\.tx\}`/.test(body), "Haven document header like Customer receipts (wordmark, title, heavy rule)");
  ok(/const STMT = \{ paper: "#FFFFFF"/.test(src) && !/(^|[^A-Z])T\.(w|tx|ts|tm|bd)\b/.test(body), "always a light document, independent of dark mode (like Customer receipts)");
  ok(/const earnings = a\.gross \+ a\.tip;/.test(body) && /Total earnings/.test(body), "Total earnings = labor or fee + tip (reimbursement excluded)");
  ok(/MATERIALS REIMBURSEMENT/.test(body) && /It isn't earnings/.test(body) && /stmtMoney\(a\.net\)/.test(body), "materials reimbursement is its own section, labelled as repayment, with the combined total from jobAmount");
  ok(/function jobAmount\(job\)[\s\S]*const net = gross \+ materials \+ tip;/.test(helpers), "jobAmount() unchanged (no pay calculation changed)");
  ok(/const stmtMoney = n => "\$" \+ \(Math\.round\(\(Number\(n\) \|\| 0\) \* 100\) \/ 100\)\.toFixed\(2\);/.test(src) && !/`\$\$\{a\./.test(body), "every amount uses one currency format ($0.00)");
  ok(!/Statement \{statement|stmt_\$\{/.test(body) && /\/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\/i/.test(src), "no invented statement number; a job reference only for a real backend id");
  ok(!/\bPaid\b|PAID/.test(body), "nothing is labelled Paid (no payment confirmation exists)");
  ok(!/Emailed to you|Email Again/.test(screen), "no simulated 'Emailed to you' status on the statement screen");
  console.log("OK: statement document checks passed (" + passed + " assertions).");
} catch (e) { console.error("FAIL:", e.message); process.exit(1); }
