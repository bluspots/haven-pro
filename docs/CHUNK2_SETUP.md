# Haven Pro — CHUNK 2 Setup (Read from Supabase)

This change lets Haven Pro read canonical jobs from the same Supabase project that the Customer app writes to. No writes are performed from Pro — read-only feed to prove create → store → see. Accept/assignment remains simulated locally in Pro.

## Configure (same keys as Customer)

In your browser's DevTools console (or via any localStorage editor), set these keys:

```js
localStorage.setItem('haven_supabase_url', '<YOUR_SUPABASE_URL>');       // e.g. https://xyzcompany.supabase.co
localStorage.setItem('haven_supabase_anon_key', '<YOUR_SUPABASE_ANON>'); // anon public key
```

Notes:
- These are the exact same keys used by the Customer app so a single browser profile can demo both sides.
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

