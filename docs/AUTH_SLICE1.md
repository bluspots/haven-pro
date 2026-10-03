# Haven Pro — Auth slice 1 (session + role)

Slice 1 adds a Supabase Auth session for Pros. It does not change job lifecycle calls.

Slice 2 (`docs/AUTH_SLICE2.md`) is what binds a signed-in session to claim and later Pro job writes. The write-identity notes below describe slice 1 as it shipped.

## What this slice does

- Loads `@supabase/supabase-js` from the CDN (same no-bundler style as React).
- When `haven_supabase_url` and `haven_supabase_anon_key` are set, Welcome and Settings can sign up, sign in, and sign out.
- Sign-up sends user metadata `role: "pro"` so the shared profile trigger can insert a `profiles` row with role `pro`.
- The session is persisted by the Auth client (refresh + restore on reload). The access token is kept in memory for a later slice.
- Local demo account creation still works when those keys are absent. **Sign In** on Welcome still loads the demo pro while anonymous mode is on.

## Anonymous-mode flag

Key: `haven_prototype_anon_mode` (same name as the Customer app).

| Value | Meaning |
|---|---|
| missing, empty, `true`, `1`, `on`, `yes` | **On** (default) |
| `false`, `0`, `off`, `no` | Off |

Default **on**. In slice 1, claim, arrive, materials, and complete kept `Authorization: Bearer <anon key>` and `DEMO_PRO_ID`. Turning the flag off did **not** switch those calls, and a signed-in session was not required for them. Slice 2 used the session when one existed. Slice 4 stops signed-out claim and later writes; the current app does not write as the demo pro. The flag does not choose that identity.

```js
localStorage.setItem("haven_prototype_anon_mode", "true"); // default even if unset
```

## Supabase setup (Customer project)

Pro does not ship SQL. Apply this on the shared Supabase project before expecting a profile row:

1. Customer migration **0016** — `profiles` keyed by `auth.uid()`, role `customer` or `pro`, trigger that reads signup metadata `role`.
2. Email Auth enabled.
3. Auth redirect URL allowed:

`https://bluspots.github.io/haven-pro/`

Email confirmation links use that URL (`emailRedirectTo`). Password sign-in on a machine that already has the Supabase keys does not need a redirect. Add any extra local origin to the allow list only if you want confirmation links to return there.

## Out of scope

Ownership RLS and fail-closed lifecycle changes were later slices. Slice 4 now stops a signed-out claim instead of writing as the demo pro.
