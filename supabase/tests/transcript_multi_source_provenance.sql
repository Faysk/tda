-- Synthetic-only contract for Session Assembly publication provenance (#851).
-- Runs only in the disposable PostgreSQL scratch cluster.

create function public.synthetic_assembly_publication_input(
  p_operation_id uuid,
  p_expected_current_revision_id uuid,
  p_part_count integer,
  p_draft_char text default 'd'
)
returns jsonb
language plpgsql
as $$
declare
  v_parts jsonb;
  v_segments jsonb;
  v_provenance jsonb;
  v_payload jsonb;
  v_payload_json text;
  v_payload_sha256 text;
begin
  if p_part_count not between 1 and 64
     or p_draft_char !~ '^[0-9a-f]$' then
    raise exception 'invalid synthetic assembly fixture';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'part_id', lpad(to_hex(i), 32, '0'),
      'source_id', 'craig-' || lpad(to_hex(i), 64, '0'),
      'source_sha256', lpad(to_hex(i), 64, '0'),
      'run_id', 'run-' || i::text,
      'transcript_sha256', lpad(to_hex(100 + i), 64, '0'),
      'ordinal', i - 1,
      'session_offset_seconds', (i - 1)::double precision,
      'trim_start_seconds', 0.0,
      'trim_end_seconds', null,
      'overlap_resolution', null,
      'overlap_boundary_seconds', null
    )
    order by i
  )
  into v_parts
  from generate_series(1, p_part_count) i;

  v_provenance := jsonb_build_object(
    'schema_version', 'tda_transcript_multi_source_provenance_v1',
    'assembly_schema_version', 'tda_session_assembly_v1',
    'canonicalization_version', 'tda_session_assembly_canonical_v1',
    'assembly_id', repeat('e', 64),
    'inputs_sha256', repeat('e', 64),
    'campaign_id', 'synthetic-campaign',
    'session_id', 'fixture-source',
    'transcript_sha256', repeat('f', 64),
    'timing_policy_version', 'tda_session_timeline_v1',
    'segment_boundary_policy', 'segment_start_owner_v1',
    'timeline_fingerprint_sha256', repeat('8', 64),
    'participant_mapping_schema_version', 'tda_session_participant_mapping_v1',
    'participant_mapping_policy', 'strong_discord_or_manual_v1',
    'participant_mapping_sha256', repeat('9', 64),
    'parts', v_parts
  );

  select jsonb_agg(
    jsonb_build_object(
      'assembly_segment_id', lpad(to_hex(1000 + i), 64, '0'),
      'segment_id', lpad(to_hex(1000 + i), 64, '0'),
      'part_id', lpad(to_hex(i), 32, '0'),
      'source_id', 'craig-' || lpad(to_hex(i), 64, '0'),
      'run_id', 'run-' || i::text,
      'source_segment_id', 'source-' || i::text,
      'track_number', i,
      'start', (i - 1)::double precision,
      'end', i::double precision,
      'text', 'parte ' || i::text,
      'speaker', 'Speaker ' || i::text,
      'reviewed', true
    )
    order by i
  )
  into v_segments
  from generate_series(1, p_part_count) i;

  v_payload := jsonb_build_object(
    'schema_version', 'tda_transcript_publication_v2',
    'publication_kind', 'session_assembly',
    'base_transcript_sha256', repeat('f', 64),
    'draft_sha256', repeat(p_draft_char, 64),
    'lineage', jsonb_build_object(
      'kind', 'session_assembly',
      'assembly_id', repeat('e', 64),
      'assembly_schema_version', 'tda_session_assembly_v1'
    ),
    'provenance', v_provenance,
    'review', jsonb_build_object(
      'status', 'approved_local',
      'draft_revision', 1,
      'reviewed_segments', p_part_count,
      'total_segments', p_part_count,
      'warning_count', 0,
      'word_count', p_part_count * 2
    ),
    'segments', v_segments
  );

  v_payload_json := v_payload::text;
  v_payload_sha256 := encode(
    extensions.digest(convert_to(v_payload_json, 'UTF8'), 'sha256'),
    'hex'
  );

  return jsonb_build_object(
    'campaignId', '11111111-1111-4111-8111-111111111111',
    'sessionId', '22222222-2222-4222-8222-222222222222',
    'operationId', p_operation_id,
    'expectedCurrentRevisionId', p_expected_current_revision_id,
    'sourceSystem', 'local_companion',
    'sourceSessionId', 'fixture-source',
    'provenance', v_provenance,
    'baseTranscriptSha256', repeat('f', 64),
    'draftSha256', repeat(p_draft_char, 64),
    'payloadSha256', v_payload_sha256,
    'payloadJson', v_payload_json,
    'segmentCount', p_part_count
  );
