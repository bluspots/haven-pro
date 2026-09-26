# Haven Pro — CHUNK 3 (Founder-approved scope)

This slice wires Pro Accept against the shared Supabase backend and adds a standard materials-decline ending distinct from the diagnosis path.

Source of truth for product/job rules:  
`HAVEN_JOB_CONTRACT.md` (Customer repo) — https://github.com/bluspots/bluspots.github.io/blob/master/HAVEN_JOB_CONTRACT.md  
Technical schema/enforcement: `HAVEN_SHARED_BACKEND_CONTRACT.md` (Customer/shared; link there when available).

## Supabase-backed Accept

- Demo `pro_id` used when claiming: `22222222-2222-4222-8222-222222222222`.
- The Pro App reads `haven_supabase_url` and `haven_supabase_anon_key` from `localStorage` (set by the Customer demo).
- When both keys are present AND a job id is a UUID (backend job), `Accept` PATCHes:
  - `PATCH {url}/rest/v1/jobs?id=eq.{JOB_ID}&status=eq.posted&pro_id=is.null`
  - Body: `{ status: "en_route", pro_id: DEMO_PRO_ID, accepted_at: <ISO timestamp> }`
  - Headers: `apikey`, `Authorization: Bearer <anon>`, `Content-Type: application/json`, `Prefer: return=minimal`
- Success (HTTP 2xx, body may be empty/[] due to RLS): the app performs a normal local accept (removes from available, adds to active with `status: "en_route"`) and marks the job `backendClaimed: true`.
- Failure: non-2xx or network error show a toast. A 409 conflict (one-active-job constraint) shows a clear dedicated toast.
- If Supabase is not configured or the id is not a UUID (SIM), Accept behaves exactly as before (local-only).

## Materials decline (simulated customer response)

On a simulated decline while `status: "materials_requested"`:

```js
if (job.requiresDiagnosis || DIAGNOSIS_CATEGORIES.has(job.category)) {
  // Diagnosis path — unchanged
  fee = job.inspectionFee || INSPECTION_VISIT_FEE;
  finalize as "inspection_completed" with inspectionFee=fee
  toast: "Inspection Completed — Inspection Visit $fee"
} else {
  // Standard path — NEW
  convenienceFee = 30; // CONVENIENCE_FEE
  finalize as "materials_declined" with convenienceFee=30 (inspectionFee=0)
  toast/label: "Materials declined — job could not be completed" (+ mention $30 convenience fee)
}
```

- Terminal labels and earnings:
  - `inspection_completed` → gross = `inspectionFee`
  - `materials_declined` → gross = `$30` convenience fee
  - `complete` → gross = labor payout (unchanged)
- History and statement UI show “Materials declined — job could not be completed” and the “Convenience Fee” line item where applicable.

## Backend sync on decline

After a job was successfully claimed via backend (`backendClaimed: true`), the app best-effort PATCHes terminal status + fees back to Supabase on decline:

- Endpoint: `PATCH {url}/rest/v1/jobs?id=eq.{JOB_ID}&pro_id=eq.{DEMO_PRO_ID}`
- Body:
  - For `inspection_completed`: `{ status: "inspection_completed", inspection_fee_cents: fee_in_cents }`
  - For `materials_declined`: `{ status: "materials_declined", convenience_fee_cents: 3000 }`
- Failures are soft: logged via `console.warn`; local history is still recorded.

## Other notes

- Labor 20/80, Haven $0 on materials/tips/Inspection Visits, and the $30 convenience fee are unchanged/implemented per rules.
- One active job per Pro remains enforced in the UI and respected on backend (unique index).
- Mapping from backend rows sets `requiresDiagnosis: !!row.requires_diagnosis` (SIM jobs still default via `DIAGNOSIS_CATEGORIES`).
- No secrets added, no pricing UI rewrite, no unrelated features.

## Build

Regenerate the self-contained prototype:

```bash
./build-pro.sh
```

This script inlines `home_services_pro_app.jsx` into `prototype-pro.html`/`index.html` using Babel-safe string ops (e.g., uses `endsWith`/`slice` rather than regexes like `/\\/+$/`).

## Migrations

SQL schema changes (e.g., `convenience_fee_cents`) are owned by the Customer repo (migrations `0004+`). This Pro slice assumes those columns exist when present and fails soft if they do not.

