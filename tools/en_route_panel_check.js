#!/usr/bin/env node
"use strict";
/**
 * MAP-05a: the Pro en-route panel no longer draws a fake route.
 * (1) mapPanel has no drawn map (no SVG route, markers, "Tap to expand").
 * (2) Navigation is unchanged: the Open in Maps / Get Directions URL logic is
 *     byte-identical to before, the whole card is still the link (new tab),
 *     and the panel still shows only for en-route jobs.
 * (3) No new use of job coordinates anywhere in the app (count unchanged).
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const root = path.resolve(__dirname, "..");
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
const jsx = fs.readFileSync(path.join(root, "home_services_pro_app.jsx"), "utf8");
const built = fs.readFileSync(path.join(root, "prototype-pro.html"), "utf8");
const panel = jsx.slice(jsx.indexOf("  function mapPanel(job) {"), jsx.indexOf("\n  }\n", jsx.indexOf("  function mapPanel(job) {")));
// (1)
ok(panel.length > 200 && !/<svg|<path|<circle|Tap to expand|linear-gradient/.test(panel), "mapPanel draws no fake map or route");
ok(!/M 40 110 Q 130 40 260 50/.test(built), "built page: the fake route path is gone");
// (2) exact navigation logic as on main 3d799b5
const NAV = [
  "    const hasDestCoords = job.lat != null && job.lng != null;",
  "    const destination = hasDestCoords ? `${job.lat},${job.lng}` : job.city;",
  "    const hasOrigin = !!proLiveLocation;",
  "    const mapsUrl = hasOrigin",
  "      ? `https://www.google.com/maps/dir/?api=1&origin=${proLiveLocation.lat},${proLiveLocation.lng}&destination=${encodeURIComponent(destination)}&travelmode=driving`",
  "      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`;",
].join("\n");
ok(panel.includes(NAV), "Open in Maps / Get Directions URL logic is unchanged");
ok(/<a\s+href=\{mapsUrl\}\s+target="_blank"\s+rel="noopener noreferrer"/.test(panel), "the card is still the maps link, opening a new tab");
ok(/🗺️ \{hasOrigin \? "Get Directions" : "Open in Maps"\}/.test(panel), "button text unchanged");
ok(/\{job\.status === "en_route" && mapPanel\(job\)\}/.test(jsx) && (jsx.match(/mapPanel\(job\)/g) || []).length === 2, "panel still shows only for en-route jobs (one definition, one call)");
// (3)
ok((jsx.match(/job\.lat/g) || []).length === 6, "no new use of job coordinates (job.lat count unchanged from main: 6)");
ok(!/arriv\w* in \d|min away|ETA/i.test(panel), "no simulated arrival information");
console.log(`OK: en-route panel checks passed (${pass} assertions).`);
