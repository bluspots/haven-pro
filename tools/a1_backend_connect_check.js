#!/usr/bin/env node
"use strict";

/**
 * Phase 1B A1 checks (Pro): connect automatically with the built-in public
 * Supabase config, show an error with Retry when Haven can't be reached, and
 * never fall back to a local/demo account.
 *
 * (a) A fresh browser (empty localStorage) gets a Supabase config and attempts
 *     to connect: the Auth client is created with the built-in URL + anon key,
 *     the Auth health endpoint is called, and the session is read. Mocked
 *     fetch / Auth client only — no real network.
 * (b) Network failure, Supabase down, and a missing Auth client each show the
 *     error + Retry; Retry re-attempts and recovers once Haven answers. A
 *     sign-in / sign-up that can't reach Auth also lands on the error screen.
 * (c) No demo fallback: no local account is created, nothing is saved as a
 *     local workspace, and a signed-in state without a session is an error
 *     (Retry → signed-out Welcome), never a usable app.
 * Config safety: the built-in key is public (JWT role "anon" for this project,
 * or sb_publishable_). service_role / secret keys fail the check.
 * QA fixes (#41 round 1):
 * - Runtime key guard: getSupabaseConfig() refuses service_role, sb_secret_,
 *   malformed JWTs, and a ref that doesn't match the URL host → error screen.
 * - A stored session is confirmed with auth.getUser() before the app renders.
 *   401/403 → local sign-out + cached profile cleared → sign-in gate.
 *   getUser network failure → error + Retry. Nothing renders while pending.
 * - Retry after a supabase-js CDN failure reloads the page.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const AUTH_UID = "11111111-1111-4111-8111-111111111111";
const ERROR_TITLE = "Can't connect to Haven";
const ERROR_DETAIL = "We couldn't reach Haven. Check your internet connection, then tap Retry.";

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function memoryStorage(seed) {
  const store = Object.assign({}, seed || {});
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    keys() { return Object.keys(store); },
  };
}

function loadAdapter(localStorage, supabaseLib, fetchImpl, sourceTransform) {
  const sandbox = {
    console, atob, window: { localStorage, supabase: supabaseLib }, fetch: fetchImpl,
    URL, encodeURIComponent, Date, JSON, Math, Array, Object, String, Number, Error, Promise, Set, Map,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const names = [
    "getSupabaseConfig", "havenConnectBackend", "havenAuthSignUp", "havenAuthSignIn", "havenAuthRestoreSession",
    "havenAuthErrorIsNetwork", "claimJobOnSupabase", "patchJobArrivedOnSupabase", "fetchPostedJobsFromSupabase",
    "HAVEN_SUPABASE_PUBLIC_CONFIG", "HAVEN_CONNECT_ERROR_TITLE", "HAVEN_CONNECT_ERROR_DETAIL",
    "havenSupabaseKeyIsPublic", "havenSupabaseProjectRef", "havenAuthErrorIsInvalidSession", "clearHavenProWorkspace",
  ];
  const src = typeof sourceTransform === "function" ? sourceTransform(read("backend_adapter.js")) : read("backend_adapter.js");
  vm.runInContext(src + "\n;globalThis.__haven = { " + names.join(", ") + " };", sandbox, { filename: "backend_adapter.js" });
  return sandbox.__haven;
}

function decodeJwtPayload(token) {
  const parts = String(token).split(".");
  assert.strictEqual(parts.length, 3, "anon key must be a JWT or an sb_publishable_ key");
  const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

// ── Config safety (never prints the key) ─────────────────────────────────
function checkPublicConfig() {
  const api = loadAdapter(memoryStorage(), null, async () => { throw new Error("no fetch"); });
  const cfg = api.HAVEN_SUPABASE_PUBLIC_CONFIG;
  assert.ok(cfg && typeof cfg.url === "string" && typeof cfg.anon === "string", "public config constant exists");
  assert.ok(/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(cfg.url), "project URL shape");
  const ref = cfg.url.slice("https://".length, cfg.url.indexOf("."));
  if (cfg.anon.startsWith("sb_publishable_")) {
    // Publishable key: public by construction.
  } else {
    assert.ok(!cfg.anon.startsWith("sb_secret_"), "secret keys must never ship");
    const claims = decodeJwtPayload(cfg.anon);
    assert.strictEqual(claims.role, "anon", "built-in key must be the anon (public) key");
    assert.strictEqual(claims.ref, ref, "anon key belongs to the configured project");
  }
  for (const rel of ["backend_adapter.js", "prototype-pro.html", "index.html"]) {
    const text = read(rel);
    assert.ok(!/sb_secret_[A-Za-z0-9_-]{8,}/.test(text), rel + " must not contain a secret key");
    const jwts = text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
    jwts.forEach(t => assert.strictEqual(decodeJwtPayload(t).role, "anon", rel + " ships only anon JWTs"));
    assert.ok(text.includes(cfg.url), rel + " ships the project URL");
  }
}

// ── (a) adapter: fresh storage gets the config; no localStorage override ──
async function checkAdapterConnect() {
  const empty = memoryStorage();
  const calls = [];
  const lib = {
    createClient(url, key) {
      calls.push(["createClient", url, key]);
      return { auth: { async getSession() { calls.push(["getSession"]); return { data: { session: null }, error: null }; } } };
    },
  };
  const hits = [];
  const api = loadAdapter(empty, lib, async (url, opts) => { hits.push({ url: String(url), opts }); return { ok: true, status: 200 }; });
  const cfg = api.getSupabaseConfig();
  assert.ok(cfg, "fresh browser gets a Supabase config");
  assert.strictEqual(cfg.url, api.HAVEN_SUPABASE_PUBLIC_CONFIG.url);
  assert.strictEqual(cfg.anon, api.HAVEN_SUPABASE_PUBLIC_CONFIG.anon);
  const connected = await api.havenConnectBackend();
  assert.strictEqual(connected.ok, true);
  assert.strictEqual(calls[0][1], cfg.url, "Auth client created for the built-in URL");
  assert.strictEqual(calls[0][2], cfg.anon, "Auth client created with the built-in anon key");
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].url, cfg.url + "/auth/v1/health", "connect calls the Auth health endpoint");
  assert.strictEqual(hits[0].opts.headers.apikey, cfg.anon, "health check sends the anon apikey");
  assert.ok(!hits[0].opts.headers.Authorization, "health check sends no user bearer");
  assert.deepStrictEqual(empty.keys(), [], "connecting writes nothing to localStorage");

  // A stale localStorage value cannot redirect the app (override removed).
  const tampered = memoryStorage({ haven_supabase_url: "https://evil.example.com", haven_supabase_anon_key: "x" });
  const api2 = loadAdapter(tampered, lib, async () => ({ ok: true, status: 200 }));
  assert.strictEqual(api2.getSupabaseConfig().url, cfg.url, "localStorage cannot override the project URL");
  assert.strictEqual(api2.getSupabaseConfig().anon, cfg.anon, "localStorage cannot override the anon key");
}

// ── (b) adapter: failure reasons ─────────────────────────────────────────
async function checkAdapterFailures() {
  const lib = { createClient() { return { auth: {} }; } };
  const noLib = loadAdapter(memoryStorage(), null, async () => { throw new Error("must not fetch without the Auth client"); });
  assert.deepStrictEqual(Object.assign({}, await noLib.havenConnectBackend()), { ok: false, reason: "auth_client_unavailable" });
  const offline = loadAdapter(memoryStorage(), lib, async () => { throw new TypeError("Failed to fetch"); });
  assert.strictEqual((await offline.havenConnectBackend()).reason, "network_error");
  const down = loadAdapter(memoryStorage(), lib, async () => ({ ok: false, status: 503 }));
  const downRes = await down.havenConnectBackend();
  assert.strictEqual(downRes.ok, false);
  assert.strictEqual(downRes.reason, "backend_unavailable");
  assert.strictEqual(downRes.status, 503);

  const api = loadAdapter(memoryStorage(), null, async () => ({ ok: true }));
  assert.strictEqual(api.havenAuthErrorIsNetwork({ name: "AuthRetryableFetchError", message: "x", status: 0 }), true);
  assert.strictEqual(api.havenAuthErrorIsNetwork(new TypeError("Failed to fetch")), true);
  assert.strictEqual(api.havenAuthErrorIsNetwork({ name: "AuthApiError", message: "Invalid login credentials", status: 400 }), false);

  // No Auth client: account creation / sign-in fail closed (no local account).
  const signUp = await api.havenAuthSignUp({ email: "a@b.c", password: "secret12" });
  assert.strictEqual(signUp.ok, false);
  assert.strictEqual(signUp.reason, "not_configured");
  const signIn = await api.havenAuthSignIn({ email: "a@b.c", password: "secret12" });
  assert.strictEqual(signIn.ok, false);
  assert.strictEqual(signIn.reason, "not_configured");

  assert.strictEqual(api.HAVEN_CONNECT_ERROR_TITLE, ERROR_TITLE);
  assert.strictEqual(api.HAVEN_CONNECT_ERROR_DETAIL, ERROR_DETAIL);
}

// ── jsdom harness ────────────────────────────────────────────────────────
function rootText(window) {
  return window.document.getElementById("root").textContent || "";
}
function screenText(window) {
  // Skip the inline <style> text.
  const rootEl = window.document.getElementById("root");
  return Array.from(rootEl.querySelectorAll("*")).filter(el => el.tagName !== "STYLE" && el.children.length === 0).map(el => el.textContent).join(" ");
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitFor(window, pred, label) {
  for (let i = 0; i < 150; i++) {
    await sleep(20); // let React commit before checking
    if (pred(rootText(window))) return;
  }
  throw new Error("timed out waiting for: " + label + "\n" + screenText(window).slice(0, 600));
}
function clickButton(window, label) {
  const btn = Array.from(window.document.querySelectorAll("button")).find(b => (b.textContent || "").trim() === label);
  if (!btn) throw new Error("no button: " + label + "\n" + screenText(window).slice(0, 600));
  btn.click();
}
function clickText(window, label) {
  const els = Array.from(window.document.querySelectorAll("#root *")).filter(el => el.children.length === 0 && (el.textContent || "").trim() === label);
  if (!els.length) throw new Error("no element with text: " + label + "\n" + screenText(window).slice(0, 600));
  els.forEach(el => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
}
function hasButton(window, label) {
  return Array.from(window.document.querySelectorAll("button")).some(b => (b.textContent || "").trim() === label);
}
function setInput(window, placeholder, value) {
  const input = Array.from(window.document.querySelectorAll("input")).find(el => el.placeholder === placeholder);
  if (!input) throw new Error("no input " + placeholder);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  const propsKey = Object.keys(input).find(k => k.startsWith("__reactProps$"));
  input[propsKey].onChange({ target: input, currentTarget: input });
}

async function renderApp(opts) {
  opts = opts || {};
  const { JSDOM, VirtualConsole } = require("jsdom");
  const babel = require("@babel/core");
  const React = require("react");
  const ReactDOMClient = require("react-dom/client");
  let ReactDOMLegacy = {};
  try { ReactDOMLegacy = require("react-dom"); } catch (e) { ReactDOMLegacy = {}; }
  const html = typeof opts.htmlTransform === "function" ? opts.htmlTransform(read("prototype-pro.html")) : read("prototype-pro.html");
  const reloads = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => {
    // jsdom can't navigate; Retry's page reload (Auth client missing) is recorded instead.
    if (/navigation/i.test(String(e && e.message))) { reloads.push(Date.now()); return; }
    console.error(e);
  });
  const dom = new JSDOM(html, { url: "https://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.cancelAnimationFrame = window.cancelAnimationFrame || (id => clearTimeout(id));
  window.localStorage.clear();
  const seed = opts.storage || {};
  Object.keys(seed).forEach(k => window.localStorage.setItem(k, seed[k]));
  const hits = [];
  window.fetch = async (url, init) => {
    hits.push({ url: String(url), init: init || {} });
    return opts.fetch(String(url), init || {});
  };
  if (opts.supabase) window.supabase = opts.supabase;
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
  return { window, hits, reloads };
}

function healthHits(hits) {
  return hits.filter(h => h.url.endsWith("/auth/v1/health"));
}

function okFetch() {
  return async () => ({ ok: true, status: 200, json: async () => [], text: async () => "[]" });
}

function authLib(state) {
  // state: { session, getSessionCalls, createCalls, listeners, signUp, signIn }
  state.getSessionCalls = 0;
  state.createCalls = [];
  state.listeners = [];
  return {
    createClient(url, key) {
      state.createCalls.push([url, key]);
      return {
        auth: {
          async getSession() { state.getSessionCalls++; return { data: { session: state.session || null }, error: null }; },
          async getUser() {
            state.getUserCalls = (state.getUserCalls || 0) + 1;
            if (state.getUser) return state.getUser();
            return { data: { user: state.session ? state.session.user : null }, error: state.session ? null : { name: "AuthSessionMissingError", status: 400 } };
          },
          onAuthStateChange(cb) { state.listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
          async signUp(args) { return state.signUp ? state.signUp(args) : { data: { session: null, user: null }, error: null }; },
          async signInWithPassword(args) { return state.signIn ? state.signIn(args) : { data: { session: null }, error: { name: "AuthApiError", message: "Invalid login credentials", status: 400 } }; },
          async signOut(opts) { state.signOutCalls = (state.signOutCalls || []).concat([opts || null]); state.session = null; state.listeners.forEach(cb => cb("SIGNED_OUT", null)); return { error: null }; },
        },
      };
    },
  };
}

function assertErrorScreen(window, label) {
  const text = rootText(window);
  assert.ok(text.includes(ERROR_TITLE), label + ": error title");
  assert.ok(text.includes(ERROR_DETAIL), label + ": error detail");
  const retry = Array.from(window.document.querySelectorAll("button")).find(b => (b.textContent || "").trim() === "Retry");
  assert.ok(retry, label + ": Retry button\n" + screenText(window));
  assert.ok(!text.includes("Create Account"), label + ": no Create Account while Haven is unreachable");
  assert.ok(!text.includes("Job Board") && !text.includes("My Jobs"), label + ": app is not usable");
  assert.ok(!text.includes("Load Demo Pro"), label + ": no demo");
}

function assertNoLocalAccount(window, label) {
  const ws = window.localStorage.getItem("haven_pro_workspace_v1");
  assert.strictEqual(ws, null, label + ": no local workspace/account saved");
  const text = rootText(window);
  assert.ok(!text.includes("Verify Your Contact Info"), label + ": no local contact wall");
  assert.ok(!text.includes("Create Your Profile"), label + ": no onboarding without a session");
}

// ── (a) UI: fresh browser connects ───────────────────────────────────────
async function checkFreshBrowserConnects() {
  const api = loadAdapter(memoryStorage(), null, null);
  const cfg = api.HAVEN_SUPABASE_PUBLIC_CONFIG;
  const state = {};
  const app = await renderApp({ supabase: authLib(state), fetch: okFetch() });
  try {
    assert.strictEqual(app.window.localStorage.getItem("haven_supabase_url"), null, "fresh browser has no stored URL");
    await waitFor(app.window, t => t.includes("Create Account"), "signed-out Welcome after connect");
    assert.ok(state.createCalls.length >= 1, "Auth client created");
    assert.strictEqual(state.createCalls[0][0], cfg.url, "Auth client uses the built-in URL");
    assert.strictEqual(state.createCalls[0][1], cfg.anon, "Auth client uses the built-in anon key");
    const health = healthHits(app.hits);
    assert.strictEqual(health.length, 1, "one connect attempt on boot");
    assert.strictEqual(health[0].url, cfg.url + "/auth/v1/health");
    assert.strictEqual(health[0].init.headers.apikey, cfg.anon);
    assert.ok(state.getSessionCalls >= 1, "session is read after connect");
    assert.ok(!rootText(app.window).includes(ERROR_TITLE), "no error when Haven answers");
    assert.ok(!rootText(app.window).includes("Not connected"), "no Not connected state");
    assert.ok(!rootText(app.window).includes("Job Board"), "signed out: account required");
    app.hits.forEach(h => assert.ok(h.url.startsWith(cfg.url), "only the Haven project is contacted: " + h.url));
  } finally {
    try { app.window.close(); } catch (e) { /* ignore */ }
  }
}

