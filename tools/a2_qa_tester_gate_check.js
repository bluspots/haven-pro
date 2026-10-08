#!/usr/bin/env node
"use strict";

/**
 * Phase 1B A2 checks (Pro): QA / Dev Testing controls are tester-only and
 * server-enforced, and they never advance anything locally.
 *
 * Mocked backend only (no real network). The signed-in Pro's tester flag
 * comes from POST /rest/v1/rpc/is_qa_tester.
 *
 * (1) Non-tester: no Dev Testing panel anywhere checked (Settings account
 *     state, Identity), no Load Demo Pro / Reset to Fresh Pro.
 * (2) Tester: panels show. "Load Demo Pro" / "Reset to Fresh Pro" and the
 *     credential panel are gone. A QA action PATCHes the tester's own
 *     profiles.pro_workspace first and changes local state only after the
 *     server accepts. A rejected write changes nothing locally.
 * (3) RPC error, RPC pending, signed out: hidden. A localStorage flag or a
 *     QA-looking email never shows them.
 * (4) Static SQL (docs/0024_qa_tester_gate.sql, byte copy of the Customer
 *     migration): the flag can't be self-set, the RPC is definer + not anon,
 *     and provider results require a tester. The SQL's self-settable status
 *     lists match what the real (non-QA) Pro flows set.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const PRO_ID = "cccccccc-dddd-4eee-8fff-000000000a2a";
const TEST_URL = "https://qa-gate-check.supabase.co";
const TEST_ANON = "test-anon-key-not-a-real-key";

function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function rootText(window) { return window.document.getElementById("root").textContent || ""; }
function screenText(window) {
  const rootEl = window.document.getElementById("root");
  return Array.from(rootEl.querySelectorAll("*")).filter(el => el.tagName !== "STYLE" && el.children.length === 0).map(el => el.textContent).join(" ");
}
async function waitFor(window, pred, label) {
  for (let i = 0; i < 150; i++) {
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
function findButton(window, label) {
  return Array.from(window.document.querySelectorAll("button")).find(b => (b.textContent || "").trim() === label) || null;
}

function profileRow(ws) {
  return {
    id: PRO_ID, role: "pro", display_name: "Ada Lovelace", email: "pro@example.com",
    first_name: "Ada", last_name: "Lovelace", home_city: "Orlando, FL", work_categories: ["Plumbing"],
    operating_lat: 28.5, operating_lng: -81.3,
    pro_workspace: Object.assign({
      onboardingStatus: "completed", onboardingStep: "done", firstName: "Ada", lastName: "Lovelace",
      homeCity: "Orlando, FL", travelRadius: 25, workCategories: ["Plumbing"],
      identityVerification: { provider: "persona", status: "not_started" },
      backgroundCheck: { provider: "checkr", status: "not_started" },
      payoutAccount: { provider: "stripe_connect", status: "not_started", payoutsEnabled: false },
      taxProfile: { status: "not_started" },
    }, ws || {}),
  };
}

function backend(opts) {
  const state = {
    qa: opts.qa,               // true | false | "error" | "hang"
    patchStatus: opts.patchStatus || 200,
    row: profileRow(),
    patches: [],
    rpcCalls: [],
    hang: [],
  };
  state.fetch = async (url, init) => {
    const method = (init && init.method) || "GET";
    if (url.endsWith("/auth/v1/health")) return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
    if (url.includes("/rest/v1/rpc/is_qa_tester")) {
      state.rpcCalls.push({ url, init });
      if (state.qa === "hang") return new Promise(resolve => state.hang.push(resolve));
      if (state.qa === "error") return { ok: false, status: 500, json: async () => ({ message: "boom" }), text: async () => "boom" };
      const body = state.qa === true;
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }
    if (url.includes("/rest/v1/profiles") && method === "PATCH") {
      let body = {};
      try { body = JSON.parse(init.body || "{}"); } catch (e) { body = {}; }
      state.patches.push(body);
      if (state.patchStatus !== 200) {
        return { ok: false, status: state.patchStatus, json: async () => ({ code: "42501" }), text: async () => JSON.stringify({ code: "42501", message: "QA tester only" }) };
      }
      state.row = Object.assign({}, state.row, body);
      const out = JSON.stringify([state.row]);
      return { ok: true, status: 200, json: async () => [state.row], text: async () => out };
    }
    if (url.includes("/rest/v1/profiles")) {
      const out = JSON.stringify([state.row]);
      return { ok: true, status: 200, json: async () => [state.row], text: async () => out };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
  };
  return state;
}

function authLib(sessionRef) {
  return {
    createClient() {
      return {
        auth: {
          async getSession() { return { data: { session: sessionRef.session || null }, error: null }; },
          async getUser() { return { data: { user: sessionRef.session ? sessionRef.session.user : null }, error: null }; },
          onAuthStateChange(cb) { (sessionRef.listeners = sessionRef.listeners || []).push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
          async signOut() { sessionRef.session = null; return { error: null }; },
          async signInWithPassword() { return { data: { session: null }, error: { message: "nope", status: 400 } }; },
          async signUp() { return { data: { session: null, user: null }, error: null }; },
        },
      };
    },
  };
}

async function renderApp(opts) {
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
  const seed = Object.assign({ haven_supabase_url: TEST_URL, haven_supabase_anon_key: TEST_ANON }, opts.storage || {});
  Object.keys(seed).forEach(k => window.localStorage.setItem(k, seed[k]));
  window.fetch = async (url, init) => opts.backend.fetch(String(url), init || {});
  window.supabase = authLib(opts.sessionRef);
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

function signedIn(email) {
  return { session: { access_token: "pro-access-token", user: { id: PRO_ID, email: email || "pro@example.com", user_metadata: { role: "pro" } } } };
}

async function openSettings(window) {
  await waitFor(window, t => t.includes("My Jobs"), "signed-in app");
  clickText(window, "Profile");
  await sleep(40);
  clickText(window, "Settings");
  await waitFor(window, t => t.includes("Sign Out"), "Settings");
}
async function openIdentity(window) {
  clickText(window, "Profile");
  await sleep(40);
  clickText(window, "Profile");
  await sleep(40);
  clickText(window, "Identity");
  await waitFor(window, t => t.includes("Identity Verification"), "Identity screen");
}
function identityRowStatus(window) {
  // Profile main: navRow("🪪", "Identity", statusLabelText(status), ...)
  const label = Array.from(window.document.querySelectorAll("#root *")).filter(el => el.children.length === 0 && (el.textContent || "").trim() === "Identity").pop();
  if (!label) throw new Error("no Identity row\n" + screenText(window).slice(0, 600));
  return (label.parentElement && label.parentElement.textContent) || "";
}
async function openProfileMain(window) {
  clickText(window, "Profile");
  await sleep(40);
  clickText(window, "Profile");
  await waitFor(window, t => t.includes("Identity"), "Profile main");
}
function assertNoQaControls(window, label) {
  const text = rootText(window);
  assert.ok(!text.includes("Dev Testing"), label + ": no Dev Testing panel");
  assert.ok(!findButton(window, "Jump to Marketplace Ready"), label + ": no Jump to Marketplace Ready");
  assert.ok(!text.includes("Load Demo Pro") && !text.includes("Reset to Fresh Pro"), label + ": no local account dev buttons");
}

async function withApp(opts, fn) {
  const window = await renderApp(opts);
  try { await fn(window); } finally { try { window.close(); } catch (e) { /* ignore */ } }
}

