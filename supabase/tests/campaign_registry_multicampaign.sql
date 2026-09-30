-- #1123 synthetic contract assertions. Runs only in disposable PostgreSQL.

do $$
declare
  v_legacy_id uuid;
begin
  select id into v_legacy_id
  from public.campaigns
  where slug = 'yuhara-main';

  if v_legacy_id <> '11111111-1111-4111-8111-111111111111'::uuid then
    raise exception 'legacy campaign UUID changed';
  end if;

  if not exists (
    select 1
    from public.campaigns
    where id = v_legacy_id
      and name = 'Crônicas da Mesa'
      and public_slug = 'cronicas-da-mesa'
      and lifecycle = 'active'
      and visibility = 'public'
  ) then
    raise exception 'legacy campaign presentation/lifecycle backfill is incomplete';
  end if;

  if not exists (
    select 1
    from public.campaigns
    where id = 'd0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001'::uuid
      and slug = 'antes-que-seja-tarde'
      and public_slug = 'antes-que-seja-tarde'
      and name = 'Antes que seja tarde'
      and lifecycle = 'active'
      and visibility = 'private'
      and metadata->>'standaloneLoreSlug' = 'd'
  ) then
    raise exception 'approved second campaign identity is missing';
  end if;

  if (
    select count(*)
    from public.campaigns
  ) <> 2 then
    raise exception 'fixture must contain exactly two campaigns after migration';
  end if;

  if (
    select count(*)
    from public.sessions
    where campaign_id = 'd0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001'::uuid
  ) <> 0 or (
    select count(*)
    from public.entities
    where campaign_id = 'd0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001'::uuid
  ) <> 0 or (
    select count(*)
    from public.canon_entries
    where campaign_id = 'd0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001'::uuid
  ) <> 0 then
    raise exception 'second campaign seed inferred narrative content';
  end if;

  if not exists (
    select 1
    from public.role_assignments
    where scope_type = 'campaign'
      and scope_id = 'yuhara-main'
      and status = 'active'
  ) then
    raise exception 'legacy RBAC campaign scope was not preserved';
  end if;
end $$;

-- Same external source identity is legal in different campaigns.
insert into public.sessions(
  id, campaign_id, title, status, source_system, source_session_id
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'd0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001',
  'Second campaign source collision',
  'planned',
  'local_companion',
  'shared-source'
);

-- Same entity slug is legal in different campaigns.
insert into public.entities(
  id, campaign_id, name, slug, entity_type
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  'd0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001',
  'Shared entity slug in B',
  'shared-entity',
  'npc'
);

-- Campaign-qualified FK: profile_character cannot point at an entity from A while claiming B.
do $$
begin
  begin
    insert into public.profile_characters(
      campaign_id, profile_id, entity_id, character_name
    ) values (
      'd0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      'Cross campaign forbidden'
    );
    raise exception 'cross-campaign profile_character unexpectedly succeeded';
  exception
    when foreign_key_violation then null;
  end;
end $$;

-- Participant derives campaign from session and must reject an entity from another campaign.
do $$
begin
  begin
    insert into public.participants(
      session_id, profile_id, character_entity_id, character_name
    ) values (
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      'Cross campaign forbidden'
    );
    raise exception 'cross-campaign participant unexpectedly succeeded';
  exception
    when raise_exception then
      if sqlerrm <> 'participant character entity must belong to the session campaign' then
        raise;
      end if;
  end;
end $$;

-- Canon entry must bind its campaign and entity as one identity.
do $$
begin
  begin
    insert into public.canon_entries(
      campaign_id, entity_id, title, content
    ) values (
      'd0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001',
      '44444444-4444-4444-8444-444444444444',
      'Cross campaign forbidden',
      'Synthetic only.'
    );
    raise exception 'cross-campaign canon entry unexpectedly succeeded';
  exception
    when foreign_key_violation then null;
  end;
end $$;

-- Moving either side of an existing participant link must also fail closed;
-- otherwise a once-valid row could become cross-campaign after the insert.
do $$
begin
  begin
    update public.sessions
    set campaign_id = 'd0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001'
    where id = '22222222-2222-4222-8222-222222222222';
    raise exception 'session campaign move unexpectedly broke participant isolation';
  exception
    when raise_exception then
      if sqlerrm <> 'session campaign move would create cross-campaign participant links' then
        raise;
      end if;
  end;

  begin
    update public.entities
    set campaign_id = 'd0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001'
    where id = '44444444-4444-4444-8444-444444444444';
    raise exception 'entity campaign move unexpectedly broke participant isolation';
  exception
    when raise_exception then
      if sqlerrm <> 'entity campaign move would create cross-campaign participant links' then
        raise;
      end if;
  end;
end $$;

-- Lifecycle is first-class and invalid states fail closed.
update public.campaigns
set lifecycle = 'archived'
where slug = 'antes-que-seja-tarde';

do $$
begin
  if (
    select lifecycle
    from public.campaigns
    where slug = 'antes-que-seja-tarde'
  ) <> 'archived' then
    raise exception 'archived lifecycle is not readable';
  end if;

  begin
    update public.campaigns
    set lifecycle = 'deleted'
    where slug = 'antes-que-seja-tarde';
    raise exception 'invalid lifecycle unexpectedly succeeded';
  exception
    when check_violation then null;
  end;
end $$;

update public.campaigns
set lifecycle = 'active'
where slug = 'antes-que-seja-tarde';

