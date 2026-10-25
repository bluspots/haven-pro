#!/usr/bin/env node
"use strict";

/**
 * Pro 0029 UI rules (Hub FE-04, FE-05, FE-07; founder 2026-10-24 §4).
 *
 * FE-05 (corrected by the founder 2026-10-24 23:50 ET): the receipt limit comes
 *   ONLY from the authoritative server record, materials_approved_cents (0025),
 *   minus materials_reimbursed_cents. materials_estimate_cents and the job status
 *   are never treated as an approved amount.
 *   - Known limit: shown; an amount above it can't be submitted.
 *   - Missing (before 0025: 42703; or null), or the read fails: submission is
 *     blocked with a clear message and Retry; the entered details stay.
 * FE-04: Start Diagnosis only for an eligible diagnosis job after arrival
 *   (button and the action itself).
 * FE-07: fees are never described as paid (covered in materials_wording_check;
 *   checked again here on the built page).
 *
 * Local fixtures only. The server enforces the real rules (0029); this checks the UI.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const PRO_ID = "cccccccc-dddd-4eee-8fff-0000000000f5";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-0000000000f5";

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; console.log("  ✓ " + msg); }
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function json(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }; }
const MISSING = () => ({ ok: false, status: 400, json: async () => ({}), text: async () => '{"code":"42703","message":"column jobs.materials_approved_cents does not exist"}' });

// ── Adapter units ────────────────────────────────────────────────────────────
function loadAdapter(fetchImpl) {
  const session = { access_token: "tok", user: { id: PRO_ID, email: "pro@example.com", user_metadata: { role: "pro" } } };
  const store = {};
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, atob,
    window: { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
      supabase: { createClient() { return { auth: { async getSession() { return { data: { session }, error: null }; }, async getUser() { return { data: { user: session.user }, error: null }; }, onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } } }; } } },
    fetch: fetchImpl, URL, encodeURIComponent, Date, JSON, Math, Array, Object, String, Number, Error, Promise, Set, Map,
    INSPECTION_VISIT_FEE: 45, CONVENIENCE_FEE: 30, ACTIVE_BLOCK_STATUSES: new Set(["en_route", "arrived", "diagnosing", "materials_requested", "materials_approved", "in_progress"]),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("backend_adapter.js") + "\n;globalThis.__api = { materialsCapFromRow, fetchMaterialsReimbursementCap };", sandbox);
  return sandbox.__api;
}
async function unitChecks() {
  console.log("FE-05 cap (adapter):");
  const { materialsCapFromRow: cap } = loadAdapter(async () => json(200, []));
  let c = cap({ materials_approved_cents: 5000, materials_reimbursed_cents: 1200, materials_estimate_cents: 9999 });
  ok(c.status === "known" && c.maxCents === 3800, "authoritative approved total minus what's already reimbursed (estimate ignored)");
  ok(cap({ materials_approved_cents: 1000, materials_reimbursed_cents: 1500 }).maxCents === 0, "never a negative limit");
  ok(cap({ status: "materials_approved", materials_approved_cents: null, materials_estimate_cents: 2500 }).status === "unavailable", "an estimate is never treated as approved, even in materials_approved");
  ok(cap(null).status === "unavailable", "no row → unavailable");

  const hits = [];
  const api = loadAdapter(async (url) => { hits.push(String(url)); return MISSING(); });
  c = await api.fetchMaterialsReimbursementCap(JOB);
  ok(c.status === "unavailable" && hits.length === 1 && /pro_id=eq\./.test(hits[0]) && !/materials_estimate_cents/.test(hits[0]), "before 0025 (42703): unavailable, one read scoped to this Pro, no estimate fallback");
  const api2 = loadAdapter(async () => json(500, { message: "boom" }));
  ok((await api2.fetchMaterialsReimbursementCap(JOB)).status === "failed", "a failed read → failed (not a limit)");
  const api3 = loadAdapter(async () => { throw new Error("offline"); });
  ok((await api3.fetchMaterialsReimbursementCap(JOB)).status === "failed", "a network error → failed");
}

// ── App checks (jsdom, built prototype) ──────────────────────────────────────
async function renderApp(rows, route) {
  const { JSDOM, VirtualConsole } = require("jsdom");
  const babel = require("@babel/core");
  const React = require("react");
  const ReactDOMClient = require("react-dom/client");
  let ReactDOMLegacy = {};
  try { ReactDOMLegacy = require("react-dom"); } catch (e) { ReactDOMLegacy = {}; }
  const dom = new JSDOM(read("prototype-pro.html"), { url: "https://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const { window } = dom;
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.cancelAnimationFrame = window.cancelAnimationFrame || (id => clearTimeout(id));
  window.localStorage.clear();
  const calls = [];
  const profile = { id: PRO_ID, role: "pro", display_name: "Test Pro", email: "pro@example.com", first_name: "Test", last_name: "Pro", home_city: "Orlando, FL",
    work_categories: ["Plumbing"], operating_lat: 28.5, operating_lng: -81.3,
    pro_workspace: { onboardingStatus: "completed", onboardingStep: "done", firstName: "Test", lastName: "Pro", homeCity: "Orlando, FL", travelRadius: 25, workCategories: ["Plumbing"] } };
  window.fetch = async (url, init) => {
    url = String(url); init = init || {};
    calls.push({ url, method: init.method || "GET", body: init.body || null });
    if (url.endsWith("/auth/v1/health")) return json(200, {});
    if (url.includes("/rpc/is_qa_tester")) return json(200, false);
    if (url.includes("/rest/v1/profiles")) return json(200, [profile]);
    if (/\/rest\/v1\/jobs\?pro_id=eq\..*status=in\./.test(url)) return json(200, rows);
    const r = route ? route(url, init) : null;
    return r || json(200, []);
  };
  const session = { access_token: "tok", user: { id: PRO_ID, email: "pro@example.com", user_metadata: { role: "pro" } } };
  window.supabase = { createClient() { return { auth: { async getSession() { return { data: { session }, error: null }; }, async getUser() { return { data: { user: session.user }, error: null }; }, onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, async signOut() { return { error: null }; } } }; } };
  const ReactDOM = Object.assign({}, ReactDOMLegacy, ReactDOMClient);
  window.React = React; window.ReactDOM = ReactDOM;
  global.window = window; global.document = window.document; global.React = React; global.ReactDOM = ReactDOM;
  const src = window.document.querySelector('script[type="text/babel"]').textContent || "";
  window.eval(babel.transformSync(src, { filename: "p.jsx", babelrc: false, configFile: false,
    presets: [[require.resolve("@babel/preset-env"), { targets: { node: "current" } }], [require.resolve("@babel/preset-react"), { runtime: "classic" }]] }).code);
  return { window, calls };
}
const rootText = w => Array.from(w.document.querySelectorAll("#root *")).filter(e => e.children.length === 0 && e.tagName !== "STYLE").map(e => e.textContent).join(" ");
const leafText = w => Array.from(w.document.querySelectorAll("#root *")).filter(e => e.children.length === 0 && e.tagName !== "STYLE").map(e => e.textContent).join(" ");
async function waitFor(w, pred, label) { for (let i = 0; i < 200; i++) { await sleep(25); if (pred(w)) return; } throw new Error("timed out: " + label + "\n" + leafText(w).slice(0, 900)); }
function clickText(w, re) {
  const el = Array.from(w.document.querySelectorAll("#root *")).filter(e => e.children.length === 0 && re.test((e.textContent || "").trim())).pop();
  if (!el) throw new Error("no element " + re + "\n" + rootText(w).slice(0, 500));
  el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
}
function button(w, re) { return Array.from(w.document.querySelectorAll("button")).find(b => re.test((b.textContent || "").trim())); }
function setInput(w, el, value) {
  const setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  const key = Object.keys(el).find(k => k.startsWith("__reactProps$"));
  const onChange = key && el[key] && el[key].onChange;
  if (typeof onChange !== "function") throw new Error("no onChange on input");
  onChange({ target: el, currentTarget: el });
}
const row = (o) => Object.assign({ id: JOB, pro_id: PRO_ID, category: "Plumbing", title: "Replace faucet (fixture)", requires_diagnosis: false, inspection_fee_cents: 0,
  fixed_pro_labor_payout_cents: 6500, city_label: "Orlando", lat: 28.5, lng: -81.3, accepted_at: new Date().toISOString(), posted_at: new Date().toISOString(),
  materials_reimbursed_cents: 0 }, o);

async function openJob(rows, route) {
  const app = await renderApp(rows, route);
  const w = app.window;
  await waitFor(w, x => rootText(x).includes("My Jobs"), "signed in");
  await sleep(250);
  clickText(w, /My Jobs$/); await sleep(150);
  clickText(w, /Replace faucet|AC not cooling/); await sleep(200);
  return app;
}

function attachPhoto(w) {
  const file = w.document.querySelector('input[type="file"]');
  Object.defineProperty(file, "files", { configurable: true, value: [new w.File(["receipt"], "receipt.png", { type: "image/png" })] });
  const fkey = Object.keys(file).find(k => k.startsWith("__reactProps$"));
  file[fkey].onChange({ target: file, currentTarget: file });
}
function forceSubmit(w) {
  const submit = button(w, /^Submit Receipt$/);
  const key = Object.keys(submit).find(k => k.startsWith("__reactProps$"));
  return submit[key].onClick();
}
const patches = calls => calls.filter(c => c.method === "PATCH" && /\/rest\/v1\/jobs/.test(c.url));
// Server fixture: `cap` is what the authoritative read returns; it can change between reads (Retry).
function capRoute(state) {
  return (url, init) => {
    if (/select=id,materials_approved_cents,materials_reimbursed_cents/.test(url)) return state.cap();
    if (/select=id,status$/.test(url)) return json(200, [{ id: JOB, status: "materials_approved" }]);
    if ((init.method || "GET") === "PATCH") return json(200, [{ id: JOB, status: "in_progress", pro_id: PRO_ID }]);
    return null;
  };
}
async function receiptChecks() {
  console.log("FE-05 receipt screen (app):");
  // Known limit: $50 approved − $12 already reimbursed = $38.
  {
    const state = { cap: () => json(200, [{ id: JOB, materials_approved_cents: 5000, materials_reimbursed_cents: 1200 }]) };
    const { window: w, calls } = await openJob([row({ status: "materials_approved", materials_reimbursed_cents: 1200 })], capRoute(state));
    try {
      button(w, /^Submit Receipt$/).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await waitFor(w, x => /Customer approved: up to \$38\b/.test(rootText(x)), "known cap");
      ok(true, "known: 'Customer approved: up to $38' (authoritative total minus already reimbursed)");
      attachPhoto(w); await waitFor(w, x => !!x.document.querySelector('img[alt="Receipt"]'), "photo attached");
      const input = w.document.querySelector('input[inputmode="decimal"]');
      setInput(w, input, "40"); await sleep(50);
      const over = w.document.querySelector('[data-testid="receipt-over"]');
      ok(over && /^That's more than the \$38 the customer approved\. Enter \$38 or less\.$/.test(over.textContent) && button(w, /^Submit Receipt$/).disabled, "over the limit: clear message and Submit disabled");
      await forceSubmit(w); await sleep(150);
      ok(patches(calls).length === 0, "over the limit: the action itself sends nothing");
      setInput(w, input, "20"); await sleep(50);
      ok(!button(w, /^Submit Receipt$/).disabled && !w.document.querySelector('[data-testid="receipt-over"]'), "within the limit: Submit enabled");
      button(w, /^Submit Receipt$/).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await waitFor(w, () => patches(calls).length > 0, "receipt PATCH");
      ok(JSON.parse(patches(calls).pop().body).materials_reimbursed_cents === 3200, "within the limit: the receipt is sent ($12 + $20 recorded)");
    } finally { w.close(); }
  }
  // Missing cap (before 0025, 42703): blocked with Retry; Retry after the record exists unblocks; details kept.
  {
    const state = { cap: () => MISSING() };
    const { window: w, calls } = await openJob([row({ status: "materials_approved" })], capRoute(state));
    try {
      button(w, /^Submit Receipt$/).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await waitFor(w, x => x.document.querySelector('[data-cap-status="unavailable"]'), "unavailable");
      ok(/The customer-approved amount isn't available yet, so this receipt can't be submitted\. Your details are saved here\. Tap Retry later\./.test(rootText(w)) && !/up to \$/.test(rootText(w)), "missing: honest message, no amount shown or assumed");
      attachPhoto(w); await waitFor(w, x => !!x.document.querySelector('img[alt="Receipt"]'), "photo attached");
      const input = w.document.querySelector('input[inputmode="decimal"]');
      setInput(w, input, "20"); await sleep(50);
      ok(button(w, /^Submit Receipt$/).disabled && !!button(w, /^Retry$/), "missing: Submit disabled, Retry offered");
      await forceSubmit(w); await sleep(150);
      ok(patches(calls).length === 0, "missing: the action itself sends nothing (fails safely)");
      state.cap = () => json(200, [{ id: JOB, materials_approved_cents: 2500, materials_reimbursed_cents: 0 }]);
      button(w, /^Retry$/).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await waitFor(w, x => /Customer approved: up to \$25\b/.test(rootText(x)), "retry known");
      ok(input.value === "20" && !!w.document.querySelector('img[alt="Receipt"]') && !button(w, /^Submit Receipt$/).disabled, "Retry: limit confirmed; entered amount and photo kept; Submit enabled");
    } finally { w.close(); }
  }
  // Approved amount null (no authoritative record yet): unavailable, never the estimate.
  {
    const state = { cap: () => json(200, [{ id: JOB, materials_approved_cents: null, materials_reimbursed_cents: 0 }]) };
    const { window: w, calls } = await openJob([row({ status: "materials_approved", materials_estimate_cents: 2500 })], capRoute(state));
    try {
      button(w, /^Submit Receipt$/).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await waitFor(w, x => x.document.querySelector('[data-cap-status="unavailable"]'), "null cap");
      ok(!/\$25/.test(rootText(w)) && button(w, /^Submit Receipt$/).disabled, "null approved amount: unavailable; the $25 estimate is never shown as approved");
      ok(calls.every(c => !/materials_estimate_cents/.test(c.url)), "the estimate is never read for the limit");
    } finally { w.close(); }
  }
  // Failed fetch: blocked with Retry; Retry recovers.
  {
    let n = 0;
    const state = { cap: () => (n++ === 0 ? json(503, { message: "unavailable" }) : json(200, [{ id: JOB, materials_approved_cents: 3000, materials_reimbursed_cents: 0 }])) };
    const { window: w, calls } = await openJob([row({ status: "materials_approved" })], capRoute(state));
    try {
      button(w, /^Submit Receipt$/).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await waitFor(w, x => x.document.querySelector('[data-cap-status="failed"]'), "failed");
      ok(/Couldn't check the amount the customer approved, so this receipt can't be submitted yet\./.test(rootText(w)) && button(w, /^Submit Receipt$/).disabled && !!button(w, /^Retry$/), "failed fetch: clear message, Submit disabled, Retry offered");
      await forceSubmit(w); await sleep(150);
      ok(patches(calls).length === 0, "failed fetch: nothing sent");
      button(w, /^Retry$/).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
      await waitFor(w, x => /Customer approved: up to \$30\b/.test(rootText(x)), "retry after failure");
      ok(true, "Retry after a failed fetch reads the limit again ($30)");
    } finally { w.close(); }
  }
}

async function diagnosisChecks() {
  console.log("FE-04 Start Diagnosis (app):");
  {
    const { window: w } = await openJob([row({ status: "arrived", requires_diagnosis: true, category: "HVAC", title: "AC not cooling (fixture)", inspection_fee_cents: 4500 })]);
    ok(!!button(w, /^Start Diagnosis$/), "arrived diagnosis job: Start Diagnosis shown");
    w.close();
  }
  {
    const { window: w } = await openJob([row({ status: "arrived", requires_diagnosis: false })]);
    ok(!button(w, /^Start Diagnosis$/) && !!button(w, /^Start Job$/), "arrived standard job: Start Job only");
    w.close();
  }
  {
    const { window: w } = await openJob([row({ status: "en_route", requires_diagnosis: true, category: "HVAC", title: "AC not cooling (fixture)", inspection_fee_cents: 4500 })]);
    ok(!button(w, /^Start Diagnosis$/), "en route (not arrived): no Start Diagnosis");
    w.close();
  }
  const jsx = read("home_services_pro_app.jsx");
  const fn = jsx.slice(jsx.indexOf("async function startDiagnosis(jobId) {"), jsx.indexOf("async function startWork(jobId) {"));
  ok(/current\.status !== "arrived" \|\| !jobRequiresDiagnosis\(current\)\) return;/.test(fn), "startDiagnosis itself refuses ineligible or not-arrived jobs");
}

function copyChecks() {
  console.log("FE-07 wording (built page):");
  for (const f of ["prototype-pro.html", "index.html"]) {
    const html = read(f);
    ok(!/You're paid a \$|you're paid (the|a) \$/.test(html), f + ": no fee described as paid");
    ok(!/it can differ from the estimate/.test(html) && !/Your materials will be reimbursed in full\. You can keep/.test(html), f + ": receipt copy no longer contradicts the limit or promises payment");
  }
}

(async () => {
  await unitChecks();
  await receiptChecks();
  await diagnosisChecks();
  copyChecks();
  console.log(`OK: Pro 0029 UI rules checks passed (${pass} assertions).`);
  process.exit(0);
})().catch(e => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
