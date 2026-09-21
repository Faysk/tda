-- Synthetic-only PostgreSQL assertions for the session-bound edit boundary.
-- Loaded inside tools/transcript-sync-db.py against an isolated local cluster.

insert into public.sessions (
  id, campaign_id, source_system, source_session_id
) values (
  '77777777-7777-4777-8777-777777777777',
  '11111111-1111-4111-8111-111111111111',
  'local_companion',
  'edit-session-b'
);

insert into public.transcript_segments (
  id,
  session_id,
  source_segment_id,
  source_sequence,
  start_ms,
  end_ms,
  text,
  speaker_name,
  character_name,
  track_key,
  needs_review,
  review_status,
  text_chars,
  text_words,
  is_empty,
  revision
) values (
  '88888888-8888-4888-8888-888888888888',
  '77777777-7777-4777-8777-777777777777',
  'edit-segment-b',
  1,
  0,
  1000,
  'Texto original',
  'Dandelion',
  'Dandelion',
  'track-b',
  true,
  'pending',
  14,
  2,
  false,
  0
);

set role service_role;

do $$
declare
  v_status text;
  v_revision bigint;
  v_text text;
  v_row_revision bigint;
  v_audit_count bigint;
begin
  -- The caller claims session A while presenting a real segment from session B.
  select status, revision
  into v_status, v_revision
  from public.edit_transcript_segment_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '88888888-8888-4888-8888-888888888888',
    0,
    'Texto indevido',
    'Sense',
    'approved',
    false,
    14,
    2
  );

  if v_status <> 'not_found' or v_revision is not null then
    raise exception 'SESSION_MISMATCH_NOT_OPAQUE: % %', v_status, v_revision;
  end if;

  select text, revision
  into v_text, v_row_revision
  from public.transcript_segments
  where id = '88888888-8888-4888-8888-888888888888';

  select count(*)
  into v_audit_count
  from public.audit_log
  where record_id = '88888888-8888-4888-8888-888888888888';

  if v_text <> 'Texto original' or v_row_revision <> 0 or v_audit_count <> 0 then
    raise exception 'SESSION_MISMATCH_MUTATED_STATE: % % %', v_text, v_row_revision, v_audit_count;
  end if;

  -- Correct campaign + expected session + segment updates exactly once.
  select status, revision
  into v_status, v_revision
  from public.edit_transcript_segment_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '77777777-7777-4777-8777-777777777777',
    '88888888-8888-4888-8888-888888888888',
    0,
    'Texto aprovado',
    'Sense',
    'approved',
    false,
    14,
    2
  );

  if v_status <> 'updated' or v_revision <> 1 then
    raise exception 'SESSION_BOUND_UPDATE_FAILED: % %', v_status, v_revision;
  end if;

  select text, revision
  into v_text, v_row_revision
  from public.transcript_segments
  where id = '88888888-8888-4888-8888-888888888888';

  select count(*)
  into v_audit_count
  from public.audit_log
  where record_id = '88888888-8888-4888-8888-888888888888';

  if v_text <> 'Texto aprovado' or v_row_revision <> 1 or v_audit_count <> 1 then
    raise exception 'SESSION_BOUND_UPDATE_STATE_INVALID: % % %', v_text, v_row_revision, v_audit_count;
  end if;

  -- A stale retry remains an optimistic-concurrency conflict and creates no audit.
  select status, revision
  into v_status, v_revision
  from public.edit_transcript_segment_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '77777777-7777-4777-8777-777777777777',
    '88888888-8888-4888-8888-888888888888',
    0,
    'Texto stale',
    'Sense',
    'approved',
    false,
    11,
    2
  );

  if v_status <> 'conflict' or v_revision is not null then
    raise exception 'STALE_RETRY_NOT_CONFLICT: % %', v_status, v_revision;
  end if;

  select count(*)
  into v_audit_count
  from public.audit_log
  where record_id = '88888888-8888-4888-8888-888888888888';

  if v_audit_count <> 1 then
    raise exception 'STALE_RETRY_CREATED_AUDIT: %', v_audit_count;
  end if;
end;
$$;

reset role;
