# Signed-out posted board → posted_jobs_public

Release blocker companion to Customer `0020_anon_job_read_lockdown.sql`.

## Change

`fetchPostedJobsFromSupabase`:

- **Signed in** — still `GET /rest/v1/jobs?status=eq.posted&pro_id=is.null` with the user access token.
- **Signed out** — `GET /rest/v1/posted_jobs_public` with the anon bearer. Limited columns only. No base-table SELECT.

## Founder paste first

Paste Customer migration **0020** before merging this Pro client. Until then, the signed-out board view does not exist and the read 404s.

Eligible rows stay posted + unclaimed. Lifecycle, pricing, 20/80, and authenticated job reads are unchanged.
