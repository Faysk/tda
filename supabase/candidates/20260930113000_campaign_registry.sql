-- Candidate only. This file is NOT a deployable migration.
-- #1123: establish campaigns as the explicit operational registry for N campaigns.
--
-- Identity contract:
--   * campaigns.id is the stable relational authority;
--   * campaigns.slug remains the technical/compatibility identity (RBAC, media, legacy consumers);
--   * public_slug is the independently evolvable public route identity;
--   * name is the human-facing editorial name.
--
-- Compatibility contract:
--   * yuhara-main is intentionally NOT renamed in-place;
--   * existing foreign keys continue to target the same campaign UUID;
--   * no narrative/session/entity data is synthesized for the second campaign;
--   * this candidate is replay-safe for disposable PostgreSQL rehearsal.

alter table public.campaigns
  add column if not exists lifecycle_status text;

alter table public.campaigns
  add column if not exists public_slug text;

update public.campaigns
set lifecycle_status = 'active'
where lifecycle_status is null;

update public.campaigns
set public_slug = slug
where public_slug is null;

alter table public.campaigns
  alter column lifecycle_status set default 'active',
  alter column lifecycle_status set not null,
  alter column public_slug set not null;

do $campaign_registry_constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.campaigns'::regclass
      and conname = 'campaigns_lifecycle_status_check'
  ) then
    alter table public.campaigns
      add constraint campaigns_lifecycle_status_check
      check (lifecycle_status in ('active', 'archived'));
  end if;
end;
$campaign_registry_constraints$;

create unique index if not exists campaigns_public_slug_key
  on public.campaigns(public_slug);

-- Preserve the technical compatibility identity while changing only presentation.
update public.campaigns
set name = 'Crônicas da Mesa',
    public_slug = coalesce(nullif(public_slug, ''), 'yuhara-main')
where slug = 'yuhara-main';

-- Registry-only bootstrap for the approved second campaign. No sessions, entities,
-- memberships, publications or other narrative canon are inferred or created here.
insert into public.campaigns (
  name,
  slug,
  description,
  metadata,
  lifecycle_status,
  public_slug
)
select
  'Antes que seja tarde',
  'antes-que-seja-tarde',
  null,
  jsonb_build_object(
    'registryBootstrap', '#1123',
    'narrativeSeeded', false
  ),
  'active',
  'antes-que-seja-tarde'
where not exists (
  select 1
  from public.campaigns
  where slug = 'antes-que-seja-tarde'
);

-- Replay/read-back invariants. Fail closed if an existing row collides with the
-- approved identities in an incompatible state.
do $campaign_registry_readback$
declare
  v_legacy_id uuid;
  v_second_id uuid;
begin
  select id into v_legacy_id
  from public.campaigns
  where slug = 'yuhara-main';

  if v_legacy_id is null then
    raise exception 'CAMPAIGN_REGISTRY_LEGACY_YUHARA_MAIN_MISSING';
  end if;

  if not exists (
    select 1
    from public.campaigns
    where id = v_legacy_id
      and name = 'Crônicas da Mesa'
      and lifecycle_status = 'active'
      and public_slug is not null
  ) then
    raise exception 'CAMPAIGN_REGISTRY_LEGACY_READBACK_INVALID';
  end if;

  select id into v_second_id
  from public.campaigns
  where slug = 'antes-que-seja-tarde';

  if v_second_id is null or v_second_id = v_legacy_id then
    raise exception 'CAMPAIGN_REGISTRY_SECOND_CAMPAIGN_INVALID';
  end if;

  if not exists (
    select 1
    from public.campaigns
    where id = v_second_id
      and name = 'Antes que seja tarde'
      and lifecycle_status = 'active'
      and public_slug = 'antes-que-seja-tarde'
  ) then
    raise exception 'CAMPAIGN_REGISTRY_SECOND_READBACK_INVALID';
  end if;
end;
$campaign_registry_readback$;