// ── (b) UI: failures show error + Retry; Retry re-attempts ───────────────
async function checkNetworkFailureRetry() {
  let mode = "offline";
  const state = {};
  const app = await renderApp({
    supabase: authLib(state),
    fetch: async (url) => {
      if (url.endsWith("/auth/v1/health")) {
        if (mode === "offline") throw new TypeError("Failed to fetch");
        if (mode === "down") return { ok: false, status: 503, json: async () => ({}), text: async () => "" };
      }
      return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
    },
  });
  try {
    await waitFor(app.window, t => t.includes(ERROR_TITLE), "network error screen");
    assertErrorScreen(app.window, "network failure");
    assertNoLocalAccount(app.window, "network failure");
    assert.strictEqual(healthHits(app.hits).length, 1);

    mode = "down";
    clickButton(app.window, "Retry");
    await waitFor(app.window, () => healthHits(app.hits).length === 2 && hasButton(app.window, "Retry"), "second attempt settles");
    assertErrorScreen(app.window, "Supabase down (503)");

    mode = "up";
    clickButton(app.window, "Retry");
    await waitFor(app.window, t => t.includes("Create Account"), "Welcome after successful Retry");
    assert.strictEqual(healthHits(app.hits).length, 3, "each Retry re-attempts the connect");
    assert.ok(!rootText(app.window).includes(ERROR_TITLE));
    assertNoLocalAccount(app.window, "after recovery");
  } finally {
    try { app.window.close(); } catch (e) { /* ignore */ }
  }
}

