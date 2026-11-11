// ── Live job updates: realtime job signal (MIG-0036, contract v1) ───────────
// Founder approved 2026-11-11 (draft). Contract: Customer repo
// supabase/contracts/REALTIME_JOB_SIGNAL_CONTRACT.md (PR #97, head 4df74734).
//
// After sign-in the app joins its own private Broadcast topic
// jobs:user:<auth user id> and listens for `job_changed`. A message is only a
// "something changed, refetch" signal: it is never used as data. Signals are
// debounced (HAVEN_JOB_SIGNAL_DEBOUNCE_MS) and then the app refetches through
// the reads it already has. The same refetch also runs when the channel is
// SUBSCRIBED (first join and every rejoin), when the app comes back to the
// foreground, when the network comes back, and on the app's safety polls, so
// a missed broadcast (or 0036 not applied yet) only means a slower update.
//
// Payloads are never logged. No coordinates, addresses or prices are in them.
// Same file in the Customer app and the Pro app.

const HAVEN_JOB_SIGNAL_DEBOUNCE_MS = 400;
const HAVEN_JOB_SIGNAL_EVENT = "job_changed";
const HAVEN_JOB_SIGNAL_RETRY_MS = [1000, 2000, 5000, 10000, 30000]; // then stays at 30 s
const HAVEN_JOB_SIGNAL_SAFETY_POLL_MS = 60000; // active-job screens
const HAVEN_JOB_SIGNAL_REASONS = new Set(["created", "added", "updated", "removed"]);
const HAVEN_JOB_SIGNAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// jobs:user:<lowercase uuid>, or null for anything that is not a user id.
function havenJobSignalTopic(userId) {
  const id = String(userId == null ? "" : userId).trim().toLowerCase();
  return HAVEN_JOB_SIGNAL_UUID.test(id) ? "jobs:user:" + id : null;
}

// A v1 payload -> { jobId, status, reason, at }, or null when it can't be
// read (another version, no job id). A null result still means "refetch".
function havenParseJobSignal(payload) {
  if (!payload || typeof payload !== "object" || payload.v !== 1) return null;
  const jobId = String(payload.job_id == null ? "" : payload.job_id).toLowerCase();
  if (!HAVEN_JOB_SIGNAL_UUID.test(jobId)) return null;
  const reason = HAVEN_JOB_SIGNAL_REASONS.has(payload.reason) ? payload.reason : "updated";
  const status = typeof payload.status === "string" && payload.status ? payload.status : null;
  const at = typeof payload.at === "string" ? payload.at : null;
  return { jobId, status, reason, at };
}

