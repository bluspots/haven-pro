#!/usr/bin/env node
"use strict";

/**
 * Live location while Driving to Job (Pro): pro_update_live_location (0032).
 * Founder approved 2026-11-06 (draft). Covers the brief's list:
 *  1. After a claim to en_route: one POST to /rest/v1/rpc/pro_update_live_location with
 *     { p_job_id, p_lat, p_lng } (+ optional p_captured_at) in the JSON body. Never GET,
 *     never coordinates on any URL.
 *  2. No session → no call.
 *  3. Board / unassigned / SIM jobs → no call.
 *  4. Any status other than en_route → no call; a running session stops.
 *  5. rate_limited → continues after the wait; tracking_not_active / not_found /
 *     not_authenticated / invalid_point / 401 / 403 → stops.
 *  6. A (0, 0) fix and a fix worse than ~100 m are not sent.
 *  7. Never the operating-area save, never jobs.lat / jobs.lng, never localStorage.
 *  8. The locked notice text on an en_route job screen.
 *  9. Sign-out stops sending.
 * 10. Destination RPC, map flag, arrival gate and board privacy stay green (their own
 *     suites run in `npm run verify`; the shipped-file checks here re-assert the basics).
 *
 * Coordinates are never printed: assertions report booleans only. Fixtures use a
 * public landmark (Orlando City Hall), never a real job's point. fetch and the
 * device location are mocked: this is not certification (Quagon tests the live backend).
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const PRO_ID = "cccccccc-dddd-4eee-8fff-0000000000b6";
const JOB = "aaaaaaaa-aaaa-4aaa-8aaa-0000000000b6";
const DEST = { lat: 28.538336, lng: -81.379234 };            // destination fixture (public landmark)
const NEAR = { lat: 28.538836, lng: -81.379234 };            // ~55 m north of it
const FAR = { lat: 28.548336, lng: -81.379234 };             // ~1.1 km north of it
const LIVE_PATH = "/rest/v1/rpc/pro_update_live_location";
const NOTICE = "Sharing your location with this customer until you arrive.";

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; console.log("  ✓ " + msg); }
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function json(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }; }
const pos = (p, o) => Object.assign({ coords: { latitude: p.lat, longitude: p.lng, accuracy: 10 }, timestamp: Date.now() }, o || {});
// Does a string contain any fixture coordinate (as typed in a URL or stored value)?
const hasCoord = s => [DEST, NEAR, FAR].some(p => String(s).includes(String(p.lat)) || String(s).includes(String(p.lng)));

// ── Sender (pure, fake clock) ────────────────────────────────────────────────
function loadLive() {
  const sandbox = { Math, Number, String, Promise, setTimeout, clearTimeout, Date };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("pro_live_location.js") + "\n;globalThis.__l = { havenLiveShareEligible, havenLiveFix, havenMetersBetween, havenCreateLiveSender, HAVEN_LIVE_NOTICE, HAVEN_LIVE_NO_PERMISSION, HAVEN_LIVE_STOPPED };", sandbox);
  return sandbox.__l;
}
function fakeClock() {
  let t = 1000000, seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: id => { timers.delete(id); },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [id, x];
        if (!next) break;
        timers.delete(next[0]); t = next[1].at; next[1].fn();
        await flush();
      }
      t = end; await flush();
    },
  };
}
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
function makeSender(L, results) {
  const clock = fakeClock();
  const sends = [];
  const stops = [];
  const s = L.havenCreateLiveSender(JOB, {
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    send: async (jobId, fix) => { sends.push({ jobId, fix, at: clock.now() }); const r = typeof results === "function" ? results(sends.length) : results; return r; },
    onStop: code => stops.push(code),
  });
  return { s, clock, sends, stops };
}

async function senderChecks() {
  const L = loadLive();
  console.log("Fix filter:");
  ok(!!L.havenLiveFix(pos(NEAR)), "a good fix is accepted");
  ok(L.havenLiveFix(pos({ lat: 0, lng: 0 })) === null, "6. an exact (0, 0) fix is never sent");
  ok(L.havenLiveFix(pos(NEAR, { coords: { latitude: NEAR.lat, longitude: NEAR.lng, accuracy: 150 } })) === null, "6. a fix worse than 100 m is never sent");
  ok(!!L.havenLiveFix(pos(NEAR, { coords: { latitude: NEAR.lat, longitude: NEAR.lng, accuracy: 100 } })), "a 100 m fix is still sent");
  ok([[NaN, 1], [1, Infinity], [91, 1], [1, -181], ["28", 1]].every(([a, b]) => L.havenLiveFix({ coords: { latitude: a, longitude: b, accuracy: 5 } }) === null), "non-finite or out-of-range values are never sent");
  const f = L.havenLiveFix(pos(NEAR));
  ok(!("accuracy" in f) && Object.keys(f).sort().join() === "capturedAt,lat,lng", "accuracy is checked, never kept or sent");

  console.log("Eligibility:");
  const base = { id: JOB, backendClaimed: true };
  ok(L.havenLiveShareEligible({ ...base, status: "en_route" }, true), "an assigned backend job that is en_route shares");
  ok(["posted", "arrived", "diagnosing", "materials_requested", "materials_approved", "in_progress", "complete", "cancelled", "inspection_completed", "materials_declined"]
    .every(st => !L.havenLiveShareEligible({ ...base, status: st }, true)), "4. every status other than en_route never shares");
  ok(!L.havenLiveShareEligible({ id: JOB, status: "en_route" }, true), "3. an unassigned / board job (not backend-claimed) never shares");
  ok(!L.havenLiveShareEligible({ id: "sim-job-1", status: "en_route", backendClaimed: true }, true), "3. a SIM/demo job never shares");
  ok(!L.havenLiveShareEligible({ ...base, status: "en_route" }, false), "no backend configured → never shares");

  console.log("Cadence:");
  {
    const { s, clock, sends } = makeSender(L, { state: "ok" });
    s.onPosition(pos(NEAR)); await flush();
    ok(sends.length === 1 && sends[0].jobId === JOB, "the first good fix is sent at once");
    await clock.advance(3000); s.onPosition(pos(FAR)); await flush();
    ok(sends.length === 1, "moving: nothing sooner than 10 s after the last send");
    await clock.advance(7000);
    ok(sends.length === 2 && sends[1].at - sends[0].at === 10000 && sends[1].fix.lat === FAR.lat, "moving ≥25 m: the latest fix is sent 10 s after the last");
    await clock.advance(29000);
    ok(sends.length === 2, "not moving: no send before the 30 s heartbeat");
    await clock.advance(1000);
    ok(sends.length === 3 && sends[2].at - sends[1].at === 30000, "not moving: 30 s heartbeat");
    s.onPosition(pos({ lat: FAR.lat + 0.0001, lng: FAR.lng })); await flush(); // ~11 m
    await clock.advance(10000);
    ok(sends.length === 3, "under 25 m of movement stays on the 30 s heartbeat");
    const fixAt = clock.now() - 10000;
    await clock.advance(200000);
    const afterStale = sends.length;
    await clock.advance(300000);
    ok(sends.length === afterStale && sends.every(x => x.fix.receivedAt === undefined || x.at - x.fix.receivedAt <= 120000) && sends[sends.length - 1].at - fixAt <= 120000,
      "a fix older than 2 minutes is not repeated as a heartbeat (a silent device stops the sends)");
    const count = sends.length;
    s.stop(); s.onPosition(pos(NEAR)); await clock.advance(60000);
    ok(sends.length === count && s.isStopped(), "stop() ends the session: no more sends");
  }
  {
    const { s, clock, sends } = makeSender(L, n => (n === 1 ? { state: "rate_limited", retryAfterS: 3 } : { state: "ok" }));
    s.onPosition(pos(NEAR)); await flush();
    await clock.advance(2999);
    ok(sends.length === 1 && !s.isStopped(), "5. rate_limited is not a failure: the session continues");
    await clock.advance(1);
    ok(sends.length === 2, "5. rate_limited: retried after retry_after_s");
  }
  {
    const { s, clock, sends } = makeSender(L, n => (n === 1 ? { state: "rate_limited" } : { state: "ok" }));
    s.onPosition(pos(NEAR)); await flush();
    await clock.advance(3999);
    ok(sends.length === 1, "rate_limited without retry_after_s: waits 4 s");
    await clock.advance(1);
    ok(sends.length === 2, "rate_limited without retry_after_s: retried at 4 s");
  }
  for (const code of ["tracking_not_active", "not_found", "not_authenticated", "invalid_point", "http_400"]) {
    const { s, clock, sends, stops } = makeSender(L, { state: "stop", error: code });
    s.onPosition(pos(NEAR)); await flush();
    s.onPosition(pos(FAR)); await clock.advance(120000);
    ok(sends.length === 1 && s.isStopped() && stops[0] === code, "5. " + code + " stops the session");
  }
  {
    const { s, clock, sends } = makeSender(L, n => (n === 1 ? { state: "retry" } : { state: "ok" }));
    s.onPosition(pos(NEAR)); await flush();
    await clock.advance(9999);
    ok(sends.length === 1 && !s.isStopped(), "no connection: the session is kept (not a refusal)");
    await clock.advance(1);
    ok(sends.length === 2, "no connection: tried again 10 s later");
  }
  {
    const { s, clock, sends } = makeSender(L, { state: "ok" });
    s.onPosition(pos({ lat: 0, lng: 0 })); s.onPosition(pos(NEAR, { coords: { latitude: NEAR.lat, longitude: NEAR.lng, accuracy: 500 } }));
    await clock.advance(60000);
    ok(sends.length === 0, "6. junk and inaccurate fixes never start a send");
  }
}

// ── Adapter ──────────────────────────────────────────────────────────────────
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
  vm.runInContext(read("backend_adapter.js") + "\n;globalThis.__api = { sendProLiveLocation };", sandbox);
  return { api: sandbox.__api, store };
}
async function adapterChecks() {
  console.log("Write path (adapter):");
  const fix = { lat: NEAR.lat, lng: NEAR.lng, capturedAt: Date.UTC(2026, 10, 6, 18, 0, 0) };
  {
    const hits = [];
    const { api, store } = loadAdapter(async (url, init) => { hits.push({ url: String(url), init }); return json(200, { ok: true, received_at: "2026-11-06T18:00:01Z" }); }, true);
    const r = await api.sendProLiveLocation(JOB, fix);
    const h = hits[0];
    const body = JSON.parse(h.init.body);
    ok(r.state === "ok" && hits.length === 1, "1. ok:true → one call, ok");
    ok(h.init.method === "POST" && new URL(h.url).pathname === LIVE_PATH && !new URL(h.url).search, "1. POST to /rest/v1/rpc/pro_update_live_location with no query string");
    ok(Object.keys(body).sort().join() === "p_captured_at,p_job_id,p_lat,p_lng" && body.p_job_id === JOB && body.p_lat === NEAR.lat && body.p_lng === NEAR.lng, "1. the point travels only in the JSON body { p_job_id, p_lat, p_lng, p_captured_at }");
    ok(body.p_captured_at === "2026-11-06T18:00:00.000Z", "1. p_captured_at is the device fix time as UTC ISO");
    ok(!hasCoord(h.url), "1. no coordinates on the URL");
    ok(h.init.headers.apikey && /^Bearer tok$/.test(h.init.headers.Authorization) && h.init.headers["Content-Type"] === "application/json" && h.init.headers.Accept === "application/json", "anon apikey + session JWT, JSON headers");
    ok(!Object.values(store).some(hasCoord), "7. nothing is written to localStorage");
    const r2 = await api.sendProLiveLocation(JOB, { lat: NEAR.lat, lng: NEAR.lng, capturedAt: null });
    ok(r2.state === "ok" && !("p_captured_at" in JSON.parse(hits[1].init.body)), "p_captured_at is left out when the device gave no time");
  }
  {
    let called = 0;
    const { api } = loadAdapter(async () => { called++; return json(200, { ok: true }); }, false);
    const r = await api.sendProLiveLocation(JOB, fix);
    ok(called === 0 && r.state === "stop" && r.error === "not_authenticated", "2. no session → no call, session stops");
  }
  for (const [label, resp, want] of [
    ["rate_limited", () => json(200, { ok: false, error: "rate_limited", retry_after_s: 3 }), r => r.state === "rate_limited" && r.retryAfterS === 3],
    ["tracking_not_active", () => json(200, { ok: false, error: "tracking_not_active" }), r => r.state === "stop" && r.error === "tracking_not_active"],
    ["not_found", () => json(200, { ok: false, error: "not_found" }), r => r.state === "stop" && r.error === "not_found"],
    ["not_authenticated", () => json(200, { ok: false, error: "not_authenticated" }), r => r.state === "stop" && r.error === "not_authenticated"],
    ["invalid_point", () => json(200, { ok: false, error: "invalid_point" }), r => r.state === "stop" && r.error === "invalid_point"],
    ["401", () => json(401, {}), r => r.state === "stop" && r.error === "not_authenticated"],
    ["403", () => json(403, {}), r => r.state === "stop" && r.error === "not_authenticated"],
    ["400", () => json(400, {}), r => r.state === "stop"],
    ["500", () => json(500, {}), r => r.state === "retry"],
    ["network", () => { throw new Error("offline"); }, r => r.state === "retry"],
  ]) {
    const { api } = loadAdapter(async () => resp(), true);
    ok(want(await api.sendProLiveLocation(JOB, fix)), "5. " + label + " → " + (label === "rate_limited" ? "wait and continue" : (label === "500" || label === "network") ? "keep the session, try again" : "stop"));
  }
}

// ── App (jsdom, built prototype-pro.html) ────────────────────────────────────
function profileRow() {
  return {
    id: PRO_ID, role: "pro", display_name: "Test Pro", email: "pro@example.com", first_name: "Test", last_name: "Pro",
    home_city: "Orlando, FL", work_categories: ["Plumbing"], operating_lat: 28.5, operating_lng: -81.3,
    pro_workspace: {
      onboardingStatus: "completed", onboardingStep: "done", firstName: "Test", lastName: "Pro", homeCity: "Orlando, FL",
      travelRadius: 25, workCategories: ["Plumbing"],
      identityVerification: { provider: "persona", status: "verified" }, backgroundCheck: { provider: "checkr", status: "clear" },
      payoutAccount: { provider: "stripe_connect", status: "enabled", payoutsEnabled: true }, taxProfile: { status: "verified" },
    },
  };
}
const activeRow = o => Object.assign({ id: JOB, status: "en_route", pro_id: PRO_ID, category: "Plumbing", title: "Fix leaking faucet (fixture)", requires_diagnosis: false,
  inspection_fee_cents: 0, fixed_pro_labor_payout_cents: 6500, city_label: "Orlando, FL", accepted_at: new Date().toISOString(), posted_at: new Date().toISOString() }, o);
const boardRow = o => Object.assign({ id: JOB, status: "posted", pro_id: null, category: "Plumbing", title: "Fix leaking faucet (fixture)",
  fixed_pro_labor_payout_cents: 6500, requires_diagnosis: false, emergency: false, posted_at: new Date().toISOString(), inspection_fee_cents: 0, city_label: "Orlando", distance_mi: 2.5 }, o);
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
  const dom = new JSDOM(read("prototype-pro.html"), { url: "https://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
  const { window } = dom;
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.cancelAnimationFrame = window.cancelAnimationFrame || (id => clearTimeout(id));
  window.localStorage.clear();
  const geo = { watchers: new Map(), seq: 0, cleared: 0 };
  geo.emit = p => { for (const w of geo.watchers.values()) w.ok(p); };
  geo.fail = code => { for (const w of geo.watchers.values()) if (w.err) w.err({ code }); };
  Object.defineProperty(window.navigator, "geolocation", { configurable: true, value: {
    watchPosition(okCb, errCb) {
      const id = ++geo.seq; geo.watchers.set(id, { ok: okCb, err: errCb });
      setTimeout(() => { if (!geo.watchers.has(id)) return; if (opts.denied) errCb && errCb({ code: 1 }); else okCb(pos(opts.at || NEAR)); }, 5);
      return id;
    },
    clearWatch(id) { if (geo.watchers.delete(id)) geo.cleared++; },
    getCurrentPosition(okCb) { okCb(pos(opts.at || NEAR)); },
  } });
  const calls = [];
  const state = { rows: opts.rows || [], session: { access_token: "tok", user: { id: PRO_ID, email: "pro@example.com", user_metadata: { role: "pro" } } } };
  window.fetch = async (url, init) => {
    url = String(url); init = init || {};
    const call = { url, method: init.method || "GET", body: init.body || null };
    calls.push(call);
    if (url.endsWith("/auth/v1/health")) return json(200, {});
    if (url.includes("/rpc/is_qa_tester")) return json(200, false);
    if (url.includes("/rest/v1/profiles")) return json(200, [profileRow()]);
    if (url.includes(LIVE_PATH)) return opts.live(calls.filter(c => c.url.includes(LIVE_PATH)).length);
    if (url.includes("/rpc/get_assigned_job_destination")) return json(200, DEST_OK);
    if (url.includes("/rpc/jobs_posted_within_radius")) return json(200, opts.board ? [boardRow()] : []);
    if (url.includes("/rpc/pro_claim_job")) { state.rows = [activeRow()]; return json(200, [{ id: JOB, status: "en_route", pro_id: PRO_ID, city_label: "Orlando" }]); }
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
  return { window, calls, state, geo, logged };
}
const leaf = w => Array.from(w.document.querySelectorAll("#root *")).filter(e => e.children.length === 0 && e.tagName !== "STYLE").map(e => e.textContent).join(" ");
async function waitFor(w, pred, label, tries) { for (let i = 0; i < (tries || 200); i++) { await sleep(25); if (pred(w)) return; } throw new Error("timed out: " + label); }
function clickText(w, re) {
  const el = Array.from(w.document.querySelectorAll("#root *")).filter(e => e.children.length === 0 && re.test((e.textContent || "").trim())).pop();
  if (!el) throw new Error("no element " + re);
  el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
}
const button = (w, label, inDialog) => Array.from(w.document.querySelectorAll("button")).find(b => b.textContent.trim() === label && (inDialog === undefined || !!b.closest('[role="dialog"]') === inDialog));
const liveCalls = calls => calls.filter(c => c.url.includes(LIVE_PATH));
const notice = w => w.document.querySelector('[data-testid="live-share-notice"]');
const noticeText = w => Array.from(notice(w).querySelectorAll('span:not([aria-hidden="true"])')).map(x => x.textContent).join("").trim();
// rate_limited with a 0.2 s wait makes the app retry quickly, so "still sending"
// and "stopped sending" can be observed in real time.
const fastRateLimited = () => json(200, { ok: false, error: "rate_limited", retry_after_s: 0.2 });

function noLeaks(app, label) {
  const w = app.window;
  const ls = Object.keys(w.localStorage).map(k => w.localStorage.getItem(k)).join("\n");
  ok(!app.calls.some(c => hasCoord(c.url)), "1. " + label + ": no coordinates on any request URL");
  ok(!liveCalls(app.calls).some(c => c.method !== "POST"), "1. " + label + ": the live-location RPC is only ever POSTed");
  ok(!app.calls.some(c => /\/rest\/v1\/profiles/.test(c.url) && c.method !== "GET") && !app.calls.some(c => c.body && /operating_lat|operating_lng/.test(c.body)), "7. " + label + ": the operating area is never written");
  ok(!app.calls.some(c => /\/rest\/v1\/jobs/.test(c.url) && c.method !== "GET" && c.body && /"lat"|"lng"/.test(c.body)), "7. " + label + ": jobs.lat / jobs.lng are never written");
  ok(!hasCoord(ls), "7. " + label + ": the live point is never in localStorage");
  ok(!app.logged.some(hasCoord), "no coordinates in console output");
}

async function appChecks() {
  console.log("App: claim from the board → sending starts:");
  {
    const app = await renderApp({ board: true, live: () => json(200, { ok: true, received_at: new Date().toISOString() }) });
    const w = app.window;
    await waitFor(w, x => leaf(x).includes("Fix leaking faucet"), "board job");
    ok(liveCalls(app.calls).length === 0, "3. a board (unassigned) job never sends");
    button(w, "Accept Job").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await waitFor(w, () => liveCalls(app.calls).length >= 1, "first live send after the claim");
    await sleep(150);
    const c = liveCalls(app.calls)[0];
    const body = JSON.parse(c.body);
    ok(liveCalls(app.calls).length === 1 && c.method === "POST" && new URL(c.url).pathname === LIVE_PATH && !new URL(c.url).search, "1. after the claim: one POST to pro_update_live_location, no query string");
    ok(body.p_job_id === JOB && body.p_lat === NEAR.lat && body.p_lng === NEAR.lng && typeof body.p_captured_at === "string", "1. the device point is in the JSON body with the job id and fix time");
    ok(app.geo.watchers.size === 1, "one location watch (the existing one), not a second");
    noLeaks(app, "claim");
    w.close();
  }

  console.log("App: restored en_route job, notice, arrival stops sending:");
  {
    const app = await renderApp({ rows: [activeRow()], at: NEAR, live: fastRateLimited });
    const w = app.window;
    await waitFor(w, x => leaf(x).includes("My Jobs"), "signed in");
    await waitFor(w, () => liveCalls(app.calls).length >= 3, "sending on rehydrate");
    ok(true, "a rehydrated backend job that is en_route sends");
    ok(true, "5. rate_limited keeps the session going in the app (several attempts after waits)");
    clickText(w, /My Jobs$/); await sleep(150);
    clickText(w, /Fix leaking faucet/); await sleep(200);
    await waitFor(w, x => !!notice(x), "notice");
    ok(noticeText(w) === NOTICE && notice(w).getAttribute("data-live-state") === "sharing", "8. the en_route job screen shows exactly: " + NOTICE);
    ok(!notice(w).querySelector("button,input,[role=switch]"), "8. a notice, not a switch");
    await waitFor(w, x => !!button(x, "I've Arrived"), "arrival unlocked");
    ok(true, "10. the arrival gate still opens near the RPC destination");
    button(w, "I've Arrived").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await waitFor(w, () => app.state.rows[0].status === "arrived" && !notice(w), "arrived");
    await sleep(300);
    const n = liveCalls(app.calls).length;
    app.geo.emit(pos(FAR)); await sleep(800);
    ok(liveCalls(app.calls).length === n, "4. after Arrived nothing more is sent");
    ok(app.geo.watchers.size === 0, "4. the location watch ends when no job is en_route");
    noLeaks(app, "arrival");
    w.close();
  }

  console.log("App: non-en_route statuses never send:");
  for (const st of ["arrived", "in_progress", "diagnosing"]) {
    const app = await renderApp({ rows: [activeRow({ status: st })], live: () => json(200, { ok: true }) });
    const w = app.window;
    await waitFor(w, x => leaf(x).includes("My Jobs"), "signed in");
    await sleep(500);
    ok(liveCalls(app.calls).length === 0, "4. a restored " + st + " job never sends");
    w.close();
  }

  console.log("App: stopping responses:");
  for (const code of ["tracking_not_active", "not_found", "not_authenticated", "invalid_point"]) {
    const app = await renderApp({ rows: [activeRow()], live: () => json(200, { ok: false, error: code }) });
    const w = app.window;
    await waitFor(w, () => liveCalls(app.calls).length >= 1, "first send");
    app.geo.emit(pos(FAR)); await sleep(600); app.geo.emit(pos(NEAR)); await sleep(400);
    ok(liveCalls(app.calls).length === 1, "5. " + code + ": sending stops after the first refusal");
    clickText(w, /My Jobs$/); await sleep(150);
    clickText(w, /Fix leaking faucet/); await sleep(200);
    await waitFor(w, x => !!notice(x), "notice");
    ok(notice(w).getAttribute("data-live-state") === "stopped" && noticeText(w) !== NOTICE, "5. " + code + ": the screen says the location isn't being shared");
    w.close();
  }
  for (const [label, status] of [["401", 401], ["403", 403]]) {
    const app = await renderApp({ rows: [activeRow()], live: () => json(status, {}) });
    const w = app.window;
    await waitFor(w, () => liveCalls(app.calls).length >= 1, "first send");
    app.geo.emit(pos(FAR)); await sleep(600);
    ok(liveCalls(app.calls).length === 1, "5. " + label + ": sending stops");
    w.close();
  }

  console.log("App: permission denied:");
  {
    const app = await renderApp({ rows: [activeRow()], denied: true, live: () => json(200, { ok: true }) });
    const w = app.window;
    await waitFor(w, x => leaf(x).includes("My Jobs"), "signed in");
    clickText(w, /My Jobs$/); await sleep(150);
    clickText(w, /Fix leaking faucet/); await sleep(300);
    await waitFor(w, x => !!notice(x) && notice(x).getAttribute("data-live-state") === "no-permission", "no-permission notice");
    ok(liveCalls(app.calls).length === 0, "no location permission → no call, no invented point");
    ok(/doesn't have location permission/.test(noticeText(w)) && noticeText(w) !== NOTICE, "an honest line that the location isn't being shared without permission");
    w.close();
  }

  console.log("App: sign-out stops sending:");
  {
    const app = await renderApp({ rows: [activeRow()], live: fastRateLimited });
    const w = app.window;
    await waitFor(w, () => liveCalls(app.calls).length >= 2, "sending");
    clickText(w, /^Profile$/); await sleep(80);
    await waitFor(w, x => !!button(x, "Sign Out", false), "Sign Out");
    button(w, "Sign Out", false).click();
    await waitFor(w, x => !!button(x, "Sign out", true), "confirm");
    button(w, "Sign out", true).click();
    await waitFor(w, () => !app.state.session, "signed out");
    await sleep(400);
    const n = liveCalls(app.calls).length;
    app.geo.emit(pos(FAR)); await sleep(800);
    ok(liveCalls(app.calls).length === n, "9. after sign-out nothing more is sent");
    noLeaks(app, "sign-out");
    w.close();
  }
}

function shippedChecks() {
  console.log("Shipped files:");
  const app = read("home_services_pro_app.jsx");
  for (const f of ["index.html", "prototype-pro.html"]) {
    const html = read(f);
    ok(html.includes("rpc/pro_update_live_location") && html.includes(NOTICE), f + ": includes the live-location sender and the notice");
    ok(/const HAVEN_ASSIGNED_JOB_MAP_ENABLED = true;/.test(html) && /rpc\/get_assigned_job_destination/.test(html), "10. " + f + ": map flag still on, destination still via its RPC");
    ok(!/sb_secret_[A-Za-z0-9]|"role"\s*:\s*"service_role"|sk\.eyJ/.test(html), f + ": no secret key value");
  }
  ok((app.match(/watchPosition\(/g) || []).length === 1, "one watchPosition in the app (sending hooks onto the existing watch)");
  ok(!/visibilitychange/.test(app) && !/clearWatch/.test(app.replace(/return \(\) => navigator\.geolocation\.clearWatch\(watchId\);/, "")), "the watch is not stopped on visibilitychange / app hide");
  ok(/enableHighAccuracy: true/.test(app), "high accuracy stays on");
  ok(/stopLiveSharing\(\); \/\/ live location stops at sign-out/.test(app), "9. sign-out stops sharing");
  const stripComments = t => t.replace(/\/\/[^\n]*/g, "");
  const live = stripComments(read("pro_live_location.js")) + read("backend_adapter.js").slice(read("backend_adapter.js").indexOf("async function sendProLiveLocation"), read("backend_adapter.js").indexOf("// Read the assigned job's current status.")).replace(/\/\/[^\n]*/g, "");
  ok(!/console\.|localStorage/.test(live), "the sender never logs and never touches localStorage");
  ok(!/operating|setOperating|jobs\?|"lat"|"lng"/.test(live), "7. the sender never names the operating area or the jobs table");
  ok(/"pro_maps\.js" "pro_live_location\.js" "\$SRC"/.test(read("build-pro.sh")), "pro_live_location.js is part of the build");
}

(async () => {
  await senderChecks();
  await adapterChecks();
  await appChecks();
  shippedChecks();
  console.log(`OK: live location send checks passed (${pass} assertions).`);
  process.exit(0);
})().catch(e => { console.error("FAIL:", e && e.message || e); process.exit(1); });
