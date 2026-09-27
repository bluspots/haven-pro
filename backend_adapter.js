// ── CHUNK 2: Supabase-backed available jobs (read-only)
// Customer app writes Supabase URL and anon key to localStorage so the Pro app can read the same jobs.
const SUPABASE_URL_KEY = "haven_supabase_url";
const SUPABASE_ANON_KEY = "haven_supabase_anon_key";
const DEMO_PRO_ID = "22222222-2222-4222-8222-222222222222"; // demo pro_id used when claiming backend jobs
function looksLikeUuid(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function getSupabaseConfig() {
  try {
    const urlRaw = window.localStorage.getItem(SUPABASE_URL_KEY);
    const anon = window.localStorage.getItem(SUPABASE_ANON_KEY);
    if (!urlRaw || !anon) return null;
    let url = urlRaw;
    while (url.endsWith("/")) url = url.slice(0, -1); // strip trailing slash
    return { url, anon };
  } catch {
    return null;
  }
}

function mapSupabaseRowToJob(row) {
  // Canonical mapping — see Customer Chunk 1 schema
  const inspectionFeeCents = row.inspection_fee_cents ?? 0;
  return {
    id: String(row.id), // MUST be the backend UUID
    customerName: "Haven customer", // no PII yet
    category: row.category,
    title: row.title,
    payout: row.fixed_pro_labor_payout_cents != null ? Math.round(row.fixed_pro_labor_payout_cents / 100) : 0,
    inspectionFee: inspectionFeeCents > 0 ? Math.round(inspectionFeeCents / 100) : undefined,
    requiresDiagnosis: !!row.requires_diagnosis,
    // Distance and duration are not provided by backend yet — UI tolerates missing values (see tradeBoardCard/eligibleJobs).
    distanceMi: undefined,
    durationMin: undefined,
    city: row.city_label || "",
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    requested: "ASAP",
    emergency: !!row.emergency,
    postedAt: row.posted_at ? Date.parse(row.posted_at) : Date.now(),
  };
}

async function fetchPostedJobsFromSupabase() {
  const cfg = getSupabaseConfig();
  if (!cfg) return null; // not configured — leave SIM_JOBS in place
  // Only claimable rows: posted and unclaimed (pro_id is null), newest first.
  // Include status and pro_id in selection for a defensive client-side filter.
  const url = `${cfg.url}/rest/v1/jobs?status=eq.posted&pro_id=is.null&order=posted_at.desc&select=id,category,title,fixed_pro_labor_payout_cents,requires_diagnosis,city_label,lat,lng,emergency,posted_at,status,pro_id,inspection_fee_cents`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "apikey": cfg.anon,
        "Authorization": `Bearer ${cfg.anon}`,
        "Accept": "application/json",
        "Prefer": "count=exact",
      },
    });
    if (!res.ok) {
      console.warn("Supabase jobs fetch failed", res.status, await res.text());
      return [];
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    // Defensive filter: drop any row that is not posted or already has a pro_id set.
    const clean = rows.filter((row) => {
      const isPosted = row && row.status === "posted";
      const hasPro = !(row == null) && row.pro_id != null;
      return isPosted && !hasPro;
    });
    return clean.map(mapSupabaseRowToJob);
  } catch (e) {
    console.warn("Supabase jobs fetch error", e);
    return [];
  }
}

// Fetch currently active jobs for the demo pro from Supabase (server is source of truth).
// Returns null when Supabase is not configured (SIM mode). On error, soft-fails to [].
async function fetchActiveJobsFromSupabase() {
  const cfg = getSupabaseConfig();
  if (!cfg) return null; // not configured — leave session-only behavior in place
  // Align exactly with the local one-active gate
  const activeStatuses = Array.from(ACTIVE_BLOCK_STATUSES);
  const statusList = activeStatuses.join(",");
  const url =
    `${cfg.url}/rest/v1/jobs?` +
    `pro_id=eq.${encodeURIComponent(DEMO_PRO_ID)}` +
    `&status=in.(${statusList})` +
    `&order=accepted_at.desc`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        apikey: cfg.anon,
        Authorization: `Bearer ${cfg.anon}`,
        Accept: "application/json",
        Prefer: "count=exact",
      },
    });
    if (!res.ok) {
      console.warn("Supabase active jobs fetch failed", res.status, await res.text());
      return [];
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    // Defensive: filter to statuses we consider active locally, even if backend returns extra
    const clean = rows.filter(r => r && activeStatuses.includes(r.status));
    return clean.map(row => {
      const base = mapSupabaseRowToJob(row);
      const acceptedAt =
        row.accepted_at ? Date.parse(row.accepted_at) : Date.now();
      // Backend status is source of truth on rehydrate.
      // arrived, diagnosing, and in_progress are copied as stored —
      // never rewritten to en_route or an earlier step.
      const backendStatus = row.status;
      const materialsCents = row.materials_reimbursed_cents;
      return {
        ...base,
        status: backendStatus,
        acceptedAt,
        backendClaimed: true,
        jobNotes: "",
        beforePhoto: null,
        afterPhoto: null,
        // Existing jobs.materials_reimbursed_cents column (0001). Dollars, same as local receipts.
        materialsReimbursed: typeof materialsCents === "number" && materialsCents > 0 ? Math.round(materialsCents / 100) : 0,
      };
    });
  } catch (e) {
    console.warn("Supabase active jobs fetch error", e);
    return [];
  }
}

