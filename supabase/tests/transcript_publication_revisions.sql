-- Synthetic-only contract for immutable cloud transcript revisions.
-- Never executed against the connected Supabase project.

create function public.synthetic_publication_input(
  p_operation_id uuid,
  p_run_id text,
  p_text text
)
returns jsonb
language plpgsql
as $$
declare
  v_payload jsonb;
  v_payload_json text;
  v_payload_sha text;
  v_word_count integer;
begin
  v_word_count := cardinality(regexp_split_to_array(btrim(p_text), E'\\s+'));
  v_payload := jsonb_build_object(
    'schema_version', 'tda_transcript_publication_v1',
    'source_id', 'craig-' || repeat('a', 64),
    'run_id', p_run_id,
    'base_transcript_sha256', repeat('b', 64),
    'draft_sha256', repeat('d', 64),
    'lineage', jsonb_build_object(
      'profile_id', 'whisper-detailed',
      'engine', 'faster-whisper',
      'model', 'large-v3',
      'model_revision', 'test-revision',
      'device', 'cuda',
      'compute_type', 'float16',
      'alignment', 'native',
      'completed_at', '2026-09-21T00:00:00Z'
    ),
    'review', jsonb_build_object(
      'status', 'approved_local',
      'draft_revision', 3,
      'reviewed_segments', 1,
      'total_segments', 1,
      'warning_count', 0,
      'word_count', v_word_count
    ),
    'segments', jsonb_build_array(
      jsonb_build_object(
        'track_number', 1,
        'segment_id', '1-0',
        'start', 0.0,
        'end', 1.0,
        'text', p_text,
        'speaker', 'Alice',
        'reviewed', true
      )
    )
  );
  v_payload_json := v_payload::text;
  v_payload_sha := encode(
    extensions.digest(convert_to(v_payload_json, 'UTF8'), 'sha256'),
    'hex'
  );

  return jsonb_build_object(
    'campaignId', '11111111-1111-4111-8111-111111111111',
    'sessionId', '22222222-2222-4222-8222-222222222222',
    'operationId', p_operation_id,
    'sourceSystem', 'local_companion',
    'sourceSessionId', 'fixture-source',
    'sourceId', 'craig-' || repeat('a', 64),
    'runId', p_run_id,
    'baseTranscriptSha256', repeat('b', 64),
    'draftSha256', repeat('d', 64),
    'payloadSha256', v_payload_sha,
    'payloadJson', v_payload_json,
    'segmentCount', 1
  );
end;
$$;

do $$
declare
  v_existing jsonb;
  v_missing jsonb;
begin
  if has_function_privilege(
    'anon',
    'public.publish_transcript_revision_atomic(uuid,uuid,jsonb,boolean)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.publish_transcript_revision_atomic(uuid,uuid,jsonb,boolean)',
    'EXECUTE'
  ) then
    raise exception 'PUBLICATION_FUNCTION_EXPOSED_TO_BROWSER_ROLE';
  end if;

  set local role service_role;

  select public.publish_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    public.synthetic_publication_input(
      '90000000-0000-4000-8000-000000000001',
      'run-first',
      'Texto publicado inicial'
    ),
    false
  ) into v_existing;

  select public.publish_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    jsonb_set(
      public.synthetic_publication_input(
        '90000000-0000-4000-8000-000000000001',
        'run-first',
        'Texto publicado inicial'
      ),
      '{sessionId}',
      '"99999999-9999-4999-8999-999999999999"'::jsonb
    ),
    false
  ) into v_missing;

  if v_existing <> '{"ok":false,"reason":"forbidden"}'::jsonb
     or v_missing <> '{"ok":false,"reason":"forbidden"}'::jsonb then
    raise exception 'TARGET_EXISTENCE_ORACLE_BEFORE_GRANT: % %', v_existing, v_missing;
  end if;
end;
$$;

insert into public.role_permissions(role_id, permission_action)
values (
  '55555555-5555-4555-8555-555555555555',
  'campaign.transcript.publish'
);

insert into public.role_assignments(
  profile_id,
  role_id,
  scope_type,
  scope_id,
  status,
  starts_at
) values (
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  'campaign',
  'synthetic-campaign',
  'active',
  now()
);

