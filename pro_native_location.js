// Haven Pro native app (Capacitor) — background location spike. Founder approved
// 2026-11-10 as a limited prototype (draft only; not for store distribution).
//
// What this file does
// - havenLocationApi(): the one location source for the en-route watch in the
//   app. In the browser it is navigator.geolocation, unchanged. In the native
//   app it is a small shim with the same watchPosition / clearWatch shape over
//   @capacitor-community/background-geolocation, so the app's existing watch,
//   Fix 1 (permission denied stops sending) and Fix 2 (sign-out ends the watch)
//   run exactly as reviewed on Pro #75.
// - havenNativeHttpPost(): in the native app, the live-location POST goes through
//   Capacitor's native HTTP (not the web view's fetch, which Android slows after
//   ~5 min in the background). Same URL, headers and JSON body.
// - Spike diagnostics (HAVEN_NATIVE_SPIKE_DIAGNOSTICS, true only in the native
//   spike build): counts and times only, never coordinates or tokens, so a
//   real drive can show whether positions reached the app and sends were
//   accepted while the phone was locked.
//
// Permissions (assessment, section B): iPhone asks only "While Using the App";
// background updates continue because tracking starts with the app in front and
// the plugin enables background updates (blue indicator). Android uses the
// plugin's location foreground service with a persistent notification; no
// background-location permission. Tracking runs only while the app's existing
// en-route watch runs: never between jobs.

const HAVEN_NATIVE_SPIKE_DIAGNOSTICS = false; // the native spike build sets this to true
const HAVEN_NATIVE_HTTP_TIMEOUT_MS = 10000;
const HAVEN_NATIVE_NOTIFICATION_TITLE = "Haven Pro";
const HAVEN_NATIVE_NOTIFICATION_TEXT = "Sharing your location with this customer until you arrive.";

function havenCapacitor() {
  try { return typeof window !== "undefined" && window.Capacitor ? window.Capacitor : null; } catch (e) { return null; }
}
function havenIsNativeApp() {
  const C = havenCapacitor();
  try { return !!(C && typeof C.isNativePlatform === "function" && C.isNativePlatform()); } catch (e) { return false; }
}
function havenNativePlatform() {
  const C = havenCapacitor();
  try { return C && typeof C.getPlatform === "function" ? C.getPlatform() : "web"; } catch (e) { return "web"; }
}
const havenNativePluginCache = {};
function havenNativePlugin(name) {
  const C = havenCapacitor();
  if (!C) return null;
  if (havenNativePluginCache[name]) return havenNativePluginCache[name];
  let p = null;
  try { p = typeof C.registerPlugin === "function" ? C.registerPlugin(name) : (C.Plugins && C.Plugins[name]) || null; } catch (e) { p = null; }
  havenNativePluginCache[name] = p;
  return p;
}

// ── Diagnostics (no coordinates, no tokens) ─────────────────────────────────
function havenNewLiveDiag() {
  return {
    fixes: 0, fixesHidden: 0, sends: 0, sendsHidden: 0, ok: 0, okHidden: 0,
    retry: 0, rateLimited: 0, stopped: null, lastFixAt: null, lastOkAt: null,
    maxOkGapS: 0, maxOkGapHiddenS: 0, lastResult: null, watchErrors: 0, startedAt: null,
  };
}
const havenLiveDiag = havenNewLiveDiag();
function havenAppHidden() {
  try { return typeof document !== "undefined" && document.visibilityState === "hidden"; } catch (e) { return false; }
}
function havenDiagReset() { Object.assign(havenLiveDiag, havenNewLiveDiag(), { startedAt: Date.now() }); }
function havenDiagFix() {
  havenLiveDiag.fixes++; if (havenAppHidden()) havenLiveDiag.fixesHidden++;
  havenLiveDiag.lastFixAt = Date.now();
}
// Wraps the live-location send so each attempt and result is counted.
function havenDiagWrapSend(send) {
  return async function (jobId, fix) {
    const hidden = havenAppHidden();
    havenLiveDiag.sends++; if (hidden) havenLiveDiag.sendsHidden++;
    const r = await send(jobId, fix);
    const s = r && r.state;
    havenLiveDiag.lastResult = s === "stop" ? "stop:" + (r.error || "") : s || "none";
    if (s === "ok") {
      const now = Date.now();
      if (havenLiveDiag.lastOkAt) {
        const gap = Math.round((now - havenLiveDiag.lastOkAt) / 1000);
        if (gap > havenLiveDiag.maxOkGapS) havenLiveDiag.maxOkGapS = gap;
        if (hidden && gap > havenLiveDiag.maxOkGapHiddenS) havenLiveDiag.maxOkGapHiddenS = gap;
      }
      havenLiveDiag.ok++; if (hidden) havenLiveDiag.okHidden++;
      havenLiveDiag.lastOkAt = now;
    } else if (s === "retry") havenLiveDiag.retry++;
    else if (s === "rate_limited") havenLiveDiag.rateLimited++;
    else if (s === "stop") havenLiveDiag.stopped = r.error || "stop";
    return r;
  };
}
function havenDiagClock(t) {
  if (!t) return "—";
  const d = new Date(t);
  const p = n => String(n).padStart(2, "0");
  return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}
// Plain lines for the spike panel and for copying into a test report.
function havenDiagLines() {
  const g = havenLiveDiag;
  return [
    "Native: " + havenNativePlatform() + " · started " + havenDiagClock(g.startedAt),
    "Positions received: " + g.fixes + " (" + g.fixesHidden + " while in background)",
    "Sends: " + g.sends + " (" + g.sendsHidden + " in background) · accepted " + g.ok + " (" + g.okHidden + " in background)",
    "Retries " + g.retry + " · rate-limited " + g.rateLimited + " · watch errors " + g.watchErrors + (g.stopped ? " · stopped: " + g.stopped : ""),
    "Last position " + havenDiagClock(g.lastFixAt) + " · last accepted " + havenDiagClock(g.lastOkAt) + " · last result " + (g.lastResult || "—"),
    "Longest gap between accepted sends: " + g.maxOkGapS + " s (in background: " + g.maxOkGapHiddenS + " s)",
  ];
}

