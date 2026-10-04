// Geocoder boundary. Callers use havenGeocodeAddress only.
// Mapbox is the only production implementation. Swap the body of
// havenGeocodeAddress to replace the provider later.
// Do not call this from marketplace load, job list, or claim.
// The public pk token is in this file so GitHub Pages can geocode
// without a browser setting. No secret sk token.

const HAVEN_MAPBOX_PUBLIC_TOKEN = "pk.eyJ1IjoiYWxleGJhcnR1YWwiLCJhIjoiY211dTMyM2h0MDM0aDJ5bzNscTJucHNjcyJ9.EZkYdZlHTW8vcZljriN3Pw";

async function havenMapboxGeocodeAddress(query) {
  const q = String(query || "").trim();
  if (!q || !HAVEN_MAPBOX_PUBLIC_TOKEN) return null;
  const url = "https://api.mapbox.com/search/geocode/v6/forward?q="
    + encodeURIComponent(q)
    + "&limit=1&autocomplete=false&access_token="
    + encodeURIComponent(HAVEN_MAPBOX_PUBLIC_TOKEN);
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
