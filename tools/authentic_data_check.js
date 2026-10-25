#!/usr/bin/env node
"use strict";
/**
 * Authentic data (Pro). Nothing invented is shown as real.
 * (1) HB-02: completing a job never invents a tip; a completed job carries
 *     tip 0 / "notAdded" until the backend records a real tip.
 * (2) HB-04: no canned replies attributed to the customer. Messaging isn't
 *     connected, so the thread says so and has no send box.
 * (3) The job board starts empty and fills only from the backend (no sample
 *     jobs shown first).
 * Checked on the built prototype-pro.html as well as the source.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const root = path.resolve(__dirname, "..");
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
const jsx = fs.readFileSync(path.join(root, "home_services_pro_app.jsx"), "utf8");
const built = fs.readFileSync(path.join(root, "prototype-pro.html"), "utf8");

// (1)
const fin = jsx.slice(jsx.indexOf("async function finalizeJob("), jsx.indexOf("const record = {", jsx.indexOf("async function finalizeJob(")));
ok(/const tipAmount = 0;/.test(fin) && !/Math\.random/.test(fin), "finalizeJob sets no tip and uses no random numbers");
ok(/tipAmount, tipStatus: tipAmount > 0 \? "paid" : "notAdded",/.test(jsx), "so every completed job records tipStatus notAdded");
// (2)
ok(!/Sounds good, thank you!|Perfect, I'll be home\.|Got it, thanks for the update\./.test(jsx), "the canned customer replies are gone");
ok(!/from: "customer"/.test(jsx), "nothing in the app writes a message as if the customer sent it");
ok(!/function sendCustomerMessage\(/.test(jsx) && /const CUSTOMER_MESSAGING_CONNECTED = false;/.test(jsx), "no fake send; messaging is flagged as not connected");
const thread = jsx.slice(jsx.indexOf("function messageThreadScreen(jobId) {"), jsx.indexOf("function messagesListScreen() {"));
ok(!/chatInputBar\(/.test(thread) && /role="status"/.test(thread) && /Messaging customers isn't available yet, so messages can't be sent or received here\./.test(thread), "the thread has no send box and says plainly that messaging isn't available");
ok(/will appear here once messaging is available/.test(thread) && !/Say hello/.test(jsx), "empty thread and list rows don't invite a message that can't be sent");
// (3)
ok(/const \[availableJobs, setAvailableJobs\] = useState\(\[\]\);/.test(jsx), "the job board starts empty (no sample jobs before the real list loads)");
// built page
for (const s of ['const tipAmount = 0;', "const CUSTOMER_MESSAGING_CONNECTED = false;", "Messaging customers isn't available yet"]) ok(built.includes(s), "built page includes: " + s);
ok(!built.includes("Sounds good, thank you!"), "built page has no canned replies");
console.log(`OK: authentic data checks passed (${pass} assertions).`);
