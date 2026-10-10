#!/usr/bin/env node
"use strict";

/**
 * iOS input zoom check (Pro).
 *
 * iOS Safari and home-screen PWAs zoom the page whenever a focused text field
 * renders below 16px, and the page can stay zoomed and cropped afterwards.
 * The fix is to size every text field at 16px or more, not to disable pinch
 * zoom.
 *
 * (1) Source scan: every <input>/<textarea>/<select> in
 *     home_services_pro_app.jsx that takes text has an inline fontSize >= 16.
 *     File, checkbox, radio and hidden inputs are skipped because iOS doesn't
 *     zoom on them.
 * (2) Viewport: the shell's viewport meta does not use maximum-scale or
 *     user-scalable=no. Pinch zoom stays available for accessibility.
 * (3) Live render: boots the built prototype-pro.html signed out (no real
 *     network), opens the Sign in screen, and checks that the rendered Email
 *     and Password fields are >= 16px.
 *
 * This simulates the iOS rule. It does not replace a check on a real iPhone.
 */

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { JSDOM } = require("jsdom");
const babel = require("@babel/core");
const parser = require("@babel/parser");

const root = path.resolve(__dirname, "..");
const MIN_PX = 16;
const NON_TEXT_TYPES = new Set(["file", "checkbox", "radio", "hidden", "range", "color", "submit", "button", "image", "reset"]);

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log("  ✓ " + msg); }

function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }

// ---------------------------------------------------------------------------
// (1) Source scan
// ---------------------------------------------------------------------------
function attr(el, name) {
  return el.openingElement.attributes.find(a => a.type === "JSXAttribute" && a.name && a.name.name === name) || null;
}
function staticString(a) {
  if (!a || !a.value) return null;
  if (a.value.type === "StringLiteral") return a.value.value;
  if (a.value.type === "JSXExpressionContainer" && a.value.expression.type === "StringLiteral") return a.value.expression.value;
  return undefined; // dynamic
}
function styleFontSize(el) {
  const s = attr(el, "style");
  if (!s || !s.value || s.value.type !== "JSXExpressionContainer") return { kind: "missing" };
  const obj = s.value.expression;
  if (obj.type !== "ObjectExpression") return { kind: "dynamic" };
  const prop = obj.properties.find(p => p.type === "ObjectProperty" && ((p.key.name || p.key.value) === "fontSize"));
  if (!prop) return { kind: "missing" };
  if (prop.value.type === "NumericLiteral") return { kind: "num", value: prop.value.value };
  return { kind: "dynamic" };
}

function sourceScan() {
  console.log("(1) Source scan: text fields are >= " + MIN_PX + "px");
  const src = read("home_services_pro_app.jsx");
  const ast = parser.parse(src, { sourceType: "module", plugins: ["jsx"] });
  const fields = [];
  (function walk(node) {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "JSXElement") {
      const n = node.openingElement.name;
      const tag = n && n.type === "JSXIdentifier" ? n.name : null;
      if (tag === "input" || tag === "textarea" || tag === "select") {
        const type = tag === "input" ? staticString(attr(node, "type")) : null;
        // type={type || "text"} (formField) is dynamic but always a text-like type.
        const isText = tag !== "input" || type == null || type === undefined || !NON_TEXT_TYPES.has(type);
        if (isText) fields.push({ tag, type, line: node.loc.start.line, fs: styleFontSize(node) });
      }
    }
    for (const k of Object.keys(node)) {
      if (k === "loc" || k === "start" || k === "end") continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === "string") walk(v);
    }
  })(ast.program);

  ok(fields.length >= 9, "found " + fields.length + " text fields to check (expected at least 9)");
  const bad = fields.filter(f => !(f.fs.kind === "num" && f.fs.value >= MIN_PX));
  ok(bad.length === 0, "every text field has an inline fontSize >= " + MIN_PX +
    (bad.length ? " — failing: " + bad.map(f => `${f.tag}@${f.line} (${f.fs.kind === "num" ? f.fs.value : f.fs.kind})`).join(", ") : ""));
}

