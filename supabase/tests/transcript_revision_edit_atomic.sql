-- Synthetic-only contract for safe immutable transcript editing (#898).
-- Loaded by tools/session-publication-db.py inside an isolated PostgreSQL cluster.
do $security$
begin
  if has_function_privilege(
       'anon',
       'public.edit_transcript_revision_atomic(uuid,text,uuid,uuid,uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.edit_transcript_revision_atomic(uuid,text,uuid,uuid,uuid,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.edit_transcript_revision_atomic(uuid,text,uuid,uuid,uuid,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'TRANSCRIPT_REVISION_EDITOR_FUNCTION_PRIVILEGES_INVALID';
  end if;
end;
$security$;

begin;
set local role service_role;

do $contract$
declare
  v_session_id uuid := '22222222-2222-4222-8222-222222222222';
  v_old_revision_id uuid := '44444444-4444-4444-8444-444444444444';
  v_new_revision_id uuid;
  v_replay_revision_id uuid;
  v_revision_number bigint;
  v_status text;
  v_before_count bigint;
  v_before_audit bigint;
  v_public_before jsonb;
  v_draft_base uuid;
begin
  select count(*) into v_before_count from public.transcript_revisions;
  select count(*) into v_before_audit
  from public.audit_log
  where action='transcript_revision.edit';
  select jsonb_build_object(
    'title', s.title,
    'sessionDate', s.session_date,
    'arc', s.arc,
    'status', s.status,
    'summaryShort', s.summary_short,
    'summaryFull', s.summary_full
  )
  into v_public_before
  from public.sessions s
  where s.id=v_session_id;

  select e.status, e.revision_id, e.revision_number
  into v_status, v_new_revision_id, v_revision_number
  from public.edit_transcript_revision_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    v_session_id,
    v_old_revision_id,
    '93000000-0000-4000-8000-000000000001',
    '[{"id":"r-1-seg-1","speaker":"Álya revisada","text":"Primeira fala corrigida ☕"}]'::jsonb
  ) e;

  if v_status <> 'updated'
     or v_new_revision_id is null
     or v_new_revision_id = v_old_revision_id
     or v_revision_number <> 2
     or (select current_transcript_revision_id from public.sessions where id=v_session_id)
        <> v_new_revision_id
     or (select count(*) from public.transcript_revisions) <> v_before_count + 1
     or (select count(*) from public.audit_log where action='transcript_revision.edit')
        <> v_before_audit + 1 then
    raise exception 'TRANSCRIPT_REVISION_EDIT_SUCCESS_INVALID:%:%', v_status, v_revision_number;
  end if;

  if (select segments->0->>'speaker' from public.transcript_revisions where id=v_old_revision_id)
       <> 'Alya'
     or (select segments->0->>'text' from public.transcript_revisions where id=v_old_revision_id)
       <> 'Primeira fala'
     or (select segments->0->>'speaker' from public.transcript_revisions where id=v_new_revision_id)
       <> 'Álya revisada'
     or (select segments->0->>'text' from public.transcript_revisions where id=v_new_revision_id)
       <> 'Primeira fala corrigida ☕'
     or (select (segments->0->>'start')::numeric from public.transcript_revisions where id=v_new_revision_id)
       <> 0.0
     or (select (segments->0->>'end')::numeric from public.transcript_revisions where id=v_new_revision_id)
       <> 1.2
     or (select segments->0->>'segment_id' from public.transcript_revisions where id=v_new_revision_id)
       <> 'seg-1'
     or (select (segments->0->>'track_number')::integer from public.transcript_revisions where id=v_new_revision_id)
       <> 1 then
    raise exception 'TRANSCRIPT_REVISION_EDIT_MUTATED_IMMUTABLE_FIELDS';
  end if;

  if (select jsonb_build_object(
        'title', s.title,
        'sessionDate', s.session_date,
        'arc', s.arc,
        'status', s.status,
        'summaryShort', s.summary_short,
        'summaryFull', s.summary_full
      )
      from public.sessions s
      where s.id=v_session_id) is distinct from v_public_before then
    raise exception 'TRANSCRIPT_REVISION_EDIT_CHANGED_PUBLIC_SESSION_FIELDS';
  end if;

  if exists (
    select 1
    from public.audit_log a
    where a.action='transcript_revision.edit'
      and a.record_id=v_new_revision_id
      and (
        a.old_value::text like '%Primeira fala%'
        or a.new_value::text like '%Primeira fala%'
        or a.old_value::text like '%Álya%'
        or a.new_value::text like '%Álya%'
      )
  ) then
    raise exception 'TRANSCRIPT_REVISION_EDIT_AUDIT_LEAKED_PRIVATE_TEXT';
  end if;

  select e.status, e.revision_id, e.revision_number
  into v_status, v_replay_revision_id, v_revision_number
  from public.edit_transcript_revision_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    v_session_id,
    v_old_revision_id,
    '93000000-0000-4000-8000-000000000001',
    '[{"id":"r-1-seg-1","speaker":"Álya revisada","text":"Primeira fala corrigida ☕"}]'::jsonb
  ) e;

  if v_status <> 'updated'
     or v_replay_revision_id <> v_new_revision_id
     or (select count(*) from public.transcript_revisions) <> v_before_count + 1
     or (select count(*) from public.audit_log where action='transcript_revision.edit')
        <> v_before_audit + 1 then
    raise exception 'TRANSCRIPT_REVISION_EDIT_REPLAY_NOT_IDEMPOTENT';
  end if;

  select e.status, e.revision_id, e.revision_number
  into v_status, v_replay_revision_id, v_revision_number
  from public.edit_transcript_revision_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    v_session_id,
    v_new_revision_id,
    '93000000-0000-4000-8000-000000000002',
    '[{"id":"r-1-seg-1","speaker":"Álya revisada","text":"Primeira fala corrigida ☕"}]'::jsonb
  ) e;

  if v_status <> 'no_change'
     or v_replay_revision_id <> v_new_revision_id
     or (select count(*) from public.transcript_revisions) <> v_before_count + 1 then
    raise exception 'TRANSCRIPT_REVISION_EDIT_NOOP_CREATED_REVISION';
  end if;

  select e.status
  into v_status
  from public.edit_transcript_revision_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    v_session_id,
    v_old_revision_id,
    '93000000-0000-4000-8000-000000000003',
    '[{"id":"r-2-seg-2","speaker":"Sense","text":"Tentativa stale"}]'::jsonb
  ) e;

  if v_status <> 'conflict'
     or (select current_transcript_revision_id from public.sessions where id=v_session_id)
        <> v_new_revision_id
     or (select count(*) from public.transcript_revisions) <> v_before_count + 1 then
    raise exception 'TRANSCRIPT_REVISION_EDIT_STALE_CAS_FAILED:%', v_status;
  end if;

  select e.status
  into v_status
  from public.edit_transcript_revision_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    v_session_id,
    v_new_revision_id,
    '93000000-0000-4000-8000-000000000004',
    '[{"id":"r-9-does-not-exist","speaker":"Ninguém","text":"Não deve salvar"}]'::jsonb
  ) e;

  if v_status <> 'not_found'
     or (select current_transcript_revision_id from public.sessions where id=v_session_id)
        <> v_new_revision_id
     or (select count(*) from public.transcript_revisions) <> v_before_count + 1 then
    raise exception 'TRANSCRIPT_REVISION_EDIT_UNKNOWN_SEGMENT_LEFT_PARTIAL_STATE:%', v_status;
  end if;

  begin
    perform *
    from public.edit_transcript_revision_atomic(
      '33333333-3333-4333-8333-333333333333',
      'synthetic-campaign',
      v_session_id,
      v_new_revision_id,
      '93000000-0000-4000-8000-000000000005',
      '[{"id":"r-2-seg-2","speaker":"Sense","text":"Não pode alterar tempo","start":999}]'::jsonb
    );
    raise exception 'TRANSCRIPT_REVISION_EDIT_ACCEPTED_TIMING_FIELD';
  exception
    when sqlstate '22023' then null;
  end;

  if (select current_transcript_revision_id from public.sessions where id=v_session_id)
       <> v_new_revision_id
     or (select count(*) from public.transcript_revisions) <> v_before_count + 1 then
    raise exception 'TRANSCRIPT_REVISION_EDIT_INVALID_INPUT_LEFT_PARTIAL_STATE';
  end if;

  if exists (
    select 1
    from public.sessions s
    join public.session_editorial_drafts d
      on d.id=s.current_editorial_draft_id
    where s.id=v_session_id
      and d.base_transcript_revision_id = s.current_transcript_revision_id
  ) then
    raise exception 'TRANSCRIPT_REVISION_EDIT_DID_NOT_STALE_EDITORIAL_DRAFT';
  end if;

  select d.base_transcript_revision_id
  into v_draft_base
  from public.sessions s
  join public.session_editorial_drafts d
    on d.id=s.current_editorial_draft_id
  where s.id=v_session_id;

  if v_draft_base is distinct from v_old_revision_id then
    raise exception 'TRANSCRIPT_REVISION_EDIT_REWROTE_EDITORIAL_DRAFT_BASE';
  end if;
end;
$contract$;

rollback;
