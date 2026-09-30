-- Assertions for #1123 first-class campaign registry.

do $$
declare
  v_legacy_id uuid;
  v_second_id uuid;
  v_count integer;
begin
  select id into strict v_legacy_id
  from public.campaigns
  where slug = 'yuhara-main';

  select id into strict v_second_id
  from public.campaigns
  where slug = 'antes-que-seja-tarde';

  if v_legacy_id <> '10000000-0000-4000-8000-000000000001'::uuid then
    raise exception 'legacy campaign UUID changed';
  end if;

  if not exists (
    select 1
    from public.campaigns
    where id = v_legacy_id
      and name = 'Crônicas da Mesa'
      and slug = 'yuhara-main'
      and public_slug = 'cronicas-da-mesa'
      and lifecycle = 'active'
      and visibility = 'public'
      and archived_at is null
  ) then
    raise exception 'legacy campaign backfill is incomplete';
  end if;

  if not exists (
    select 1
    from public.campaigns
    where id = v_second_id
      and name = 'Antes que seja tarde'
      and slug = 'antes-que-seja-tarde'
      and public_slug = 'antes-que-seja-tarde'
      and lifecycle = 'active'
      and visibility = 'private'
      and metadata->>'content_state' = 'identity_only'
  ) then
    raise exception 'second campaign identity is incomplete';
  end if;

  select count(*)::integer
  into v_count
  from public.sessions
  where campaign_id = v_second_id;
  if v_count <> 0 then
    raise exception 'second campaign received inferred sessions';
  end if;

  select count(*)::integer
  into v_count
  from public.entities
  where campaign_id = v_second_id;
  if v_count <> 0 then
    raise exception 'second campaign received inferred entities';
  end if;

  if not exists (
    select 1
    from public.campaign_public_route_aliases
    where campaign_id = v_legacy_id
      and route_key = 'yuhara-main'
      and metadata->>'kind' = 'technical-slug-compatibility'
  ) then
    raise exception 'legacy technical route alias missing';
  end if;
end
$$;

-- Alias storage is server-only until #1134 defines discovery. Trigger guards
-- are privileged only for integrity and cannot be invoked directly by browser roles.
do $
begin
  if not exists (
    select 1
    from pg_class table_row
    join pg_namespace namespace_row on namespace_row.oid = table_row.relnamespace
    where namespace_row.nspname = 'public'
      and table_row.relname = 'campaign_public_route_aliases'
      and table_row.relrowsecurity = true
  ) then
    raise exception 'campaign route aliases must have RLS enabled';
  end if;

  if has_table_privilege('anon', 'public.campaign_public_route_aliases', 'select')
     or has_table_privilege('authenticated', 'public.campaign_public_route_aliases', 'select')
     or has_table_privilege('anon', 'public.campaign_public_route_aliases', 'insert')
     or has_table_privilege('authenticated', 'public.campaign_public_route_aliases', 'insert') then
    raise exception 'browser roles received direct alias table privileges';
  end if;

  if not has_table_privilege(
    'service_role',
    'public.campaign_public_route_aliases',
    'select,insert,update,delete'
  ) then
    raise exception 'service_role is missing alias table privileges';
  end if;

  if not exists (
    select 1
    from pg_proc procedure_row
    join pg_namespace namespace_row on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'public'
      and procedure_row.proname = 'guard_campaign_public_route_key'
      and procedure_row.prosecdef = true
  ) then
    raise exception 'canonical route guard must be SECURITY DEFINER';
  end if;

  if not exists (
    select 1
    from pg_proc procedure_row
    join pg_namespace namespace_row on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'public'
      and procedure_row.proname = 'guard_campaign_public_route_alias'
      and procedure_row.prosecdef = true
  ) then
    raise exception 'alias route guard must be SECURITY DEFINER';
  end if;

  if has_function_privilege(
      'anon',
      'public.guard_campaign_public_route_key()',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.guard_campaign_public_route_key()',
      'execute'
    )
    or has_function_privilege(
      'anon',
      'public.guard_campaign_public_route_alias()',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.guard_campaign_public_route_alias()',
      'execute'
    ) then
    raise exception 'browser roles can execute route guard functions directly';
  end if;
end
$;

-- Existing external source IDs remain unique within a campaign, not globally.
insert into public.sessions (
  id, campaign_id, title, status, source_system, source_session_id
)
select
  '40000000-0000-4000-8000-000000000001',
  id,
  'A',
  'ready_for_review',
  'local_companion',
  'same-source'
from public.campaigns
where slug = 'yuhara-main';

insert into public.sessions (
  id, campaign_id, title, status, source_system, source_session_id
)
select
  '40000000-0000-4000-8000-000000000002',
  id,
  'B',
  'ready_for_review',
  'local_companion',
  'same-source'
from public.campaigns
where slug = 'antes-que-seja-tarde';

