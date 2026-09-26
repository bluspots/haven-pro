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
  const url = `${cfg.url}/rest/v1/jobs?status=eq.posted&order=posted_at.desc`;
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
    return rows.map(mapSupabaseRowToJob);
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
  const activeStatuses = [
    "en_route",
    "arrived",
    "diagnosing",
    "materials_requested",
    "materials_approved",
    "in_progress",
  ];
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
    return rows.map(row => {
      const base = mapSupabaseRowToJob(row);
      const acceptedAt =
        row.accepted_at ? Date.parse(row.accepted_at) : Date.now();
      return {
        ...base,
        status: row.status,
        acceptedAt,
        backendClaimed: true,
        jobNotes: "",
        beforePhoto: null,
        afterPhoto: null,
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
    const rows = await res.json().catch(() => []);
    if (Array.isArray(rows) && rows.length > 0) {
      return { ok: true, mode: "update" };
    }
    // No rows matched — most likely already claimed
    return { ok: false, reason: "already_claimed" };
  } catch (e) {
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

