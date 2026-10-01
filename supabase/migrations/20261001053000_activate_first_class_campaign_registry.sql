-- Deliberate multi-campaign rollout; validated candidate promoted on 2026-10-01.
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
    where conname = 'campaigns_slug_format_check'
      and conrelid = 'public.campaigns'::regclass
  ) then
    alter table public.campaigns
      add constraint campaigns_slug_format_check
      check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
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
grant select, insert, update
  on table public.campaign_public_route_aliases
  to service_role;

create or replace function public.guard_campaign_public_route_key()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_route_key text;
begin
  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then
    raise exception using
      errcode = '23514',
      message = 'campaign technical slug is immutable after creation';
  end if;

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

create or replace function public.record_campaign_public_route_alias()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.public_slug is null
     or old.public_slug is not distinct from new.public_slug then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('campaign-public-route:' || lower(old.public_slug), 0)
  );

  insert into public.campaign_public_route_aliases (
    campaign_id,
    route_key,
    metadata
  ) values (
    new.id,
    old.public_slug,
    jsonb_build_object('kind', 'public-route-rename')
  )
  on conflict (lower(route_key)) do nothing;

  if not exists (
    select 1
    from public.campaign_public_route_aliases alias_row
    where lower(alias_row.route_key) = lower(old.public_slug)
      and alias_row.campaign_id = new.id
  ) then
    raise exception using
      errcode = '23505',
      message = 'previous campaign public route key belongs to another campaign';
  end if;

  return new;
end;
$$;

drop trigger if exists campaign_public_route_alias_recorder on public.campaigns;
create trigger campaign_public_route_alias_recorder
after update of public_slug
on public.campaigns
for each row
when (old.public_slug is distinct from new.public_slug)
execute function public.record_campaign_public_route_alias();

create or replace function public.guard_campaign_public_route_alias()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_route_key text := lower(new.route_key);
begin
  if tg_op = 'UPDATE'
     and (
       new.campaign_id is distinct from old.campaign_id
       or new.route_key is distinct from old.route_key
     ) then
    raise exception using
      errcode = '23514',
      message = 'campaign public route alias identity is immutable';
  end if;

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
before insert or update of route_key, campaign_id
on public.campaign_public_route_aliases
for each row
execute function public.guard_campaign_public_route_alias();

revoke all on function public.guard_campaign_public_route_key() from public;
revoke all on function public.guard_campaign_public_route_key() from anon;
revoke all on function public.guard_campaign_public_route_key() from authenticated;
revoke all on function public.record_campaign_public_route_alias() from public;
revoke all on function public.record_campaign_public_route_alias() from anon;
revoke all on function public.record_campaign_public_route_alias() from authenticated;
revoke all on function public.guard_campaign_public_route_alias() from public;
revoke all on function public.guard_campaign_public_route_alias() from anon;
revoke all on function public.guard_campaign_public_route_alias() from authenticated;

-- Refuse rollout if the current physical schema still makes source/entity
-- identities globally unique. #1123 is expand-only and must not silently drop
-- unknown legacy constraints.
do $$
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
$$;

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

do $$
begin
  if not exists (
    select 1
    from public.campaign_public_route_aliases alias_row
    join public.campaigns campaign on campaign.id = alias_row.campaign_id
    where lower(alias_row.route_key) = 'yuhara-main'
      and campaign.slug = 'yuhara-main'
  ) then
    raise exception
      'yuhara-main public alias does not resolve to the legacy campaign';
  end if;
end
$$;

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
  'd0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001'::uuid,
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
    where id = 'd0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001'::uuid
      and slug = 'antes-que-seja-tarde'
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

-- Any additional pre-existing technical campaigns discovered at rollout keep
-- their technical slug as the initial public route key unless explicitly
-- curated in a later migration.
update public.campaigns
set public_slug = slug
where public_slug is null;

-- Backward-compatible creation: legacy callers that only supply technical slug
-- still receive a stable public route key via the BEFORE INSERT trigger.
alter table public.campaigns
  alter column public_slug set not null;

-- profile_characters already carries campaign_id and entity_id. Make the
-- campaign relationship physical so a profile-character row cannot bind a PC
-- entity owned by another campaign.
do $$
declare
  v_has_campaign_entity_identity boolean;
begin
  select exists (
    select 1
    from pg_index index_row
    where index_row.indrelid = 'public.entities'::regclass
      and index_row.indisunique
      and (
        select array_agg(attribute_row.attname::text order by key_column.ordinality)
        from unnest(index_row.indkey) with ordinality as key_column(attnum, ordinality)
        join pg_attribute attribute_row
          on attribute_row.attrelid = index_row.indrelid
         and attribute_row.attnum = key_column.attnum
      ) = array['campaign_id', 'id']::text[]
  ) into v_has_campaign_entity_identity;

  if not v_has_campaign_entity_identity then
    create unique index entities_campaign_id_id_unique
      on public.entities(campaign_id, id);
  end if;
end
$$;

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

-- Canon entries with an entity carry campaign ownership explicitly as well.
-- Preserve nullable entity semantics while preventing a valid UUID from a sibling campaign.
do $$
declare
  v_mismatch_count integer;