// ---------------------------------------------------------------------------
// (2) Viewport
// ---------------------------------------------------------------------------
function viewportCheck() {
  console.log("(2) Viewport keeps pinch zoom");
  const shell = read("_shell_pre_pro.txt");
  const metas = shell.match(/<meta[^>]+name="viewport"[^>]*>/gi) || [];
  ok(metas.length >= 1, "shell has a viewport meta");
  for (const m of metas) {
    ok(!/user-scalable\s*=\s*(no|0)/i.test(m), "viewport does not set user-scalable=no");
    ok(!/maximum-scale/i.test(m), "viewport does not set maximum-scale");
  }
}

// ---------------------------------------------------------------------------
// (3) Live render of the Sign in screen
// ---------------------------------------------------------------------------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function liveCheck() {
  console.log("(3) Live render: Sign in fields are >= " + MIN_PX + "px");
  const htmlPath = fs.existsSync(path.join(root, "prototype-pro.html")) ? path.join(root, "prototype-pro.html") : path.join(root, "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const dom = new JSDOM(html, { url: "https://localhost/haven-pro/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  window.scrollTo = () => {};
  // No real network: every request resolves to an empty, signed-out answer.
  window.fetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ([]), text: async () => "[]" });
  // Signed-out Supabase auth client (same shape as tools/a1_backend_connect_check.js).
  window.supabase = {
    createClient() {
      return {
        auth: {
          async getSession() { return { data: { session: null }, error: null }; },
          async getUser() { return { data: { user: null }, error: { name: "AuthSessionMissingError", status: 400 } }; },
          onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
          async signInWithPassword() { return { data: { session: null }, error: { message: "not used", status: 400 } }; },
          async signOut() { return { error: null }; },
        },
      };
    },
  };

  const React = require("react");
  const ReactDOM = Object.assign({}, require("react-dom"), require("react-dom/client"));
  window.React = React; window.ReactDOM = ReactDOM;
  global.window = window; global.document = window.document; global.React = React; global.ReactDOM = ReactDOM;

  const script = window.document.querySelector('script[type="text/babel"]').textContent;
  const code = babel.transformSync(script, {
    filename: "pro-inline.jsx", babelrc: false, configFile: false,
    presets: [[require.resolve("@babel/preset-env"), { targets: { node: "current" } }], [require.resolve("@babel/preset-react"), { runtime: "classic" }]],
  }).code;
  window.eval(code);

  const findSignIn = () => Array.from(window.document.querySelectorAll("#root button"))
    .find(b => /^sign in/i.test((b.textContent || "").trim()));
  let btn = null;
  for (let i = 0; i < 150 && !btn; i++) { await sleep(20); btn = findSignIn(); }
  ok(!!btn, "signed-out screen offers a Sign in button");
  btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  let inputs = [];
  for (let i = 0; i < 150; i++) {
    await sleep(20);
    inputs = Array.from(window.document.querySelectorAll("#root input"))
      .filter(el => el.getAttribute("placeholder") === "you@example.com" || el.getAttribute("type") === "password");
    if (inputs.length >= 2) break;
  }
  ok(inputs.length >= 2, "Sign in screen renders Email and Password fields");
  for (const el of inputs) {
    const px = parseFloat(window.getComputedStyle(el).fontSize || el.style.fontSize);
    const label = el.getAttribute("type") === "password" ? "Password" : "Email";
    ok(px >= MIN_PX, label + " field renders at " + px + "px (>= " + MIN_PX + ")");
  }
  try { window.close(); } catch (_) {}
}

(async () => {
  try {
    sourceScan();
    viewportCheck();
    await liveCheck();
    console.log("OK: iOS input zoom checks passed (" + passed + " assertions).");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err && err.message ? err.message : err);
    process.exit(1);
  }
})();
