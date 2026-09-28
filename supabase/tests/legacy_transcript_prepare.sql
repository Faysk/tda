-- Synthetic-only contract for explicit legacy transcript preparation (#984).
-- Never execute against the connected Supabase project.

do $privileges$
begin
  if has_function_privilege(
       'anon',
       'public.prepare_legacy_transcript_revision_atomic(uuid,uuid,text,uuid,uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.prepare_legacy_transcript_revision_atomic(uuid,uuid,text,uuid,uuid,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.prepare_legacy_transcript_revision_atomic(uuid,uuid,text,uuid,uuid,text)',
       'EXECUTE'
     ) then
    raise exception 'LEGACY_PREPARE_FUNCTION_PRIVILEGES_INVALID';
  end if;
end;
$privileges$;

insert into public.permission_catalog(action, plane, description)
values (
  'campaign.content.edit',
  'narrative',
  'Synthetic private legacy transcript preparation capability.'
)
on conflict (action) do nothing;

insert into public.role_permissions(role_id, permission_action)
values (
  '66666666-6666-4666-8666-666666666666',
  'campaign.content.edit'
)
on conflict do nothing;

insert into public.role_assignments(
  profile_id, role_id, scope_type, scope_id, status, starts_at
)
select
  '33333333-3333-4333-8333-333333333333',
  '66666666-6666-4666-8666-666666666666',
  'campaign',
  'synthetic-campaign',
  'active',
  now()
where not exists (
  select 1
  from public.role_assignments
  where profile_id='33333333-3333-4333-8333-333333333333'
    and role_id='66666666-6666-4666-8666-666666666666'
    and scope_type='campaign'
    and scope_id='synthetic-campaign'
);

insert into public.sessions(id,campaign_id,source_system,source_session_id)
values (
  '22222222-2222-4222-8222-222222222223',
  '11111111-1111-4111-8111-111111111111',
  'legacy',
  'legacy-fixture'
);

insert into public.transcript_segments(
  id,session_id,source_segment_id,source_sequence,start_ms,end_ms,text,
  speaker_name,character_name,track_key,needs_review,review_status,
  text_chars,text_words,is_empty,metadata,revision
) values
(
  '71000000-0000-4000-8000-000000000001',
  '22222222-2222-4222-8222-222222222223',
  'legacy-a',
  1,
  1250,
  2500,
  'Coração 🌲',
  'Alice',
  'Álya',
  '1',
  false,
  'pending',
  9,
  2,
  false,
  '{}'::jsonb,
  0
),
(
  '71000000-0000-4000-8000-000000000002',
  '22222222-2222-4222-8222-222222222223',
  'legacy-b',
  2,
  1500,
  3000,
  'Linha dois',
  'Bob',
  null,
  '2',
  false,
  'pending',
  10,
  2,
  false,
  '{}'::jsonb,
  0
);

do $contract$
declare
  v_status text;
  v_revision uuid;
  v_replay uuid;
  v_number bigint;
  v_hash text;
  v_count integer;
  v_current uuid;
  v_before bigint;
begin
  -- Authorization happens before target disclosure.
  select p.status
  into v_status
  from public.prepare_legacy_transcript_revision_atomic(
    '99999999-9999-4999-8999-999999999999',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222223',
    '72000000-0000-4000-8000-000000000001',
    'fa7f2d94f5b998660a2c6c20f99ba5bba90f2418d63734a6417298ed3c966e82'
  ) p;
  if v_status <> 'forbidden' then
    raise exception 'LEGACY_PREPARE_AUTH_ORACLE:%', v_status;
  end if;

  set local role service_role;

  select count(*) into v_before
  from public.transcript_revisions
  where session_id='22222222-2222-4222-8222-222222222223';

  select p.status, p.revision_id, p.revision_number, p.snapshot_sha256, p.segment_count
  into v_status, v_revision, v_number, v_hash, v_count
  from public.prepare_legacy_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222223',
    '72000000-0000-4000-8000-000000000002',
    'fa7f2d94f5b998660a2c6c20f99ba5bba90f2418d63734a6417298ed3c966e82'
  ) p;

  if v_status <> 'prepared'
     or v_revision is null
     or v_number <> 1
     or v_hash <> 'fa7f2d94f5b998660a2c6c20f99ba5bba90f2418d63734a6417298ed3c966e82'
     or v_count <> 2 then
    raise exception 'LEGACY_PREPARE_RESULT_INVALID:% % % % %',
      v_status, v_revision, v_number, v_hash, v_count;
  end if;

  select current_transcript_revision_id into v_current
  from public.sessions
  where id='22222222-2222-4222-8222-222222222223';

  if v_current <> v_revision
     or (select count(*) from public.transcript_revisions
         where session_id='22222222-2222-4222-8222-222222222223') <> v_before + 1
     or (select source_system from public.transcript_revisions where id=v_revision)
        <> 'legacy_import'
     or (select source_id from public.transcript_revisions where id=v_revision)
        <> 'legacy-fa7f2d94f5b998660a2c6c20f99ba5bba90f2418d63734a6417298ed3c966e82'
     or (select publication_kind from public.transcript_revisions where id=v_revision)
        <> 'single_source'
     or (select segments->0->>'segment_id' from public.transcript_revisions where id=v_revision)
        <> 'legacy-a'
     or (select segments->0->>'speaker' from public.transcript_revisions where id=v_revision)
        <> 'Álya'
     or (select segments->0->>'text' from public.transcript_revisions where id=v_revision)
        <> 'Coração 🌲'
     or (select segments->0->>'start' from public.transcript_revisions where id=v_revision)
        <> '1.2500000000000000'
     or (select segments->1->>'end' from public.transcript_revisions where id=v_revision)
        <> '3.0000000000000000' then
    raise exception 'LEGACY_PREPARE_PRESERVATION_INVALID';
  end if;

  if exists (
    select 1
    from public.audit_log a
    where a.action='transcript_revision.legacy_prepare'
      and (
        coalesce(a.old_value::text,'') || coalesce(a.new_value::text,'')
      ) like '%Coração%'
  ) then
    raise exception 'LEGACY_PREPARE_AUDIT_LEAKED_TEXT';
  end if;

  -- Lost-response retry uses the same operation and never duplicates a revision.
  select p.status, p.revision_id
  into v_status, v_replay
  from public.prepare_legacy_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222223',
    '72000000-0000-4000-8000-000000000002',
    'fa7f2d94f5b998660a2c6c20f99ba5bba90f2418d63734a6417298ed3c966e82'
  ) p;
  if v_status <> 'replay' or v_replay <> v_revision then
    raise exception 'LEGACY_PREPARE_REPLAY_INVALID:% %', v_status, v_replay;
  end if;

  -- A second tab with a new operation reconciles to the already-modern current.
  select p.status, p.revision_id
  into v_status, v_replay
  from public.prepare_legacy_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222223',
    '72000000-0000-4000-8000-000000000003',
    'fa7f2d94f5b998660a2c6c20f99ba5bba90f2418d63734a6417298ed3c966e82'
  ) p;
  if v_status <> 'already_prepared' or v_replay <> v_revision then
    raise exception 'LEGACY_PREPARE_SECOND_TAB_INVALID:% %', v_status, v_replay;
  end if;
