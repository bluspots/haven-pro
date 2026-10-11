#!/usr/bin/env node
"use strict";

/**
 * Interactive swipe-back (Pro). The same gesture as the Customer app,
 * exercised on Earnings (Job Earnings Statement) and Profile
 * (Settings > Notifications). Mocked backend only; the test copy starts with
 * the existing SIM_COMPLETED_JOBS sample history.
 *
 * Driven with pointer events (the input the app listens to). jsdom has no
 * layout, so the screen is treated as 390px wide starting at x = 0.
 *
 * (1) Follows the finger: while dragging, the screen moves by exactly the
 *     drag distance, and the previous screen is drawn underneath. Dragging
 *     back moves the screen back with it.
 * (2) Release rules (same as Customer): past 35% of the width, or a quick
 *     flick, finishes; a short slow drag slides back. Moving back toward the
 *     edge on release cancels.
 * (3) Only from the left edge (24px), only on screens with somewhere to go
 *     back to, never in a text field / sideways-scrolling row /
 *     data-no-swipe-back element / the Earnings chart. Mostly-vertical and
 *     leftward drags never go back. A second finger (pinch) cancels.
 * (4) Exactly one Back per swipe: two levels deep, one swipe goes back one
 *     level, even if another swipe starts while the first is finishing.
 * (5) Scroll position: the previous screen underneath and after returning
 *     shows where it was scrolled (Earnings and Profile).
 * (6) The ‹ button still works; reduced motion finishes with no animation.
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

// ── helpers ────────────────────────────────────────────────────────────
function click(w, el) { el.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); }
function tab(w, label) {
  const b = Array.from(w.document.querySelectorAll(".hp-tab-btn")).find(x => (x.textContent || "").includes(label));
  if (!b) throw new Error("no tab " + label);
  click(w, b);
}
const fg = w => w.document.querySelector("[data-swipe-foreground]");
const underlay = w => w.document.querySelector("[data-swipe-underlay]");
// Title of the visible screen: the text next to its ‹ button ("" on a tab's root screen).
function titleIn(el) {
  if (!el) return "";
  const b = Array.from(el.querySelectorAll("button")).find(x => (x.textContent || "").trim() === "‹" && !/^(Previous|Next) /.test(x.getAttribute("aria-label") || "")); // the screen's Back, not the chart's ‹ period button
  return b && b.nextElementSibling ? b.nextElementSibling.textContent.trim() : "";
}
const title = w => titleIn(fg(w));
const fgX = w => { const m = /translateX\((-?[\d.]+)px\)/.exec(fg(w).style.transform || ""); return m ? Number(m[1]) : 0; };
const fgScroller = w => fg(w).querySelector(".hp-scroll");
function ptr(w, el, type, x, y, opts) {
  opts = opts || {};
  const ev = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(ev, "pointerId", { value: opts.id || 1 });
  Object.defineProperty(ev, "isPrimary", { value: opts.primary !== false });
  Object.defineProperty(ev, "pointerType", { value: "touch" });
  el.dispatchEvent(ev);
}
// Drag through points; `gap` ms between moves sets the speed (8px / 20ms = 0.4 px/ms, under the 0.55 flick speed).
async function drag(w, el, pts, opts) {
  opts = opts || {};
  const gap = opts.gap == null ? 20 : opts.gap;
  ptr(w, el, "pointerdown", pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) { await sleep(gap); ptr(w, el, "pointermove", pts[i][0], pts[i][1]); }
  await sleep(10);
  if (opts.release !== false) ptr(w, el, "pointerup", pts[pts.length - 1][0], pts[pts.length - 1][1]);
}
function line(from, to, step) {
  const pts = [from]; const n = Math.max(1, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / (step || 8)));
  for (let i = 1; i <= n; i++) pts.push([from[0] + (to[0] - from[0]) * i / n, from[1] + (to[1] - from[1]) * i / n]);
  return pts;
}
const settle = () => sleep(360); // 280ms settle + margin

async function openStatement(w) {
  const sc = fg(w).querySelector("[data-earnings-scroll]");
  const row = Array.from(sc.querySelectorAll("button")).find(b => /Faucet|Repair|Install|Mounting|Cleaning|Assembly|Cooling/.test(b.textContent || "") && /\$/.test(b.textContent || ""));
  click(w, row);
  await waitFor(w, x => title(x) === "Job Earnings Statement", "statement");
}
function navButton(w, label) {
  const b = Array.from(fg(w).querySelectorAll("button")).find(x => { const d = x.querySelector("span div"); return d && d.textContent.trim() === label; });
  if (!b) throw new Error("no row " + label);
  return b;
}
function injectRow(w, attrs, scrollWidth, tag) {
  const el = w.document.createElement(tag || "div");
  if (!tag) {
    el.setAttribute("style", "overflow-x: auto; overflow-y: hidden;");
    Object.defineProperty(el, "scrollWidth", { value: scrollWidth == null ? 800 : scrollWidth });
    Object.defineProperty(el, "clientWidth", { value: 300 });
    el.textContent = "row";
  }
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
  fgScroller(w).appendChild(el);
  return el;
}

(async () => {
  try {
    const w = await renderApp();
    await waitFor(w, x => text(x).includes("My Jobs"), "signed-in app");
    tab(w, "Earnings");
    await waitFor(w, x => /This Week/i.test(text(x)) && /Completed Jobs/.test(text(x)), "Earnings main");

    console.log("(3) No previous screen, no swipe");
    await drag(w, fgScroller(w), line([10, 400], [250, 404]));
    await settle();
    ok(!underlay(w) && /This Week/i.test(text(w)) && title(w) === "", "edge swipe on Earnings (a tab's first screen) does nothing");

    fgScroller(w).scrollTop = 640;
    await openStatement(w);
    ok(fgScroller(w).scrollTop === 0, "statement opens at the top");

    console.log("(1) Follows the finger, previous screen underneath");
    await drag(w, fgScroller(w), line([10, 400], [130, 404]), { release: false });
    ok(fgX(w) === 120, "screen moved with the finger (120px) — " + fg(w).style.transform);
    ok(!!underlay(w) && /This Week|Completed Jobs/.test(underlay(w).textContent) && !!underlay(w).querySelector("[data-earnings-chart]"), "Earnings main is drawn underneath while dragging");
    ok(underlay(w).getAttribute("aria-hidden") === "true" && underlay(w).hasAttribute("inert"), "the screen underneath can't be tapped or read out");
    const under = underlay(w).querySelector(".hp-scroll");
    ok(under && under.scrollTop === 640, "screen underneath shows where it was scrolled (640)");
    ok(/translateX\(-/.test(underlay(w).style.transform), "screen underneath has the iOS-style parallax offset");
    await sleep(20); ptr(w, fg(w), "pointermove", 210, 404);
    await sleep(10);
    ok(fgX(w) === 200, "peek further (200px)");
    for (const x of [180, 140, 100, 60]) { await sleep(20); ptr(w, fg(w), "pointermove", x, 404); }
    await sleep(10);
    ok(fgX(w) === 50, "dragging back moves the screen back with the finger (50px)");
    ptr(w, fg(w), "pointerup", 60, 404);
    await sleep(30);
    ok(/transition/.test(fg(w).getAttribute("style")) && fgX(w) === 0, "released short: slides back to 0 with an animation");
    await settle();
    ok(title(w) === "Job Earnings Statement" && !underlay(w), "short slow release stays on the statement");

    console.log("(2) Moving back toward the edge on release cancels");
    await drag(w, fgScroller(w), [...line([10, 400], [250, 400]), [244, 400], [236, 400]], { gap: 20 });
    await settle();
    ok(title(w) === "Job Earnings Statement", "released at 58% while moving back toward the edge: stays");

    console.log("(3) Direction lock and opt-outs");
    await drag(w, fgScroller(w), line([10, 300], [40, 520])); await settle();
    ok(title(w) === "Job Earnings Statement", "mostly vertical drag (scrolling) does not go back");
    await drag(w, fgScroller(w), line([10, 400], [30, 430])); await settle();
    ok(title(w) === "Job Earnings Statement", "slightly diagonal, mostly-down drag does not go back");
    await drag(w, fgScroller(w), line([60, 400], [300, 404])); await settle();
    ok(title(w) === "Job Earnings Statement", "drag starting 60px from the edge does not go back");
    await drag(w, fgScroller(w), line([20, 400], [2, 402])); await settle();
    ok(title(w) === "Job Earnings Statement", "leftward drag does not go back");
    for (const [label, el] of [
      ["a sideways-scrolling row", injectRow(w)],
      ["a data-no-swipe-back element", injectRow(w, { "data-no-swipe-back": "" }, 300)],
      ["a text field", injectRow(w, {}, 0, "input")],
      ["an element that handles its own touches", injectRow(w, { style: "touch-action: none" }, 300)],
    ]) {
      await drag(w, el, line([10, 400], [300, 404])); await settle();
      ok(title(w) === "Job Earnings Statement" && !underlay(w), "swipe starting in " + label + " does not go back");
    }
    ptr(w, fgScroller(w), "pointerdown", 10, 400);
    for (const x of [30, 60, 90, 120, 150]) { await sleep(20); ptr(w, fgScroller(w), "pointermove", x, 401); }
    ptr(w, fgScroller(w), "pointerdown", 200, 500, { id: 2, primary: false });
    ptr(w, fgScroller(w), "pointerup", 200, 401);
    await settle();
    ok(title(w) === "Job Earnings Statement" && fgX(w) === 0, "a second finger (pinch) cancels the swipe");

    console.log("(2)(5) Past 35% finishes, and the list is where it was");
    await drag(w, fgScroller(w), line([10, 400], [170, 404]));   // 41%, slow
    await settle();
    ok(title(w) === "" && !!fg(w).querySelector("[data-earnings-chart]"), "released at 41%: back on Earnings main");
    ok(fgScroller(w).scrollTop === 640, "returned to the same scroll position (640)");
    ok(!underlay(w) && fgX(w) === 0, "screen is at rest afterwards");

    console.log("(2) Quick flick finishes even when short");
    await openStatement(w);
    await drag(w, fgScroller(w), line([10, 400], [90, 402], 20), { gap: 4 });  // 80px, fast
    await settle();
    ok(title(w) === "", "quick 80px flick goes back");

    console.log("(4)(5) Profile: one level per swipe, scroll kept");
    tab(w, "Profile");
    await waitFor(w, x => /Settings/.test(text(x)) && title(x) === "", "Profile");
    fgScroller(w).scrollTop = 500;
    click(w, navButton(w, "Settings"));
    await waitFor(w, x => title(x) === "Settings", "Settings");
    ok(fgScroller(w).scrollTop === 0, "Settings opens at the top");
    fgScroller(w).scrollTop = 120;
    click(w, navButton(w, "Notifications"));
    await waitFor(w, x => title(x) === "Notifications", "Notifications");
    await drag(w, fgScroller(w), line([10, 400], [200, 404]));
    await sleep(60);
    await drag(w, fg(w), line([10, 400], [200, 404]));   // second swipe while the first is finishing
    await settle(); await settle();
    ok(title(w) === "Settings", "one swipe = one Back: Notifications -> Settings (the overlapping swipe was ignored)");
    ok(fgScroller(w).scrollTop === 120, "Settings is where it was scrolled (120)");
    await drag(w, fgScroller(w), line([10, 400], [200, 404], 8), { release: false });
    ok(titleIn(underlay(w)) === "" && /Settings/.test(underlay(w).textContent) && underlay(w).querySelector(".hp-scroll").scrollTop === 500, "Profile is drawn underneath at its scroll position (500)");
    ptr(w, fg(w), "pointerup", 200, 404);
    await settle();
    ok(title(w) === "" && fgScroller(w).scrollTop === 500, "back on Profile at the same scroll position (500)");

    console.log("(6) ‹ button still works");
    click(w, navButton(w, "Settings"));
    await waitFor(w, x => title(x) === "Settings", "Settings again");
    click(w, Array.from(fg(w).querySelectorAll("button")).find(b => b.textContent.trim() === "‹" && !/^(Previous|Next) /.test(b.getAttribute("aria-label") || "")));
    await waitFor(w, x => title(x) === "", "Profile via ‹");
    ok(fgScroller(w).scrollTop === 500, "‹ returns to the same scroll position too");
    w.close();

    console.log("(6) Reduced motion");
    const r = await renderApp({ reducedMotion: true });
    await waitFor(r, x => text(x).includes("My Jobs"), "signed-in app (reduced motion)");
    tab(r, "Profile");
    await waitFor(r, x => title(x) === "" && /Appearance/.test(text(x)), "Profile (reduced motion)");
    click(r, navButton(r, "Settings"));
    await waitFor(r, x => title(x) === "Settings", "Settings (reduced motion)");
    await drag(r, fgScroller(r), line([10, 400], [200, 404]), { release: false });
    ok(!underlay(r) && fgX(r) === 0, "reduced motion: nothing slides while dragging");
    ptr(r, fg(r), "pointerup", 200, 404);
    await sleep(40);
    ok(title(r) === "", "reduced motion: release past 35% goes back straight away");
    r.close();

    console.log("OK: swipe-back checks passed (" + passed + " assertions).");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