async function checkAuthClientMissingRetry() {
  const state = {};
  const app = await renderApp({ fetch: okFetch() }); // window.supabase never loaded
  try {
    await waitFor(app.window, t => t.includes(ERROR_TITLE), "auth client missing error");
    assertErrorScreen(app.window, "auth client failed to load");
    assert.strictEqual(healthHits(app.hits).length, 0, "no backend call without the Auth client");
    clickButton(app.window, "Retry");
    await waitFor(app.window, () => hasButton(app.window, "Retry"), "Retry settles");
    assert.strictEqual(app.reloads.length, 1, "Retry reloads the page to re-fetch the Auth client script");
    assertErrorScreen(app.window, "still missing after Retry");
    app.window.supabase = authLib(state);
    clickButton(app.window, "Retry");
    await waitFor(app.window, t => t.includes("Create Account"), "Welcome once the Auth client loads");
    assert.strictEqual(healthHits(app.hits).length, 1);
    assert.strictEqual(app.reloads.length, 1, "no reload once the Auth client is present");
  } finally {
    try { app.window.close(); } catch (e) { /* ignore */ }
  }
}

async function fillCreateAccount(window) {
  clickButton(window, "Create Account");
  await sleep(30);
  setInput(window, "Jordan", "Ada");
  setInput(window, "Ellis", "Lovelace");
  setInput(window, "you@example.com", "pro@example.com");
  setInput(window, "(555) 123-4567", "5551234567");
  setInput(window, "At least 6 characters", "secret12");
  setInput(window, "Re-enter your password", "secret12");
  await sleep(30);
}

