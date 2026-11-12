#!/usr/bin/env node
"use strict";

/**
 * MAP-05 / Pro #71: accepted-job destination + map, wired to the live
 * get_assigned_job_destination RPC (contract backend/contracts/mapbox-assigned-destination-0030.md;
 * 0027 + 0030 live 2026-11-05).
 *
 * Covers the brief's test list:
 *  1. ok:true → the point equals `destination` exactly (6 dp); pin, Apple and Google URLs use it.
 *  2. Each error code, 401, 403 and a network error → its message, no point, no Apple button.
 *  3. No session → no RPC call.
 *  4. Non-active statuses → not eligible (no call); pruning drops stored points.
 *  5. A status change between active steps fetches again; leaving the active set and
 *     sign-out clear the point.
 *  6. Board rows and table (select=*) / claim rows with lat/lng are never the point.
 *  7. The arrival gate works with the RPC point and stays locked without one.
 *  8. No RPC or Mapbox request at startup.
 *  9. HAVEN_ASSIGNED_JOB_MAP_ENABLED is true in the source and both built pages (founder 2026-11-06).
 * 10. The shipped bundle contains no service-role key.
 *
 * fetch is mocked here (local fixtures, public landmark coordinates). A mocked
 * response is never certification: Quagon certifies against the real backend.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const PRO_ID = "cccccccc-dddd-4eee-8fff-0000000000a5";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-0000000000a5";
const POINT = { lat: 28.538336, lng: -81.379234 }; // fixture: Orlando City Hall (public landmark)
const OK_BODY = { ok: true, job_id: JOB, status: "en_route", destination: { lat: POINT.lat, lng: POINT.lng, source: "stored_job_point" },
  address: { line: null, unit: null, access_notes: null }, city_label: "Orlando, FL", accepted_at: "2026-11-01T19:00:00Z" };

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; console.log("  ✓ " + msg); }
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function json(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }; }
const MESSAGES = {
  not_authenticated: "Sign in again to see the job location.",
  not_found: "This job is no longer assigned to you.",
  status_not_active: "Navigation is closed for this job.",
  no_coordinates: "Exact location not available yet.",
  network: "Couldn't load the location.",
};

// ── Units ────────────────────────────────────────────────────────────────────
function loadAdapter(fetchImpl, withSession) {
  const session = withSession ? { access_token: "tok", user: { id: PRO_ID, email: "pro@example.com", user_metadata: { role: "pro" } } } : null;
  const store = {};
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, atob,
    window: { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
      supabase: { createClient() { return { auth: { async getSession() { return { data: { session }, error: null }; }, async getUser() { return { data: { user: session && session.user }, error: null }; }, onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } } }; } } },
    fetch: fetchImpl, URL, encodeURIComponent, Date, JSON, Math, Array, Object, String, Number, Error, Promise, Set, Map,
    INSPECTION_VISIT_FEE: 45, CONVENIENCE_FEE: 30, ACTIVE_BLOCK_STATUSES: new Set(["en_route", "arrived", "diagnosing", "materials_requested", "materials_approved", "in_progress"]),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("backend_adapter.js") + "\n;globalThis.__api = { fetchAssignedJobDestination, normaliseAssignedDestination, mapSupabaseRowToJob };", sandbox);
  return sandbox.__api;
}
function loadMaps() {
  const sandbox = { encodeURIComponent, Number, Math, String, Set, Object, navigator: { onLine: true } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext('const HAVEN_MAPBOX_PUBLIC_TOKEN = "pk.test-token";\n' + read("pro_maps.js") +
    "\n;globalThis.__m = { havenAssignedJobPoint, havenStaticMapUrl, havenAppleMapsUrl, havenDestinationMessage, havenCityOnlyLinkLabel, havenDestinationEligible, havenPruneDestinations, HAVEN_ASSIGNED_JOB_MAP_ENABLED };", sandbox);
  return sandbox.__m;
}
async function unitChecks() {
  console.log("Destination lookup (adapter):");
  {
    const hits = [];
    const api = loadAdapter(async (url, init) => { hits.push({ url: String(url), init }); return json(200, OK_BODY); }, true);
    const d = await api.fetchAssignedJobDestination(JOB);
    ok(d.state === "ok" && d.point.lat === POINT.lat && d.point.lng === POINT.lng, "1. ok:true → the point equals destination exactly");
    const h = hits[0];
    ok(hits.length === 1 && h.init.method === "POST" && /\/rest\/v1\/rpc\/get_assigned_job_destination$/.test(h.url)
      && JSON.parse(h.init.body).p_job_id === JOB && /^Bearer tok$/.test(h.init.headers.Authorization) && h.init.headers.apikey && h.init.headers["Content-Type"] === "application/json",
      "one POST to the RPC with the session JWT, apikey and { p_job_id }");
    ok(d.address.line === null && d.address.unit === null && d.address.access_notes === null, "address fields stay null when the server sends null (nothing guessed)");
  }
  for (const code of ["not_authenticated", "not_found", "status_not_active", "no_coordinates"]) {
    const api = loadAdapter(async () => json(200, Object.assign({ ok: false, error: code }, code === "no_coordinates" ? { city_label: "Orlando, FL" } : code === "status_not_active" ? { status: "complete" } : {})), true);
    const d = await api.fetchAssignedJobDestination(JOB);
    ok(d.state === "error" && d.error === code && !d.point, "2. " + code + " → error, no point");
  }
  for (const status of [401, 403]) {
    const api = loadAdapter(async () => json(status, { message: "permission denied" }), true);
    const d = await api.fetchAssignedJobDestination(JOB);
    ok(d.state === "error" && d.error === "not_authenticated" && !d.point, "2. HTTP " + status + " → not_authenticated, no point");
  }
  {
    const api = loadAdapter(async () => { throw new Error("offline"); }, true);
    ok((await api.fetchAssignedJobDestination(JOB)).error === "network", "2. network error → network, no point");
    const api2 = loadAdapter(async () => json(500, {}), true);
    ok((await api2.fetchAssignedJobDestination(JOB)).error === "network", "2. other HTTP error → network");
    const api3 = loadAdapter(async () => json(200, { ok: true, destination: { lat: null, lng: null } }), true);
    ok((await api3.fetchAssignedJobDestination(JOB)).error === "no_coordinates", "ok:true without numbers is never treated as a point");
  }
  {
    let calls = 0;
    const api = loadAdapter(async () => { calls++; return json(200, OK_BODY); }, false);
    const d = await api.fetchAssignedJobDestination(JOB);
    ok(calls === 0 && d.error === "not_authenticated", "3. no session → no RPC call");
  }
  {
    const api = loadAdapter(async () => json(200, []), true);
    const j = api.mapSupabaseRowToJob({ id: JOB, status: "en_route", lat: 10.5, lng: 20.5, city_label: "Orlando" });
    ok(j.lat === null && j.lng === null, "6. a select=* / board row with lat/lng never carries them into the app");
  }

  console.log("Map helpers (pro_maps.js):");
  const m = loadMaps();
  ok(m.HAVEN_ASSIGNED_JOB_MAP_ENABLED === true, "9. the flag is true in the source");
  const p = m.havenAssignedJobPoint({ state: "ok", point: POINT });
  const pin = m.havenStaticMapUrl(p, false);
  ok(/pin-l\+0f6e4e\(-81\.379234,28\.538336\)\/-81\.379234,28\.538336,15,0\/600x300@2x/.test(pin) && !/path-|geojson|polyline/.test(pin), "1. the pin uses the exact point (6 dp); no route overlay");
  ok(m.havenAppleMapsUrl(p) === "https://maps.apple.com/?daddr=28.538336,-81.379234&dirflg=d", "1. Apple Maps uses the exact point (6 dp)");
  ok(m.havenAssignedJobPoint({ state: "error", error: "no_coordinates" }) === null && m.havenAssignedJobPoint(null) === null, "no point from any error or missing entry");
  for (const [code, text] of Object.entries(MESSAGES)) ok(m.havenDestinationMessage({ state: "error", error: code }).text === text, "message for " + code);
  ok(m.havenDestinationMessage({ state: "loading" }).text === "Loading location…" && m.havenDestinationMessage({ state: "error", error: "network" }).retry === true, "loading message; only network offers Try again");
  ok(/city only, not the job location/.test(m.havenCityOnlyLinkLabel("Orlando, FL")), "the city link is labelled city-only");
  const base = { id: JOB, backendClaimed: true };
  ok(["en_route", "arrived", "diagnosing", "materials_requested", "materials_approved", "in_progress"].every(s => m.havenDestinationEligible({ ...base, status: s }, true)), "active statuses are eligible");
  ok(["posted", "complete", "cancelled", "inspection_completed", "materials_declined"].every(s => !m.havenDestinationEligible({ ...base, status: s }, true)), "4. non-active statuses are never eligible (no call)");
  ok(!m.havenDestinationEligible({ id: JOB, status: "en_route" }, true) && !m.havenDestinationEligible({ id: "sim-1", status: "en_route", backendClaimed: true }, true) && !m.havenDestinationEligible({ ...base, status: "en_route" }, false), "SIM/demo or unassigned jobs, or no backend, are never eligible");
  const entries = { [JOB]: { key: JOB + ":en_route", state: "ok", point: POINT } };
  ok(Object.keys(m.havenPruneDestinations(entries, [{ ...base, status: "complete" }], true)).length === 0, "4/5. a job that left the active set loses its stored point");
  ok(Object.keys(m.havenPruneDestinations(entries, [], true)).length === 0, "5. no active jobs (e.g. signed out) → no stored points");
  ok(m.havenPruneDestinations(entries, [{ ...base, status: "arrived" }], true) === entries, "an active job keeps its entry");
}

// ── App (jsdom) ──────────────────────────────────────────────────────────────
async function renderApp({ flag, rows, rpc, geo }) {
  const { JSDOM, VirtualConsole } = require("jsdom");
  const babel = require("@babel/core");
  const React = require("react");
  const ReactDOMClient = require("react-dom/client");
  let ReactDOMLegacy = {};
  try { ReactDOMLegacy = require("react-dom"); } catch (e) { ReactDOMLegacy = {}; }
  let html = read("prototype-pro.html");
  // Shipped pages have the flag on; the flag-off regression suite forces it off.
  if (!flag) { const forced = html.replace("const HAVEN_ASSIGNED_JOB_MAP_ENABLED = true;", "const HAVEN_ASSIGNED_JOB_MAP_ENABLED = false;"); if (forced === html) throw new Error("flag-off build: shipped flag line not found"); html = forced; }
  const dom = new JSDOM(html, { url: "https://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const { window } = dom;
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.cancelAnimationFrame = window.cancelAnimationFrame || (id => clearTimeout(id));
  window.localStorage.clear();
  if (geo) {
    const watchers = [];
    Object.defineProperty(window.navigator, "geolocation", { configurable: true, value: {
      watchPosition(success) { watchers.push(success); setTimeout(() => success({ coords: { latitude: geo.lat, longitude: geo.lng } }), 5); return watchers.length; },
      clearWatch() {}, getCurrentPosition(success) { success({ coords: { latitude: geo.lat, longitude: geo.lng } }); },
    } });
  }
  const calls = [];
  const state = { rows };
  const profile = { id: PRO_ID, role: "pro", display_name: "Test Pro", email: "pro@example.com", first_name: "Test", last_name: "Pro", home_city: "Orlando, FL",
    work_categories: ["Plumbing"], operating_lat: 28.5, operating_lng: -81.3,
    pro_workspace: { onboardingStatus: "completed", onboardingStep: "done", firstName: "Test", lastName: "Pro", homeCity: "Orlando, FL", travelRadius: 25, workCategories: ["Plumbing"] } };
  window.fetch = async (url, init) => {
    url = String(url); init = init || {};
    calls.push({ url, method: init.method || "GET", body: init.body || null });
    if (url.endsWith("/auth/v1/health")) return json(200, {});
    if (url.includes("/rpc/is_qa_tester")) return json(200, false);
    if (url.includes("/rest/v1/profiles")) return json(200, [profile]);
    if (url.includes("/rpc/get_assigned_job_destination")) return rpc(calls.filter(c => c.url.includes("/rpc/get_assigned_job_destination")).length);
    if (/\/rest\/v1\/jobs\?pro_id=eq\..*status=in\./.test(url)) return json(200, typeof state.rows === "function" ? state.rows() : state.rows);
    if (/select=id,status$/.test(url)) return json(200, [{ id: JOB, status: "en_route" }]);
    if ((init.method || "GET") === "PATCH" && /\/rest\/v1\/jobs/.test(url)) {
      const body = JSON.parse(init.body || "{}");
      return json(200, [{ id: JOB, status: body.status || "arrived", pro_id: PRO_ID }]);
    }
    return json(200, []);
  };
  const session = { access_token: "tok", user: { id: PRO_ID, email: "pro@example.com", user_metadata: { role: "pro" } } };
  window.supabase = { createClient() { return { auth: { async getSession() { return { data: { session }, error: null }; }, async getUser() { return { data: { user: session.user }, error: null }; }, onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, async signOut() { return { error: null }; } } }; } };
  const ReactDOM = Object.assign({}, ReactDOMLegacy, ReactDOMClient);
  window.React = React; window.ReactDOM = ReactDOM;
  global.window = window; global.document = window.document; global.React = React; global.ReactDOM = ReactDOM;
  const src = window.document.querySelector('script[type="text/babel"]').textContent || "";
  window.eval(babel.transformSync(src, { filename: "p.jsx", babelrc: false, configFile: false,
    presets: [[require.resolve("@babel/preset-env"), { targets: { node: "current" } }], [require.resolve("@babel/preset-react"), { runtime: "classic" }]] }).code);
  return { window, calls, state };
}
const leaf = w => Array.from(w.document.querySelectorAll("#root *")).filter(e => e.children.length === 0 && e.tagName !== "STYLE").map(e => e.textContent).join(" ");
async function waitFor(w, pred, label, tries) { for (let i = 0; i < (tries || 200); i++) { await sleep(25); if (pred(w)) return; } throw new Error("timed out: " + label + "\n" + leaf(w).slice(0, 700)); }
function clickText(w, re) {
  const el = Array.from(w.document.querySelectorAll("#root *")).filter(e => e.children.length === 0 && re.test((e.textContent || "").trim())).pop();
  if (!el) throw new Error("no element " + re + "\n" + leaf(w).slice(0, 500));
  el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
}
const rpcCalls = calls => calls.filter(c => c.url.includes("/rpc/get_assigned_job_destination"));
const mapboxImgs = w => Array.from(w.document.querySelectorAll("img")).filter(i => /api\.mapbox\.com/.test(i.getAttribute("src") || ""));
const links = w => Array.from(w.document.querySelectorAll("a")).map(a => ({ t: a.textContent.trim(), h: decodeURIComponent(a.href) }));
const row = (o) => Object.assign({ id: JOB, status: "en_route", pro_id: PRO_ID, category: "Plumbing", title: "Fix leaking faucet (fixture)", requires_diagnosis: false,
  inspection_fee_cents: 0, fixed_pro_labor_payout_cents: 6500, city_label: "Orlando, FL", lat: 10.101, lng: 20.202, // table coordinates on purpose: never used
  accepted_at: new Date().toISOString(), posted_at: new Date().toISOString() }, o);

async function start(opts) {
  const app = await renderApp(opts);
  const w = app.window;
  await waitFor(w, x => leaf(x).includes("My Jobs"), "signed in");
  await sleep(300);
  app.startupRpc = rpcCalls(app.calls).length;
  app.startupMapbox = mapboxImgs(w).length;
  return app;
}
async function openJob(app) {
  const w = app.window;
  clickText(w, /My Jobs$/); await sleep(150);
  clickText(w, /Fix leaking faucet/); await sleep(200);
}

async function appChecks() {
  console.log("App, flag on (as shipped):");
  {
    const app = await start({ flag: true, rows: [row()], rpc: () => json(200, OK_BODY) });
    const w = app.window;
    ok(app.startupRpc === 0 && app.startupMapbox === 0, "8. no RPC and no Mapbox request at startup (active job restored, screen not open)");
    await openJob(app);
    await waitFor(w, x => mapboxImgs(x).length === 1, "map");
    ok(rpcCalls(app.calls).length === 1, "opening the job screen makes one lookup");
    ok(mapboxImgs(w)[0].getAttribute("src").includes("pin-l+0f6e4e(-81.379234,28.538336)"), "1. the pin is at the RPC point");
    const ls = links(w);
    // Navigate (2026-11-11): with no saved app, the chooser offers each app, all to the RPC point.
    ok(ls.some(l => l.t === "Apple Maps" && l.h === "https://maps.apple.com/?daddr=28.538336,-81.379234&dirflg=d"), "1. Apple Maps → the RPC point");
    ok(ls.some(l => l.t === "Google Maps" && l.h.includes("destination=28.538336,-81.379234")), "1. Google Maps → the RPC point");
    ok(ls.some(l => l.t === "Waze" && l.h.includes("ll=28.538336,-81.379234")), "1. Waze → the RPC point");
    ok(!ls.some(l => /10\.101|20\.202/.test(l.h)) && !mapboxImgs(w)[0].getAttribute("src").includes("10.101"), "6. the table row's lat/lng are never used");
    ok(!w.document.querySelector('[data-testid="assigned-address"]'), "no address line while the server sends null");
    w.close();
  }
  for (const [label, resp, code] of [
    ["not_authenticated", () => json(200, { ok: false, error: "not_authenticated" }), "not_authenticated"],
    ["401", () => json(401, { message: "JWT expired" }), "not_authenticated"],
    ["403", () => json(403, { message: "permission denied" }), "not_authenticated"],
    ["not_found", () => json(200, { ok: false, error: "not_found" }), "not_found"],
    ["status_not_active", () => json(200, { ok: false, error: "status_not_active", status: "complete" }), "status_not_active"],
    ["no_coordinates", () => json(200, { ok: false, error: "no_coordinates", city_label: "Orlando, FL" }), "no_coordinates"],
    ["network", () => { throw new Error("offline"); }, "network"],
  ]) {
    const app = await start({ flag: true, rows: [row()], rpc: resp });
    const w = app.window;
    await openJob(app);
    await waitFor(w, x => !!x.document.querySelector('[data-dest-state="' + code + '"]'), label + " state");
    const ls = links(w);
    ok(leaf(w).includes(MESSAGES[code]) && mapboxImgs(w).length === 0 && !ls.some(l => /Apple Maps/.test(l.t)) && !ls.some(l => /\d+\.\d{3,},-?\d+\.\d{3,}/.test(l.h)),
      "2. " + label + ": '" + MESSAGES[code] + "', no pin, no Apple button, no coordinates");
    ok(ls.every(l => !/Google/.test(l.t) || /city only, not the job location/.test(l.t)), "2. " + label + ": any Google link is labelled city-only");
    if (code === "network") {
      const retry = Array.from(w.document.querySelectorAll("button")).find(b => b.textContent.trim() === "Try again");
      ok(!!retry, "2. network: Try again offered");
      retry.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await sleep(80);
      ok(rpcCalls(app.calls).length === 2, "2. Try again looks the location up again");
    }
    if (code === "not_found") ok(app.calls.filter(c => /status=in\./.test(c.url)).length >= 2, "not_found refreshes the active jobs");
    w.close();
  }

  console.log("App, flag off (forced off for regression):");
  {
    const app = await start({ flag: false, rows: [row()], rpc: () => json(200, OK_BODY), geo: { lat: POINT.lat + 0.0005, lng: POINT.lng } });
    const w = app.window;
    ok(app.startupRpc === 0, "8. no RPC at startup (flag off)");
    await openJob(app);
    await waitFor(w, x => links(x).some(l => l.h.includes("28.538336,-81.379234")), "google link with point");
    ok(!w.document.querySelector('[data-testid="assigned-job-map"]') && mapboxImgs(w).length === 0 && !links(w).some(l => /Apple/.test(l.t)), "no map, no Mapbox image, no Apple button while the flag is off");
    ok(links(w).some(l => /Get Directions/.test(l.t) && l.h.includes("destination=28.538336,-81.379234")), "Google directions use the RPC point (flag off)");
    await waitFor(w, x => Array.from(x.document.querySelectorAll("button")).some(b => b.textContent.trim() === "I've Arrived"), "arrival unlocked");
    ok(true, "7. arrival gate opens within range of the RPC point");
    // 5. status change → fetch again.
    Array.from(w.document.querySelectorAll("button")).find(b => b.textContent.trim() === "I've Arrived").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await waitFor(w, () => rpcCalls(app.calls).length >= 2, "refetch after status change");
    ok(rpcCalls(app.calls).length === 2, "5. a status change (en_route → arrived) fetches the destination again");
    w.close();
  }
  {
    const app = await start({ flag: false, rows: [row()], rpc: () => json(200, { ok: false, error: "no_coordinates", city_label: "Orlando, FL" }), geo: { lat: 10.101, lng: 20.202 } });
    const w = app.window;
    await openJob(app);
    await waitFor(w, x => !!x.document.querySelector('[data-dest-state="no_coordinates"]'), "no point");
    await sleep(150);
    const btns = Array.from(w.document.querySelectorAll("button")).map(b => b.textContent.trim());
    ok(!btns.includes("I've Arrived") && /keep driving to confirm arrival/.test(leaf(w)) && !/mi to go/.test(leaf(w)),
      "7. without an RPC point the arrival gate stays locked, even standing on the table row's coordinates");
    ok(leaf(w).includes("Exact location not available yet.") && links(w).some(l => /city only, not the job location/.test(l.t) && /(query=Orlando, FL$|destination=Orlando, FL&travelmode=driving$)/.test(l.h) && !/\d+\.\d{3,},-?\d+\.\d{3,}(?=&travelmode|$)/.test(l.h.split("destination=")[1] || l.h)), "flag off: honest message and a labelled city-only link");
    w.close();
  }
}

function shippedChecks() {
  console.log("Shipped files:");
  for (const f of ["index.html", "prototype-pro.html"]) {
    const html = read(f);
    ok(/const HAVEN_ASSIGNED_JOB_MAP_ENABLED = true;/.test(html) && !/HAVEN_ASSIGNED_JOB_MAP_ENABLED\s*=\s*false/.test(html), "9. " + f + ": flag is true");
    const jwts = html.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
    const roles = jwts.map(t => { try { return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")).role; } catch (e) { return "unparseable"; } });
    ok(roles.length > 0 && roles.every(r => r === "anon"), "10. " + f + ": every embedded key is the anon key (no service-role key)");
    ok(!/sb_secret_[A-Za-z0-9]|"role"\s*:\s*"service_role"|sk\.eyJ/.test(html), "10. " + f + ": no secret Supabase or Mapbox key value (the code that rejects sb_secret_ keys is fine)");
    ok(/rpc\/get_assigned_job_destination/.test(html) && !/select=id,lat,lng,city_label/.test(html), f + ": destination via the RPC only; the table read is gone");
  }
  const src = read("home_services_pro_app.jsx");
  ok(!/job\.lat|job\.lng/.test(src), "6. the app never reads job.lat / job.lng");
  ok(!/localStorage[^\n]*destination|destination[^\n]*localStorage/i.test(src + read("pro_maps.js") + read("backend_adapter.js")), "destinations are never written to localStorage");
  ok(/clearAllDestinations\(\); \/\/ MAP-05: no exact destination survives sign-out/.test(src) && /if \(!authSession \|\| !authSession\.id\) clearAllDestinations\(\);/.test(src), "5. sign-out clears every stored destination");
  ok((src.match(/HavenEnRouteNavigation|HAVEN_ASSIGNED_JOB_MAP_ENABLED/g) || []).length === 2, "the app file calls into pro_maps.js once, behind the flag");
  ok(/"backend_adapter\.js"[^)\n]*"pro_maps\.js"[^)\n]*"\$SRC"/.test(read("build-pro.sh")), "pro_maps.js is part of the build");
}

(async () => {
  await unitChecks();
  await appChecks();
  shippedChecks();
  console.log(`OK: assigned-job destination + map checks passed (${pass} assertions).`);
  process.exit(0);
})().catch(e => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
