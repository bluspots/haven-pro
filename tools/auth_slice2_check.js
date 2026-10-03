#!/usr/bin/env node
"use strict";

/**
 * Slice 2 checks:
 * - signed-in claim / arrive / diagnosing / in_progress / materials / complete
 *   use the auth uid and the user access token as Bearer
 * - apikey stays the anon key
 * - no session stops the write and does not send DEMO_PRO_ID, even if anon mode is off
 * - a session missing uid or token does not fall back to DEMO_PRO_ID
 * - anon mode on does not override a real session
 * - lifecycle status strings and fee fields stay put
 * - local demo create-account still reaches Verify Your Contact Info
 * - a Supabase session skips that demo wall
 * - local Pro workspace snapshot save/load for refresh rehydration
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const ANON = "anon-key-demo";
const TOKEN = "access-token-pro";
const AUTH_UID = "11111111-1111-4111-8111-111111111111";
const DEMO_PRO_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function memoryStorage(seed) {
  const store = Object.assign({}, seed || {});
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
  };
}

function configuredStorage(extra) {
  return memoryStorage(Object.assign({
    haven_supabase_url: "https://example.supabase.co",
    haven_supabase_anon_key: ANON,
  }, extra || {}));
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
    INSPECTION_VISIT_FEE: 45,
    CONVENIENCE_FEE: 30,
    ACTIVE_BLOCK_STATUSES: new Set([
      "en_route",
      "arrived",
      "diagnosing",
      "materials_requested",
      "materials_approved",
      "in_progress",
    ]),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const names = [
    "isPrototypeAnonMode",
    "havenAuthSignIn",
    "havenAuthSignOut",
    "getHavenAccessToken",
    "getHavenAuthUser",
    "resolveHavenJobWriteAuth",
    "claimJobOnSupabase",
    "patchJobArrivedOnSupabase",
    "patchJobWorkStatusOnSupabase",
    "patchJobCompleteOnSupabase",
    "bestEffortPatchMaterialsRequested",
    "bestEffortPatchTerminalStatus",
    "fetchPostedJobsFromSupabase",
    "fetchActiveJobsFromSupabase",
    "loadHavenProWorkspace",
    "saveHavenProWorkspace",
  ];
  const code = read("backend_adapter.js") + "\n;globalThis.__haven = { " + names.join(", ") + " };";
  vm.runInContext(code, sandbox, { filename: "backend_adapter.js" });
  return sandbox.__haven;
}

function authLib(sessionRef) {
  return {
    createClient() {
      return {
        auth: {
          async signInWithPassword() {
            return { data: { session: sessionRef.current, user: sessionRef.current.user }, error: null };
          },
          async signOut() {
            sessionRef.current = null;
            return { error: null };
          },
          async getSession() {
            return { data: { session: sessionRef.current }, error: null };
          },
          onAuthStateChange() {
            return { data: { subscription: { unsubscribe() {} } } };
          },
        },
      };
    },
  };
}

function sessionFor(user) {
  return {
    access_token: TOKEN,
    user: user,
  };
}

function goodUser() {
  return { id: AUTH_UID, email: "pro@example.com", user_metadata: { role: "pro" } };
}

function recordingFetch(rowsFor) {
  const hits = [];
  async function fakeFetch(url, opts) {
    const hit = { url: String(url), opts: opts || {} };
    hits.push(hit);
    const method = (opts && opts.method) || "GET";
    if (String(url).includes("/rpc/pro_claim_job")) {
      return { ok: false, status: 404, text: async () => "missing", json: async () => ({}) };
    }
    const rows = rowsFor ? rowsFor(hit) : [{ id: JOB_ID, status: "en_route" }];
    return { ok: true, status: 200, json: async () => rows, text: async () => "" };
  }
  return { hits, fakeFetch };
}

function assertSessionBound(hit, proId) {
  assert.strictEqual(hit.opts.headers.Authorization, "Bearer " + TOKEN, hit.url);
  assert.strictEqual(hit.opts.headers.apikey, ANON, hit.url);
  assert.ok(!hit.opts.headers.Authorization.includes(ANON), "anon key must not be the Bearer");
  const blob = hit.url + " " + (hit.opts.body || "");
  assert.ok(!blob.includes(DEMO_PRO_ID), "signed-in call included DEMO_PRO_ID: " + blob);
  if (proId) {
    if (hit.opts.body) {
      const body = JSON.parse(hit.opts.body);
      if (Object.prototype.hasOwnProperty.call(body, "pro_id")) {
        assert.strictEqual(body.pro_id, proId);
      }
    }
    if (hit.url.includes("pro_id=eq.")) {
      assert.ok(hit.url.includes("pro_id=eq." + encodeURIComponent(proId)), hit.url);
    }
  }
}

function assertDemoBound(hit) {
  assert.strictEqual(hit.opts.headers.Authorization, "Bearer " + ANON, hit.url);
  assert.strictEqual(hit.opts.headers.apikey, ANON);
  const blob = hit.url + " " + (hit.opts.body || "");
  assert.ok(blob.includes(DEMO_PRO_ID), "demo call missing DEMO_PRO_ID: " + blob);
  assert.ok(!blob.includes(TOKEN), "demo call sent the user access token");
  assert.ok(!blob.includes(AUTH_UID), "demo call sent the auth uid");
}

async function checkSignedInWrites() {
  const sessionRef = { current: sessionFor(goodUser()) };
  const { hits, fakeFetch } = recordingFetch((hit) => {
    const body = hit.opts.body ? JSON.parse(hit.opts.body) : null;
    const status = body && body.status ? body.status : "posted";
    return [{ id: JOB_ID, status: status }];
  });
  const api = loadAdapter(configuredStorage({ haven_prototype_anon_mode: "true" }), authLib(sessionRef), fakeFetch);
  assert.strictEqual(api.isPrototypeAnonMode(), true, "anon mode on must not hide the session");

  const claim = await api.claimJobOnSupabase({ id: JOB_ID });
  assert.strictEqual(claim.ok, true);
  assert.strictEqual(claim.mode, "update");
  const claimHits = hits.splice(0, hits.length);
  assert.ok(claimHits.length >= 2, "rpc then patch");
  claimHits.forEach(hit => assertSessionBound(hit, AUTH_UID));
  const claimPatch = claimHits.find(h => h.opts.method === "PATCH");
  const claimBody = JSON.parse(claimPatch.opts.body);
  assert.strictEqual(claimBody.status, "en_route");
  assert.strictEqual(claimBody.pro_id, AUTH_UID);
  assert.ok(claimBody.accepted_at);

  const job = { id: JOB_ID, backendClaimed: true, status: "en_route" };
  const arrived = await api.patchJobArrivedOnSupabase(job);
  assert.strictEqual(arrived.ok, true);
  const arriveHits = hits.splice(0, hits.length);
  arriveHits.forEach(hit => assertSessionBound(hit, AUTH_UID));
  assert.strictEqual(JSON.parse(arriveHits[0].opts.body).status, "arrived");

  job.status = "arrived";
  const diagnosing = await api.patchJobWorkStatusOnSupabase(job, "diagnosing");
  assert.strictEqual(diagnosing.ok, true);
  const diagHits = hits.splice(0, hits.length);
  diagHits.forEach(hit => assertSessionBound(hit, AUTH_UID));
  assert.strictEqual(JSON.parse(diagHits[0].opts.body).status, "diagnosing");
  assert.ok(!Object.prototype.hasOwnProperty.call(JSON.parse(diagHits[0].opts.body), "materials_reimbursed_cents"));

  const started = await api.patchJobWorkStatusOnSupabase(
    { id: JOB_ID, backendClaimed: true, status: "materials_approved" },
    "in_progress",
    { materials_reimbursed_cents: 1250 }
  );
  assert.strictEqual(started.ok, true);
  const workHits = hits.splice(0, hits.length);
  workHits.forEach(hit => assertSessionBound(hit, AUTH_UID));
  const workBody = JSON.parse(workHits[0].opts.body);
  assert.strictEqual(workBody.status, "in_progress");
  assert.strictEqual(workBody.materials_reimbursed_cents, 1250);
  assert.ok(workHits[0].url.includes("status=eq.materials_approved"));

  await api.bestEffortPatchMaterialsRequested(
    { id: JOB_ID, backendClaimed: true },
    [{ name: "Pipe", cost: 12.5 }],
    12.5
  );
  const matHits = hits.splice(0, hits.length);
  assert.strictEqual(matHits.length, 1);
  assertSessionBound(matHits[0], AUTH_UID);
  const matBody = JSON.parse(matHits[0].opts.body);
  assert.strictEqual(matBody.status, "materials_requested");
  assert.strictEqual(matBody.materials_estimate_cents, 1250);
  assert.strictEqual(matBody.materials_items[0].cost_cents, 1250);

  const done = await api.patchJobCompleteOnSupabase({ id: JOB_ID, backendClaimed: true, status: "in_progress" });
  assert.strictEqual(done.ok, true);
  const doneHits = hits.splice(0, hits.length);
  doneHits.forEach(hit => assertSessionBound(hit, AUTH_UID));
  const doneBody = JSON.parse(doneHits[0].opts.body);
  assert.strictEqual(doneBody.status, "complete");
  assert.ok(doneBody.completed_at);
  assert.ok(doneHits[0].url.includes("status=eq.in_progress"));

  await api.bestEffortPatchTerminalStatus(
    { id: JOB_ID, backendClaimed: true, inspectionFee: 45 },
    "inspection_completed"
  );
  const insp = hits.splice(0, hits.length);
  assertSessionBound(insp[0], AUTH_UID);
  const inspBody = JSON.parse(insp[0].opts.body);
  assert.strictEqual(inspBody.status, "inspection_completed");
  assert.strictEqual(inspBody.inspection_fee_cents, 4500);

  await api.bestEffortPatchTerminalStatus(
    { id: JOB_ID, backendClaimed: true },
    "materials_declined"
  );
  const declined = hits.splice(0, hits.length);
  assertSessionBound(declined[0], AUTH_UID);
  const declinedBody = JSON.parse(declined[0].opts.body);
  assert.strictEqual(declinedBody.status, "materials_declined");
  assert.strictEqual(declinedBody.convenience_fee_cents, 3000);

  const posted = await api.fetchPostedJobsFromSupabase();
  assert.ok(Array.isArray(posted));
  const board = hits.splice(0, hits.length);
  assert.strictEqual(board.length, 1);
  assert.strictEqual(board[0].opts.headers.Authorization, "Bearer " + TOKEN, "signed-in board read uses the user bearer");
  assert.strictEqual(board[0].opts.headers.apikey, ANON, "signed-in board apikey stays the anon key");
  assert.ok(board[0].url.includes("/rest/v1/jobs?"), "signed-in board still reads public.jobs");
  assert.ok(board[0].url.includes("status=eq.posted"));
  assert.ok(board[0].url.includes("pro_id=is.null"));
  assert.ok(!board[0].url.includes(DEMO_PRO_ID));

  const active = await api.fetchActiveJobsFromSupabase();
  assert.ok(Array.isArray(active));
  const activeHits = hits.splice(0, hits.length);
  assert.strictEqual(activeHits.length, 1);
  assertSessionBound(activeHits[0], AUTH_UID);
}

async function checkSignedOutDemo() {
  const sessionRef = { current: null };
  const { hits, fakeFetch } = recordingFetch((hit) => {
    const body = hit.opts.body ? JSON.parse(hit.opts.body) : null;
    const status = body && body.status ? body.status : "en_route";
    return [{ id: JOB_ID, status: status }];
  });
  const api = loadAdapter(configuredStorage({ haven_prototype_anon_mode: "false" }), authLib(sessionRef), fakeFetch);
  assert.strictEqual(api.isPrototypeAnonMode(), false);
  const claim = await api.claimJobOnSupabase({ id: JOB_ID });
  assert.strictEqual(claim.ok, false);
  assert.strictEqual(claim.reason, "no_session");
  assert.strictEqual(hits.length, 0, "signed-out claim must not call the jobs API");

  const arrived = await api.patchJobArrivedOnSupabase({ id: JOB_ID, backendClaimed: true, status: "en_route" });
  assert.strictEqual(arrived.ok, false);
  assert.strictEqual(arrived.reason, "no_session");

  const diagnosing = await api.patchJobWorkStatusOnSupabase(
    { id: JOB_ID, backendClaimed: true, status: "arrived" },
    "diagnosing"
  );
  assert.strictEqual(diagnosing.ok, false);
  assert.strictEqual(diagnosing.reason, "no_session");

  await api.bestEffortPatchMaterialsRequested(
    { id: JOB_ID, backendClaimed: true },
    [{ name: "Wax ring", cost: 4 }],
    4
  );
  const done = await api.patchJobCompleteOnSupabase({ id: JOB_ID, backendClaimed: true, status: "in_progress" });
  assert.strictEqual(done.ok, false);
  assert.strictEqual(done.reason, "no_session");
  assert.strictEqual(hits.length, 0, "signed-out writes must not send DEMO_PRO_ID or the anon bearer");

  const posted = await api.fetchPostedJobsFromSupabase();
  assert.ok(Array.isArray(posted) && posted.length === 0, "signed-out board returns no rows");
  const board = hits.splice(0, hits.length);
  assert.strictEqual(board.length, 0, "signed-out must not call the jobs API (account required)");

  const active = await api.fetchActiveJobsFromSupabase();
  assert.ok(Array.isArray(active) && active.length===0, "signed-out active rehydrate returns no rows");
  assert.strictEqual(hits.length, 0, "signed-out active rehydrate must not query as DEMO_PRO");
}

async function checkEmptyRpcClaimFails() {
  const sessionRef = { current: sessionFor(goodUser()) };
  const hits = [];
  async function fakeFetch(url, opts) {
    hits.push({ url: String(url), opts: opts || {} });
    if (String(url).includes("/rpc/pro_claim_job")) {
      return { ok: true, status: 200, json: async () => [], text: async () => "" };
    }
    throw new Error("PATCH must not run after empty RPC claim: " + url);
  }
  const api = loadAdapter(configuredStorage(), authLib(sessionRef), fakeFetch);
  const claim = await api.claimJobOnSupabase({ id: JOB_ID });
  assert.strictEqual(claim.ok, false, "empty RPC claim body must not succeed");
  assert.strictEqual(claim.reason, "already_claimed");
  assert.strictEqual(hits.length, 1, "empty RPC claim must not fall through to PATCH");
  assert.ok(hits[0].url.includes("/rpc/pro_claim_job"));
}

async function checkNoSilentDemoFallback() {
  const broken = { current: { access_token: TOKEN, user: { email: "pro@example.com", user_metadata: { role: "pro" } } } };
  const hits = [];
  async function fakeFetch() {
    hits.push("fetch");
    throw new Error("fetch must not run");
  }
  const api = loadAdapter(configuredStorage(), authLib(broken), fakeFetch);
  const claim = await api.claimJobOnSupabase({ id: JOB_ID });
  assert.strictEqual(claim.ok, false);
  assert.strictEqual(claim.reason, "session_identity_missing");
  assert.strictEqual(hits.length, 0, "missing uid must not call the demo write");
  const posted = await api.fetchPostedJobsFromSupabase();
  assert.ok(Array.isArray(posted) && posted.length===0, 'missing uid board returns no rows');

  assert.strictEqual(hits.length, 0, "missing uid must not fall back to an anon board read");

  const tokenless = { current: { access_token: "", user: { id: AUTH_UID, email: "pro@example.com" } } };
  const api2 = loadAdapter(configuredStorage(), authLib(tokenless), fakeFetch);
  const arrived = await api2.patchJobArrivedOnSupabase({ id: JOB_ID, backendClaimed: true, status: "en_route" });
  assert.strictEqual(arrived.ok, false);
  assert.strictEqual(arrived.reason, "session_identity_missing");
  assert.strictEqual(hits.length, 0);

  const persisted = { current: sessionFor(goodUser()) };
  const { hits: persistedHits, fakeFetch: persistedFetch } = recordingFetch(() => [{ id: JOB_ID, status: "en_route" }]);
  const api3 = loadAdapter(configuredStorage(), authLib(persisted), persistedFetch);
  const fromStorage = await api3.claimJobOnSupabase({ id: JOB_ID });
  assert.strictEqual(fromStorage.ok, true);
  const patch = persistedHits.find(h => h.opts.method === "PATCH");
  assertSessionBound(patch, AUTH_UID);
}

function checkSources() {
  const adapter = read("backend_adapter.js");
  const jsx = read("home_services_pro_app.jsx");
  const doc = read("docs/AUTH_SLICE2.md");
  assert.ok(!adapter.includes("22222222-2222-4222-8222-222222222222"));
  assert.ok(!adapter.includes("proId: DEMO_PRO_ID"));
  assert.ok(adapter.includes('reason: "no_session"'));
  assert.ok(!adapter.includes("posted_jobs_public"), "no anonymous public jobs view");
  assert.ok(adapter.includes('actor.ok && actor.mode === "session"'), "posted board requires a session");
  assert.ok(adapter.includes("session_identity_missing"));
  assert.ok(jsx.includes("Verify Your Contact Info"));
  assert.ok(jsx.includes('setOnboardingStep("createProfile")'));
  assert.ok(adapter.includes("loadHavenProWorkspace"));
  assert.ok(adapter.includes("saveHavenProWorkspace"));
  assert.ok(jsx.includes("applyHavenProWorkspace"));
  assert.ok(jsx.includes("haven_pro_workspace_v1") || adapter.includes("haven_pro_workspace_v1"));
  assert.ok(doc.includes("authenticated"));
  assert.ok(doc.includes("DEMO_PRO_ID"));
  assert.ok(!/if \(res\.ok\) \{\s*return \{ ok: true, mode: "rpc" \}/.test(adapter), "RPC claim must read the returned row");
  assert.ok(!fs.existsSync(path.join(root, "supabase")), "Pro repo must not add SQL migrations");
  assert.ok(!adapter.includes("CREATE POLICY"));
  const statuses = ["en_route", "arrived", "diagnosing", "in_progress", "materials_requested", "materials_approved", "complete", "inspection_completed", "materials_declined"];
  statuses.forEach(status => {
    assert.ok(adapter.includes('"' + status + '"') || adapter.includes("status: \"" + status + "\""), status);
  });
}

function setInput(window, placeholder, value) {
  const input = Array.from(window.document.querySelectorAll("input")).find(el => el.placeholder === placeholder);
  if (!input) throw new Error("no input " + placeholder);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  const propsKey = Object.keys(input).find(k => k.startsWith("__reactProps$"));
  const onChange = propsKey && input[propsKey] && input[propsKey].onChange;
  if (typeof onChange !== "function") throw new Error("no onChange for " + placeholder);
  onChange({ target: input, currentTarget: input });
}

function clickButton(window, label) {
  const buttons = Array.from(window.document.querySelectorAll("button"));
  const btn = buttons.find(b => (b.textContent || "").trim() === label);
  if (!btn) throw new Error("no button: " + label);
  btn.click();
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

async function fillCreateAccount(window) {
  clickButton(window, "Create Account");
  await new Promise(resolve => setTimeout(resolve, 30));
  setInput(window, "Jordan", "Ada");
  setInput(window, "Ellis", "Lovelace");
  setInput(window, "you@example.com", "pro@example.com");
  setInput(window, "(555) 123-4567", "5551234567");
  setInput(window, "At least 6 characters", "secret12");
  setInput(window, "Re-enter your password", "secret12");
  await new Promise(resolve => setTimeout(resolve, 30));
}

async function checkOnboardingWall() {
  const local = await renderWelcome(null);
  try {
    await fillCreateAccount(local.window);
    clickButton(local.window, "Continue");
    await new Promise(resolve => setTimeout(resolve, 40));
    const text = local.window.document.getElementById("root").textContent || "";
    assert.ok(text.includes("Verify Your Contact Info"), "local demo create-account still uses the contact wall");
  } finally {
    try { local.window.close(); } catch (e) { /* ignore */ }
  }

  const authed = await renderWelcome({
    haven_supabase_url: "https://example.supabase.co",
    haven_supabase_anon_key: ANON,
  });
  try {
    const session = sessionFor(goodUser());
    authed.window.supabase = {
      createClient() {
        return {
          auth: {
            async signUp() {
              return { data: { session: session, user: session.user }, error: null };
            },
            async getSession() {
              return { data: { session: session }, error: null };
            },
            onAuthStateChange(cb) {
              return { data: { subscription: { unsubscribe() {} } } };
            },
          },
        };
      },
    };
    await fillCreateAccount(authed.window);
    clickButton(authed.window, "Continue");
    await new Promise(resolve => setTimeout(resolve, 40));
    const text = authed.window.document.getElementById("root").textContent || "";
    assert.ok(text.includes("Create Your Profile"), "signed-up session continues at profile");
    assert.ok(!text.includes("Verify Your Contact Info"), "signed-up session skips the demo contact wall");
  } finally {
    try { authed.window.close(); } catch (e) { /* ignore */ }
  }
}

