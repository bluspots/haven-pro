#!/usr/bin/env node
"use strict";
/**
 * MAP-05a: the Pro en-route panel no longer draws a fake route.
 * (1) mapPanel has no drawn map (no SVG route, markers, "Tap to expand").
 * (2) Navigation URL shapes are unchanged, but the destination is only the
 *     assigned-destination RPC point (MAP-05 / 0030); without it the Google
 *     link is a labelled city-only search. Panel only for en-route jobs.
 * (3) The app never reads job.lat / job.lng.
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
// (2) Navigation logic: same URL shapes as main 3d799b5, but since MAP-05 / 0030
// (2026-11-05) the destination is ONLY the assigned-destination RPC point.
const NAV = [
  "    const hasDestCoords = !!point;",
  "    const destination = hasDestCoords ? `${point.lat},${point.lng}` : job.city;",
  "    const hasOrigin = !!proLiveLocation;",
  "    const mapsUrl = hasOrigin",
  "      ? `https://www.google.com/maps/dir/?api=1&origin=${proLiveLocation.lat},${proLiveLocation.lng}&destination=${encodeURIComponent(destination)}&travelmode=driving`",
  "      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`;",
].join("\n");
ok(panel.includes(NAV), "Get Directions / Open in Maps URL shapes are unchanged; destination comes from the RPC point");
ok(/const dest = destinationEntry\(job\);\s*const point = dest && dest\.state === "ok" \? dest\.point : null;/.test(panel), "the point is the assigned-destination entry for the job's current status");
ok(/<a\s+href=\{mapsUrl\}\s+target="_blank"\s+rel="noopener noreferrer"/.test(panel), "with a point, the card is still the maps link, opening a new tab");
ok(/🗺️ \{hasOrigin \? "Get Directions" : "Open in Maps"\}/.test(panel), "button text with a point unchanged");
ok(/havenCityOnlyLinkLabel\(job\.city\)/.test(panel), "without a point, the Google link is labelled city-only");
ok(/\{job\.status === "en_route" && mapPanel\(job\)\}/.test(jsx) && (jsx.match(/mapPanel\(job\)/g) || []).length === 2, "panel still shows only for en-route jobs (one definition, one call)");
// (3)
ok(!/job\.lat|job\.lng/.test(jsx), "the app never reads job.lat / job.lng (no table, board or claim coordinates)");
ok(!/arriv\w* in \d|min away|ETA/i.test(panel), "no simulated arrival information");
console.log(`OK: en-route panel checks passed (${pass} assertions).`);