// (1) Non-tester
async function checkNonTester() {
  const be = backend({ qa: false });
  await withApp({ backend: be, sessionRef: signedIn() }, async (window) => {
    await openSettings(window);
    await sleep(60);
    assert.ok(be.rpcCalls.length >= 1, "non-tester: tester flag was asked from the server");
    const call = be.rpcCalls[be.rpcCalls.length - 1];
    assert.strictEqual(call.init.method, "POST", "RPC is POST");
    assert.strictEqual(call.init.headers.Authorization, "Bearer pro-access-token", "RPC uses the signed-in Pro bearer");
    assert.strictEqual(call.url, TEST_URL + "/rest/v1/rpc/is_qa_tester", "RPC URL");
    assertNoQaControls(window, "non-tester Settings");
    await openIdentity(window);
    assertNoQaControls(window, "non-tester Identity");
  });
}

// (2) Tester: panels shown, writes are server-first
async function checkTester() {
  const be = backend({ qa: true });
  await withApp({ backend: be, sessionRef: signedIn() }, async (window) => {
    await openSettings(window);
    await waitFor(window, () => !!findButton(window, "Jump to Marketplace Ready"), "tester sees Jump to Marketplace Ready");
    assert.ok(rootText(window).includes("Dev Testing"), "tester sees the Dev Testing panel");
    assert.ok(!rootText(window).includes("Load Demo Pro"), "Load Demo Pro removed (local account)");
    assert.ok(!rootText(window).includes("Reset to Fresh Pro"), "Reset to Fresh Pro removed (local account)");
    const before = be.patches.length;
    findButton(window, "Jump to Marketplace Ready").click();
    await waitFor(window, t => t.includes("Marketplace Ready (QA, saved)"), "server-accepted QA write");
    const qaPatch = be.patches.slice(before).find(p => p.pro_workspace && p.pro_workspace.identityVerification && p.pro_workspace.identityVerification.status === "verified");
    assert.ok(qaPatch, "Jump to Marketplace Ready PATCHes the tester's own pro_workspace");
    assert.strictEqual(qaPatch.pro_workspace.backgroundCheck.status, "clear");
    assert.strictEqual(qaPatch.pro_workspace.payoutAccount.status, "enabled");
    assert.strictEqual(qaPatch.pro_workspace.payoutAccount.payoutsEnabled, true);
    assert.strictEqual(qaPatch.pro_workspace.taxProfile.status, "verified");
    assert.strictEqual(qaPatch.first_name, "Ada", "QA write keeps the real profile name (no demo identity)");
    assert.ok(!("is_qa_tester" in qaPatch), "client never writes is_qa_tester");
    await openProfileMain(window);
    assert.ok(/Verified/.test(identityRowStatus(window)), "identity shows the server-accepted Verified status: " + identityRowStatus(window));
    await openIdentity(window);
    assert.ok(rootText(window).includes("Dev Testing"), "tester sees the Persona Dev Testing panel");
  });

  // Server rejects (e.g. 0024 guard): local state does not move.
  const be2 = backend({ qa: true, patchStatus: 403 });
  await withApp({ backend: be2, sessionRef: signedIn() }, async (window) => {
    await waitFor(window, t => t.includes("My Jobs"), "signed-in app");
    await openProfileMain(window);
    const statusBefore = identityRowStatus(window);
    assert.ok(/Not Started/.test(statusBefore), "identity starts Not Started: " + statusBefore);
    await openIdentity(window);
    await waitFor(window, t => t.includes("Dev Testing"), "tester sees the Persona panel");
    const verified = Array.from(window.document.querySelectorAll("button")).find(b => b.textContent.trim() === "Verified");
    assert.ok(verified, "Persona Verified button");
    const before = be2.patches.length;
    verified.click();
    await waitFor(window, t => t.includes("Haven didn't accept that QA change"), "rejected QA write toast");
    assert.ok(be2.patches.length > before, "QA action tried the server first");
    await openProfileMain(window);
    const statusAfter = identityRowStatus(window);
    assert.ok(/Not Started/.test(statusAfter) && !/Verified/.test(statusAfter), "rejected write does not change identity locally: " + statusAfter);
  });
}