async function checkWorkspacePersistence() {
  const storage = configuredStorage();
  const api = loadAdapter(storage, authLib({ current: null }), async () => ({ ok: true, json: async () => [], text: async () => "" }));
  const snap = {
    onboardingStatus: "completed",
    onboardingStep: "done",
    firstName: "Bart",
    lastName: "ual",
    homeCity: "San Francisco",
    travelRadius: 25,
    workCategories: ["Plumbing"],
  };
  assert.strictEqual(api.saveHavenProWorkspace(AUTH_UID, snap), true);
  const loaded = api.loadHavenProWorkspace(AUTH_UID);
  assert.ok(loaded);
  assert.strictEqual(loaded.homeCity, "San Francisco");
  assert.strictEqual(loaded.travelRadius, 25);
  assert.strictEqual(loaded.onboardingStatus, "completed");
  assert.deepStrictEqual(loaded.workCategories, ["Plumbing"]);
  assert.strictEqual(api.loadHavenProWorkspace("00000000-0000-4000-8000-000000000099"), null);
}

async function main() {
  checkSources();
  await checkWorkspacePersistence();
  await checkSignedInWrites();
  await checkSignedOutDemo();
  await checkEmptyRpcClaimFails();
  await checkNoSilentDemoFallback();
  await checkOnboardingWall();
  console.log("OK: auth slice 2 checks passed.");
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