async function checkAuthCallsUnreachable() {
  // Sign-up can't reach Auth: error + Retry, no local account.
  const state = {};
  state.signUp = async () => { throw new TypeError("Failed to fetch"); };
  const app = await renderApp({ supabase: authLib(state), fetch: okFetch() });
  try {
    await waitFor(app.window, t => t.includes("Create Account"), "Welcome");
    await fillCreateAccount(app.window);
    clickButton(app.window, "Continue");
    await waitFor(app.window, t => t.includes(ERROR_TITLE), "sign-up network failure error");
    assertErrorScreen(app.window, "sign-up unreachable");
    assertNoLocalAccount(app.window, "sign-up unreachable");
    clickButton(app.window, "Retry");
    await waitFor(app.window, t => !t.includes(ERROR_TITLE) && t.includes("First Name"), "back to the form after Retry");
    assertNoLocalAccount(app.window, "after Retry");
  } finally {
    try { app.window.close(); } catch (e) { /* ignore */ }
  }

  // Sign-in can't reach Auth (supabase-js AuthRetryableFetchError): error + Retry.
  const state2 = {};
  state2.signIn = async () => ({ data: { session: null }, error: { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 } });
  const app2 = await renderApp({ supabase: authLib(state2), fetch: okFetch() });
  try {
    await waitFor(app2.window, t => t.includes("Create Account"), "Welcome");
    clickButton(app2.window, "Sign in with email");
    await sleep(30);
    setInput(app2.window, "you@example.com", "pro@example.com");
    setInput(app2.window, "Your password", "secret12");
    await sleep(20);
    clickButton(app2.window, "Sign in");
    await waitFor(app2.window, t => t.includes(ERROR_TITLE), "sign-in network failure error");
    assertErrorScreen(app2.window, "sign-in unreachable");
    assertNoLocalAccount(app2.window, "sign-in unreachable");
  } finally {
    try { app2.window.close(); } catch (e) { /* ignore */ }
  }

  // Wrong password is not a connection error: stays on sign-in, still signed out.
  const state3 = {};
  const app3 = await renderApp({ supabase: authLib(state3), fetch: okFetch() });
  try {
    await waitFor(app3.window, t => t.includes("Create Account"), "Welcome");
    clickButton(app3.window, "Sign in with email");
    await sleep(30);
    setInput(app3.window, "you@example.com", "pro@example.com");
    setInput(app3.window, "Your password", "wrong-pass");
    await sleep(20);
    clickButton(app3.window, "Sign in");
    await waitFor(app3.window, t => t.includes("Check your email and password"), "bad-credentials notice");
    assert.ok(!rootText(app3.window).includes(ERROR_TITLE));
    assertNoLocalAccount(app3.window, "bad credentials");
  } finally {
    try { app3.window.close(); } catch (e) { /* ignore */ }
  }
}

