# Haven Pro — CHUNK 2 Setup (Read from Supabase)

This change lets Haven Pro read canonical jobs from the same Supabase project that the Customer app writes to. No writes are performed from Pro — read-only feed to prove create → store → see. Accept/assignment remains simulated locally in Pro.

Source of truth for product/job rules:  
`HAVEN_JOB_CONTRACT.md` (Customer repo) — https://github.com/bluspots/bluspots.github.io/blob/master/HAVEN_JOB_CONTRACT.md  
Technical schema/enforcement: `HAVEN_SHARED_BACKEND_CONTRACT.md` (Customer/shared; link there when available).

## Configure

No setup. Since Phase 1B A1 the Pro build ships the public Supabase client config
(`HAVEN_SUPABASE_PUBLIC_CONFIG` in `backend_adapter.js`: project URL + anon key only).
The `haven_supabase_url` / `haven_supabase_anon_key` localStorage keys described in
earlier versions of this doc are no longer read. See `docs/PHASE1B_A1_BACKEND_CONNECT.md`.

Notes:
- Pro only reads; Customer repo owns migrations and writes.

## What Pro reads

- Endpoint: `GET /rest/v1/jobs?status=eq.posted&order=posted_at.desc`
- Auth headers: `Authorization: Bearer <anon>`, `apikey: <anon>`
- Mapping:
  - `id`: string UUID (backend source of truth)
  - `category`, `title`, `city_label → city`
  - `payout`: `fixed_pro_labor_payout_cents / 100` (rounded dollars)
  - `inspectionFee`: if `inspection_fee_cents > 0`, dollars; otherwise omitted
  - `emergency`, `postedAt` from `posted_at`
  - `lat`/`lng` when present; `distanceMi` intentionally omitted

## Behavior

- When the keys are present: Pro replaces the SIM feed with backend jobs (empty is OK).
- When keys are missing: Pro behaves exactly as today (SIM jobs).
- The Home feed refreshes roughly every 30 seconds while you're on it.

## Build

If you edit the JSX, regenerate the runnable artifact:

```bash
./build-pro.sh
```

Open `prototype-pro.html` directly in your browser.

