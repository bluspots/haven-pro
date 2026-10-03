// ── CHUNK 2: Supabase-backed available jobs (read-only)
// Customer app writes Supabase URL and anon key to localStorage so the Pro app can read the same jobs.
// Slice 1 stores the Supabase Auth session. Slice 2 binds claim and later Pro job writes to that
// session (auth uid + user access token). Slice 4: no session stops those writes and does not
// send a demo pro id. Signed-out board reads posted_jobs_public; signed-in board still uses jobs. See docs/AUTH_SLICE2.md.
const SUPABASE_URL_KEY = "haven_supabase_url";
const SUPABASE_ANON_KEY = "haven_supabase_anon_key";
// Default ON (missing key, "true", "1", "on"). Explicit off: "false" | "0" | "off" | "no".
// Coordinated with the Customer app. This slice reads the flag and does not switch job Authorization.
const HAVEN_PROTOTYPE_ANON_MODE_KEY = "haven_prototype_anon_mode";
// Supabase Auth → URL configuration for the published Pro app. Email links must be allowed to land here.
const HAVEN_PRO_AUTH_REDIRECT_URL = "https://bluspots.github.io/haven-pro/";
// Local-only Pro workspace snapshot (city, categories, radius, onboarding).
// Restores Create Your Profile / empty city after refresh without writing profiles.
const HAVEN_PRO_WORKSPACE_KEY = "haven_pro_workspace_v1";
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
  // Posted + unclaimed only. Never query as DEMO_PRO. apikey stays the anon key.
  // Signed in: public.jobs with the user access token (full row still allowed).
  // Signed out: public.posted_jobs_public with the anon bearer (limited columns).
  // Requires Customer migration 0020 pasted before this signed-out path works.
  const actor = await resolveHavenJobWriteAuth(cfg);
  const signedIn = !!(actor.ok && actor.mode === "session");
  if (!signedIn && actor.reason === "session_identity_missing") {
    return [];
  }
  let headers;
  let url;
  if (signedIn) {
    headers = {
      "apikey": actor.headers.apikey,
      "Authorization": actor.headers.Authorization,
      "Accept": "application/json",
      "Prefer": "count=exact",
    };
    url = `${cfg.url}/rest/v1/jobs?status=eq.posted&pro_id=is.null&order=posted_at.desc&select=id,category,title,fixed_pro_labor_payout_cents,requires_diagnosis,city_label,lat,lng,emergency,posted_at,status,pro_id,inspection_fee_cents`;
  } else {
    headers = {
      "apikey": cfg.anon,
      "Authorization": `Bearer ${cfg.anon}`,
      "Accept": "application/json",
      "Prefer": "count=exact",
    };
    url = `${cfg.url}/rest/v1/posted_jobs_public?order=posted_at.desc&select=id,category,title,fixed_pro_labor_payout_cents,requires_diagnosis,city_label,emergency,posted_at,status,inspection_fee_cents`;
  }
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
    });
    if (!res.ok) {
      console.warn("Supabase jobs fetch failed", res.status, await res.text());
      return [];
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    // Defensive filter: posted only. Signed-in also drops rows that already have a pro.
    const clean = rows.filter((row) => {
      const isPosted = row && row.status === "posted";
      if (!isPosted) return false;
      if (signedIn) {
        const hasPro = row.pro_id != null;
        return !hasPro;
      }
      return true; // view already enforces pro_id is null
    });
    return clean.map(mapSupabaseRowToJob);
  } catch (e) {
    console.warn("Supabase jobs fetch error", e);
    return [];
  }
}

