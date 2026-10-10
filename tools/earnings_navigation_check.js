#!/usr/bin/env node
"use strict";

/**
 * Earnings navigation (Pro). Mocked backend only (no real network).
 *
 * The test copy of the app starts with the existing SIM_COMPLETED_JOBS sample
 * history (sim_seeds.js) so the Earnings ledger has rows. That substitution
 * happens only in this test; the shipped app is unchanged. No earnings math
 * is touched by the feature under test.
 *
 * (1) Opening a Job Earnings Statement from a scrolled Earnings screen
 *     starts at the top.
 * (2) Back (the ‹ button, or a swipe) returns to the same scroll position.
 * (3) The selected period (Week / Month / Year) is kept through detail and
 *     back.
 * (4) Tapping the Earnings tab resets to the top of the main screen.
 * (5) The chart swipe ignores diagonal / mostly-vertical drags and still
 *     responds to a clear horizontal swipe.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.resolve(__dirname, "..");
const PRO_ID = "cccccccc-dddd-4eee-8fff-00000000ea7e";
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
  window.localStorage.setItem("haven_supabase_url", "https://earnings-nav.supabase.co");
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
// Swipe-back is an interactive edge gesture driven by pointer events
// (tools/swipe_back_check.js covers it in depth). jsdom has no PointerEvent,
// so these are MouseEvents with the pointer fields added.
function ptr(w, el, type, x, y) {
  const ev = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  Object.defineProperty(ev, "isPrimary", { value: true });
  Object.defineProperty(ev, "pointerType", { value: "touch" });
  el.dispatchEvent(ev);
}
async function edgeSwipe(w, el, from, to) {
  ptr(w, el, "pointerdown", from[0], from[1]);
  for (let i = 1; i <= 20; i++) { await sleep(20); ptr(w, el, "pointermove", from[0] + (to[0] - from[0]) * i / 20, from[1] + (to[1] - from[1]) * i / 20); }
  ptr(w, el, "pointerup", to[0], to[1]);
  await sleep(360); // slide-out animation
}
function chartEl(w) { return w.document.querySelector("[data-earnings-chart]"); }
function chartTitle(w) {
  const el = chartEl(w);
  const t = el && Array.from(el.querySelectorAll("div")).find(d => d.children.length === 0 && /^(This |Last )?(Week|Month|Year)$/i.test((d.textContent || "").trim()));
  return t ? t.textContent.trim() : "?";
}
function chartRange(w) {
  const el = chartEl(w);
  const r = el && Array.from(el.querySelectorAll("div")).find(d => d.children.length === 0 && /\d+\/\d+\/\d+ - |^[A-Z][a-z]+ \d{4}$|^\d{4}$/.test((d.textContent || "").trim()));
  return r ? r.textContent.trim() : "?";
}
function chartTotal(w) {
  const el = chartEl(w);
  const t = el && Array.from(el.querySelectorAll("div")).find(d => d.children.length === 0 && /^\$\d+$/.test((d.textContent || "").trim()));
  return t ? t.textContent.trim() : "?";
}
function selectedScale(w) {
  const b = Array.from(chartEl(w).querySelectorAll('[role="tab"]')).find(x => x.getAttribute("aria-selected") === "true");
  return b ? b.textContent.trim() : "?";
}
function clickEl(w, el) { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }
function scaleTab(w, label) { return Array.from(chartEl(w).querySelectorAll('[role="tab"]')).find(x => x.textContent.trim() === label); }
function navBtn(w, label) { return chartEl(w).querySelector(`button[aria-label="${label}"]`); }
async function chartSwipe(w, from, to) { await swipe(w, chartEl(w), from, to); await sleep(420); } // slide animation
function firstLedgerRow(w) {
  return Array.from(scroller(w).querySelectorAll("button")).find(b => /Faucet|Repair|Install|Mounting|Cleaning|Assembly|Cooling/.test(b.textContent || "") && /\$/.test(b.textContent || ""));
}
function backButton(w) {
  return Array.from(scroller(w).querySelectorAll("button")).find(b => (b.textContent || "").trim().startsWith("‹"));
}

(async () => {
  try {
    const w = await renderApp();
    await waitFor(w, t => t.includes("My Jobs"), "signed-in app");
    tab(w, "Earnings");
    await waitFor(w, t => /This Week/i.test(t) && /Completed Jobs/.test(t), "Earnings main with sample history");

    console.log("(5) Swiping moves through time; the toggle picks the scale");
    ok(chartTitle(w) === "This Week" && selectedScale(w) === "Week", "starts on This Week");
    const thisWeekRange = chartRange(w), thisWeekTotal = chartTotal(w);
    ok(navBtn(w, "Next week").disabled, "› (next) is disabled on the current week");
    await chartSwipe(w, [300, 300], [220, 360]); // 80 across, 60 down
    ok(chartTitle(w) === "This Week", "diagonal drag (80px across, 60px down) does not move the chart");
    await chartSwipe(w, [300, 300], [300, 420]);
    ok(chartTitle(w) === "This Week", "vertical drag does not move the chart");
    await chartSwipe(w, [300, 300], [210, 310]); // swipe left: newer, blocked at current
    ok(chartTitle(w) === "This Week" && chartRange(w) === thisWeekRange, "swipe left on the current week stays put (no future periods)");
    await chartSwipe(w, [120, 300], [230, 306]); // swipe right: older
    ok(chartTitle(w) === "Last Week" && chartRange(w) !== thisWeekRange, "swipe right shows Last Week (" + chartRange(w) + ")");
    ok(selectedScale(w) === "Week", "scale stays Week while swiping");
    await chartSwipe(w, [300, 300], [190, 304]); // swipe left: back to newer
    ok(chartTitle(w) === "This Week" && chartTotal(w) === thisWeekTotal, "swipe left returns to This Week with the same total (" + thisWeekTotal + ")");
    clickEl(w, scaleTab(w, "Month"));
    await sleep(40);
    ok(chartTitle(w) === "This Month" && selectedScale(w) === "Month", "toggle switches to Month");
    clickEl(w, navBtn(w, "Previous month"));
    await sleep(40);
    ok(chartTitle(w) === "Last Month", "‹ shows Last Month (" + chartRange(w) + ")");
    const lastMonthRange = chartRange(w);

    console.log("(1)(2)(3) Detail starts at top; Back restores scroll, scale and period");
    scroller(w).scrollTop = 640;
    const row = firstLedgerRow(w);
    ok(!!row, "ledger has a job row to open");
    row.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await waitFor(w, t => t.includes("Job Earnings Statement"), "statement");
    ok(scroller(w).scrollTop === 0, "statement opens at the top");
    backButton(w).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await waitFor(w, t => !t.includes("Job Earnings Statement") && !!chartEl(w), "back on main");
    ok(scroller(w).scrollTop === 640, "‹ Back returns to the same scroll position (640)");
    ok(selectedScale(w) === "Month" && chartTitle(w) === "Last Month" && chartRange(w) === lastMonthRange, "Month scale and the viewed month (" + lastMonthRange + ") kept after Back");

    firstLedgerRow(w).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await waitFor(w, t => t.includes("Job Earnings Statement"), "statement again");
    await edgeSwipe(w, scroller(w), [10, 400], [220, 410]); // swipe back from the left edge
    await waitFor(w, t => !t.includes("Job Earnings Statement") && !!chartEl(w), "back on main after swipe");
    ok(scroller(w).scrollTop === 640, "swipe back returns to the same scroll position (640)");

    console.log("(4) Tapping the Earnings tab resets to the top");
    firstLedgerRow(w).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await waitFor(w, t => t.includes("Job Earnings Statement"), "statement for tab reset");
    scroller(w).scrollTop = 300; // scrolled inside the statement
    tab(w, "Earnings");
    await waitFor(w, t => !t.includes("Job Earnings Statement"), "Earnings root");
    ok(scroller(w).scrollTop === 0, "Earnings tab tap (from a scrolled statement) returns to the top of the main screen");
    scroller(w).scrollTop = 500;
    tab(w, "Earnings");
    await sleep(40);
    ok(scroller(w).scrollTop === 0, "tapping the Earnings tab while already on it scrolls to the top");

    console.log("(6) Limits");
    clickEl(w, scaleTab(w, "Year"));
    await sleep(40);
    ok(chartTitle(w) === "This Year", "Year scale shows This Year (the viewed September is in it)");
    ok(navBtn(w, "Previous year").disabled && navBtn(w, "Next year").disabled, "‹ and › are disabled: no completed jobs before this year, no future years");
    await chartSwipe(w, [120, 300], [240, 304]);
    ok(chartTitle(w) === "This Year", "swipe right past the first completed job's year stays put");

    w.close();
    console.log("OK: earnings navigation checks passed (" + passed + " assertions).");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
