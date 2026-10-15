#!/usr/bin/env node
"use strict";

/**
 * Phase 1B profile fix (Pro): loading or re-loading a session never
 * overwrites the server profile, and saves send only what the user edited.
 *
 * Regression cases from Quagon's fresh-device harness
 * (/workspace/qa/pro-fresh-device.md):
 *   S3  server pro_workspace missing travelRadius / provider statuses (plus a
 *       key the app does not know): load must not write defaults into it.
 *   S4  long-open tab still holding San Francisco; another device saved
 *       Orlando; supabase-js emits SIGNED_IN on focus: the tab re-reads the
 *       server and must not PATCH San Francisco back.
 *   S6  tab whose Mapbox lookup failed (403, null point in memory); good
 *       coordinates saved elsewhere; SIGNED_IN on focus: no null coordinates
 *       are written over them.
 * Plus: geocode failure on a city edit (no city saved with a null point, the
 * user sees the message, previous city/point kept in the app and on the
 * server), the same on Create Your Profile, a normal edit that still saves
 * (only the edited fields, merged into the server workspace), and the load
 * backfill of a missing point (coordinates only, server-conditional).
 *
 * Mocked backend only: window.fetch and window.supabase are replaced, so no
 * request leaves this process (no live Supabase, no Mapbox). No keys printed.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const PRO_ID = "cccccccc-dddd-4eee-8fff-0000000001b6";
const DEMO_IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const GEOCODE_COPY = "We couldn't find that location. Check the city and try again.";
const ORLANDO = { lat: 28.5421, lng: -81.379 };
const SF = { lat: 37.7749, lng: -122.4194 };
const TAMPA = { lat: 27.9506, lng: -82.4572 };

function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function rootText(window) { return window.document.getElementById("root").textContent || ""; }
function screenText(window) {
  const rootEl = window.document.getElementById("root");
  return Array.from(rootEl.querySelectorAll("*")).filter(el => el.tagName !== "STYLE" && el.children.length === 0).map(el => el.textContent).join(" ");
}
async function waitFor(window, pred, label) {
  for (let i = 0; i < 200; i++) {
    await sleep(20);
    if (pred(rootText(window))) return;
  }
  throw new Error("timed out waiting for: " + label + "\n" + screenText(window).slice(0, 800));
}
function clickText(window, label) {
  const els = Array.from(window.document.querySelectorAll("#root *")).filter(el => el.children.length === 0 && (el.textContent || "").trim() === label);
  if (!els.length) throw new Error("no element with text: " + label + "\n" + screenText(window).slice(0, 800));
  els[els.length - 1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}
function setInput(window, placeholder, value) {
  const input = Array.from(window.document.querySelectorAll("input")).find(el => el.placeholder === placeholder);
  if (!input) throw new Error("no input " + placeholder + "\n" + screenText(window).slice(0, 600));
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  // React here is Node's copy, not wired to jsdom's events: call the element's onChange prop, as the other checks do.
  const propsKey = Object.keys(input).find(k => k.startsWith("__reactProps$"));
  input[propsKey].onChange({ target: input, currentTarget: input });
}
function setTextarea(window, value) {
  const el = window.document.querySelector("#root textarea");
  if (!el) throw new Error("no textarea");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(el, value);
  // React here is Node's copy, not wired to jsdom's events: call the element's onChange prop, as the other checks do.
  const propsKey = Object.keys(el).find(k => k.startsWith("__reactProps$"));
  el[propsKey].onChange({ target: el, currentTarget: el });
}
function serviceArea(window) {
  const m = rootText(window).match(/Service Area(.{0,40}?) and surrounding areas/);
  return m ? m[1] : null;
}

function verifiedWs(extra) {
  return Object.assign({
    onboardingStatus: "completed", onboardingStep: "done", firstName: "Haven", lastName: "QA",
    homeCity: "Orlando, FL", about: "Permanent Haven QA account.", avatarEmoji: "🧑‍🔧",
    travelRadius: 25, workCategories: ["Plumbing", "Electrical"],
    identityVerification: { provider: "persona", status: "verified", verifiedAt: 1 },
    backgroundCheck: { provider: "checkr", status: "clear", clearedAt: 1 },
    payoutAccount: { provider: "stripe", status: "enabled", payoutsEnabled: true, requirementsDue: [], last4: "7076" },
    taxProfile: { provider: "stripe_connect", status: "verified" },
    taxLegalName: "Haven QA", taxClassification: "Individual", accountCreatedAt: 1759000000000,
    someOtherKey: "server-only value",
  }, extra || {});
}
function serverRow(over) {
  return Object.assign({
    id: PRO_ID, role: "pro", display_name: "Haven QA", email: "qa@example.com",
    first_name: "Haven", last_name: "QA", home_city: "Orlando, FL", work_categories: ["Plumbing", "Electrical"],
    operating_lat: ORLANDO.lat, operating_lng: ORLANDO.lng,
    pro_workspace: verifiedWs({ operatingLat: ORLANDO.lat, operatingLng: ORLANDO.lng }),
  }, over || {});
}

function json(status, body) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => text };
}
// Mocked PostgREST + Mapbox. Applies the eq / is.null filters a PATCH carries.
function backend(row) {
  const st = { row: clone(row), events: [], mapbox: "ok", geocodeCalls: [] };
  st.fetch = async (url, init) => {
    const method = (init && init.method) || "GET";
    if (url.includes("api.mapbox.com")) {
      const q = decodeURIComponent((url.match(/q=([^&]+)/) || [])[1] || "");
      st.geocodeCalls.push(q);
      if (st.mapbox === "403") return json(403, { message: "Forbidden" });
      const pt = /orlando/i.test(q) ? ORLANDO : /san francisco/i.test(q) ? SF : /tampa/i.test(q) ? TAMPA : null;
      return json(200, { features: pt ? [{ geometry: { coordinates: [pt.lng, pt.lat] } }] : [] });
    }
    if (url.endsWith("/auth/v1/health")) return json(200, {});
    if (url.includes("/rest/v1/rpc/is_qa_tester")) return json(200, false);
    if (url.includes("/rest/v1/rpc/")) return json(200, []);
    if (url.includes("/rest/v1/profiles")) {
      const idm = url.match(/[?&]id=eq\.([^&]+)/);
      const uid = idm ? decodeURIComponent(idm[1]) : "";
      if (method === "PATCH") {
        const body = JSON.parse(init.body || "{}");
        const ev = { type: "PATCH", uid, url: url.replace(/^https:\/\/[^/]+/, ""), body };
        st.events.push(ev);
        let match = uid === st.row.id;
        const cityM = url.match(/[?&]home_city=eq\.([^&]+)/);
        if (cityM && decodeURIComponent(cityM[1]) !== st.row.home_city) match = false;
        if (/[?&]operating_lat=is\.null/.test(url) && st.row.operating_lat != null) match = false;
        ev.applied = match;
        if (!match) return json(200, []);
        st.row = Object.assign({}, st.row, clone(body));
        return json(200, [st.row]);
      }
      st.events.push({ type: "GET", uid, url: url.replace(/^https:\/\/[^/]+/, "") });
      return json(200, uid === st.row.id ? [clone(st.row)] : []);
    }
    return json(200, []);
  };
  st.patches = () => st.events.filter(e => e.type === "PATCH");
  return st;
}

function authLib(ref) {
  return {
    createClient() {
      return {
        auth: {
          async getSession() { return { data: { session: ref.session || null }, error: null }; },
          async getUser() { return { data: { user: ref.session ? ref.session.user : null }, error: null }; },
          onAuthStateChange(cb) { (ref.listeners = ref.listeners || []).push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
          async signOut() { ref.session = null; return { error: null }; },
          async signInWithPassword() { return { data: { session: null }, error: { message: "nope", status: 400 } }; },
          async signUp() { return { data: { session: null, user: null }, error: null }; },
        },
      };
    },
  };
}
function session(token) {
  return { access_token: token || "mock-token", user: { id: PRO_ID, email: "qa@example.com", user_metadata: { role: "pro" } } };
}
function emitSignedIn(ref) {
  ref.session = session("mock-token-2");
  (ref.listeners || []).forEach(cb => cb("SIGNED_IN", ref.session));
}

async function renderApp(be, ref, storage) {
  const { JSDOM, VirtualConsole } = require("jsdom");
  const babel = require("@babel/core");
  const React = require("react");
  const ReactDOMClient = require("react-dom/client");
  let ReactDOMLegacy = {};
  try { ReactDOMLegacy = require("react-dom"); } catch (e) { ReactDOMLegacy = {}; }
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => { if (!/navigation/i.test(String(e && e.message))) console.error(e); });
  const dom = new JSDOM(read("prototype-pro.html"), { url: "https://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.cancelAnimationFrame = window.cancelAnimationFrame || (id => clearTimeout(id));
  window.localStorage.clear();
  Object.keys(storage || {}).forEach(k => window.localStorage.setItem(k, storage[k]));
  window.fetch = async (url, init) => be.fetch(String(url), init || {});
  window.supabase = authLib(ref);
  const ReactDOM = Object.assign({}, ReactDOMLegacy, ReactDOMClient);
  window.React = React;
  window.ReactDOM = ReactDOM;
  global.window = window;
  global.document = window.document;
  global.React = React;
  global.ReactDOM = ReactDOM;
  const scriptEl = window.document.querySelector('script[type="text/babel"]');
  const transpiled = babel.transformSync(scriptEl.textContent || "", {
    filename: "prototype-inline.jsx",
    presets: [
      [require.resolve("@babel/preset-env"), { targets: { node: "current" } }],
      [require.resolve("@babel/preset-react"), { runtime: "classic" }],
    ],
    babelrc: false,
    configFile: false,
  });
  window.eval(transpiled.code);
  return window;
}
async function withApp(be, ref, storage, fn) {
  const window = await renderApp(be, ref, storage);
  try { await fn(window); } finally { try { window.close(); } catch (e) { /* ignore */ } }
}
async function settle(be, ms) {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    await sleep(ms || 80);
    const n = be.events.length + be.geocodeCalls.length;
    if (n === last) return;
    last = n;
  }
}
async function openProfileMain(window) {
  clickText(window, "Profile");
  await sleep(40);
  clickText(window, "Profile");
  await waitFor(window, t => t.includes("Service Area"), "Profile main");
}
function assertNoDemoIds(be) {
  be.events.forEach(e => {
    const s = JSON.stringify(e);
    DEMO_IDS.forEach(id => assert.ok(!s.includes(id), "no demo id in any request: " + id));
  });
}
function isCoordsOnlyBackfill(ev, city) {
  const keys = Object.keys(ev.body).sort().join(",");
  return keys === "operating_lat,operating_lng"
    && /[?&]operating_lat=is\.null/.test(ev.url)
    && ev.url.includes("home_city=eq." + encodeURIComponent(city))
    && Number.isFinite(ev.body.operating_lat) && Number.isFinite(ev.body.operating_lng);
}

