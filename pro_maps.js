// MAP-05 M5-1 / M5-2 — assigned-job map (Pro). Isolated map code; the app
// file calls HavenEnRouteNavigation from mapPanel only when the flag is on, and
// uses havenDestinationMessage / havenCityOnlyLinkLabel for the flag-off panel.
//
// Source of the destination (contract backend/contracts/mapbox-assigned-destination-0030.md,
// 0027 + 0030 live 2026-11-05): ONLY public.get_assigned_job_destination, called by
// fetchAssignedJobDestination (backend_adapter.js) and held by the app in memory per
// job id. Never a board row, a claim row, a jobs table read, a fixture or a city centre.
//
// Rules (founder; Hub handoffs/MAP-05.md):
// - One static Mapbox image of the destination. No route, ETA, travel time,
//   extra markers or invented address. Road routing comes from Apple/Google Maps.
// - Nothing loads at startup: the RPC and the image are requested only when the
//   active job's screen is open (or right after a claim), once per job + status.
// - Honest states, no fabricated location: loading, each server error, network
//   error (Try again), image error (Try again), offline.
// - No geocoding here (HB-23 open). The static image URL is stable per point.
//
// HAVEN_ASSIGNED_JOB_MAP_ENABLED stays false in every committed file. The
// founder approves turning it on separately after QA.
const HAVEN_ASSIGNED_JOB_MAP_ENABLED = false;

const HAVEN_STATIC_MAP_W = 600;   // CSS px requested (@2x); fixed so the URL is cacheable
const HAVEN_STATIC_MAP_H = 300;
const HAVEN_MAP_PIN_COLOR = "0f6e4e"; // Haven Pro green

// The exact point from a destination entry ({ state: "ok", point }), else null.
function havenAssignedJobPoint(dest) {
  if (!dest || dest.state !== "ok" || !dest.point) return null;
  const lat = dest.point.lat, lng = dest.point.lng;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// 6 decimal places = the stored jobs.lat/lng precision (numeric(9,6)).
function havenFixed6(n) { return Number(n).toFixed(6); }

// Mapbox Static Images API: one pin at the destination, no path overlays.
function havenStaticMapUrl(point, dark) {
  if (!point || typeof HAVEN_MAPBOX_PUBLIC_TOKEN === "undefined" || !HAVEN_MAPBOX_PUBLIC_TOKEN) return null;
  const style = dark ? "mapbox/dark-v11" : "mapbox/streets-v12";
  const lng = havenFixed6(point.lng), lat = havenFixed6(point.lat);
  return "https://api.mapbox.com/styles/v1/" + style + "/static/"
    + "pin-l+" + HAVEN_MAP_PIN_COLOR + "(" + lng + "," + lat + ")/"
    + lng + "," + lat + ",15,0/"
    + HAVEN_STATIC_MAP_W + "x" + HAVEN_STATIC_MAP_H + "@2x"
    + "?access_token=" + encodeURIComponent(HAVEN_MAPBOX_PUBLIC_TOKEN);
}

// Apple Maps driving directions to the exact point (opens the Maps app on iPhone).
function havenAppleMapsUrl(point) {
  if (!point) return null;
  return "https://maps.apple.com/?daddr=" + havenFixed6(point.lat) + "," + havenFixed6(point.lng) + "&dirflg=d";
}

// What to say when there is no exact point (contract §5 of the Pro #71 brief).
function havenDestinationMessage(dest) {
  if (!dest || dest.state === "loading") return { text: "Loading location…", retry: false };
  if (dest.state === "ok") return { text: "", retry: false };
  switch (dest.error) {
    case "not_authenticated": return { text: "Sign in again to see the job location.", retry: false };
    case "not_found": return { text: "This job is no longer assigned to you.", retry: false };
    case "status_not_active": return { text: "Navigation is closed for this job.", retry: false };
    case "no_coordinates": return { text: "Exact location not available yet.", retry: false };
    default: return { text: "Couldn't load the location.", retry: true };
  }
}

// A city-level search is never presented as the job's location.
function havenCityOnlyLinkLabel(city) {
  return "Search " + city + " in Google Maps (city only, not the job location)";
}

// Which jobs may have an exact destination at all: server-assigned (backendClaimed),
// a real job uuid, and an active status (the Pro active set). SIM/demo jobs and
// posted / complete / cancelled / inspection_completed / materials_declined never.
const HAVEN_DESTINATION_ACTIVE = ["en_route", "arrived", "diagnosing", "materials_requested", "materials_approved", "in_progress"];
function havenDestinationEligible(job, backendConfigured) {
  return !!backendConfigured && !!job && !!job.backendClaimed
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(job.id || ""))
    && HAVEN_DESTINATION_ACTIVE.indexOf(job.status) !== -1;
}
// Entries kept only for jobs still eligible; everything else is dropped.
function havenPruneDestinations(entries, activeJobs, backendConfigured) {
  const keep = new Set((activeJobs || []).filter(j => havenDestinationEligible(j, backendConfigured)).map(j => String(j.id)));
  const out = {};
  let changed = false;
  Object.keys(entries || {}).forEach(id => { if (keep.has(id)) out[id] = entries[id]; else changed = true; });
  return changed ? out : entries;
}

