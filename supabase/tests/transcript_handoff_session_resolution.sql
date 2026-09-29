-- Synthetic-only contract for #1061 private handoff target resolution.
-- Runs only inside tools/transcript-sync-db.py disposable PostgreSQL.

do $security$
begin
  if has_function_privilege(
       'anon',
       'public.prepare_transcript_handoff_atomic(uuid,uuid,text,jsonb,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.prepare_transcript_handoff_atomic(uuid,uuid,text,jsonb,boolean)',
       'EXECUTE'
     ) then
    raise exception 'HANDOFF_SESSION_RPC_EXPOSED_TO_BROWSER';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.prepare_transcript_handoff_atomic(uuid,uuid,text,jsonb,boolean)',
       'EXECUTE'
     ) then
    raise exception 'HANDOFF_SESSION_RPC_MISSING_SERVICE_EXECUTE';
  end if;
end;
$security$;

insert into public.role_permissions(role_id, permission_action)
values (
  '55555555-5555-4555-8555-555555555555',
  'campaign.transcript.publish'
)
on conflict do nothing;

insert into public.role_assignments(
  id,
  profile_id,
  role_id,
  scope_type,
  scope_id,
  status,
  starts_at
) values (
  '10610000-0000-4000-8000-000000000001',
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  'campaign',
  'synthetic-campaign',
  'active',
  now()
);

-- A second valid identity intentionally receives no transcript-publish grant.
-- This lets the service-role contract prove opaque denial without granting the
-- test role permission to mutate role_assignments just to manufacture revoke.
insert into public.profiles(id, auth_user_id)
values (
  '33333333-3333-4333-8333-333333333334',
  '44444444-4444-4444-8444-444444444445'
)
on conflict do nothing;

do $main$
declare
  v_input jsonb;
  v_first jsonb;
  v_replay jsonb;
  v_lookup jsonb;
  v_bad jsonb;
  v_missing_lookup jsonb;
  v_conflict jsonb;
  v_forbidden jsonb;
  v_session_id uuid;
  v_revision_id uuid;
  v_audit_count integer;
