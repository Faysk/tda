-- #1574 synthetic-only v2/v3 private handoff, rollback-isolated.
begin;
create function public.synthetic_assembly_publication_input(
  p_operation_id uuid,
  p_expected_current_revision_id uuid,
  p_part_count integer,
  p_draft_char text default 'd',
  p_source_session_id text default 'fixture-source'
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
    'session_id', p_source_session_id,
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
    'sourceSessionId', p_source_session_id,
    'provenance', v_provenance,
    'baseTranscriptSha256', repeat('f', 64),
    'draftSha256', repeat(p_draft_char, 64),
    'payloadSha256', v_payload_sha256,
    'payloadJson', v_payload_json,
    'segmentCount', p_part_count
  );
end;
$$;


insert into public.role_permissions(role_id,permission_action) values ('55555555-5555-4555-8555-555555555555','campaign.transcript.publish') on conflict do nothing;
insert into public.role_assignments(id,profile_id,role_id,scope_type,scope_id,status,starts_at) values ('15740000-0000-4000-8000-000000000001','33333333-3333-4333-8333-333333333333','55555555-5555-4555-8555-555555555555','campaign','synthetic-campaign','active',now());
insert into public.permission_catalog(action,plane,description) values ('campaign.content.edit','narrative','Synthetic v3 child provenance contract') on conflict do nothing;
insert into public.role_permissions(role_id,permission_action) values ('55555555-5555-4555-8555-555555555555','campaign.content.edit') on conflict do nothing;

-- The budget is declared on the entry point, not a global/role setting.
do $probe$
declare v_input jsonb; v_payload jsonb; v_segments jsonb; v_json text; v_result jsonb; v_started timestamptz; v_provenance jsonb; v_parts jsonb; v_replay jsonb; v_bad jsonb;
begin
  v_input := public.synthetic_assembly_publication_input(gen_random_uuid(),null,2,'d','synthetic-large-8019');
  v_input := jsonb_set(v_input,'{sessionId}','null'::jsonb);
  v_payload := (v_input->>'payloadJson')::jsonb;
  select jsonb_agg((v_payload->'segments'->((i-1)%2)) || jsonb_build_object('assembly_segment_id',lpad(to_hex(i+10000),64,'0'),'segment_id',lpad(to_hex(i+10000),64,'0'),'source_segment_id','source-'||i,'start',i,'end',i+1,'absolute_time_state','trusted_absolute','absolute_start','2026-10-07T10:00:00Z','absolute_end','2026-10-07T10:00:01Z','absolute_time_source',v_payload->'segments'->((i-1)%2)->>'source_id') order by i) into v_segments from generate_series(1,8019) i;
  v_payload := jsonb_set(v_payload,'{segments}',v_segments);
  v_payload := jsonb_set(v_payload,'{review}',(v_payload->'review')||jsonb_build_object('total_segments',8019,'reviewed_segments',8019,'word_count',16038));
  v_provenance := v_payload->'provenance' || jsonb_build_object('canonicalization_version','tda_session_assembly_canonical_v3','timing_policy_version','tda_session_timeline_v2','timeline_strategy','trusted_absolute','wall_clock','trusted','unknown_interval_count',0);
  select jsonb_agg(value || jsonb_build_object('physical_interval_state',case when position=1 then 'first' else 'trusted_absolute' end) order by position) into v_parts from jsonb_array_elements(v_provenance->'parts') with ordinality raw(value,position);
  v_provenance := jsonb_set(v_provenance,'{parts}',v_parts);
  v_payload := jsonb_set(v_payload,'{provenance}',v_provenance);
  v_input := jsonb_set(v_input,'{provenance}',v_provenance);
  v_json := v_payload::text;
  v_input := v_input || jsonb_build_object('segmentCount',8019,'payloadJson',v_json,'payloadSha256',encode(extensions.digest(convert_to(v_json,'UTF8'),'sha256'),'hex'));
  set local role service_role;
  v_started := clock_timestamp();
  v_result := public.prepare_transcript_handoff_atomic('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','session_assembly',v_input,false);
  raise notice 'large synthetic handoff elapsed=% result=%',clock_timestamp()-v_started,v_result->>'ok';
  if v_result->>'ok' is distinct from 'true' or (v_result->'receipt'->>'segmentCount')::integer <> 8019 or (v_result->'receipt'->>'partCount')::integer <> 2 then raise exception 'LARGE_HANDOFF_FAILED:%',v_result; end if;
  v_replay := public.prepare_transcript_handoff_atomic('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','session_assembly',v_input,false);
  if v_replay is distinct from v_result then raise exception 'LARGE_HANDOFF_REPLAY_CHANGED'; end if;
  v_payload := jsonb_set(v_payload,'{segments,8018,absolute_end}','"invalid"'::jsonb);
  v_json := v_payload::text;
  v_bad := v_input || jsonb_build_object('operationId',gen_random_uuid(),'expectedCurrentRevisionId',(v_result->'receipt'->>'revisionId')::uuid,'payloadJson',v_json,'payloadSha256',encode(extensions.digest(convert_to(v_json,'UTF8'),'sha256'),'hex'));
  v_replay := public.prepare_transcript_handoff_atomic('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','session_assembly',v_bad,false);
  if v_replay->>'reason' is distinct from 'invalid_payload' or (select count(*) from public.transcript_revisions where source_session_id='synthetic-large-8019') <> 1 then raise exception 'LARGE_HANDOFF_INVALID_TAIL_COMMITTED'; end if;
end;
$probe$;
do $budget$
begin
  if not exists (select 1 from pg_proc where oid='public.prepare_transcript_handoff_atomic(uuid,uuid,text,jsonb,boolean)'::regprocedure and not prosecdef and proconfig @> array['statement_timeout=30s']) then raise exception 'HANDOFF_BUDGET_OR_INVOKER_CHANGED'; end if;
  if has_function_privilege('anon','public.prepare_transcript_handoff_atomic(uuid,uuid,text,jsonb,boolean)','execute') or has_function_privilege('authenticated','public.prepare_transcript_handoff_atomic(uuid,uuid,text,jsonb,boolean)','execute') or not has_function_privilege('service_role','public.prepare_transcript_handoff_atomic(uuid,uuid,text,jsonb,boolean)','execute') then raise exception 'HANDOFF_BUDGET_AUTH_CHANGED'; end if;
end;
$budget$;
rollback;