-- Technical slug is a compatibility/RBAC identity and cannot be renamed in-place.
do $$
begin
  begin
    update public.campaigns
    set slug = 'renamed-technical-slug'
    where slug = 'yuhara-main';
    raise exception 'technical slug rename unexpectedly succeeded';
  exception
    when raise_exception then
      if sqlerrm <> 'campaign technical slug is immutable; use public_slug for route/presentation changes' then
        raise;
      end if;
  end;
end $$;

-- Public route rename preserves the previous route alias.
update public.campaigns
set public_slug = 'cronicas-da-mesa-renamed'
where slug = 'yuhara-main';

do $$
begin
  if not exists (
    select 1
    from public.campaign_public_slug_aliases
    where alias = 'cronicas-da-mesa'
      and campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
  ) then
    raise exception 'previous public slug was not preserved as an alias';
  end if;
end $$;

-- Replay back to the original public slug is safe and keeps the newer alias.
update public.campaigns
set public_slug = 'cronicas-da-mesa'
where slug = 'yuhara-main';

do $$
begin
  if exists (
    select 1
    from public.campaign_public_slug_aliases
    where alias = 'cronicas-da-mesa'
  ) then
    raise exception 'current public slug must not also remain a historical alias';
  end if;

  if not exists (
    select 1
    from public.campaign_public_slug_aliases
    where alias = 'cronicas-da-mesa-renamed'
      and campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
  ) then
    raise exception 'rename replay did not preserve the newer historical alias';
  end if;
end $$;

-- Another campaign cannot steal either a current technical/public route or a historical alias.
do $$
begin
  begin
    update public.campaigns
    set public_slug = 'cronicas-da-mesa-renamed'
    where slug = 'antes-que-seja-tarde';
    raise exception 'historical alias collision unexpectedly succeeded';
  exception
    when raise_exception then
      if sqlerrm <> 'campaign route identity collides with a historical public slug' then
        raise;
      end if;
  end;
end $$;

-- Direct alias writes cannot shadow a canonical route, even for service-side callers.
do $$
begin
  begin
    insert into public.campaign_public_slug_aliases(alias, campaign_id)
    values (
      'cronicas-da-mesa',
      'd0b64c86-3c83-4e9e-9cd8-b8ebd4d1d001'::uuid
    );
    raise exception 'direct alias collision unexpectedly succeeded';
  exception
    when raise_exception then
      if sqlerrm <> 'campaign public alias collides with a canonical route identity' then
        raise;
      end if;
  end;
end $$;

-- Trigger-only integrity functions run with a fixed definer context so RLS
-- cannot hide conflicting rows, but no browser/service caller invokes them directly.
do $$
declare
  v_definer_count integer;
begin
  select count(*)::integer
  into v_definer_count
  from pg_proc procedure_row
  join pg_namespace namespace_row on namespace_row.oid = procedure_row.pronamespace
  where namespace_row.nspname = 'public'
    and procedure_row.proname in (
      'guard_campaign_public_slug_alias',
      'guard_campaign_route_identity',
      'preserve_campaign_public_slug_alias',
      'enforce_participant_character_campaign',
      'guard_session_campaign_move_participants',
      'guard_entity_campaign_move_participants'
    )
    and procedure_row.prosecdef = true
    and procedure_row.proconfig @> array['search_path=pg_catalog, public']::text[];

  if v_definer_count <> 6 then
    raise exception 'campaign integrity trigger functions are not hardened consistently: %', v_definer_count;
  end if;

  if has_function_privilege('anon', 'public.guard_campaign_route_identity()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_campaign_route_identity()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.guard_campaign_route_identity()', 'EXECUTE')
     or has_function_privilege('anon', 'public.guard_campaign_public_slug_alias()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_campaign_public_slug_alias()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.guard_campaign_public_slug_alias()', 'EXECUTE')
     or has_function_privilege('anon', 'public.preserve_campaign_public_slug_alias()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.preserve_campaign_public_slug_alias()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.preserve_campaign_public_slug_alias()', 'EXECUTE')
     or has_function_privilege('anon', 'public.enforce_participant_character_campaign()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enforce_participant_character_campaign()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.enforce_participant_character_campaign()', 'EXECUTE')
     or has_function_privilege('anon', 'public.guard_session_campaign_move_participants()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_session_campaign_move_participants()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.guard_session_campaign_move_participants()', 'EXECUTE')
     or has_function_privilege('anon', 'public.guard_entity_campaign_move_participants()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guard_entity_campaign_move_participants()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.guard_entity_campaign_move_participants()', 'EXECUTE') then
    raise exception 'campaign integrity trigger function is directly executable';
  end if;
end $$;

-- Browser roles do not enumerate historical aliases directly.
do $$
begin
  if has_table_privilege('anon', 'public.campaign_public_slug_aliases', 'SELECT')
     or has_table_privilege('authenticated', 'public.campaign_public_slug_aliases', 'SELECT') then
    raise exception 'browser roles unexpectedly gained campaign alias read access';
  end if;
end $$;

-- Legacy readers can keep using the stable UUID/technical slug without new columns.
do $$
declare
  v_legacy text;
begin
  select id::text || ':' || slug
  into v_legacy
  from public.campaigns
  where id = '11111111-1111-4111-8111-111111111111'::uuid;

  if v_legacy <> '11111111-1111-4111-8111-111111111111:yuhara-main' then
    raise exception 'legacy readback contract changed';
  end if;
end $$;

select 'CAMPAIGN_REGISTRY_DATABASE_OK synthetic=true campaigns=2 source_collision=qualified entity_collision=qualified cross_campaign_fk=blocked move_guard=blocked lifecycle=explicit public_alias_history=preserved alias_collision=guarded trigger_security=hardened remote_mutation=false';
