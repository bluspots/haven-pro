#!/usr/bin/env node
"use strict";
/**
 * PRO-01: contact verification (Pro onboarding). The app must never mark an
 * email or phone "verified" from a tap.
 * (1) The tap-to-verify contact screen and its buttons are gone; no code path
 *     sets email or phone to "verified" by hand.
 * (2) Email status comes only from Supabase Auth (user.email_confirmed_at):
 *     sign-up with an unconfirmed user stores "pending", a confirmed one
 *     "verified".
 * (3) Phone is never set to "verified" by the app; the account card says
 *     phone verification isn't available yet.
 * (4) A saved onboarding step from older builds ("verifyContact") continues
 *     at Create Your Profile instead of the removed wall.
 * (5) The stored workspace contract is unchanged (same keys); values already
 *     stored are not rewritten (that is for the backend owner to decide).
 * Uses a mocked Supabase client in jsdom: this is not a live Auth test.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const root = path.resolve(__dirname, "..");
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
const AUTH_UID = "11111111-2222-4333-8444-555555555555";
const KEY = "haven_pro_workspace_v1";
const user = (confirmed) => Object.assign({ id: AUTH_UID, email: "pro@example.com", user_metadata: { role: "pro" } }, confirmed ? { email_confirmed_at: "2026-10-12T20:00:00Z" } : {});
const sessionFor = u => ({ access_token: "tok", user: u });
const tick = ms => new Promise(r => setTimeout(r, ms));
const rootText = w => w.document.getElementById("root").textContent || "";
function stored(w) { try { return JSON.parse(w.localStorage.getItem(KEY)).byUserId[AUTH_UID]; } catch (e) { return null; } }
function lib({ signUpUser, bootUser }) {
  return { createClient() { return { auth: {
    async signUp() { const s = signUpUser ? sessionFor(signUpUser) : null; return { data: { session: s, user: signUpUser }, error: null }; },
    async getSession() { return { data: { session: bootUser ? sessionFor(bootUser) : null }, error: null }; },
    async getUser() { return bootUser ? { data: { user: bootUser }, error: null } : { data: { user: null }, error: { name: "AuthSessionMissingError", status: 400 } }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    async signOut() { return { error: null }; },
  } }; } };
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

async function renderWelcome(localStorageSeed, opts) {
  opts = opts || {};
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
  window.fetch = opts.fetch || (async () => ({ ok: true, status: 200, json: async () => [], text: async () => "" }));
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
  // Phase 1B A1: boot connects first; wait for the connect attempt to settle.
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setTimeout(resolve, 20));
    const text = window.document.getElementById("root").textContent || "";
    if (text.includes("HAVEN PRO") && !text.includes("Connecting to Haven")) break;
  }
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


async function main() {
  // (1) source
  const jsx = read("home_services_pro_app.jsx");
  const built = read("prototype-pro.html");
  for (const [name, s] of [["source", jsx], ["built page", built]]) {
    ok(!/set(Email|Phone)VerifyStatus\("verified"\)/.test(s), name + ": nothing sets email or phone to \"verified\" by hand");
    ok(!/Verify Your Contact Info|tap to confirm for this demo|onboardingVerifyContactScreen/.test(s), name + ": the tap-to-verify screen is gone");
  }
  ok(!/"verifyContact", "createProfile"/.test(jsx) && /const ONBOARDING_STEPS = \["welcome", "createAccount", "createProfile",/.test(jsx), "verifyContact is not an onboarding step");
  ok(/emailConfirmed: !!user\.email_confirmed_at,/.test(jsx), "email confirmation is read from Supabase Auth");
  ok((jsx.match(/setEmailVerifyStatus\([a-zA-Z]+ && [a-zA-Z]+\.emailConfirmed \? "verified" : "pending"\)/g) || []).length === 2, "sign-in and sign-up both take email status from Auth");
  // (5) contract unchanged
  ok(/emailVerifyStatus: emailVerifyStatus,\s*phoneVerifyStatus: phoneVerifyStatus,/.test(jsx) && /if \(typeof snapshot\.phoneVerifyStatus === "string"\) setPhoneVerifyStatus\(snapshot\.phoneVerifyStatus\);/.test(jsx), "workspace snapshot keeps the same two keys (contract unchanged)");

  // sign-up never shows verify buttons
  for (const confirmed of [false, true]) {
    const r = await renderWelcome(null, { supabase: lib({ signUpUser: user(confirmed) }) });
    try {
      await fillCreateAccount(r.window);
      clickButton(r.window, "Continue");
      await tick(80);
      ok(rootText(r.window).includes("Create Your Profile") && !/Verify (Email|Phone)/.test(rootText(r.window)), (confirmed ? "confirmed" : "unconfirmed") + " sign-up continues to Create Your Profile with no verify buttons");
    } finally { try { r.window.close(); } catch (e) { /* ignore */ } }
  }
  // (2)+(3) sign-in stores email status from Auth (unconfirmed, then confirmed)
  for (const confirmed of [false, true]) {
    const signInLib = { createClient() { const c = lib({}).createClient(); c.auth.signInWithPassword = async () => ({ data: { session: sessionFor(user(confirmed)), user: user(confirmed) }, error: null }); return c; } };
    const r = await renderWelcome(null, { supabase: signInLib });
    try {
      clickButton(r.window, "Sign In"); await tick(40);
      setInput(r.window, "you@example.com", "pro@example.com");
      setInput(r.window, "Your password", "secret12");
      await tick(30);
      clickButton(r.window, "Sign in");
      for (let i = 0; i < 80 && !stored(r.window); i++) await tick(25);
      const ws = stored(r.window);
      ok(ws && ws.emailVerifyStatus === (confirmed ? "verified" : "pending"), "sign-in stores email status from Auth: " + (confirmed ? "verified" : "pending") + " (got " + (ws && ws.emailVerifyStatus) + ")");
      ok(ws && ws.phoneVerifyStatus !== "verified", "sign-in never stores a verified phone");
      ok(!/Verify (Email|Phone)/.test(rootText(r.window)), "no verify buttons after sign-in");
    } finally { try { r.window.close(); } catch (e) { /* ignore */ } }
  }

  // (4) restored step from an older build
  const old = { __v: 1, byUserId: { [AUTH_UID]: { onboardingStatus: "in_progress", onboardingStep: "verifyContact", firstName: "Ada", lastName: "Lovelace", accountEmail: "pro@example.com", accountPhone: "5551234567", emailVerifyStatus: "pending", phoneVerifyStatus: "pending" } } };
  const r2 = await renderWelcome({ [KEY]: JSON.stringify(old) }, { supabase: lib({ bootUser: user(false) }) });
  try {
    for (let i = 0; i < 60 && !rootText(r2.window).includes("Create Your Profile"); i++) await tick(25);
    ok(rootText(r2.window).includes("Create Your Profile") && !/Verify (Email|Phone)/.test(rootText(r2.window)), "a saved verifyContact step continues at Create Your Profile");
    await tick(60);
    ok(stored(r2.window) && stored(r2.window).onboardingStep === "createProfile", "the saved step moves on to createProfile");
  } finally { try { r2.window.close(); } catch (e) { /* ignore */ } }

  // (3)+(5) account card for a Pro whose older build stored a tapped "verified" phone
  const done = { __v: 1, byUserId: { [AUTH_UID]: { onboardingStatus: "completed", onboardingStep: "done", firstName: "Ada", lastName: "Lovelace", accountEmail: "pro@example.com", accountPhone: "5551234567", emailVerifyStatus: "verified", phoneVerifyStatus: "verified" } } };
  for (const confirmed of [false, true]) {
    const r3 = await renderWelcome({ [KEY]: JSON.stringify(done) }, { supabase: lib({ bootUser: user(confirmed) }) });
    try {
      for (let i = 0; i < 80 && !Array.from(r3.window.document.querySelectorAll("button")).some(b => /Profile/.test(b.textContent || "")); i++) await tick(25);
      const tab = Array.from(r3.window.document.querySelectorAll("button")).filter(b => /^\W*Profile$/.test((b.textContent || "").trim())).pop();
      if (tab) { tab.click(); await tick(60); }
      const t = rootText(r3.window);
      if (confirmed) ok(t.includes("Email confirmed") && !t.includes("Email not confirmed yet"), "account card: Auth-confirmed email reads \"Email confirmed\"");
      else ok(t.includes("Email not confirmed yet") && !t.includes("Email confirmed"), "account card: an email Auth hasn't confirmed reads \"not confirmed yet\", even though older builds stored \"verified\"");
      ok(t.includes("Phone not verified. Phone verification isn't available yet.") && !/Phone verified/.test(t), "account card: phone is never shown as verified");
      ok(stored(r3.window) && stored(r3.window).phoneVerifyStatus === "verified", "a value stored by an older build is left as is (not rewritten by the app)");
    } finally { try { r3.window.close(); } catch (e) { /* ignore */ } }
  }
  console.log(`OK: contact verification checks passed (${pass} assertions).`);
}
main().catch(e => { console.error(e); process.exit(1); });
