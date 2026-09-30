-- Synthetic-only contract for #1123 campaign registry.
-- Run after supabase/candidates/20260930113000_campaign_registry.sql
-- inside disposable PostgreSQL. Never targets Production.

do $campaign_registry_contract$
declare
  v_legacy_id uuid;
  v_second_id uuid;
  v_probe_id uuid := '11230000-0000-4000-8000-000000000003'::uuid;
  v_probe_session_a uuid := '11230000-0000-4000-8000-000000000011'::uuid;
  v_probe_session_b uuid := '11230000-0000-4000-8000-000000000012'::uuid;
  v_source_id text := 'issue-1123-shared-source-session';
begin
  select id into strict v_legacy_id
  from public.campaigns
  where slug = 'yuhara-main';

  select id into strict v_second_id
  from public.campaigns
  where slug = 'antes-que-seja-tarde';

  if v_legacy_id = v_second_id then
    raise exception 'CAMPAIGN_REGISTRY_IDS_NOT_ISOLATED';
  end if;

  if not exists (
    select 1 from public.campaigns
    where id = v_legacy_id
      and slug = 'yuhara-main'
      and name = 'Crônicas da Mesa'
      and lifecycle_status = 'active'
  ) then
    raise exception 'CAMPAIGN_REGISTRY_LEGACY_IDENTITY_NOT_PRESERVED';
  end if;

  if not exists (
    select 1 from public.campaigns
    where id = v_second_id
      and slug = 'antes-que-seja-tarde'
      and name = 'Antes que seja tarde'
      and lifecycle_status = 'active'
  ) then
    raise exception 'CAMPAIGN_REGISTRY_SECOND_IDENTITY_INVALID';
  end if;

  -- Lifecycle is first-class and queryable.
  insert into public.campaigns(id, name, slug, public_slug, lifecycle_status, metadata)
  values (
    v_probe_id,
    'Issue 1123 Archived Probe',
    'issue-1123-archived-probe',
    'issue-1123-archived-probe',
    'archived',
    '{"synthetic":true}'::jsonb
  );

  if not exists (
    select 1 from public.campaigns
    where id = v_probe_id and lifecycle_status = 'archived'
  ) then
    raise exception 'CAMPAIGN_REGISTRY_ARCHIVED_NOT_QUERYABLE';
  end if;

  begin
    update public.campaigns
    set lifecycle_status = 'deleted'
    where id = v_probe_id;
    raise exception 'CAMPAIGN_REGISTRY_INVALID_LIFECYCLE_ACCEPTED';
  exception
    when check_violation then null;
  end;

  -- public_slug may evolve independently; the technical slug must remain stable.
  update public.campaigns
  set public_slug = 'cronicas-da-mesa'
  where id = v_legacy_id;

  if not exists (
    select 1 from public.campaigns
    where id = v_legacy_id
      and slug = 'yuhara-main'
      and public_slug = 'cronicas-da-mesa'
  ) then
    raise exception 'CAMPAIGN_REGISTRY_PUBLIC_ALIAS_BROKE_TECHNICAL_SLUG';
  end if;

  -- Restore the candidate read-back state so replay can be tested deterministically.
  update public.campaigns
  set public_slug = 'yuhara-main'
  where id = v_legacy_id;

  -- Same source_session_id must be legal in different campaigns. The concrete
  -- session insert is intentionally minimal and will expose any hidden global
  -- unique that still treats source identity as cross-campaign.
  insert into public.sessions(
    id, campaign_id, title, slug, session_date, status, source_system, source_session_id
  ) values (
    v_probe_session_a, v_legacy_id, 'Issue 1123 A', 'issue-1123-a', current_date,
    'planned', 'issue_1123_test', v_source_id
  );

  insert into public.sessions(
    id, campaign_id, title, slug, session_date, status, source_system, source_session_id
  ) values (
    v_probe_session_b, v_second_id, 'Issue 1123 B', 'issue-1123-b', current_date,
    'planned', 'issue_1123_test', v_source_id
  );

  if (
    select count(*) from public.sessions
    where source_system = 'issue_1123_test'
      and source_session_id = v_source_id
      and campaign_id in (v_legacy_id, v_second_id)
  ) <> 2 then
    raise exception 'CAMPAIGN_REGISTRY_SOURCE_SESSION_NOT_CAMPAIGN_QUALIFIED';
  end if;

  -- Entity slugs are intentionally campaign-qualified by the existing contract.
  -- We assert the index/constraint shape here without inventing narrative rows.
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'entities'
      and indexdef ilike '%campaign_id%slug%'
  ) then
    raise exception 'CAMPAIGN_REGISTRY_ENTITY_SLUG_NOT_CAMPAIGN_QUALIFIED';
  end if;

  -- Cleanup synthetic rows; the two approved registry rows remain for candidate read-back/replay.
  delete from public.sessions where id in (v_probe_session_a, v_probe_session_b);
  delete from public.campaigns where id = v_probe_id;
end;
$campaign_registry_contract$;
