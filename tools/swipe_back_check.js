#!/usr/bin/env node
"use strict";

/**
 * Swipe-back (Pro). The shared swipeBackHandlers() used by ~20 detail
 * screens, exercised on the Job Earnings Statement. Mocked backend only;
 * the test copy starts with the existing SIM_COMPLETED_JOBS sample history.
 *
 * - Only a clearly horizontal swipe right goes back (>= 60px right and at
 *   least twice as far across as up/down).
 * - Diagonal drags, vertical scrolls, leftward and short swipes do not.
 * - Swipes that start in a text field, a sideways-scrolling row, or an
 *   element marked data-no-swipe-back are ignored.
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
  for (let i = 0; i < 150; i++) { await sleep(20); if (pred(text(w))) return; }
  throw new Error("timed out waiting for: " + label + "\n" + text(w).slice(0, 500));
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

async function renderApp() {
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

function tab(w, label) {
  const b = Array.from(w.document.querySelectorAll(".hp-tab-btn")).find(x => (x.textContent || "").includes(label));
  if (!b) throw new Error("no tab " + label);
  b.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
}
function scroller(w) { return w.document.querySelector("[data-earnings-scroll]"); }
function touch(w, el, type, x, y) {
  const ev = new w.Event(type, { bubbles: true, cancelable: true });
  const pt = { clientX: x, clientY: y, identifier: 1, target: el };
  Object.defineProperty(ev, "touches", { value: type === "touchend" ? [] : [pt] });
  Object.defineProperty(ev, "changedTouches", { value: [pt] });
  el.dispatchEvent(ev);
}
async function swipe(w, el, from, to) {
  touch(w, el, "touchstart", from[0], from[1]);
  touch(w, el, "touchend", to[0], to[1]);
  await sleep(40);
}
function period(w) {
  const t = text(w);
  return /This Year/i.test(t) ? "year" : /This Month/i.test(t) ? "month" : /This Week/i.test(t) ? "week" : "?";
}
function firstLedgerRow(w) {
  return Array.from(scroller(w).querySelectorAll("button")).find(b => /Faucet|Repair|Install|Mounting|Cleaning|Assembly|Cooling/.test(b.textContent || "") && /\$/.test(b.textContent || ""));
}
function onStatement(w) { return text(w).includes("Job Earnings Statement"); }
async function openStatement(w) {
  firstLedgerRow(w).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await waitFor(w, t => t.includes("Job Earnings Statement"), "statement");
}
function screenRoot(w) { return w.document.querySelector("[data-earnings-scroll]"); }
function injectRow(w, attrs, scrollWidth) {
  // A child that scrolls sideways only (or is opted out), placed inside the screen.
  const el = w.document.createElement("div");
  el.setAttribute("style", "overflow-x: auto; overflow-y: hidden;");
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
  Object.defineProperty(el, "scrollWidth", { value: scrollWidth == null ? 800 : scrollWidth });
  Object.defineProperty(el, "clientWidth", { value: 300 });
  el.textContent = "row";
  screenRoot(w).appendChild(el);
  return el;
}

(async () => {
  try {
    const w = await renderApp();
    await waitFor(w, t => t.includes("My Jobs"), "signed-in app");
    tab(w, "Earnings");
    await waitFor(w, t => /This Week/i.test(t) && /Completed Jobs/.test(t), "Earnings main");
    await openStatement(w);

    console.log("Direction lock");
    await swipe(w, screenRoot(w), [40, 400], [120, 460]);   // 80 right, 60 down
    ok(onStatement(w), "diagonal drag (80px right, 60px down) does not go back");
    await swipe(w, screenRoot(w), [40, 300], [60, 520]);    // mostly vertical
    ok(onStatement(w), "vertical scroll does not go back");
    await swipe(w, screenRoot(w), [200, 400], [80, 405]);   // leftward
    ok(onStatement(w), "swipe left does not go back");
    await swipe(w, screenRoot(w), [40, 400], [90, 402]);    // only 50px
    ok(onStatement(w), "short swipe (50px) does not go back");

    console.log("Opt-outs");
    const row = injectRow(w);
    await swipe(w, row, [40, 400], [200, 405]);
    ok(onStatement(w), "swipe starting in a sideways-scrolling row does not go back");
    const marked = injectRow(w, { "data-no-swipe-back": "" }, 300); // not scrollable; opted out by attribute only
    await swipe(w, marked, [40, 400], [200, 405]);
    ok(onStatement(w), "swipe starting in a data-no-swipe-back element does not go back");
    const input = w.document.createElement("input");
    screenRoot(w).appendChild(input);
    await swipe(w, input, [40, 400], [200, 405]);
    ok(onStatement(w), "swipe starting in a text field does not go back");

    console.log("Still works");
    await swipe(w, screenRoot(w), [40, 400], [160, 412]);   // 120 right, 12 down
    await waitFor(w, t => !t.includes("Job Earnings Statement"), "back on Earnings");
    ok(!onStatement(w), "clear swipe right (120px, 12px down) goes back");

    w.close();
    console.log("OK: swipe-back checks passed (" + passed + " assertions).");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
