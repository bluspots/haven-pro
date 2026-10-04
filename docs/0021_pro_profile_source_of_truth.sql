-- Haven shared backend — Pro profile source of truth
-- Number: 0021 (next after Customer supabase/migrations/0020_anon_job_read_lockdown.sql).
-- Pro has no migrations folder; this file lives in docs so the Pro verify
-- check that forbids a supabase/ directory still passes.
--
-- Paste this whole file in the Supabase SQL editor as the database owner.
-- Do not apply it from the app, from CI, or from an agent.
-- Safe to re-run.
--
-- Does not change jobs, location, radius matching, pricing, lifecycle,
-- or the account-required gate. Does not update any job row.
-- Does not insert or reset a profile. Own-row RLS from 0016 stays.
-- authenticated may update only these columns on their own row.

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists home_city text,
  add column if not exists work_categories jsonb,
  add column if not exists pro_workspace jsonb;

comment on column public.profiles.first_name is
  'Pro given name. Source of truth for the signed-in Pro app.';
comment on column public.profiles.last_name is
  'Pro family name. Source of truth for the signed-in Pro app.';
comment on column public.profiles.home_city is
  'Pro operating city label. Not used for radius matching.';
comment on column public.profiles.work_categories is
  'JSON array of work category names the Pro already persists.';
comment on column public.profiles.pro_workspace is
  'Other persisted Pro profile fields (verification, payout, tax, onboarding, about, phone, radius). Local storage is a cache and must not win over this object when it is saved.';

-- 0016 granted update (display_name, email) only. Add the new columns.
-- display_name stays, and the app mirrors "first last" into it.
grant update (
  display_name,
  email,
  first_name,
  last_name,
  home_city,
  work_categories,
  pro_workspace
) on table public.profiles to authenticated;
