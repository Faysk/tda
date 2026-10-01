-- Fail closed when a World graph draft tries to persist identifiers owned by
-- another campaign (#1138). This is forward-only: canonical publication already
-- rejects these references, but the draft write boundary must not persist them.

create or replace function public.save_world_graph_draft_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_lease_token uuid,
  p_draft jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $world_graph_draft_campaign_isolation$
declare
  v_campaign_id uuid;
  v_lease public.world_edit_leases%rowtype;
  v_now timestamptz := clock_timestamp();
  v_revision bigint := 0;
  v_node jsonb;
  v_node_id uuid;
  v_edge jsonb;
  v_edge_id uuid;
  v_source uuid;
  v_target uuid;
begin
  if p_auth_user_id is null or p_actor_profile_id is null or p_lease_token is null
     or p_draft is null or jsonb_typeof(p_draft) <> 'object'
     or p_draft->>'schemaVersion' <> '1'
     or jsonb_typeof(p_draft->'nodes') <> 'array'
     or jsonb_typeof(p_draft->'edges') <> 'array'
     or jsonb_typeof(p_draft->'relationTypes') <> 'array'
     or jsonb_array_length(p_draft->'nodes') > 1000
     or jsonb_array_length(p_draft->'edges') > 5000
     or jsonb_array_length(p_draft->'relationTypes') > 200
     or octet_length(p_draft::text) > 2097152
     or not exists (
       select 1 from public.profiles p
       where p.id = p_actor_profile_id and p.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select c.id into v_campaign_id
  from public.campaigns c
  where c.slug = p_campaign_slug
    and exists (
      select 1 from public.role_assignments a
      join public.role_permissions rp on rp.role_id = a.role_id
      where a.profile_id = p_actor_profile_id
        and a.status = 'active'
        and a.starts_at <= v_now
        and (a.ends_at is null or a.ends_at > v_now)
        and rp.permission_action = 'campaign.content.edit'
        and ((a.scope_type = 'campaign' and a.scope_id = c.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda'))
    );
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select lease.* into v_lease
  from public.world_edit_leases lease
  where lease.campaign_id = v_campaign_id
  for update;
  v_now := clock_timestamp();
  if not found
     or v_lease.holder_profile_id <> p_actor_profile_id
     or v_lease.lease_token <> p_lease_token
     or v_lease.expires_at <= v_now
     or not v_lease.graph_draft_initialized then
    return jsonb_build_object('ok', false, 'reason', 'lease_lost');
  end if;

  if not ((p_draft->>'revision') ~ '^[0-9]+$')
     or (p_draft->>'revision')::bigint <> v_lease.base_graph_revision then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  -- Existing UUIDs are globally unique. A draft may contain new unsaved nodes,
  -- but it must never reuse an entity/relation UUID already owned by a sibling
  -- campaign. Return the same generic payload error for foreign and unknown
  -- references so the write path does not become a campaign-enumeration oracle.
  for v_node in select value from jsonb_array_elements(p_draft->'nodes')
  loop
    begin
      v_node_id := (v_node->>'id')::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end;

    if exists (
      select 1
      from public.entities e
      where e.id = v_node_id
        and e.campaign_id <> v_campaign_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
  end loop;

  for v_edge in select value from jsonb_array_elements(p_draft->'edges')
  loop
    begin
      v_edge_id := (v_edge->>'id')::uuid;
      v_source := (v_edge->>'source')::uuid;
      v_target := (v_edge->>'target')::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end;

    if exists (
      select 1
      from public.entity_relations r
      where r.id = v_edge_id
        and r.campaign_id <> v_campaign_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if not exists (
      select 1
      from jsonb_array_elements(p_draft->'nodes') n
      where n->>'id' = v_source::text
    ) and not exists (
      select 1
      from public.entities e
      where e.id = v_source
        and e.campaign_id = v_campaign_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if not exists (
      select 1
      from jsonb_array_elements(p_draft->'nodes') n
      where n->>'id' = v_target::text
    ) and not exists (
      select 1
      from public.entities e
      where e.id = v_target
        and e.campaign_id = v_campaign_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
  end loop;

  select h.revision into v_revision
  from public.world_graph_heads h
  where h.campaign_id = v_campaign_id;
  if not found then v_revision := 0; end if;

  -- Preserve the established recovery contract: a same-campaign stale editor
  -- may checkpoint its private draft and then receive the current revision.
  -- Cross-campaign identifiers have already failed before this write.
  update public.world_edit_leases lease
  set draft_graph = p_draft,
      draft_updated_at = v_now,
      heartbeat_at = v_now,
      expires_at = v_now + interval '60 seconds'
  where lease.campaign_id = v_campaign_id;

  if v_revision <> v_lease.base_graph_revision then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'revision', v_revision);
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'draft_saved',
    'baseRevision', v_lease.base_graph_revision,
    'expiresAt', v_now + interval '60 seconds'
  );
end;
$world_graph_draft_campaign_isolation$;

revoke all on function public.save_world_graph_draft_atomic(uuid,uuid,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.save_world_graph_draft_atomic(uuid,uuid,text,uuid,jsonb)
  to service_role;

comment on function public.save_world_graph_draft_atomic(uuid,uuid,text,uuid,jsonb) is
  'Persists a private World graph draft only after lease, revision and same-campaign entity/relation identity checks.';