// ── (c) no demo fallback: sessionless signed-in is an error, never usable ─
async function checkSessionlessSignedInIsError() {
  const session = { access_token: "access-token-pro", user: { id: AUTH_UID, email: "pro@example.com", user_metadata: { role: "pro" } } };
  const state = { session };
  const workspace = JSON.stringify({ __v: 1, byUserId: { [AUTH_UID]: {
    onboardingStatus: "completed", onboardingStep: "done", firstName: "Ada", lastName: "Lovelace",
    homeCity: "Orlando, FL", travelRadius: 25, workCategories: ["Plumbing"],
  } } });
  const app = await renderApp({ supabase: authLib(state), fetch: okFetch(), storage: { haven_pro_workspace_v1: workspace } });
  try {
    await waitFor(app.window, t => t.includes("My Jobs"), "signed-in app with a real session");
    // Reach the only remaining sessionless path: Dev Testing "Load Demo Pro" (local source),
    // then the Auth session ends (e.g. expiry) without a sign-out from this screen.
    clickText(app.window, "Profile");
    await sleep(30);
    clickText(app.window, "Settings");
    await waitFor(app.window, t => t.includes("Load Demo Pro"), "Settings");
    clickButton(app.window, "Load Demo Pro");
    await sleep(30);
    state.session = null;
    state.listeners.forEach(cb => cb("SIGNED_OUT", null));
    await waitFor(app.window, t => t.includes(ERROR_TITLE), "sessionless signed-in shows the error");
    assertErrorScreen(app.window, "signed-in without a session");
    assert.ok(!rootText(app.window).includes("Not connected"), "no Not connected card");
    const before = healthHits(app.hits).length;
    clickButton(app.window, "Retry");
    await waitFor(app.window, t => t.includes("Create Account") && !t.includes(ERROR_TITLE), "Retry with no session lands on signed-out Welcome");
    assert.strictEqual(healthHits(app.hits).length, before + 1, "Retry re-attempts the connect");
    assert.ok(!rootText(app.window).includes("My Jobs"), "no usable app without a session");
  } finally {
    try { app.window.close(); } catch (e) { /* ignore */ }
  }

  // Sign Out after a dev demo load still ends signed out (no local account left behind).
  const state2 = { session };
  const workspace2 = JSON.stringify({ __v: 1, byUserId: { [AUTH_UID]: {
    onboardingStatus: "completed", onboardingStep: "done", firstName: "Ada", lastName: "Lovelace",
    homeCity: "Orlando, FL", travelRadius: 25, workCategories: ["Plumbing"],
  } } });
  const app2 = await renderApp({ supabase: authLib(state2), fetch: okFetch(), storage: { haven_pro_workspace_v1: workspace2 } });
  try {
    await waitFor(app2.window, t => t.includes("My Jobs"), "signed-in app");
    clickText(app2.window, "Profile");
    await sleep(30);
    clickText(app2.window, "Settings");
    await waitFor(app2.window, t => t.includes("Load Demo Pro"), "Settings");
    clickButton(app2.window, "Load Demo Pro");
    await sleep(30);
    clickText(app2.window, "Profile"); // Load Demo Pro returns to Home
    await sleep(30);
    clickText(app2.window, "Settings");
    await waitFor(app2.window, () => hasButton(app2.window, "Sign Out"), "Settings with Sign Out");
    clickButton(app2.window, "Sign Out");
    await waitFor(app2.window, t => t.includes("Create Account"), "signed-out Welcome after Sign Out");
    assert.ok(!rootText(app2.window).includes("My Jobs"));
    assert.ok(!rootText(app2.window).includes(ERROR_TITLE));
  } finally {
    try { app2.window.close(); } catch (e) { /* ignore */ }
  }
}