// Fetch currently active jobs for the acting pro from Supabase (server is source of truth).
// Signed in: auth uid + user bearer. No session: skip. Do not query as a demo pro.
// Returns null when Supabase is not configured (SIM mode). On error, soft-fails to [].
async function fetchActiveJobsFromSupabase() {
  const cfg = getSupabaseConfig();
  if (!cfg) return null; // not configured — leave session-only behavior in place
  const actor = await resolveHavenJobWriteAuth(cfg);
  if (!actor.ok) {
    console.warn("Supabase active jobs fetch skipped", actor.reason);
    return [];
  }
  // Align exactly with the local one-active gate
  const activeStatuses = Array.from(ACTIVE_BLOCK_STATUSES);
  const statusList = activeStatuses.join(",");
  const url =
    `${cfg.url}/rest/v1/jobs?` +
    `pro_id=eq.${encodeURIComponent(actor.proId)}` +
    `&status=in.(${statusList})` +
    `&order=accepted_at.desc`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        apikey: actor.headers.apikey,
        Authorization: actor.headers.Authorization,
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

// Terminal status sync after a decline (only if this job was backend-claimed).
// Slice 5: empty / 0-row representation is not a landed write.
async function bestEffortPatchTerminalStatus(job, finalStatus) {
  try {
    const cfg = getSupabaseConfig();
    if (!cfg) return { ok: false, reason: "not_configured" };
    if (!looksLikeUuid(job.id)) return { ok: false, reason: "not_backend" };
    if (!job.backendClaimed) return { ok: false, reason: "not_backend" };
    const actor = await resolveHavenJobWriteAuth(cfg);
    if (!actor.ok) {
      console.warn("Supabase terminal status sync skipped", actor.reason);
      return { ok: false, reason: actor.reason };
    }
    const url = `${cfg.url}/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}&pro_id=eq.${encodeURIComponent(actor.proId)}`;
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
        apikey: actor.headers.apikey,
        Authorization: actor.headers.Authorization,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn("Supabase terminal status sync failed", res.status, await res.text());
      return { ok: false, reason: "update_failed" };
    }
    let rows = [];
    try { rows = await res.json(); } catch { rows = []; }
    if (Array.isArray(rows) && rows.some(r => r && String(r.id).toLowerCase() === String(job.id).toLowerCase() && r.status === finalStatus)) {
      return { ok: true };
    }
    console.warn("Supabase terminal status sync returned no matching row");
    return { ok: false, reason: "not_updated" };
  } catch (e) {
    console.warn("Supabase terminal status sync error", e);
    return { ok: false, reason: "network_error" };
  }
}

// Slice 2 job-write identity.
// A real Supabase session binds the write to auth.uid() and that session's access token.
// apikey stays the anon key; Authorization Bearer does not.
// No session: stop. Do not send a demo pro id or the anon key as the user identity.
// A session missing uid or access token fails closed and does not write.
async function resolveHavenJobWriteAuth(cfg) {
  const client = getHavenSupabaseClient();
  if (client && client.auth && typeof client.auth.getSession === "function") {
    try {
      const { data, error } = await client.auth.getSession();
      if (!error) {
        const session = data && data.session ? data.session : null;
        if (session) {
          const uid = session.user && typeof session.user.id === "string" ? session.user.id.trim() : "";
          const bearer = typeof session.access_token === "string" ? session.access_token.trim() : "";
          if (!uid || !bearer) {
            return { ok: false, reason: "session_identity_missing" };
          }
          rememberHavenSession(session);
        } else if (!getHavenAuthUser() && !getHavenAccessToken()) {
          rememberHavenSession(null);
        }
      } else if (!getHavenAuthUser() && !getHavenAccessToken()) {
        return { ok: false, reason: "session_identity_missing" };
      }
    } catch (e) {
      if (!getHavenAuthUser() && !getHavenAccessToken()) {
        console.warn("Haven job auth session read failed", e);
        return { ok: false, reason: "session_identity_missing" };
      }
    }
  }
  const user = getHavenAuthUser();
  const token = getHavenAccessToken();
  const hasSession = !!(user || (typeof token === "string" && token !== ""));
  if (hasSession) {
    const proId = user && typeof user.id === "string" ? user.id.trim() : "";
    const bearer = typeof token === "string" ? token.trim() : "";
    if (!proId || !bearer) {
      return { ok: false, reason: "session_identity_missing" };
    }
    return {
      ok: true,
      mode: "session",
      proId: proId,
      headers: {
        apikey: cfg.anon,
        Authorization: `Bearer ${bearer}`,
      },
    };
  }
  return { ok: false, reason: "no_session" };
}

