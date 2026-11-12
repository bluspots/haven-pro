#!/usr/bin/env node
"use strict";

/**
 * Native integration (PR #76 on top of #75, #77, #78): checks that the pieces
 * work together in the app on a mocked native runtime (iPhone and Android).
 *
 *  I1. Live job update removes the en-route job (cancelled / reassigned):
 *      the background watcher ends, nothing more is sent, the plain notice shows.
 *  I2. A live job update that changes nothing for the en-route job, and a
 *      local change to the job list, never remove and re-add the background
 *      watcher (no notification / indicator flicker, no gap in sending).
 *  I3. The Navigate button (#78) sits on the en-route screen next to the locked
 *      sharing notice, links to the destination only, never the Pro's location.
 *  I4. Sign-out after a live update still ends the watcher and leaves the topic.
 *
 * Reuses the #76 harness (tools/native_location_check.js). Fixtures are a public
 * landmark; coordinates are never printed (assertions report booleans).
 * Mocks are never certification: the device test is still required.
 */

const assert = require("assert");
const H = require("./native_location_check.js");
const { renderApp, pluginLoc, activeRow, waitFor, clickText, button, notice, openJob, leaf, sleep, hasCoord, JOB, NEAR, LIVE_PATH, NOTICE } = H;

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; console.log("  ✓ " + msg); }

// A fake realtime client: records joins/removals and lets the test broadcast.
function fakeRealtime() {
  const rt = { channels: [], removed: 0, setAuth: 0 };
  rt.factory = () => ({
    realtime: { async setAuth() { rt.setAuth++; } },
    channel(topic, opts) {
      const ch = { topic, opts, handlers: [], status: null,
        on(type, filter, cb) { ch.handlers.push({ type, filter, cb }); return ch; },
        subscribe(cb) { ch.status = cb; setTimeout(() => cb("SUBSCRIBED"), 0); return ch; } };
      rt.channels.push(ch);
      return ch;
    },
    async removeChannel(ch) { rt.removed++; ch.removed = true; },
  });
  rt.broadcast = payload => {
    const ch = rt.channels.filter(c => !c.removed).pop();
    if (!ch) throw new Error("no channel joined");
    ch.handlers.filter(h => h.type === "broadcast" && h.filter.event === "job_changed").forEach(h => h.cb({ payload }));
  };
  return rt;
}
const liveSends = app => app.nat.log.http.filter(r => r.url.includes(LIVE_PATH)).length;
const signal = (status, reason) => ({ v: 1, id: "sig-" + Math.random().toString(16).slice(2), job_id: JOB, status, reason, at: new Date().toISOString() });

async function removedByServer(platform, status, expectText) {
  const rt = fakeRealtime();
  const app = await renderApp({ platform, rows: [activeRow()], live: () => ({ status: 200, data: { ok: true } }), realtime: rt.factory });
  const w = app.window;
  await waitFor(w, () => app.nat.watchers.size === 1, platform + " watcher");
  await waitFor(w, () => rt.channels.some(c => !c.removed), platform + " joined topic");
  app.nat.emit(pluginLoc(NEAR));
  await waitFor(w, () => liveSends(app) >= 1, platform + " first send");
  await openJob(w);
  await waitFor(w, x => !!notice(x), "notice");
  // Server side: the job is cancelled / reassigned, then the signal arrives.
  app.state.rows = [];
  rt.broadcast(signal(status, "removed"));
  await waitFor(w, () => app.nat.watchers.size === 0, platform + " watcher ends after removal");
  ok(app.nat.watchers.size === 0 && app.nat.log.removeWatcher.length >= 1, `I1. ${platform}, ${status}: the live job update ends the background watcher`);
  await waitFor(w, x => leaf(x).includes(expectText), "removal notice");
  ok(leaf(w).includes(expectText) && !notice(w), `I1. ${platform}, ${status}: "${expectText}" shows and the sharing notice is gone`);
  const n = liveSends(app);
  app.nat.emit(pluginLoc(NEAR));
  await sleep(600);
  ok(liveSends(app) === n, `I1. ${platform}, ${status}: nothing more is sent for the job`);
  ok(!app.logged.some(hasCoord), `I1. ${platform}, ${status}: no coordinates in console output`);
  w.close();
}

