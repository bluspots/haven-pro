# Operating radius

Mapbox is the only geocoder, behind `havenGeocodeAddress` in `geocode.js`.

The Pro app calls it only when the operating city is created or changed and stored coordinates are missing. It does not call Mapbox when the job board loads, when the list refreshes, or when a job is claimed.

`profiles.home_city` is a display label. The authority is `profiles.operating_lat` and `profiles.operating_lng`. The radius is the existing `pro_workspace.travelRadius` choice: 5, 10, 15, 25, or 50. There is no second radius.

Marketplace visibility and claim are enforced in the shared database. The signed-in board calls `jobs_posted_within_radius`. Claim uses `pro_claim_job`, and a direct posted-to-en_route update is blocked by `jobs_enforce_claim_radius` unless the same check passes. Missing coordinates or a missing radius fail closed.

## SQL the founder pastes

One file, in the Customer repo, not here (this repo must not grow a `supabase/` directory):

`bluspots/bluspots.github.io` `supabase/migrations/0023_marketplace_radius.sql`

Paste that whole file in the Supabase SQL editor after 0021 and 0022. It was not applied from this app.

Until it is pasted, the board call fails closed (no rows) instead of reading every posted job.

The Mapbox public pk token ships in `geocode.js`, so GitHub Pages geocodes without a browser setting. No secret sk token is used. A failed lookup still fails closed.