end;
$$;

create function public.fail_assembly_publication_event_on_probe()
returns trigger
language plpgsql
as $$
begin
  if new.operation_id = '85100000-0000-4000-8000-000000000099'::uuid then
    raise exception 'synthetic assembly publication event failure';
  end if;
  return new;
end;
$$;

create trigger fail_assembly_publication_event
before insert on public.transcript_publication_events
for each row execute function public.fail_assembly_publication_event_on_probe();

do $security$
begin
  if has_function_privilege(
       'anon',
       'public.publish_transcript_assembly_revision_atomic(uuid,uuid,jsonb,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.publish_transcript_assembly_revision_atomic(uuid,uuid,jsonb,boolean)',
       'EXECUTE'
     ) then
    raise exception 'ASSEMBLY_PUBLICATION_RPC_EXPOSED_TO_BROWSER';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.publish_transcript_assembly_revision_atomic(uuid,uuid,jsonb,boolean)',
       'EXECUTE'
     ) then
    raise exception 'ASSEMBLY_PUBLICATION_RPC_MISSING_SERVICE_EXECUTE';
  end if;

  if not has_table_privilege('service_role', 'public.transcript_revision_parts', 'SELECT')
     or not has_table_privilege('service_role', 'public.transcript_revision_parts', 'INSERT')
     or has_table_privilege('service_role', 'public.transcript_revision_parts', 'UPDATE')
     or has_table_privilege('service_role', 'public.transcript_revision_parts', 'DELETE')
     or not has_table_privilege('service_role', 'public.transcript_assembly_publication_receipts', 'SELECT')
     or not has_table_privilege('service_role', 'public.transcript_assembly_publication_receipts', 'INSERT')
     or has_table_privilege('service_role', 'public.transcript_assembly_publication_receipts', 'UPDATE')
     or has_table_privilege('service_role', 'public.transcript_assembly_publication_receipts', 'DELETE') then
    raise exception 'ASSEMBLY_PROVENANCE_GRANTS_NOT_MINIMAL';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('transcript_revision_parts', 'transcript_assembly_publication_receipts')
      and c.relrowsecurity
    group by n.nspname
    having count(*) = 2
  ) then
    raise exception 'ASSEMBLY_PROVENANCE_RLS_NOT_ENABLED';
  end if;
end;
$security$;

insert into public.permission_catalog(action, plane, description)
values (
  'campaign.content.edit',
  'narrative',
  'Synthetic private transcript correction capability for assembly provenance inheritance.'
)
on conflict (action) do nothing;

insert into public.role_permissions(role_id, permission_action)
values
  ('55555555-5555-4555-8555-555555555555', 'campaign.transcript.publish'),
  ('55555555-5555-4555-8555-555555555555', 'campaign.content.edit')
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
  '85100000-0000-4000-8000-000000000001',
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  'campaign',
  'synthetic-campaign',
  'active',
  now()
);

do $main$
declare
  v_first jsonb;
  v_replay jsonb;
  v_conflict jsonb;
  v_stale jsonb;
  v_second jsonb;
  v_twenty jsonb;
  v_bad jsonb;
  v_revision_1 uuid;
  v_revision_2 uuid;
  v_revision_3 uuid;
  v_edit_revision uuid;
  v_edit_status text;
  v_edit_segment_id text;
  v_current uuid;
  v_restore jsonb;
  v_unpublish jsonb;
  v_failed boolean := false;
  v_before_revisions bigint;
  v_before_parts bigint;
  v_before_receipts bigint;