// Best-effort terminal status sync back to Supabase after a decline (only if this job was backend-claimed)
async function bestEffortPatchTerminalStatus(job, finalStatus) {
  try {
    const cfg = getSupabaseConfig();
    if (!cfg) return;
    if (!looksLikeUuid(job.id)) return;
    if (!job.backendClaimed) return;
    const url = `${cfg.url}/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}&pro_id=eq.${encodeURIComponent(DEMO_PRO_ID)}`;
    const body = { status: finalStatus };
    if (finalStatus === "inspection_completed") {
      const cents = Math.round(((job.inspectionFee || INSPECTION_VISIT_FEE) || 0) * 100);
      body.inspection_fee_cents = cents;
    } else if (finalStatus === "materials_declined") {
      body.convenience_fee_cents = CONVENIENCE_FEE * 100;
    }
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "apikey": cfg.anon,
        "Authorization": `Bearer ${cfg.anon}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn("Supabase terminal status sync failed", res.status, await res.text());
    }
  } catch (e) {
    console.warn("Supabase terminal status sync error", e);
  }
}

// Attempt to claim a job in Supabase when configured.
// Success returns { ok: true }. On 409 conflict (one-active or already taken), returns { ok: false, conflict: true, reason }.
// On other failures, returns { ok: false, reason }.
async function claimJobOnSupabase(job) {
  const cfg = getSupabaseConfig();
  if (!cfg) return { ok: true, mode: "sim" }; // no backend configured — SIM/local only
  // Try RPC first if available (preferred: lets the backend attach the authenticated pro id and enforce RLS/uniques)
  try {
    const rpcUrl = `${cfg.url}/rest/v1/rpc/pro_claim_job`;
    let res = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        "apikey": cfg.anon,
        "Authorization": `Bearer ${cfg.anon}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=representation",
      },
      body: JSON.stringify({ job_id: job.id }),
    });
    if (res.status === 409) {
      return { ok: false, conflict: true, reason: "conflict" };
    }
    if (res.ok) {
      return { ok: true, mode: "rpc" };
    }
    // If the RPC isn't present (404/400) or unauthorized, fall back to direct update path
  } catch (e) {
    // Network error — fall through to direct update attempt
  }
  // Fallback: direct optimistic UPDATE on posted+unclaimed rows
  try {
    const updUrl = `${cfg.url}/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}&status=eq.posted&pro_id=is.null`;
    const res = await fetch(updUrl, {
      method: "PATCH",
      headers: {
        "apikey": cfg.anon,
        "Authorization": `Bearer ${cfg.anon}`,
        "Content-Type": "application/json",
        // Return the updated row so we can distinguish 0-row updates deterministically.
        "Accept": "application/json",
        "Prefer": "return=representation",
      },
      body: JSON.stringify({ status: "en_route", pro_id: DEMO_PRO_ID, accepted_at: new Date().toISOString() }),
    });
    if (res.status === 409) {
      return { ok: false, conflict: true, reason: "conflict" };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, reason: `update_failed:${res.status}:${text}` };
    }
    // With return=representation, a successful update yields the updated row array.
    // An empty array (or 204/empty) means no rows matched -> already claimed/not claimable.
    let rows = [];
    try {
      rows = await res.json();
    } catch {
      rows = [];
    }
    if (Array.isArray(rows) && rows.length > 0) {
      return { ok: true, mode: "update" };
    }
    return { ok: false, reason: "already_claimed" };
  } catch (e) {
    return { ok: false, reason: "network_error" };
  }
}

// Statuses at or after arrival. en_route does not qualify.
// diagnosing / in_progress are allowed only once the backend shows arrived (or a later active status).
const WORK_AFTER_ARRIVAL_STATUSES = new Set([
  "arrived",
  "diagnosing",
  "materials_requested",
  "materials_approved",
  "in_progress",
]);

function isBackendClaimedJob(job) {
  return !!job && !!getSupabaseConfig() && looksLikeUuid(job.id) && !!job.backendClaimed;
}

