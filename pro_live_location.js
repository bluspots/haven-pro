// Live location while Driving to Job (Pro). Founder approved 2026-11-06 (draft).
//
// What it does: while the assigned Pro's job is en_route, the Haven Pro app
// sends the Pro's latest location to that job's Customer through
// public.pro_update_live_location (migration 0032), using the app's existing
// location watch. Nothing else: no history, no geocoding, no ETA or route.
//
// Rules (Hub prompt CLAUDE_PROMPT_PRO_LIVE_TRACKING):
// - Only a backend-claimed job, status en_route, signed in. SIM/demo, board,
//   unassigned and every other status never send.
// - The point goes only in the POST JSON body (sendProLiveLocation in
//   backend_adapter.js). Never on a URL, never to localStorage, never to the
//   job destination or the operating area. Never logged.
// - First good fix is sent at once. Then at most every 10 s while the Pro has
//   moved >= ~25 m since the last successful send, else a 30 s heartbeat.
// - rate_limited: wait retry_after_s (4 s if missing) and carry on.
// - Any other refusal (not_found, tracking_not_active, not_authenticated,
//   invalid_point, 401/403, other 4xx) stops sending for this job.
// - No connection / server error: not a refusal. Keep the session and try
//   again on the normal cadence (10 s minimum between attempts).

const HAVEN_LIVE_MIN_INTERVAL_MS = 10000;   // moving
const HAVEN_LIVE_HEARTBEAT_MS = 30000;      // not moving
const HAVEN_LIVE_MOVE_M = 25;
const HAVEN_LIVE_MAX_ACCURACY_M = 100;
const HAVEN_LIVE_RATE_LIMIT_DEFAULT_S = 4;
// A heartbeat never repeats a fix older than this: if the device has stopped
// reporting, sending stops too, and the Customer side shows "paused" honestly.
const HAVEN_LIVE_MAX_FIX_AGE_MS = 120000;
const HAVEN_LIVE_NOTICE = "Sharing your location with this customer until you arrive.";
const HAVEN_LIVE_NO_PERMISSION = "Your location isn't being shared with this customer because Haven Pro doesn't have location permission.";
const HAVEN_LIVE_STOPPED = "Your location isn't being shared with this customer right now.";

// Only an assigned, backend-claimed, real job that is Driving to Job.
function havenLiveShareEligible(job, backendConfigured) {
  return !!backendConfigured && !!job && !!job.backendClaimed && job.status === "en_route"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(job.id || ""));
}

// A device fix -> { lat, lng, capturedAt } or null when it must not be sent.
// pos is a GeolocationPosition-like object. Accuracy is checked, never kept.
function havenLiveFix(pos) {
  const c = pos && pos.coords;
  if (!c) return null;
  const lat = c.latitude, lng = c.longitude;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null; // junk fix
  if (typeof c.accuracy === "number" && (!Number.isFinite(c.accuracy) || c.accuracy > HAVEN_LIVE_MAX_ACCURACY_M)) return null;
  const t = typeof pos.timestamp === "number" && Number.isFinite(pos.timestamp) ? pos.timestamp : null;
  return { lat: lat, lng: lng, capturedAt: t };
}

function havenMetersBetween(a, b) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// One sending session for one job. deps: { send(jobId, fix) -> Promise<result>,
// now(), setTimer(fn, ms) -> id, clearTimer(id), onStop(code) }.
// result: { state: "ok" } | { state: "rate_limited", retryAfterS } |
//         { state: "stop", error } | { state: "retry" }.
function havenCreateLiveSender(jobId, deps) {
  const now = deps.now || (() => Date.now());
  const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer || (id => clearTimeout(id));
  let latest = null, lastSent = null, lastSentAt = 0, lastAttemptAt = 0, holdUntil = 0;
  let inFlight = false, stopped = false, timer = null, sentCount = 0;

  function schedule(ms) {
    if (timer != null) clearTimer(timer);
    timer = setTimer(() => { timer = null; pump(); }, Math.max(0, ms));
  }
  function stop(code) {
    if (stopped) return;
    stopped = true; latest = null; lastSent = null;
    if (timer != null) { clearTimer(timer); timer = null; }
    if (code && typeof deps.onStop === "function") deps.onStop(code);
  }
  function pump() {
    if (stopped || inFlight || !latest) return;
    const t = now();
    if (t < holdUntil) { schedule(holdUntil - t); return; }
    let due;
    if (!lastSent) due = lastAttemptAt ? lastAttemptAt + HAVEN_LIVE_MIN_INTERVAL_MS : t;
    else {
      const moved = havenMetersBetween(lastSent, latest) >= HAVEN_LIVE_MOVE_M;
      due = lastSentAt + (moved ? HAVEN_LIVE_MIN_INTERVAL_MS : HAVEN_LIVE_HEARTBEAT_MS);
      if (lastAttemptAt) due = Math.max(due, lastAttemptAt + HAVEN_LIVE_MIN_INTERVAL_MS);
    }
    if (t < due) { schedule(due - t); return; }
    // Heartbeat only with a recent fix; a silent device is not reported as current.
    if (latest.receivedAt != null && t - latest.receivedAt > HAVEN_LIVE_MAX_FIX_AGE_MS) return;
    const fix = latest;
    inFlight = true; lastAttemptAt = t;
    Promise.resolve().then(() => deps.send(jobId, fix)).then(res => res, () => ({ state: "retry" })).then(res => {
      inFlight = false;
      if (stopped) return;
      const r = res || { state: "retry" };
      if (r.state === "ok") { lastSent = fix; lastSentAt = lastAttemptAt; sentCount++; }
      else if (r.state === "rate_limited") {
        const s = Number(r.retryAfterS);
        holdUntil = now() + 1000 * (Number.isFinite(s) && s > 0 ? s : HAVEN_LIVE_RATE_LIMIT_DEFAULT_S);
        lastAttemptAt = 0; // the server's wait replaces the 10 s spacing
      } else if (r.state === "stop") { stop(r.error || "stopped"); return; }
      pump();
    });
  }
  return {
    jobId: jobId,
    // A raw device position (GeolocationPosition-like). Bad fixes are ignored.
    onPosition(pos) {
      if (stopped) return;
      const f = havenLiveFix(pos);
      if (!f) return;
      latest = { lat: f.lat, lng: f.lng, capturedAt: f.capturedAt, receivedAt: now() };
      pump();
    },
    stop() { stop(null); },
    isStopped() { return stopped; },
    sentCount() { return sentCount; },
  };
}