// ── S3: incomplete server workspace; load writes no defaults ─────────────
async function checkS3() {
  const ws = { homeCity: "Orlando, FL", workCategories: ["Plumbing"], onboardingStatus: "completed", someOtherKey: "kept?" };
  const be = backend(serverRow({ work_categories: ["Plumbing"], operating_lat: null, operating_lng: null, pro_workspace: clone(ws) }));
  const ref = { session: session() };
  await withApp(be, ref, {}, async (window) => {
    await waitFor(window, t => t.includes("My Jobs"), "S3 signed-in app");
    await settle(be);
    const patches = be.patches();
    patches.forEach(p => {
      assert.ok(!("pro_workspace" in p.body), "S3: load never writes pro_workspace: " + JSON.stringify(p.body));
      assert.ok(isCoordsOnlyBackfill(p, "Orlando, FL"), "S3: the only load write is the missing-point backfill: " + JSON.stringify(p.body));
    });
    assert.deepStrictEqual(be.row.pro_workspace, ws, "S3: server workspace unchanged (no travelRadius 15, no not_started statuses, unknown key kept)");
    assert.strictEqual(be.row.home_city, "Orlando, FL");
    await openProfileMain(window);
    assert.strictEqual(serviceArea(window), "Orlando, FL", "S3: Service Area shows the server city");
    // A later radius edit is merged: server keys the user did not touch stay.
    const before = be.events.length;
    clickText(window, "10 mi");
    await settle(be);
    const edit = be.events.slice(before).filter(e => e.type === "PATCH");
    assert.strictEqual(edit.length, 1, "S3: one save for the radius edit");
    assert.deepStrictEqual(Object.keys(edit[0].body), ["pro_workspace"], "S3: radius edit sends only pro_workspace");
    assert.deepStrictEqual(edit[0].body.pro_workspace, Object.assign({}, ws, { travelRadius: 10 }), "S3: radius merged into the server workspace, nothing else added or dropped");
    assert.strictEqual(be.row.pro_workspace.someOtherKey, "kept?", "S3: unknown server key kept");
  });
  assertNoDemoIds(be);
}