// (3) Error / pending / signed out / localStorage + email never decide
async function checkFailClosed() {
  const be = backend({ qa: "error" });
  await withApp({ backend: be, sessionRef: signedIn() }, async (window) => {
    await openSettings(window);
    await sleep(80);
    assertNoQaControls(window, "RPC error");
  });

  const be2 = backend({ qa: "hang" });
  await withApp({ backend: be2, sessionRef: signedIn() }, async (window) => {
    await openSettings(window);
    await sleep(80);
    assertNoQaControls(window, "RPC pending");
    assert.ok(be2.hang.length >= 1, "RPC pending");
    be2.hang.forEach(resolve => resolve({ ok: true, status: 200, json: async () => true, text: async () => "true" }));
    await waitFor(window, () => !!findButton(window, "Jump to Marketplace Ready"), "controls appear once the server says tester");
  });

  const be3 = backend({ qa: false });
  await withApp({
    backend: be3,
    sessionRef: signedIn("qa-tester@haven.test"),
    storage: { haven_qa_tester: "true", haven_is_qa_tester: "true" },
  }, async (window) => {
    await openSettings(window);
    await sleep(80);
    assertNoQaControls(window, "localStorage flag + QA email");
  });

  const be4 = backend({ qa: true });
  await withApp({ backend: be4, sessionRef: { session: null } }, async (window) => {
    await sleep(200);
    assert.ok(!rootText(window).includes("Dev Testing"), "signed out: no Dev Testing");
    assert.strictEqual(be4.rpcCalls.length, 0, "signed out: tester RPC is not called");
  });
}

