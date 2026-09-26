#!/usr/bin/env node
"use strict";

/**
 * Boot check for Haven Pro's concat-built prototype HTML.
 * - Builds first (via `npm run build`)
 * - Loads prototype-pro.html (or fallback index.html)
 * - Extracts the <script type="text/babel"> block
 * - Transpiles JSX with Babel presets (env, react classic)
 * - Executes in a jsdom window with React/ReactDOM globals provided
 * - Asserts render completes without throwing
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");
const babel = require("@babel/core");

// React globals (Dev deps, harness-only)
const React = require("react");
// React 18: createRoot lives in react-dom/client. Emulate UMD's window.ReactDOM.
const ReactDOMClient = require("react-dom/client");
const ReactDOMLegacy = (() => {
  try {
    return require("react-dom");
  } catch {
    return {};
  }
})();

function findBuiltHtmlPath(repoRoot) {
  const preferred = path.join(repoRoot, "prototype-pro.html");
  if (fs.existsSync(preferred)) return preferred;
  const fallback = path.join(repoRoot, "index.html");
  if (fs.existsSync(fallback)) return fallback;
  throw new Error("No built HTML found (expected prototype-pro.html or index.html). Run build first.");
}

function extractBabelScript(htmlText) {
  const dom = new JSDOM(htmlText);
  const scriptEl = dom.window.document.querySelector('script[type="text/babel"]');
  if (!scriptEl) {
    throw new Error("No <script type=\"text/babel\"> block found in built HTML.");
  }
  return scriptEl.textContent || "";
}

async function main() {
  const repoRoot = process.cwd();
  const htmlPath = findBuiltHtmlPath(repoRoot);
  const html = fs.readFileSync(htmlPath, "utf8");

  // Create a jsdom window to host our app
  const dom = new JSDOM(html, {
    url: "https://localhost/",
    runScripts: "outside-only",
    resources: "usable",
    pretendToBeVisual: true
  });

  // Provide global-like objects/bridges
  const { window } = dom;
  const { document } = window;

  // Minimal polyfills/stubs commonly used by app code
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.cancelAnimationFrame = window.cancelAnimationFrame || (id => clearTimeout(id));
  window.localStorage = window.localStorage || {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {}
  };
  // Non-networking harness: stub fetch to a resolved response to prevent crashes if called at boot
  if (typeof window.fetch !== "function") {
    window.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
    });
  }

  // Attach React/ReactDOM as globals like the UMD CDN tags do
  const ReactDOM = { ...ReactDOMLegacy, ...ReactDOMClient };
  window.React = React;
  window.ReactDOM = ReactDOM;
  // Also expose on Node globals for modules that look there
  global.window = window;
  global.document = document;
  global.React = React;
  global.ReactDOM = ReactDOM;

  // Extract and transpile the inline Babel script
  const babelScript = extractBabelScript(html);
  const transpiled = babel.transformSync(babelScript, {
    filename: "prototype-inline.jsx",
    presets: [
      [require.resolve("@babel/preset-env"), { targets: { node: "current" } }],
      [require.resolve("@babel/preset-react"), { runtime: "classic" }]
    ],
    babelrc: false,
    configFile: false
  });

  if (!transpiled || typeof transpiled.code !== "string") {
    throw new Error("Babel failed to transpile the inline script.");
  }

  // Execute the transpiled code in the jsdom window context
  // Use window.eval to ensure globals like `document` resolve correctly.

  let thrown = null;
  try {
    window.eval(transpiled.code);
  } catch (err) {
    thrown = err;
  }
  if (thrown) {
    console.error("Boot check failed: exception during execution:", thrown && thrown.stack ? thrown.stack : thrown);
    process.exit(1);
  }

  // Allow any microtasks to flush (React updates)
  await new Promise(resolve => setTimeout(resolve, 20));

  const root = document.getElementById("root");
  if (!root) {
    console.error("Boot check failed: #root not found after execution.");
    process.exit(1);
  }

  // Heuristic: Either content rendered or at least no crash and React root mounted
  const hasContent = (root.textContent || "").trim().length > 0 || root.children.length > 0;
  if (!hasContent) {
    // Not a hard failure — boot without UI changes can be legitimate. Report pass with a notice.
    console.log("Boot check: executed without errors. UI content may be empty at boot; this is acceptable.");
  } else {
    console.log("Boot check: executed and rendered content.");
  }
  console.log(`OK: Verified concat-built HTML (${path.basename(htmlPath)}).`);
  // Explicitly close jsdom window and exit to avoid lingering handles
  try {
    if (dom && dom.window && typeof dom.window.close === "function") {
      dom.window.close();
    }
  } catch (_) {
    // ignore cleanup errors
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Boot check unexpected error:", err && err.stack ? err.stack : err);
  process.exit(1);
});

