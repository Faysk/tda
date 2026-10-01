-- Assertions for #1129 safe campaign-aware session moves.

do $$
declare
  v_status text;
  v_blockers jsonb;
begin
  select status, blockers into v_status, v_blockers
  from public.preflight_session_campaign_move(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'clean-source',
    'campaign-a',
    'campaign-b'
  );
  if v_status <> 'ready' or jsonb_array_length(v_blockers) <> 0 then
    raise exception 'clean move was not ready: % %', v_status, v_blockers;
  end if;

  select status into v_status
  from public.preflight_session_campaign_move(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'wrong-source',
    'campaign-a',
    'campaign-b'
  );
  if v_status <> 'not_found' then
    raise exception 'source identity mismatch was not opaque';
  end if;

  select status into v_status
  from public.preflight_session_campaign_move(
    '20000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000011',
    'grant-source',
    'campaign-a',
    'campaign-b'
  );
  if v_status <> 'forbidden' then
    raise exception 'destination grant was not required';
  end if;

  select status, blockers into v_status, v_blockers
  from public.preflight_session_campaign_move(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002',
    'transcript-source',
    'campaign-a',
    'campaign-b'
  );
  if v_status <> 'blocked' or not (v_blockers ? 'transcript_revision') then
    raise exception 'transcript blocker missing: %', v_blockers;
  end if;

  select status, blockers into v_status, v_blockers
  from public.preflight_session_campaign_move(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000003',
    'draft-source',
    'campaign-a',
    'campaign-b'
  );
  if v_status <> 'blocked' or not (v_blockers ? 'editorial_draft') then
    raise exception 'draft blocker missing: %', v_blockers;
  end if;

  select status, blockers into v_status, v_blockers
  from public.preflight_session_campaign_move(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000004',
    'published-source',
    'campaign-a',
    'campaign-b'
  );
  if v_status <> 'blocked'
     or not (v_blockers ? 'published_session')
     or not (v_blockers ? 'publication_history') then
    raise exception 'published blockers incomplete: %', v_blockers;
  end if;

  select status, blockers into v_status, v_blockers
  from public.preflight_session_campaign_move(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000005',
    'media-source',
    'campaign-a',
    'campaign-b'
  );
  if v_status <> 'blocked' or not (v_blockers ? 'session_media') then
    raise exception 'media blocker missing: %', v_blockers;
  end if;

  select status, blockers into v_status, v_blockers
  from public.preflight_session_campaign_move(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000006',
    'participant-source',
    'campaign-a',
    'campaign-b'
  );
  if v_status <> 'blocked' or not (v_blockers ? 'entity_linked_participant') then
    raise exception 'entity participant blocker missing: %', v_blockers;
  end if;

  select status, blockers into v_status, v_blockers
  from public.preflight_session_campaign_move(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000007',
    'evidence-source',
    'campaign-a',
    'campaign-b'
  );
  if v_status <> 'blocked' or not (v_blockers ? 'session_evidence_or_lineage') then
    raise exception 'lineage blocker missing: %', v_blockers;
  end if;

  select status, blockers into v_status, v_blockers
  from public.preflight_session_campaign_move(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000008',
    'scoped-source',
    'campaign-a',
    'campaign-b'
  );
  if v_status <> 'blocked' or not (v_blockers ? 'session_scoped_access') then
    raise exception 'session access blocker missing: %', v_blockers;
  end if;

  select status, blockers into v_status, v_blockers
  from public.preflight_session_campaign_move(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000009',
    'shared-source',
    'campaign-a',
    'campaign-b'
  );
  if v_status <> 'blocked' or not (v_blockers ? 'destination_source_collision') then
    raise exception 'destination source collision missing: %', v_blockers;
  end if;

  select status, blockers into v_status, v_blockers
  from public.preflight_session_campaign_move(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000013',
    'review-source',
    'campaign-a',
    'campaign-b'
  );
  if v_status <> 'blocked' or not (v_blockers ? 'review_or_canon') then
    raise exception 'review/canon blocker missing: %', v_blockers;
  end if;

  select status, blockers into v_status, v_blockers
  from public.preflight_session_campaign_move(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000014',
    'publication-history-source',
    'campaign-a',
    'campaign-b'
  );
  if v_status <> 'blocked' or not (v_blockers ? 'publication_history') then
    raise exception 'legacy publication blocker missing: %', v_blockers;
  end if;

  select status, blockers into v_status, v_blockers
  from public.preflight_session_campaign_move(
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000011',
    'grant-source',
    'campaign-a',
    'campaign-archived'
  );
  if v_status <> 'invalid_target' or not (v_blockers ? 'invalid_target') then
    raise exception 'archived destination was accepted';
  end if;