// Read the assigned job's current status. null on miss / error (caller fail-closes).
async function fetchAssignedJobStatus(jobId) {
  const cfg = getSupabaseConfig();
  if (!cfg || !looksLikeUuid(jobId)) return null;
  const url =
    `${cfg.url}/rest/v1/jobs?id=eq.${encodeURIComponent(jobId)}` +
    `&pro_id=eq.${encodeURIComponent(DEMO_PRO_ID)}&select=id,status`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        apikey: cfg.anon,
        Authorization: `Bearer ${cfg.anon}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.warn("Supabase assigned job status fetch failed", res.status, await res.text());
      return null;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0 || !rows[0]) return null;
    return rows[0].status || null;
  } catch (e) {
    console.warn("Supabase assigned job status fetch error", e);
    return null;
  }
}

// True when this job may enter diagnosing / in_progress.
// SIM (no backend claim) is not gated here — callers still require local arrival.
// Backend jobs must currently show arrived or a later active status.
async function backendAllowsWorkAfterArrival(job) {
  if (!isBackendClaimedJob(job)) return { ok: true, mode: "sim" };
  const status = await fetchAssignedJobStatus(job.id);
  if (status && WORK_AFTER_ARRIVAL_STATUSES.has(status)) {
    return { ok: true, mode: "backend", status };
  }
  return { ok: false, mode: "backend", status: status || null };
}

// Pro arrival: PATCH status=arrived on an assigned en_route job.
// Success requires a returned row whose status is arrived (same bar as claim).
// A 0-row update re-reads status so a lost response after a successful write still counts.
// 0013 allows en_route → arrived. A blocked write returns ok: false — do not treat it as arrived.
async function patchJobArrivedOnSupabase(job) {
  const cfg = getSupabaseConfig();
  if (!cfg) return { ok: true, mode: "sim" };
  if (!looksLikeUuid(job.id) || !job.backendClaimed) return { ok: true, mode: "sim" };
  const url =
    `${cfg.url}/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}` +
    `&pro_id=eq.${encodeURIComponent(DEMO_PRO_ID)}&status=eq.en_route`;
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: cfg.anon,
        Authorization: `Bearer ${cfg.anon}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ status: "arrived" }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("Supabase arrived PATCH failed", res.status, text);
      return { ok: false, reason: `update_failed:${res.status}:${text}` };
    }
    let rows = [];
    try {
      rows = await res.json();
    } catch {
      rows = [];
    }
    if (Array.isArray(rows) && rows.some(r => r && r.status === "arrived")) {
      return { ok: true, mode: "update" };
    }
    // Empty representation: either no en_route row matched, or the write was filtered.
    // If the server already shows arrived, the transition landed.
    const current = await fetchAssignedJobStatus(job.id);
    if (current === "arrived") return { ok: true, mode: "already" };
    console.warn("Supabase arrived PATCH returned no arrived row", current);
    return { ok: false, reason: "not_updated" };
  } catch (e) {
    console.warn("Supabase arrived PATCH error", e);
    return { ok: false, reason: "network_error" };
  }
}

// Allowed predecessors for the post-arrival work writes.
// diagnosing only from arrived. in_progress from arrived (fixed service),
// diagnosing, or materials_approved (receipt submitted — SQL 0015).
// en_route is intentionally absent — that hop is refused.
const WORK_STATUS_FROM = {
  diagnosing: ["arrived"],
  in_progress: ["arrived", "diagnosing", "materials_approved"],
};