begin
  if (
    select current_transcript_revision_id
    from public.sessions
    where id = '22222222-2222-4222-8222-222222222222'
  ) is not null then
    raise exception 'ASSEMBLY_FIXTURE_EXPECTED_NULL_CURRENT';
  end if;

  set local role service_role;

  -- 1-part publish proves the minimum cardinality and exact ordered provenance.
  select public.publish_transcript_assembly_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    public.synthetic_assembly_publication_input(
      '85100000-0000-4000-8000-000000000011',
      null,
      1,
      'd'
    ),
    false
  ) into v_first;

  if v_first->>'ok' <> 'true'
     or v_first->'receipt'->>'schemaVersion' <> 'tda_transcript_publication_receipt_v2'
     or (v_first->'receipt'->>'partCount')::integer <> 1
     or (v_first->'receipt'->>'revisionNumber')::bigint <> 1 then
    raise exception 'ASSEMBLY_FIRST_PUBLICATION_INVALID:%', v_first;
  end if;

  v_revision_1 := (v_first->'receipt'->>'revisionId')::uuid;

  if (
    select count(*)
    from public.transcript_revision_parts
    where revision_id = v_revision_1
  ) <> 1
     or (
       select publication_kind
       from public.transcript_revisions
       where id = v_revision_1
     ) <> 'session_assembly'
     or (
       select segments->0->>'segment_id'
       from public.transcript_revisions
       where id = v_revision_1
     ) is distinct from (
       select segments->0->>'assembly_segment_id'
       from public.transcript_revisions
       where id = v_revision_1
     ) then
    raise exception 'ASSEMBLY_FIRST_PROVENANCE_INVALID';
  end if;

  -- Lost-response replay must return the exact receipt even though current moved.
  select public.publish_transcript_assembly_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    public.synthetic_assembly_publication_input(
      '85100000-0000-4000-8000-000000000011',
      null,
      1,
      'd'
    ),
    false
  ) into v_replay;

  if v_replay->'receipt' <> v_first->'receipt'
     or (select count(*) from public.transcript_revisions) <> 1
     or (select count(*) from public.transcript_revision_parts) <> 1
     or (select count(*) from public.transcript_assembly_publication_receipts) <> 1 then
    raise exception 'ASSEMBLY_REPLAY_DUPLICATED_EVIDENCE';
  end if;

  -- Same operation with different immutable identity is a conflict.
  select public.publish_transcript_assembly_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    public.synthetic_assembly_publication_input(
      '85100000-0000-4000-8000-000000000011',
      null,
      2,
      'd'
    ),
    false
  ) into v_conflict;

  if v_conflict <> '{"ok":false,"reason":"conflict"}'::jsonb then
    raise exception 'ASSEMBLY_DIVERGENT_REPLAY_NOT_CONFLICT:%', v_conflict;
  end if;

  -- A stale publisher cannot leave revision/parts/receipt evidence.
  select public.publish_transcript_assembly_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    public.synthetic_assembly_publication_input(
      '85100000-0000-4000-8000-000000000012',
      null,
      2,
      'e'
    ),
    false
  ) into v_stale;

  if v_stale <> '{"ok":false,"reason":"stale_current"}'::jsonb
     or (select count(*) from public.transcript_revisions) <> 1
     or (select count(*) from public.transcript_revision_parts) <> 1 then
    raise exception 'ASSEMBLY_STALE_WRITE_LEFT_EVIDENCE:%', v_stale;
  end if;

  -- 2-part replacement preserves revision 1 and creates ordered provenance.
  select public.publish_transcript_assembly_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    public.synthetic_assembly_publication_input(
      '85100000-0000-4000-8000-000000000013',
      v_revision_1,
      2,
      'e'
    ),
    false
  ) into v_second;

  if v_second->>'ok' <> 'true'
     or (v_second->'receipt'->>'partCount')::integer <> 2 then
    raise exception 'ASSEMBLY_TWO_PART_PUBLICATION_INVALID:%', v_second;
  end if;
  v_revision_2 := (v_second->'receipt'->>'revisionId')::uuid;

  if (
    select string_agg(ordinal::text, ',' order by ordinal)
    from public.transcript_revision_parts
    where revision_id = v_revision_2
  ) <> '0,1' then
    raise exception 'ASSEMBLY_PART_ORDER_NOT_PRESERVED';
  end if;

  -- 20-part publication exercises realistic cardinality without changing schema.
  select public.publish_transcript_assembly_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    public.synthetic_assembly_publication_input(
      '85100000-0000-4000-8000-000000000014',
      v_revision_2,
      20,
      'a'
    ),
    false
  ) into v_twenty;

  if v_twenty->>'ok' <> 'true'
     or (v_twenty->'receipt'->>'partCount')::integer <> 20 then
    raise exception 'ASSEMBLY_TWENTY_PART_PUBLICATION_INVALID:%', v_twenty;
  end if;
  v_revision_3 := (v_twenty->'receipt'->>'revisionId')::uuid;

  if (select count(*) from public.transcript_revision_parts where revision_id = v_revision_3) <> 20
     or (select count(*) from public.transcript_revision_parts) <> 23 then
    raise exception 'ASSEMBLY_TWENTY_PART_PROVENANCE_INCOMPLETE';
  end if;

  -- Foreign assembly identity, tampered source hash and invalid ordinal fail closed.
  select public.publish_transcript_assembly_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    jsonb_set(
      public.synthetic_assembly_publication_input(
        '85100000-0000-4000-8000-000000000015',
        v_revision_3,
        1,
        'b'
      ),
      '{provenance,campaign_id}',
      '"foreign-campaign"'::jsonb
    ),
    false
  ) into v_bad;
  if v_bad <> '{"ok":false,"reason":"invalid_payload"}'::jsonb then
    raise exception 'ASSEMBLY_FOREIGN_CAMPAIGN_ACCEPTED:%', v_bad;
  end if;

  select public.publish_transcript_assembly_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    jsonb_set(
      public.synthetic_assembly_publication_input(
        '85100000-0000-4000-8000-000000000016',
        v_revision_3,
        1,
        'b'
      ),
      '{provenance,parts,0,source_sha256}',
      to_jsonb(repeat('f', 64))
    ),
    false
  ) into v_bad;
  if v_bad <> '{"ok":false,"reason":"invalid_payload"}'::jsonb then
    raise exception 'ASSEMBLY_TAMPERED_SOURCE_HASH_ACCEPTED:%', v_bad;
  end if;

  select public.publish_transcript_assembly_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    jsonb_set(
      public.synthetic_assembly_publication_input(
        '85100000-0000-4000-8000-000000000017',
        v_revision_3,
        1,
        'b'
      ),
      '{provenance,parts,0,ordinal}',
      '1'::jsonb
    ),
    false
  ) into v_bad;
  if v_bad <> '{"ok":false,"reason":"invalid_payload"}'::jsonb then
    raise exception 'ASSEMBLY_INVALID_ORDINAL_ACCEPTED:%', v_bad;
  end if;

  -- Restore/unpublish move only the pointer; all immutable provenance survives.
  select public.set_current_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '85100000-0000-4000-8000-000000000018',
    v_revision_1,
    v_revision_3
  ) into v_restore;

  if v_restore->>'ok' <> 'true' then
    raise exception 'ASSEMBLY_RESTORE_FAILED:%', v_restore;
  end if;

  -- A private Web edit derived from an assembly-backed revision inherits the
  -- immutable assembly identity and copies the ordered parts instead of
  -- degrading back to a fake single source/run.
  select segments->0->>'segment_id'
  into v_edit_segment_id
  from public.transcript_revisions
  where id = v_revision_1;

  select e.status, e.revision_id
  into v_edit_status, v_edit_revision
  from public.save_transcript_revision_edit_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_revision_1,
    '85100000-0000-4000-8000-000000000020',
    jsonb_build_array(
      jsonb_build_object(
        'trackNumber', 1,
        'segmentId', v_edit_segment_id,
        'speaker', 'Speaker 1',
        'text', 'parte editada'
      )
    )
  ) e;

  if v_edit_status <> 'updated'
     or v_edit_revision is null
     or (
       select publication_kind
       from public.transcript_revisions
       where id = v_edit_revision
     ) <> 'session_assembly'
     or (
       select assembly_id
       from public.transcript_revisions
       where id = v_edit_revision
     ) is distinct from (
       select assembly_id
       from public.transcript_revisions
       where id = v_revision_1
     )
     or (
       select parent_revision_id
       from public.transcript_revisions
       where id = v_edit_revision
     ) is distinct from v_revision_1
     or (
       select count(*)
       from public.transcript_revision_parts
       where revision_id = v_edit_revision
     ) <> 1
     or (
       select p.source_id || ':' || p.run_id
       from public.transcript_revision_parts p
       where p.revision_id = v_edit_revision
     ) is distinct from (
       select p.source_id || ':' || p.run_id
       from public.transcript_revision_parts p
       where p.revision_id = v_revision_1
     ) then
    raise exception 'ASSEMBLY_WEB_EDIT_LOST_PROVENANCE:%:%', v_edit_status, v_edit_revision;
  end if;

  select public.set_current_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '85100000-0000-4000-8000-000000000019',
    null,
    v_edit_revision
  ) into v_unpublish;

  if v_unpublish->>'ok' <> 'true'
     or (select count(*) from public.transcript_revision_parts) <> 24 then
    raise exception 'ASSEMBLY_UNPUBLISH_DESTROYED_PROVENANCE:%', v_unpublish;
  end if;

  select current_transcript_revision_id
  into v_current
  from public.sessions
  where id = '22222222-2222-4222-8222-222222222222';
  if v_current is not null then
    raise exception 'ASSEMBLY_UNPUBLISH_POINTER_NOT_NULL';
  end if;

  -- Failure after revision/parts/receipt insertion must roll back the whole write.
  select count(*) into v_before_revisions from public.transcript_revisions;
  select count(*) into v_before_parts from public.transcript_revision_parts;
  select count(*) into v_before_receipts from public.transcript_assembly_publication_receipts;

  begin
    perform public.publish_transcript_assembly_revision_atomic(
      '44444444-4444-4444-8444-444444444444',
      '33333333-3333-4333-8333-333333333333',
      public.synthetic_assembly_publication_input(
        '85100000-0000-4000-8000-000000000099',
        null,
        2,
        'c'
      ),
      false
    );
  exception
    when others then
      if sqlerrm not like '%synthetic assembly publication event failure%' then
        raise;
      end if;
      v_failed := true;
  end;

  if not v_failed
     or (select count(*) from public.transcript_revisions) <> v_before_revisions
     or (select count(*) from public.transcript_revision_parts) <> v_before_parts
     or (select count(*) from public.transcript_assembly_publication_receipts) <> v_before_receipts then
    raise exception 'ASSEMBLY_ROLLBACK_LEFT_PARTIAL_STATE';
  end if;

  -- Audit is metadata-only; transcript text never appears there.
  if exists (
    select 1
    from public.audit_log a
    where a.action like 'transcript_revision.%'
      and (coalesce(a.old_value::text, '') || coalesce(a.new_value::text, ''))
        like '%parte %'
  ) then
    raise exception 'ASSEMBLY_AUDIT_LEAKED_TRANSCRIPT_CONTENT';
  end if;
