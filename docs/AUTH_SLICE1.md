# Haven Pro — Auth slice 1 (session + role)

Slice 1 adds a Supabase Auth session for Pros. It does not change job lifecycle calls.

Slice 2 (`docs/AUTH_SLICE2.md`) is what binds a signed-in session to claim and later Pro job writes. The write-identity notes below describe slice 1 as it shipped.

## What this slice does

- Loads `@supabase/supabase-js` from the CDN (same no-bundler style as React).
- Welcome and Settings sign up, sign in, and sign out through Supabase Auth. Since Phase 1B A1 the Pro build ships the public Supabase client config (`HAVEN_SUPABASE_PUBLIC_CONFIG` in `backend_adapter.js`); the old `haven_supabase_url` / `haven_supabase_anon_key` localStorage keys are no longer read. See `docs/PHASE1B_A1_BACKEND_CONNECT.md`.
- Sign-up sends user metadata `role: "pro"` so the shared profile trigger can insert a `profiles` row with role `pro`.
- The session is persisted by the Auth client (refresh + restore on reload). The access token is kept in memory for a later slice.
- ~~Local demo account creation still works when those keys are absent.~~ Retired in Phase 1B A1: there is no local/demo account. If Haven can't be reached the app shows an error with Retry.

## Anonymous-mode flag (removed)

The `haven_prototype_anon_mode` localStorage flag never chose the job writer and was removed in Phase 1B A1. Signed-out job writes stop and never send `DEMO_PRO_ID`.

## Supabase setup (Customer project)

Pro does not ship SQL. Apply this on the shared Supabase project before expecting a profile row:

1. Customer migration **0016** — `profiles` keyed by `auth.uid()`, role `customer` or `pro`, trigger that reads signup metadata `role`.
2. Email Auth enabled.
3. Auth redirect URL allowed:

`https://bluspots.github.io/haven-pro/`

Email confirmation links use that URL (`emailRedirectTo`). Password sign-in does not need a redirect. Add any extra local origin to the allow list only if you want confirmation links to return there.

## Out of scope

Ownership RLS and fail-closed lifecycle changes were later slices. Slice 4 now stops a signed-out claim instead of writing as the demo pro.
