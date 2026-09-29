-- #1061: make the private transcript handoff capable of resolving or
-- atomically creating its private Edit session. This remains a transcript
-- publication boundary: it never publishes the public session.
--
-- The wrapper deliberately delegates the immutable revision/receipt/current
-- pointer commit to the already-hardened single-source / assembly RPCs. When a
-- target session does not exist, it creates the minimum private session in the
-- same transaction and removes that row again if the delegated commit returns a
-- deterministic rejection. Exceptions roll back the whole statement naturally.

create function public.prepare_transcript_handoff_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_publication_kind text,
  p_input jsonb,
  p_lookup_only boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_campaign_slug text;
  v_source_session_id text;
  v_requested_session_id uuid;
  v_session_id uuid;
  v_session_source_system text;
  v_target_count integer;
  v_created boolean := false;
  v_result jsonb;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_lookup_only is null
     or p_publication_kind not in ('single_source', 'session_assembly')
     or p_input is null
     or jsonb_typeof(p_input) is distinct from 'object'
     or coalesce(p_input->>'campaignId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or not (p_input ? 'sessionId')
     or (
       p_input->'sessionId' <> 'null'::jsonb
       and (
         jsonb_typeof(p_input->'sessionId') is distinct from 'string'
         or coalesce(p_input->>'sessionId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       )
     )
     or p_input->>'sourceSystem' is distinct from 'local_companion'
     or coalesce(p_input->>'sourceSessionId', '') !~ '^[A-Za-z0-9_-]{1,160}$'
     or not exists (
       select 1
       from public.profiles p
       where p.id = p_actor_profile_id
         and p.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not exists (
    select 1
    from public.permission_catalog pc
    where pc.action = 'campaign.transcript.publish'
      and pc.plane = 'mixed'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'publish_capability_undefined');
  end if;

  v_campaign_id := (p_input->>'campaignId')::uuid;
  v_source_session_id := p_input->>'sourceSessionId';
  v_requested_session_id := case
    when p_input->'sessionId' = 'null'::jsonb then null
    else (p_input->>'sessionId')::uuid
  end;

  -- Revalidate the exact publication authority before any target existence
  -- lookup. Missing/conflicting sessions therefore remain opaque to callers
  -- without campaign.transcript.publish.
  select c.slug
  into v_campaign_slug
  from public.campaigns c
  where c.id = v_campaign_id
    and exists (
      select 1
      from public.role_assignments a
      join public.role_permissions rp on rp.role_id = a.role_id
      where a.profile_id = p_actor_profile_id
        and a.status = 'active'
        and a.starts_at <= clock_timestamp()
        and (a.ends_at is null or a.ends_at > clock_timestamp())
        and rp.permission_action = 'campaign.transcript.publish'
        and (
          (a.scope_type = 'campaign' and a.scope_id = c.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda')
        )
    );

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- Serialize first-handoff creation for this logical source inside this RPC.
  -- The existing partial unique index remains the final race fence for
  -- local_companion rows.
  perform pg_advisory_xact_lock(
    hashtextextended(v_campaign_id::text || ':' || v_source_session_id, 0)
  );

  select
    count(*)::integer,
    min(s.id::text)::uuid,
    min(s.source_system)
  into v_target_count, v_session_id, v_session_source_system
  from public.sessions s
  where s.campaign_id = v_campaign_id
    and s.source_session_id = v_source_session_id;

  if v_target_count > 1 then
    return jsonb_build_object('ok', false, 'reason', 'conflict');
  end if;

  if v_target_count = 1 then
    -- A historical/non-local session with the same external identity is not
    -- silently rebound or duplicated. It needs an explicit migration/rebind
    -- policy rather than changing provenance behind the editor's back.
    if v_session_source_system is distinct from 'local_companion' then
      return jsonb_build_object('ok', false, 'reason', 'conflict');
    end if;
    if v_requested_session_id is not null
       and v_requested_session_id <> v_session_id then
      return jsonb_build_object('ok', false, 'reason', 'conflict');
    end if;
  elsif v_requested_session_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  elsif p_lookup_only then
    -- Receipt lookup is read-only. If the first commit never happened there is
    -- intentionally no session to materialize merely by checking recovery.
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  else
    insert into public.sessions (
      campaign_id,
      title,
      status,
      created_by,
      source_system,
      source_session_id
    ) values (
      v_campaign_id,
      v_source_session_id,
      'ready_for_review',
      p_actor_profile_id,
      'local_companion',
      v_source_session_id
    )
    on conflict (campaign_id, source_system, source_session_id)
      where source_system is not null and source_session_id is not null
    do nothing
    returning id into v_session_id;

    v_created := found;
    if not v_created then
      select s.id
      into v_session_id
      from public.sessions s
      where s.campaign_id = v_campaign_id
        and s.source_system = 'local_companion'
        and s.source_session_id = v_source_session_id;

      if not found then
        return jsonb_build_object('ok', false, 'reason', 'conflict');
      end if;
    end if;
  end if;

  p_input := jsonb_set(
    p_input,
    '{sessionId}',
    to_jsonb(v_session_id),
    true
  );

  if p_publication_kind = 'single_source' then
    v_result := public.publish_transcript_revision_atomic(
      p_auth_user_id,
      p_actor_profile_id,
      p_input,
      p_lookup_only
    );
  else
    v_result := public.publish_transcript_assembly_revision_atomic(
      p_auth_user_id,
      p_actor_profile_id,
      p_input,
      p_lookup_only
    );
  end if;

  if coalesce((v_result->>'ok')::boolean, false) is not true then
    -- A newly provisioned session is part of the same handoff intent. A
    -- deterministic rejection must not leave an empty shell in Edit.
    if v_created then
      delete from public.sessions s
      where s.id = v_session_id
        and s.campaign_id = v_campaign_id
        and s.source_system = 'local_companion'
        and s.source_session_id = v_source_session_id
        and s.current_transcript_revision_id is null
        and s.current_editorial_draft_id is null
        and s.current_session_publication_id is null;
    end if;
    return v_result;
  end if;

  if v_created then
    insert into public.audit_log (
      campaign_id,
      session_id,
      actor_id,
      action,
      table_name,
      record_id,
      old_value,
      new_value
    ) values (
      v_campaign_id,
      v_session_id,
      p_actor_profile_id,
      'session.transcript_handoff_create',
      'sessions',
      v_session_id,
      null,
      jsonb_build_object(
        'sourceSystem', 'local_companion',
        'sourceSessionId', v_source_session_id,
        'status', 'ready_for_review'
      )
    );
  end if;

  return v_result;
end;
$$;

comment on function public.prepare_transcript_handoff_atomic(
  uuid, uuid, text, jsonb, boolean
) is
'Server-only #1061 boundary for private transcript handoff. After publication capability authorization it resolves one local_companion session or creates the minimum private Edit session in the same transaction, then delegates to the hardened single-source/assembly publication RPC. It never changes public session publication state.';

revoke all on function public.prepare_transcript_handoff_atomic(
  uuid, uuid, text, jsonb, boolean
) from public;
revoke execute on function public.prepare_transcript_handoff_atomic(
  uuid, uuid, text, jsonb, boolean
) from anon;
revoke execute on function public.prepare_transcript_handoff_atomic(
  uuid, uuid, text, jsonb, boolean
) from authenticated;
grant execute on function public.prepare_transcript_handoff_atomic(
  uuid, uuid, text, jsonb, boolean
) to service_role;