// Pro work start: PATCH status=diagnosing or status=in_progress on an assigned job.
// Filter is id + pro_id + the job's current allowed status.
// Success requires a returned row whose status is the target (same bar as arrived / claim).
// A 0-row update re-reads status so a lost response after a successful write still counts.
// 0014/0015 allow diagnosing and in_progress, including materials_approved → in_progress.
// materials_approved → diagnosing stays refused. A blocked write returns ok: false —
// do not advance the local status.
// extraFields is optional and only merged for the receipt → in_progress write
// (materials_reimbursed_cents). Diagnosing / Start Job do not pass it.
async function patchJobWorkStatusOnSupabase(job, toStatus, extraFields) {
  const cfg = getSupabaseConfig();
  if (!cfg) return { ok: true, mode: "sim" };
  if (!job || !looksLikeUuid(job.id) || !job.backendClaimed) return { ok: true, mode: "sim" };
  const allowedFrom = WORK_STATUS_FROM[toStatus];
  const fromStatus = job.status;
  if (!allowedFrom || !allowedFrom.includes(fromStatus)) {
    return { ok: false, reason: "bad_from_status" };
  }
  const url =
    `${cfg.url}/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}` +
    `&pro_id=eq.${encodeURIComponent(DEMO_PRO_ID)}&status=eq.${fromStatus}`;
  const body = { status: toStatus };
  if (extraFields && typeof extraFields.materials_reimbursed_cents === "number" && Number.isFinite(extraFields.materials_reimbursed_cents) && extraFields.materials_reimbursed_cents >= 0) {
    body.materials_reimbursed_cents = Math.round(extraFields.materials_reimbursed_cents);
  }
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: cfg.anon,
        Authorization: `Bearer ${cfg.anon}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`Supabase ${toStatus} PATCH failed`, res.status, text);
      return { ok: false, reason: `update_failed:${res.status}:${text}` };
    }
    let rows = [];
    try {
      rows = await res.json();
    } catch {
      rows = [];
    }
    if (Array.isArray(rows) && rows.some(r => r && String(r.id).toLowerCase() === String(job.id).toLowerCase() && r.status === toStatus)) {
      return { ok: true, mode: "update" };
    }
    // Empty representation: either no matching row, or the write was filtered.
    // If the server already shows the target, the transition landed.
    const current = await fetchAssignedJobStatus(job.id);
    if (current === toStatus) return { ok: true, mode: "already" };
    console.warn(`Supabase ${toStatus} PATCH returned no ${toStatus} row`, current);
    return { ok: false, reason: "not_updated" };
  } catch (e) {
    console.warn(`Supabase ${toStatus} PATCH error`, e);
    return { ok: false, reason: "network_error" };
  }
}

// Awaited complete write for a backend-claimed in_progress job.
// Success requires a returned row whose status is complete (same bar as arrived / work).
// A 0-row update re-reads status so a lost response after a successful write still counts.
// 0012 allows assigned → complete. Decline terminals stay on the best-effort path.
// jobs.completed_at already exists on the shared schema (0001) as the terminal timestamp,
// so this write stamps it. Decline paths do not.
async function patchJobCompleteOnSupabase(job) {
  const cfg = getSupabaseConfig();
  if (!cfg) return { ok: true, mode: "sim" };
  if (!job || !looksLikeUuid(job.id) || !job.backendClaimed) return { ok: true, mode: "sim" };
  if (job.status !== "in_progress") return { ok: false, reason: "bad_from_status" };
  const url =
    `${cfg.url}/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}` +
    `&pro_id=eq.${encodeURIComponent(DEMO_PRO_ID)}&status=eq.in_progress`;
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: cfg.anon,
        Authorization: `Bearer ${cfg.anon}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ status: "complete", completed_at: new Date().toISOString() }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("Supabase complete PATCH failed", res.status, text);
      return { ok: false, reason: `update_failed:${res.status}:${text}` };
    }
    let rows = [];
    try {
      rows = await res.json();
    } catch {
      rows = [];
    }
    if (Array.isArray(rows) && rows.some(r => r && String(r.id).toLowerCase() === String(job.id).toLowerCase() && r.status === "complete")) {
      return { ok: true, mode: "update" };
    }
    const current = await fetchAssignedJobStatus(job.id);
    if (current === "complete") return { ok: true, mode: "already" };
    console.warn("Supabase complete PATCH returned no complete row", current);
    return { ok: false, reason: "not_updated" };
  } catch (e) {
    console.warn("Supabase complete PATCH error", e);
    return { ok: false, reason: "network_error" };
  }
}

// Write a backend-claimed job's materials request to Supabase (status + estimate/items).
// Soft-fails: logs and returns if Supabase isn't configured, id isn't a UUID, or backend not claimed.
async function bestEffortPatchMaterialsRequested(job, cleanItems, totalCost) {
  try {
    const cfg = getSupabaseConfig();
    if (!cfg) return;
    if (!looksLikeUuid(job.id)) return;
    if (!job.backendClaimed) return;
    const url = `${cfg.url}/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}&pro_id=eq.${encodeURIComponent(DEMO_PRO_ID)}`;
    // Normalize items and include an aggregate estimate (in cents) when possible.
    const normalizedItems = cleanItems.map(it => ({
      name: String(it.name),
      // store cents to avoid float issues; some backends may coerce to numeric
      cost_cents: Math.round(Number(it.cost) * 100),
    }));
    const body = {
      status: "materials_requested",
      // Best-effort shared fields; if columns are absent, the PATCH may be a no-op and is logged below.
      materials_items: normalizedItems,                 // JSON[] (if present)
      materials_estimate_cents: Math.round(totalCost * 100), // integer (if present)
      materials_requested_at: new Date().toISOString(), // timestamp (if present)
    };
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "apikey": cfg.anon,
        "Authorization": `Bearer ${cfg.anon}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn("Supabase materials request PATCH failed", res.status, await res.text());
    }
  } catch (e) {
    console.warn("Supabase materials request PATCH error", e);
  }
}