// Attempt to claim a job in Supabase when configured.
// Success returns { ok: true }. On 409 conflict (one-active or already taken), returns { ok: false, conflict: true, reason }.
// On other failures, returns { ok: false, reason }.
// Signed in: pro_id is the auth uid and Bearer is the user access token.
// Signed out: the claim stops and does not send a demo pro id.
async function claimJobOnSupabase(job) {
  const cfg = getSupabaseConfig();
  if (!cfg) return { ok: true, mode: "sim" }; // no backend configured — SIM/local only
  const actor = await resolveHavenJobWriteAuth(cfg);
  if (!actor.ok) return { ok: false, reason: actor.reason };
  // Try RPC first if available (preferred: lets the backend attach the authenticated pro id and enforce RLS/uniques)
  try {
    const rpcUrl = `${cfg.url}/rest/v1/rpc/pro_claim_job`;
    let res = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        apikey: actor.headers.apikey,
        Authorization: actor.headers.Authorization,
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
      // Slice 5: Prefer return=representation. A 2xx with no claimed row is not success.
      let rows = [];
      try {
        rows = await res.json();
      } catch {
        rows = [];
      }
      const list = Array.isArray(rows) ? rows : (rows && typeof rows === "object" ? [rows] : []);
      const landed = list.some(
        (r) =>
          r &&
          String(r.id).toLowerCase() === String(job.id).toLowerCase() &&
          r.status === "en_route" &&
          String(r.pro_id || "").toLowerCase() === String(actor.proId).toLowerCase()
      );
      if (landed) return { ok: true, mode: "rpc" };
      return { ok: false, reason: "already_claimed" };
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
        apikey: actor.headers.apikey,
        Authorization: actor.headers.Authorization,
        "Content-Type": "application/json",
        // Return the updated row so we can distinguish 0-row updates deterministically.
        "Accept": "application/json",
        "Prefer": "return=representation",
      },
      body: JSON.stringify({ status: "en_route", pro_id: actor.proId, accepted_at: new Date().toISOString() }),
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
  const actor = await resolveHavenJobWriteAuth(cfg);
  if (!actor.ok) return null;
  const url =
    `${cfg.url}/rest/v1/jobs?id=eq.${encodeURIComponent(jobId)}` +
    `&pro_id=eq.${encodeURIComponent(actor.proId)}&select=id,status`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        apikey: actor.headers.apikey,
        Authorization: actor.headers.Authorization,
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
  const actor = await resolveHavenJobWriteAuth(cfg);
  if (!actor.ok) return { ok: false, reason: actor.reason };
  const url =
    `${cfg.url}/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}` +
    `&pro_id=eq.${encodeURIComponent(actor.proId)}&status=eq.en_route`;
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: actor.headers.apikey,
        Authorization: actor.headers.Authorization,
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
  const actor = await resolveHavenJobWriteAuth(cfg);
  if (!actor.ok) return { ok: false, reason: actor.reason };
  const url =
    `${cfg.url}/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}` +
    `&pro_id=eq.${encodeURIComponent(actor.proId)}&status=eq.${fromStatus}`;
  const body = { status: toStatus };
  if (extraFields && typeof extraFields.materials_reimbursed_cents === "number" && Number.isFinite(extraFields.materials_reimbursed_cents) && extraFields.materials_reimbursed_cents >= 0) {
    body.materials_reimbursed_cents = Math.round(extraFields.materials_reimbursed_cents);
  }
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: actor.headers.apikey,
        Authorization: actor.headers.Authorization,
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
  const actor = await resolveHavenJobWriteAuth(cfg);
  if (!actor.ok) return { ok: false, reason: actor.reason };
  const url =
    `${cfg.url}/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}` +
    `&pro_id=eq.${encodeURIComponent(actor.proId)}&status=eq.in_progress`;
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: actor.headers.apikey,
        Authorization: actor.headers.Authorization,
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
// Slice 5: empty / 0-row representation is not a landed write.
async function bestEffortPatchMaterialsRequested(job, cleanItems, totalCost) {
  try {
    const cfg = getSupabaseConfig();
    if (!cfg) return { ok: false, reason: "not_configured" };
    if (!looksLikeUuid(job.id)) return { ok: false, reason: "not_backend" };
    if (!job.backendClaimed) return { ok: false, reason: "not_backend" };
    const actor = await resolveHavenJobWriteAuth(cfg);
    if (!actor.ok) {
      console.warn("Supabase materials request PATCH skipped", actor.reason);
      return { ok: false, reason: actor.reason };
    }
    const url = `${cfg.url}/rest/v1/jobs?id=eq.${encodeURIComponent(job.id)}&pro_id=eq.${encodeURIComponent(actor.proId)}`;
    const normalizedItems = cleanItems.map(it => ({
      name: String(it.name),
      cost_cents: Math.round(Number(it.cost) * 100),
    }));
    const body = {
      status: "materials_requested",
      materials_items: normalizedItems,
      materials_estimate_cents: Math.round(totalCost * 100),
      materials_requested_at: new Date().toISOString(),
    };
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: actor.headers.apikey,
        Authorization: actor.headers.Authorization,
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn("Supabase materials request PATCH failed", res.status, await res.text());
      return { ok: false, reason: "update_failed" };
    }
    let rows = [];
    try { rows = await res.json(); } catch { rows = []; }
    if (Array.isArray(rows) && rows.some(r => r && String(r.id).toLowerCase() === String(job.id).toLowerCase() && r.status === "materials_requested")) {
      return { ok: true };
    }
    console.warn("Supabase materials request PATCH returned no materials_requested row");
    return { ok: false, reason: "not_updated" };
  } catch (e) {
    console.warn("Supabase materials request PATCH error", e);
    return { ok: false, reason: "network_error" };
  }
}

