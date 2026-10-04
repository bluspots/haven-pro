# Pro profile + active-job rehydration

The local snapshot below is now a cache only. A saved `public.profiles` row wins. See `docs/0021_pro_profile_source_of_truth.sql` (founder pastes it; the app does not apply it). Until that SQL is pasted, the app still writes `display_name` and keeps the local cache.


Release blocker. Draft only until Quagon reviews.

## Cause

On refresh or reopen, Supabase Auth restored the session, but the Pro app kept blank React state: `onboardingStatus` stayed `not_started`, `homeCity` stayed empty, and categories/radius were empty. `needsOnboarding` then stayed true for a signed-in Pro. Tapping Continue (or a sign-in path that jumps to profile) opened **Create Your Profile** with an empty city even when that Pro already had a real profile and an active job.

Active-job rehydrate also ran once on mount, often before the session finished restoring, so the assigned job could miss the first read.

`public.profiles` only stores role / display_name / email. City, categories, and travel radius are not server columns. This fix does **not** insert or update a profile row.

## Fix

1. Save a **local** workspace snapshot per auth uid (`haven_pro_workspace_v1`) with onboarding status, city, categories, radius, and verification fields the shell already uses.
2. On session restore and email sign-in, apply that snapshot. A completed snapshot skips Create Your Profile.
3. Re-run active-job rehydrate after the auth uid is known. If the server returns any assigned active job for that Pro, mark onboarding completed and show the normal shell (never Create Your Profile for an existing valid Pro).
4. Persist the workspace whenever those fields change for a signed-in auth user.

## Explicitly not changed

Lifecycle, pricing, 20/80 split, materials, tips, inspection fees, categories catalog, marketplace policy, payments, verification rules, SQL, and job rows (including `8661d035`).
