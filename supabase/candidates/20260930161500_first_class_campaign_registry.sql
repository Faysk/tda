-- #1123: first-class campaign registry for multi-campaign rollout.
-- Additive only: preserves technical slug identity and existing FKs/content.
-- No remote application is implied by this migration file; rollout remains gated.

begin;

alter table public.campaigns
  add column if not exists lifecycle text not null default 'active',
  add column if not exists visibility text not null default 'private',
  add column if not exists public_slug text,
  add column if not exists archived_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'campaigns_lifecycle_check'
      and conrelid = 'public.campaigns'::regclass
  ) then
    alter table public.campaigns
      add constraint campaigns_lifecycle_check
      check (lifecycle in ('active', 'archived'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'campaigns_visibility_check'
      and conrelid = 'public.campaigns'::regclass
  ) then
    alter table public.campaigns
      add constraint campaigns_visibility_check
      check (visibility in ('public', 'private'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'campaigns_public_slug_format_check'
      and conrelid = 'public.campaigns'::regclass
  ) then
    alter table public.campaigns
      add constraint campaigns_public_slug_format_check
      check (
        public_slug is null
        or public_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'campaigns_archive_state_check'
      and conrelid = 'public.campaigns'::regclass
  ) then
    alter table public.campaigns
      add constraint campaigns_archive_state_check
      check (
        (lifecycle = 'active' and archived_at is null)
        or (lifecycle = 'archived' and archived_at is not null)
      );
  end if;
end
$$;

create table if not exists public.campaign_public_route_aliases (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  route_key text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint campaign_public_route_aliases_route_key_format_check
    check (route_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create unique index if not exists campaigns_public_slug_unique
  on public.campaigns(lower(public_slug))
  where public_slug is not null;

create unique index if not exists campaign_public_route_aliases_route_key_unique
  on public.campaign_public_route_aliases(lower(route_key));

create index if not exists campaign_public_route_aliases_campaign_id_idx
  on public.campaign_public_route_aliases(campaign_id);

alter table public.campaign_public_route_aliases enable row level security;
revoke all on table public.campaign_public_route_aliases from public;
revoke all on table public.campaign_public_route_aliases from anon;
revoke all on table public.campaign_public_route_aliases from authenticated;
grant select, insert, update, delete
  on table public.campaign_public_route_aliases
  to service_role;

create or replace function public.guard_campaign_public_route_key()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $
declare
  v_route_key text;
begin
  if new.public_slug is null then
    new.public_slug := new.slug;
  end if;

  v_route_key := lower(new.public_slug);
  perform pg_advisory_xact_lock(
    hashtextextended('campaign-public-route:' || v_route_key, 0)
  );

  if exists (
    select 1
    from public.campaign_public_route_aliases alias_row
    where lower(alias_row.route_key) = v_route_key
  ) then
    raise exception using
      errcode = '23505',
      message = 'campaign public route key conflicts with a historical alias';
  end if;

  return new;
end;
$$;

drop trigger if exists campaigns_public_route_key_guard on public.campaigns;
create trigger campaigns_public_route_key_guard
before insert or update of slug, public_slug
on public.campaigns
for each row
execute function public.guard_campaign_public_route_key();

create or replace function public.guard_campaign_public_route_alias()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $
declare
  v_route_key text := lower(new.route_key);
begin
  perform pg_advisory_xact_lock(
    hashtextextended('campaign-public-route:' || v_route_key, 0)
  );

  if exists (
    select 1
    from public.campaigns campaign
    where lower(campaign.public_slug) = v_route_key
  ) then
    raise exception using
      errcode = '23505',
      message = 'campaign route alias conflicts with a canonical public route key';
  end if;

  return new;
end;
$$;

drop trigger if exists campaign_public_route_alias_guard
  on public.campaign_public_route_aliases;
create trigger campaign_public_route_alias_guard
before insert or update of route_key
on public.campaign_public_route_aliases
for each row
execute function public.guard_campaign_public_route_alias();

revoke all on function public.guard_campaign_public_route_key() from public;
revoke all on function public.guard_campaign_public_route_key() from anon;
revoke all on function public.guard_campaign_public_route_key() from authenticated;
revoke all on function public.guard_campaign_public_route_alias() from public;
revoke all on function public.guard_campaign_public_route_alias() from anon;
revoke all on function public.guard_campaign_public_route_alias() from authenticated;

-- Refuse rollout if the current physical schema still makes source/entity
-- identities globally unique. #1123 is expand-only and must not silently drop
-- unknown legacy constraints.
do $
begin
  if exists (
    select 1
    from pg_index index_row
    join pg_class table_row on table_row.oid = index_row.indrelid
    join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = 'public'
      and table_row.relname = 'sessions'
      and index_row.indisunique
      and exists (
        select 1
        from pg_attribute attribute_row
        where attribute_row.attrelid = table_row.oid
          and attribute_row.attname = 'source_session_id'
          and attribute_row.attnum = any(index_row.indkey)
      )
      and not exists (
        select 1
        from pg_attribute attribute_row
        where attribute_row.attrelid = table_row.oid
          and attribute_row.attname = 'campaign_id'
          and attribute_row.attnum = any(index_row.indkey)
      )
  ) then
    raise exception
      'sessions has a global unique source_session_id index; refusing #1123 migration';
  end if;

  if exists (
    select 1
    from pg_index index_row
    join pg_class table_row on table_row.oid = index_row.indrelid
    join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = 'public'
      and table_row.relname = 'entities'
      and index_row.indisunique
      and exists (
        select 1
        from pg_attribute attribute_row
        where attribute_row.attrelid = table_row.oid
          and attribute_row.attname = 'slug'
          and attribute_row.attnum = any(index_row.indkey)
      )
      and not exists (
        select 1
        from pg_attribute attribute_row
        where attribute_row.attrelid = table_row.oid
          and attribute_row.attname = 'campaign_id'
          and attribute_row.attnum = any(index_row.indkey)
      )
  ) then
    raise exception
      'entities has a global unique slug index; refusing #1123 migration';
  end if;
end
$;

-- The legacy campaign must already exist. Failing here is safer than creating a
-- replacement UUID and silently detaching all existing campaign-owned rows.
do $$
declare
  v_legacy_count integer;
begin
  select count(*)::integer
  into v_legacy_count
  from public.campaigns
  where slug = 'yuhara-main';

  if v_legacy_count <> 1 then
    raise exception
      'expected exactly one legacy yuhara-main campaign before #1123 migration, found %',
      v_legacy_count;
  end if;
end
$$;

update public.campaigns
set
  name = 'Crônicas da Mesa',
  public_slug = 'cronicas-da-mesa',
  lifecycle = 'active',
  visibility = 'public',
  archived_at = null
where slug = 'yuhara-main';

insert into public.campaign_public_route_aliases (
  campaign_id,
  route_key,
  metadata
)
select
  campaign.id,
  'yuhara-main',
  jsonb_build_object('kind', 'technical-slug-compatibility')
from public.campaigns campaign
where campaign.slug = 'yuhara-main'
  and not exists (
    select 1
    from public.campaign_public_route_aliases alias_row
    where lower(alias_row.route_key) = 'yuhara-main'
  );

-- Identity-only bootstrap for the approved second campaign. No sessions,
-- entities, canon, memberships or lore links are inferred here.
insert into public.campaigns (
  id,
  name,
  slug,
  description,
  metadata,
  lifecycle,
  visibility,
  public_slug
)
select
  gen_random_uuid(),
  'Antes que seja tarde',
  'antes-que-seja-tarde',
  null,
  jsonb_build_object('content_state', 'identity_only'),
  'active',
  'private',
  'antes-que-seja-tarde'
where not exists (
  select 1
  from public.campaigns
  where slug = 'antes-que-seja-tarde'
);

do $$
begin
  if not exists (
    select 1
    from public.campaigns
    where slug = 'antes-que-seja-tarde'
      and name = 'Antes que seja tarde'
      and public_slug = 'antes-que-seja-tarde'
      and lifecycle = 'active'
      and visibility = 'private'
  ) then
    raise exception
      'existing antes-que-seja-tarde campaign conflicts with the approved #1123 identity';
  end if;
end
$$;

-- Backward-compatible creation: legacy callers that only supply technical slug
-- still receive a stable public route key via the BEFORE INSERT trigger.
alter table public.campaigns
  alter column public_slug set not null;

-- profile_characters already carries campaign_id and entity_id. Make the
-- campaign relationship physical so a profile-character row cannot bind a PC
-- entity owned by another campaign.
create unique index if not exists entities_campaign_id_id_unique
  on public.entities(campaign_id, id);

do $$
declare
  v_mismatch_count integer;
begin
  select count(*)::integer
  into v_mismatch_count
  from public.profile_characters profile_character
  join public.entities entity
    on entity.id = profile_character.entity_id
  where profile_character.entity_id is not null
    and profile_character.campaign_id is distinct from entity.campaign_id;

  if v_mismatch_count <> 0 then
    raise exception
      'profile_characters contains % cross-campaign entity bindings; refusing #1123 migration',
      v_mismatch_count;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profile_characters_campaign_entity_fkey'
      and conrelid = 'public.profile_characters'::regclass
  ) then
    alter table public.profile_characters
      add constraint profile_characters_campaign_entity_fkey
      foreign key (campaign_id, entity_id)
      references public.entities(campaign_id, id)
      on delete restrict;
  end if;
end
$$;

comment on column public.campaigns.lifecycle is
  'Operational lifecycle. active accepts normal authorized work; archived preserves identity/data and is read-only by application contract except explicit administration.';
comment on column public.campaigns.visibility is
  'Discovery/audience classification. Independent from lifecycle; public is eligible for public projection, private is not enumerable publicly.';
comment on column public.campaigns.public_slug is
  'Canonical public route key. Separate from immutable relational UUID and technical compatibility slug.';
comment on column public.campaigns.archived_at is
  'Timestamp paired with lifecycle=archived. Null for active campaigns.';
comment on table public.campaign_public_route_aliases is
  'Historical public route keys for campaign redirects. Aliases never replace campaign UUID or technical slug as relational/RBAC identity.';
comment on function public.guard_campaign_public_route_key() is
  'Trigger-only integrity guard. SECURITY DEFINER with fixed search_path so RLS cannot hide alias collisions; direct execution is revoked.';
comment on function public.guard_campaign_public_route_alias() is
  'Trigger-only integrity guard. SECURITY DEFINER with fixed search_path so RLS cannot hide canonical collisions; direct execution is revoked.';

commit;