// ── Native HTTP for the live-location POST ──────────────────────────────────
// Returns a fetch-like response ({ ok, status, json() }) or throws on no
// connection / timeout, so sendProLiveLocation's mapping stays exactly the same.
async function havenNativeHttpPost(url, headers, bodyObject) {
  const http = havenNativePlugin("CapacitorHttp");
  if (!http || typeof http.request !== "function") throw new Error("native http unavailable");
  const r = await http.request({
    url: url, method: "POST", headers: headers, data: bodyObject,
    connectTimeout: HAVEN_NATIVE_HTTP_TIMEOUT_MS, readTimeout: HAVEN_NATIVE_HTTP_TIMEOUT_MS,
  });
  const status = Number(r && r.status) || 0;
  let data = r ? r.data : null;
  if (typeof data === "string") { try { data = JSON.parse(data); } catch (e) { data = undefined; } }
  return {
    ok: status >= 200 && status < 300, status: status,
    json: async () => { if (data === undefined) throw new SyntaxError("not json"); return data; },
  };
}
function havenUseNativeHttp() { return havenIsNativeApp() && !!havenNativePlugin("CapacitorHttp"); }

// ── Location source ─────────────────────────────────────────────────────────
// Native shim with the browser's watchPosition / clearWatch shape. Ids are
// returned at once; the plugin watcher is added when permission is settled and
// removed on clearWatch (even if that comes first).
function havenCreateNativeLocationApi(deps) {
  const bg = deps.backgroundGeolocation, geo = deps.geolocation, platform = deps.platform;
  let seq = 0;
  const watches = new Map(); // id -> { pluginId, cleared }
  function toPosition(loc) {
    return { coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy }, timestamp: typeof loc.time === "number" ? loc.time : Date.now() };
  }
  function start(id, onPos, onErr) {
    const w = watches.get(id);
    const fail = code => { if (!w.cleared && typeof onErr === "function") onErr({ code: code }); };
    (async () => {
      // iPhone: ask only "While Using the App" (never Always). Android: the plugin
      // asks for precise location itself.
      if (platform === "ios" && geo && typeof geo.requestPermissions === "function") {
        try {
          const st = await geo.requestPermissions({ permissions: ["location"] });
          if (st && st.location === "denied") { havenLiveDiag.watchErrors++; return fail(1); }
        } catch (e) { havenLiveDiag.watchErrors++; return fail(1); }
      }
      if (w.cleared) return;
      let pluginId;
      try {
        pluginId = await bg.addWatcher({
          backgroundTitle: HAVEN_NATIVE_NOTIFICATION_TITLE,
          backgroundMessage: HAVEN_NATIVE_NOTIFICATION_TEXT,
          requestPermissions: platform !== "ios",
          stale: false,
          distanceFilter: 0,
        }, (loc, err) => {
          if (w.cleared) return;
          if (err) {
            havenLiveDiag.watchErrors++;
            return fail(err.code === "NOT_AUTHORIZED" ? 1 : 2);
          }
          if (loc) onPos(toPosition(loc));
        });
      } catch (e) { havenLiveDiag.watchErrors++; return fail(e && e.code === "NOT_AUTHORIZED" ? 1 : 2); }
      w.pluginId = pluginId;
      if (w.cleared) { try { await bg.removeWatcher({ id: pluginId }); } catch (e) {} }
    })();
  }
  return {
    watchPosition(onPos, onErr /*, options: the plugin sets accuracy itself */) {
      const id = ++seq;
      watches.set(id, { pluginId: null, cleared: false });
      start(id, onPos, onErr);
      return id;
    },
    clearWatch(id) {
      const w = watches.get(id);
      if (!w) return;
      w.cleared = true;
      watches.delete(id);
      if (w.pluginId != null) { try { bg.removeWatcher({ id: w.pluginId }); } catch (e) {} }
    },
    activeCount() { return watches.size; },
  };
}
let havenNativeLocationApiInstance = null;
// The en-route watch's location API: native shim in the native app, else the browser's.
function havenLocationApi() {
  if (havenIsNativeApp()) {
    const bg = havenNativePlugin("BackgroundGeolocation");
    if (bg && typeof bg.addWatcher === "function") {
      if (!havenNativeLocationApiInstance) {
        havenNativeLocationApiInstance = havenCreateNativeLocationApi({ backgroundGeolocation: bg, geolocation: havenNativePlugin("Geolocation"), platform: havenNativePlatform() });
      }
      return havenNativeLocationApiInstance;
    }
  }
  try { return typeof navigator !== "undefined" && navigator.geolocation ? navigator.geolocation : null; } catch (e) { return null; }
}

// Spike-only panel under the notice (native spike build). Counts and times only.
function HavenLiveDiagPanel(props) {
  const h = React.createElement;
  const [, setTick] = React.useState(0);
  React.useEffect(() => { const id = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(id); }, []);
  return h("div", { "data-testid": "live-diag", style: { marginBottom: 12, padding: "10px 12px", borderRadius: 12, border: "1px dashed " + props.T.bd, background: props.T.w, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, lineHeight: 1.5, color: props.T.ts } },
    h("div", { style: { fontWeight: 700, color: props.T.tx } }, "Background test (spike build only)"),
    havenDiagLines().map((l, i) => h("div", { key: i }, l)));
}