// ── S4: stale SF tab regains focus after Orlando was saved elsewhere ──────
async function checkS4() {
  const sfWs = verifiedWs({ homeCity: "San Francisco, CA", operatingLat: SF.lat, operatingLng: SF.lng });
  const be = backend(serverRow({ home_city: "San Francisco, CA", operating_lat: SF.lat, operating_lng: SF.lng, pro_workspace: sfWs }));
  const ref = { session: session() };
  await withApp(be, ref, {}, async (window) => {
    await waitFor(window, t => t.includes("My Jobs"), "S4 signed-in app");
    await settle(be);
    assert.strictEqual(be.patches().length, 0, "S4: loading a saved profile writes nothing");
    await openProfileMain(window);
    assert.strictEqual(serviceArea(window), "San Francisco, CA", "S4: tab starts on SF");
    // Another device saves Orlando with good coordinates.
    be.row = serverRow();
    const before = be.events.length;
    emitSignedIn(ref);
    await settle(be);
    const after = be.events.slice(before);
    assert.ok(after.some(e => e.type === "GET"), "S4: SIGNED_IN re-reads the server profile");
    const patches = after.filter(e => e.type === "PATCH");
    assert.strictEqual(patches.length, 0, "S4: no write on SIGNED_IN: " + JSON.stringify(patches.map(p => p.body)));
    assert.strictEqual(be.row.home_city, "Orlando, FL", "S4: server keeps Orlando");
    assert.strictEqual(be.row.operating_lat, ORLANDO.lat, "S4: server keeps the Orlando point");
    assert.strictEqual(be.row.pro_workspace.homeCity, "Orlando, FL");
    await waitFor(window, () => serviceArea(window) === "Orlando, FL", "S4: tab now shows Orlando");
  });
  assertNoDemoIds(be);
}