-- Install the synthetic rollback probe as the scratch-cluster owner before the
-- test switches to service_role. The trigger is selective so normal publication,
-- restore and unpublish operations still exercise the least-privileged boundary.
create function public.fail_publication_event_on_probe() returns trigger
language plpgsql as $
begin
  if new.operation_id = '90000000-0000-4000-8000-000000000003'::uuid then
    raise exception 'synthetic publication event failure';
  end if;
  return new;
end;
$;

create trigger fail_publication_event
before insert on public.transcript_publication_events
for each row execute function public.fail_publication_event_on_probe();

do $
declare
  v_first jsonb;
  v_replay jsonb;
  v_lookup jsonb;
  v_conflict jsonb;
  v_second jsonb;
  v_failed boolean := false;
  v_revision_1 uuid;
  v_revision_2 uuid;
  v_current uuid;
  v_restore jsonb;
  v_restore_replay jsonb;
  v_unpublish jsonb;
  v_receipts bigint;
  v_revisions bigint;
  v_events bigint;
  v_audits bigint;
begin
  set local role service_role;

  -- First publication atomically creates revision 1 and makes it current.
  select public.publish_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    public.synthetic_publication_input(
      '90000000-0000-4000-8000-000000000001',
      'run-first',
      'Texto publicado inicial'
    ),
    false
  ) into v_first;

  if v_first->>'ok' <> 'true'
     or v_first->'receipt'->>'schemaVersion' <> 'tda_transcript_publication_receipt_v1'
     or (v_first->'receipt'->>'revisionNumber')::bigint <> 1
     or (v_first->'receipt'->>'segmentCount')::integer <> 1 then
    raise exception 'FIRST_PUBLICATION_INVALID: %', v_first;
  end if;

  v_revision_1 := (v_first->'receipt'->>'revisionId')::uuid;

  select current_transcript_revision_id
  into v_current
  from public.sessions
  where id = '22222222-2222-4222-8222-222222222222';

  if v_current <> v_revision_1 then
    raise exception 'FIRST_PUBLICATION_POINTER_INVALID';
  end if;

  -- Retry and readback return exactly the committed receipt with no new evidence.
  select public.publish_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    public.synthetic_publication_input(
      '90000000-0000-4000-8000-000000000001',
      'run-first',
      'Texto publicado inicial'
    ),
    false
  ) into v_replay;

  select public.publish_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    public.synthetic_publication_input(
      '90000000-0000-4000-8000-000000000001',
      'run-first',
      'Texto publicado inicial'
    ),
    true
  ) into v_lookup;

  if v_replay->'receipt'->>'receiptId' <> v_first->'receipt'->>'receiptId'
     or v_lookup->'receipt'->>'receiptId' <> v_first->'receipt'->>'receiptId' then
    raise exception 'PUBLICATION_REPLAY_NOT_IDEMPOTENT';
  end if;

  select count(*) into v_receipts from public.transcript_publication_receipts;
  select count(*) into v_revisions from public.transcript_revisions;
  select count(*) into v_events from public.transcript_publication_events;
  select count(*) into v_audits
  from public.audit_log
  where action like 'transcript_revision.%';

  if v_receipts <> 1 or v_revisions <> 1 or v_events <> 1 or v_audits <> 1 then
    raise exception 'PUBLICATION_REPLAY_DUPLICATED_EVIDENCE: % % % %',
      v_receipts, v_revisions, v_events, v_audits;
  end if;

  -- Reusing the same operation id with divergent bytes is an explicit conflict.
  select public.publish_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    public.synthetic_publication_input(
      '90000000-0000-4000-8000-000000000001',
      'run-first',
      'Conteúdo divergente'
    ),
    false
  ) into v_conflict;

  if v_conflict <> '{"ok":false,"reason":"conflict"}'::jsonb then
    raise exception 'DIVERGENT_OPERATION_DID_NOT_CONFLICT: %', v_conflict;
  end if;

  -- A new operation creates revision 2 and preserves revision 1.
  select public.publish_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    public.synthetic_publication_input(
      '90000000-0000-4000-8000-000000000002',
      'run-second',
      'Texto publicado substituto'
    ),
    false
  ) into v_second;

  if v_second->>'ok' <> 'true'
     or (v_second->'receipt'->>'revisionNumber')::bigint <> 2 then
    raise exception 'REPLACEMENT_PUBLICATION_INVALID: %', v_second;
  end if;
  v_revision_2 := (v_second->'receipt'->>'revisionId')::uuid;

  select current_transcript_revision_id
  into v_current
  from public.sessions
  where id = '22222222-2222-4222-8222-222222222222';

  select count(*) into v_revisions from public.transcript_revisions;
  if v_current <> v_revision_2 or v_revisions <> 2 then
    raise exception 'REPLACEMENT_DID_NOT_PRESERVE_HISTORY';
  end if;

  -- Force a failure after revision/receipt inserts. The scratch-cluster owner
  -- installed a selective trigger before service_role was assumed, so this test
  -- does not need (and must not grant) schema CREATE privileges to service_role.
  begin
    perform public.publish_transcript_revision_atomic(
      '44444444-4444-4444-8444-444444444444',
      '33333333-3333-4333-8333-333333333333',
      public.synthetic_publication_input(
        '90000000-0000-4000-8000-000000000003',
        'run-rollback',
        'Este texto não pode sobreviver'
      ),
      false
    );
  exception
    when others then
      if sqlerrm not like '%synthetic publication event failure%' then
        raise;
      end if;
      v_failed := true;
  end;

  if not v_failed then
    raise exception 'ROLLBACK_PROBE_DID_NOT_FAIL';
  end if;

  select current_transcript_revision_id
  into v_current
  from public.sessions
  where id = '22222222-2222-4222-8222-222222222222';
  select count(*) into v_revisions from public.transcript_revisions;
  select count(*) into v_receipts from public.transcript_publication_receipts;

  if v_current <> v_revision_2 or v_revisions <> 2 or v_receipts <> 2 then
    raise exception 'FAILED_PUBLICATION_LEFT_PARTIAL_STATE: % % %',
      v_current, v_revisions, v_receipts;
  end if;

  -- Restore reactivates revision 1 without duplicating its immutable content.
  select public.set_current_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '90000000-0000-4000-8000-000000000004',
    v_revision_1
  ) into v_restore;

  select public.set_current_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '90000000-0000-4000-8000-000000000004',
    v_revision_1
  ) into v_restore_replay;

  if v_restore->>'ok' <> 'true'
     or v_restore->'event'->>'action' <> 'restore'
     or v_restore_replay->'event'->>'eventId' <> v_restore->'event'->>'eventId' then
    raise exception 'RESTORE_REPLAY_INVALID: % %', v_restore, v_restore_replay;
  end if;

  select current_transcript_revision_id
  into v_current
  from public.sessions
  where id = '22222222-2222-4222-8222-222222222222';
  if v_current <> v_revision_1 then
    raise exception 'RESTORE_POINTER_INVALID';
  end if;

  -- Unpublish clears only the pointer; immutable revision history remains.
  select public.set_current_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '90000000-0000-4000-8000-000000000005',
    null
  ) into v_unpublish;

  if v_unpublish->>'ok' <> 'true'
     or v_unpublish->'event'->>'action' <> 'unpublish' then
    raise exception 'UNPUBLISH_INVALID: %', v_unpublish;
  end if;

  select current_transcript_revision_id
  into v_current
  from public.sessions
  where id = '22222222-2222-4222-8222-222222222222';
  select count(*) into v_revisions from public.transcript_revisions;

  if v_current is not null or v_revisions <> 2 then
    raise exception 'UNPUBLISH_DESTROYED_HISTORY';
  end if;

  -- Public audit/event evidence must remain metadata-only.
  if exists (
    select 1
    from public.audit_log a
    where a.action like 'transcript_revision.%'
      and (coalesce(a.old_value::text, '') || coalesce(a.new_value::text, ''))
        like '%Texto publicado%'
  ) then
    raise exception 'AUDIT_LEAKED_TRANSCRIPT_CONTENT';
  end if;
end;
$$;

drop trigger fail_publication_event on public.transcript_publication_events;
drop function public.fail_publication_event_on_probe();
