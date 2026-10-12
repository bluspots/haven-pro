#!/usr/bin/env node
"use strict";
/**
 * Verification and payout steps (Pro, HB-13). No identity, background-check,
 * payout or tax provider is connected, so:
 * (1) no made-up provider ids (persona_demo_…, checkr_demo_…, acct_demo_…,
 *     tax_demo_…) and no invented bank digits, anywhere;
 * (2) for ordinary Pros every step reads "Not available yet" with a plain
 *     explanation, instead of provider-looking "Pending"/"Processing" states;
 *     credentials can't be sent for a verification that doesn't exist;
 * (3) QA testers (server-confirmed) keep the steps so the QA tools work;
 * (4) readiness gating is unchanged (still the five real conditions);
 * (5) the Background Check rows show ✅ only when the check is clear (PRO-02).
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const root = path.resolve(__dirname, "..");
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
const jsx = fs.readFileSync(path.join(root, "home_services_pro_app.jsx"), "utf8");
const built = fs.readFileSync(path.join(root, "prototype-pro.html"), "utf8");

// (1)
for (const [name, src] of [["source", jsx], ["built page", built]]) {
  ok(!/_demo_\$\{|persona_demo_|checkr_demo_|acct_demo_|tax_demo_/.test(src), name + ": no made-up provider ids");
}
const provider = jsx.slice(jsx.indexOf("function startIdentityVerification()"), jsx.indexOf("function openEditProfile()"));
ok(!/Math\.random/.test(provider), "verification, payout and tax code uses no random values (no invented ids or bank digits)");
ok(/last4: v\.last4 \|\| null, \/\/ never invent bank digits/.test(provider) && /last4: pa\.last4 \|\| null \}/.test(provider), "QA payout tools never invent bank digits");
// (2)
ok(/const HAVEN_PROVIDER_CHECKS_CONNECTED = false;/.test(jsx), "providers are flagged as not connected");
ok(/const shownStatus = status => \(providerStepsOpen \? status : "not_available"\);/.test(jsx) && /not_available: "Not available yet"/.test(jsx), 'ordinary Pros see "Not available yet"');
ok((jsx.match(/const status = shownStatus\((identityVerification|backgroundCheck|payoutAccount)\.status\);/g) || []).length === 6, "identity, background and payout screens (profile + onboarding) all use the shown status");
ok((jsx.match(/\{status === "not_available" && notAvailableNote\(\)\}/g) || []).length === 6 && (jsx.match(/shownStatus\(taxProfile\.status\) === "not_available" && notAvailableNote\(\)/g) || []).length === 2, "every step explains why it isn't available");
ok(/This step isn't available yet\. Haven will open it once its verification and payout partners are connected\. Until then, accepting jobs stays locked\./.test(jsx), "the explanation is plain and says jobs stay locked");
ok(/showToast\(providerStepsOpen \? "Saved — waiting on tax verification" : "Saved on this device\. Tax verification isn't available yet\."\)/.test(jsx) && !/Submitted to tax provider for verification/.test(jsx), "saving tax details no longer claims it was submitted to a provider");
ok(/\{providerStepsOpen && \["self_reported", "verification_available"\]\.includes\(c\.status\) && <button onClick=\{\(\) => verifyProfessionalCredential/.test(jsx), "credentials can't be sent to a verification that doesn't exist");
ok(/"Accepting jobs opens once verification and payouts are available\."/.test(jsx) && /"Verification Not Available Yet"/.test(jsx), "accepting a job explains why it's locked");
// (3)
ok(/const qaSession = !!\(qaTester && authSession && authSession\.id && accountSourceRef\.current === "auth"\);/.test(jsx) && /const providerStepsOpen = HAVEN_PROVIDER_CHECKS_CONNECTED \|\| qaSession;/.test(jsx), "server-confirmed QA testers keep the steps");
// (4)
ok(/const mandatoryFlags = \[profileComplete, identityVerified, backgroundApproved, payoutEnabled, taxComplete\];/.test(jsx) && /const identityVerified = identityVerification\.status === "verified";/.test(jsx), "readiness gating is unchanged");
// (5) PRO-02: the Background Check rows show a success mark only when the check is clear
ok(!/navRow\("✅", "Background Check"/.test(jsx) && (jsx.match(/navRow\(backgroundCheckIcon\(\), "Background Check"/g) || []).length === 2, "Background Check rows no longer hard-code ✅");
ok(/function backgroundCheckIcon\(\) \{\s*return shownStatus\(backgroundCheck\.status\) === "clear" \? "✅" : "🛡️";/.test(jsx), "✅ only when the shown status is clear; otherwise 🛡️");
console.log(`OK: verification/payout availability checks passed (${pass} assertions).`);