function havenIsOnline() {
  try { return typeof navigator === "undefined" || navigator.onLine !== false; } catch (e) { return true; }
}

// En-route navigation card. Plain React.createElement so this file needs no JSX step.
// props: job, dest (destination entry), mapsUrl (mapPanel's Google URL: the exact
// point when dest is ok, else the city), hasOrigin, onRetry, T, dark, font.
function HavenEnRouteNavigation(props) {
  const { job, dest, mapsUrl, hasOrigin, onRetry, T, dark, font } = props;
  const h = React.createElement;
  const point = havenAssignedJobPoint(dest);
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
  const boxStyle = { position: "relative", width: "100%", aspectRatio: "2 / 1", background: dark ? "#16211d" : "#e8ece9", display: "flex", flexDirection: "column", gap: 10, alignItems: "center", justifyContent: "center", overflow: "hidden" };
  const noteStyle = { fontSize: 12.5, fontWeight: 600, color: T.ts, fontFamily: font, textAlign: "center", padding: "0 16px", lineHeight: 1.4 };
  const retryStyle = { minHeight: 44, padding: "0 18px", borderRadius: 12, border: "1px solid " + T.bd, background: T.w, color: T.tx, fontSize: 13, fontWeight: 700, fontFamily: font, cursor: "pointer" };

  let mapArea;
  if (!point) {
    const msg = havenDestinationMessage(dest);
    const code = !dest || dest.state === "loading" ? "loading" : dest.error;
    mapArea = h("div", { style: boxStyle, "data-map-state": "no-point", "data-dest-state": code, role: "status", "aria-busy": code === "loading" ? "true" : "false" },
      h("div", { style: noteStyle }, msg.text),
      msg.retry && typeof onRetry === "function" && h("button", { type: "button", onClick: onRetry, style: retryStyle }, "Try again"));
  } else if (!online && state !== "loaded") {
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
        style: { ...retryStyle, position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)" },
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
  // Address is shown only when the server sends it (today it is always null; REQ-04 open).
  const addressLine = point && dest.address && dest.address.line ? dest.address.line : null;
  const googleLabel = point ? "🗺️ " + (hasOrigin ? "Google Maps directions" : "Open in Google Maps") : "🗺️ " + havenCityOnlyLinkLabel(city);

  return h("div", { "data-testid": "assigned-job-map", style: { borderRadius: 18, overflow: "hidden", marginBottom: 16, border: "1px solid " + T.bd, background: T.w } },
    h("div", { style: { display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px" } },
      h("span", { "aria-hidden": "true", style: { fontSize: 18 } }, "📍"),
      h("div", null,
        h("div", { style: { fontSize: 13, fontWeight: 700, color: T.tx, fontFamily: font } }, point ? (city ? "Job location · " + city : "Job location") : (city ? "Job in " + city : "Job location")),
        addressLine && h("div", { "data-testid": "assigned-address", style: { fontSize: 12.5, fontWeight: 600, color: T.ts, fontFamily: font, marginTop: 2 } }, addressLine))),
    mapArea,
    h("div", { style: { display: "flex", gap: 8, padding: 12, flexWrap: "wrap" } },
      apple && h("a", { href: apple, target: "_blank", rel: "noopener noreferrer", style: btn(true) }, "Open in Apple Maps"),
      (point || city) && h("a", { href: mapsUrl, target: "_blank", rel: "noopener noreferrer", style: btn(!apple) }, googleLabel)));
}
