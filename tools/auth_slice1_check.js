#!/usr/bin/env node
"use strict";

/**
 * Slice 1 checks:
 * - anon-mode flag defaults on
 * - signup metadata is role pro and redirect is the Pro Pages URL
 * - signed-in claim identity is covered by auth_slice2_check.js
 * - signed-in claim uses the auth uid; the demo pro id is not the runtime actor
 * - built HTML still boots the welcome demo, and shows email sign-in once configured
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function assertIncludes(hay, needle, label) {
  if (!hay.includes(needle)) {
    throw new Error(label + " missing: " + needle);
  }
}

function memoryStorage(seed) {
  const store = Object.assign({}, seed || {});
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  };
}

function loadAdapter(localStorage, supabaseLib, fetchImpl) {
  const sandbox = {
    console,
    window: { localStorage, supabase: supabaseLib },
    fetch: fetchImpl,
    URL,
    encodeURIComponent,
    Date,
    JSON,
    Math,
    Array,
    Object,
    String,
    Number,
    Error,
    Promise,
    Set,
    Map,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const code = read("backend_adapter.js") + "\n;globalThis.__haven = { isPrototypeAnonMode, havenAuthSignUp, havenAuthSignIn, havenAuthSignOut, havenAuthRestoreSession, getHavenAccessToken, getHavenAuthUser, claimJobOnSupabase, HAVEN_PRO_AUTH_REDIRECT_URL };";
  vm.runInContext(code, sandbox, { filename: "backend_adapter.js" });
  return sandbox.__haven;
}

async function checkAuthBehavior() {
  const storage = memoryStorage();
  const api = loadAdapter(storage, null, async () => { throw new Error("fetch should not run"); });
  assert.strictEqual(api.isPrototypeAnonMode(), true, "missing flag defaults on");
  storage.setItem("haven_prototype_anon_mode", "false");
  assert.strictEqual(api.isPrototypeAnonMode(), false);
  storage.setItem("haven_prototype_anon_mode", "off");
  assert.strictEqual(api.isPrototypeAnonMode(), false);
  storage.setItem("haven_prototype_anon_mode", "0");
  assert.strictEqual(api.isPrototypeAnonMode(), false);
  storage.setItem("haven_prototype_anon_mode", "no");
  assert.strictEqual(api.isPrototypeAnonMode(), false);
  storage.setItem("haven_prototype_anon_mode", "true");
  assert.strictEqual(api.isPrototypeAnonMode(), true);
  storage.setItem("haven_prototype_anon_mode", "yes");
  assert.strictEqual(api.isPrototypeAnonMode(), true);
  storage.setItem("haven_prototype_anon_mode", "maybe");
  assert.strictEqual(api.isPrototypeAnonMode(), true, "unknown values stay on");
  storage.removeItem("haven_prototype_anon_mode");

  const unsigned = await api.havenAuthSignUp({ email: "a@b.c", password: "secret12" });
  assert.strictEqual(unsigned.ok, false);
  assert.strictEqual(unsigned.reason, "not_configured");

  storage.setItem("haven_supabase_url", "https://example.supabase.co");
  storage.setItem("haven_supabase_anon_key", "anon-key-demo");
  storage.setItem("haven_prototype_anon_mode", "false");

  const calls = [];
  const session = {
    access_token: "access-token-pro",
    user: { id: "11111111-1111-4111-8111-111111111111", email: "pro@example.com", user_metadata: { role: "pro" } },
  };
  const lib = {
    createClient(url, key) {
      calls.push(["createClient", url, key]);
      return {
        auth: {
          async signUp(args) {
            calls.push(["signUp", args]);
            return { data: { session, user: session.user }, error: null };
          },
          async signInWithPassword(args) {
            calls.push(["signIn", args]);
            return { data: { session, user: session.user }, error: null };
          },
          async signOut() {
            calls.push(["signOut"]);
            return { error: null };
          },
          async getSession() {
            return { data: { session }, error: null };
          },
          onAuthStateChange() {
            return { data: { subscription: { unsubscribe() {} } } };
          },
        },
      };
    },
  };

  const authed = loadAdapter(storage, lib, async () => { throw new Error("unexpected fetch"); });
  assert.strictEqual(authed.isPrototypeAnonMode(), false, "flag off is visible; it does not choose the job actor");
  const signedUp = await authed.havenAuthSignUp({ email: "pro@example.com", password: "secret12" });
  assert.strictEqual(signedUp.ok, true);
  const signUpArgs = calls.find(c => c[0] === "signUp")[1];
  assert.strictEqual(signUpArgs.options.data.role, "pro");
  assert.strictEqual(Object.keys(signUpArgs.options.data).join(","), "role");
  assert.strictEqual(signUpArgs.options.emailRedirectTo, "https://bluspots.github.io/haven-pro/");
  assert.strictEqual(authed.getHavenAccessToken(), "access-token-pro");
  assert.strictEqual(authed.getHavenAuthUser().role, "pro");

  const fetches = [];
  const anon = "anon-key-demo";
  const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  async function fakeFetch(url, opts) {
    fetches.push({ url: String(url), opts });
    if (String(url).includes("/rpc/pro_claim_job")) {
      return { ok: false, status: 404, text: async () => "missing", json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => [{ id: jobId, status: "en_route" }], text: async () => "" };
  }
  const claiming = loadAdapter(storage, lib, fakeFetch);
  await claiming.havenAuthSignIn({ email: "pro@example.com", password: "secret12" });
  assert.strictEqual(claiming.getHavenAccessToken(), "access-token-pro");
  const claim = await claiming.claimJobOnSupabase({ id: jobId });
  assert.strictEqual(claim.ok, true);
  assert.ok(fetches.length >= 2, "rpc then patch");
  const authUid = "11111111-1111-4111-8111-111111111111";
  for (const hit of fetches) {
    assert.strictEqual(hit.opts.headers.Authorization, "Bearer access-token-pro");
    assert.strictEqual(hit.opts.headers.apikey, anon);
    assert.ok(!hit.opts.headers.Authorization.includes(anon), "signed-in job call must not use the anon key as Bearer");
  }
  const patch = fetches.find(h => h.opts.method === "PATCH");
  const body = JSON.parse(patch.opts.body);
  assert.strictEqual(body.pro_id, authUid);
  assert.notStrictEqual(body.pro_id, "22222222-2222-4222-8222-222222222222");

  await claiming.havenAuthSignOut();
  assert.strictEqual(claiming.getHavenAccessToken(), null);
}

function checkSources() {
  const adapter = read("backend_adapter.js");
  const jsx = read("home_services_pro_app.jsx");
  const shell = read("_shell_pre_pro.txt");
  const doc = read("docs/AUTH_SLICE1.md");
  assertIncludes(adapter, 'const HAVEN_PROTOTYPE_ANON_MODE_KEY = "haven_prototype_anon_mode"', "flag key");
  assertIncludes(adapter, 'data: { role: "pro" }', "signup role");
  assertIncludes(adapter, "https://bluspots.github.io/haven-pro/", "redirect");
  assert.ok(!adapter.includes("proId: DEMO_PRO_ID"), "demo pro id is not a write fallback");
  assertIncludes(adapter, 'reason: "no_session"', "signed-out write stops");
  assert.ok(!adapter.includes("posted_jobs_public"), "no anonymous public jobs view");
  assertIncludes(adapter, 'actor.ok && actor.mode === "session"', "posted board requires session");
  assertIncludes(jsx, "havenAuthSignUp", "jsx signup");
  assertIncludes(jsx, "Sign in with email", "email sign-in affordance");
  assertIncludes(shell, "@supabase/supabase-js@2.117.2/dist/umd/supabase.js", "cdn");
  assertIncludes(doc, "0016", "migration note");
  assert.ok(!fs.existsSync(path.join(root, "supabase")), "Pro repo must not add SQL migrations");

  for (const built of ["prototype-pro.html", "index.html"]) {
    const html = read(built);
    assertIncludes(html, "haven_prototype_anon_mode", built + " flag");
    assertIncludes(html, 'data: { role: "pro" }', built + " role");
    assert.ok(!html.includes("proId: DEMO_PRO_ID"), built + " has no demo pro write");
    assertIncludes(html, 'reason: "no_session"', built + " signed-out stop");
    assertIncludes(html, "@supabase/supabase-js@2.117.2/dist/umd/supabase.js", built + " cdn");
    assert.strictEqual(html.includes("access-token"), false);
  }
}

async function renderWelcome(localStorageSeed) {
  const { JSDOM } = require("jsdom");
  const babel = require("@babel/core");
  const React = require("react");
  const ReactDOMClient = require("react-dom/client");
  let ReactDOMLegacy = {};
  try { ReactDOMLegacy = require("react-dom"); } catch (e) { ReactDOMLegacy = {}; }

  const html = read("prototype-pro.html");
  const dom = new JSDOM(html, { url: "https://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.cancelAnimationFrame = window.cancelAnimationFrame || (id => clearTimeout(id));
  window.localStorage.clear();
  const seed = localStorageSeed || {};
  Object.keys(seed).forEach(k => window.localStorage.setItem(k, seed[k]));
  window.fetch = async () => ({ ok: true, status: 200, json: async () => [], text: async () => "" });
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
  await new Promise(resolve => setTimeout(resolve, 30));
  return { window, dom };
}

function rootText(window) {
  return (window.document.getElementById("root").textContent || "");
}

function clickButton(window, label) {
  const buttons = Array.from(window.document.querySelectorAll("button"));
  const btn = buttons.find(b => (b.textContent || "").trim() === label);
  if (!btn) throw new Error("no button: " + label + "\n" + rootText(window).slice(0, 400));
  btn.click();
}

async function checkWelcome() {
  const plain = await renderWelcome(null);
  try {
    const text = rootText(plain.window);
    assert.ok(text.includes("Create Account"), "default welcome create");
    assert.ok(text.includes("Sign In"), "default welcome sign in");
    assert.ok(!text.includes("Load Demo Pro"), "signed-out welcome has no demo marketplace");
    assert.ok(!text.includes("Jump to Marketplace Ready"), "signed-out welcome has no marketplace jump");
    assert.ok(!text.includes("Sign in with email"), "email sign-in stays hidden without Supabase keys");
    assert.ok(text.includes("Help") || text.includes("Terms") || text.includes("Privacy"), "legal/support affordance");
    clickButton(plain.window, "Create Account");
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(rootText(plain.window).includes("First Name"), "create-account form still opens");
  } finally {
    try { plain.window.close(); } catch (e) { /* ignore */ }
  }

  const configured = await renderWelcome({
    haven_supabase_url: "https://example.supabase.co",
    haven_supabase_anon_key: "anon-key-demo",
  });
  try {
    const text = rootText(configured.window);
    assert.ok(text.includes("Sign in with email"), "configured welcome offers email sign-in");
    assert.ok(text.includes("Sign In"), "sign-in remains");
    assert.ok(!text.includes("Load Demo Pro"), "configured welcome has no demo marketplace");
    clickButton(configured.window, "Sign in with email");
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(rootText(configured.window).includes("Haven Pro account"), "email sign-in screen");
    clickButton(configured.window, "‹");
    await new Promise(resolve => setTimeout(resolve, 30));
    // Sign In opens email sign-in when Supabase is configured — never a demo job board.
    clickButton(configured.window, "Sign In");
    await new Promise(resolve => setTimeout(resolve, 30));
    const afterSignIn = rootText(configured.window);
    assert.ok(afterSignIn.includes("Haven Pro account") || afterSignIn.includes("Password"), "Sign In opens auth, not marketplace");
    assert.ok(!afterSignIn.includes("Job Board"), "signed-out Sign In must not open the job board");
  } finally {
    try { configured.window.close(); } catch (e) { /* ignore */ }
  }
}

async function main() {
  checkSources();
  await checkAuthBehavior();
  await checkWelcome();
  console.log("OK: auth slice 1 checks passed.");
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