// ── QA fix 2: runtime key guard ──────────────────────────────────────────
function fakeJwt(claims) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return enc({ alg: "HS256", typ: "JWT" }) + "." + enc(claims) + ".c2lnbmF0dXJl";
}

async function checkKeyGuard() {
  const api = loadAdapter(memoryStorage(), null, null);
  const real = api.HAVEN_SUPABASE_PUBLIC_CONFIG;
  const ref = api.havenSupabaseProjectRef(real.url);
  assert.strictEqual(ref, "tfykhsowsjffrrziefco", "project ref from URL host");
  assert.strictEqual(api.havenSupabaseKeyIsPublic(real.anon, ref), true, "real anon key accepted");
  assert.ok(api.getSupabaseConfig(), "real config passes the guard");
  const forged = {
    service_role: fakeJwt({ iss: "supabase", ref: ref, role: "service_role" }),
    sb_secret: "sb_secret_" + "x".repeat(32),
    malformed_two_parts: "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9",
    malformed_json: "eyJhbGciOiJIUzI1NiJ9.bm90LWpzb24.c2ln",
    ref_mismatch: fakeJwt({ iss: "supabase", ref: "abcdefghijklmnopqrst", role: "anon" }),
    no_role: fakeJwt({ iss: "supabase", ref: ref }),
    empty: "",
  };
  for (const name of Object.keys(forged)) {
    assert.strictEqual(api.havenSupabaseKeyIsPublic(forged[name], ref), false, "guard rejects " + name);
  }
  assert.strictEqual(api.havenSupabaseKeyIsPublic("sb_publishable_" + "y".repeat(24), ref), true, "sb_publishable_ accepted");
  assert.strictEqual(api.havenSupabaseKeyIsPublic(fakeJwt({ ref: ref, role: "anon" }), ref), true, "anon JWT for this project accepted");
  assert.strictEqual(api.havenSupabaseProjectRef("https://evil.example.com"), "", "non-Supabase host has no ref");

  // getSupabaseConfig refuses each forged key → not connectable (no client, no fetch).
  for (const name of ["service_role", "sb_secret", "malformed_json", "ref_mismatch"]) {
    const swap = (src) => {
      assert.ok(src.includes(real.anon));
      return src.split(real.anon).join(forged[name]);
    };
    let fetched = 0;
    const lib = { createClient() { throw new Error("client must not be created for a refused key"); } };
    const bad = loadAdapter(memoryStorage(), lib, async () => { fetched++; return { ok: true }; }, swap);
    assert.strictEqual(bad.getSupabaseConfig(), null, "config refused: " + name);
    const res = await bad.havenConnectBackend();
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, "not_configured", name);
    assert.strictEqual(fetched, 0, "no request with a refused key: " + name);
    const signUp = await bad.havenAuthSignUp({ email: "a@b.c", password: "secret12" });
    assert.strictEqual(signUp.ok, false, "no sign-up with a refused key: " + name);
  }
  // A URL that is not this project's host is refused too.
  const wrongHost = loadAdapter(memoryStorage(), null, null, (src) => src.replace(real.url, "https://evil.example.com"));
  assert.strictEqual(wrongHost.getSupabaseConfig(), null, "non-Supabase URL refused");

  // UI: a build carrying a service_role key shows the error screen, never demo / Create Account.
  const swapHtml = (html) => html.split(real.anon).join(forged.service_role);
  const state = {};
  const app = await renderApp({ supabase: authLib(state), fetch: okFetch(), htmlTransform: swapHtml });
  try {
    await waitFor(app.window, t => t.includes(ERROR_TITLE), "refused key shows the error");
    assertErrorScreen(app.window, "refused key");
    assert.strictEqual(state.createCalls.length, 0, "no Auth client for a refused key");
    assert.strictEqual(app.hits.length, 0, "no network with a refused key");
    clickButton(app.window, "Retry");
    await waitFor(app.window, () => hasButton(app.window, "Retry"), "Retry settles");
    assertErrorScreen(app.window, "refused key after Retry");
  } finally {
    try { app.window.close(); } catch (e) { /* ignore */ }
  }
}

