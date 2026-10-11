#!/usr/bin/env node
"use strict";

/**
 * Fixes from the Pro accessibility audit (no visual change).
 * (1) On/off switches (Online, notification types, Dark mode) are switches
 *     for screen readers, with a name and their on/off state.
 * (2) Earnings chart bars say what they are ("Monday, 10/5: $225", or "no
 *     earnings") and
 *     whether they're selected.
 * (3) Every text field has a spoken name (Edit Profile, tax, chat, forms).
 * (4) Small controls get a 44px-tall tap area without moving: the ‹ back
 *     arrows and the Cancel / Save header buttons.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const PRO_ID = "cccccccc-dddd-4eee-8fff-00000000b4c7";
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log("  ✓ " + msg); }
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function text(w) { return w.document.getElementById("root").textContent || ""; }
async function waitFor(w, pred, label) {
  for (let i = 0; i < 150; i++) { await sleep(20); if (pred(w)) return; }
  throw new Error("timed out waiting for: " + label + "\n" + text(w).slice(0, 400));
}

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

async function renderApp({ reducedMotion } = {}) {
  const { JSDOM } = require("jsdom");
  const babel = require("@babel/core");
  const React = require("react");
  const ReactDOM = Object.assign({}, require("react-dom"), require("react-dom/client"));
  const html = read("prototype-pro.html");
  const SEED_FROM = "const [completedJobsHistory, setCompletedJobsHistory] = useState([]);";
  if (!html.includes(SEED_FROM)) throw new Error("test seed anchor not found in prototype-pro.html");
  const dom = new JSDOM(html, { url: "https://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.matchMedia = q => ({ matches: !!reducedMotion && /reduce/.test(q), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  // jsdom has no layout, so scrollTop is always 0. Give every element a real,
  // per-element scrollTop so the app's save/restore logic can be observed.
  const scrollStore = new WeakMap();
  Object.defineProperty(window.Element.prototype, "scrollTop", {
    configurable: true,
    get() { return scrollStore.get(this) || 0; },
    set(v) { scrollStore.set(this, Number(v) || 0); },
  });
  window.localStorage.clear();
  window.localStorage.setItem("haven_supabase_url", "https://swipe-back.supabase.co");
  window.localStorage.setItem("haven_supabase_anon_key", "test-anon-key-not-a-real-key");
  const row = profileRow();
  window.fetch = async (url) => {
    const u = String(url);
    const json = (b) => ({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
    if (u.endsWith("/auth/v1/health")) return json({});
    if (u.includes("/rest/v1/rpc/is_qa_tester")) return json(false);
    if (u.includes("/rest/v1/profiles")) return json([row]);
    return json([]);
  };
  const session = { access_token: "pro-access-token", user: { id: PRO_ID, email: "pro@example.com", user_metadata: { role: "pro" } } };
  window.supabase = { createClient() { return { auth: {
    async getSession() { return { data: { session }, error: null }; },
    async getUser() { return { data: { user: session.user }, error: null }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
    async signOut() { return { error: null }; },
  } }; } };
  window.React = React; window.ReactDOM = ReactDOM;
  global.window = window; global.document = window.document; global.React = React; global.ReactDOM = ReactDOM;
  const script = window.document.querySelector('script[type="text/babel"]').textContent
    .replace(SEED_FROM, "const [completedJobsHistory, setCompletedJobsHistory] = useState(SIM_COMPLETED_JOBS);");
  const code = babel.transformSync(script, {
    filename: "pro.jsx", babelrc: false, configFile: false,
    presets: [[require.resolve("@babel/preset-env"), { targets: { node: "current" } }], [require.resolve("@babel/preset-react"), { runtime: "classic" }]],
  }).code;
  window.eval(code);
  return window;
}


(async () => {
  try {
    const src = read("home_services_pro_app.jsx");
    const w = await renderApp();
    const click = el => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const fgEl = () => w.document.querySelector("[data-swipe-foreground]");
    const tabTo = async (label, re) => { click(Array.from(w.document.querySelectorAll(".hp-tab-btn")).find(b => b.textContent.includes(label))); await waitFor(w, x => re.test(text(x)), label); };
    await waitFor(w, x => text(x).includes("My Jobs"), "signed-in app");
    console.log("(1) Switches");
    const online = Array.from(fgEl().querySelectorAll('[role="switch"]')).find(b => /Online|Offline/.test(b.textContent));
    ok(!!online && online.getAttribute("aria-checked") === "true", 'Online switch says it is on');
    click(online); await sleep(40);
    ok(online.getAttribute("aria-checked") === "false" && /Offline/.test(online.textContent), "turning it off updates its state");
    click(online); await sleep(40);
    await tabTo("Earnings", /Lifetime/);
    console.log("(2) Chart bars");
    const bars = Array.from(fgEl().querySelectorAll("[data-earnings-chart] button[aria-pressed]"));
    ok(bars.length >= 7 && bars.every(b => /^[A-Z][a-z]+day, \S+: (\$\d+|no earnings)$/.test(b.getAttribute("aria-label") || "")), 'chart bars are named like "' + (bars.find(b => /\$/.test(b.getAttribute("aria-label")||""))||bars[0]).getAttribute("aria-label") + '"');
    await tabTo("Profile", /Edit Profile/);
    console.log("(3) Field names");
    click(Array.from(fgEl().querySelectorAll("button")).find(b => b.textContent.trim() === "Edit Profile"));
    await waitFor(w, x => /Profile Photo/.test(text(x)), "Edit Profile");
    const fields = Array.from(fgEl().querySelectorAll("input:not([type=file]), textarea"));
    ok(fields.length >= 4 && fields.every(f => (f.getAttribute("aria-label") || "").length > 0), "every Edit Profile field has a name (" + fields.map(f => f.getAttribute("aria-label")).join(", ") + ")");
    click(Array.from(fgEl().querySelectorAll("button")).find(b => b.textContent.trim() === "Cancel"));
    await sleep(60);
    click(Array.from(fgEl().querySelectorAll("button")).find(b => /^⚙️\s*Settings/.test(b.textContent.trim())));
    await waitFor(w, x => /Appearance/.test(text(x)), "Settings");
    const dark = fgEl().querySelector('[role="switch"][aria-label="Dark mode"]');
    ok(!!dark && dark.getAttribute("aria-checked") === "false", 'Appearance toggle is a "Dark mode" switch (off)');
    click(Array.from(fgEl().querySelectorAll("button")).find(b => /^🔔\s*Notifications/.test(b.textContent.trim())));
    await waitFor(w, x => /Job Offers|Payouts|Messages/.test(text(x)) && !/Appearance/.test(text(x)), "Notifications");
    const ns = Array.from(fgEl().querySelectorAll('[role="switch"]'));
    ok(ns.length >= 3 && ns.every(n => n.getAttribute("aria-label") && /^(true|false)$/.test(n.getAttribute("aria-checked"))), "notification switches are named with their state (" + ns.map(n => n.getAttribute("aria-label")).join(", ") + ")");
    ok(/aria-label="Message"/.test(src) && /aria-label=\{label\}[\s\S]{0,40}inputMode=\{inputMode\}/.test(src), "chat box and shared form fields are named");
    console.log("(4) Tap areas");
    ok(/aria-label="Back" style=\{\{[^}]*padding: "11px 18px 11px 16px", margin: "-11px -14px -11px -16px"/.test(src), "screen ‹ Back: 44px tall tap area, same position");
    ok((src.match(/aria-label="Back" style=\{\{[^}]*padding: "10px 16px", margin: "-10px -16px/g) || []).length === 3, "onboarding and sign-in ‹ Back: same treatment");
    ok((src.match(/padding: "12px 10px", margin: "-11px -4px"/g) || []).length === 2, "Cancel / Save: taller tap area, text stays put");
    w.close();
    console.log("OK: Pro audit fix checks passed (" + passed + " assertions).");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