end;
$contract$;

insert into public.sessions(id,campaign_id,source_system,source_session_id)
values (
  '22222222-2222-4222-8222-222222222224',
  '11111111-1111-4111-8111-111111111111',
  'legacy',
  'legacy-stale'
);

insert into public.transcript_segments(
  id,session_id,source_segment_id,source_sequence,start_ms,end_ms,text,
  speaker_name,track_key,needs_review,review_status,is_empty,metadata,revision
) values (
  '71000000-0000-4000-8000-000000000003',
  '22222222-2222-4222-8222-222222222224',
  'stale-a',
  1,
  0,
  1000,
  'Snapshot atual',
  'Mesa',
  '1',
  false,
  'pending',
  false,
  '{}'::jsonb,
  0
);

do $stale$
declare
  v_status text;
  v_count bigint;
  v_current uuid;
begin
  set local role service_role;
  select p.status
  into v_status
  from public.prepare_legacy_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222224',
    '72000000-0000-4000-8000-000000000004',
    repeat('0',64)
  ) p;
  if v_status <> 'stale_legacy' then
    raise exception 'LEGACY_PREPARE_STALE_ACCEPTED:%', v_status;
  end if;

  select count(*) into v_count
  from public.transcript_revisions
  where session_id='22222222-2222-4222-8222-222222222224';
  select current_transcript_revision_id into v_current
  from public.sessions
  where id='22222222-2222-4222-8222-222222222224';
  if v_count <> 0 or v_current is not null then
    raise exception 'LEGACY_PREPARE_STALE_MUTATED';
  end if;
end;
$stale$;