begin
  set local role service_role;

  -- First handoff: there is deliberately no session row yet. The wrapper must
  -- provision the minimum private Edit session and publish the approved
  -- transcript revision in one transaction.
  v_input := jsonb_set(
    jsonb_set(
      public.synthetic_publication_input(
        '10610000-0000-4000-8000-000000000011',
        'run-first-handoff',
        'Texto sintético de handoff'
      ),
      '{sessionId}',
      'null'::jsonb,
      true
    ),
    '{sourceSessionId}',
    '"handoff-first-session"'::jsonb,
    true
  );

  select public.prepare_transcript_handoff_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'single_source',
    v_input,
    false
  ) into v_first;

  if v_first->>'ok' <> 'true'
     or v_first->'receipt'->>'schemaVersion'
        <> 'tda_transcript_publication_receipt_v1' then
    raise exception 'FIRST_HANDOFF_DID_NOT_COMMIT:%', v_first;
  end if;

  v_session_id := (v_first->'receipt'->>'sessionId')::uuid;
  v_revision_id := (v_first->'receipt'->>'revisionId')::uuid;

  if not exists (
    select 1
    from public.sessions s
    where s.id = v_session_id
      and s.campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
      and s.source_system = 'local_companion'
      and s.source_session_id = 'handoff-first-session'
      and s.title = 'handoff-first-session'
      and s.status = 'ready_for_review'
      and s.created_by = '33333333-3333-4333-8333-333333333333'::uuid
      and s.current_transcript_revision_id = v_revision_id
  ) then
    raise exception 'FIRST_HANDOFF_SESSION_STATE_INVALID';
  end if;

  -- Same operation remains exact replay even though the caller originally had
  -- no session id.
  select public.prepare_transcript_handoff_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'single_source',
    v_input,
    false
  ) into v_replay;

  select public.prepare_transcript_handoff_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'single_source',
    v_input,
    true
  ) into v_lookup;

  if v_replay->'receipt' is distinct from v_first->'receipt'
     or v_lookup->'receipt' is distinct from v_first->'receipt'
     or (
       select count(*)
       from public.sessions
       where campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
         and source_session_id = 'handoff-first-session'
     ) <> 1 then
    raise exception 'FIRST_HANDOFF_REPLAY_NOT_IDEMPOTENT:%:%', v_replay, v_lookup;
  end if;

  select count(*)::integer
  into v_audit_count
  from public.audit_log a
  where a.session_id = v_session_id
    and a.action = 'session.transcript_handoff_create'
    and (
      coalesce(a.old_value::text, '') || coalesce(a.new_value::text, '')
    ) not like '%Texto sintético%';

  if v_audit_count <> 1 then
    raise exception 'HANDOFF_SESSION_AUDIT_MISSING_OR_LEAKED_CONTENT';
  end if;

  -- Receipt lookup for a never-committed target is strictly read-only.
  v_input := jsonb_set(
    jsonb_set(
      public.synthetic_publication_input(
        '10610000-0000-4000-8000-000000000012',
        'run-lookup-only',
        'lookup only'
      ),
      '{sessionId}',
      'null'::jsonb,
      true
    ),
    '{sourceSessionId}',
    '"handoff-lookup-missing"'::jsonb,
    true
  );

  select public.prepare_transcript_handoff_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'single_source',
    v_input,
    true
  ) into v_missing_lookup;

  if v_missing_lookup <> '{"ok":false,"reason":"not_found"}'::jsonb
     or exists (
       select 1 from public.sessions
       where campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
         and source_session_id = 'handoff-lookup-missing'
     ) then
    raise exception 'LOOKUP_ONLY_CREATED_SESSION:%', v_missing_lookup;
  end if;

  -- A deterministic publication rejection must roll back the provisional
  -- session shell as part of the same handoff intent.
  v_input := jsonb_set(
    jsonb_set(
      jsonb_set(
        public.synthetic_publication_input(
          '10610000-0000-4000-8000-000000000013',
          'run-rejected',
          'rejected handoff'
        ),
        '{sessionId}',
        'null'::jsonb,
        true
      ),
      '{sourceSessionId}',
      '"handoff-rejected"'::jsonb,
      true
    ),
    '{payloadSha256}',
    to_jsonb(repeat('0', 64)),
    true
  );

  select public.prepare_transcript_handoff_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'single_source',
    v_input,
    false
  ) into v_bad;

  if v_bad <> '{"ok":false,"reason":"invalid_payload"}'::jsonb
     or exists (
       select 1 from public.sessions
       where campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
         and source_session_id = 'handoff-rejected'
     ) then
    raise exception 'REJECTED_HANDOFF_LEFT_SESSION_SHELL:%', v_bad;
  end if;

  -- Never duplicate or silently rebind an existing historical/non-local
  -- session that happens to use the same external identity.
  insert into public.sessions(
    campaign_id, source_system, source_session_id, title, status
  ) values (
    '11111111-1111-4111-8111-111111111111',
    'craig',
    'handoff-historical',
    'Historical fixture',
    'published'
  );

  v_input := jsonb_set(
    jsonb_set(
      public.synthetic_publication_input(
        '10610000-0000-4000-8000-000000000014',
        'run-historical-conflict',
        'historical conflict'
      ),
      '{sessionId}',
      'null'::jsonb,
      true
    ),
    '{sourceSessionId}',
    '"handoff-historical"'::jsonb,
    true
  );

  select public.prepare_transcript_handoff_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'single_source',
    v_input,
    false
  ) into v_conflict;

  if v_conflict <> '{"ok":false,"reason":"conflict"}'::jsonb
     or (
       select count(*)
       from public.sessions
       where campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
         and source_session_id = 'handoff-historical'
     ) <> 1 then
    raise exception 'HISTORICAL_SESSION_WAS_DUPLICATED_OR_REBOUND:%', v_conflict;
  end if;

  -- An authenticated profile with no matching grant must not reveal whether
  -- an unresolved target exists and must never provision one.
  v_input := jsonb_set(
    jsonb_set(
      public.synthetic_publication_input(
        '10610000-0000-4000-8000-000000000015',
        'run-forbidden',
        'forbidden'
      ),
      '{sessionId}',
      'null'::jsonb,
      true
    ),
    '{sourceSessionId}',
    '"handoff-forbidden"'::jsonb,
    true
  );

  select public.prepare_transcript_handoff_atomic(
    '44444444-4444-4444-8444-444444444445',
    '33333333-3333-4333-8333-333333333334',
    'single_source',
    v_input,
    false
  ) into v_forbidden;

  if v_forbidden <> '{"ok":false,"reason":"forbidden"}'::jsonb
     or exists (
       select 1 from public.sessions
       where campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
         and source_session_id = 'handoff-forbidden'
     ) then
    raise exception 'UNAUTHORIZED_HANDOFF_REVEALED_OR_CREATED_TARGET:%', v_forbidden;
  end if;
end;
$main$;

-- Cleanup only #1061 fixture evidence. The shared base session stays intact for
-- the assembly/web-edit/legacy contracts that follow.
delete from public.transcript_publication_events
where session_id in (
  select id from public.sessions
  where campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
    and source_session_id in ('handoff-first-session', 'handoff-historical')
);

delete from public.transcript_publication_receipts
where session_id in (
  select id from public.sessions
  where campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
    and source_session_id in ('handoff-first-session', 'handoff-historical')
);

delete from public.transcript_revisions
where session_id in (
  select id from public.sessions
  where campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
    and source_session_id in ('handoff-first-session', 'handoff-historical')
);

delete from public.audit_log
where campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
  and session_id in (
    select id from public.sessions
    where campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
      and source_session_id in ('handoff-first-session', 'handoff-historical')
  );

delete from public.sessions
where campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
  and source_session_id in ('handoff-first-session', 'handoff-historical');

delete from public.role_assignments
where id = '10610000-0000-4000-8000-000000000001'::uuid;

delete from public.profiles
where id = '33333333-3333-4333-8333-333333333334'::uuid;