// (4) Static SQL + sources
function checkSql() {
  const sql = read("docs/0024_qa_tester_gate.sql");
  assert.ok(/add column if not exists is_qa_tester boolean not null default false/i.test(sql), "flag column");
  assert.ok(/revoke insert \(is_qa_tester\), update \(is_qa_tester\) on table public\.profiles from authenticated/i.test(sql), "no authenticated grant on the flag");
  assert.ok(/revoke insert \(is_qa_tester\), update \(is_qa_tester\) on table public\.profiles from anon/i.test(sql), "no anon grant on the flag");
  assert.ok(!/grant[^;]*\([^)]*is_qa_tester[^)]*\)[^;]*to\s+(authenticated|anon)/i.test(sql), "the flag is never granted to an API role");
  assert.ok(/is_qa_tester is founder-set only/.test(sql), "trigger rejects self-set");
  assert.ok(/current_user not in \('anon', 'authenticated'\)/.test(sql), "only owner / service_role are privileged");
  assert.ok(/create or replace function public\.is_qa_tester\(\)[\s\S]*security definer[\s\S]*auth\.uid\(\)/i.test(sql), "is_qa_tester() is definer and reads only the caller's row");
  assert.ok(/revoke all on function public\.is_qa_tester\(\) from anon/i.test(sql), "anon cannot call is_qa_tester()");
  assert.ok(/before insert or update on public\.profiles[\s\S]*profiles_guard_qa_fields/i.test(sql), "guard trigger on profiles");
  assert.ok(/payoutsEnabled is a provider result/.test(sql), "payoutsEnabled requires a tester");
  // Self-settable lists must match the real (non-QA) Pro flows.
  const lists = {
    identityVerification: ["not_started", "session_created", "pending"],
    backgroundCheck: ["not_started", "consent_required", "invited", "pending"],
    payoutAccount: ["not_started", "pending"],
    taxProfile: ["not_started", "pending"],
  };
  Object.keys(lists).forEach(section => {
    const re = new RegExp("when '" + section + "'\\s+then status in \\(([^)]*)\\)");
    const m = sql.match(re);
    assert.ok(m, "self-settable list for " + section);
    const got = m[1].split(",").map(s => s.trim().replace(/'/g, ""));
    assert.deepStrictEqual(got, lists[section], section + " self-settable statuses");
  });
  ["verified", "clear", "enabled", "failed", "needs_review", "consider", "disputed", "restricted", "expired"].forEach(s => {
    Object.keys(lists).forEach(section => assert.ok(!lists[section].includes(s), s + " is never self-settable"));
  });
  assert.ok(/-- update public\.profiles/.test(sql) && /971c6625-afa7-455b-9b8b-672c8dc562d9/.test(sql), "founder flag step is commented out");

  const jsx = read("home_services_pro_app.jsx");
  // Real flows only set self-settable statuses.
  assert.ok(/setIdentityVerification\(v => \(\{ \.\.\.v, status: "session_created"/.test(jsx) || jsx.includes('status: "session_created"'), "identity start sets session_created");
  assert.ok(jsx.includes('status: "consent_required"'), "background start sets consent_required");
  assert.ok(jsx.includes('status: "invited"'), "background authorize sets invited");
  // Dev setters go through the server-first commit only.
  const devSetters = ["devSetIdentityStatus", "devSetBackgroundStatus", "devSetPayoutStatus", "devSetTaxStatus", "devJumpToMarketplaceReady"];
  devSetters.forEach(name => {
    const start = jsx.indexOf("function " + name + "(");
    assert.ok(start > 0, name + " exists");
    const body = jsx.slice(start, jsx.indexOf("\n  }\n", start));
    assert.ok(body.includes("devCommitQaWorkspace("), name + " is a server-first write");
    assert.ok(!/\bset(IdentityVerification|BackgroundCheck|PayoutAccount|TaxProfile)\(/.test(body), name + " does not change local state directly");
    assert.ok(!body.includes('accountSourceRef.current = "local"'), name + " does not switch to a local account");
  });
  assert.ok(!jsx.includes("function loadDemoPro") && !jsx.includes("function resetToFreshPro"), "local-account dev functions removed");
  assert.ok(!jsx.includes("devSetCredentialStatus"), "credential-source dev panel removed (credentials are local only)");
  const panel = jsx.slice(jsx.indexOf("function devTestPanel("), jsx.indexOf("function devTestPanel(") + 400);
  assert.ok(/if \(!qaTester \|\| !authSession/.test(panel), "devTestPanel renders only for a server-confirmed tester");
  assert.ok(!/localStorage[^\n]*qa/i.test(jsx) && !/qa[^\n]*localStorage/i.test(jsx), "tester flag never read from localStorage");
  const adapter = read("backend_adapter.js");
  assert.ok(adapter.includes("/rest/v1/rpc/is_qa_tester"), "adapter calls is_qa_tester");
  assert.ok(/return body === true;/.test(adapter), "only a JSON true counts");
  for (const built of ["prototype-pro.html", "index.html"]) {
    const html = read(built);
    assert.ok(html.includes("fetchHavenIsQaTester") && html.includes("devCommitQaWorkspace"), built + ": A2 gate built in");
    assert.ok(!html.includes('label: "Load Demo Pro"') && !html.includes('label: "Reset to Fresh Pro"'), built + ": no Load Demo Pro / Reset to Fresh Pro buttons");
  }
}


// ── (5) Stale-cache recovery (guard rejection -> refetch -> retry once) ──
const OTHER_ID = "cccccccc-dddd-4eee-8fff-000000000b2b";
const SELF_SETTABLE = {
  identityVerification: ["not_started", "session_created", "pending"],
  backgroundCheck: ["not_started", "consent_required", "invited", "pending"],
  payoutAccount: ["not_started", "pending"],
  taxProfile: ["not_started", "pending"],
};
function wsStatus(ws, key) {
  const v = ws && typeof ws === "object" ? ws[key] : null;
  const s = v && typeof v === "object" && typeof v.status === "string" ? v.status.trim().toLowerCase() : "";
  return s || "not_started";
}
// Mirrors 0024 profiles_guard_qa_fields for a non-tester row.
function guardViolation(oldWs, newWs) {
  for (const key of Object.keys(SELF_SETTABLE)) {
    const a = wsStatus(oldWs, key);
    const b = wsStatus(newWs, key);
    if (a !== b && !SELF_SETTABLE[key].includes(b)) return key + " status " + b;
  }
  const oldOn = !!(oldWs && oldWs.payoutAccount && oldWs.payoutAccount.payoutsEnabled === true);
  const newOn = !!(newWs && newWs.payoutAccount && newWs.payoutAccount.payoutsEnabled === true);
  if (newOn && !oldOn) return "payoutAccount.payoutsEnabled";
  return null;
}
function emptyRow(id) {
  return { id, role: "pro", display_name: null, email: "pro@example.com", first_name: null, last_name: null, home_city: null, work_categories: [], operating_lat: null, operating_lng: null, pro_workspace: {} };
}
function json(status, body) {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => text };
}
// mode: "guard" (emulate 0024), "alwaysGuard" (every PATCH is a guard 403),
// "nonGuard403" (plain 42501 permission error, not the guard)
function multiBackend(opts) {
  const state = { rows: opts.rows, testers: opts.testers || {}, mode: opts.mode || "guard", events: [] };
  state.fetch = async (url, init) => {
    const method = (init && init.method) || "GET";
    const m = url.match(/id=eq\.([^&]+)/);
    const uid = m ? decodeURIComponent(m[1]) : "";
    if (url.includes("/rest/v1/rpc/is_qa_tester")) {
      const auth = (init.headers && init.headers.Authorization) || "";
      const who = auth.endsWith(OTHER_ID) ? OTHER_ID : PRO_ID;
      return json(200, state.testers[who] === true);
    }
    if (url.includes("/rest/v1/profiles") && method === "PATCH") {
      let body = {};
      try { body = JSON.parse(init.body || "{}"); } catch (e) { body = {}; }
      const row = state.rows[uid];
      const ev = { type: "PATCH", uid, body };
      state.events.push(ev);
      if (state.mode === "nonGuard403") { ev.status = 403; return json(403, { code: "42501", message: "permission denied for table profiles" }); }
      const violation = state.mode === "alwaysGuard"
        ? "identityVerification status verified"
        : (!state.testers[uid] && body.pro_workspace ? guardViolation(row.pro_workspace, body.pro_workspace) : null);
      if (violation) { ev.status = 403; return json(403, { code: "42501", message: "QA tester only: " + violation + " is a provider result" }); }
      ev.status = 200;
      state.rows[uid] = Object.assign({}, row, body);
      return json(200, [state.rows[uid]]);
    }
    if (url.includes("/rest/v1/profiles")) {
      const recovery = /select=id,pro_workspace(&|$)/.test(url);
      state.events.push({ type: recovery ? "GET_WS" : "GET_PROFILE", uid });
      return json(200, state.rows[uid] ? [state.rows[uid]] : []);
    }
    return json(200, []);
  };
  state.count = (pred) => state.events.filter(pred).length;
  return state;
}
function sessionFor(uid, email) {
  return { access_token: "pro-access-token-" + uid, user: { id: uid, email, user_metadata: { role: "pro" } } };
}
function cachedWorkspace(uid, extra) {
  return JSON.stringify({ __v: 1, byUserId: { [uid]: Object.assign({
    onboardingStatus: "completed", onboardingStep: "done", firstName: "Grace", lastName: "Hopper",
    homeCity: "Tampa, FL", travelRadius: 25, workCategories: ["Plumbing"],
    identityVerification: { provider: "persona", status: "verified", verifiedAt: 1 },
  }, extra || {}) } });
}
async function settle(be, ms) {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    await sleep(ms || 60);
    if (be.events.length === last) return;
    last = be.events.length;
  }
}

async function checkStaleCacheRecovery() {
  // No server profile + cached verified -> rejected, refetched, reset, retried once.
  const be = multiBackend({ rows: { [PRO_ID]: emptyRow(PRO_ID) }, mode: "guard" });
  await withApp({
    backend: be,
    sessionRef: { session: sessionFor(PRO_ID, "pro@example.com") },
    storage: { haven_pro_workspace_v1: cachedWorkspace(PRO_ID) },
  }, async (window) => {
    await waitFor(window, t => t.includes("My Jobs"), "signed-in app from the device cache");
    await settle(be);
    const ev = be.events;
    const firstPatch = ev.findIndex(e => e.type === "PATCH");
    assert.ok(firstPatch >= 0, "cached profile is pushed to the empty server row");
    assert.strictEqual(ev[firstPatch].status, 403, "cached verified status is rejected by the guard");
    assert.strictEqual(ev[firstPatch].body.pro_workspace.identityVerification.status, "verified");
    assert.strictEqual(ev[firstPatch + 1] && ev[firstPatch + 1].type, "GET_WS", "guard rejection refetches the server profile");
    const retry = ev[firstPatch + 2];
    assert.ok(retry && retry.type === "PATCH", "then retries the save");
    assert.strictEqual(retry.status, 200, "retry is accepted");
    assert.strictEqual(retry.body.pro_workspace.identityVerification.status, "not_started", "retry sends the server value (missing -> not_started)");
    assert.strictEqual(retry.body.pro_workspace.payoutAccount.payoutsEnabled, false, "missing payoutsEnabled -> off");
    assert.strictEqual(retry.body.first_name, "Grace", "retry keeps the user's name");
    assert.strictEqual(retry.body.home_city, "Tampa, FL", "retry keeps the user's city");
    assert.strictEqual(be.count(e => e.type === "GET_WS"), 1, "one refetch");
    assert.strictEqual(be.count(e => e.type === "PATCH" && e.status === 403), 1, "only the stale save was rejected");
    assert.strictEqual(be.rows[PRO_ID].first_name, "Grace", "name reached the server");
    assert.strictEqual(be.rows[PRO_ID].home_city, "Tampa, FL", "city reached the server");
    assert.strictEqual(wsStatus(be.rows[PRO_ID].pro_workspace, "identityVerification"), "not_started", "server never got the stale verified");
    await openProfileMain(window);
    assert.ok(/Not Started/.test(identityRowStatus(window)), "local identity replaced with the server value: " + identityRowStatus(window));
    const cache = JSON.parse(window.localStorage.getItem("haven_pro_workspace_v1"));
    assert.strictEqual(cache.byUserId[PRO_ID].identityVerification.status, "not_started", "device cache replaced with the server value");
    assert.strictEqual(cache.byUserId[PRO_ID].firstName, "Grace", "device cache keeps the name");
  });
}

async function checkSameTabSwitch() {
  const testerRow = profileRow({
    identityVerification: { provider: "persona", status: "verified" },
    backgroundCheck: { provider: "checkr", status: "clear" },
    payoutAccount: { provider: "stripe", status: "enabled", payoutsEnabled: true, last4: "4242" },
    taxProfile: { status: "verified" },
  });
  const otherRow = {
    id: OTHER_ID, role: "pro", display_name: "Bo Smith", email: "bo@example.com",
    first_name: "Bo", last_name: "Smith", home_city: "Miami, FL", work_categories: ["Plumbing"],
    operating_lat: 25.7, operating_lng: -80.2,
    // Saved profile without any guarded section (the risky shape).
    pro_workspace: { onboardingStatus: "completed", onboardingStep: "done", travelRadius: 25, workCategories: ["Plumbing"] },
  };
  const be = multiBackend({ rows: { [PRO_ID]: testerRow, [OTHER_ID]: otherRow }, testers: { [PRO_ID]: true }, mode: "guard" });
  const sessionRef = { session: sessionFor(PRO_ID, "pro@example.com") };
  await withApp({ backend: be, sessionRef }, async (window) => {
    await waitFor(window, t => t.includes("My Jobs"), "tester signed in");
    await settle(be);
    await openProfileMain(window);
    assert.ok(/Verified/.test(identityRowStatus(window)), "tester's identity is Verified");
    clickText(window, "Settings");
    await waitFor(window, () => !!findButton(window, "Sign Out"), "Settings Sign Out");
    findButton(window, "Sign Out").click();
    await waitFor(window, t => t.includes("Signed out"), "signed out");
    // A non-tester signs in on the same tab.
    const before = be.events.length;
    sessionRef.session = sessionFor(OTHER_ID, "bo@example.com");
    (sessionRef.listeners || []).forEach(cb => cb("SIGNED_IN", sessionRef.session));
    await waitFor(window, t => t.includes("My Jobs"), "non-tester signed in");
    await settle(be);
    const otherPatches = be.events.slice(before).filter(e => e.type === "PATCH" && e.uid === OTHER_ID);
    assert.ok(otherPatches.length >= 1, "non-tester profile saves after sign-in");
    assert.strictEqual(otherPatches[0].status, 200, "first save for the next user passes (no carried-over statuses)");
    assert.ok(otherPatches.every(e => e.status === 200), "no guard rejection for the next user");
    const ws = otherPatches[0].body.pro_workspace;
    assert.strictEqual(wsStatus(ws, "identityVerification"), "not_started");
    assert.strictEqual(wsStatus(ws, "backgroundCheck"), "not_started");
    assert.strictEqual(wsStatus(ws, "payoutAccount"), "not_started");
    assert.strictEqual(ws.payoutAccount.payoutsEnabled, false, "payoutsEnabled reset to off");
    assert.strictEqual(wsStatus(ws, "taxProfile"), "not_started");
    assert.strictEqual(be.count(e => e.type === "GET_WS"), 0, "no recovery was needed");
    await openProfileMain(window);
    assert.ok(/Not Started/.test(identityRowStatus(window)), "next user's identity is the default: " + identityRowStatus(window));
  });
}

async function checkRetryAtMostOnce() {
  const be = multiBackend({ rows: { [PRO_ID]: emptyRow(PRO_ID) }, mode: "alwaysGuard" });
  await withApp({
    backend: be,
    sessionRef: { session: sessionFor(PRO_ID, "pro@example.com") },
    storage: { haven_pro_workspace_v1: cachedWorkspace(PRO_ID) },
  }, async (window) => {
    await waitFor(window, t => t.includes("My Jobs"), "signed-in app");
    await settle(be, 80);
    const patches = be.count(e => e.type === "PATCH");
    const refetchThenRetry = be.events.filter((e, i) => e.type === "GET_WS" && be.events[i + 1] && be.events[i + 1].type === "PATCH").length;
    assert.strictEqual(refetchThenRetry, 1, "exactly one retry after a refetch");
    assert.ok(patches <= 3, "no save loop (" + patches + " PATCHes)");
    assert.ok(be.count(e => e.type === "GET_WS") <= 2, "no refetch loop");
    await sleep(800);
    assert.strictEqual(be.count(e => e.type === "PATCH"), patches, "no further saves after the single retry");
  });
}

async function checkNonGuardRejection() {
  const be = multiBackend({ rows: { [PRO_ID]: emptyRow(PRO_ID) }, mode: "nonGuard403" });
  await withApp({
    backend: be,
    sessionRef: { session: sessionFor(PRO_ID, "pro@example.com") },
    storage: { haven_pro_workspace_v1: cachedWorkspace(PRO_ID) },
  }, async (window) => {
    await waitFor(window, t => t.includes("My Jobs"), "signed-in app");
    await settle(be, 80);
    assert.ok(be.count(e => e.type === "PATCH") >= 1, "save attempted");
    assert.strictEqual(be.count(e => e.type === "GET_WS"), 0, "a non-guard 42501 does not refetch");
    // Hydrate save (no email) is sent once; the later PATCH is the normal autosave, not a retry.
    assert.strictEqual(be.count(e => e.type === "PATCH" && !("email" in e.body)), 1, "a non-guard rejection is not retried");
    const n = be.count(e => e.type === "PATCH");
    assert.ok(n <= 2, "no save loop (" + n + " PATCHes)");
    await sleep(800);
    assert.strictEqual(be.count(e => e.type === "PATCH"), n, "no further saves");
    const cache = JSON.parse(window.localStorage.getItem("haven_pro_workspace_v1"));
    assert.strictEqual(cache.byUserId[PRO_ID].identityVerification.status, "verified", "existing handling: the cache is left as is");
  });
}

function checkRecoverySources() {
  const jsx = read("home_services_pro_app.jsx");
  const adapter = read("backend_adapter.js");
  assert.ok(/status !== 403/.test(adapter) && /"42501"/.test(adapter) && /\^QA tester only/.test(adapter), "guard rejection = 403 + 42501 + QA tester only message");
  const fn = jsx.slice(jsx.indexOf("async function saveProProfileWithGuardRecovery(") + 60, jsx.indexOf("function hydrateSignedInProProfile("));
  assert.strictEqual((fn.match(/saveHavenProProfile\(/g) || []).length, 2, "one save plus at most one retry");
  assert.ok(!fn.includes("saveProProfileWithGuardRecovery(userId"), "the retry never recurses");
  const clear = jsx.slice(jsx.indexOf("function clearAuthLinkedAccount("), jsx.indexOf("async function signOutHavenAccount("));
  ["setIdentityVerification(havenDefaultIdentityVerification())", "setBackgroundCheck(havenDefaultBackgroundCheck())", "setPayoutAccount(havenDefaultPayoutAccount())", "setTaxProfile(havenDefaultTaxProfile())"].forEach(s => {
    assert.ok(clear.includes(s), "sign-out resets: " + s);
  });
}

async function main() {
  checkSql();
  await checkNonTester();
  await checkTester();
  await checkFailClosed();
  checkRecoverySources();
  await checkStaleCacheRecovery();
  await checkSameTabSwitch();
  await checkRetryAtMostOnce();
  await checkNonGuardRejection();
  console.log("OK: Phase 1B A2 QA tester gate checks passed.");
}

main().catch(err => {
  const msg = String(err && err.stack ? err.stack : err).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<redacted-jwt>");
  console.error(msg);
  process.exit(1);
});
