// MAP-05 M5-1 / M5-2 — assigned-job map (Pro). Isolated map code; the app
// file only calls HavenEnRouteNavigation from mapPanel when the flag is on.
//
// Rules (founder 2026-10-23, Hub handoffs/MAP-05.md):
// - Only for a job this Pro has been ASSIGNED (backendClaimed) and only from
//   the exact point the assigned-job flow returned (PR #70: pro_claim_job's
//   row or the assigned jobs row). Never from an unassigned board row (board
//   rows carry no lat/lng at all after #70).
// - One static Mapbox image of the destination. No route, ETA, travel time,
//   extra markers or invented address. Road routing comes from Apple/Google Maps.
// - Nothing loads at startup: the image is requested only when the en-route
//   job screen renders, once per job point and theme (stable URL, browser cache).
// - Honest states: loading, offline, no location, error (with Try again).
//
// Backend gate: HAVEN_ASSIGNED_JOB_MAP_ENABLED stays false until Grokbot's
// assigned-only access control (0027/0030, Hub REQ-01) is verified and the
// founder approves deployment. While false, mapPanel renders exactly as before.
const HAVEN_ASSIGNED_JOB_MAP_ENABLED = false;

const HAVEN_STATIC_MAP_W = 600;   // CSS px requested (@2x); fixed so the URL is cacheable
const HAVEN_STATIC_MAP_H = 300;
const HAVEN_MAP_PIN_COLOR = "0f6e4e"; // Haven Pro green

// Exact point for an assigned job, or null. Requires a server-assigned job and finite coordinates.
function havenAssignedJobPoint(job) {
  if (!job || !job.backendClaimed) return null;
  const lat = job.lat != null && job.lat !== "" ? Number(job.lat) : NaN;
  const lng = job.lng != null && job.lng !== "" ? Number(job.lng) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function havenFixed5(n) { return Number(n).toFixed(5); }

// Mapbox Static Images API: one pin at the destination, no path overlays.
function havenStaticMapUrl(point, dark) {
  if (!point || typeof HAVEN_MAPBOX_PUBLIC_TOKEN === "undefined" || !HAVEN_MAPBOX_PUBLIC_TOKEN) return null;
  const style = dark ? "mapbox/dark-v11" : "mapbox/streets-v12";
  const lng = havenFixed5(point.lng), lat = havenFixed5(point.lat);
  return "https://api.mapbox.com/styles/v1/" + style + "/static/"
    + "pin-l+" + HAVEN_MAP_PIN_COLOR + "(" + lng + "," + lat + ")/"
    + lng + "," + lat + ",15,0/"
    + HAVEN_STATIC_MAP_W + "x" + HAVEN_STATIC_MAP_H + "@2x"
    + "?access_token=" + encodeURIComponent(HAVEN_MAPBOX_PUBLIC_TOKEN);
}

// Apple Maps driving directions to the exact point (opens the Maps app on iPhone).
function havenAppleMapsUrl(point) {
  if (!point) return null;
  return "https://maps.apple.com/?daddr=" + havenFixed5(point.lat) + "," + havenFixed5(point.lng) + "&dirflg=d";
}

function havenIsOnline() {
  try { return typeof navigator === "undefined" || navigator.onLine !== false; } catch (e) { return true; }
}

// En-route navigation card: static map (M5-1) with honest states (M5-2), plus
// Open in Apple Maps and the existing Google Maps link (mapsUrl from mapPanel,
// unchanged logic). Plain React.createElement so this file needs no JSX step.
function HavenEnRouteNavigation(props) {
  const { job, mapsUrl, hasOrigin, T, dark, font } = props;
  const h = React.createElement;
  const point = havenAssignedJobPoint(job);
  const src = havenStaticMapUrl(point, dark);
  const [online, setOnline] = React.useState(havenIsOnline());
  const [attempt, setAttempt] = React.useState(0);
  // Image state is keyed to the exact URL + retry count, so a cached image that
  // loads immediately can't be reset to "loading" by a later effect.
  const imgKey = (src || "") + "#" + attempt;
  const [imgState, setImgState] = React.useState({ key: imgKey, s: "loading" });
  const state = imgState.key === imgKey ? imgState.s : "loading"; // loading | loaded | error
  const setState = (s) => setImgState({ key: imgKey, s: s });

  React.useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  const city = job && job.city ? job.city : "";
  const boxStyle = { position: "relative", width: "100%", aspectRatio: "2 / 1", background: dark ? "#16211d" : "#e8ece9", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" };
  const noteStyle = { fontSize: 12.5, fontWeight: 600, color: T.ts, fontFamily: font, textAlign: "center", padding: "0 16px", lineHeight: 1.4 };

  let mapArea;
  if (!point) {
    mapArea = h("div", { style: boxStyle, "data-map-state": "no-location", role: "note" },
      h("div", { style: noteStyle }, "Exact location not available yet. Use the city directions below."));
  } else if (!online) {
    mapArea = h("div", { style: boxStyle, "data-map-state": "offline", role: "note" },
      h("div", { style: noteStyle }, "Map unavailable offline. The directions buttons still work once you're connected."));
  } else if (!src) {
    mapArea = h("div", { style: boxStyle, "data-map-state": "error", role: "note" },
      h("div", { style: noteStyle }, "Map unavailable right now."));
  } else {
    mapArea = h("div", { style: boxStyle, "data-map-state": state, "aria-busy": state === "loading" ? "true" : "false" },
      state !== "loaded" && h("div", { style: noteStyle }, state === "error" ? "Map unavailable right now." : "Loading map…"),
      state === "error" && h("button", {
        type: "button", onClick: () => setAttempt(a => a + 1),
        style: { position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)", minHeight: 44, padding: "0 18px", borderRadius: 12, border: "1px solid " + T.bd, background: T.w, color: T.tx, fontSize: 13, fontWeight: 700, fontFamily: font, cursor: "pointer" },
      }, "Try again"),
      state !== "error" && h("img", {
        key: imgKey, src: src, alt: "Map of the job location" + (city ? " in " + city : ""),
        loading: "lazy", decoding: "async", draggable: false,
        onLoad: () => setState("loaded"), onError: () => setState("error"),
        style: { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: state === "loaded" ? 1 : 0, transition: "opacity .2s" },
      }));
  }

  const apple = havenAppleMapsUrl(point);
  const btn = (primary) => ({ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 46, padding: "0 10px", borderRadius: 12, textDecoration: "none", fontSize: 13.5, fontWeight: 800, fontFamily: font, background: primary ? T.cta : T.w, color: primary ? "#fff" : T.tx, border: primary ? "none" : "1px solid " + T.bd, textAlign: "center" });

  return h("div", { "data-testid": "assigned-job-map", style: { borderRadius: 18, overflow: "hidden", marginBottom: 16, border: "1px solid " + T.bd, background: T.w } },
    h("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" } },
      h("span", { "aria-hidden": "true", style: { fontSize: 18 } }, "📍"),
      h("span", { style: { fontSize: 13, fontWeight: 700, color: T.tx, fontFamily: font } }, point ? (city ? "Job location · " + city : "Job location") : (hasOrigin ? "Directions to " + city : "Navigating to " + city))),
    mapArea,
    h("div", { style: { display: "flex", gap: 8, padding: 12 } },
      apple && h("a", { href: apple, target: "_blank", rel: "noopener noreferrer", style: btn(true) }, "Open in Apple Maps"),
      h("a", { href: mapsUrl, target: "_blank", rel: "noopener noreferrer", style: btn(!apple) }, "🗺️ " + (hasOrigin ? "Google Maps directions" : "Open in Google Maps"))));
}