begin
  if to_regclass('public.canon_entries') is not null then
    select count(*)::integer
    into v_mismatch_count
    from public.canon_entries canon_entry
    join public.entities entity on entity.id = canon_entry.entity_id
    where canon_entry.entity_id is not null
      and canon_entry.campaign_id is distinct from entity.campaign_id;

    if v_mismatch_count <> 0 then
      raise exception
        'canon_entries contains % cross-campaign entity bindings; refusing #1123 migration',
        v_mismatch_count;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'canon_entries_campaign_entity_fkey'
        and conrelid = 'public.canon_entries'::regclass
    ) then
      alter table public.canon_entries
        add constraint canon_entries_campaign_entity_fkey
        foreign key (campaign_id, entity_id)
        references public.entities(campaign_id, id)
        on delete set null (entity_id);
    end if;
  end if;
end
$$;

-- participants inherit campaign from sessions. Prevent a participant from
-- linking a character entity owned by a different campaign.
do $$
declare
  v_mismatch_count integer;
begin
  select count(*)::integer
  into v_mismatch_count
  from public.participants participant
  join public.sessions session on session.id = participant.session_id
  join public.entities entity on entity.id = participant.character_entity_id
  where participant.character_entity_id is not null
    and session.campaign_id is distinct from entity.campaign_id;

  if v_mismatch_count <> 0 then
    raise exception
      'participants contains % cross-campaign character bindings; refusing #1123 migration',
      v_mismatch_count;
  end if;
end
$$;

create or replace function public.guard_participant_character_campaign()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session_campaign_id uuid;
  v_entity_campaign_id uuid;
begin
  if new.character_entity_id is null then
    return new;
  end if;

  select session.campaign_id
  into v_session_campaign_id
  from public.sessions session
  where session.id = new.session_id;

  select entity.campaign_id
  into v_entity_campaign_id
  from public.entities entity
  where entity.id = new.character_entity_id;

  if v_session_campaign_id is not null
     and v_entity_campaign_id is not null
     and v_session_campaign_id is distinct from v_entity_campaign_id then
    raise exception using
      errcode = '23503',
      message = 'participant character entity belongs to another campaign';
  end if;

  return new;
end;
$$;

drop trigger if exists participants_character_campaign_guard on public.participants;
create trigger participants_character_campaign_guard
before insert or update of session_id, character_entity_id
on public.participants
for each row
execute function public.guard_participant_character_campaign();

revoke all on function public.guard_participant_character_campaign() from public;
revoke all on function public.guard_participant_character_campaign() from anon;
revoke all on function public.guard_participant_character_campaign() from authenticated;

create or replace function public.guard_session_campaign_move_participants()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.campaign_id is distinct from old.campaign_id
     and exists (
       select 1
       from public.participants participant
       join public.entities entity on entity.id = participant.character_entity_id
       where participant.session_id = old.id
         and participant.character_entity_id is not null
         and entity.campaign_id is distinct from new.campaign_id
     ) then
    raise exception using
      errcode = '23503',
      message = 'session campaign move would create cross-campaign participant links';
  end if;
  return new;
end;
$$;

create or replace function public.guard_entity_campaign_move_participants()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.campaign_id is distinct from old.campaign_id
     and exists (
       select 1
       from public.participants participant
       join public.sessions session_row on session_row.id = participant.session_id
       where participant.character_entity_id = old.id
         and session_row.campaign_id is distinct from new.campaign_id
     ) then
    raise exception using
      errcode = '23503',
      message = 'entity campaign move would create cross-campaign participant links';
  end if;
  return new;
end;
$$;

drop trigger if exists sessions_participant_campaign_move_guard on public.sessions;
create trigger sessions_participant_campaign_move_guard
before update of campaign_id on public.sessions
for each row
execute function public.guard_session_campaign_move_participants();

drop trigger if exists entities_participant_campaign_move_guard on public.entities;
create trigger entities_participant_campaign_move_guard
before update of campaign_id on public.entities
for each row
execute function public.guard_entity_campaign_move_participants();

revoke all on function public.guard_session_campaign_move_participants() from public;
revoke all on function public.guard_session_campaign_move_participants() from anon;
revoke all on function public.guard_session_campaign_move_participants() from authenticated;
revoke all on function public.guard_entity_campaign_move_participants() from public;
revoke all on function public.guard_entity_campaign_move_participants() from anon;
revoke all on function public.guard_entity_campaign_move_participants() from authenticated;

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
  'Trigger-only integrity guard. Keeps technical slug immutable, defaults public_slug for legacy inserts and prevents canonical route collisions. SECURITY DEFINER with fixed search_path; direct execution is revoked.';
comment on function public.record_campaign_public_route_alias() is
  'Trigger-only rename recorder. Persists the previous canonical public route key as a historical alias in the same transaction. SECURITY DEFINER with fixed search_path; direct execution is revoked.';
comment on function public.guard_campaign_public_route_alias() is
  'Trigger-only integrity guard. SECURITY DEFINER with fixed search_path so RLS cannot hide canonical collisions; direct execution is revoked.';
comment on function public.guard_participant_character_campaign() is
  'Trigger-only logical FK guard ensuring participant character entities belong to the same campaign inherited from the participant session. SECURITY DEFINER with fixed search_path; direct execution is revoked.';
comment on function public.guard_session_campaign_move_participants() is
  'Prevents raw session campaign moves from invalidating participant-to-character campaign ownership. Session moves remain an explicit domain operation.';
comment on function public.guard_entity_campaign_move_participants() is
  'Prevents raw entity campaign moves from invalidating participant-to-character campaign ownership.';

commit;