// ── S6: tab with a failed (403) lookup; good point saved elsewhere ───────
async function checkS6() {
  const be = backend(serverRow({ operating_lat: null, operating_lng: null, pro_workspace: verifiedWs({ operatingLat: null, operatingLng: null }) }));
  be.mapbox = "403";
  const ref = { session: session() };
  await withApp(be, ref, {}, async (window) => {
    await waitFor(window, t => t.includes("My Jobs"), "S6 signed-in app");
    await settle(be);
    assert.strictEqual(be.patches().length, 0, "S6: a failed lookup on load writes nothing");
    be.mapbox = "ok";
    be.row = serverRow();
    const before = be.events.length;
    emitSignedIn(ref);
    await settle(be);
    const patches = be.events.slice(before).filter(e => e.type === "PATCH");
    assert.strictEqual(patches.length, 0, "S6: no write on SIGNED_IN: " + JSON.stringify(patches.map(p => p.body)));
    be.patches().forEach(p => {
      assert.ok(!("operating_lat" in p.body && p.body.operating_lat == null), "S6: never writes a null operating_lat");
      assert.ok(!(p.body.pro_workspace && "operatingLat" in p.body.pro_workspace && p.body.pro_workspace.operatingLat == null), "S6: never writes a null workspace point");
    });
    assert.strictEqual(be.row.operating_lat, ORLANDO.lat, "S6: server keeps good operating_lat");
    assert.strictEqual(be.row.operating_lng, ORLANDO.lng, "S6: server keeps good operating_lng");
  });
  assertNoDemoIds(be);
}

// ── Load backfill of a missing point (S1 shape): coordinates only ────────
async function checkLoadBackfill() {
  const be = backend(serverRow({ operating_lat: null, operating_lng: null, pro_workspace: verifiedWs({ operatingLat: null, operatingLng: null }) }));
  const wsBefore = clone(be.row.pro_workspace);
  const ref = { session: session() };
  await withApp(be, ref, {}, async (window) => {
    await waitFor(window, t => t.includes("My Jobs"), "backfill signed-in app");
    await settle(be);
    const patches = be.patches();
    assert.strictEqual(patches.length, 1, "backfill: one write on load");
    assert.ok(isCoordsOnlyBackfill(patches[0], "Orlando, FL"), "backfill: coordinates only, only while the server has this city and no point: " + JSON.stringify(patches[0]));
    assert.strictEqual(be.row.operating_lat, ORLANDO.lat);
    assert.deepStrictEqual(be.row.pro_workspace, wsBefore, "backfill: workspace untouched");
  });
}