async function main() {
  console.log("I1 Live job update removes the en-route job:");
  for (const platform of ["ios", "android"]) {
    await removedByServer(platform, "cancelled", "This job was cancelled.");
    await removedByServer(platform, "posted", "This job was reassigned. You're no longer on it.");
  }

  console.log("I2 Refetches and local changes don't restart the watcher:");
  for (const platform of ["ios", "android"]) {
    const rt = fakeRealtime();
    const other = activeRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-0000000000c7", status: "arrived", title: "Second job (fixture)" });
    const app = await renderApp({ platform, rows: [activeRow(), other], live: () => ({ status: 200, data: { ok: true } }), realtime: rt.factory });
    const w = app.window;
    await waitFor(w, () => app.nat.watchers.size === 1, "watcher");
    await waitFor(w, () => rt.channels.some(c => !c.removed), "joined");
    await sleep(700); // the SUBSCRIBED refetch settles
    const adds = app.nat.log.addWatcher.length, removes = app.nat.log.removeWatcher.length;
    const reads = () => app.calls.filter(c => /\/rest\/v1\/jobs\?pro_id=eq\./.test(c.url)).length;
    const r0 = reads();
    rt.broadcast(signal("en_route", "updated"));          // nothing changed for this job
    await waitFor(w, () => reads() > r0, "signal refetch");
    await sleep(300);
    // the other job changes on the server (arrived → in_progress)
    app.state.rows = app.state.rows.map(r => (r.id === other.id ? { ...r, status: "in_progress" } : r));
    const r1 = reads();
    rt.broadcast({ ...signal("in_progress", "updated"), job_id: other.id });
    await waitFor(w, () => reads() > r1, "second refetch");
    await sleep(300);
    ok(app.nat.log.addWatcher.length === adds && app.nat.log.removeWatcher.length === removes && app.nat.watchers.size === 1,
      `I2. ${platform}: live job updates (same job, or another job changing) keep the one background watcher`);
    // The background watcher is the background-capable one while sharing.
    const last = app.nat.log.addWatcher[app.nat.log.addWatcher.length - 1];
    ok(!!last && typeof last.backgroundMessage === "string" && last.backgroundMessage.length > 0, `I2. ${platform}: it is the background watcher (sharing is on)`);
    const n = liveSends(app);
    app.nat.emit(pluginLoc(NEAR));
    await waitFor(w, () => liveSends(app) > n, "send continues");
    ok(liveSends(app) > n, `I2. ${platform}: sending continues after the refetches`);
    w.close();
  }

  console.log("I3 Navigate next to the sharing notice:");
  for (const platform of ["ios", "android"]) {
    const app = await renderApp({ platform, rows: [activeRow()], live: () => ({ status: 200, data: { ok: true } }) });
    const w = app.window;
    await waitFor(w, () => app.nat.watchers.size === 1, "watcher");
    app.nat.emit(pluginLoc(NEAR));
    await openJob(w);
    await waitFor(w, x => !!notice(x) && !!(x.document.querySelector('[data-testid="nav-chooser"]') || x.document.querySelector('[data-testid="navigate-button"]')), "navigate + notice");
    ok(notice(w).textContent.includes(NOTICE) && notice(w).getAttribute("data-live-state") === "sharing", `I3. ${platform}: the locked sharing notice shows on the en-route screen`);
    const links = Array.from(w.document.querySelectorAll('[data-testid="nav-chooser"] a, a[data-testid="navigate-button"]'));
    ok(links.length >= 1 && links.every(a => a.getAttribute("target") === "_blank" && /^https:\/\/(maps\.apple\.com|www\.google\.com\/maps|waze\.com)\//.test(a.getAttribute("href"))),
      `I3. ${platform}: Navigate links open the maps app outside Haven (system hand-off)`);
    ok(links.every(a => !a.getAttribute("href").includes(String(NEAR.lat))), `I3. ${platform}: the Pro's own location is never in a navigation link`);
    ok(app.nat.watchers.size === 1, `I3. ${platform}: showing Navigate doesn't touch the watcher`);
    w.close();
  }

  console.log("I4 Sign-out after a live update:");
  {
    const rt = fakeRealtime();
    const app = await renderApp({ platform: "ios", rows: [activeRow()], live: () => ({ status: 200, data: { ok: true } }), realtime: rt.factory });
    const w = app.window;
    await waitFor(w, () => app.nat.watchers.size === 1, "watcher");
    await waitFor(w, () => rt.channels.some(c => !c.removed), "joined");
    rt.broadcast(signal("en_route", "updated"));
    await sleep(700);
    clickText(w, /^Profile$/); await sleep(80);
    await waitFor(w, x => !!button(x, "Sign Out", false), "Sign Out");
    button(w, "Sign Out", false).click();
    await waitFor(w, x => !!button(x, "Sign out", true), "confirm");
    button(w, "Sign out", true).click();
    await waitFor(w, () => !app.state.session && app.nat.watchers.size === 0 && rt.channels.every(c => c.removed), "sign-out");
    ok(app.nat.watchers.size === 0 && rt.channels.every(c => c.removed), "I4. sign-out ends the watcher and leaves the job topic");
    w.close();
  }

  console.log(`OK: native integration checks passed (${pass} assertions).`);
  process.exit(0);
}
main().catch(e => { console.error("FAIL:", e && e.message || e); process.exit(1); });
