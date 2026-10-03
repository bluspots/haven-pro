Slice 4 stops the signed-out demo write. The rest of this page is what Slice 2 shipped.

# Haven Pro — Auth slice 2 (session-bound job writes)

Slice 1 stores a Supabase Auth session and still writes jobs as `DEMO_PRO_ID` with the anon key as Bearer. Slice 2 changes the signed-in path only.

## Signed in

When `getSession()` returns a user id and access token (or that pair is already in memory), every Pro job write this app already sends uses that identity:

| Call | Identity |
|---|---|
| Claim (`pro_claim_job`, then the posted-job PATCH) | `pro_id` = auth uid. Bearer = access token |
| Arrive | filter `pro_id` = auth uid. Bearer = access token |
| Diagnosing / `in_progress` (including the receipt → `in_progress` write) | same |
| Materials request | same |
| Complete | same |
| Decline terminals (`inspection_completed`, `materials_declined`) | same |

`apikey` stays the anon key. Supabase still requires it. `Authorization` is `Bearer <access token>`, not the anon key.

The same actor is used for the assigned-job reads that follow those writes (active-job rehydrate, status re-read, materials poll). The public job-board read (`status=posted` and `pro_id` is null) stays on the anon key so a signed-in pro can still see claimable jobs.

A session never falls through to `DEMO_PRO_ID`. If a session is present but the uid or access token is missing, the write returns `session_identity_missing` and does not call the demo path.

`haven_prototype_anon_mode` does not override a real session.

## Signed out (explicit demo)

If there is no session, claim and the later writes keep `DEMO_PRO_ID` and `Authorization: Bearer <anon key>`. Turning anonymous mode off does not remove that fallback and does not lock anonymous writes. `DEMO_PRO_ID` stays in the source.

Local demo account creation still uses the Verify Your Contact Info step. A Supabase session skips that demo tap-to-confirm wall and continues at Create Your Profile. Email sign-in already did this.

## Customer migration required

This repo does not ship SQL. No ownership RLS is added here, and anonymous writes are not removed.

Signed-in claim and later writes send the user JWT, so PostgREST runs them as `authenticated`. Today those writes are granted to `anon`. Until the Customer app ships a migration that lets `authenticated` perform the same job writes `anon` can (claim RPC and/or PATCH, arrive, diagnosing, `in_progress`, materials, complete, and the decline terminal patches), a signed-in Pro claim or later write can fail with 401/403 or a 0-row update. The request is still the auth uid and the user access token. Do not treat that failure as a reason to fall back to `DEMO_PRO_ID`.

## Unchanged

Job lifecycle statuses, economics, materials, tips, inspection fees, and the 20/80 labor split are unchanged. Demo identity constants are not retired. A session is not required to claim.
