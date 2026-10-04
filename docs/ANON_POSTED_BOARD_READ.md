# Account required — no signed-out posted board

Release blocker companion to Customer `0020_anon_job_read_lockdown.sql`.

## Policy

Haven Pro requires an account. There is no signed-out marketplace and no anonymous job read.

## Change

`fetchPostedJobsFromSupabase`:

- **Signed out / no session** — returns `[]` and does **not** call the jobs API.
- **Signed in** — `POST /rest/v1/rpc/jobs_posted_within_radius` with the user access token. The database returns only posted jobs inside the saved operating radius. The client does not download every posted job.

No `posted_jobs_public` view. No anon SELECT path.

Signed-out UI is account creation / sign-in / legal-support links only (Load Demo Pro removed from the welcome gate).

## Founder paste

Paste Customer migration **0020** (`revoke select on public.jobs from anon`) before relying on the database lockdown. The Pro client already fails closed for signed-out reads.

Lifecycle, pricing, 20/80, and signed-in Auth Slice 6 reads are unchanged.