do $$
begin
  begin
    insert into public.sessions (
      id, campaign_id, title, status, source_system, source_session_id
    )
    select
      '40000000-0000-4000-8000-000000000003',
      id,
      'duplicate A',
      'ready_for_review',
      'local_companion',
      'same-source'
    from public.campaigns
    where slug = 'yuhara-main';

    raise exception 'same-campaign duplicate source identity was accepted';
  exception
    when unique_violation then null;
  end;
end
$$;

-- Entity slug may repeat across campaigns, but not inside one campaign.
insert into public.entities (
  id, campaign_id, name, slug, entity_type
)
select
  '20000000-0000-4000-8000-000000000002',
  id,
  'PC B',
  'mesmo-slug',
  'pc'
from public.campaigns
where slug = 'antes-que-seja-tarde';

do $$
begin
  begin
    insert into public.entities (
      id, campaign_id, name, slug, entity_type
    )
    select
      '20000000-0000-4000-8000-000000000003',
      id,
      'Outro PC A',
      'mesmo-slug',
      'pc'
    from public.campaigns
    where slug = 'yuhara-main';

    raise exception 'same-campaign duplicate entity slug was accepted';
  exception
    when unique_violation then null;
  end;
end
$$;

-- The new composite FK rejects a profile-character entity owned by campaign B.
do $$
declare
  v_legacy_id uuid;
  v_second_id uuid;
  v_second_entity_id uuid := '20000000-0000-4000-8000-000000000002';
begin
  select id into strict v_legacy_id
  from public.campaigns where slug = 'yuhara-main';

  select id into strict v_second_id
  from public.campaigns where slug = 'antes-que-seja-tarde';

  begin
    insert into public.profile_characters (
      campaign_id, profile_id, entity_id, character_name
    ) values (
      v_legacy_id,
      '30000000-0000-4000-8000-000000000002',
      v_second_entity_id,
      'cross campaign'
    );

    raise exception 'cross-campaign profile-character binding was accepted';
  exception
    when foreign_key_violation then null;
  end;

  if v_legacy_id = v_second_id then
    raise exception 'campaign UUIDs are not distinct';
  end if;
end
$$;

-- Lifecycle is explicit and archived_at must agree with lifecycle.
do $$
declare
  v_second_id uuid;
begin
  select id into strict v_second_id
  from public.campaigns where slug = 'antes-que-seja-tarde';

  begin
    update public.campaigns
    set lifecycle = 'archived'
    where id = v_second_id;

    raise exception 'archived lifecycle without archived_at was accepted';
  exception
    when check_violation then null;
  end;

  update public.campaigns
  set lifecycle = 'archived',
      archived_at = clock_timestamp()
  where id = v_second_id;

  if not exists (
    select 1 from public.campaigns
    where id = v_second_id
      and lifecycle = 'archived'
      and archived_at is not null
  ) then
    raise exception 'valid archive transition failed';
  end if;

  update public.campaigns
  set lifecycle = 'active',
      archived_at = null
  where id = v_second_id;
end
$$;

-- Canonical public route keys and historical aliases share one collision domain.
do $$
declare
  v_legacy_id uuid;
begin
  select id into strict v_legacy_id
  from public.campaigns where slug = 'yuhara-main';

  begin
    insert into public.campaign_public_route_aliases(campaign_id, route_key)
    values (v_legacy_id, 'antes-que-seja-tarde');

    raise exception 'alias collided with another campaign canonical route key';
  exception
    when unique_violation then null;
  end;

  update public.campaigns
  set public_slug = 'cronicas-da-mesa-renamed'
  where id = v_legacy_id;

  insert into public.campaign_public_route_aliases(
    campaign_id, route_key, metadata
  ) values (
    v_legacy_id,
    'cronicas-da-mesa',
    jsonb_build_object('kind', 'public-route-rename')
  );

  if not exists (
    select 1
    from public.campaigns
    where id = v_legacy_id
      and slug = 'yuhara-main'
      and public_slug = 'cronicas-da-mesa-renamed'
  ) then
    raise exception 'public route rename changed technical slug';
  end if;

  begin
    update public.campaigns
    set public_slug = 'cronicas-da-mesa'
    where id = v_legacy_id;

    raise exception 'canonical route key reused an existing historical alias';
  exception
    when unique_violation then null;
  end;
end
$$;

-- Legacy campaign creation remains compatible: public_slug defaults from slug
-- in the BEFORE INSERT trigger, while lifecycle/visibility use additive defaults.
insert into public.campaigns(id, name, slug)
values (
  '10000000-0000-4000-8000-000000000003',
  'Legacy caller',
  'legacy-caller'
);

do $$
begin
  if not exists (
    select 1
    from public.campaigns
    where id = '10000000-0000-4000-8000-000000000003'::uuid
      and slug = 'legacy-caller'
      and public_slug = 'legacy-caller'
      and lifecycle = 'active'
      and visibility = 'private'
  ) then
    raise exception 'legacy insert compatibility failed';
  end if;
end
$$;

select 'CAMPAIGN_REGISTRY_SQL_OK';