// ── Slice 1: Pro Auth session. Slice 2 sends it on pro job writes. ───────
// Missing / unrecognized values stay ON. The flag does not choose the job writer.
// A missing session stops claim and later writes. It does not fall back to a demo pro.
function isPrototypeAnonMode() {
  try {
    const raw = window.localStorage.getItem(HAVEN_PROTOTYPE_ANON_MODE_KEY);
    if (raw == null) return true;
    const v = String(raw).trim().toLowerCase();
    if (v === "" || v === "1" || v === "true" || v === "on" || v === "yes") return true;
    if (v === "0" || v === "false" || v === "off" || v === "no") return false;
    return true;
  } catch (e) {
    return true;
  }
}

function loadHavenProWorkspace(userId) {
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(HAVEN_PRO_WORKSPACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const byUser = parsed && typeof parsed === "object" ? (parsed.byUserId || parsed.data || null) : null;
    if (!byUser || typeof byUser !== "object") return null;
    const row = byUser[userId];
    if (!row || typeof row !== "object") return null;
    return row;
  } catch (e) {
    return null;
  }
}

function saveHavenProWorkspace(userId, snapshot) {
  if (!userId || !snapshot || typeof snapshot !== "object") return false;
  try {
    let root = { __v: 1, byUserId: {} };
    const raw = window.localStorage.getItem(HAVEN_PRO_WORKSPACE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          root = {
            __v: 1,
            byUserId: (parsed.byUserId && typeof parsed.byUserId === "object")
              ? Object.assign({}, parsed.byUserId)
              : {},
          };
        }
      } catch (e) { /* reset */ }
    }
    root.byUserId[userId] = snapshot;
    window.localStorage.setItem(HAVEN_PRO_WORKSPACE_KEY, JSON.stringify(root));
    return true;
  } catch (e) {
    return false;
  }
}

function havenAuthLib() {
  try {
    if (typeof window !== "undefined" && window.supabase && typeof window.supabase.createClient === "function") {
      return window.supabase;
    }
  } catch (e) { /* ignore */ }
  return null;
}

