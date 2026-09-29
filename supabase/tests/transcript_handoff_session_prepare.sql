-- Synthetic-only contract for first private transcript handoff session creation (#1061).
-- Loaded only in the disposable transcript PostgreSQL scratch cluster.

do $privileges$
begin
  if has_function_privilege(
       'anon',
       'public.prepare_transcript_handoff_atomic(uuid,uuid,uuid,text,jsonb,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.prepare_transcript_handoff_atomic(uuid,uuid,uuid,text,jsonb,boolean)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.prepare_transcript_handoff_atomic(uuid,uuid,uuid,text,jsonb,boolean)',
       'EXECUTE'
     ) then
    raise exception 'TRANSCRIPT_HANDOFF_PREPARE_PRIVILEGES_INVALID';
  end if;
end;
$privileges$;

begin;

insert into public.role_permissions(role_id, permission_action)
values (
  '66666666-6666-4666-8666-666666666666',
  'campaign.transcript.publish'
)
on conflict do nothing;

insert into public.role_assignments(
  id, profile_id, role_id, scope_type, scope_id, status, starts_at
)
values (
  'a1000000-0000-4000-8000-000000000000',
  '33333333-3333-4333-8333-333333333333',
  '66666666-6666-4666-8666-666666666666',
  'campaign',
  'synthetic-campaign',
  'active',
  now()
)
on conflict (id) do nothing;

do $contract$
declare
  v_input jsonb;
  v_first jsonb;
  v_replay jsonb;
  v_lookup jsonb;
  v_failed jsonb;
  v_missing jsonb;
  v_forbidden jsonb;
  v_session_id uuid;
  v_revision_id uuid;
  v_count bigint;
  v_status text;
  v_created_by uuid;
begin
  -- Authorization must happen before a missing target can be distinguished.
  v_input :=
    jsonb_set(
      jsonb_set(
        public.synthetic_publication_input(
          'a1000000-0000-4000-8000-000000000001',
          'run-first-handoff',
          'Primeiro handoff sintético'
        ),
        '{sourceSessionId}',
        '"handoff-secret"'::jsonb
      ),
      '{expectedCurrentRevisionId}',
      'null'::jsonb
    );

  select public.prepare_transcript_handoff_atomic(
    '99999999-9999-4999-8999-999999999999',
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    'single_source',
    v_input,
    false
  ) into v_forbidden;

  if v_forbidden <> '{"ok":false,"reason":"forbidden"}'::jsonb
     or exists (
       select 1 from public.sessions
       where source_system='local_companion'
         and source_session_id='handoff-secret'
     ) then
    raise exception 'FIRST_HANDOFF_AUTH_TARGET_ORACLE:%', v_forbidden;
  end if;

  set local role service_role;

  -- Lookup/readback of an operation that never committed must never create a shell.
  v_input :=
    jsonb_set(
      jsonb_set(
        public.synthetic_publication_input(
          'a1000000-0000-4000-8000-000000000002',
          'run-lookup-only',
          'Lookup sem escrita'
        ),
        '{sourceSessionId}',
        '"handoff-missing"'::jsonb
      ),
      '{expectedCurrentRevisionId}',
      'null'::jsonb
    );

  select public.prepare_transcript_handoff_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    'single_source',
    v_input,
    true
  ) into v_missing;

  if v_missing <> '{"ok":false,"reason":"not_found"}'::jsonb
     or exists (
       select 1 from public.sessions
       where source_system='local_companion'
         and source_session_id='handoff-missing'
     ) then
    raise exception 'FIRST_HANDOFF_LOOKUP_CREATED_SESSION:%', v_missing;
  end if;

  -- A valid first handoff creates exactly one private session and commits the
  -- revision/current pointer/receipt using the already hardened RPC.
  v_input :=
    jsonb_set(
      jsonb_set(
        public.synthetic_publication_input(
          'a1000000-0000-4000-8000-000000000003',
          'run-first-handoff',
          'Primeiro handoff sintético'
        ),
        '{sourceSessionId}',
        '"handoff-new-session"'::jsonb
      ),
      '{expectedCurrentRevisionId}',
      'null'::jsonb
    );

  select public.prepare_transcript_handoff_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    'single_source',
    v_input,
    false
  ) into v_first;

  if v_first->>'ok' <> 'true' then
    raise exception 'FIRST_HANDOFF_DID_NOT_COMMIT:%', v_first;
  end if;

  v_session_id := (v_first->'receipt'->>'sessionId')::uuid;
  v_revision_id := (v_first->'receipt'->>'revisionId')::uuid;

  select count(*)
  into v_count
  from public.sessions
  where id=v_session_id
    and campaign_id='11111111-1111-4111-8111-111111111111'
    and source_system='local_companion'
    and source_session_id='handoff-new-session';

  select status, created_by
  into v_status, v_created_by
  from public.sessions
  where id=v_session_id;

  if v_count <> 1
     or v_status <> 'ready_for_review'
     or v_created_by <> '33333333-3333-4333-8333-333333333333'::uuid
     or (select current_transcript_revision_id from public.sessions where id=v_session_id)
        <> v_revision_id then
    raise exception 'FIRST_HANDOFF_SESSION_STATE_INVALID:% % %', v_count, v_status, v_created_by;
  end if;

  if (select title from public.sessions where id=v_session_id) <> 'handoff-new-session' then
    raise exception 'FIRST_HANDOFF_PLACEHOLDER_TITLE_INVALID';
  end if;

  if (select count(*) from public.audit_log
      where action='session.transcript_handoff.prepare'
        and session_id=v_session_id) <> 1 then
    raise exception 'FIRST_HANDOFF_SESSION_AUDIT_MISSING';
  end if;

  if exists (
    select 1
    from public.audit_log
    where session_id=v_session_id
      and action='session.transcript_handoff.prepare'
      and (coalesce(old_value::text,'') || coalesce(new_value::text,''))
          like '%Primeiro handoff sintético%'
  ) then
    raise exception 'FIRST_HANDOFF_SESSION_AUDIT_LEAKED_TRANSCRIPT';
  end if;

  -- Replay and lookup converge to the exact same receipt/session.
  select public.prepare_transcript_handoff_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    'single_source',
    v_input,
    false
  ) into v_replay;

  select public.prepare_transcript_handoff_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    'single_source',
    v_input,
    true
  ) into v_lookup;

  if v_replay->'receipt' <> v_first->'receipt'
     or v_lookup->'receipt' <> v_first->'receipt'
     or (select count(*) from public.sessions
         where campaign_id='11111111-1111-4111-8111-111111111111'
           and source_system='local_companion'
           and source_session_id='handoff-new-session') <> 1
     or (select count(*) from public.audit_log
         where action='session.transcript_handoff.prepare'
           and session_id=v_session_id) <> 1 then
    raise exception 'FIRST_HANDOFF_REPLAY_NOT_IDEMPOTENT:first=% replay=% lookup=%',
      v_first, v_replay, v_lookup;
  end if;

  -- A deterministic delegated rejection must not leave an empty session shell.
  v_input :=
    jsonb_set(
      jsonb_set(
        public.synthetic_publication_input(
          'a1000000-0000-4000-8000-000000000004',
          'run-invalid-handoff',
          'Payload inválido sintético'
        ),
        '{sourceSessionId}',
        '"handoff-invalid"'::jsonb
      ),
      '{expectedCurrentRevisionId}',
      'null'::jsonb
    ) - 'payloadJson';

  select public.prepare_transcript_handoff_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    'single_source',
    v_input,
    false
  ) into v_failed;

  if v_failed <> '{"ok":false,"reason":"invalid_payload"}'::jsonb
     or exists (
       select 1 from public.sessions
       where source_system='local_companion'
         and source_session_id='handoff-invalid'
     ) then
    raise exception 'FAILED_FIRST_HANDOFF_LEFT_SESSION:%', v_failed;
  end if;
end;
$contract$;

reset role;
rollback;
