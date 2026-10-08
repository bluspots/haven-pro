# Haven Pro — Phase 1B A1: connect automatically, no demo fallback

Founder decision (2026-10-08): the Pro app connects to the existing Supabase project on a fresh
browser using public client config only, with no dev-facing connection controls. On failure it
shows a clear error with Retry and never falls back to demo mode or creates a local account.

## Where the config lives

`backend_adapter.js` → `HAVEN_SUPABASE_PUBLIC_CONFIG` (`url` + `anon`). `getSupabaseConfig()`
returns it. It is concatenated into `prototype-pro.html` / `index.html` by `build-pro.sh`.

- `anon` is the project's **anon** (public) API key — a JWT whose `role` claim is `anon`.
  It is meant to ship in browser code; Row Level Security protects data.
- Never put a `service_role` key or any `sb_secret_` key here.
  `tools/a1_backend_connect_check.js` decodes the key and fails unless it is `anon` for this
  project (or an `sb_publishable_` key).
- The old `haven_supabase_url` / `haven_supabase_anon_key` localStorage keys are not read
  (no override; nothing in the UI sets them).

## Connect flow

On boot (and on Retry) the app calls `havenConnectBackend()`:

1. Config present.
2. Supabase Auth client (CDN UMD `window.supabase`) loaded and created.
3. `GET {url}/auth/v1/health` with the anon `apikey` answers 2xx (10 s timeout).

Then it restores the Auth session. Until this succeeds nothing but the connection screen renders.

| State | Screen |
|---|---|
| connecting (first boot) | "HAVEN PRO" + "Connecting to Haven…" |
| error | **Can't connect to Haven** — "We couldn't reach Haven. Check your internet connection, then tap Retry." + **Retry** |
| retrying | same error copy, button shows "Retrying…" (disabled) |
| ready | normal app (signed out → Welcome: Create Account / Sign In / Sign in with email + Help & Support · Terms · Privacy) |

The error screen is also shown when:

- Sign-in or sign-up can't reach Supabase Auth (network / `AuthRetryableFetchError`), or the Auth
  client is missing at that moment. Wrong password etc. still shows the inline sign-in notice.
- `accountStatus` is `signed_in` but there is no real session (formerly the "Not connected" card).
  Retry re-runs the connect; if there is still no session the app resets to the signed-out Welcome.

## Removed

- Local Create Account branch (set `accountSource = "local"` / `signed_in` with no session).
- "Not connected" account card copy.
- localStorage-only Supabase config.
- SIM fallbacks when no config exists (claim / arrive / work status / complete now fail closed with
  `not_configured`; job reads return `[]`). Unreachable with the built-in config.

## Not changed

Auth ownership / RLS, job lifecycle, pricing, payout, location/radius rules
(`jobs_posted_within_radius`, Mapbox only on operating-location save, missing coordinates fail
closed), and the Dev Testing panels (A2 will gate them server-side). No SQL.