let havenSupabaseClient = null;
let havenSupabaseClientKey = "";
// In-memory copy of the Auth session. Job writes read it (and getSession) in resolveHavenJobWriteAuth.
let havenAccessToken = null;
let havenAuthUser = null;

function rememberHavenSession(session) {
  if (session && session.access_token && session.user) {
    havenAccessToken = session.access_token;
    const meta = session.user.user_metadata || {};
    havenAuthUser = {
      id: session.user.id || null,
      email: session.user.email || "",
      role: meta.role || null,
    };
    return;
  }
  havenAccessToken = null;
  havenAuthUser = null;
}

function getHavenAccessToken() {
  return havenAccessToken;
}

function getHavenAuthUser() {
  return havenAuthUser;
}

function getHavenSupabaseClient() {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;
  const lib = havenAuthLib();
  if (!lib) return null;
  const key = cfg.url + "|" + cfg.anon;
  if (havenSupabaseClient && havenSupabaseClientKey === key) return havenSupabaseClient;
  havenSupabaseClient = lib.createClient(cfg.url, cfg.anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage,
    },
  });
  havenSupabaseClientKey = key;
  return havenSupabaseClient;
}

function havenProAuthRedirectUrl() {
  return HAVEN_PRO_AUTH_REDIRECT_URL;
}

// Signup metadata role "pro" is what the Customer 0016 profile trigger reads.
async function havenAuthSignUp(creds) {
  const client = getHavenSupabaseClient();
  if (!client) return { ok: false, reason: "not_configured" };
  const email = creds && creds.email ? String(creds.email).trim() : "";
  const password = creds && creds.password ? String(creds.password) : "";
  const { data, error } = await client.auth.signUp({
    email: email,
    password: password,
    options: {
      data: { role: "pro" },
      emailRedirectTo: havenProAuthRedirectUrl(),
    },
  });
  if (error) return { ok: false, reason: error.message || "signup_failed" };
  const session = data && data.session ? data.session : null;
  if (session) rememberHavenSession(session);
  return {
    ok: true,
    session: session,
    user: data && data.user ? data.user : null,
    needsEmailConfirm: !session,
  };
}

async function havenAuthSignIn(creds) {
  const client = getHavenSupabaseClient();
  if (!client) return { ok: false, reason: "not_configured" };
  const email = creds && creds.email ? String(creds.email).trim() : "";
  const password = creds && creds.password ? String(creds.password) : "";
  const { data, error } = await client.auth.signInWithPassword({
    email: email,
    password: password,
  });
  if (error) return { ok: false, reason: error.message || "signin_failed" };
  const session = data && data.session ? data.session : null;
  if (!session) return { ok: false, reason: "signin_failed" };
  rememberHavenSession(session);
  return { ok: true, session: session, user: data.user || null };
}

async function havenAuthSignOut() {
  const client = getHavenSupabaseClient();
  if (!client) {
    rememberHavenSession(null);
    return { ok: true, mode: "local" };
  }
  const { error } = await client.auth.signOut();
  if (error) return { ok: false, reason: error.message || "signout_failed" };
  rememberHavenSession(null);
  return { ok: true };
}

async function havenAuthRestoreSession() {
  const client = getHavenSupabaseClient();
  if (!client) return { ok: false, reason: "not_configured" };
  const { data, error } = await client.auth.getSession();
  if (error) return { ok: false, reason: error.message || "session_failed" };
  const session = data && data.session ? data.session : null;
  rememberHavenSession(session);
  return { ok: true, session: session };
}

function subscribeHavenAuth(onChange) {
  const client = getHavenSupabaseClient();
  if (!client) return function () {};
  const { data } = client.auth.onAuthStateChange(function (_event, session) {
    rememberHavenSession(session);
    if (typeof onChange === "function") onChange(session || null);
  });
  const sub = data && data.subscription;
  return function () {
    try {
      if (sub && typeof sub.unsubscribe === "function") sub.unsubscribe();
    } catch (e) { /* ignore */ }
  };
}