end
$$;

-- Preflight is strictly zero-write.
do $$
begin
  if exists (select 1 from public.session_campaign_move_operations)
     or exists (select 1 from public.audit_log) then
    raise exception 'preflight wrote durable state';
  end if;
end
$$;

-- Commit the dependency-free session.
do $$
declare
  v_status text;
  v_source uuid;
  v_destination uuid;
begin
  select status, source_campaign_id, destination_campaign_id
  into v_status, v_source, v_destination
  from public.move_session_campaign_atomic(
    '60000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'clean-source',
    'campaign-a',
    'campaign-b'
  );

  if v_status <> 'moved' then
    raise exception 'clean move failed: %', v_status;
  end if;
  if not exists (
    select 1 from public.sessions
    where id='40000000-0000-4000-8000-000000000001'
      and campaign_id='10000000-0000-4000-8000-000000000002'
      and source_session_id='clean-source'
  ) then
    raise exception 'session identity did not move to destination';
  end if;
  if (
    select count(*) from public.session_campaign_move_operations
    where operation_id='60000000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'move receipt missing or duplicated';
  end if;
  if (
    select count(*) from public.audit_log
    where action='session_campaign_move'
      and session_id='40000000-0000-4000-8000-000000000001'
      and actor_id='20000000-0000-4000-8000-000000000001'
      and old_value->>'campaignSlug'='campaign-a'
      and new_value->>'campaignSlug'='campaign-b'
      and new_value->>'sourceSessionId'='clean-source'
      and new_value->>'operationId'='60000000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'metadata-only move audit receipt missing';
  end if;
  if exists (
    select 1 from public.audit_log
    where action='session_campaign_move'
      and (old_value::text ilike '%transcript%' or new_value::text ilike '%transcript%')
  ) then
    raise exception 'move audit leaked transcript-shaped content';
  end if;
end
$$;

-- Lost-response retry is idempotent and exact-parameter bound.
do $$
declare
  v_status text;
begin
  select status into v_status
  from public.move_session_campaign_atomic(
    '60000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'clean-source',
    'campaign-a',
    'campaign-b'
  );
  if v_status <> 'replay' then
    raise exception 'lost-response retry was not replay: %', v_status;
  end if;

  select status into v_status
  from public.move_session_campaign_atomic(
    '60000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'clean-source',
    'campaign-a',
    'campaign-c'
  );
  if v_status <> 'operation_conflict' then
    raise exception 'receipt was replayed with a different destination: %', v_status;
  end if;

  if (select count(*) from public.session_campaign_move_operations) <> 1
     or (select count(*) from public.audit_log where action='session_campaign_move') <> 1 then
    raise exception 'replay/conflict created duplicate durable state';
  end if;
end
$$;

-- Browser roles cannot call the privileged move boundary or read receipts.
do $$
begin
  if has_table_privilege('anon','public.session_campaign_move_operations','select')
     or has_table_privilege('authenticated','public.session_campaign_move_operations','select')
     or has_function_privilege(
       'anon',
       'public.preflight_session_campaign_move(uuid,uuid,text,text,text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.preflight_session_campaign_move(uuid,uuid,text,text,text)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.move_session_campaign_atomic(uuid,uuid,uuid,text,text,text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.move_session_campaign_atomic(uuid,uuid,uuid,text,text,text)',
       'execute'
     ) then
    raise exception 'browser role received safe-move privileges';
  end if;
end
$$;

select 'SESSION_CAMPAIGN_MOVE_SQL_OK';
