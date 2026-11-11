// Unit checks for job_signal.js (shared by the Customer and Pro apps).
// Usage: require('./job_signal_unit.js')(sourceText, ok) -> Promise
// ok(cond, label) records one assertion.
"use strict";
const vm = require("vm");

module.exports = async function runJobSignalUnit(src, ok) {
  const logs = [];
  const sandbox = { console: { log: (...a) => logs.push(a), warn: (...a) => logs.push(a), error: (...a) => logs.push(a), info: (...a) => logs.push(a) },
    setTimeout, clearTimeout, Promise, Map, Set, Array, String, Object, Math, JSON, Number };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src + "\n;globalThis.__s = { havenJobSignalTopic, havenParseJobSignal, havenCreateJobSignal, havenAttachJobSignalWake, havenPageVisible, HAVEN_JOB_SIGNAL_DEBOUNCE_MS, HAVEN_JOB_SIGNAL_SAFETY_POLL_MS };", sandbox);
  const S = sandbox.__s;
  const U = "B79C42E9-6E09-4335-9035-A11ECF37D032", u = U.toLowerCase();
  const U2 = "c79c42e9-6e09-4335-9035-a11ecf37d099";
  const J = (n) => "e0360000-0000-4000-8000-00000000000" + n;

  // manual clock
  let now = 0; let timers = [];
  const setTimer = (fn, ms) => { const id = { fn, at: now + ms }; timers.push(id); return id; };
  const clearTimer = (id) => { timers = timers.filter(t => t !== id); };
  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift(); now = t.at; await t.fn();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    }
    now = end;
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }
  function mockClient() {
    const log = [], chans = [];
    const c = {
      log, chans,
      realtime: { async setAuth(t) { log.push("setAuth:" + (t === undefined || t === null ? "session" : "explicit")); } },
      channel(topic, opts) {
        const ch = { topic, opts, handlers: [], subCb: null,
          on(type, filter, cb) { this.handlers.push({ type, filter, cb }); return this; },
          subscribe(cb) { this.subCb = cb; log.push("subscribe:" + topic); return this; },
          emit(payload) { this.handlers.forEach(h => h.cb({ type: "broadcast", event: "job_changed", payload })); },
          status(st) { this.subCb && this.subCb(st); } };
        chans.push(ch); log.push("channel:" + topic); return ch;
      },
      async removeChannel(ch) { log.push("remove:" + ch.topic); ch.removed = true; return "ok"; },
    };
    return c;
  }

  // topic + payload parsing
  ok(S.havenJobSignalTopic(U) === "jobs:user:" + u, "topic is jobs:user:<lowercase uuid>");
  ok(S.havenJobSignalTopic("") === null && S.havenJobSignalTopic("not-a-uuid") === null && S.havenJobSignalTopic(null) === null, "no topic for a missing or malformed user id");
  const p = S.havenParseJobSignal({ v: 1, id: "x", job_id: J(1), status: "cancelled", reason: "removed", at: "2026-11-11T07:41:05.123Z" });
  ok(p && p.jobId === J(1) && p.status === "cancelled" && p.reason === "removed" && p.at === "2026-11-11T07:41:05.123Z", "a v1 payload is read as { jobId, status, reason, at }");
  ok(S.havenParseJobSignal({ v: 2, job_id: J(1), reason: "updated" }) === null, "another version is not read (it still triggers a refetch)");
  ok(S.havenParseJobSignal({ v: 1, job_id: J(1), status: null, reason: "weird" }).reason === "updated", "an unknown reason is treated as updated");
  ok(S.havenParseJobSignal({ v: 1, job_id: J(1), status: null, reason: "removed" }).status === null, "status null (deleted row) stays null");
  ok(S.havenParseJobSignal(null) === null && S.havenParseJobSignal({ v: 1, job_id: "nope" }) === null, "garbage payloads are not read");

  // join order and channel config
  {
    const c = mockClient(); const batches = [];
    const sig = S.havenCreateJobSignal({ getClient: () => c, onRefetch: async (b) => { batches.push(b); }, setTimer, clearTimer });
    await sig.start(U);
    ok(c.log[0] === "setAuth:session" && c.log[1] === "channel:jobs:user:" + u && c.log[2] === "subscribe:jobs:user:" + u, "setAuth() (session token) is awaited before the channel is created and subscribed");
    const ch = c.chans[0];
    ok(ch.opts && ch.opts.config && ch.opts.config.private === true && !ch.opts.config.broadcast && !ch.opts.config.presence, "private: true; no broadcast self/ack/replay, no presence");
    ok(ch.handlers.length === 1 && ch.handlers[0].type === "broadcast" && ch.handlers[0].filter.event === "job_changed", "listens to broadcast event job_changed only");
    ok(sig.topic() === "jobs:user:" + u, "the topic uses the lowercase id");
    ch.status("SUBSCRIBED");
    await advance(399);
    ok(batches.length === 0, "SUBSCRIBED refetch is debounced too");
    await advance(1);
    ok(batches.length === 1 && batches[0].wake === true && batches[0].tags.includes("subscribed"), "SUBSCRIBED → one refetch (first join and every rejoin)");

    // debounce: several signals → one refetch with every job
    ch.emit({ v: 1, id: "m1", job_id: J(1), status: "en_route", reason: "updated", at: "t" });
    await advance(200);
    ch.emit({ v: 1, id: "m2", job_id: J(2), status: "posted", reason: "removed", at: "t" });
    await advance(200);
    ch.emit({ v: 1, id: "m3", job_id: J(1), status: "arrived", reason: "updated", at: "t" });
    await advance(399);
    ok(batches.length === 1, "no refetch while signals keep arriving inside the 400 ms window");
    await advance(1);
    ok(batches.length === 2 && batches[1].signals.length === 2, "3 signals for 2 jobs → exactly one refetch carrying both jobs");
    const byJob = new Map(batches[1].signals.map(s => [s.jobId, s]));
    ok(byJob.get(J(1)).status === "arrived" && byJob.get(J(2)).reason === "removed", "the latest signal per job is kept");
    ok(S.HAVEN_JOB_SIGNAL_DEBOUNCE_MS >= 300 && S.HAVEN_JOB_SIGNAL_DEBOUNCE_MS <= 500 && S.HAVEN_JOB_SIGNAL_SAFETY_POLL_MS === 60000, "debounce is within 300–500 ms; safety poll is 60 s");

    // a signal during a slow refetch → one more refetch after it
    let release; const slow = new Promise(r => { release = r; });
    const c2 = mockClient(); const b2 = [];
    const sig2 = S.havenCreateJobSignal({ getClient: () => c2, onRefetch: async (b) => { b2.push(b); if (b2.length === 1) await slow; }, setTimer, clearTimer });
    await sig2.start(U);
    c2.chans[0].emit({ v: 1, job_id: J(3), status: "en_route", reason: "added", at: "t" });
    await advance(400);
    c2.chans[0].emit({ v: 1, job_id: J(4), status: "en_route", reason: "updated", at: "t" });
    await advance(400);
    ok(b2.length === 1, "no overlapping refetch while one is still running");
    release(); await advance(0); await advance(400);
    ok(b2.length === 2 && b2[1].signals[0].jobId === J(4), "the signal that came in meanwhile refetches once more afterwards");
    await sig2.stop();

    // kick (foreground / online / poll)
    sig.kick("foreground");
    await advance(400);
    ok(batches.length === 3 && batches[2].wake && batches[2].tags.includes("foreground"), "kick(foreground) → refetch");

    // error → resubscribe with backoff and a fresh setAuth
    const before = c.log.length;
    ch.status("CHANNEL_ERROR");
    await advance(999);
    ok(c.log.length === before, "CHANNEL_ERROR: waits before rejoining (backoff)");
    await advance(1);
    const tail = c.log.slice(before);
    ok(tail[0] === "remove:jobs:user:" + u && tail[1] === "setAuth:session" && tail[2] === "channel:jobs:user:" + u, "then removes the channel, calls setAuth() again and rejoins");
    const ch2 = c.chans[1];
    ch2.status("TIMED_OUT"); await advance(2000);
    ok(c.chans.length === 3, "TIMED_OUT rejoins too (next backoff step)");
    c.chans[2].status("SUBSCRIBED"); await advance(400);
    ok(batches.length === 4, "the rejoin's SUBSCRIBED refetches (missed broadcasts are covered)");
    ch.emit({ v: 1, job_id: J(1), status: "complete", reason: "updated", at: "t" });
    await advance(400);
    ok(batches.length === 4, "an old (replaced) channel's messages are ignored");

    // account switch
    const beforeSwitch = c.log.length;
    await sig.start(U2);
    const sw = c.log.slice(beforeSwitch);
    ok(sw[0] === "remove:jobs:user:" + u && sw[1] === "setAuth:session" && sw[2] === "channel:jobs:user:" + U2, "account switch: the old user's channel is removed before the new user's is joined");
    await sig.start(U2);
    ok(c.chans.length === 4, "start() for the same user again does nothing");

    // sign-out
    const last = c.chans[3];
    await sig.stop();
    ok(c.log[c.log.length - 1] === "remove:jobs:user:" + U2 && sig.topic() === null && sig.state() === "idle", "sign-out: removeChannel, no topic");
    last.emit({ v: 1, job_id: J(1), status: "complete", reason: "updated", at: "t" });
    sig.kick("foreground");
    await advance(1000);
    ok(batches.length === 4, "after sign-out nothing refetches (late messages and wake-ups ignored)");
  }

  // no realtime client yet: still refetches on wake-ups (fallback)
  {
    const b = [];
    const sig = S.havenCreateJobSignal({ getClient: () => ({ auth: {} }), onRefetch: async (x) => { b.push(x); }, setTimer, clearTimer });
    const joined = await sig.start(U);
    sig.kick("poll"); await advance(400);
    ok(joined === false && sig.state() === "unavailable" && b.length === 1, "no realtime on the client: no channel, but wake-ups and polls still refetch");
    await sig.stop();
    const sig3 = S.havenCreateJobSignal({ getClient: () => mockClient(), onRefetch: async (x) => { b.push(x); }, setTimer, clearTimer });
    await sig3.start("");
    sig3.kick("poll"); await advance(400);
    ok(b.length === 1 && sig3.topic() === null, "signed out (no user id): no channel, no refetch");
  }
  // setAuth failing → retry
  {
    const c = mockClient(); let n = 0;
    c.realtime.setAuth = async () => { n++; if (n === 1) throw new Error("no session yet"); };
    const sig = S.havenCreateJobSignal({ getClient: () => c, onRefetch: async () => {}, setTimer, clearTimer });
    await sig.start(U);
    ok(c.chans.length === 0, "setAuth() failing: no channel joined without auth");
    await advance(1000);
    ok(n === 2 && c.chans.length === 1, "…and it retries setAuth() then joins");
    await sig.stop();
  }

  // wake helper
  {
    const listeners = {}; const docL = {};
    const win = { document: { visibilityState: "visible", addEventListener: (e, f) => { docL[e] = f; }, removeEventListener: (e) => { delete docL[e]; } },
      addEventListener: (e, f) => { listeners[e] = f; }, removeEventListener: (e) => { delete listeners[e]; } };
    const got = [];
    const detach = S.havenAttachJobSignalWake(win, t => got.push(t));
    win.document.visibilityState = "hidden"; docL.visibilitychange();
    win.document.visibilityState = "visible"; docL.visibilitychange();
    listeners.online();
    ok(got.join(",") === "foreground,online", "foreground (visible again) and back online wake the refetch; hidden does not");
    ok(S.havenPageVisible(win) === true, "page visible helper");
    detach();
    ok(!docL.visibilitychange && !listeners.online, "detach removes the listeners");
  }
  ok(logs.length === 0, "nothing is logged (payloads are never printed)");
};
