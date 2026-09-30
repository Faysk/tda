-- #1123: first-class multi-campaign registry foundation.
-- Additive only: preserve the technical campaign slug used by RBAC and existing
-- consumers, add a separate public route identity/lifecycle, seed the approved
-- second campaign identity, and harden known campaign-qualified relationships.
--
-- This migration is prepared and tested in disposable PostgreSQL first. It must
-- not be applied to a connected Production project outside the normal reviewed
-- migration/release gate.

begin;

alter table public.campaigns
  add column if not exists lifecycle text,
  add column if not exists visibility text,
  add column if not exists public_slug text;

update public.campaigns
set
  lifecycle = coalesce(lifecycle, 'active'),
  visibility = coalesce(visibility, 'private'),
  public_slug = coalesce(public_slug, slug);

alter table public.campaigns
  alter column lifecycle set default 'active',
  alter column lifecycle set not null,
  alter column visibility set default 'private',
  alter column visibility set not null,
  alter column public_slug set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'campaigns_lifecycle_check'
      and conrelid = 'public.campaigns'::regclass
  ) then
    alter table public.campaigns
      add constraint campaigns_lifecycle_check
      check (lifecycle in ('active', 'archived'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'campaigns_visibility_check'
      and conrelid = 'public.campaigns'::regclass
  ) then
    alter table public.campaigns
      add constraint campaigns_visibility_check
      check (visibility in ('private', 'public'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'campaigns_slug_format_check'
      and conrelid = 'public.campaigns'::regclass
  ) then
    alter table public.campaigns
      add constraint campaigns_slug_format_check
      check (slug ~ '^[a-z0-9][a-z0-9-]{0,95}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'campaigns_public_slug_format_check'
      and conrelid = 'public.campaigns'::regclass
  ) then
    alter table public.campaigns
      add constraint campaigns_public_slug_format_check
      check (public_slug ~ '^[a-z0-9][a-z0-9-]{0,95}$');
  end if;
end $$;

create unique index if not exists campaigns_public_slug_unique
  on public.campaigns(public_slug);

create table if not exists public.campaign_public_slug_aliases (
  alias text primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  constraint campaign_public_slug_aliases_format_check
    check (alias ~ '^[a-z0-9][a-z0-9-]{0,95}$')
);

alter table public.campaign_public_slug_aliases enable row level security;
revoke all on table public.campaign_public_slug_aliases from public;
revoke all on table public.campaign_public_slug_aliases from anon;
revoke all on table public.campaign_public_slug_aliases from authenticated;
grant select, insert, update, delete on table public.campaign_public_slug_aliases to service_role;

create or replace function public.guard_campaign_route_identity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then
    raise exception 'campaign technical slug is immutable; use public_slug for route/presentation changes';
  end if;

  if exists (
    select 1
    from public.campaigns c
    where c.id <> new.id
      and (c.slug = new.public_slug or c.public_slug = new.slug)
  ) then
    raise exception 'campaign route identity collides with another campaign';
  end if;

  if exists (
    select 1
    from public.campaign_public_slug_aliases a
    where a.campaign_id <> new.id
      and (a.alias = new.slug or a.alias = new.public_slug)
  ) then
    raise exception 'campaign route identity collides with a historical public slug';
  end if;

  return new;
end;
$$;

drop trigger if exists campaigns_route_identity_guard on public.campaigns;
create trigger campaigns_route_identity_guard
before insert or update of slug, public_slug on public.campaigns
for each row
execute function public.guard_campaign_route_identity();

revoke all on function public.guard_campaign_route_identity() from public;
revoke execute on function public.guard_campaign_route_identity() from anon;
revoke execute on function public.guard_campaign_route_identity() from authenticated;
grant execute on function public.guard_campaign_route_identity() to service_role;

create or replace function public.preserve_campaign_public_slug_alias()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.public_slug is distinct from old.public_slug then
    delete from public.campaign_public_slug_aliases
    where campaign_id = new.id
      and alias = new.public_slug;

    insert into public.campaign_public_slug_aliases(alias, campaign_id)
    values (old.public_slug, old.id)
    on conflict (alias) do update
      set campaign_id = excluded.campaign_id
      where public.campaign_public_slug_aliases.campaign_id = excluded.campaign_id;
  end if;

  return new;
end;
$$;

drop trigger if exists campaigns_public_slug_history on public.campaigns;
create trigger campaigns_public_slug_history
after update of public_slug on public.campaigns
for each row
when (old.public_slug is distinct from new.public_slug)
execute function public.preserve_campaign_public_slug_alias();

revoke all on function public.preserve_campaign_public_slug_alias() from public;
revoke execute on function public.preserve_campaign_public_slug_alias() from anon;
revoke execute on function public.preserve_campaign_public_slug_alias() from authenticated;
grant execute on function public.preserve_campaign_public_slug_alias() to service_role;

comment on column public.campaigns.slug is
  'Stable technical campaign identity used by compatibility/RBAC scopes. Do not rename in place; use public_slug for public route/presentation identity.';
comment on column public.campaigns.public_slug is
  'Public route identity. May change; previous values are preserved in campaign_public_slug_aliases.';
comment on column public.campaigns.lifecycle is
  'Operational lifecycle: active campaigns accept current work; archived campaigns remain addressable historically.';
comment on column public.campaigns.visibility is
  'Directory/public projection eligibility. private campaigns must not be enumerated by public surfaces.';
comment on table public.campaign_public_slug_aliases is
  'Historical public route aliases only. Authorization continues to use campaigns.slug / UUID, never an alias.';

-- Preserve the legacy technical identity and RBAC scope while assigning the
-- approved human/public presentation identity.
do $$
declare
  v_campaign_id uuid;
begin
  select id into v_campaign_id
  from public.campaigns
  where slug = 'yuhara-main';

  if not found then
    raise exception 'legacy campaign yuhara-main is required before multi-campaign registry rollout';
  end if;

  update public.campaigns
  set
    name = 'Crônicas da Mesa',
    public_slug = 'cronicas-da-mesa',
    lifecycle = 'active',
    visibility = 'public'
  where id = v_campaign_id;
end $$;

-- Second approved campaign identity only. No session, entity, canon entry,
-- membership or grant is inferred from the standalone D lore.
do $$
declare
  v_expected_id constant uuid := 'd0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001';
  v_existing_id uuid;
begin
  select id into v_existing_id
  from public.campaigns
  where slug = 'antes-que-seja-tarde';

  if found and v_existing_id <> v_expected_id then
    raise exception 'campaign antes-que-seja-tarde already exists with an unexpected identity';
  end if;

  if not found then
    insert into public.campaigns(
      id,
      name,
      slug,
      public_slug,
      description,
      lifecycle,
      visibility,
      metadata
    ) values (
      v_expected_id,
      'Antes que seja tarde',
      'antes-que-seja-tarde',
      'antes-que-seja-tarde',
      'Campanha associada editorialmente à lore D. Nenhum conteúdo narrativo é inferido por este vínculo.',
      'active',
      'private',
      jsonb_build_object(
        'standaloneLoreSlug', 'd',
        'registryOrigin', 'campaign-registry-v1'
      )
    );
  end if;
end $$;

-- Source identities are campaign-qualified. Detect incompatible global
-- UNIQUE indexes as well as named constraints before consumers start relying
-- on A/B collisions being valid.
do $
declare
  v_bad_index text;
  v_columns text[];
begin
  for v_bad_index, v_columns in
    select
      index_class.relname,
      (
        select array_agg(attribute.attname order by key_column.ordinality)
        from unnest(index_meta.indkey) with ordinality as key_column(attnum, ordinality)
        join pg_attribute attribute
          on attribute.attrelid = index_meta.indrelid
         and attribute.attnum = key_column.attnum
      )
    from pg_index index_meta
    join pg_class index_class on index_class.oid = index_meta.indexrelid
    where index_meta.indrelid = 'public.sessions'::regclass
      and index_meta.indisunique
  loop
    if v_columns = array['source_session_id']::text[]
       or v_columns = array['source_system', 'source_session_id']::text[] then
      raise exception 'global session source uniqueness % must be reconciled before multi-campaign rollout', v_bad_index;
    end if;
  end loop;
end $;

do $
declare
  v_has_campaign_source_unique boolean;
begin
  select exists (
    select 1
    from pg_index index_meta
    where index_meta.indrelid = 'public.sessions'::regclass
      and index_meta.indisunique
      and (
        select array_agg(attribute.attname order by key_column.ordinality)
        from unnest(index_meta.indkey) with ordinality as key_column(attnum, ordinality)
        join pg_attribute attribute
          on attribute.attrelid = index_meta.indrelid
         and attribute.attnum = key_column.attnum
      ) = array['campaign_id', 'source_system', 'source_session_id']::text[]
  ) into v_has_campaign_source_unique;

  if not v_has_campaign_source_unique then
    create unique index sessions_campaign_source_identity_unique
      on public.sessions(campaign_id, source_system, source_session_id)
      where source_system is not null and source_session_id is not null;
  end if;
end $;

create unique index if not exists entities_campaign_id_id_unique
  on public.entities(campaign_id, id);

do $$
begin
  if to_regclass('public.profile_characters') is not null
     and not exists (
       select 1 from pg_constraint
       where conname = 'profile_characters_campaign_entity_fkey'
         and conrelid = 'public.profile_characters'::regclass
     ) then
    alter table public.profile_characters
      add constraint profile_characters_campaign_entity_fkey
      foreign key (campaign_id, entity_id)
      references public.entities(campaign_id, id)
      on delete restrict
      not valid;

    alter table public.profile_characters
      validate constraint profile_characters_campaign_entity_fkey;
  end if;
end $$;

do $$
begin
  if to_regclass('public.canon_entries') is not null
     and not exists (
       select 1 from pg_constraint
       where conname = 'canon_entries_campaign_entity_fkey'
         and conrelid = 'public.canon_entries'::regclass
     ) then
    alter table public.canon_entries
      add constraint canon_entries_campaign_entity_fkey
      foreign key (campaign_id, entity_id)
      references public.entities(campaign_id, id)
      on delete set null (entity_id)
      not valid;

    alter table public.canon_entries
      validate constraint canon_entries_campaign_entity_fkey;
  end if;
end $$;

create or replace function public.enforce_participant_character_campaign()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_session_campaign uuid;
  v_entity_campaign uuid;
begin
  if new.character_entity_id is null then
    return new;
  end if;

  select s.campaign_id into v_session_campaign
  from public.sessions s
  where s.id = new.session_id;

  select e.campaign_id into v_entity_campaign
  from public.entities e
  where e.id = new.character_entity_id;

  if v_session_campaign is null
     or v_entity_campaign is null
     or v_session_campaign <> v_entity_campaign then
    raise exception 'participant character entity must belong to the session campaign';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_participant_character_campaign() from public;
revoke execute on function public.enforce_participant_character_campaign() from anon;
revoke execute on function public.enforce_participant_character_campaign() from authenticated;
grant execute on function public.enforce_participant_character_campaign() to service_role;

do $$
begin
  if to_regclass('public.participants') is not null then
    if exists (
      select 1
      from public.participants p
      join public.sessions s on s.id = p.session_id
      join public.entities e on e.id = p.character_entity_id
      where p.character_entity_id is not null
        and s.campaign_id <> e.campaign_id
    ) then
      raise exception 'existing participant character link crosses campaign boundary';
    end if;

    drop trigger if exists participants_character_campaign_guard on public.participants;
    create trigger participants_character_campaign_guard
    before insert or update of session_id, character_entity_id on public.participants
    for each row
    execute function public.enforce_participant_character_campaign();
  end if;
end $$;

commit;
