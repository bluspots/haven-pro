#!/usr/bin/env node
"use strict";

/**
 * Haven Pro native app (Capacitor) — background-location spike checks.
 *
 * pro_native_location.js gives the app's single en-route watch a location API:
 * the browser's own in the web app, and a shim over
 * @capacitor-community/background-geolocation in the native app. The live POST
 * goes through Capacitor's native HTTP in the native app. These checks run with a
 * mocked Capacitor runtime and mocked plugins: they prove the wiring, not the
 * phone. Background behaviour is proven only on a real iPhone / Android device.
 *
 *  N1. Browser: the location API is the browser's, and the native code paths are idle.
 *  N2. Native: the plugin watcher is used, never the browser's; iPhone asks only
 *      "While Using" (Geolocation.requestPermissions, plugin prompt off); Android lets
 *      the plugin ask; notification text = the locked notice; positions map to the
 *      browser shape.
 *  N3. Native: NOT_AUTHORIZED / denied permission → code 1 (Fix 1 path); other errors → 2.
 *  N4. Native: clearWatch removes the plugin watcher, even if it lands first; callbacks
 *      after clearWatch are ignored.
 *  N5. Native HTTP: same URL, headers and JSON body as the web fetch; same response mapping.
 *  N6. App (built page, mocked native runtime): en-route job → plugin watcher → POST via
 *      native HTTP (never fetch) with { p_job_id, p_lat, p_lng, p_captured_at }; permission
 *      revoked → sending stops + honest notice; Arrived and sign-out remove the watcher.
 *  N7. Diagnostics: counts and times only, never coordinates; off in the shipped pages,
 *      on only in the native spike copy.
 *  N8. Native project: plugin versions pinned; useLegacyBridge; iOS location background
 *      mode + When In Use string; no Android background-location permission.
 *
 * Coordinates are never printed (assertions report booleans). Fixtures are a public
 * landmark (Orlando City Hall).
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const PRO_ID = "cccccccc-dddd-4eee-8fff-0000000000c7";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-0000000000c7";
const DEST = { lat: 28.538336, lng: -81.379234 };
const NEAR = { lat: 28.538836, lng: -81.379234 };
const LIVE_PATH = "/rest/v1/rpc/pro_update_live_location";
const NOTICE = "Sharing your location with this customer until you arrive.";

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; console.log("  ✓ " + msg); }
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
function json(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }
const hasCoord = s => [DEST, NEAR].some(p => String(s).includes(String(p.lat)) || String(s).includes(String(p.lng)));
const pluginLoc = (p, o) => Object.assign({ latitude: p.lat, longitude: p.lng, accuracy: 8, altitude: null, altitudeAccuracy: null, simulated: false, bearing: null, speed: null, time: Date.now() }, o || {});

// Fake Capacitor runtime + plugins.
function fakeNative(platform, opts) {
  opts = opts || {};
  const log = { addWatcher: [], removeWatcher: [], requestPermissions: 0, http: [] };
  const watchers = new Map();
  let seq = 0;
  const bg = {
    async addWatcher(options, cb) { const id = "w" + (++seq); log.addWatcher.push(options); watchers.set(id, cb); if (opts.addDelay) await sleep(opts.addDelay); return id; },
    async removeWatcher({ id }) { log.removeWatcher.push(id); watchers.delete(id); },
  };
  const geo = { async requestPermissions() { log.requestPermissions++; return { location: opts.iosDenied ? "denied" : "granted" }; } };
  const http = {
    async request(req) {
      log.http.push(req);
      if (typeof opts.http === "function") return opts.http(req, log.http.length);
      return { status: 200, data: { ok: true, received_at: new Date().toISOString() } };
    },
  };
  const plugins = { BackgroundGeolocation: bg, Geolocation: geo, CapacitorHttp: http };
  return {
    log, watchers,
    emit: loc => { for (const cb of watchers.values()) cb(loc, undefined); },
    fail: err => { for (const cb of watchers.values()) cb(undefined, err); },
    Capacitor: { isNativePlatform: () => true, getPlatform: () => platform, registerPlugin: name => plugins[name] },
  };
}

function loadNative(win, extra) {
  const sandbox = Object.assign({ window: win, document: { visibilityState: "visible" }, navigator: win.navigator, Date, Math, Number, String, JSON, Promise, setTimeout, clearTimeout, setInterval, clearInterval, Map, Error, SyntaxError }, extra || {});
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("pro_native_location.js") + "\n;globalThis.__n = { havenLocationApi, havenIsNativeApp, havenNativeHttpPost, havenUseNativeHttp, havenCreateNativeLocationApi, havenDiagFix, havenDiagWrapSend, havenDiagLines, havenDiagReset, havenLiveDiag, HAVEN_NATIVE_SPIKE_DIAGNOSTICS, HAVEN_NATIVE_NOTIFICATION_TEXT };", sandbox);
  return { N: sandbox.__n, sandbox };
}

async function unitChecks() {
  console.log("N1 Browser:");
  {
    const browserGeo = { watchPosition() { return 1; }, clearWatch() {} };
    const { N } = loadNative({ navigator: { geolocation: browserGeo } });
    ok(N.havenLocationApi() === browserGeo && !N.havenIsNativeApp() && !N.havenUseNativeHttp(), "N1. web app: the browser's location API, no native HTTP");
    const { N: N2 } = loadNative({ navigator: {} });
    ok(N2.havenLocationApi() === null, "N1. no location API at all → null (the app shows the honest no-permission line)");
  }
  console.log("N2–N4 Native shim:");
  for (const platform of ["ios", "android"]) {
    const f = fakeNative(platform);
    const browserGeo = { watchPosition() { throw new Error("browser watch must not be used in the native app"); }, clearWatch() {} };
    const { N } = loadNative({ navigator: { geolocation: browserGeo }, Capacitor: f.Capacitor });
    const api = N.havenLocationApi();
    ok(api !== browserGeo && N.havenIsNativeApp() && N.havenUseNativeHttp(), "N2. " + platform + ": the native shim and native HTTP are used");
    const got = [], errs = [];
    const id = api.watchPosition(p => got.push(p), e => errs.push(e), { enableHighAccuracy: true });
    ok(typeof id === "number", "N2. " + platform + ": watchPosition returns an id at once");
    await flush(); await sleep(5);
    const o = f.log.addWatcher[0] || {};
    ok(f.log.addWatcher.length === 1, "N2. " + platform + ": one plugin watcher");
    ok(o.backgroundMessage === NOTICE && o.backgroundTitle === "Haven Pro" && o.stale === false, "N2. " + platform + ": background notification text is the locked notice; no stale positions");
    if (platform === "ios") ok(f.log.requestPermissions === 1 && o.requestPermissions === false, "N2. iOS: asks only \"While Using\" first; the plugin's own (Always) prompt is off");
    else ok(f.log.requestPermissions === 0 && o.requestPermissions === true, "N2. Android: the plugin asks for precise location itself");
    f.emit(pluginLoc(NEAR, { time: 1793000000000 }));
    ok(got.length === 1 && got[0].coords.latitude === NEAR.lat && got[0].coords.longitude === NEAR.lng && got[0].coords.accuracy === 8 && got[0].timestamp === 1793000000000, "N2. " + platform + ": a plugin position maps to the browser shape (coords + fix time)");
    f.fail({ code: "NOT_AUTHORIZED", message: "Permission denied." });
    ok(errs.length === 1 && errs[0].code === 1, "N3. " + platform + ": NOT_AUTHORIZED → PERMISSION_DENIED (code 1), the Fix 1 path");
    f.fail({ code: "UNKNOWN", message: "x" });
    ok(errs.length === 2 && errs[1].code === 2, "N3. " + platform + ": other errors → POSITION_UNAVAILABLE (code 2), not a denial");
    api.clearWatch(id);
    await flush();
    ok(f.log.removeWatcher.length === 1 && f.watchers.size === 0, "N4. " + platform + ": clearWatch removes the plugin watcher");
    f.emit(pluginLoc(NEAR));
    ok(got.length === 1, "N4. " + platform + ": nothing is delivered after clearWatch");
  }
  {
    const f = fakeNative("ios", { iosDenied: true });
    const { N } = loadNative({ navigator: {}, Capacitor: f.Capacitor });
    const errs = [];
    N.havenLocationApi().watchPosition(() => {}, e => errs.push(e));
    await flush(); await sleep(5);
    ok(errs.length === 1 && errs[0].code === 1 && f.log.addWatcher.length === 0, "N3. iOS: \"Don't Allow\" → code 1 and no plugin watcher is started");
  }
  {
    const f = fakeNative("android", { addDelay: 30 });
    const { N } = loadNative({ navigator: {}, Capacitor: f.Capacitor });
    const api = N.havenLocationApi();
    const got = [];
    const id = api.watchPosition(p => got.push(p), () => {});
    await flush();
    api.clearWatch(id); // before the plugin watcher id comes back (e.g. sign-out right after Accept)
    await sleep(60); await flush();
    ok(f.log.removeWatcher.length === 1 && f.watchers.size === 0, "N4. clearWatch before the plugin watcher is ready still removes it");
  }
  console.log("N5 Native HTTP:");
  {
    const f = fakeNative("ios", { http: () => ({ status: 200, data: '{"ok":true}' }) });
    const { N } = loadNative({ navigator: {}, Capacitor: f.Capacitor });
    const res = await N.havenNativeHttpPost("https://x.supabase.co" + LIVE_PATH, { apikey: "anon", Authorization: "Bearer tok", "Content-Type": "application/json", Accept: "application/json" }, { p_job_id: JOB, p_lat: NEAR.lat, p_lng: NEAR.lng });
    const req = f.log.http[0];
    ok(req.method === "POST" && req.url.endsWith(LIVE_PATH) && !req.url.includes("?") && req.data.p_job_id === JOB && req.headers.Authorization === "Bearer tok", "N5. POST, same URL (no query), JSON body object, session JWT");
    ok(req.connectTimeout === 10000 && req.readTimeout === 10000, "N5. bounded at 10 s (a hang becomes a retry)");
    ok(res.ok && res.status === 200 && (await res.json()).ok === true, "N5. a JSON string body is parsed");
    const f2 = fakeNative("ios", { http: () => ({ status: 200, data: "<html>" }) });
    const { N: Nb } = loadNative({ navigator: {}, Capacitor: f2.Capacitor });
    const res2 = await Nb.havenNativeHttpPost("u", {}, {});
    let threw = false; try { await res2.json(); } catch (e) { threw = true; }
    ok(threw, "N5. a non-JSON body reads as malformed (→ retry, as on the web)");
  }
  console.log("N7 Diagnostics:");
  {
    const { N, sandbox } = loadNative({ navigator: {} });
    N.havenDiagReset();
    N.havenDiagFix();
    sandbox.document.visibilityState = "hidden";
    N.havenDiagFix();
    const wrapped = N.havenDiagWrapSend(async () => ({ state: "ok" }));
    await wrapped(JOB, { lat: NEAR.lat, lng: NEAR.lng, capturedAt: Date.now() });
    await wrapped(JOB, { lat: NEAR.lat, lng: NEAR.lng, capturedAt: Date.now() });
    const lines = N.havenDiagLines().join("\n");
    ok(N.havenLiveDiag.fixes === 2 && N.havenLiveDiag.fixesHidden === 1 && N.havenLiveDiag.ok === 2 && N.havenLiveDiag.okHidden === 2, "N7. counts positions and accepted sends, split by background");
    ok(!hasCoord(lines) && !/Bearer|tok\b/.test(lines), "N7. diagnostics show no coordinates or tokens");
    ok(N.HAVEN_NATIVE_SPIKE_DIAGNOSTICS === false, "N7. diagnostics are off in the source");
  }
}

// ── Adapter in native mode ──────────────────────────────────────────────────
async function adapterChecks() {
  console.log("N5 Adapter (native HTTP):");
  for (const [label, httpResp, want] of [
    ["ok", { status: 200, data: { ok: true } }, r => r.state === "ok"],
    ["rate_limited", { status: 200, data: { ok: false, error: "rate_limited", retry_after_s: 3 } }, r => r.state === "rate_limited" && r.retryAfterS === 3],
    ["tracking_not_active", { status: 200, data: { ok: false, error: "tracking_not_active" } }, r => r.state === "stop" && r.error === "tracking_not_active"],
    ["401", { status: 401, data: {} }, r => r.state === "stop" && r.error === "not_authenticated"],
    ["500", { status: 500, data: {} }, r => r.state === "retry"],
    ["malformed", { status: 200, data: "nope" }, r => r.state === "retry"],
    ["no connection", null, r => r.state === "retry"],
  ]) {
    const f = fakeNative("android", { http: () => { if (!httpResp) throw new Error("offline"); return httpResp; } });
    const fetchCalls = [];
    const session = { access_token: "tok", user: { id: PRO_ID, email: "pro@example.com", user_metadata: { role: "pro" } } };
    const store = {};
    const win = { navigator: {}, Capacitor: f.Capacitor, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
      supabase: { createClient() { return { auth: { async getSession() { return { data: { session }, error: null }; }, async getUser() { return { data: { user: session.user }, error: null }; }, onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; } } }; } } };
    const sandbox = { console: { log() {}, warn() {}, error() {} }, atob, window: win, document: { visibilityState: "visible" }, navigator: {}, fetch: async (...a) => { fetchCalls.push(a); return json(200, { ok: true }); },
      URL, encodeURIComponent, Date, JSON, Math, Array, Object, String, Number, Error, SyntaxError, Promise, Set, Map, setTimeout, clearTimeout,
      INSPECTION_VISIT_FEE: 45, CONVENIENCE_FEE: 30, ACTIVE_BLOCK_STATUSES: new Set(["en_route"]) };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(read("backend_adapter.js") + "\n" + read("pro_native_location.js") + "\n;globalThis.__api = { sendProLiveLocation };", sandbox);
    const r = await sandbox.__api.sendProLiveLocation(JOB, { lat: NEAR.lat, lng: NEAR.lng, capturedAt: Date.UTC(2026, 10, 10, 18, 0, 0) });
    if (label === "ok") {
      const req = f.log.http[0];
      ok(fetchCalls.length === 0 && f.log.http.length === 1, "N5. native app: the live POST uses native HTTP, never the web view's fetch");
      ok(JSON.stringify(Object.keys(req.data).sort()) === JSON.stringify(["p_captured_at", "p_job_id", "p_lat", "p_lng"]) && req.data.p_lat === NEAR.lat && req.data.p_captured_at === "2026-11-10T18:00:00.000Z", "N5. same body { p_job_id, p_lat, p_lng, p_captured_at }");
      ok(req.headers.apikey && req.headers.Authorization === "Bearer tok" && req.headers["Content-Type"] === "application/json", "N5. same headers (anon apikey + session JWT)");
    }
    ok(want(r), "N5. native " + label + " → same result as on the web (" + r.state + ")");
  }
}

// ── App with a mocked native runtime ────────────────────────────────────────
function profileRow() {
  return { id: PRO_ID, role: "pro", display_name: "Test Pro", email: "pro@example.com", first_name: "Test", last_name: "Pro", home_city: "Orlando, FL", work_categories: ["Plumbing"], operating_lat: 28.5, operating_lng: -81.3,
    pro_workspace: { onboardingStatus: "completed", onboardingStep: "done", firstName: "Test", lastName: "Pro", homeCity: "Orlando, FL", travelRadius: 25, workCategories: ["Plumbing"],
      identityVerification: { provider: "persona", status: "verified" }, backgroundCheck: { provider: "checkr", status: "clear" },
      payoutAccount: { provider: "stripe_connect", status: "enabled", payoutsEnabled: true }, taxProfile: { status: "verified" } } };
}
const activeRow = o => Object.assign({ id: JOB, status: "en_route", pro_id: PRO_ID, category: "Plumbing", title: "Fix leaking faucet (fixture)", requires_diagnosis: false,
  inspection_fee_cents: 0, fixed_pro_labor_payout_cents: 6500, city_label: "Orlando, FL", accepted_at: new Date().toISOString(), posted_at: new Date().toISOString() }, o);
const DEST_OK = { ok: true, job_id: JOB, status: "en_route", destination: { lat: DEST.lat, lng: DEST.lng, source: "stored_job_point" }, address: { line: null, unit: null, access_notes: null }, city_label: "Orlando, FL" };

async function renderApp(opts) {
  const { JSDOM, VirtualConsole } = require("jsdom");
  const babel = require("@babel/core");
  const React = require("react");
  const ReactDOMClient = require("react-dom/client");
  let ReactDOMLegacy = {};
  try { ReactDOMLegacy = require("react-dom"); } catch (e) { ReactDOMLegacy = {}; }
  const vc = new VirtualConsole();
  const logged = [];
  for (const k of ["log", "warn", "error", "info"]) vc.on(k, (...a) => logged.push(a.map(String).join(" ")));
  let html = read("prototype-pro.html");
  if (opts.diagnostics) html = html.replace("const HAVEN_NATIVE_SPIKE_DIAGNOSTICS = false;", "const HAVEN_NATIVE_SPIKE_DIAGNOSTICS = true;");
  const dom = new JSDOM(html, { url: "https://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
  const { window } = dom;
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.cancelAnimationFrame = window.cancelAnimationFrame || (id => clearTimeout(id));
  window.localStorage.clear();
  const browserGeoUsed = { n: 0 };
  Object.defineProperty(window.navigator, "geolocation", { configurable: true, value: {
    watchPosition() { browserGeoUsed.n++; return 99; }, clearWatch() {}, getCurrentPosition() { browserGeoUsed.n++; },
  } });
  const nat = fakeNative(opts.platform || "ios", { http: (req, n) => opts.live(n) });
  window.Capacitor = nat.Capacitor;
  const calls = [];
  const state = { rows: opts.rows || [], session: { access_token: "tok", user: { id: PRO_ID, email: "pro@example.com", user_metadata: { role: "pro" } } } };
  window.fetch = async (url, init) => {
    url = String(url); init = init || {};
    const call = { url, method: init.method || "GET", body: init.body || null };
    calls.push(call);
    if (url.endsWith("/auth/v1/health")) return json(200, {});
    if (url.includes("/rpc/is_qa_tester")) return json(200, false);
    if (url.includes("/rest/v1/profiles")) return json(200, [profileRow()]);
    if (url.includes(LIVE_PATH)) return json(200, { ok: true });
    if (url.includes("/rpc/get_assigned_job_destination")) return json(200, DEST_OK);
    if (url.includes("/rpc/jobs_posted_within_radius")) return json(200, []);
    if (/\/rest\/v1\/jobs\?pro_id=eq\..*status=in\./.test(url)) return json(200, state.rows);
    if (/select=id,status$/.test(url)) return json(200, [{ id: JOB, status: (state.rows[0] && state.rows[0].status) || "en_route" }]);
    if (call.method === "PATCH" && /\/rest\/v1\/jobs/.test(url)) {
      const body = JSON.parse(init.body || "{}");
      if (body.status) state.rows = state.rows.map(r => ({ ...r, status: body.status }));
      return json(200, [{ id: JOB, status: body.status || "arrived", pro_id: PRO_ID }]);
    }
    return json(200, []);
  };
  window.supabase = { createClient() { return { auth: {
    async getSession() { return { data: { session: state.session }, error: null }; },
    async getUser() { return { data: { user: state.session && state.session.user }, error: null }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    async signOut() { state.session = null; return { error: null }; },
  } }; } };
  const ReactDOM = Object.assign({}, ReactDOMLegacy, ReactDOMClient);
  window.React = React; window.ReactDOM = ReactDOM;
  global.window = window; global.document = window.document; global.React = React; global.ReactDOM = ReactDOM;
  const src = window.document.querySelector('script[type="text/babel"]').textContent || "";
  window.eval(babel.transformSync(src, { filename: "p.jsx", babelrc: false, configFile: false,
    presets: [[require.resolve("@babel/preset-env"), { targets: { node: "current" } }], [require.resolve("@babel/preset-react"), { runtime: "classic" }]] }).code);
  return { window, calls, state, nat, browserGeoUsed, logged };
}
const leaf = w => Array.from(w.document.querySelectorAll("#root *")).filter(e => e.children.length === 0 && e.tagName !== "STYLE").map(e => e.textContent).join(" ");
async function waitFor(w, pred, label, tries) { for (let i = 0; i < (tries || 200); i++) { await sleep(25); if (pred(w)) return; } throw new Error("timed out: " + label); }
function clickText(w, re) {
  const el = Array.from(w.document.querySelectorAll("#root *")).filter(e => e.children.length === 0 && re.test((e.textContent || "").trim())).pop();
  if (!el) throw new Error("no element " + re);
  el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
}
const button = (w, label, inDialog) => Array.from(w.document.querySelectorAll("button")).find(b => b.textContent.trim() === label && (inDialog === undefined || !!b.closest('[role="dialog"]') === inDialog));
const notice = w => w.document.querySelector('[data-testid="live-share-notice"]');
const fastRateLimited = () => ({ status: 200, data: { ok: false, error: "rate_limited", retry_after_s: 0.2 } });
async function openJob(w) { clickText(w, /My Jobs$/); await sleep(150); clickText(w, /Fix leaking faucet/); await sleep(200); }

async function appChecks() {
  console.log("N6 App on a mocked native runtime:");
  for (const platform of ["ios", "android"]) {
    const app = await renderApp({ platform, rows: [activeRow()], live: fastRateLimited, diagnostics: true });
    const w = app.window;
    await waitFor(w, () => app.nat.log.addWatcher.length === 1, platform + " watcher");
    ok(app.browserGeoUsed.n === 0, "N6. " + platform + ": the en-route watch uses the native plugin, not the browser's location");
    app.nat.emit(pluginLoc(NEAR));
    await waitFor(w, () => app.nat.log.http.filter(r => r.url.includes(LIVE_PATH)).length >= 2, platform + " native sends");
    const live = app.nat.log.http.filter(r => r.url.includes(LIVE_PATH));
    ok(live[0].method === "POST" && live[0].data.p_job_id === JOB && live[0].data.p_lat === NEAR.lat && typeof live[0].data.p_captured_at === "string", "N6. " + platform + ": a plugin position is sent through native HTTP with the job id and fix time");
    ok(!app.calls.some(c => c.url.includes(LIVE_PATH)), "N6. " + platform + ": the web view's fetch never carries the live point");
    await openJob(w);
    await waitFor(w, x => !!notice(x), "notice");
    const panel = w.document.querySelector('[data-testid="live-diag"]');
    ok(!!panel && /Positions received: [1-9]/.test(panel.textContent) && !hasCoord(panel.textContent), "N7. " + platform + ": the spike panel shows counts, never coordinates");
    // Fix 1 on native: permission revoked mid-drive.
    app.nat.fail({ code: "NOT_AUTHORIZED", message: "Permission denied." });
    await sleep(80);
    const n = app.nat.log.http.length;
    await sleep(900);
    ok(app.nat.log.http.length === n, "N6. " + platform + ": NOT_AUTHORIZED stops sending at once (Fix 1)");
    ok(notice(w).getAttribute("data-live-state") === "no-permission", "N6. " + platform + ": the notice says the location isn't shared without permission");
    ok(!app.logged.some(hasCoord), "N6. " + platform + ": no coordinates in console output");
    w.close();
  }
  {
    // Arrived and sign-out remove the plugin watcher (Fix 2 path, native).
    const app = await renderApp({ platform: "ios", rows: [activeRow()], live: () => ({ status: 200, data: { ok: true } }) });
    const w = app.window;
    await waitFor(w, () => app.nat.log.addWatcher.length === 1 && app.nat.watchers.size === 1, "watcher");
    app.nat.emit(pluginLoc(NEAR));
    await openJob(w);
    await waitFor(w, x => !!button(x, "I've Arrived"), "arrival gate");
    button(w, "I've Arrived").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await waitFor(w, () => app.state.rows[0].status === "arrived" && app.nat.watchers.size === 0, "arrived removes watcher");
    ok(app.nat.log.removeWatcher.length >= 1 && app.nat.watchers.size === 0, "N6. Arrived ends the native location watcher (no tracking after arrival)");
    w.close();
  }
  {
    const app = await renderApp({ platform: "android", rows: [activeRow()], live: () => ({ status: 200, data: { ok: true } }) });
    const w = app.window;
    await waitFor(w, () => app.nat.watchers.size === 1, "watcher");
    clickText(w, /^Profile$/); await sleep(80);
    await waitFor(w, x => !!button(x, "Sign Out", false), "Sign Out");
    button(w, "Sign Out", false).click();
    await waitFor(w, x => !!button(x, "Sign out", true), "confirm");
    button(w, "Sign out", true).click();
    await waitFor(w, () => !app.state.session && app.nat.watchers.size === 0, "sign-out removes watcher");
    ok(app.nat.watchers.size === 0 && app.nat.log.removeWatcher.length >= 1, "N6. sign-out ends the native location watcher and its notification");
    w.close();
  }
}

function shippedChecks() {
  console.log("N7–N8 Shipped files and native project:");
  for (const f of ["index.html", "prototype-pro.html"]) {
    const h = read(f);
    ok(/const HAVEN_NATIVE_SPIKE_DIAGNOSTICS = false;/.test(h) && !/HAVEN_NATIVE_SPIKE_DIAGNOSTICS = true/.test(h), "N7. " + f + ": spike diagnostics are off in the web app");
  }
  const www = read("native/scripts/build-www.sh");
  ok(/HAVEN_NATIVE_SPIKE_DIAGNOSTICS\\s\*=\\s\*\(false\|!1\)/.test(www) && /native\/www|HERE\/www/.test(www), "N7. only the native copy (native/www) switches diagnostics on");
  const pkg = JSON.parse(read("native/package.json"));
  const d = Object.assign({}, pkg.dependencies, pkg.devDependencies);
  ok(d["@capacitor/core"] === "8.6.0" && d["@capacitor/ios"] === "8.6.0" && d["@capacitor/android"] === "8.6.0" && d["@capacitor/cli"] === "8.6.0" && d["@capacitor-community/background-geolocation"] === "1.3.1" && d["@capacitor/geolocation"] === "8.2.4", "N8. versions pinned exactly (Capacitor 8.6.0, background-geolocation 1.3.1, geolocation 8.2.4)");
  const cfg = JSON.parse(read("native/capacitor.config.json"));
  ok(cfg.webDir === "www" && cfg.android && cfg.android.useLegacyBridge === true && /spike/.test(cfg.appId), "N8. useLegacyBridge on (no 5-minute stall); spike app id");
  const plist = read("native/ios/App/App/Info.plist");
  ok(/<key>UIBackgroundModes<\/key>\s*<array>\s*<string>location<\/string>/.test(plist) && /NSLocationWhenInUseUsageDescription/.test(plist), "N8. iOS: location background mode and the While Using permission text");
  const manifests = [read("native/android/app/src/main/AndroidManifest.xml")].join("\n");
  ok(!/ACCESS_BACKGROUND_LOCATION/.test(manifests), "N8. Android: no background-location permission (foreground service instead)");
  ok(/BackgroundGeolocationService"[\s\S]*?android:exported="false"[\s\S]*?tools:replace="android:exported"/.test(manifests), "N8. Android: the location service is not reachable by other apps (exported=false)");
  const src = read("pro_native_location.js").replace(/\/\/[^\n]*/g, "");
  ok(!/console\.|localStorage/.test(src), "N7. the native module never logs and never stores anything");
}

(async () => {
  await unitChecks();
  await adapterChecks();
  await appChecks();
  shippedChecks();
  console.log(`OK: native background-location spike checks passed (${pass} assertions).`);
  process.exit(0);
})().catch(e => { console.error("FAIL:", e && e.message || e); process.exit(1); });
