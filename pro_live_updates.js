// Live job updates for the Pro app (founder approved 2026-11-11, draft).
// Pure helpers used by the realtime job signal refetch (job_signal.js) and by
// every other active-jobs re-read (load, foreground, back online, 60 s safety
// poll on the job screen, destination not_found).
//
// The server is the source of truth for which jobs are this Pro's active jobs
// and their status. Local-only details (notes, photos, work timer) stay on a
// job that is still active. A job the server no longer lists as this Pro's
// active job leaves "My Jobs", with plain copy, unless this app is in the
// middle of finishing it itself.

// Statuses the existing 5 s job poll already follows (a Customer can end the
// job from these, and that poll records the fee). A refetch leaves them to it,
// unless the server told us the job was taken away.
const HAVEN_PRO_POLL_OWNED_STATUSES = new Set(["diagnosing", "materials_requested", "materials_approved"]);

// Copy for a job that is no longer this Pro's (final wording is product's call).
function havenProRemovedJobMessage(status) {
  if (status === "cancelled") return "This job was cancelled.";
  if (typeof status === "string" && status) return "This job was reassigned. You're no longer on it.";
  return "This job is no longer assigned to you.";
}

// local: the app's active jobs. rows: the server's active jobs for this Pro
// (already mapped; null when the read failed). opts:
//   startedAt:        when the read started (ms)
//   lastLocalChange:  { [jobId]: ms } last local status change per job
//   busyIds:          Set of job ids this app is finishing / advancing right now
//   signals:          Map jobId -> { status, reason } from job_changed signals
// Returns { jobs, removed: [{ job, status, message }], added: [ids] } or null
// when nothing was read (the app keeps what it has).
function havenReconcileProActiveJobs(local, rows, opts) {
  if (!Array.isArray(rows)) return null;
  const o = opts || {};
  const startedAt = typeof o.startedAt === "number" ? o.startedAt : 0;
  const changed = o.lastLocalChange || {};
  const busy = o.busyIds instanceof Set ? o.busyIds : new Set();
  const signals = o.signals instanceof Map ? o.signals : new Map();
  const current = Array.isArray(local) ? local : [];
  const byId = new Map(current.map(j => [String(j.id), j]));
  const serverIds = new Set();
  const jobs = [];
  const added = [];
  rows.forEach(row => {
    if (!row || row.id == null) return;
    const id = String(row.id);
    if (serverIds.has(id)) return;
    serverIds.add(id);
    const mine = byId.get(id);
    if (!mine) { jobs.push(row); added.push(id); return; }
    // A status step this app wrote after the read started is newer than the read.
    const keepLocal = (changed[id] || 0) > startedAt || busy.has(id);
    const merged = { ...row, ...mine,
      status: keepLocal ? mine.status : row.status,
      backendClaimed: true,
      materialsReimbursed: row.materialsReimbursed || mine.materialsReimbursed || 0,
    };
    jobs.push(merged);
  });
  const removed = [];
  current.forEach(j => {
    const id = String(j.id);
    if (serverIds.has(id)) return;
    // SIM / not server-claimed jobs are never touched by a server read.
    if (!j.backendClaimed) { jobs.push(j); return; }
    const sig = signals.get(id.toLowerCase()) || signals.get(id) || null;
    const toldRemoved = !!(sig && sig.reason === "removed");
    const finishingHere = busy.has(id) || (changed[id] || 0) > startedAt;
    const pollOwned = HAVEN_PRO_POLL_OWNED_STATUSES.has(j.status) && !toldRemoved;
    if (finishingHere || pollOwned) { jobs.push(j); return; }
    const status = sig ? sig.status : null;
    removed.push({ job: j, status, message: havenProRemovedJobMessage(status) });
  });
  return { jobs, removed, added };
}

// True when a My Jobs stack view belongs to this job (detail, completion
// review, receipt, …), so the app can leave it.
function havenProViewIsForJob(view, jobId) {
  return !!(view && view.jobId != null && String(view.jobId) === String(jobId));
}