// ── QA fix 1: stored session must be confirmed with getUser ──────────────
function cachedWorkspace() {
  return JSON.stringify({ __v: 1, byUserId: { [AUTH_UID]: {
    onboardingStatus: "completed", onboardingStep: "done", firstName: "Forged", lastName: "Profile",
    homeCity: "Orlando, FL", travelRadius: 25, workCategories: ["Plumbing"],
  } } });
}
function forgedSession() {
  return { access_token: "forged-token", user: { id: AUTH_UID, email: "pro@example.com", user_metadata: { role: "pro" } } };
}
function assertNoApp(window, label) {
  const text = rootText(window);
  assert.ok(!text.includes("My Jobs"), label + ": no app tabs");
  assert.ok(!text.includes("Job Board"), label + ": no board");
  assert.ok(!text.includes("Dev Testing"), label + ": no Dev Testing");
  assert.ok(!text.includes("Load Demo Pro"), label + ": no Load Demo Pro");
  assert.ok(!text.includes("Forged"), label + ": cached profile not rendered");
}

async function checkForgedSession(status) {
  const state = { session: forgedSession() };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  state.getUser = async () => {
    await gate;
    return { data: { user: null }, error: { name: "AuthApiError", message: "invalid JWT", status: status } };
  };
  const app = await renderApp({ supabase: authLib(state), fetch: okFetch(), storage: { haven_pro_workspace_v1: cachedWorkspace() } });
  try {
    // While getUser is pending, nothing but the connecting screen renders.
    await waitFor(app.window, () => (state.getUserCalls || 0) >= 1, "getUser called");
    await sleep(60);
    assert.ok(rootText(app.window).includes("Connecting to Haven"), "connecting while getUser is pending");
    assertNoApp(app.window, "getUser pending (" + status + ")");
    assert.ok(!app.hits.some(h => h.url.includes("/rest/v1/")), "no profile/job reads before getUser confirms: " + app.hits.map(h => h.init.method + " " + h.url.replace(/^https:\/\/[^/]+/, "")).join(", "));
    release();
    await waitFor(app.window, t => t.includes("Your session has ended"), "sign-in gate after " + status);
    const text = rootText(app.window);
    assert.ok(text.includes("Sign in") && text.includes("Password"), "sign-in gate shown (" + status + ")");
    assertNoApp(app.window, "forged session " + status);
    assert.ok(!text.includes(ERROR_TITLE), "an invalid session is not a connection error");
    assert.strictEqual(JSON.stringify(state.signOutCalls), JSON.stringify([{ scope: "local" }]), "local sign-out (" + status + ")");
    assert.strictEqual(state.session, null, "session cleared (" + status + ")");
    assert.strictEqual(app.window.localStorage.getItem("haven_pro_workspace_v1"), null, "cached profile cleared (" + status + ")");
    assert.ok(!app.hits.some(h => h.url.includes("/rest/v1/")), "forged session never reads profiles/jobs (" + status + ")");
    await sleep(80);
    assertNoApp(app.window, "forged session settled " + status);
  } finally {
    try { app.window.close(); } catch (e) { /* ignore */ }
  }
}

async function checkGetUserNetworkFailure() {
  const state = { session: forgedSession() };
  let mode = "offline";
  state.getUser = async () => {
    if (mode === "offline") return { data: { user: null }, error: { name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 } };
    return { data: { user: forgedSession().user }, error: null };
  };
  const app = await renderApp({ supabase: authLib(state), fetch: okFetch(), storage: { haven_pro_workspace_v1: cachedWorkspace() } });
  try {
    await waitFor(app.window, t => t.includes(ERROR_TITLE), "getUser network failure shows the error");
    assertErrorScreen(app.window, "getUser network failure");
    assertNoApp(app.window, "getUser network failure");
    assert.ok(!state.signOutCalls, "a network failure does not sign out");
    assert.ok(app.window.localStorage.getItem("haven_pro_workspace_v1"), "a network failure keeps the cache");
    const before = state.getUserCalls;
    clickButton(app.window, "Retry");
    await waitFor(app.window, () => hasButton(app.window, "Retry"), "Retry settles while still offline");
    assert.strictEqual(state.getUserCalls, before + 1, "Retry re-checks the user");
    assertErrorScreen(app.window, "still offline");
    mode = "online";
    clickButton(app.window, "Retry");
    await waitFor(app.window, t => t.includes("My Jobs"), "app after getUser confirms");
    assert.ok(!rootText(app.window).includes(ERROR_TITLE));
  } finally {
    try { app.window.close(); } catch (e) { /* ignore */ }
  }
}

async function checkGetUserMismatch() {
  // getUser answers with a different user than the stored session claims: treated as invalid.
  const state = { session: forgedSession() };
  state.getUser = async () => ({ data: { user: { id: "99999999-9999-4999-8999-999999999999", email: "other@example.com" } }, error: null });
  const app = await renderApp({ supabase: authLib(state), fetch: okFetch(), storage: { haven_pro_workspace_v1: cachedWorkspace() } });
  try {
    await waitFor(app.window, t => t.includes("Your session has ended"), "mismatched user → sign-in gate");
    assertNoApp(app.window, "mismatched user");
    assert.strictEqual(app.window.localStorage.getItem("haven_pro_workspace_v1"), null);
  } finally {
    try { app.window.close(); } catch (e) { /* ignore */ }
  }
}

