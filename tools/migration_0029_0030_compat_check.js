#!/usr/bin/env node
"use strict";

/**
 * Pro compatibility with planned backend migrations 0029 and 0030
 * (Hub contract backend/contracts/frontend-requirements-2026-10-23.md FE-01, FE-08;
 *  tracker PRO-B30, PRO-S29, PRO-P29).
 *
 * PRO-B30 (before 0030): the job board needs only the server's distance_mi.
 *   Board rows never keep exact lat/lng in app state, even while the RPC still
 *   sends them. After accepting, the exact point comes only from the
 *   get_assigned_job_destination RPC (MAP-05 / 0030, live 2026-11-05): never
 *   the board row, the claim row or a jobs table read.
 * PRO-S29 (before 0029): the terminal sync never sends fee fields; it skips the
 *   PATCH when the server already shows the terminal status, and after an
 *   unconfirmed write it re-reads the server status.
 * PRO-P29 (before 0029): the active-job poll includes diagnosing, so a customer
 *   ending the job at inspection_completed from diagnosing is seen.
 *
 * Local test fixtures only (fake fetch + fake Supabase auth). Not production data.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const PRO_ID = "cccccccc-dddd-4eee-8fff-000000000b30";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-0000000000b3";
const OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-0000000000b4";
const TOKEN = "pro-access-token";

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; console.log("  ✓ " + msg); }
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function json(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }; }

// ── Adapter unit checks (vm sandbox) ─────────────────────────────────────────
function loadAdapter(fetchImpl) {
  const session = { access_token: TOKEN, user: { id: PRO_ID, email: "pro@example.com", user_metadata: { role: "pro" } } };
  const store = {};
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, atob,
    window: {
      localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
      supabase: { createClient() { return { auth: {
        async getSession() { return { data: { session }, error: null }; },
        async getUser() { return { data: { user: session.user }, error: null }; },
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      } }; } },
    },
    fetch: fetchImpl, URL, encodeURIComponent, Date, JSON, Math, Array, Object, String, Number, Error, Promise, Set, Map,
    INSPECTION_VISIT_FEE: 45, CONVENIENCE_FEE: 30,
    ACTIVE_BLOCK_STATUSES: new Set(["en_route", "arrived", "diagnosing", "materials_requested", "materials_approved", "in_progress"]),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const names = ["fetchPostedJobsFromSupabase", "claimJobOnSupabase", "fetchAssignedJobDestination", "bestEffortPatchTerminalStatus"];
  vm.runInContext(read("backend_adapter.js") + "\n;globalThis.__api = { " + names.join(", ") + " };", sandbox, { filename: "backend_adapter.js" });
  return sandbox.__api;
}
function recorder(route) {
  const hits = [];
  const fetchImpl = async (url, init) => {
    const hit = { url: String(url), method: (init && init.method) || "GET", body: init && init.body ? JSON.parse(init.body) : null };
    hits.push(hit);
    return route(hit);
  };
  return { hits, fetchImpl };
}
const boardRow = (o) => Object.assign({ id: JOB, status: "posted", pro_id: null, category: "Plumbing", title: "Fix leaking faucet",
  fixed_pro_labor_payout_cents: 6500, requires_diagnosis: false, emergency: false, posted_at: new Date().toISOString(),
  inspection_fee_cents: 0, city_label: "Orlando" }, o);

async function adapterChecks() {
  console.log("PRO-B30 board (adapter):");
  {
    const { fetchImpl } = recorder(() => json(200, [
      boardRow({ distance_mi: 2.5 }),                                   // 0030 shape: no lat/lng
      boardRow({ id: OTHER, distance_mi: 4, lat: 28.6, lng: -81.2 }),   // pre-0030 shape: lat/lng present
      boardRow({ id: "aaaaaaaa-aaaa-4aaa-8aaa-0000000000b5", lat: 28.6, lng: -81.2 }), // no server distance
    ]));
    const api = loadAdapter(fetchImpl);
    const jobs = await api.fetchPostedJobsFromSupabase();
    ok(jobs.length === 2 && jobs[0].id === JOB, "a row with distance_mi but no lat/lng is shown on the board");
    ok(jobs[0].distanceMi === 2.5 && jobs[0].city === "Orlando", "board job keeps the server distance and city");
    ok(jobs.every(j => j.lat === null && j.lng === null), "board jobs never keep exact lat/lng, even when the RPC sends them");
    ok(!jobs.some(j => j.id === "aaaaaaaa-aaaa-4aaa-8aaa-0000000000b5"), "a row without a server distance is not shown (no client-side distance)");
  }
  console.log("PRO-B30 assigned location (adapter):");
  {
    const { hits, fetchImpl } = recorder(h => h.url.includes("/rpc/get_assigned_job_destination")
      ? json(200, { ok: true, job_id: JOB, status: "en_route", destination: { lat: 28.538336, lng: -81.379234, source: "stored_job_point" }, address: { line: null, unit: null, access_notes: null }, city_label: "Orlando, FL" })
      : json(200, [{ id: JOB, status: "en_route", pro_id: PRO_ID, lat: 10.5, lng: 20.5, city_label: "Orlando" }]));
    const api = loadAdapter(fetchImpl);
    const claim = await api.claimJobOnSupabase({ id: JOB });
    ok(claim.ok, "claim still succeeds");
    hits.length = 0;
    const d = await api.fetchAssignedJobDestination(JOB);
    ok(d.state === "ok" && d.point.lat === 28.538336 && d.point.lng === -81.379234 && hits.length === 1 && hits[0].method === "POST" && /\/rpc\/get_assigned_job_destination$/.test(hits[0].url),
      "the exact point comes only from get_assigned_job_destination (one POST; never the claim row)");
  }

  console.log("PRO-S29 terminal sync (adapter):");
  {
    const { hits, fetchImpl } = recorder(() => json(200, []));
    const api = loadAdapter(fetchImpl);
    const r = await api.bestEffortPatchTerminalStatus({ id: JOB, backendClaimed: true, inspectionFee: 45 }, "inspection_completed", { backendStatus: "inspection_completed", backendRow: { id: JOB, inspection_fee_cents: 4500 } });
    ok(r.ok && r.skipped && hits.length === 0, "server already shows the terminal status → no PATCH");
  }
  for (const status of ["inspection_completed", "materials_declined"]) {
    const { hits, fetchImpl } = recorder(h => json(200, [{ id: JOB, status: h.body ? h.body.status : "x", inspection_fee_cents: 0, convenience_fee_cents: 3000 }]));
    const api = loadAdapter(fetchImpl);
    const r = await api.bestEffortPatchTerminalStatus({ id: JOB, backendClaimed: true, inspectionFee: 45, convenienceFee: 30 }, status);
    const patch = hits.find(h => h.method === "PATCH");
    ok(r.ok && patch && JSON.stringify(Object.keys(patch.body)) === '["status"]' && patch.body.status === status, status + ": PATCH body is { status } only (no fee fields)");
    ok(r.row && r.row.id === JOB, status + ": the server row is returned so its fee values are recorded");
  }
  {
    // 0029 rejects (42501); the server already shows the terminal status → done.
    const { hits, fetchImpl } = recorder(h => h.method === "PATCH" ? json(403, { code: "42501" }) : json(200, [{ id: JOB, status: "inspection_completed" }]));
    const api = loadAdapter(fetchImpl);
    const r = await api.bestEffortPatchTerminalStatus({ id: JOB, backendClaimed: true }, "inspection_completed");
    ok(r.ok && r.reloaded && hits.length === 2 && hits[1].method === "GET", "rejected write → re-read; server shows the status → done");
  }
  {
    const { fetchImpl } = recorder(h => h.method === "PATCH" ? json(403, { code: "42501" }) : json(200, [{ id: JOB, status: "diagnosing" }]));
    const api = loadAdapter(fetchImpl);
    const r = await api.bestEffortPatchTerminalStatus({ id: JOB, backendClaimed: true }, "inspection_completed");
    ok(!r.ok && r.serverStatus === "diagnosing", "rejected write and the server disagrees → not finished (job stays active)");
  }
  {
    const { hits, fetchImpl } = recorder(() => json(200, []));
    const api = loadAdapter(fetchImpl);
    const r = await api.bestEffortPatchTerminalStatus({ id: JOB, backendClaimed: true }, "complete");
    ok(!r.ok && hits.length === 0, "only the two decline terminals go through this sync");
  }
}

// ── App checks (jsdom, built prototype-pro.html) ─────────────────────────────
function profileRow() {
  return {
    id: PRO_ID, role: "pro", display_name: "Test Pro", email: "pro@example.com", first_name: "Test", last_name: "Pro",
    home_city: "Orlando, FL", work_categories: ["Plumbing", "Electrical", "HVAC", "Appliance"], operating_lat: 28.5, operating_lng: -81.3,
    pro_workspace: {
      onboardingStatus: "completed", onboardingStep: "done", firstName: "Test", lastName: "Pro", homeCity: "Orlando, FL",
      travelRadius: 25, workCategories: ["Plumbing", "Electrical", "HVAC", "Appliance"],
      identityVerification: { provider: "persona", status: "verified" }, backgroundCheck: { provider: "checkr", status: "clear" },
      payoutAccount: { provider: "stripe_connect", status: "enabled", payoutsEnabled: true }, taxProfile: { status: "verified" },
    },
  };
}
async function renderApp(route) {
  const { JSDOM, VirtualConsole } = require("jsdom");
  const babel = require("@babel/core");
  const React = require("react");
  const ReactDOMClient = require("react-dom/client");
  let ReactDOMLegacy = {};
  try { ReactDOMLegacy = require("react-dom"); } catch (e) { ReactDOMLegacy = {}; }
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(read("prototype-pro.html"), { url: "https://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.cancelAnimationFrame = window.cancelAnimationFrame || (id => clearTimeout(id));
  window.localStorage.clear();
  const calls = [];
  const row = profileRow();
  window.fetch = async (url, init) => {
    url = String(url); init = init || {};
    const call = { url, method: init.method || "GET", body: init.body || null };
    calls.push(call);
    if (url.endsWith("/auth/v1/health")) return json(200, {});
    if (url.includes("/rpc/is_qa_tester")) return json(200, true);
    if (url.includes("/rest/v1/profiles")) return json(200, [row]);
    const r = route(call);
    return r || json(200, []);
  };
  const session = { access_token: TOKEN, user: { id: PRO_ID, email: "pro@example.com", user_metadata: { role: "pro" } } };
  window.supabase = { createClient() { return { auth: {
    async getSession() { return { data: { session }, error: null }; },
    async getUser() { return { data: { user: session.user }, error: null }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    async signOut() { return { error: null }; },
  } }; } };
  const ReactDOM = Object.assign({}, ReactDOMLegacy, ReactDOMClient);
  window.React = React; window.ReactDOM = ReactDOM;
  global.window = window; global.document = window.document; global.React = React; global.ReactDOM = ReactDOM;
  const src = window.document.querySelector('script[type="text/babel"]').textContent || "";
  const code = babel.transformSync(src, { filename: "prototype-inline.jsx", babelrc: false, configFile: false,
    presets: [[require.resolve("@babel/preset-env"), { targets: { node: "current" } }], [require.resolve("@babel/preset-react"), { runtime: "classic" }]] }).code;
  window.eval(code);
  return { window, calls };
}
const rootText = w => (w.document.getElementById("root").textContent || "");
async function waitFor(w, pred, label, tries) {
  for (let i = 0; i < (tries || 200); i++) { await sleep(25); if (pred(rootText(w))) return; }
  throw new Error("timed out: " + label + "\n" + rootText(w).slice(0, 700));
}
function button(w, re) { return Array.from(w.document.querySelectorAll("button")).find(b => re.test((b.textContent || "").trim())); }
function mapsHref(w) { const a = Array.from(w.document.querySelectorAll("a")).find(x => /google\.com\/maps|maps\.apple\.com/.test(x.href)); return a ? a.href : ""; }

async function boardAndAcceptCheck(rpcBody, label) {
  const { window: w, calls } = await renderApp(c => {
    if (c.url.includes("/rpc/jobs_posted_within_radius")) {
      // Coordinates on the board row on purpose: they must never be used.
      return json(200, [boardRow({ distance_mi: 2.5, lat: 10.111, lng: 20.222 })]);
    }
    // ...nor the claim row's.
    if (c.url.includes("/rpc/pro_claim_job")) return json(200, [{ id: JOB, status: "en_route", pro_id: PRO_ID, city_label: "Orlando", lat: 30.333, lng: -80.444 }]);
    if (c.url.includes("/rpc/get_assigned_job_destination")) return json(200, rpcBody);
    return null;
  });
  try {
    await waitFor(w, t => t.includes("Fix leaking faucet") && t.includes("Orlando · 2.5 mi"), "board shows the job by city and server distance");
    ok(true, label + ": board card shows the city and the server distance");
    const accept = button(w, /^Accept Job$/);
    ok(!!accept, label + ": board job is acceptable without client-side coordinates");
    accept.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    // Shipped flag on: map panel buttons; flag off: the plain panel. Either way the en-route view.
    await waitFor(w, t => /Open in Maps|Get Directions|Open in Apple Maps|Google Maps directions|Open in Google Maps|city only/.test(t), "en-route view");
    await sleep(50);
    return { w, calls, href: decodeURIComponent(mapsHref(w)) };
  } catch (e) { w.close(); throw e; }
}

async function appChecks() {
  console.log("PRO-B30 accept flow (app):");
  {
    const { w, calls, href } = await boardAndAcceptCheck({ ok: true, job_id: JOB, status: "en_route", destination: { lat: 28.538336, lng: -81.379234, source: "stored_job_point" }, address: { line: null, unit: null, access_notes: null }, city_label: "Orlando, FL" }, "RPC has the point");
    ok(calls.filter(c => c.url.includes("/rpc/get_assigned_job_destination")).length === 1, "one destination lookup after the claim");
    ok(href.includes("28.538336,-81.379234"), "Open in Maps uses the RPC's exact point");
    ok(!href.includes("10.111") && !href.includes("20.222") && !href.includes("30.333"), "the board row's and the claim row's coordinates are never used");
    w.close();
  }
  {
    const { w, href } = await boardAndAcceptCheck({ ok: false, error: "no_coordinates", city_label: "Orlando, FL" }, "no point from the RPC");
    ok(!/\d+\.\d+,-?\d+\.\d+/.test(href) && !href.includes("30.333"), "no exact point from the RPC → city-only search, nothing invented");
    w.close();
  }

  console.log("PRO-P29 + PRO-S29 diagnosing poll (app):");
  {
    let ended = false;
    const { window: w, calls } = await renderApp(c => {
      if (c.url.includes("status=in.(")) {
        return json(200, [{ id: JOB, status: "diagnosing", pro_id: PRO_ID, category: "HVAC", title: "AC not cooling", requires_diagnosis: true,
          inspection_fee_cents: 4500, fixed_pro_labor_payout_cents: 9000, city_label: "Orlando", lat: 28.54, lng: -81.38,
          accepted_at: new Date().toISOString(), posted_at: new Date().toISOString(), distance_mi: null }]);
      }
      if (c.url.includes("select=id,status,inspection_fee_cents")) {
        return json(200, [{ id: JOB, status: ended ? "inspection_completed" : "diagnosing", inspection_fee_cents: 4500, convenience_fee_cents: 0, materials_reimbursed_cents: 0 }]);
      }
      return null;
    });
    try {
      await waitFor(w, () => calls.some(c => c.url.includes("select=id,status,inspection_fee_cents")), "diagnosing job is polled");
      ok(true, "a backend job in diagnosing is polled");
      ended = true; // the customer ends the job at inspection
      await waitFor(w, t => /Inspection Completed/.test(t), "Pro sees the customer's end-at-inspection", 400);
      ok(true, "the Pro sees the customer ending the job from diagnosing");
      ok(!calls.some(c => c.method === "PATCH" && c.url.includes("/rest/v1/jobs")), "no PATCH is sent: the server already shows inspection_completed");
      ok(/\$45/.test(rootText(w)), "the recorded inspection fee is the server's value ($45)");
    } finally { w.close(); }
  }
}

function sourceChecks() {
  console.log("Source checks:");
  const adapter = read("backend_adapter.js");
  const jsx = read("home_services_pro_app.jsx");
  const sync = adapter.slice(adapter.indexOf("async function bestEffortPatchTerminalStatus"), adapter.indexOf("async function resolveHavenJobWriteAuth"));
  ok(!/inspection_fee_cents|convenience_fee_cents/.test(sync), "terminal sync never names a fee column");
  ok(!/row\.lat != null && row\.lng != null && row\.distance_mi/.test(adapter), "board no longer requires lat/lng");
  ok(/clean\.map\(mapBoardRowToJob\)/.test(adapter), "board rows go through the coordinate-free mapper");
  ok(/j\.status === "diagnosing" \|\| j\.status === "materials_requested" \|\| j\.status === "materials_approved"/.test(jsx), "active-job poll includes diagnosing");
  for (const built of ["prototype-pro.html", "index.html"]) {
    const html = read(built);
    ok(/mapBoardRowToJob/.test(html) && /get_assigned_job_destination/.test(html) && !/resolveAssignedJobLocation/.test(html), built + " is rebuilt with these changes");
  }
}

(async () => {
  await adapterChecks();
  await appChecks();
  sourceChecks();
  console.log(`OK: 0029/0030 compatibility checks passed (${pass} assertions).`);
  process.exit(0);
})().catch(e => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