// ── Geocode failure on Edit Profile ──────────────────────────────────────
async function checkGeocodeFailureEdit() {
  for (const mode of ["no_result", "403"]) {
    const be = backend(serverRow());
    const ref = { session: session() };
    await withApp(be, ref, {}, async (window) => {
      await waitFor(window, t => t.includes("My Jobs"), "geocode signed-in app");
      await settle(be);
      be.mapbox = mode === "403" ? "403" : "ok";
      await openProfileMain(window);
      clickText(window, "Edit Profile");
      await waitFor(window, t => t.includes("Home Operating City"), "Edit Profile");
      setInput(window, "City, ST", "Atlantis, ZZ");
      await sleep(30);
      const before = be.events.length;
      clickText(window, "Save");
      await waitFor(window, t => t.includes(GEOCODE_COPY), "geocode failure message (" + mode + ")");
      await settle(be);
      const patches = be.events.slice(before).filter(e => e.type === "PATCH");
      patches.forEach(p => {
        assert.ok(!("home_city" in p.body), "geocode " + mode + ": city not saved");
        assert.ok(!("operating_lat" in p.body), "geocode " + mode + ": no null point written");
      });
      assert.strictEqual(patches.length, 0, "geocode " + mode + ": nothing saved");
      assert.strictEqual(be.row.home_city, "Orlando, FL", "geocode " + mode + ": server keeps the previous city");
      assert.strictEqual(be.row.operating_lat, ORLANDO.lat, "geocode " + mode + ": server keeps the previous point");
      assert.strictEqual(be.row.pro_workspace.homeCity, "Orlando, FL");
      clickText(window, "Cancel");
      await waitFor(window, t => t.includes("Service Area"), "back on Profile");
      assert.strictEqual(serviceArea(window), "Orlando, FL", "geocode " + mode + ": app keeps the previous city");
    });
    assertNoDemoIds(be);
  }
}

// ── Geocode failure on Create Your Profile (onboarding) ──────────────────
async function checkGeocodeFailureOnboarding() {
  const blank = { id: PRO_ID, role: "pro", display_name: null, email: "qa@example.com", first_name: null, last_name: null, home_city: null, work_categories: [], operating_lat: null, operating_lng: null, pro_workspace: {} };
  const be = backend(blank);
  const ref = { session: session() };
  await withApp(be, ref, {}, async (window) => {
    await waitFor(window, t => t.includes("Continue"), "welcome with a session");
    clickText(window, "Continue");
    await waitFor(window, t => t.includes("Create Your Profile"), "Create Your Profile");
    setInput(window, "e.g. Orlando, FL", "Atlantis, ZZ");
    await settle(be);
    clickText(window, "Continue");
    await waitFor(window, t => t.includes(GEOCODE_COPY), "onboarding geocode failure message");
    await settle(be);
    assert.ok(rootText(window).includes("Create Your Profile"), "onboarding stays on Create Your Profile");
    be.patches().forEach(p => {
      assert.ok(!("home_city" in p.body), "onboarding: unresolved city never saved: " + JSON.stringify(p.body));
      assert.ok(!(p.body.pro_workspace && "homeCity" in p.body.pro_workspace), "onboarding: unresolved city not in workspace");
    });
    assert.strictEqual(be.row.home_city, null, "onboarding: server city unchanged");
    // A city that resolves moves on and is saved with its point.
    setInput(window, "e.g. Orlando, FL", "Tampa, FL");
    await sleep(30);
    clickText(window, "Continue");
    await waitFor(window, t => t.includes("What kind of work"), "categories step");
    await settle(be);
    assert.strictEqual(be.row.home_city, "Tampa, FL", "onboarding: resolved city saved");
    assert.strictEqual(be.row.operating_lat, TAMPA.lat, "onboarding: saved with its point");
  });
  assertNoDemoIds(be);
}

