#!/usr/bin/env node
"use strict";

/**
 * Sign-out confirmation (Pro). Mocked backend only (no real network).
 *
 * (1) Settings > Sign Out opens "Sign out of Haven Pro?" and does not sign
 *     out by itself. Cancel has focus.
 * (2) Cancel, tapping outside, and Escape close it; the session is untouched.
 * (3) Confirm runs the existing flow once: one auth.signOut call, the
 *     "Signed out" toast, and the signed-out welcome screen.
 * (4) Rapid repeated Confirm taps still call auth.signOut exactly once; the
 *     sheet can't be dismissed while signing out.
 * (5) A failed sign-out keeps the Pro signed in and shows the existing
 *     "Couldn't sign out. Please try again." message (unchanged behavior).
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const PRO_ID = "cccccccc-dddd-4eee-8fff-0000000005c3";
const TEST_URL = "https://signout-check.supabase.co";
const TEST_ANON = "test-anon-key-not-a-real-key";

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log("  ✓ " + msg); }
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function rootText(window) { return window.document.getElementById("root").textContent || ""; }
async function waitFor(window, pred, label) {
  for (let i = 0; i < 150; i++) {
    await sleep(20);
    if (pred(rootText(window))) return;
  }
  throw new Error("timed out waiting for: " + label + "\n" + rootText(window).slice(0, 600));
}
function clickText(window, label) {
  const els = Array.from(window.document.querySelectorAll("#root *")).filter(el => el.children.length === 0 && (el.textContent || "").trim() === label);
  if (!els.length) throw new Error("no element with text: " + label + "\n" + rootText(window).slice(0, 600));
  els[els.length - 1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}
function findButton(window, label, inDialog) {
  return Array.from(window.document.querySelectorAll("button")).find(b =>
    (b.textContent || "").trim() === label && (inDialog ? !!b.closest('[role="dialog"]') : !b.closest('[role="dialog"]'))) || null;
}
function dialog(window) { return window.document.querySelector('[role="dialog"][aria-labelledby="hp-signout-title"]'); }

function profileRow() {
  return {
    id: PRO_ID, role: "pro", display_name: "Ada Lovelace", email: "pro@example.com",
    first_name: "Ada", last_name: "Lovelace", home_city: "Orlando, FL", work_categories: ["Plumbing"],
    operating_lat: 28.5, operating_lng: -81.3,
    pro_workspace: {
      onboardingStatus: "completed", onboardingStep: "done", firstName: "Ada", lastName: "Lovelace",
      homeCity: "Orlando, FL", travelRadius: 25, workCategories: ["Plumbing"],
      identityVerification: { provider: "persona", status: "not_started" },
      backgroundCheck: { provider: "checkr", status: "not_started" },
      payoutAccount: { provider: "stripe_connect", status: "not_started", payoutsEnabled: false },
      taxProfile: { status: "not_started" },
    },
  };
}
function backendFetch() {
  const row = profileRow();
  return async (url, init) => {
    const method = (init && init.method) || "GET";
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.endsWith("/auth/v1/health")) return json(200, {});
    if (url.includes("/rest/v1/rpc/is_qa_tester")) return json(200, false);
    if (url.includes("/rest/v1/profiles") && method === "PATCH") return json(200, [row]);
    if (url.includes("/rest/v1/profiles")) return json(200, [row]);
    return json(200, []);
  };
}
function authLib(state) {
  return {
    createClient() {
      return {
        auth: {
          async getSession() { return { data: { session: state.session || null }, error: null }; },
          async getUser() { return { data: { user: state.session ? state.session.user : null }, error: null }; },
          onAuthStateChange(cb) { (state.listeners = state.listeners || []).push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
          async signOut() {
            state.signOutCalls = (state.signOutCalls || 0) + 1;
            if (state.signOutImpl) return state.signOutImpl();
            state.session = null;
            (state.listeners || []).forEach(cb => cb("SIGNED_OUT", null));
            return { error: null };
          },
          async signInWithPassword() { return { data: { session: null }, error: { message: "nope", status: 400 } }; },
          async signUp() { return { data: { session: null, user: null }, error: null }; },
        },
      };
    },
  };
}

async function renderApp(state) {
  const { JSDOM, VirtualConsole } = require("jsdom");
  const babel = require("@babel/core");
  const React = require("react");
  const ReactDOM = Object.assign({}, require("react-dom"), require("react-dom/client"));
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (e) => { if (!/navigation/i.test(String(e && e.message))) console.error(e); });
  const dom = new JSDOM(read("prototype-pro.html"), { url: "https://localhost/", runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.cancelAnimationFrame = window.cancelAnimationFrame || (id => clearTimeout(id));
  window.localStorage.clear();
  window.localStorage.setItem("haven_supabase_url", TEST_URL);
  window.localStorage.setItem("haven_supabase_anon_key", TEST_ANON);
  window.fetch = backendFetch();
  window.supabase = authLib(state);
  window.React = React; window.ReactDOM = ReactDOM;
  global.window = window; global.document = window.document; global.React = React; global.ReactDOM = ReactDOM;
  const scriptEl = window.document.querySelector('script[type="text/babel"]');
  const transpiled = babel.transformSync(scriptEl.textContent || "", {
    filename: "prototype-inline.jsx", babelrc: false, configFile: false,
    presets: [[require.resolve("@babel/preset-env"), { targets: { node: "current" } }], [require.resolve("@babel/preset-react"), { runtime: "classic" }]],
  });
  window.eval(transpiled.code);
  return window;
}
function freshState() {
  return { session: { access_token: "pro-access-token", user: { id: PRO_ID, email: "pro@example.com", user_metadata: { role: "pro" } } } };
}
async function openSettingsSignOut(window) {
  await waitFor(window, t => t.includes("My Jobs"), "signed-in app");
  clickText(window, "Profile");
  await sleep(40);
  clickText(window, "Settings");
  await waitFor(window, () => !!findButton(window, "Sign Out"), "Settings Sign Out");
  findButton(window, "Sign Out").click();
  await waitFor(window, () => !!dialog(window), "sign-out confirmation");
}

async function checkOpenAndCancel() {
  console.log("(1)(2) Opens a confirmation; Cancel / outside / Escape keep the session");
  const state = freshState();
  const window = await renderApp(state);
  await openSettingsSignOut(window);
  ok(/Sign out of Haven Pro\?/.test(dialog(window).textContent), 'asks "Sign out of Haven Pro?"');
  ok(dialog(window).getAttribute("aria-modal") === "true", "dialog is aria-modal");
  ok(!state.signOutCalls, "auth.signOut not called by opening it");
  ok(window.document.activeElement === findButton(window, "Cancel", true), "Cancel has focus");

  findButton(window, "Cancel", true).click();
  await sleep(40);
  ok(!dialog(window), "Cancel closes it");
  ok(!state.signOutCalls && !!state.session, "Cancel keeps the session (no signOut)");
  ok(!!findButton(window, "Sign Out"), "still on Settings, signed in");

  findButton(window, "Sign Out").click();
  await waitFor(window, () => !!dialog(window), "reopened");
  dialog(window).parentElement.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(40);
  ok(!dialog(window) && !state.signOutCalls, "tapping outside cancels");

  findButton(window, "Sign Out").click();
  await waitFor(window, () => !!dialog(window), "reopened");
  dialog(window).dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(40);
  ok(!dialog(window) && !state.signOutCalls, "Escape cancels");
  window.close();
}

async function checkConfirmOnce() {
  console.log("(3)(4) Confirm signs out once, even with rapid taps");
  const state = freshState();
  let release;
  state.signOutImpl = () => new Promise(r => { release = () => { state.session = null; (state.listeners || []).forEach(cb => cb("SIGNED_OUT", null)); r({ error: null }); }; });
  const window = await renderApp(state);
  await openSettingsSignOut(window);
  const confirm = findButton(window, "Sign out", true);
  confirm.click(); confirm.click(); confirm.click();
  await sleep(40);
  ok(state.signOutCalls === 1, "one auth.signOut while in flight (got " + state.signOutCalls + ")");
  ok(!!findButton(window, "Signing out…", true) && findButton(window, "Signing out…", true).disabled, "shows Signing out… (disabled)");
  dialog(window).parentElement.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(20);
  ok(!!dialog(window), "can't dismiss while signing out");
  release();
  await waitFor(window, t => t.includes("Signed out"), "Signed out toast");
  ok(state.signOutCalls === 1, "still exactly one auth.signOut");
  ok(!dialog(window), "sheet closed after sign-out");
  ok(!rootText(window).includes("My Jobs"), "signed-in app is gone (existing signed-out screen)");
  window.close();
}

async function checkFailure() {
  console.log("(5) Failed sign-out keeps the Pro signed in (existing behavior)");
  const state = freshState();
  state.signOutImpl = async () => ({ error: { message: "network down" } });
  const window = await renderApp(state);
  const warn = console.warn; console.warn = () => {};
  try {
    await openSettingsSignOut(window);
    findButton(window, "Sign out", true).click();
    await waitFor(window, t => t.includes("Couldn't sign out. Please try again."), "failure message");
  } finally { console.warn = warn; }
  ok(state.signOutCalls === 1, "one sign-out attempt");
  ok(!dialog(window), "sheet closes so the message is visible");
  ok(!!findButton(window, "Sign Out"), "still signed in on Settings (can retry)");
  window.close();
}

(async () => {
  try {
    await checkOpenAndCancel();
    await checkConfirmOnce();
    await checkFailure();
    console.log("OK: sign-out confirmation checks passed (" + passed + " assertions).");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