// deps:
//   getClient()        -> the app's supabase-js client (or null)
//   onRefetch(batch)   -> Promise; batch = { signals: [{jobId,status,reason,at}], wake: bool, tags: [..] }
//   isHidden()         -> true while the app is in the background (refetches wait)
//   debounceMs, retryWaitsMs, setTimer(fn, ms), clearTimer(id)  (tests)
// Returns { start(userId), stop(), kick(tag), topic(), state() }.
function havenCreateJobSignal(deps) {
  const d = deps || {};
  const setTimer = d.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = d.clearTimer || (id => clearTimeout(id));
  const debounceMs = typeof d.debounceMs === "number" ? d.debounceMs : HAVEN_JOB_SIGNAL_DEBOUNCE_MS;
  const retryWaits = Array.isArray(d.retryWaitsMs) && d.retryWaitsMs.length ? d.retryWaitsMs : HAVEN_JOB_SIGNAL_RETRY_MS;
  let gen = 0;               // bumps on every start/stop: late callbacks from an old session are ignored
  let client = null;
  let channel = null;
  let topic = null;
  let status = "idle";       // idle | joining | subscribed | retrying | unavailable
  let debounceTimer = null;
  let retryTimer = null;
  let failures = 0;
  let pending = new Map();   // jobId -> latest signal
  let wake = false;
  let tags = [];
  let refetching = false;
  let again = false;
  let heldWhileHidden = false;

  function schedule() {
    if (debounceTimer != null) clearTimer(debounceTimer);
    const myGen = gen;
    debounceTimer = setTimer(() => { debounceTimer = null; if (myGen === gen) flush(myGen); }, debounceMs);
  }
  async function flush(myGen) {
    if (refetching) { again = true; return; }
    // In the background: hold the refetch (signals, polls) and run it once when
    // the app is back in the foreground (kick("foreground")).
    if (typeof d.isHidden === "function" && d.isHidden()) { heldWhileHidden = true; return; }
    heldWhileHidden = false;
    const batch = { signals: Array.from(pending.values()), wake, tags: tags.slice() };
    pending = new Map(); wake = false; tags = [];
    if (!batch.signals.length && !batch.wake) return;
    refetching = true;
    try { if (typeof d.onRefetch === "function") await d.onRefetch(batch); }
    catch (e) { /* the next signal, wake or poll refetches again */ }
    finally {
      refetching = false;
      if (again && myGen === gen) { again = false; schedule(); }
    }
  }
  async function removeCurrent() {
    const c = client, ch = channel;
    channel = null;
    if (c && ch && typeof c.removeChannel === "function") {
      try { await c.removeChannel(ch); } catch (e) {}
    }
  }
  function scheduleResubscribe(myGen) {
    if (myGen !== gen || retryTimer != null) return;
    status = "retrying";
    const wait = retryWaits[Math.min(failures, retryWaits.length - 1)];
    failures++;
    retryTimer = setTimer(async () => {
      retryTimer = null;
      if (myGen !== gen) return;
      await removeCurrent();
      if (myGen !== gen) return;
      join(myGen);
    }, wait);
  }
  async function join(myGen) {
    const c = client, t = topic;
    if (!c || !t || myGen !== gen) return;
    status = "joining";
    try {
      // Realtime Authorization uses the user's JWT (supabase-js takes it from the session).
      if (c.realtime && typeof c.realtime.setAuth === "function") await c.realtime.setAuth();
    } catch (e) {
      scheduleResubscribe(myGen);
      return;
    }
    if (myGen !== gen || channel) return;   // stopped, restarted, or already joined
    try {
      const ch = c.channel(t, { config: { private: true } });
      channel = ch;
      ch.on("broadcast", { event: HAVEN_JOB_SIGNAL_EVENT }, (msg) => {
        if (myGen !== gen || channel !== ch) return;
        const s = havenParseJobSignal(msg && msg.payload);
        if (s) pending.set(s.jobId, s); else wake = true;
        schedule();
      });
      ch.subscribe((st) => {
        if (myGen !== gen || channel !== ch) return;
        if (st === "SUBSCRIBED") {
          status = "subscribed";
          failures = 0;
          wake = true; tags.push("subscribed");
          schedule();
        } else if (st === "CHANNEL_ERROR" || st === "TIMED_OUT") {
          scheduleResubscribe(myGen);
        } else if (st === "CLOSED" && status === "subscribed") {
          // Closed by the server (e.g. the JWT expired): join again with a fresh token.
          scheduleResubscribe(myGen);
        }
      });
    } catch (e) {
      scheduleResubscribe(myGen);
    }
  }
  // Synchronous teardown: bumps the generation and forgets the channel at once
  // (before any await), so a start()/stop() in the same tick can't leave an
  // older join alive. Returns the removal of the old channel to await.
  function teardown() {
    gen++;
    if (debounceTimer != null) { clearTimer(debounceTimer); debounceTimer = null; }
    if (retryTimer != null) { clearTimer(retryTimer); retryTimer = null; }
    pending = new Map(); wake = false; tags = []; again = false; failures = 0; heldWhileHidden = false;
    topic = null;
    status = "idle";
    const c = client, ch = channel;
    channel = null; client = null;
    return (async () => {
      if (c && ch && typeof c.removeChannel === "function") {
        try { await c.removeChannel(ch); } catch (e) {}
      }
    })();
  }
  async function stop() { await teardown(); }
  return {
    // Join the signed-in user's topic. Same user again: nothing changes.
    // Another user: the old channel is removed first (account switch).
    async start(userId) {
      const t = havenJobSignalTopic(userId);
      if (t && t === topic) return true;
      const removed = teardown();          // synchronous: gen bumps now
      const myGen = gen;
      if (!t) { await removed; return false; }
      topic = t;
      let c = null;
      try { c = typeof d.getClient === "function" ? d.getClient() : null; } catch (e) { c = null; }
      if (!c || typeof c.channel !== "function") { status = "unavailable"; await removed; return false; }
      client = c;
      await removed;                       // the old channel goes before the new join
      if (myGen !== gen) return false;     // stopped / restarted meanwhile
      await join(myGen);
      return myGen === gen;
    },
    stop,
    // Foreground, back online, safety poll: refetch (debounced) while signed in.
    kick(tag) {
      if (!topic) return;
      wake = true;
      if (tag) tags.push(String(tag));
      schedule();
    },
    topic() { return topic; },
    state() { return status; },
    held() { return heldWhileHidden; },
  };
}

// Foreground and back-online wake-ups. Returns a detach function.
function havenAttachJobSignalWake(win, onWake) {
  if (!win || typeof onWake !== "function") return () => {};
  const doc = win.document;
  const onVisible = () => { try { if (!doc || doc.visibilityState !== "hidden") onWake("foreground"); } catch (e) {} };
  const onOnline = () => onWake("online");
  const onShow = (e) => { if (e && e.persisted) onWake("foreground"); };
  try { if (doc) doc.addEventListener("visibilitychange", onVisible); } catch (e) {}
  try { win.addEventListener("online", onOnline); win.addEventListener("pageshow", onShow); } catch (e) {}
  return () => {
    try { if (doc) doc.removeEventListener("visibilitychange", onVisible); } catch (e) {}
    try { win.removeEventListener("online", onOnline); win.removeEventListener("pageshow", onShow); } catch (e) {}
  };
}

// True while the page is visible (used to pause board polling in the background).
function havenPageVisible(win) {
  try { return !win || !win.document || win.document.visibilityState !== "hidden"; } catch (e) { return true; }
}