end;
$main$;

drop trigger fail_assembly_publication_event on public.transcript_publication_events;
drop function public.fail_assembly_publication_event_on_probe();
drop function public.synthetic_assembly_publication_input(uuid, uuid, integer, text);

delete from public.transcript_publication_events
where campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
  and session_id = '22222222-2222-4222-8222-222222222222'::uuid;

delete from public.transcript_assembly_publication_receipts
where campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
  and session_id = '22222222-2222-4222-8222-222222222222'::uuid;

delete from public.transcript_revisions
where campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
  and session_id = '22222222-2222-4222-8222-222222222222'::uuid;

delete from public.audit_log
where campaign_id = '11111111-1111-4111-8111-111111111111'::uuid
  and session_id = '22222222-2222-4222-8222-222222222222'::uuid
  and action like 'transcript_revision.%';

delete from public.role_assignments
where id = '85100000-0000-4000-8000-000000000001'::uuid;

delete from public.role_permissions
where role_id = '55555555-5555-4555-8555-555555555555'::uuid
  and permission_action = 'campaign.transcript.publish';

delete from public.role_permissions
where role_id = '55555555-5555-4555-8555-555555555555'::uuid
  and permission_action = 'campaign.content.edit';

delete from public.permission_catalog
where action = 'campaign.content.edit';
