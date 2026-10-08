-- Haven shared backend — QA tester gate (Phase 1B A2)
-- Number: 0024 (next after 0023_marketplace_radius.sql).
-- Pro has no migrations folder. This is the one paste for both apps.
--
-- Paste this whole file in the Supabase SQL editor as the database owner,
-- after 0021 (haven-pro docs/0021_pro_profile_source_of_truth.sql), 0022, and
-- 0023. Do not apply it from the app, from CI, or from an agent.
-- Safe to re-run.
--
-- What it does
--   1. profiles.is_qa_tester boolean not null default false. Founder-set only.
--   2. Nobody can set it through the API: no column grant to anon or
--      authenticated, and a trigger rejects any change (or an insert with true)
--      unless the caller is the database owner / SQL editor or service_role.
--   3. public.is_qa_tester(): SECURITY DEFINER, returns true only when the
--      signed-in caller's own row is flagged. Anon cannot execute it.
--   4. Server-side guard for the provider results the Pro Dev Testing panels
--      fake (identity, background check, payout, tax). They live in
--      profiles.pro_workspace (0021), which a Pro may update on their own row.
--      A non-tester may keep a status unchanged or move it only to the states
--      the real, non-QA flows set (start / submit / retry). Only a tester,
--      service_role, or the SQL editor can write a provider result
--      (verified, clear, enabled, failed, needs_review, ...) or turn
--      payoutAccount.payoutsEnabled on.
--
-- What each QA control wrote before this file (inventory)
--   Pro Dev Testing "simulate provider webhook" panels (Persona, Checkr,
--   Stripe Connect, Stripe Connect tax reporting) change local state that the
--   Pro autosave PATCHes into profiles.pro_workspace:
--     identityVerification.status, backgroundCheck.status,
--     payoutAccount.status / payoutsEnabled, taxProfile.status.
--     -> guarded below.
--   Pro "credential source" panel: credentials are not in pro_workspace
--     (local only). Hidden in the app; nothing to guard.
--   Pro "account state" panel (Reset to Fresh Pro, Load Demo Pro, Jump to
--     Marketplace Ready): sets the local account source, which turns the
--     profile autosave off (haven-pro #41). Local only. Hidden in the app.
--     If it ever saved, the four statuses above are still guarded.
--   Customer DEMO PRO CONTROLS, Simulate different location, simulated pro
--     replies, Reset Prototype Data: local state / localStorage only. No
--     backend writes. Hidden in the app; the DEMO PRO CONTROLS no longer
--     advance a backend-linked job at all.
--
-- Does not change: RLS ownership policies (0016, 0017, ...), the job status
-- ladder or lifecycle policies, pricing, materials, claims, the radius
-- functions and triggers from 0023 (jobs_posted_within_radius,
-- haven_caller_within_radius, pro_claim_job, jobs_enforce_claim_radius), or
-- any job row. Does not insert, reset, or recreate any profile. Profile edits
-- (names, city, categories, radius, operating point, onboarding progress,
-- contact fields) are unaffected.

-- ── 1. Flag ───────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists is_qa_tester boolean not null default false;

comment on column public.profiles.is_qa_tester is
  'Founder-set QA tester flag. Shows QA controls in the apps and allows QA-only writes. Set only from the SQL editor or with service_role.';

-- ── 2. No API path can set it ─────────────────────────────────────────────
-- authenticated only ever had column-level UPDATE grants (0016, 0021, 0023)
-- and no INSERT. These revokes keep is_qa_tester out of every API grant even
-- if a later grant is broadened by mistake. (Revoking a privilege that was
-- never granted is a no-op warning, not an error.)
revoke insert (is_qa_tester), update (is_qa_tester) on table public.profiles from public;
revoke insert (is_qa_tester), update (is_qa_tester) on table public.profiles from anon;
revoke insert (is_qa_tester), update (is_qa_tester) on table public.profiles from authenticated;

-- Callers that may change QA-only data: the SQL editor / database owner and
-- service_role. PostgREST runs client requests as anon or authenticated.
-- SECURITY INVOKER on purpose so current_user is the real caller role.
create or replace function public.haven_qa_privileged_caller()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select current_user not in ('anon', 'authenticated');
$$;

revoke all on function public.haven_qa_privileged_caller() from public;
grant execute on function public.haven_qa_privileged_caller() to anon, authenticated;

-- Normalized provider status inside pro_workspace. Missing / blank -> not_started.
create or replace function public.haven_qa_ws_status(ws jsonb, section text)
returns text
language sql
immutable
set search_path = public
as $$
  select coalesce(
    nullif(lower(btrim(coalesce(
      case when jsonb_typeof(ws -> section) = 'object' then ws -> section ->> 'status' end,
      ''
    ))), ''),
    'not_started'
  );
$$;

revoke all on function public.haven_qa_ws_status(jsonb, text) from public;
grant execute on function public.haven_qa_ws_status(jsonb, text) to anon, authenticated;

-- Status values the real (non-QA) Pro flows set themselves:
--   identity: start (session_created), submit (pending), retry (not_started)
--   background: start (consent_required), authorize (invited -> pending)
--   payout: Set Up Payouts (pending)
--   tax: submit (pending)
-- Anything else is a provider result and is QA-only until real webhooks
-- (service_role) exist.
create or replace function public.haven_qa_self_settable_status(section text, status text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case section
    when 'identityVerification' then status in ('not_started', 'session_created', 'pending')
    when 'backgroundCheck'      then status in ('not_started', 'consent_required', 'invited', 'pending')
    when 'payoutAccount'        then status in ('not_started', 'pending')
    when 'taxProfile'           then status in ('not_started', 'pending')
    else false
  end;
$$;

revoke all on function public.haven_qa_self_settable_status(text, text) from public;
grant execute on function public.haven_qa_self_settable_status(text, text) to anon, authenticated;

create or replace function public.profiles_guard_qa_fields()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  old_ws jsonb;
  new_ws jsonb;
  section text;
  old_status text;
  new_status text;
  old_enabled boolean;
  new_enabled boolean;
  row_is_tester boolean;
begin
  if public.haven_qa_privileged_caller() then
    return new;
  end if;

  -- (a) The flag itself.
  if tg_op = 'INSERT' then
    if coalesce(new.is_qa_tester, false) then
      raise exception 'is_qa_tester is founder-set only'
        using errcode = '42501';
    end if;
  elsif new.is_qa_tester is distinct from old.is_qa_tester then
    raise exception 'is_qa_tester is founder-set only'
      using errcode = '42501';
  end if;

  -- (b) QA-only provider results in pro_workspace.
  if tg_op = 'UPDATE' then
    row_is_tester := coalesce(old.is_qa_tester, false);
    old_ws := old.pro_workspace;
  else
    row_is_tester := false;
    old_ws := null;
  end if;
  if row_is_tester then
    return new;
  end if;
  new_ws := new.pro_workspace;
  if tg_op = 'UPDATE' and new_ws is not distinct from old_ws then
    return new;
  end if;

  foreach section in array array['identityVerification', 'backgroundCheck', 'payoutAccount', 'taxProfile'] loop
    old_status := public.haven_qa_ws_status(old_ws, section);
    new_status := public.haven_qa_ws_status(new_ws, section);
    if new_status is distinct from old_status
       and not public.haven_qa_self_settable_status(section, new_status) then
      raise exception 'QA tester only: % status % is a provider result', section, new_status
        using errcode = '42501';
    end if;
  end loop;

  old_enabled := coalesce(
    case when jsonb_typeof(old_ws -> 'payoutAccount' -> 'payoutsEnabled') = 'boolean'
      then (old_ws -> 'payoutAccount' ->> 'payoutsEnabled')::boolean end,
    false);
  new_enabled := coalesce(
    case when jsonb_typeof(new_ws -> 'payoutAccount' -> 'payoutsEnabled') = 'boolean'
      then (new_ws -> 'payoutAccount' ->> 'payoutsEnabled')::boolean end,
    false);
  if new_enabled and not old_enabled then
    raise exception 'QA tester only: payoutAccount.payoutsEnabled is a provider result'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.profiles_guard_qa_fields() from public;
grant execute on function public.profiles_guard_qa_fields() to anon, authenticated;

drop trigger if exists profiles_guard_qa_fields on public.profiles;
create trigger profiles_guard_qa_fields
  before insert or update on public.profiles
  for each row
  execute procedure public.profiles_guard_qa_fields();

-- ── 3. Client check: is the signed-in caller a tester? ────────────────────
-- Own row only. No session -> false. Never reads another user's flag.
create or replace function public.is_qa_tester()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_qa_tester from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_qa_tester() from public;
revoke all on function public.is_qa_tester() from anon;
grant execute on function public.is_qa_tester() to authenticated;

-- ── Founder step (run once, by hand, after this file) ─────────────────────
-- Flags the two existing QA accounts. Does not create or change anything
-- else on those rows (updated_at is bumped by the existing trigger).
--
-- update public.profiles
--    set is_qa_tester = true
--  where id in (
--    'b79c42e9-6e09-4335-9035-a11ecf37d032',  -- Customer QA
--    '971c6625-afa7-455b-9b8b-672c8dc562d9'   -- Pro QA
--  );

-- ── Verify ────────────────────────────────────────────────────────────────
-- Column: boolean, not null, default false.
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_qa_tester';
--
-- No API role can write the flag (all four should be false).
-- select has_column_privilege('authenticated', 'public.profiles', 'is_qa_tester', 'UPDATE') as auth_update,
--        has_column_privilege('authenticated', 'public.profiles', 'is_qa_tester', 'INSERT') as auth_insert,
--        has_column_privilege('anon', 'public.profiles', 'is_qa_tester', 'UPDATE') as anon_update,
--        has_column_privilege('anon', 'public.profiles', 'is_qa_tester', 'INSERT') as anon_insert;
--
-- Guard trigger is installed.
-- select tgname, tgenabled from pg_trigger
--  where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_guard_qa_fields';
--
-- is_qa_tester(): authenticated true, anon false.
-- select has_function_privilege('authenticated', 'public.is_qa_tester()', 'EXECUTE') as auth_exec,
--        has_function_privilege('anon', 'public.is_qa_tester()', 'EXECUTE') as anon_exec;
--
-- Exactly the two QA accounts are flagged (after the founder step).
-- select id, role, email, is_qa_tester from public.profiles where is_qa_tester order by role;
--
-- Non-testers that already hold a provider result (left over from earlier
-- Dev Testing use). This file does not change them; the founder decides.
-- select id, role,
--        public.haven_qa_ws_status(pro_workspace, 'identityVerification') as identity,
--        public.haven_qa_ws_status(pro_workspace, 'backgroundCheck') as background,
--        public.haven_qa_ws_status(pro_workspace, 'payoutAccount') as payout,
--        public.haven_qa_ws_status(pro_workspace, 'taxProfile') as tax
--   from public.profiles
--  where not is_qa_tester
--    and (   not public.haven_qa_self_settable_status('identityVerification', public.haven_qa_ws_status(pro_workspace, 'identityVerification'))
--         or not public.haven_qa_self_settable_status('backgroundCheck', public.haven_qa_ws_status(pro_workspace, 'backgroundCheck'))
--         or not public.haven_qa_self_settable_status('payoutAccount', public.haven_qa_ws_status(pro_workspace, 'payoutAccount'))
--         or not public.haven_qa_self_settable_status('taxProfile', public.haven_qa_ws_status(pro_workspace, 'taxProfile')));
--
-- Optional negative check in a transaction that is rolled back (replace
-- <non-tester uuid> with a real non-tester profile id). Each statement should
-- fail with "is_qa_tester is founder-set only" / "QA tester only".
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<non-tester uuid>","role":"authenticated"}', true);
--   update public.profiles set is_qa_tester = true where id = '<non-tester uuid>';
-- rollback;
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<non-tester uuid>","role":"authenticated"}', true);
--   update public.profiles
--      set pro_workspace = jsonb_set(coalesce(pro_workspace, '{}'::jsonb), '{identityVerification}', '{"status":"verified"}'::jsonb)
--    where id = '<non-tester uuid>';
-- rollback;

-- ── Rollback (only if this file must be undone) ───────────────────────────
-- Removes the gate. The apps then hide QA controls for everyone, because
-- the is_qa_tester RPC call fails and fails closed.
-- drop trigger if exists profiles_guard_qa_fields on public.profiles;
-- drop function if exists public.profiles_guard_qa_fields();
-- drop function if exists public.is_qa_tester();
-- drop function if exists public.haven_qa_self_settable_status(text, text);
-- drop function if exists public.haven_qa_ws_status(jsonb, text);
-- drop function if exists public.haven_qa_privileged_caller();
-- alter table public.profiles drop column if exists is_qa_tester;
