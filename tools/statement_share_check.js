#!/usr/bin/env node
"use strict";

/**
 * Share / print a Job Earnings Statement (Pro). Mocked backend; the test
 * copy starts with the existing SIM_COMPLETED_JOBS sample history.
 *
 * (1) Share uses the phone's share sheet with the statement's own figures
 *     (title, payout, tip, total). Cancelling the sheet does nothing else.
 * (2) Without a share sheet, the text is copied and "Statement copied" shows.
 * (3) Print calls the browser's print; print styles show only the statement,
 *     black on white, without the Share / Print buttons.
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
    const w = await renderApp();
    const shared = [], copied = [];
    let printed = 0, mode = "share";
    Object.defineProperty(w.navigator, "share", { configurable: true, get: () => mode === "share" ? (async d => { shared.push(d); }) : (mode === "abort" ? (async () => { const e = new Error("x"); e.name = "AbortError"; throw e; }) : undefined) });
    Object.defineProperty(w.navigator, "clipboard", { configurable: true, value: { writeText: async t => { copied.push(t); } } });
    w.print = () => { printed++; };
    await waitFor(w, x => text(x).includes("My Jobs"), "signed-in app");
    const click = el => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    click(Array.from(w.document.querySelectorAll(".hp-tab-btn")).find(b => /Earnings/.test(b.textContent)));
    await waitFor(w, x => /Lifetime/.test(text(x)), "Earnings");
    click(Array.from(w.document.querySelectorAll("[data-swipe-foreground] button")).find(b => /\$/.test(b.textContent) && /Cleaning/.test(b.textContent)));
    await waitFor(w, x => /Job Earnings Statement/.test(text(x)), "statement");
    const btn = re => Array.from(w.document.querySelectorAll("[data-swipe-foreground] button")).find(b => re.test(b.textContent));
    const card = w.document.querySelector("[data-print-statement]").textContent;
    const total = (card.match(/TOTAL EARNINGS\s*\$(\d+)/i) || [])[1];
    console.log("(1) Share sheet");
    click(btn(/Share/)); await sleep(30);
    ok(shared.length === 1 && /Haven Pro — Job Earnings Statement/.test(shared[0].text), "Share opens the share sheet with the statement");
    ok(new RegExp("Total earnings: \\$" + total + "\\b").test(shared[0].text) && /Labor Payout: \$\d+/.test(shared[0].text) && /Tip \(100% to you\): \$\d+/.test(shared[0].text), "shared text uses the statement's own figures (total $" + total + ")");
    mode = "abort"; click(btn(/Share/)); await sleep(30);
    ok(copied.length === 0 && !/Statement copied|isn't available/.test(text(w)), "cancelling the share sheet does nothing else");
    console.log("(2) No share sheet");
    mode = "none"; click(btn(/Share/)); await sleep(30);
    ok(copied.length === 1 && copied[0] === shared[0].text && /Statement copied/.test(text(w)), 'copies the same text and shows "Statement copied"');
    console.log("(3) Print");
    click(btn(/Print/));
    ok(printed === 1, "Print calls the browser's print");
    const css = Array.from(w.document.querySelectorAll("style")).map(s => s.textContent).join("\n");
    ok(/@media print[\s\S]*\[data-print-statement\][\s\S]*visibility: visible[\s\S]*\.hp-no-print \{ display: none/.test(css), "print styles show only the statement and hide the buttons");
    ok(!!w.document.querySelector(".hp-no-print") && w.document.querySelector(".hp-no-print").contains(btn(/Print/)), "the Share / Print buttons are excluded from printing");
    w.close();
    console.log("OK: statement share/print checks passed (" + passed + " assertions).");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
