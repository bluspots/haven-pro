// Geocoder boundary. Callers use havenGeocodeAddress only.
// Mapbox is the only production implementation. Swap the body of
// havenGeocodeAddress to replace the provider later.
// Do not call this from marketplace load, job list, or claim.
//
// The public token is not committed. Set localStorage
// haven_mapbox_public_token on the device (same place as the Supabase
// anon key). It must start with "pk.". A missing token fails closed.

function havenMapboxPublicToken() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return "";
    const token = String(localStorage.getItem("haven_mapbox_public_token") || "").trim();
    if (token.indexOf("pk.") !== 0) return "";
    return token;
  } catch (e) {
    return "";
  }
}

async function havenMapboxGeocodeAddress(query) {
  const q = String(query || "").trim();
  const token = havenMapboxPublicToken();
  if (!q || !token) return null;
  const url = "https://api.mapbox.com/search/geocode/v6/forward?q="
    + encodeURIComponent(q)
    + "&limit=1&autocomplete=false&access_token="
    + encodeURIComponent(token);
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    return null;
  }
  if (!res || !res.ok) return null;
  let data = null;
  try { data = await res.json(); } catch (e) { return null; }
  const feat = data && Array.isArray(data.features) ? data.features[0] : null;
  const coords = feat && feat.geometry && Array.isArray(feat.geometry.coordinates)
    ? feat.geometry.coordinates
    : null;
  if (!coords || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat: lat, lng: lng };
}

function havenGeocodeAddress(query) {
  return havenMapboxGeocodeAddress(query);
}
