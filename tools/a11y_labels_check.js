#!/usr/bin/env node
"use strict";

/**
 * Screen-reader labels (Pro). VoiceOver reads a button's text, so buttons
 * that show only a symbol need a label.
 *
 * (1) Source scan: every <button> whose visible text is only a symbol
 *     (‹ › ✕ × ← →) has an aria-label (the ‹ back arrows say "Back", the
 *     filter's ✕ says "Clear filter").
 * (2) Earnings calendar: a day with jobs reads like "October 5, 2 jobs,
 *     $225"; a day without jobs reads "..., no jobs", is marked unavailable
 *     (aria-disabled) and is skipped by the keyboard (tabIndex -1).
 * No visual change.
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


let parser;
try { parser = require("@babel/parser"); } catch (_) { parser = null; }

function sourceScan() {
  console.log("(1) Symbol-only buttons have labels");
  const src = read("home_services_pro_app.jsx");
  const ast = require("@babel/parser").parse(src, { sourceType: "module", plugins: ["jsx"] });
  const bad = []; let count = 0;
  (function walk(n) {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "JSXElement" && n.openingElement.name.name === "button") {
      const text = n.children.filter(c => c.type === "JSXText").map(c => c.value).join("").trim();
      const onlyText = n.children.every(c => c.type === "JSXText");
      if (onlyText && text && /^[‹›✕×←→]$/.test(text)) {
        count++;
        const has = n.openingElement.attributes.some(a => a.type === "JSXAttribute" && a.name && a.name.name === "aria-label");
        if (!has) bad.push(text + "@" + n.loc.start.line);
      }
    }
    for (const k of Object.keys(n)) { if (k === "loc") continue; const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === "string") walk(v); }
  })(ast.program);
  ok(count >= 5, "found " + count + " symbol-only buttons");
  ok(bad.length === 0, "every symbol-only button has an aria-label" + (bad.length ? " — missing: " + bad.join(", ") : ""));
}

(async () => {
  try {
    sourceScan();
    console.log("(2) Earnings calendar days");
    const w = await renderApp();
    await waitFor(w, x => text(x).includes("My Jobs"), "signed-in app");
    const tabBtn = Array.from(w.document.querySelectorAll(".hp-tab-btn")).find(b => /Earnings/.test(b.textContent));
    tabBtn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await waitFor(w, x => /Lifetime/.test(text(x)), "Earnings");
    const click = el => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    click(Array.from(w.document.querySelectorAll("button")).find(b => /Lifetime/.test(b.textContent)));
    await waitFor(w, x => /Monthly Breakdown/.test(text(x)), "Monthly");
    click(Array.from(w.document.querySelectorAll("[data-swipe-foreground] button")).find(b => /\$/.test(b.textContent)));
    await sleep(80);
    const days = Array.from(w.document.querySelectorAll("[data-swipe-foreground] button")).filter(b => /^\d+/.test(b.textContent.trim()));
    const withJobs = days.filter(b => /\$/.test(b.textContent));
    const without = days.filter(b => !/\$/.test(b.textContent));
    ok(withJobs.length > 0 && without.length > 0, "calendar shows days with and without jobs (" + withJobs.length + " / " + without.length + ")");
    ok(withJobs.every(b => /^[A-Z][a-z]+ \d+, \d+ jobs?, \$\d+/.test(b.getAttribute("aria-label") || "")), 'days with jobs read like "' + (withJobs[0].getAttribute("aria-label")) + '"');
    ok(withJobs.every(b => !b.hasAttribute("aria-disabled") && b.tabIndex !== -1), "days with jobs are available and focusable");
    ok(without.every(b => /, no jobs$/.test(b.getAttribute("aria-label") || "") && b.getAttribute("aria-disabled") === "true" && b.tabIndex === -1), 'days without jobs read "no jobs", are marked unavailable and skipped by the keyboard');
    ok(Array.from(w.document.querySelectorAll("[data-swipe-foreground] button")).filter(b => b.textContent.trim() === "‹").every(b => b.getAttribute("aria-label") === "Back"), 'the ‹ on the calendar is announced as "Back"');
    w.close();
    console.log("OK: screen-reader label checks passed (" + passed + " assertions).");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
