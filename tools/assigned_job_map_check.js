#!/usr/bin/env node
"use strict";

/**
 * MAP-05 M5-1 / M5-2 (Hub handoffs/MAP-05.md): assigned-job map + Apple Maps.
 *
 * - Backend gate: HAVEN_ASSIGNED_JOB_MAP_ENABLED ships false (source + both
 *   built pages); with it off the en-route panel is exactly as before.
 * - With the flag on (test-only build, fixture data):
 *   - The map appears only for a server-assigned (backendClaimed) en-route job
 *     with exact coordinates from the assigned-job flow.
 *   - One static Mapbox image with a single pin at that point; no route/path
 *     overlay, no ETA or travel time.
 *   - Open in Apple Maps goes to the exact point; Google Maps keeps mapPanel's
 *     existing URL.
 *   - No location → no image and no Apple button, city directions only.
 *   - Not assigned (no backendClaimed) → no image.
 *   - States: loading → loaded; error → "Try again" retries; offline before
 *     load → offline note.
 *   - No Mapbox image before the job screen opens (nothing at startup).
 *
 * Local fixtures only (public landmark coordinates). Not production data.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const PRO_ID = "cccccccc-dddd-4eee-8fff-000000000m51";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-0000000000m5";
const FIX = { lat: 28.53834, lng: -81.37924 }; // test fixture: Orlando City Hall (public landmark)

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; console.log("  ✓ " + msg); }
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function json(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }; }

// ── Unit checks on pro_maps.js ───────────────────────────────────────────────
function loadMaps() {
  const sandbox = { encodeURIComponent, Number, Math, String, navigator: { onLine: true } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext('const HAVEN_MAPBOX_PUBLIC_TOKEN = "pk.test-token";\n' + read("pro_maps.js") +
    "\n;globalThis.__m = { havenAssignedJobPoint, havenStaticMapUrl, havenAppleMapsUrl, HAVEN_ASSIGNED_JOB_MAP_ENABLED };", sandbox);
  return sandbox.__m;
}
function unitChecks() {
  console.log("pro_maps.js units:");
  const m = loadMaps();
  ok(m.HAVEN_ASSIGNED_JOB_MAP_ENABLED === false, "the map ships disabled (backend gate)");
  ok(m.havenAssignedJobPoint({ backendClaimed: true, lat: "28.53834", lng: "-81.37924" }).lat === 28.53834, "an assigned job's exact point is used");
  ok(m.havenAssignedJobPoint({ lat: 28.5, lng: -81.3 }) === null, "a job that isn't server-assigned gives no point");
  ok(m.havenAssignedJobPoint({ backendClaimed: true, lat: null, lng: -81.3 }) === null && m.havenAssignedJobPoint({ backendClaimed: true, lat: 999, lng: 0 }) === null, "missing or invalid coordinates give no point");
  const light = m.havenStaticMapUrl(FIX, false), dark = m.havenStaticMapUrl(FIX, true);
  ok(/^https:\/\/api\.mapbox\.com\/styles\/v1\/mapbox\/streets-v12\/static\/pin-l\+0f6e4e\(-81\.37924,28\.53834\)\/-81\.37924,28\.53834,15,0\/600x300@2x\?access_token=pk\.test-token$/.test(light), "static map URL: one pin at the point, fixed size (cacheable)");
  ok(/mapbox\/dark-v11\/static/.test(dark), "dark mode uses the dark map style");
  ok(!/path-|geojson|polyline/.test(light + dark), "no route or path overlay on the map");
  ok(m.havenStaticMapUrl(null, false) === null, "no point → no map request");
  ok(m.havenAppleMapsUrl(FIX) === "https://maps.apple.com/?daddr=28.53834,-81.37924&dirflg=d", "Apple Maps: driving directions to the exact point");
  const src = read("pro_maps.js");
  ok(!/\bETA\b|min away|minutes away|arriv\w* in \d|travel time is/i.test(src.replace(/^\/\/.*$/gm, "")), "no ETA or travel-time text in the map code");
}

// ── App checks (jsdom, built prototype with the flag forced on) ──────────────
async function renderApp({ flag, rows }) {
  const { JSDOM, VirtualConsole } = require("jsdom");
  const babel = require("@babel/core");
  const React = require("react");
  const ReactDOMClient = require("react-dom/client");
  let ReactDOMLegacy = {};
  try { ReactDOMLegacy = require("react-dom"); } catch (e) { ReactDOMLegacy = {}; }
  let html = read("prototype-pro.html");
  if (flag) html = html.replace("const HAVEN_ASSIGNED_JOB_MAP_ENABLED = false;", "const HAVEN_ASSIGNED_JOB_MAP_ENABLED = true;");
  const dom = new JSDOM(html, { url: "https://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const { window } = dom;
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.cancelAnimationFrame = window.cancelAnimationFrame || (id => clearTimeout(id));
  window.localStorage.clear();
  const calls = [];
  const profile = {
    id: PRO_ID, role: "pro", display_name: "Test Pro", email: "pro@example.com", first_name: "Test", last_name: "Pro",
    home_city: "Orlando, FL", work_categories: ["Plumbing"], operating_lat: 28.5, operating_lng: -81.3,
    pro_workspace: { onboardingStatus: "completed", onboardingStep: "done", firstName: "Test", lastName: "Pro", homeCity: "Orlando, FL", travelRadius: 25, workCategories: ["Plumbing"] },
  };
  window.fetch = async (url, init) => {
    url = String(url); init = init || {};
    calls.push({ url, method: init.method || "GET" });
    if (url.endsWith("/auth/v1/health")) return json(200, {});
    if (url.includes("/rpc/is_qa_tester")) return json(200, false);
    if (url.includes("/rest/v1/profiles")) return json(200, [profile]);
    if (/\/rest\/v1\/jobs\?pro_id=eq\..*status=in\./.test(url)) return json(200, rows);
    return json(200, []);
  };
  const session = { access_token: "tok", user: { id: PRO_ID, email: "pro@example.com", user_metadata: { role: "pro" } } };
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
async function waitFor(w, pred, label) {
  for (let i = 0; i < 200; i++) { await sleep(25); if (pred(w)) return; }
  throw new Error("timed out: " + label + "\n" + rootText(w).slice(0, 600));
}
function clickText(w, re) {
  const el = Array.from(w.document.querySelectorAll("#root *")).filter(e => e.children.length === 0 && re.test((e.textContent || "").trim())).pop();
  if (!el) throw new Error("no element " + re + "\n" + rootText(w).slice(0, 500));
  el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
}
const mapboxImgs = w => Array.from(w.document.querySelectorAll("img")).filter(i => /api\.mapbox\.com/.test(i.getAttribute("src") || ""));
const row = (o) => Object.assign({ id: JOB, status: "en_route", pro_id: PRO_ID, category: "Plumbing", title: "Fix leaking faucet (fixture)",
  requires_diagnosis: false, inspection_fee_cents: 0, fixed_pro_labor_payout_cents: 6500, city_label: "Orlando",
  accepted_at: new Date().toISOString(), posted_at: new Date().toISOString() }, o);

async function openJob(opts) {
  const app = await renderApp(opts);
  const w = app.window;
  await waitFor(w, x => rootText(x).includes("My Jobs"), "signed in");
  await sleep(300);
  app.atStartup = mapboxImgs(w).length;
  clickText(w, /My Jobs$/); await sleep(150);
  clickText(w, /Fix leaking faucet/); await sleep(200);
  return app;
}

async function appChecks() {
  console.log("Flag off (as shipped):");
  {
    const { window: w } = await openJob({ flag: false, rows: [row(FIX)] });
    ok(!w.document.querySelector('[data-testid="assigned-job-map"]') && mapboxImgs(w).length === 0, "no map and no Mapbox request while the gate is off");
    ok(/Open in Maps|Get Directions/.test(rootText(w)) && !/Apple Maps/.test(rootText(w)), "en-route panel is exactly the previous one");
    w.close();
  }
  console.log("Flag on (test build, fixture):");
  {
    const { window: w, atStartup } = await openJob({ flag: true, rows: [row(FIX)] });
    ok(atStartup === 0, "no Mapbox image before the job screen opens (nothing at startup)");
    const imgs = mapboxImgs(w);
    ok(imgs.length === 1 && imgs[0].getAttribute("src").includes("pin-l+0f6e4e(-81.37924,28.53834)"), "one static map of the assigned job's exact point");
    ok(imgs[0].getAttribute("loading") === "lazy" && /Map of the job location in Orlando/.test(imgs[0].alt), "lazy image with descriptive alt text");
    const box = w.document.querySelector("[data-map-state]");
    ok(box.getAttribute("data-map-state") === "loading" && /Loading map/.test(box.textContent), "loading state while the image loads");
    imgs[0].dispatchEvent(new w.Event("load")); await sleep(30);
    ok(w.document.querySelector("[data-map-state]").getAttribute("data-map-state") === "loaded", "loaded state after the image loads");
    const links = Array.from(w.document.querySelectorAll("a")).map(a => [a.textContent.trim(), a.href]);
    ok(links.some(([t, h]) => t === "Open in Apple Maps" && h === "https://maps.apple.com/?daddr=28.53834,-81.37924&dirflg=d"), "Open in Apple Maps → exact point");
    ok(links.some(([t, h]) => /Google Maps/.test(t) && h.startsWith("https://www.google.com/maps/search/?api=1&query=28.53834%2C-81.37924")), "Google Maps link keeps mapPanel's existing URL");
    ok(!/\bETA\b|min away|mins? to go/i.test(w.document.querySelector('[data-testid="assigned-job-map"]').textContent), "no ETA or travel time shown");
    w.close();
  }
  {
    const { window: w } = await openJob({ flag: true, rows: [row(FIX)] });
    const img = mapboxImgs(w)[0];
    img.dispatchEvent(new w.Event("error")); await sleep(30);
    const box = w.document.querySelector("[data-map-state]");
    ok(box.getAttribute("data-map-state") === "error" && /Map unavailable right now/.test(box.textContent), "error state when the map fails");
    ok(Array.from(w.document.querySelectorAll("a")).some(a => a.textContent.trim() === "Open in Apple Maps"), "directions still available on error");
    const retry = Array.from(w.document.querySelectorAll("button")).find(b => b.textContent.trim() === "Try again");
    retry.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); await sleep(30);
    ok(w.document.querySelector("[data-map-state]").getAttribute("data-map-state") === "loading" && mapboxImgs(w).length === 1, "Try again retries the same map");
    w.close();
  }
  {
    const { window: w } = await openJob({ flag: true, rows: [row({ lat: null, lng: null })] });
    ok(mapboxImgs(w).length === 0 && w.document.querySelector("[data-map-state]").getAttribute("data-map-state") === "no-location", "no server point → no map, honest note");
    const links = Array.from(w.document.querySelectorAll("a")).map(a => [a.textContent.trim(), a.href]);
    ok(!links.some(([t]) => /Apple Maps/.test(t)) && links.some(([t, h]) => /Google Maps/.test(t) && /query=Orlando$/.test(h)), "no Apple button; Google falls back to the city (nothing invented)");
    w.close();
  }
  {
    const { window: w } = await openJob({ flag: true, rows: [row(FIX)] });
    Object.defineProperty(w.navigator, "onLine", { configurable: true, get: () => false });
    w.dispatchEvent(new w.Event("offline")); await sleep(30);
    ok(w.document.querySelector("[data-map-state]").getAttribute("data-map-state") === "offline" && mapboxImgs(w).length === 0, "offline before the map loads → offline note, no request");
    w.close();
  }
}

function sourceChecks() {
  console.log("Source checks:");
  ok(/"backend_adapter\.js" "pro_maps\.js" "\$SRC"/.test(read("build-pro.sh")), "pro_maps.js is part of the build");
  for (const built of ["prototype-pro.html", "index.html"]) {
    const html = read(built);
    ok(/HAVEN_ASSIGNED_JOB_MAP_ENABLED\s*=\s*false/.test(html) && /HavenEnRouteNavigation/.test(html), built + ": map code built in, gate off");
  }
  const jsx = read("home_services_pro_app.jsx");
  ok((jsx.match(/HavenEnRouteNavigation|HAVEN_ASSIGNED_JOB_MAP_ENABLED/g) || []).length === 2, "the app file only calls into pro_maps.js (one gated call)");
}

(async () => {
  unitChecks();
  await appChecks();
  sourceChecks();
  console.log(`OK: assigned-job map checks passed (${pass} assertions).`);
  process.exit(0);
})().catch(e => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
