-- Forward-only hardening for the already-applied World graph publish boundary.
--
-- The original graph-authoring migration is already in the canonical Supabase
-- history, so this changes the function in place without rewriting/replaying the
-- historical migration. The patch fails closed if the expected function shape
-- is not present.

do $migration$
declare
  v_definition text;
  v_marker text := E'  insert into public.world_graph_heads(campaign_id, revision, updated_by)\n';
  v_guard text := $guard$
  -- Canon/public visibility requires an already-reviewed canonical source.
  -- Check this inside the atomic RPC before ANY graph/layout/audit write so a
  -- direct service-role call cannot bypass the application precheck.
  if jsonb_typeof(v_lease.draft_graph) = 'object'
     and jsonb_typeof(v_lease.draft_graph->'edges') = 'array'
     and exists (
       select 1
       from jsonb_array_elements(v_lease.draft_graph->'edges') edge(value)
       where edge.value->>'status' = 'active'
         and edge.value->>'visibility' in ('public_campaign', 'public_web')
         and coalesce(edge.value->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
         and not exists (
           select 1
           from public.entity_relation_sources source
           join public.canon_entries canon on canon.id = source.canon_entry_id
           where source.relation_id::text = edge.value->>'id'
             and canon.campaign_id = v_campaign_id
             and canon.status = 'active'
         )
     ) then
    return jsonb_build_object('ok', false, 'reason', 'review_required');
  end if;

$guard$;
begin
  select pg_get_functiondef(
    'public.publish_world_edit_state_atomic(uuid,uuid,text,uuid)'::regprocedure
  ) into v_definition;

  if v_definition is null then
    raise exception 'publish_world_edit_state_atomic is missing';
  end if;

  -- Idempotence for scratch/recovery environments where this exact hardening
  -- may already have been materialized.
  if strpos(v_definition, 'direct service-role call cannot bypass the application precheck') > 0 then
    return;
  end if;

  if strpos(v_definition, v_marker) = 0 then
    raise exception 'unexpected publish_world_edit_state_atomic definition; provenance guard not applied';
  end if;

  execute replace(v_definition, v_marker, v_guard || v_marker);
end;
$migration$;

comment on function public.publish_world_edit_state_atomic(uuid,uuid,text,uuid) is
  'Server-only atomic World publish. Public active relations require an active canon source in the same campaign before any write.';

revoke all on function public.publish_world_edit_state_atomic(uuid,uuid,text,uuid)
  from public, anon, authenticated;
grant execute on function public.publish_world_edit_state_atomic(uuid,uuid,text,uuid)
  to service_role;