async function checkAdapterRestoreConfirms() {
  const sess = forgedSession();
  const mk = (getUser) => ({ createClient() { return { auth: {
    async getSession() { return { data: { session: sess }, error: null }; },
    getUser,
    async signOut() { return { error: null }; },
  } }; } });
  const ok = loadAdapter(memoryStorage(), mk(async () => ({ data: { user: sess.user }, error: null })), null);
  const r1 = await ok.havenAuthRestoreSession();
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.session.user.id, AUTH_UID);
  const missing = loadAdapter(memoryStorage(), { createClient() { return { auth: { async getSession() { return { data: { session: sess }, error: null }; } } }; } }, null);
  const r2 = await missing.havenAuthRestoreSession();
  assert.strictEqual(r2.ok, false, "no getUser → not trusted");
  assert.strictEqual(r2.retryable, true);
  const thrown = loadAdapter(memoryStorage(), mk(async () => { throw new TypeError("Failed to fetch"); }), null);
  const r3 = await thrown.havenAuthRestoreSession();
  assert.strictEqual(r3.ok, false);
  assert.strictEqual(r3.retryable, true);
  const bad = loadAdapter(memoryStorage(), mk(async () => ({ data: { user: null }, error: { status: 403, name: "AuthApiError" } })), null);
  const r4 = await bad.havenAuthRestoreSession();
  assert.strictEqual(JSON.stringify([r4.ok, r4.session, r4.invalidated]), JSON.stringify([true, null, true]));
  assert.strictEqual(bad.havenAuthErrorIsInvalidSession({ status: 401, name: "AuthApiError" }), true);
  assert.strictEqual(bad.havenAuthErrorIsInvalidSession({ status: 0, name: "AuthRetryableFetchError" }), false);
}

// ── Sources / built output ───────────────────────────────────────────────
function checkSources() {
  const adapter = read("backend_adapter.js");
  const jsx = read("home_services_pro_app.jsx");
  assert.ok(!adapter.includes("haven_supabase_url") && !adapter.includes("haven_supabase_anon_key"), "no localStorage config keys");
  assert.ok(!/localStorage\.getItem\(SUPABASE_/.test(adapter), "getSupabaseConfig does not read localStorage");
  assert.ok(!adapter.includes('mode: "sim" }; // no backend configured'), "no SIM claim when unconfigured");
  assert.ok(!jsx.includes("Not connected"), "Not connected state removed");
  assert.ok(!adapter.includes("isPrototypeAnonMode") && !adapter.includes("haven_prototype_anon_mode"), "dead anon-mode flag removed");
  assert.ok(adapter.includes("client.auth.getUser()"), "stored session is confirmed with getUser");
  assert.ok(!jsx.includes("isn't connected to Haven yet"), "Not connected copy removed");
  assert.ok(!jsx.includes("Sign-in isn't available right now"), "no unavailable-toast fallback");
  assert.ok(!jsx.includes("Account creation isn't available right now"), "no unavailable fallback in Create Account");
  // The only remaining "local" account sources are the Dev Testing buttons (A2 gates them).
  const localSets = jsx.split('accountSourceRef.current = "local"').length - 1;
  assert.strictEqual(localSets, 2, "only loadDemoPro / devJumpToMarketplaceReady set a local source");
  const create = jsx.slice(jsx.indexOf("function onboardingCreateAccountScreen()"), jsx.indexOf("function onboardingAuthGateScreen()"));
  assert.ok(!create.includes('"local"'), "Create Account has no local branch");
  assert.ok(!create.includes("getSupabaseConfig()"), "Create Account does not branch on config");
  assert.ok(create.includes("havenAuthSignUp"), "Create Account uses Supabase Auth");
  for (const built of ["prototype-pro.html", "index.html"]) {
    const html = read(built);
    assert.ok(!html.includes("haven_supabase_url"), built + ": no localStorage config");
    assert.ok(!html.includes("Not connected"), built + ": no Not connected");
    assert.ok(html.includes(ERROR_TITLE) && html.includes(ERROR_DETAIL), built + ": error copy built in");
    assert.ok(html.includes("havenConnectBackend"), built + ": connect built in");
  }
  assert.strictEqual(read("index.html"), read("prototype-pro.html"), "index.html matches prototype-pro.html");
}

async function main() {
  checkPublicConfig();
  checkSources();
  await checkAdapterConnect();
  await checkAdapterFailures();
  await checkFreshBrowserConnects();
  await checkNetworkFailureRetry();
  await checkAuthClientMissingRetry();
  await checkAuthCallsUnreachable();
  await checkSessionlessSignedInIsError();
  await checkKeyGuard();
  await checkAdapterRestoreConfirms();
  await checkForgedSession(401);
  await checkForgedSession(403);
  await checkGetUserNetworkFailure();
  await checkGetUserMismatch();
  console.log("OK: Phase 1B A1 backend connect checks passed.");
}

main().catch(err => {
  const msg = String(err && err.stack ? err.stack : err).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<redacted-jwt>");
  console.error(msg);
  process.exit(1);
});
