set role service_role;

do $$
declare
  v_result jsonb;
  v_current uuid;
  v_candidate jsonb := '[
    {"track_number":1,"segment_id":"s1","start":1.25,"end":2.50,"text":"Olá mesa editada","speaker":"Alya","reviewed":true},
    {"track_number":2,"segment_id":"s2","start":3.00,"end":4.75,"text":"Resposta curta","speaker":"Borin","reviewed":true}
  ]'::jsonb;
begin
  v_result := public.save_transcript_revision_edit_atomic(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444444',
    '90000000-0000-4000-8000-000000000001',
    v_candidate
  );
  if v_result->>'status' <> 'updated' or (v_result->>'revision_number')::bigint <> 2 then
    raise exception 'valid edit did not create r2: %', v_result;
  end if;

  select current_transcript_revision_id into v_current
  from public.sessions where id='22222222-2222-4222-8222-222222222222';
  if v_current::text <> v_result->>'revision_id' then
    raise exception 'current pointer did not advance';
  end if;

  if (select segments->0->>'text' from public.transcript_revisions
      where id='44444444-4444-4444-8444-444444444444') <> 'Olá mesa' then
    raise exception 'parent immutable revision was modified';
  end if;
  if (select segments->0->>'start' from public.transcript_revisions
      where id=v_current) <> '1.25' then
    raise exception 'timestamp changed during edit';
  end if;
  if (select count(*) from public.audit_log
      where action='transcript_revision.web_edit'
        and (old_value ? 'text' or new_value ? 'text')) <> 0 then
    raise exception 'audit leaked transcript content';
  end if;

  v_result := public.save_transcript_revision_edit_atomic(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444444',
    '90000000-0000-4000-8000-000000000001',
    v_candidate
  );
  if v_result->>'status' <> 'replay' then
    raise exception 'same operation was not replayed: %', v_result;
  end if;
  if (select count(*) from public.transcript_revisions
      where session_id='22222222-2222-4222-8222-222222222222') <> 2 then
    raise exception 'replay duplicated revision';
  end if;

  v_result := public.save_transcript_revision_edit_atomic(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444444',
    '90000000-0000-4000-8000-000000000001',
    jsonb_set(v_candidate, '{0,text}', '"different payload"'::jsonb)
  );
  if v_result->>'status' <> 'operation_conflict' then
    raise exception 'divergent replay was not rejected: %', v_result;
  end if;

  v_result := public.save_transcript_revision_edit_atomic(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444444',
    '90000000-0000-4000-8000-000000000002',
    v_candidate
  );
  if v_result->>'status' <> 'stale_current' then
    raise exception 'stale expected current was not rejected: %', v_result;
  end if;

  select current_transcript_revision_id into v_current
  from public.sessions where id='22222222-2222-4222-8222-222222222222';

  v_result := public.save_transcript_revision_edit_atomic(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_current,
    '90000000-0000-4000-8000-000000000003',
    jsonb_set(
      (select segments from public.transcript_revisions where id=v_current),
      '{0,start}',
      '9.5'::jsonb
    )
  );
  if v_result->>'status' <> 'invalid_payload' then
    raise exception 'timestamp tamper was not rejected: %', v_result;
  end if;

  v_result := public.save_transcript_revision_edit_atomic(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    'other-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_current,
    '90000000-0000-4000-8000-000000000004',
    (select segments from public.transcript_revisions where id=v_current)
  );
  if v_result->>'status' <> 'forbidden' then
    raise exception 'cross-campaign request did not fail closed: %', v_result;
  end if;

  v_result := public.save_transcript_revision_edit_atomic(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_current,
    '90000000-0000-4000-8000-000000000005',
    (select segments from public.transcript_revisions where id=v_current)
  );
  if v_result->>'status' <> 'no_changes' then
    raise exception 'no-op edit should not create revision: %', v_result;
  end if;

  if (select count(*) from public.audit_log
      where action='transcript_revision.web_edit') <> 1 then
    raise exception 'unexpected audit count';
  end if;
end;
$$;

reset role;
select 'TRANSCRIPT_REVISION_EDIT_SQL_OK';
