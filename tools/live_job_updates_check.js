#!/usr/bin/env node
"use strict";

/**
 * Live job updates (founder approved 2026-11-11, draft): realtime job signal,
 * MIG-0036 contract v1 (supabase/contracts/REALTIME_JOB_SIGNAL_CONTRACT.md on
 * Customer PR #97, head 4df74734).
 *
 *  U.  job_signal.js units (topic, payload, debounce, join order, retry,
 *      account switch, sign-out, wake-ups, nothing logged).
 *  R.  pro_live_updates.js: server data replaces stale local status; a newer
 *      local step and jobs being finished here are kept; poll-owned statuses
 *      are left to the 5 s poll unless the server said "removed"; SIM jobs are
 *      untouched; removed copy per status; a failed read changes nothing.
 *  1.  After sign-in: setAuth() before a private channel on jobs:user:<id>,
 *      event job_changed; SUBSCRIBED re-reads the active jobs.
 *  2.  Debounce: several signals → exactly one active-jobs read.
 *  3.  Founder cancel while the job screen is open → "This job was
 *      cancelled.", back to My Jobs, live location watch stopped.
 *  4.  Founder release → "This job was reassigned…".
 *  5.  Missed broadcast: coming back to the foreground re-reads and removes
 *      the job with the generic copy; a failed read keeps the job.
 *  6.  The board re-reads after the Pro's own signal and on foreground.
 *  7.  Sign-out removes the channel; nothing re-reads afterwards.
 * fetch and Realtime are mocked. A mock is never certification: Quagon
 * certifies against the real backend once 0036 is applied.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const PRO_ID = "cccccccc-dddd-4eee-8fff-0000000000b6";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-0000000000b6";
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } }
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function json(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }; }

function reconcileUnits() {
  console.log("R. pro_live_updates.js:");
  const sb = { Map, Set, Array, String, Object };
  sb.globalThis = sb; vm.createContext(sb);
  vm.runInContext(read("pro_live_updates.js") + "\n;globalThis.__r = { havenReconcileProActiveJobs, havenProRemovedJobMessage, havenProViewIsForJob };", sb);
  const R = sb.__r;
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001", B = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002", C = "aaaaaaaa-aaaa-4aaa-8aaa-000000000003";
  const local = [
    { id: A, status: "en_route", backendClaimed: true, jobNotes: "gate code", title: "A" },
    { id: B, status: "arrived", backendClaimed: true, title: "B" },
    { id: "sim-1", status: "en_route", backendClaimed: false, title: "SIM" },
  ];
  ok(R.havenReconcileProActiveJobs(local, null, {}) === null, "a failed read (no rows) changes nothing");
  const r1 = R.havenReconcileProActiveJobs(local, [{ id: A, status: "arrived", backendClaimed: true, title: "A" }, { id: C, status: "en_route", backendClaimed: true, title: "C" }], { startedAt: 100, signals: new Map([[B, { status: "cancelled", reason: "removed" }]]) });
  const a = r1.jobs.find(j => j.id === A);
  ok(a.status === "arrived" && a.jobNotes === "gate code", "stale local status is replaced by the server's; local-only notes stay");
  ok(r1.added.length === 1 && r1.added[0] === C && r1.jobs.some(j => j.id === C), "a job the server newly lists (e.g. reassigned to this Pro) is added");
  ok(r1.removed.length === 1 && r1.removed[0].job.id === B && r1.removed[0].message === "This job was cancelled.", "a job the server no longer lists leaves, with the copy for its status");
  ok(r1.jobs.some(j => j.id === "sim-1"), "SIM / not server-claimed jobs are never touched by a server read");
  const r2 = R.havenReconcileProActiveJobs(local, [{ id: A, status: "en_route", backendClaimed: true }], { startedAt: 100, lastLocalChange: { [B]: 150 } });
  ok(r2.removed.length === 0 && r2.jobs.some(j => j.id === B), "a job this app changed after the read started is kept (no flicker)");
  const r3 = R.havenReconcileProActiveJobs([{ id: A, status: "en_route", backendClaimed: true }], [{ id: A, status: "en_route" }], { startedAt: 100, lastLocalChange: { [A]: 150 } });
  ok(r3.jobs[0].status === "en_route", "…and a newer local status is not walked back");
  const r3b = R.havenReconcileProActiveJobs([{ id: A, status: "arrived", backendClaimed: true }], [{ id: A, status: "en_route" }], { startedAt: 100, lastLocalChange: { [A]: 150 } });
  ok(r3b.jobs[0].status === "arrived", "a local step written after the read started wins over the older read");
  const r4 = R.havenReconcileProActiveJobs([{ id: A, status: "in_progress", backendClaimed: true }], [], { startedAt: 100, busyIds: new Set([A]) });
  ok(r4.removed.length === 0, "a job this app is completing right now is not 'removed'");
  const r5 = R.havenReconcileProActiveJobs([{ id: A, status: "diagnosing", backendClaimed: true }], [], { startedAt: 100 });
  ok(r5.removed.length === 0 && r5.jobs.length === 1, "diagnosing / materials jobs are left to the 5 s poll (it records the Customer's ending)");
  const r6 = R.havenReconcileProActiveJobs([{ id: A, status: "materials_requested", backendClaimed: true }], [], { startedAt: 100, signals: new Map([[A, { status: "cancelled", reason: "removed" }]]) });
  ok(r6.removed.length === 1, "…unless the server said the job was removed (founder cancel)");
  ok(R.havenProRemovedJobMessage("cancelled") === "This job was cancelled."
    && R.havenProRemovedJobMessage("posted") === "This job was reassigned. You're no longer on it."
    && R.havenProRemovedJobMessage(null) === "This job is no longer assigned to you.", "removed copy: cancelled / reassigned / unknown");
  ok(R.havenProViewIsForJob({ view: "detail", jobId: A }, A) && !R.havenProViewIsForJob({ view: "list" }, A), "view matcher");
}

async function renderApp(opts) {
  const { JSDOM, VirtualConsole } = require("jsdom");
  const babel = require("@babel/core");
  const React = require("react");
  const ReactDOMClient = require("react-dom/client");
  let ReactDOMLegacy = {};
  try { ReactDOMLegacy = require("react-dom"); } catch (e) { ReactDOMLegacy = {}; }
  const html = read("prototype-pro.html");
  const dom = new JSDOM(html, { url: "https://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const { window } = dom;
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.cancelAnimationFrame = window.cancelAnimationFrame || (id => clearTimeout(id));
  window.localStorage.clear();
  const geo = { watches: 0, cleared: 0 };
  Object.defineProperty(window.navigator, "geolocation", { configurable: true, value: {
    watchPosition() { geo.watches++; return geo.watches; }, clearWatch() { geo.cleared++; }, getCurrentPosition() {},
  } });
  const calls = [];
  const state = { rows: opts.rows, activeFail: false };
  const profile = { id: PRO_ID, role: "pro", display_name: "Test Pro", email: "pro@example.com", first_name: "Test", last_name: "Pro", home_city: "Orlando, FL",
    work_categories: ["Plumbing"], operating_lat: 28.5, operating_lng: -81.3,
    pro_workspace: { onboardingStatus: "completed", onboardingStep: "done", firstName: "Test", lastName: "Pro", homeCity: "Orlando, FL", travelRadius: 25, workCategories: ["Plumbing"] } };
  window.fetch = async (url, init) => {
    url = String(url); init = init || {};
    calls.push({ url, method: init.method || "GET" });
    if (url.endsWith("/auth/v1/health")) return json(200, {});
    if (url.includes("/rpc/is_qa_tester")) return json(200, false);
    if (url.includes("/rest/v1/profiles")) return json(200, [profile]);
    if (url.includes("/rpc/jobs_posted_within_radius")) return json(200, []);
    if (url.includes("/rpc/get_assigned_job_destination")) return json(200, { ok: false, error: "no_coordinates", city_label: "Orlando, FL" });
    if (/\/rest\/v1\/jobs\?pro_id=eq\..*status=in\./.test(url)) {
      if (state.activeFail) return json(500, { message: "down" });
      return json(200, state.rows);
    }
    return json(200, []);
  };
  const rt = { log: [], chans: [] };
  let authCb = null;
  const session = { access_token: "tok", user: { id: PRO_ID, email: "pro@example.com", user_metadata: { role: "pro" } } };
  let current = session;
  window.supabase = { createClient() { return {
    auth: { async getSession() { return { data: { session: current }, error: null }; }, async getUser() { return { data: { user: current && current.user }, error: null }; },
      onAuthStateChange(cb) { authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; }, async signOut() { current = null; return { error: null }; } },
    realtime: { async setAuth(t) { rt.log.push("setAuth" + (t == null ? "" : ":explicit")); } },
    channel(topic, o) { const ch = { topic, opts: o, handlers: [], subCb: null, removed: false,
      on(type, filter, cb) { this.handlers.push({ type, filter, cb }); return this; },
      subscribe(cb) { this.subCb = cb; rt.log.push("subscribe:" + topic); return this; } };
      rt.chans.push(ch); rt.log.push("channel:" + topic); return ch; },
    async removeChannel(ch) { ch.removed = true; rt.log.push("remove:" + ch.topic); return "ok"; },
  }; } };
  const ReactDOM = Object.assign({}, ReactDOMLegacy, ReactDOMClient);
  window.React = React; window.ReactDOM = ReactDOM;
  global.window = window; global.document = window.document; global.React = React; global.ReactDOM = ReactDOM;
  const src = window.document.querySelector('script[type="text/babel"]').textContent || "";
  window.eval(babel.transformSync(src, { filename: "p.jsx", babelrc: false, configFile: false,
    presets: [[require.resolve("@babel/preset-env"), { targets: { node: "current" } }], [require.resolve("@babel/preset-react"), { runtime: "classic" }]] }).code);
  const live = () => rt.chans.filter(c => !c.removed).pop();
  return { window, calls, state, rt, geo, live,
    emit(payload) { const ch = live(); ch.handlers.forEach(h => h.cb({ type: "broadcast", event: "job_changed", payload })); },
    subscribed() { const ch = live(); ch.subCb && ch.subCb("SUBSCRIBED"); },
    signOut() { current = null; authCb && authCb("SIGNED_OUT", null); },
  };
}
const leaf = w => Array.from(w.document.querySelectorAll("#root *")).filter(e => e.children.length === 0 && e.tagName !== "STYLE").map(e => e.textContent).join(" ");
async function waitFor(w, pred, label, tries) { for (let i = 0; i < (tries || 200); i++) { await sleep(25); if (pred(w)) return true; } ok(false, "timed out: " + label + " | " + leaf(w).slice(0, 300)); return false; }
function clickText(w, re) {
  const el = Array.from(w.document.querySelectorAll("#root *")).filter(e => e.children.length === 0 && re.test((e.textContent || "").trim())).pop();
  if (!el) { ok(false, "no element " + re); return; }
  el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
}
const activeReads = calls => calls.filter(c => /\/rest\/v1\/jobs\?pro_id=eq\..*status=in\./.test(c.url)).length;
const boardReads = calls => calls.filter(c => c.url.includes("/rpc/jobs_posted_within_radius")).length;
const row = (o) => Object.assign({ id: JOB, status: "en_route", pro_id: PRO_ID, category: "Plumbing", title: "Fix leaking faucet (fixture)", requires_diagnosis: false,
  inspection_fee_cents: 0, fixed_pro_labor_payout_cents: 6500, city_label: "Orlando, FL", accepted_at: new Date().toISOString(), posted_at: new Date().toISOString() }, o);
const sig = (status, reason) => ({ v: 1, id: "m" + Math.random(), job_id: JOB, status, reason, at: new Date().toISOString() });
async function start(rows) {
  const app = await renderApp({ rows });
  await waitFor(app.window, x => leaf(x).includes("My Jobs"), "signed in");
  await waitFor(app.window, () => !!app.live(), "channel joined");
  await sleep(200);
  return app;
}
async function openJob(app) {
  clickText(app.window, /My Jobs$/); await sleep(150);
  clickText(app.window, /Fix leaking faucet/); await sleep(200);
}
const onDetail = w => /I've Arrived|Arrived|Navigate|Open in/.test(leaf(w)) && /Fix leaking faucet/.test(leaf(w));

async function appChecks() {
  console.log("1. Subscribe after sign-in:");
  {
    const app = await start([row()]);
    const i1 = app.rt.log.indexOf("setAuth"), i2 = app.rt.log.indexOf("channel:jobs:user:" + PRO_ID);
    ok(i1 >= 0 && i2 > i1 && !app.rt.log.includes("setAuth:explicit"), "setAuth() (session JWT) is awaited before the channel is created");
    const ch = app.live();
    ok(ch.topic === "jobs:user:" + PRO_ID && ch.opts.config.private === true && ch.handlers.some(h => h.type === "broadcast" && h.filter.event === "job_changed"), "private channel jobs:user:<own id>, broadcast job_changed");
    let before = activeReads(app.calls);
    app.subscribed(); await sleep(600);
    ok(activeReads(app.calls) === before + 1, "SUBSCRIBED → one active-jobs re-read");

    console.log("2. Debounce:");
    before = activeReads(app.calls);
    app.emit(sig("en_route", "updated")); await sleep(100);
    app.emit(sig("en_route", "updated")); await sleep(100);
    app.emit(sig("en_route", "updated")); await sleep(150);
    ok(activeReads(app.calls) === before, "no re-read inside the debounce window");
    await sleep(500);
    ok(activeReads(app.calls) === before + 1, "3 signals → exactly one re-read");

    console.log("3. Founder cancel while the job screen is open:");
    await openJob(app);
    ok(onDetail(app.window), "job screen open");
    const watchesBefore = app.geo.watches;
    ok(watchesBefore >= 1, "live location is being watched for the en_route job");
    app.state.rows = [];
    app.emit(sig("cancelled", "removed"));
    await waitFor(app.window, x => /This job was cancelled\./.test(leaf(x)), "cancel toast");
    ok(/This job was cancelled\. \(Fix leaking faucet \(fixture\)\)/.test(leaf(app.window)), '"This job was cancelled." (with the job title)');
    ok(!onDetail(app.window), "the app left the job screen");
    await sleep(300);
    ok(app.geo.cleared >= 1, "the location watch was stopped (no more sending for that job)");
    ok(!/I've Arrived/.test(leaf(app.window)), "no Arrived action is left for the job");

    console.log("6. Board re-reads after the Pro's own signal and on foreground:");
    clickText(app.window, /^Home$/); await sleep(300);
    let b0 = boardReads(app.calls);
    app.emit({ v: 1, id: "x", job_id: "aaaaaaaa-aaaa-4aaa-8aaa-0000000000ff", status: "posted", reason: "removed", at: new Date().toISOString() });
    await sleep(700);
    ok(boardReads(app.calls) >= b0 + 1, "a job_changed signal refreshes the open board");
    b0 = boardReads(app.calls);
    app.window.document.dispatchEvent(new app.window.Event("visibilitychange"));
    await sleep(700);
    ok(boardReads(app.calls) >= b0 + 1, "coming back to the foreground refreshes the board");

    console.log("7. Sign-out:");
    const ch2 = app.live();
    app.signOut(); await sleep(400);
    ok(ch2.removed && app.rt.log[app.rt.log.length - 1] === "remove:jobs:user:" + PRO_ID, "sign-out removes the channel");
    const r0 = activeReads(app.calls);
    app.window.dispatchEvent(new app.window.Event("online")); await sleep(700);
    ok(activeReads(app.calls) === r0, "signed out: wake-ups don't read jobs");
    app.window.close();
  }
  console.log("4. Founder release:");
  {
    const app = await start([row()]);
    await openJob(app);
    app.state.rows = [];
    app.emit(sig("posted", "removed"));
    await waitFor(app.window, x => /This job was reassigned\. You're no longer on it\./.test(leaf(x)), "release toast");
    ok(!onDetail(app.window), "release: back to My Jobs");
    app.window.close();
  }
  console.log("5. Missed broadcast / failed read:");
  {
    const app = await start([row()]);
    await openJob(app);
    app.state.activeFail = true;
    app.window.document.dispatchEvent(new app.window.Event("visibilitychange"));
    await sleep(700);
    ok(onDetail(app.window) && !/no longer assigned/.test(leaf(app.window)), "a failed read keeps the job on screen");
    app.state.activeFail = false;
    app.state.rows = [];
    app.window.dispatchEvent(new app.window.Event("online"));
    await waitFor(app.window, x => /This job is no longer assigned to you\./.test(leaf(x)), "generic removed toast");
    ok(!onDetail(app.window), "no broadcast at all: back online re-reads and the job leaves with the generic copy");
    app.window.close();
  }
  console.log("Shipped pages:");
  for (const f of ["index.html", "prototype-pro.html"]) {
    const html = read(f);
    ok(/jobs:user:/.test(html) && /job_changed/.test(html) && /private:\s*(true|!0)/.test(html), f + ": joins the private per-user topic");
    ok(!/broadcast:\s*\{\s*self/.test(html), f + ": no broadcast self/ack/replay config");
  }
  ok(/"job_signal\.js" "pro_live_updates\.js"/.test(read("build-pro.sh")), "job_signal.js and pro_live_updates.js are part of the build");
}

(async () => {
  console.log("U. job_signal.js units:");
  await require("./job_signal_unit.js")(read("job_signal.js"), ok);
  reconcileUnits();
  await appChecks();
  console.log(`\n--- Live job updates (Pro): ${pass} passing, ${fail} failing ---`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
