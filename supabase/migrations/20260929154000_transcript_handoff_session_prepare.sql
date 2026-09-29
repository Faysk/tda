-- #1061: make the first approved transcript handoff able to create the private
-- Edit session atomically instead of requiring the session row to pre-exist.
--
-- This additive server-only wrapper delegates transcript persistence to the
-- already hardened single-source / Session Assembly publication RPCs.

create function public.prepare_transcript_handoff_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_id uuid,
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
  v_source_session_id text;
  v_session public.sessions%rowtype;
  v_created boolean := false;
  v_input jsonb;
  v_result jsonb;
  v_row_count integer;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or not exists (
       select 1
       from public.profiles p
       where p.id = p_actor_profile_id
         and p.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_campaign_id is null
     or p_publication_kind is null
     or p_publication_kind not in ('single_source', 'session_assembly')
     or p_lookup_only is null
     or p_input is null
     or jsonb_typeof(p_input) is distinct from 'object'
     or p_input->>'sourceSystem' is distinct from 'local_companion'
     or coalesce(p_input->>'sourceSessionId', '') !~ '^[A-Za-z0-9_-]{1,160}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if not exists (
    select 1
    from public.permission_catalog pc
    where pc.action = 'campaign.transcript.publish'
      and pc.plane = 'mixed'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'publish_capability_undefined');
  end if;

  -- Authorization deliberately precedes any session lookup or creation.
  if not exists (
    select 1
    from public.campaigns c
    where c.id = p_campaign_id
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
      )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  v_source_session_id := p_input->>'sourceSessionId';

  select s.*
  into v_session
  from public.sessions s
  where s.campaign_id = p_campaign_id
    and s.source_system = 'local_companion'
    and s.source_session_id = v_source_session_id
  for update;

  if not found and p_lookup_only then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if not found then
    insert into public.sessions (
      campaign_id,
      title,
      status,
      created_by,
      source_system,
      source_session_id
    ) values (
      p_campaign_id,
      v_source_session_id,
      'ready_for_review',
      p_actor_profile_id,
      'local_companion',
      v_source_session_id
    )
    on conflict (campaign_id, source_system, source_session_id)
      where source_system is not null and source_session_id is not null
    do nothing;

    get diagnostics v_row_count = row_count;
    v_created := v_row_count = 1;

    -- A concurrent first handoff may have won the unique source identity.
    select s.*
    into v_session
    from public.sessions s
    where s.campaign_id = p_campaign_id
      and s.source_system = 'local_companion'
      and s.source_session_id = v_source_session_id
    for update;

    if not found then
      raise exception 'first handoff session could not be resolved after insert';
    end if;
  end if;

  -- The Web never chooses a physical UUID for a missing session. Override the
  -- authority fields with the exact row proven above before delegation.
  v_input :=
    jsonb_set(
      jsonb_set(
        p_input,
        '{campaignId}',
        to_jsonb(p_campaign_id::text),
        true
      ),
      '{sessionId}',
      to_jsonb(v_session.id::text),
      true
    );

  if p_publication_kind = 'single_source' then
    v_result := public.publish_transcript_revision_atomic(
      p_auth_user_id,
      p_actor_profile_id,
      v_input,
      p_lookup_only
    );
  else
    v_result := public.publish_transcript_assembly_revision_atomic(
      p_auth_user_id,
      p_actor_profile_id,
      v_input,
      p_lookup_only
    );
  end if;

  if jsonb_typeof(v_result) is distinct from 'object'
     or jsonb_typeof(v_result->'ok') is distinct from 'boolean' then
    raise exception 'delegated transcript handoff returned an invalid result';
  end if;

  if coalesce((v_result->>'ok')::boolean, false) is false then
    if v_created then
      delete from public.sessions s
      where s.id = v_session.id
        and s.campaign_id = p_campaign_id
        and s.source_system = 'local_companion'
        and s.source_session_id = v_source_session_id
        and s.current_transcript_revision_id is null
        and s.current_editorial_draft_id is null
        and s.current_session_publication_id is null;

      if not found then
        raise exception 'failed first handoff left a session with unexpected authority';
      end if;
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
      p_campaign_id,
      v_session.id,
      p_actor_profile_id,
      'session.transcript_handoff.prepare',
      'sessions',
      v_session.id,
      null,
      jsonb_build_object(
        'source_system', 'local_companion',
        'source_session_id', v_source_session_id,
        'status', 'ready_for_review',
        'revision_id', v_result->'receipt'->>'revisionId'
      )
    );
  end if;

  return v_result;
end;
$$;

comment on function public.prepare_transcript_handoff_atomic(
  uuid, uuid, uuid, text, jsonb, boolean
) is
'Server-only #1061 boundary for first private transcript handoff. After campaign authorization it resolves or creates one ready_for_review local_companion session, delegates to the existing atomic publication RPC, and removes a newly-created shell on deterministic failure. Lookup-only never creates.';

revoke all on function public.prepare_transcript_handoff_atomic(
  uuid, uuid, uuid, text, jsonb, boolean
) from public;
revoke execute on function public.prepare_transcript_handoff_atomic(
  uuid, uuid, uuid, text, jsonb, boolean
) from anon;
revoke execute on function public.prepare_transcript_handoff_atomic(
  uuid, uuid, uuid, text, jsonb, boolean
) from authenticated;
grant execute on function public.prepare_transcript_handoff_atomic(
  uuid, uuid, uuid, text, jsonb, boolean
) to service_role;
