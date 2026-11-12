#!/usr/bin/env node
"use strict";

/**
 * One "Navigate" button on the assigned job (founder approved 2026-11-11, draft).
 *
 *  U1. URLs: Apple Maps / Google Maps (turn-by-turn) / Waze to the exact RPC point,
 *      6 dp, destination only (never the Pro's location), null without a point.
 *  U2. The saved choice: only apple / google / waze are read back; anything
 *      else, or storage failing, means "ask".
 *  A1. First tap: no saved app → "Navigate with" lists the three apps, each
 *      linking to the RPC point; picking one saves it.
 *  A2. Next time: one Navigate button "with <app>" → that app's URL; Change
 *      reopens the choice.
 *  A3. Settings → Navigation app sets, changes or clears the choice.
 *  A4. No exact point → no Navigate (only the city-level search, labelled).
 *  A5. The Pro's live location is never in a navigation link.
 *
 * fetch is mocked (public-landmark fixture). Mocks are never certification.
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

function loadMaps(store, throwing) {
  const sb = { Number, Math, String, encodeURIComponent, React: { createElement() {} },
    window: { localStorage: throwing ? { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } }
      : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } } };
  sb.globalThis = sb; vm.createContext(sb);
  vm.runInContext(read("pro_maps.js") + "\n;globalThis.__m = { havenNavigationUrl, havenReadNavApp, havenSaveNavApp, havenNavAppLabel, HAVEN_NAV_APPS, HAVEN_NAV_APP_KEY };", sb);
  return sb.__m;
}
function unitChecks() {
  console.log("U1 URLs:");
  const m = loadMaps({});
  ok(m.havenNavigationUrl("apple", POINT) === "https://maps.apple.com/?daddr=28.538336,-81.379234&dirflg=d", "Apple Maps: driving directions to the exact point (6 dp)");
  ok(m.havenNavigationUrl("google", POINT) === "https://www.google.com/maps/dir/?api=1&destination=28.538336,-81.379234&travelmode=driving&dir_action=navigate", "Google Maps: destination + travelmode=driving + dir_action=navigate (starts turn-by-turn)");
  ok(m.havenNavigationUrl("waze", POINT) === "https://waze.com/ul?ll=28.538336,-81.379234&navigate=yes", "Waze: ll + navigate=yes");
  ok(["apple", "google", "waze"].every(a => !/origin|saddr|from=/.test(m.havenNavigationUrl(a, POINT))), "no start point in any link: the map app uses the phone's own location");
  ok(m.havenNavigationUrl("apple", null) === null && m.havenNavigationUrl("bogus", POINT) === null && m.havenNavigationUrl("", POINT) === null, "no point, or no/unknown app → no link");
  console.log("U2 The saved choice:");
  const store = {};
  const s = loadMaps(store);
  ok(s.havenReadNavApp() === "", "nothing saved → ask");
  s.havenSaveNavApp("waze");
  ok(store[s.HAVEN_NAV_APP_KEY] === "waze" && s.havenReadNavApp() === "waze", "a choice is saved under " + s.HAVEN_NAV_APP_KEY + " and read back");
  s.havenSaveNavApp("");
  ok(!(s.HAVEN_NAV_APP_KEY in store) && s.havenReadNavApp() === "", "\"Ask\" clears it");
  store[s.HAVEN_NAV_APP_KEY] = "javascript:alert(1)";
  ok(s.havenReadNavApp() === "", "an unknown stored value is ignored (ask)");
  const t = loadMaps({}, true);
  ok(t.havenReadNavApp() === "" && (t.havenSaveNavApp("apple"), true), "storage blocked: no error, just ask each time");
  ok(s.HAVEN_NAV_APPS.map(a => a.label).join(",") === "Apple Maps,Google Maps,Waze" && s.havenNavAppLabel("google") === "Google Maps", "three apps, plain labels");
}
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


const navBtn = w => w.document.querySelector('[data-testid="navigate-button"]');
const chooser = w => w.document.querySelector('[data-testid="nav-chooser"]');
async function appChecks() {
  console.log("A1–A2 Navigate on the job screen:");
  {
    const app = await start({ flag: true, rows: [row()], rpc: () => json(200, OK_BODY), geo: { lat: 28.6, lng: -81.4 } });
    const w = app.window;
    await openJob(app);
    await waitFor(w, x => !!chooser(x), "chooser");
    const opts = Array.from(chooser(w).querySelectorAll("a[data-nav-app]")).map(a => ({ id: a.getAttribute("data-nav-app"), t: a.textContent.trim(), h: decodeURIComponent(a.href) }));
    ok(opts.map(o => o.t).join(",") === "Apple Maps,Google Maps,Waze" && /Navigate with/.test(chooser(w).textContent), "first time: \"Navigate with\" Apple Maps, Google Maps, Waze");
    ok(opts.every(o => o.h.includes("28.538336,-81.379234")) && opts.every(o => !o.h.includes("10.101") && !o.h.includes("28.6")), "each goes to the RPC point; never the table row, never the Pro's location");
    ok(!navBtn(w), "no single Navigate button until an app is chosen");
    const waze = chooser(w).querySelector('a[data-nav-app="waze"]');
    waze.addEventListener("click", e => e.preventDefault(), { once: true }); // jsdom: don't navigate away
    waze.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(w, x => !!navBtn(x), "Navigate button");
    ok(w.localStorage.getItem("haven_pro_nav_app_v1") === "waze", "picking Waze saves it on this phone");
    ok(navBtn(w).getAttribute("data-nav-app") === "waze" && /Navigate/.test(navBtn(w).textContent) && /with Waze/.test(navBtn(w).textContent)
      && decodeURIComponent(navBtn(w).href) === "https://waze.com/ul?ll=28.538336,-81.379234&navigate=yes", "then one button: \"Navigate · with Waze\" → Waze turn-by-turn to the job");
    ok(navBtn(w).getAttribute("target") === "_blank" && /noopener/.test(navBtn(w).getAttribute("rel")), "opens outside the app (noopener)");
    ok(!Array.from(w.document.querySelectorAll("a")).some(a => /28\.6|-81\.4(?!\d)/.test(decodeURIComponent(a.href)) && /maps|waze/.test(a.href)), "A5. the Pro's live location is not in any navigation link");
    w.document.querySelector('[data-testid="navigate-change"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await waitFor(w, x => !!chooser(x), "chooser again");
    ok(!!chooser(w) && !navBtn(w), "Change reopens the choice");
    w.close();
  }
  {
    const app = await renderApp({ flag: true, rows: [row()], rpc: () => json(200, OK_BODY) });
    const w = app.window;
    w.localStorage.setItem("haven_pro_nav_app_v1", "apple");
    await waitFor(w, x => leaf(x).includes("My Jobs"), "signed in");
    await sleep(300);
    await openJob(app);
    await waitFor(w, x => !!navBtn(x), "Navigate button");
    ok(decodeURIComponent(navBtn(w).href) === "https://maps.apple.com/?daddr=28.538336,-81.379234&dirflg=d" && /with Apple Maps/.test(navBtn(w).textContent) && !chooser(w), "a saved choice is used straight away (Apple Maps)");
    console.log("A3 Settings → Navigation app:");
    clickText(w, /^Profile$/); await sleep(120);
    clickText(w, /^Settings$/); await sleep(120);
    await waitFor(w, x => /Navigation app/.test(leaf(x)), "settings row");
    ok(/Navigation app/.test(leaf(w)) && /Apple Maps/.test(leaf(w)), "Settings shows \"Navigation app · Apple Maps\"");
    clickText(w, /^Navigation app$/); await sleep(120);
    const google = w.document.querySelector('[data-nav-option="google"]');
    ok(!!google && w.document.querySelector('[data-nav-option="apple"]').getAttribute("aria-checked") === "true", "the screen lists the apps with the current one checked");
    google.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(120);
    ok(w.localStorage.getItem("haven_pro_nav_app_v1") === "google" && /Google Maps/.test(leaf(w)), "choosing Google Maps saves it and returns to Settings");
    clickText(w, /^Navigation app$/); await sleep(120);
    w.document.querySelector('[data-nav-option="ask"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await sleep(120);
    ok(w.localStorage.getItem("haven_pro_nav_app_v1") === null && /Ask when I tap Navigate/.test(leaf(w)), "\"Ask when I tap Navigate\" clears it");
    w.close();
  }
  console.log("A4 No exact point:");
  {
    const app = await start({ flag: true, rows: [row()], rpc: () => json(200, { ok: false, error: "no_coordinates", city_label: "Orlando, FL" }) });
    const w = app.window;
    w.localStorage.setItem("haven_pro_nav_app_v1", "waze");
    await openJob(app);
    await waitFor(w, x => /Exact location not available yet/.test(leaf(x)), "no-point message");
    ok(!navBtn(w) && !chooser(w), "no Navigate without the exact point");
    ok(Array.from(w.document.querySelectorAll("a")).some(a => /city only, not the job location/.test(a.textContent)), "only the labelled city-level search remains");
    w.close();
  }
  console.log("Shipped:");
  for (const f of ["index.html", "prototype-pro.html"]) {
    const html = read(f);
    ok(/haven_pro_nav_app_v1/.test(html) && /dir_action=navigate/.test(html) && /waze\.com\/ul/.test(html), f + ": includes the Navigate button");
  }
}

(async () => {
  unitChecks();
  await appChecks();
  console.log(`OK: Navigate button checks passed (${pass} assertions).`);
  process.exit(0);
})().catch(e => { console.error("FAIL:", e && e.message || e); process.exit(1); });