// ── Normal edit still saves, with only the edited fields ─────────────────
async function checkNormalEdit() {
  const be = backend(serverRow());
  const ref = { session: session() };
  await withApp(be, ref, {}, async (window) => {
    await waitFor(window, t => t.includes("My Jobs"), "edit signed-in app");
    await settle(be);
    assert.strictEqual(be.patches().length, 0, "edit: load writes nothing");
    await openProfileMain(window);
    clickText(window, "Edit Profile");
    await waitFor(window, t => t.includes("Home Operating City"), "Edit Profile");
    setInput(window, "City, ST", "Tampa, FL");
    setTextarea(window, "Now based in Tampa.");
    await sleep(30);
    clickText(window, "Save");
    await waitFor(window, t => t.includes("Profile updated"), "Profile updated");
    await settle(be);
    const patches = be.patches();
    assert.strictEqual(patches.length, 1, "edit: one save");
    const body = patches[0].body;
    assert.deepStrictEqual(Object.keys(body).sort(), ["home_city", "operating_lat", "operating_lng", "pro_workspace"], "edit: only the edited columns: " + Object.keys(body));
    assert.strictEqual(body.home_city, "Tampa, FL");
    assert.strictEqual(body.operating_lat, TAMPA.lat);
    assert.strictEqual(body.operating_lng, TAMPA.lng);
    const expectWs = Object.assign(verifiedWs({ operatingLat: ORLANDO.lat, operatingLng: ORLANDO.lng }), { homeCity: "Tampa, FL", about: "Now based in Tampa.", operatingLat: TAMPA.lat, operatingLng: TAMPA.lng });
    assert.deepStrictEqual(body.pro_workspace, expectWs, "edit: edited keys merged into the server workspace; untouched keys (statuses, radius, unknown key) kept as the server had them");
    assert.strictEqual(be.row.home_city, "Tampa, FL");
    assert.strictEqual(be.row.first_name, "Haven", "edit: untouched columns unchanged");
    assert.strictEqual(serviceArea(window), "Tampa, FL", "edit: app shows the new city");
    // Saving the same city again does not geocode or write again.
    const geocodes = be.geocodeCalls.length;
    clickText(window, "Edit Profile");
    await waitFor(window, t => t.includes("Home Operating City"), "Edit Profile again");
    clickText(window, "Save");
    await settle(be);
    assert.strictEqual(be.patches().length, 1, "edit: no write when nothing changed");
    assert.strictEqual(be.geocodeCalls.length, geocodes, "edit: no repeat lookup for the same city");
  });
  assertNoDemoIds(be);
}

// ── Adapter: the save path itself never writes a city with a null point ──
async function checkAdapterSavePath() {
  const store = {};
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  };
  const ref = { session: session() };
  const be = backend(serverRow());
  be.mapbox = "403";
  const sandbox = {
    console, atob, window: { localStorage, supabase: authLib(ref) }, fetch: (u, i) => be.fetch(String(u), i || {}),
    URL, encodeURIComponent, decodeURIComponent, Date, JSON, Math, Array, Object, String, Number, Error, Promise, Set, Map, setTimeout, clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const src = read("locked_constants.js") + "\n" + read("pure_helpers.js") + "\n" + read("geocode.js") + "\n" + read("backend_adapter.js");
  vm.runInContext(src + "\n;globalThis.__haven = { saveHavenProProfile, havenAuthRestoreSession, fetchHavenProProfile };", sandbox, { filename: "adapter.js" });
  const api = sandbox.__haven;
  const restored = await api.havenAuthRestoreSession();
  assert.ok(restored && restored.ok && restored.session, "adapter: session restored from the mock");
  await api.fetchHavenProProfile(PRO_ID);
  const res = await api.saveHavenProProfile(PRO_ID, { homeCity: "Atlantis, ZZ", travelRadius: 50, operatingLat: null, operatingLng: null });
  assert.ok(res && res.geocodeFailed === true, "adapter: geocode failure reported");
  const patch = be.patches().pop();
  assert.ok(patch, "adapter: the other edited field is still saved");
  assert.ok(!("home_city" in patch.body) && !("operating_lat" in patch.body) && !("operating_lng" in patch.body), "adapter: no city / null point in the PATCH: " + JSON.stringify(Object.keys(patch.body)));
  assert.strictEqual(patch.body.pro_workspace.homeCity, "Orlando, FL", "adapter: workspace city stays the server's");
  assert.strictEqual(patch.body.pro_workspace.operatingLat, ORLANDO.lat, "adapter: workspace point stays the server's");
  assert.strictEqual(patch.body.pro_workspace.travelRadius, 50, "adapter: edited key saved");
  assert.strictEqual(patch.body.pro_workspace.someOtherKey, "server-only value", "adapter: untouched server key kept");
  assert.strictEqual(be.row.home_city, "Orlando, FL");
  assert.strictEqual(be.row.operating_lat, ORLANDO.lat);
}

async function main() {
  const origErr = console.error;
  console.error = (...a) => { if (!/act\(|not wrapped/.test(String(a[0]))) origErr(...a); };
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    await checkS3();
    await checkS4();
    await checkS6();
    await checkLoadBackfill();
    await checkGeocodeFailureEdit();
    await checkGeocodeFailureOnboarding();
    await checkNormalEdit();
    await checkAdapterSavePath();
  } finally {
    console.warn = origWarn;
  }
  console.log("OK: Phase 1B profile no-overwrite checks passed (S3, S4, S6, load backfill, geocode failure x3, normal edit).");
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
