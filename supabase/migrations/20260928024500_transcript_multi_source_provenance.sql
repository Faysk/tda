-- #851: additive multi-source provenance for immutable transcript publication.
-- Existing single-source request/payload/receipt v1 remains valid.

alter table public.transcript_revisions
  alter column source_id drop not null,
  alter column run_id drop not null,
  add column publication_kind text not null default 'single_source'
    check (publication_kind in ('single_source', 'session_assembly')),
  add column assembly_id text null check (assembly_id ~ '^[0-9a-f]{64}$'),
  add column assembly_schema_version text null
    check (assembly_schema_version = 'tda_session_assembly_v1'),
  add column assembly_inputs_sha256 text null
    check (assembly_inputs_sha256 ~ '^[0-9a-f]{64}$'),
  add column timeline_fingerprint_sha256 text null
    check (timeline_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  add column participant_mapping_sha256 text null
    check (participant_mapping_sha256 ~ '^[0-9a-f]{64}$');

alter table public.transcript_revisions
  add constraint transcript_revisions_publication_identity_check check (
    (
      publication_kind = 'single_source'
      and source_id is not null and run_id is not null
      and assembly_id is null and assembly_schema_version is null
      and assembly_inputs_sha256 is null
      and timeline_fingerprint_sha256 is null
      and participant_mapping_sha256 is null
    )
    or
    (
      publication_kind = 'session_assembly'
      and source_id is null and run_id is null
      and assembly_id is not null
      and assembly_schema_version = 'tda_session_assembly_v1'
      and assembly_inputs_sha256 = assembly_id
      and timeline_fingerprint_sha256 is not null
      and participant_mapping_sha256 is not null
    )
  );

alter table public.transcript_publication_receipts
  alter column source_id drop not null,
  alter column run_id drop not null,
  add column publication_kind text not null default 'single_source'
    check (publication_kind in ('single_source', 'session_assembly')),
  add column assembly_id text null check (assembly_id ~ '^[0-9a-f]{64}$'),
  add column part_count integer not null default 0 check (part_count between 0 and 64);

alter table public.transcript_publication_receipts
  add constraint transcript_publication_receipts_identity_check check (
    (
      publication_kind = 'single_source'
      and source_id is not null and run_id is not null
      and assembly_id is null and part_count = 0
    )
    or
    (
      publication_kind = 'session_assembly'
      and source_id is null and run_id is null
      and assembly_id is not null and part_count between 1 and 64
    )
  );

create table public.transcript_revision_parts (
  revision_id uuid not null references public.transcript_revisions(id) on delete cascade,
  ordinal smallint not null check (ordinal between 0 and 63),
  part_id text not null check (part_id ~ '^[0-9a-f]{32}$'),
  source_id text not null check (source_id ~ '^craig-[0-9a-f]{64}$'),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  run_id text not null check (run_id ~ '^[A-Za-z0-9_-]{1,196}$'),
  transcript_sha256 text not null check (transcript_sha256 ~ '^[0-9a-f]{64}$'),
  session_offset_seconds double precision not null
    check (session_offset_seconds between 0 and 604800),
  trim_start_seconds double precision not null
    check (trim_start_seconds between 0 and 604800),
  trim_end_seconds double precision null
    check (trim_end_seconds is null or trim_end_seconds between trim_start_seconds and 604800),
  overlap_resolution text null
    check (overlap_resolution is null or overlap_resolution in ('prefer_earlier_until','prefer_later_from')),
  overlap_boundary_seconds double precision null
    check (overlap_boundary_seconds is null or overlap_boundary_seconds between 0 and 604800),
  primary key (revision_id, ordinal),
  unique (revision_id, part_id),
  check ((overlap_resolution is null) = (overlap_boundary_seconds is null)),
  check (source_sha256 = substring(source_id from 7))
);

alter table public.transcript_revision_parts enable row level security;
revoke all on public.transcript_revision_parts from public, anon, authenticated, service_role;
grant select, insert on public.transcript_revision_parts to service_role;

comment on table public.transcript_revision_parts is
'Immutable ordered source/run provenance for Session Assembly transcript revisions. No raw audio, paths, tokens or transcript text are stored here.';

create or replace function public.publish_transcript_revision_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_input jsonb,
  p_lookup_only boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_session_id uuid;
  v_operation_id uuid;
  v_campaign_slug text;
  v_source_session_id text;
  v_publication_kind text;
  v_provenance jsonb;
  v_part_count integer;
  v_source_id text;
  v_run_id text;
  v_base_transcript_sha256 text;
  v_draft_sha256 text;
  v_payload_sha256 text;
  v_payload_json text;
  v_payload jsonb;
  v_lineage jsonb;
  v_review jsonb;
  v_segments jsonb;
  v_session public.sessions%rowtype;
  v_existing public.transcript_publication_receipts%rowtype;
  v_revision_id uuid;
  v_revision_number bigint;
  v_previous_revision_id uuid;
  v_action text;
  v_segment_count integer;
  v_word_count integer;
  v_reviewed_segments integer;
  v_warning_count integer;
  v_receipt_id uuid;
  v_segment jsonb;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or not exists (
       select 1
       from public.profiles p
       where p.id = p_actor_profile_id
         and p.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not exists (
    select 1
    from public.permission_catalog pc
    where pc.action = 'campaign.transcript.publish'
      and pc.plane = 'mixed'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'publish_capability_undefined');
  end if;

  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or p_lookup_only is null
     or exists (
       select 1
       from jsonb_object_keys(p_input) as k(key_name)
       where k.key_name not in (
         'campaignId',
         'sessionId',
         'operationId',
         'expectedCurrentRevisionId',
         'sourceSystem',
         'sourceSessionId',
         'publicationKind',
         'provenance',
         'sourceId',
         'runId',
         'baseTranscriptSha256',
         'draftSha256',
         'payloadSha256',
         'payloadJson',
         'segmentCount'
       )
     )
     or coalesce(p_input->>'campaignId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(p_input->>'sessionId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(p_input->>'operationId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or not (p_input ? 'expectedCurrentRevisionId')
     or (p_input->'expectedCurrentRevisionId' <> 'null'::jsonb and (jsonb_typeof(p_input->'expectedCurrentRevisionId') <> 'string' or (p_input->>'expectedCurrentRevisionId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
     or p_input->>'sourceSystem' is distinct from 'local_companion'
     or coalesce(p_input->>'sourceSessionId', '') !~ '^[A-Za-z0-9_-]{1,160}$'
     or coalesce(p_input->>'baseTranscriptSha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_input->>'draftSha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_input->>'payloadSha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_input->>'segmentCount', '') !~ '^[0-9]{1,6}$'
     or (p_input->>'segmentCount')::integer not between 1 and 100000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  v_campaign_id := (p_input->>'campaignId')::uuid;
  v_session_id := (p_input->>'sessionId')::uuid;
  v_operation_id := (p_input->>'operationId')::uuid;
  v_source_session_id := p_input->>'sourceSessionId';
  v_publication_kind := coalesce(p_input->>'publicationKind', 'single_source');

  if v_publication_kind = 'single_source' then
    if p_input ? 'publicationKind'
       or p_input ? 'provenance'
       or coalesce(p_input->>'sourceId', '') !~ '^craig-[0-9a-f]{64}
  v_draft_sha256 := p_input->>'draftSha256';
  v_payload_sha256 := p_input->>'payloadSha256';
  v_segment_count := (p_input->>'segmentCount')::integer;

  -- Authorization is intentionally resolved before target/session existence.
  select c.slug
  into v_campaign_slug
  from public.campaigns c
  where c.id = v_campaign_id
    and exists (
      select 1
      from public.role_assignments a
      join public.role_permissions rp on rp.role_id = a.role_id
      where a.profile_id = p_actor_profile_id
        and a.status = 'active'
        and a.starts_at <= clock_timestamp()
        and (a.ends_at is null or a.ends_at > clock_timestamp())
        and rp.permission_action = 'campaign.transcript.publish'
        and (
          (a.scope_type = 'campaign' and a.scope_id = c.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda')
        )
    );

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select s.*
  into v_session
  from public.sessions s
  where s.id = v_session_id
    and s.campaign_id = v_campaign_id
    and s.source_system = 'local_companion'
    and s.source_session_id = v_source_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select *
  into v_existing
  from public.transcript_publication_receipts r
  where r.session_id = v_session.id
    and r.operation_id = v_operation_id;

  if found then
    if v_existing.campaign_id <> v_campaign_id
       or v_existing.publication_kind is distinct from v_publication_kind
       or v_existing.source_id is distinct from v_source_id
       or v_existing.run_id is distinct from v_run_id
       or v_existing.assembly_id is distinct from
          case when v_publication_kind = 'session_assembly'
            then v_provenance->>'assembly_id'
            else null
          end
       or v_existing.part_count is distinct from v_part_count
       or v_existing.base_transcript_sha256 <> v_base_transcript_sha256
       or v_existing.draft_sha256 <> v_draft_sha256
       or v_existing.payload_sha256 <> v_payload_sha256
       or v_existing.segment_count <> v_segment_count then
      return jsonb_build_object('ok', false, 'reason', 'conflict');
    end if;

    select r.revision_number
    into v_revision_number
    from public.transcript_revisions r
    where r.id = v_existing.revision_id
      and r.session_id = v_session.id;

    if not found then
      raise exception 'publication receipt references a missing revision';
    end if;

    if v_existing.publication_kind = 'session_assembly' then
      return jsonb_build_object(
        'ok', true,
        'receipt', jsonb_build_object(
          'schemaVersion', 'tda_transcript_publication_receipt_v2',
          'status', 'committed',
          'receiptId', v_existing.id,
          'campaignId', v_existing.campaign_id,
          'sessionId', v_existing.session_id,
          'revisionId', v_existing.revision_id,
          'revisionNumber', v_revision_number,
          'operationId', v_existing.operation_id,
          'assemblyId', v_existing.assembly_id,
          'partCount', v_existing.part_count,
          'baseTranscriptSha256', v_existing.base_transcript_sha256,
          'draftSha256', v_existing.draft_sha256,
          'payloadSha256', v_existing.payload_sha256,
          'segmentCount', v_existing.segment_count,
          'wordCount', v_existing.word_count,
          'committedAt', v_existing.committed_at
        )
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'receipt', jsonb_build_object(
        'schemaVersion', 'tda_transcript_publication_receipt_v1',
        'status', 'committed',
        'receiptId', v_existing.id,
        'campaignId', v_existing.campaign_id,
        'sessionId', v_existing.session_id,
        'revisionId', v_existing.revision_id,
        'revisionNumber', v_revision_number,
        'operationId', v_existing.operation_id,
        'sourceId', v_existing.source_id,
        'runId', v_existing.run_id,
        'baseTranscriptSha256', v_existing.base_transcript_sha256,
        'draftSha256', v_existing.draft_sha256,
        'payloadSha256', v_existing.payload_sha256,
        'segmentCount', v_existing.segment_count,
        'wordCount', v_existing.word_count,
        'committedAt', v_existing.committed_at
      )
    );
  elsif p_lookup_only then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Replay/readback above precede CAS: a lost response remains recoverable.
  if v_session.current_transcript_revision_id is distinct from (p_input->>'expectedCurrentRevisionId')::uuid then
    return jsonb_build_object('ok', false, 'reason', 'stale_current');
  end if;

  if jsonb_typeof(p_input->'payloadJson') is distinct from 'string' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;
  v_payload_json := p_input->>'payloadJson';
  if btrim(v_payload_json) = ''
     or octet_length(v_payload_json) > 33554432
     or encode(
       extensions.digest(convert_to(v_payload_json, 'UTF8'), 'sha256'),
       'hex'
     ) <> v_payload_sha256 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  begin
    v_payload := v_payload_json::jsonb;
  exception
    when others then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end;

  if jsonb_typeof(v_payload) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if v_publication_kind = 'single_source' then
    if v_payload->>'schema_version' is distinct from 'tda_transcript_publication_v1'
       or exists (
         select 1 from jsonb_object_keys(v_payload) as k(key_name)
         where k.key_name not in (
           'schema_version','source_id','run_id','base_transcript_sha256',
           'draft_sha256','lineage','review','segments'
         )
       )
       or v_payload->>'source_id' is distinct from v_source_id
       or v_payload->>'run_id' is distinct from v_run_id
       or v_payload->>'base_transcript_sha256' is distinct from v_base_transcript_sha256
       or v_payload->>'draft_sha256' is distinct from v_draft_sha256
       or jsonb_typeof(v_payload->'lineage') is distinct from 'object'
       or jsonb_typeof(v_payload->'review') is distinct from 'object'
       or jsonb_typeof(v_payload->'segments') is distinct from 'array'
       or jsonb_array_length(v_payload->'segments') <> v_segment_count then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
  else
    if v_payload->>'schema_version' is distinct from 'tda_transcript_publication_v2'
       or exists (
         select 1 from jsonb_object_keys(v_payload) as k(key_name)
         where k.key_name not in (
           'schema_version','publication_kind','base_transcript_sha256',
           'draft_sha256','lineage','provenance','review','segments'
         )
       )
       or v_payload->>'publication_kind' is distinct from 'session_assembly'
       or v_payload->>'base_transcript_sha256' is distinct from v_base_transcript_sha256
       or v_payload->>'draft_sha256' is distinct from v_draft_sha256
       or jsonb_typeof(v_payload->'lineage') is distinct from 'object'
       or jsonb_typeof(v_payload->'provenance') is distinct from 'object'
       or v_payload->'provenance' is distinct from v_provenance
       or jsonb_typeof(v_payload->'review') is distinct from 'object'
       or jsonb_typeof(v_payload->'segments') is distinct from 'array'
       or jsonb_array_length(v_payload->'segments') <> v_segment_count then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if exists (
         select 1 from jsonb_object_keys(v_provenance) as k(key_name)
         where k.key_name not in (
           'schema_version','assembly_schema_version','canonicalization_version',
           'assembly_id','inputs_sha256','campaign_id','session_id',
           'transcript_sha256','timeline_fingerprint_sha256',
           'participant_mapping_sha256','parts'
         )
       )
       or v_provenance->>'schema_version' is distinct from 'tda_transcript_multi_source_provenance_v1'
       or v_provenance->>'assembly_schema_version' is distinct from 'tda_session_assembly_v1'
       or v_provenance->>'canonicalization_version' is distinct from 'tda_session_assembly_canonical_v1'
       or coalesce(v_provenance->>'assembly_id', '') !~ '^[0-9a-f]{64}$'
       or v_provenance->>'assembly_id' is distinct from v_provenance->>'inputs_sha256'
       or v_provenance->>'campaign_id' is distinct from v_campaign_slug
       or v_provenance->>'session_id' is distinct from v_source_session_id
       or coalesce(v_provenance->>'transcript_sha256', '') !~ '^[0-9a-f]{64}$'
       or v_provenance->>'transcript_sha256' is distinct from v_base_transcript_sha256
       or coalesce(v_provenance->>'timeline_fingerprint_sha256', '') !~ '^[0-9a-f]{64}$'
       or coalesce(v_provenance->>'participant_mapping_sha256', '') !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(v_provenance->'parts') is distinct from 'array'
       or v_part_count not between 1 and 64 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_provenance->'parts') with ordinality raw(value, position)
      where jsonb_typeof(raw.value) is distinct from 'object'
         or exists (
           select 1 from jsonb_object_keys(raw.value) as k(key_name)
           where k.key_name not in (
             'part_id','source_id','source_sha256','run_id','transcript_sha256',
             'ordinal','session_offset_seconds','trim_start_seconds','trim_end_seconds',
             'overlap_resolution','overlap_boundary_seconds'
           )
         )
         or coalesce(raw.value->>'part_id', '') !~ '^[0-9a-f]{32}$'
         or coalesce(raw.value->>'source_id', '') !~ '^craig-[0-9a-f]{64}$'
         or raw.value->>'source_sha256' is distinct from substring(raw.value->>'source_id' from 7)
         or coalesce(raw.value->>'run_id', '') !~ '^[A-Za-z0-9_-]{1,196}$'
         or coalesce(raw.value->>'transcript_sha256', '') !~ '^[0-9a-f]{64}$'
         or coalesce(raw.value->>'ordinal', '') !~ '^[0-9]{1,2}$'
         or (raw.value->>'ordinal')::integer <> position - 1
         or jsonb_typeof(raw.value->'session_offset_seconds') is distinct from 'number'
         or (raw.value->>'session_offset_seconds')::numeric not between 0 and 604800
         or jsonb_typeof(raw.value->'trim_start_seconds') is distinct from 'number'
         or (raw.value->>'trim_start_seconds')::numeric not between 0 and 604800
         or (
           raw.value->'trim_end_seconds' <> 'null'::jsonb
           and (
             jsonb_typeof(raw.value->'trim_end_seconds') is distinct from 'number'
             or (raw.value->>'trim_end_seconds')::numeric <
                (raw.value->>'trim_start_seconds')::numeric
             or (raw.value->>'trim_end_seconds')::numeric > 604800
           )
         )
         or (
           raw.value->'overlap_resolution' <> 'null'::jsonb
           and raw.value->>'overlap_resolution'
               not in ('prefer_earlier_until', 'prefer_later_from')
         )
         or (
           raw.value->'overlap_boundary_seconds' <> 'null'::jsonb
           and (
             jsonb_typeof(raw.value->'overlap_boundary_seconds') is distinct from 'number'
             or (raw.value->>'overlap_boundary_seconds')::numeric not between 0 and 604800
           )
         )
         or (
           (raw.value->'overlap_resolution' = 'null'::jsonb)
           <> (raw.value->'overlap_boundary_seconds' = 'null'::jsonb)
         )
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if (
      select count(distinct value->>'part_id')
      from jsonb_array_elements(v_provenance->'parts')
    ) <> v_part_count then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
  end if;

  v_lineage := v_payload->'lineage';
  v_review := v_payload->'review';
  v_segments := v_payload->'segments';

  if v_publication_kind = 'single_source' then
    if exists (
         select 1
         from jsonb_object_keys(v_lineage) as k(key_name)
         where k.key_name not in (
           'profile_id','engine','model','model_revision',
           'device','compute_type','alignment','completed_at'
         )
       )
       or jsonb_typeof(v_lineage->'profile_id') is distinct from 'string'
       or char_length(v_lineage->>'profile_id') not between 1 and 64
       or exists (
         select 1
         from jsonb_each(v_lineage) as e(key_name, value)
         where e.key_name <> 'profile_id'
           and jsonb_typeof(e.value) not in ('string', 'null')
       ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
  else
    if exists (
         select 1 from jsonb_object_keys(v_lineage) as k(key_name)
         where k.key_name not in ('kind','assembly_id','assembly_schema_version')
       )
       or v_lineage->>'kind' is distinct from 'session_assembly'
       or v_lineage->>'assembly_id' is distinct from v_provenance->>'assembly_id'
       or v_lineage->>'assembly_schema_version' is distinct from 'tda_session_assembly_v1'
    then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
  end if;

  if exists (
       select 1
       from jsonb_object_keys(v_review) as k(key_name)
       where k.key_name not in (
         'status',
         'draft_revision',
         'reviewed_segments',
         'total_segments',
         'warning_count',
         'word_count'
       )
     )
     or v_review->>'status' is distinct from 'approved_local'
     or coalesce(v_review->>'draft_revision', '') !~ '^[0-9]{1,12}$'
     or coalesce(v_review->>'reviewed_segments', '') !~ '^[0-9]{1,6}$'
     or coalesce(v_review->>'total_segments', '') !~ '^[0-9]{1,6}$'
     or coalesce(v_review->>'warning_count', '') !~ '^[0-9]{1,9}$'
     or coalesce(v_review->>'word_count', '') !~ '^[0-9]{1,9}$'
     or (v_review->>'total_segments')::integer <> v_segment_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_segments) raw(value)
    where jsonb_typeof(raw.value) is distinct from 'object'
       or exists (
         select 1
         from jsonb_object_keys(raw.value) as k(key_name)
         where k.key_name not in (
           'track_number',
           'segment_id',
           'start',
           'end',
           'text',
           'speaker',
           'reviewed'
         )
       )
       or jsonb_typeof(raw.value->'track_number') is distinct from 'number'
       or jsonb_typeof(raw.value->'segment_id') is distinct from 'string'
       or jsonb_typeof(raw.value->'start') is distinct from 'number'
       or jsonb_typeof(raw.value->'end') is distinct from 'number'
       or jsonb_typeof(raw.value->'text') is distinct from 'string'
       or jsonb_typeof(raw.value->'speaker') is distinct from 'string'
       or jsonb_typeof(raw.value->'reviewed') is distinct from 'boolean'
       or coalesce(raw.value->>'track_number', '') !~ '^[0-9]{1,4}$'
       or (raw.value->>'track_number')::integer < 1
       or char_length(raw.value->>'segment_id') not between 1 and 256
       or char_length(btrim(raw.value->>'text')) not between 1 and 100000
       or char_length(btrim(raw.value->>'speaker')) not between 1 and 160
       or (raw.value->>'start')::numeric < 0
       or (raw.value->>'end')::numeric < (raw.value->>'start')::numeric
       or (raw.value->>'end')::numeric > 604800
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if (
    select count(*)
    from (
      select
        (value->>'track_number')::integer,
        value->>'segment_id'
      from jsonb_array_elements(v_segments)
      group by 1, 2
    ) unique_segments
  ) <> v_segment_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select
    count(*) filter (where (value->>'reviewed')::boolean),
    coalesce(
      sum(
        cardinality(
          regexp_split_to_array(btrim(value->>'text'), E'\\s+')
        )
      ),
      0
    )
  into v_reviewed_segments, v_word_count
  from jsonb_array_elements(v_segments);

  v_warning_count := (v_review->>'warning_count')::integer;

  if (v_review->>'reviewed_segments')::integer <> v_reviewed_segments
     or (v_review->>'word_count')::integer <> v_word_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select coalesce(max(r.revision_number), 0) + 1
  into v_revision_number
  from public.transcript_revisions r
  where r.session_id = v_session.id;

  v_revision_id := gen_random_uuid();
  v_previous_revision_id := v_session.current_transcript_revision_id;
  v_action := case
    when v_previous_revision_id is null then 'publish'
    else 'replace'
  end;

  insert into public.transcript_revisions (
    id,
    campaign_id,
    session_id,
    revision_number,
    operation_id,
    source_system,
    source_session_id,
    publication_kind,
    source_id,
    run_id,
    assembly_id,
    assembly_schema_version,
    assembly_inputs_sha256,
    timeline_fingerprint_sha256,
    participant_mapping_sha256,
    base_transcript_sha256,
    draft_sha256,
    payload_sha256,
    segment_count,
    word_count,
    reviewed_segments,
    warning_count,
    lineage,
    review_summary,
    segments,
    actor_profile_id
  ) values (
    v_revision_id,
    v_campaign_id,
    v_session.id,
    v_revision_number,
    v_operation_id,
    'local_companion',
    v_source_session_id,
    v_publication_kind,
    v_source_id,
    v_run_id,
    case when v_publication_kind = 'session_assembly' then v_provenance->>'assembly_id' else null end,
    case when v_publication_kind = 'session_assembly' then v_provenance->>'assembly_schema_version' else null end,
    case when v_publication_kind = 'session_assembly' then v_provenance->>'inputs_sha256' else null end,
    case when v_publication_kind = 'session_assembly' then v_provenance->>'timeline_fingerprint_sha256' else null end,
    case when v_publication_kind = 'session_assembly' then v_provenance->>'participant_mapping_sha256' else null end,
    v_base_transcript_sha256,
    v_draft_sha256,
    v_payload_sha256,
    v_segment_count,
    v_word_count,
    v_reviewed_segments,
    v_warning_count,
    v_lineage,
    v_review,
    v_segments,
    p_actor_profile_id
  );

  if v_publication_kind = 'session_assembly' then
    insert into public.transcript_revision_parts (
      revision_id, ordinal, part_id, source_id, source_sha256, run_id,
      transcript_sha256, session_offset_seconds, trim_start_seconds,
      trim_end_seconds, overlap_resolution, overlap_boundary_seconds
    )
    select
      v_revision_id,
      (part.value->>'ordinal')::smallint,
      part.value->>'part_id',
      part.value->>'source_id',
      part.value->>'source_sha256',
      part.value->>'run_id',
      part.value->>'transcript_sha256',
      (part.value->>'session_offset_seconds')::double precision,
      (part.value->>'trim_start_seconds')::double precision,
      case when part.value->'trim_end_seconds' = 'null'::jsonb
        then null else (part.value->>'trim_end_seconds')::double precision end,
      case when part.value->'overlap_resolution' = 'null'::jsonb
        then null else part.value->>'overlap_resolution' end,
      case when part.value->'overlap_boundary_seconds' = 'null'::jsonb
        then null else (part.value->>'overlap_boundary_seconds')::double precision end
    from jsonb_array_elements(v_provenance->'parts') with ordinality part(value, position)
    order by position;
  end if;

  v_receipt_id := gen_random_uuid();
  insert into public.transcript_publication_receipts (
    id,
    campaign_id,
    session_id,
    revision_id,
    operation_id,
    publication_kind,
    source_id,
    run_id,
    assembly_id,
    part_count,
    base_transcript_sha256,
    draft_sha256,
    payload_sha256,
    segment_count,
    word_count,
    actor_profile_id
  ) values (
    v_receipt_id,
    v_campaign_id,
    v_session.id,
    v_revision_id,
    v_operation_id,
    v_publication_kind,
    v_source_id,
    v_run_id,
    case when v_publication_kind = 'session_assembly' then v_provenance->>'assembly_id' else null end,
    v_part_count,
    v_base_transcript_sha256,
    v_draft_sha256,
    v_payload_sha256,
    v_segment_count,
    v_word_count,
    p_actor_profile_id
  )
  returning * into v_existing;

  update public.sessions
  set current_transcript_revision_id = v_revision_id
  where id = v_session.id;

  insert into public.transcript_publication_events (
    campaign_id,
    session_id,
    operation_id,
    action,
    revision_id,
    previous_revision_id,
    actor_profile_id
  ) values (
    v_campaign_id,
    v_session.id,
    v_operation_id,
    v_action,
    v_revision_id,
    v_previous_revision_id,
    p_actor_profile_id
  );

  insert into public.audit_log (
    campaign_id,
    session_id,
    actor_id,
    action,
    table_name,
    record_id,
    old_value,
    new_value
  ) values (
    v_campaign_id,
    v_session.id,
    p_actor_profile_id,
    'transcript_revision.' || v_action,
    'transcript_revisions',
    v_revision_id,
    jsonb_build_object(
      'current_revision_id',
      v_previous_revision_id
    ),
    jsonb_build_object(
      'current_revision_id',
      v_revision_id,
      'revision_number',
      v_revision_number,
      'publication_kind',
      v_publication_kind,
      'source_id',
      v_source_id,
      'run_id',
      v_run_id,
      'assembly_id',
      case when v_publication_kind = 'session_assembly' then v_provenance->>'assembly_id' else null end,
      'part_count',
      v_part_count,
      'payload_sha256',
      v_payload_sha256,
      'segment_count',
      v_segment_count,
      'word_count',
      v_word_count
    )
  );

  return jsonb_build_object(
    'ok', true,
    'receipt', jsonb_build_object(
      'schemaVersion', 'tda_transcript_publication_receipt_v1',
      'status', 'committed',
      'receiptId', v_existing.id,
      'campaignId', v_existing.campaign_id,
      'sessionId', v_existing.session_id,
      'revisionId', v_existing.revision_id,
      'revisionNumber', v_revision_number,
      'operationId', v_existing.operation_id,
      'sourceId', v_existing.source_id,
      'runId', v_existing.run_id,
      'baseTranscriptSha256', v_existing.base_transcript_sha256,
      'draftSha256', v_existing.draft_sha256,
      'payloadSha256', v_existing.payload_sha256,
      'segmentCount', v_existing.segment_count,
      'wordCount', v_existing.word_count,
      'committedAt', v_existing.committed_at
    )
  );
end;
$$;

revoke all on function public.publish_transcript_revision_atomic(uuid, uuid, jsonb, boolean)
from public, anon, authenticated;
grant execute on function public.publish_transcript_revision_atomic(uuid, uuid, jsonb, boolean)
to service_role;

comment on function public.publish_transcript_revision_atomic(uuid, uuid, jsonb, boolean) is
'Server-only boundary for immutable single-source or Session Assembly transcript revisions. Revision, ordered provenance parts, receipt, current pointer, event and sanitized audit commit atomically; replay is idempotent.';
       or coalesce(p_input->>'runId', '') !~ '^[A-Za-z0-9_-]{1,196}
  v_draft_sha256 := p_input->>'draftSha256';
  v_payload_sha256 := p_input->>'payloadSha256';
  v_segment_count := (p_input->>'segmentCount')::integer;

  -- Authorization is intentionally resolved before target/session existence.
  select c.slug
  into v_campaign_slug
  from public.campaigns c
  where c.id = v_campaign_id
    and exists (
      select 1
      from public.role_assignments a
      join public.role_permissions rp on rp.role_id = a.role_id
      where a.profile_id = p_actor_profile_id
        and a.status = 'active'
        and a.starts_at <= clock_timestamp()
        and (a.ends_at is null or a.ends_at > clock_timestamp())
        and rp.permission_action = 'campaign.transcript.publish'
        and (
          (a.scope_type = 'campaign' and a.scope_id = c.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda')
        )
    );

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select s.*
  into v_session
  from public.sessions s
  where s.id = v_session_id
    and s.campaign_id = v_campaign_id
    and s.source_system = 'local_companion'
    and s.source_session_id = v_source_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select *
  into v_existing
  from public.transcript_publication_receipts r
  where r.session_id = v_session.id
    and r.operation_id = v_operation_id;

  if found then
    if v_existing.campaign_id <> v_campaign_id
       or v_existing.source_id <> v_source_id
       or v_existing.run_id <> v_run_id
       or v_existing.base_transcript_sha256 <> v_base_transcript_sha256
       or v_existing.draft_sha256 <> v_draft_sha256
       or v_existing.payload_sha256 <> v_payload_sha256
       or v_existing.segment_count <> v_segment_count then
      return jsonb_build_object('ok', false, 'reason', 'conflict');
    end if;

    select r.revision_number
    into v_revision_number
    from public.transcript_revisions r
    where r.id = v_existing.revision_id
      and r.session_id = v_session.id;

    if not found then
      raise exception 'publication receipt references a missing revision';
    end if;

    return jsonb_build_object(
      'ok', true,
      'receipt', jsonb_build_object(
        'schemaVersion', 'tda_transcript_publication_receipt_v1',
        'status', 'committed',
        'receiptId', v_existing.id,
        'campaignId', v_existing.campaign_id,
        'sessionId', v_existing.session_id,
        'revisionId', v_existing.revision_id,
        'revisionNumber', v_revision_number,
        'operationId', v_existing.operation_id,
        'sourceId', v_existing.source_id,
        'runId', v_existing.run_id,
        'baseTranscriptSha256', v_existing.base_transcript_sha256,
        'draftSha256', v_existing.draft_sha256,
        'payloadSha256', v_existing.payload_sha256,
        'segmentCount', v_existing.segment_count,
        'wordCount', v_existing.word_count,
        'committedAt', v_existing.committed_at
      )
    );
  elsif p_lookup_only then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Replay/readback above precede CAS: a lost response remains recoverable.
  if v_session.current_transcript_revision_id is distinct from (p_input->>'expectedCurrentRevisionId')::uuid then
    return jsonb_build_object('ok', false, 'reason', 'stale_current');
  end if;

  if jsonb_typeof(p_input->'payloadJson') is distinct from 'string' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;
  v_payload_json := p_input->>'payloadJson';
  if btrim(v_payload_json) = ''
     or octet_length(v_payload_json) > 33554432
     or encode(
       extensions.digest(convert_to(v_payload_json, 'UTF8'), 'sha256'),
       'hex'
     ) <> v_payload_sha256 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  begin
    v_payload := v_payload_json::jsonb;
  exception
    when others then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end;

  if jsonb_typeof(v_payload) is distinct from 'object'
     or v_payload->>'schema_version' is distinct from 'tda_transcript_publication_v1'
     or exists (
       select 1
       from jsonb_object_keys(v_payload) as k(key_name)
       where k.key_name not in (
         'schema_version',
         'source_id',
         'run_id',
         'base_transcript_sha256',
         'draft_sha256',
         'lineage',
         'review',
         'segments'
       )
     )
     or v_payload->>'source_id' is distinct from v_source_id
     or v_payload->>'run_id' is distinct from v_run_id
     or v_payload->>'base_transcript_sha256' is distinct from v_base_transcript_sha256
     or v_payload->>'draft_sha256' is distinct from v_draft_sha256
     or jsonb_typeof(v_payload->'lineage') is distinct from 'object'
     or jsonb_typeof(v_payload->'review') is distinct from 'object'
     or jsonb_typeof(v_payload->'segments') is distinct from 'array'
     or jsonb_array_length(v_payload->'segments') <> v_segment_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  v_lineage := v_payload->'lineage';
  v_review := v_payload->'review';
  v_segments := v_payload->'segments';

  if exists (
       select 1
       from jsonb_object_keys(v_lineage) as k(key_name)
       where k.key_name not in (
         'profile_id',
         'engine',
         'model',
         'model_revision',
         'device',
         'compute_type',
         'alignment',
         'completed_at'
       )
     )
     or jsonb_typeof(v_lineage->'profile_id') is distinct from 'string'
     or char_length(v_lineage->>'profile_id') not between 1 and 64
     or exists (
       select 1
       from jsonb_each(v_lineage) as e(key_name, value)
       where e.key_name <> 'profile_id'
         and jsonb_typeof(e.value) not in ('string', 'null')
     ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if exists (
       select 1
       from jsonb_object_keys(v_review) as k(key_name)
       where k.key_name not in (
         'status',
         'draft_revision',
         'reviewed_segments',
         'total_segments',
         'warning_count',
         'word_count'
       )
     )
     or v_review->>'status' is distinct from 'approved_local'
     or coalesce(v_review->>'draft_revision', '') !~ '^[0-9]{1,12}$'
     or coalesce(v_review->>'reviewed_segments', '') !~ '^[0-9]{1,6}$'
     or coalesce(v_review->>'total_segments', '') !~ '^[0-9]{1,6}$'
     or coalesce(v_review->>'warning_count', '') !~ '^[0-9]{1,9}$'
     or coalesce(v_review->>'word_count', '') !~ '^[0-9]{1,9}$'
     or (v_review->>'total_segments')::integer <> v_segment_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_segments) raw(value)
    where jsonb_typeof(raw.value) is distinct from 'object'
       or exists (
         select 1
         from jsonb_object_keys(raw.value) as k(key_name)
         where k.key_name not in (
           'track_number',
           'segment_id',
           'start',
           'end',
           'text',
           'speaker',
           'reviewed'
         )
       )
       or jsonb_typeof(raw.value->'track_number') is distinct from 'number'
       or jsonb_typeof(raw.value->'segment_id') is distinct from 'string'
       or jsonb_typeof(raw.value->'start') is distinct from 'number'
       or jsonb_typeof(raw.value->'end') is distinct from 'number'
       or jsonb_typeof(raw.value->'text') is distinct from 'string'
       or jsonb_typeof(raw.value->'speaker') is distinct from 'string'
       or jsonb_typeof(raw.value->'reviewed') is distinct from 'boolean'
       or coalesce(raw.value->>'track_number', '') !~ '^[0-9]{1,4}$'
       or (raw.value->>'track_number')::integer < 1
       or char_length(raw.value->>'segment_id') not between 1 and 256
       or char_length(btrim(raw.value->>'text')) not between 1 and 100000
       or char_length(btrim(raw.value->>'speaker')) not between 1 and 160
       or (raw.value->>'start')::numeric < 0
       or (raw.value->>'end')::numeric < (raw.value->>'start')::numeric
       or (raw.value->>'end')::numeric > 604800
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if (
    select count(*)
    from (
      select
        (value->>'track_number')::integer,
        value->>'segment_id'
      from jsonb_array_elements(v_segments)
      group by 1, 2
    ) unique_segments
  ) <> v_segment_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select
    count(*) filter (where (value->>'reviewed')::boolean),
    coalesce(
      sum(
        cardinality(
          regexp_split_to_array(btrim(value->>'text'), E'\\s+')
        )
      ),
      0
    )
  into v_reviewed_segments, v_word_count
  from jsonb_array_elements(v_segments);

  v_warning_count := (v_review->>'warning_count')::integer;

  if (v_review->>'reviewed_segments')::integer <> v_reviewed_segments
     or (v_review->>'word_count')::integer <> v_word_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select coalesce(max(r.revision_number), 0) + 1
  into v_revision_number
  from public.transcript_revisions r
  where r.session_id = v_session.id;

  v_revision_id := gen_random_uuid();
  v_previous_revision_id := v_session.current_transcript_revision_id;
  v_action := case
    when v_previous_revision_id is null then 'publish'
    else 'replace'
  end;

  insert into public.transcript_revisions (
    id,
    campaign_id,
    session_id,
    revision_number,
    operation_id,
    source_system,
    source_session_id,
    source_id,
    run_id,
    base_transcript_sha256,
    draft_sha256,
    payload_sha256,
    segment_count,
    word_count,
    reviewed_segments,
    warning_count,
    lineage,
    review_summary,
    segments,
    actor_profile_id
  ) values (
    v_revision_id,
    v_campaign_id,
    v_session.id,
    v_revision_number,
    v_operation_id,
    'local_companion',
    v_source_session_id,
    v_source_id,
    v_run_id,
    v_base_transcript_sha256,
    v_draft_sha256,
    v_payload_sha256,
    v_segment_count,
    v_word_count,
    v_reviewed_segments,
    v_warning_count,
    v_lineage,
    v_review,
    v_segments,
    p_actor_profile_id
  );

  v_receipt_id := gen_random_uuid();
  insert into public.transcript_publication_receipts (
    id,
    campaign_id,
    session_id,
    revision_id,
    operation_id,
    source_id,
    run_id,
    base_transcript_sha256,
    draft_sha256,
    payload_sha256,
    segment_count,
    word_count,
    actor_profile_id
  ) values (
    v_receipt_id,
    v_campaign_id,
    v_session.id,
    v_revision_id,
    v_operation_id,
    v_source_id,
    v_run_id,
    v_base_transcript_sha256,
    v_draft_sha256,
    v_payload_sha256,
    v_segment_count,
    v_word_count,
    p_actor_profile_id
  )
  returning * into v_existing;

  update public.sessions
  set current_transcript_revision_id = v_revision_id
  where id = v_session.id;

  insert into public.transcript_publication_events (
    campaign_id,
    session_id,
    operation_id,
    action,
    revision_id,
    previous_revision_id,
    actor_profile_id
  ) values (
    v_campaign_id,
    v_session.id,
    v_operation_id,
    v_action,
    v_revision_id,
    v_previous_revision_id,
    p_actor_profile_id
  );

  insert into public.audit_log (
    campaign_id,
    session_id,
    actor_id,
    action,
    table_name,
    record_id,
    old_value,
    new_value
  ) values (
    v_campaign_id,
    v_session.id,
    p_actor_profile_id,
    'transcript_revision.' || v_action,
    'transcript_revisions',
    v_revision_id,
    jsonb_build_object(
      'current_revision_id',
      v_previous_revision_id
    ),
    jsonb_build_object(
      'current_revision_id',
      v_revision_id,
      'revision_number',
      v_revision_number,
      'source_id',
      v_source_id,
      'run_id',
      v_run_id,
      'payload_sha256',
      v_payload_sha256,
      'segment_count',
      v_segment_count,
      'word_count',
      v_word_count
    )
  );

  return jsonb_build_object(
    'ok', true,
    'receipt', jsonb_build_object(
      'schemaVersion', 'tda_transcript_publication_receipt_v1',
      'status', 'committed',
      'receiptId', v_existing.id,
      'campaignId', v_existing.campaign_id,
      'sessionId', v_existing.session_id,
      'revisionId', v_existing.revision_id,
      'revisionNumber', v_revision_number,
      'operationId', v_existing.operation_id,
      'sourceId', v_existing.source_id,
      'runId', v_existing.run_id,
      'baseTranscriptSha256', v_existing.base_transcript_sha256,
      'draftSha256', v_existing.draft_sha256,
      'payloadSha256', v_existing.payload_sha256,
      'segmentCount', v_existing.segment_count,
      'wordCount', v_existing.word_count,
      'committedAt', v_existing.committed_at
    )
  );
end;
$$;

revoke all on function public.publish_transcript_revision_atomic(uuid, uuid, jsonb, boolean)
from public, anon, authenticated;
grant execute on function public.publish_transcript_revision_atomic(uuid, uuid, jsonb, boolean)
to service_role;

comment on function public.publish_transcript_revision_atomic(uuid, uuid, jsonb, boolean) is
'Candidate-only server boundary for an immutable complete transcript revision. Authorization precedes session lookup. Revision, receipt, current pointer, event and sanitized audit commit atomically; replay of the same operation is idempotent.'; then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    v_source_id := p_input->>'sourceId';
    v_run_id := p_input->>'runId';
    v_provenance := null;
    v_part_count := 0;
  elsif v_publication_kind = 'session_assembly' then
    if p_input ? 'sourceId'
       or p_input ? 'runId'
       or jsonb_typeof(p_input->'provenance') is distinct from 'object' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    v_source_id := null;
    v_run_id := null;
    v_provenance := p_input->'provenance';
    v_part_count := case
      when jsonb_typeof(v_provenance->'parts') = 'array'
      then jsonb_array_length(v_provenance->'parts')
      else 0
    end;
  else
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  v_base_transcript_sha256 := p_input->>'baseTranscriptSha256';
  v_draft_sha256 := p_input->>'draftSha256';
  v_payload_sha256 := p_input->>'payloadSha256';
  v_segment_count := (p_input->>'segmentCount')::integer;

  -- Authorization is intentionally resolved before target/session existence.
  select c.slug
  into v_campaign_slug
  from public.campaigns c
  where c.id = v_campaign_id
    and exists (
      select 1
      from public.role_assignments a
      join public.role_permissions rp on rp.role_id = a.role_id
      where a.profile_id = p_actor_profile_id
        and a.status = 'active'
        and a.starts_at <= clock_timestamp()
        and (a.ends_at is null or a.ends_at > clock_timestamp())
        and rp.permission_action = 'campaign.transcript.publish'
        and (
          (a.scope_type = 'campaign' and a.scope_id = c.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda')
        )
    );

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select s.*
  into v_session
  from public.sessions s
  where s.id = v_session_id
    and s.campaign_id = v_campaign_id
    and s.source_system = 'local_companion'
    and s.source_session_id = v_source_session_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select *
  into v_existing
  from public.transcript_publication_receipts r
  where r.session_id = v_session.id
    and r.operation_id = v_operation_id;

  if found then
    if v_existing.campaign_id <> v_campaign_id
       or v_existing.source_id <> v_source_id
       or v_existing.run_id <> v_run_id
       or v_existing.base_transcript_sha256 <> v_base_transcript_sha256
       or v_existing.draft_sha256 <> v_draft_sha256
       or v_existing.payload_sha256 <> v_payload_sha256
       or v_existing.segment_count <> v_segment_count then
      return jsonb_build_object('ok', false, 'reason', 'conflict');
    end if;

    select r.revision_number
    into v_revision_number
    from public.transcript_revisions r
    where r.id = v_existing.revision_id
      and r.session_id = v_session.id;

    if not found then
      raise exception 'publication receipt references a missing revision';
    end if;

  if v_existing.publication_kind = 'session_assembly' then
    return jsonb_build_object(
      'ok', true,
      'receipt', jsonb_build_object(
        'schemaVersion', 'tda_transcript_publication_receipt_v2',
        'status', 'committed',
        'receiptId', v_existing.id,
        'campaignId', v_existing.campaign_id,
        'sessionId', v_existing.session_id,
        'revisionId', v_existing.revision_id,
        'revisionNumber', v_revision_number,
        'operationId', v_existing.operation_id,
        'assemblyId', v_existing.assembly_id,
        'partCount', v_existing.part_count,
        'baseTranscriptSha256', v_existing.base_transcript_sha256,
        'draftSha256', v_existing.draft_sha256,
        'payloadSha256', v_existing.payload_sha256,
        'segmentCount', v_existing.segment_count,
        'wordCount', v_existing.word_count,
        'committedAt', v_existing.committed_at
      )
    );
  end if;

    return jsonb_build_object(
      'ok', true,
      'receipt', jsonb_build_object(
        'schemaVersion', 'tda_transcript_publication_receipt_v1',
        'status', 'committed',
        'receiptId', v_existing.id,
        'campaignId', v_existing.campaign_id,
        'sessionId', v_existing.session_id,
        'revisionId', v_existing.revision_id,
        'revisionNumber', v_revision_number,
        'operationId', v_existing.operation_id,
        'sourceId', v_existing.source_id,
        'runId', v_existing.run_id,
        'baseTranscriptSha256', v_existing.base_transcript_sha256,
        'draftSha256', v_existing.draft_sha256,
        'payloadSha256', v_existing.payload_sha256,
        'segmentCount', v_existing.segment_count,
        'wordCount', v_existing.word_count,
        'committedAt', v_existing.committed_at
      )
    );
  elsif p_lookup_only then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Replay/readback above precede CAS: a lost response remains recoverable.
  if v_session.current_transcript_revision_id is distinct from (p_input->>'expectedCurrentRevisionId')::uuid then
    return jsonb_build_object('ok', false, 'reason', 'stale_current');
  end if;

  if jsonb_typeof(p_input->'payloadJson') is distinct from 'string' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;
  v_payload_json := p_input->>'payloadJson';
  if btrim(v_payload_json) = ''
     or octet_length(v_payload_json) > 33554432
     or encode(
       extensions.digest(convert_to(v_payload_json, 'UTF8'), 'sha256'),
       'hex'
     ) <> v_payload_sha256 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  begin
    v_payload := v_payload_json::jsonb;
  exception
    when others then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end;

  if jsonb_typeof(v_payload) is distinct from 'object'
     or v_payload->>'schema_version' is distinct from 'tda_transcript_publication_v1'
     or exists (
       select 1
       from jsonb_object_keys(v_payload) as k(key_name)
       where k.key_name not in (
         'schema_version',
         'source_id',
         'run_id',
         'base_transcript_sha256',
         'draft_sha256',
         'lineage',
         'review',
         'segments'
       )
     )
     or v_payload->>'source_id' is distinct from v_source_id
     or v_payload->>'run_id' is distinct from v_run_id
     or v_payload->>'base_transcript_sha256' is distinct from v_base_transcript_sha256
     or v_payload->>'draft_sha256' is distinct from v_draft_sha256
     or jsonb_typeof(v_payload->'lineage') is distinct from 'object'
     or jsonb_typeof(v_payload->'review') is distinct from 'object'
     or jsonb_typeof(v_payload->'segments') is distinct from 'array'
     or jsonb_array_length(v_payload->'segments') <> v_segment_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  v_lineage := v_payload->'lineage';
  v_review := v_payload->'review';
  v_segments := v_payload->'segments';

  if exists (
       select 1
       from jsonb_object_keys(v_lineage) as k(key_name)
       where k.key_name not in (
         'profile_id',
         'engine',
         'model',
         'model_revision',
         'device',
         'compute_type',
         'alignment',
         'completed_at'
       )
     )
     or jsonb_typeof(v_lineage->'profile_id') is distinct from 'string'
     or char_length(v_lineage->>'profile_id') not between 1 and 64
     or exists (
       select 1
       from jsonb_each(v_lineage) as e(key_name, value)
       where e.key_name <> 'profile_id'
         and jsonb_typeof(e.value) not in ('string', 'null')
     ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if exists (
       select 1
       from jsonb_object_keys(v_review) as k(key_name)
       where k.key_name not in (
         'status',
         'draft_revision',
         'reviewed_segments',
         'total_segments',
         'warning_count',
         'word_count'
       )
     )
     or v_review->>'status' is distinct from 'approved_local'
     or coalesce(v_review->>'draft_revision', '') !~ '^[0-9]{1,12}$'
     or coalesce(v_review->>'reviewed_segments', '') !~ '^[0-9]{1,6}$'
     or coalesce(v_review->>'total_segments', '') !~ '^[0-9]{1,6}$'
     or coalesce(v_review->>'warning_count', '') !~ '^[0-9]{1,9}$'
     or coalesce(v_review->>'word_count', '') !~ '^[0-9]{1,9}$'
     or (v_review->>'total_segments')::integer <> v_segment_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_segments) raw(value)
    where jsonb_typeof(raw.value) is distinct from 'object'
       or exists (
         select 1
         from jsonb_object_keys(raw.value) as k(key_name)
         where k.key_name not in (
           'track_number',
           'segment_id',
           'start',
           'end',
           'text',
           'speaker',
           'reviewed'
         )
       )
       or jsonb_typeof(raw.value->'track_number') is distinct from 'number'
       or jsonb_typeof(raw.value->'segment_id') is distinct from 'string'
       or jsonb_typeof(raw.value->'start') is distinct from 'number'
       or jsonb_typeof(raw.value->'end') is distinct from 'number'
       or jsonb_typeof(raw.value->'text') is distinct from 'string'
       or jsonb_typeof(raw.value->'speaker') is distinct from 'string'
       or jsonb_typeof(raw.value->'reviewed') is distinct from 'boolean'
       or coalesce(raw.value->>'track_number', '') !~ '^[0-9]{1,4}$'
       or (raw.value->>'track_number')::integer < 1
       or char_length(raw.value->>'segment_id') not between 1 and 256
       or char_length(btrim(raw.value->>'text')) not between 1 and 100000
       or char_length(btrim(raw.value->>'speaker')) not between 1 and 160
       or (raw.value->>'start')::numeric < 0
       or (raw.value->>'end')::numeric < (raw.value->>'start')::numeric
       or (raw.value->>'end')::numeric > 604800
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if (
    select count(*)
    from (
      select
        (value->>'track_number')::integer,
        value->>'segment_id'
      from jsonb_array_elements(v_segments)
      group by 1, 2
    ) unique_segments
  ) <> v_segment_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select
    count(*) filter (where (value->>'reviewed')::boolean),
    coalesce(
      sum(
        cardinality(
          regexp_split_to_array(btrim(value->>'text'), E'\\s+')
        )
      ),
      0
    )
  into v_reviewed_segments, v_word_count
  from jsonb_array_elements(v_segments);

  v_warning_count := (v_review->>'warning_count')::integer;

  if (v_review->>'reviewed_segments')::integer <> v_reviewed_segments
     or (v_review->>'word_count')::integer <> v_word_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select coalesce(max(r.revision_number), 0) + 1
  into v_revision_number
  from public.transcript_revisions r
  where r.session_id = v_session.id;

  v_revision_id := gen_random_uuid();
  v_previous_revision_id := v_session.current_transcript_revision_id;
  v_action := case
    when v_previous_revision_id is null then 'publish'
    else 'replace'
  end;

  insert into public.transcript_revisions (
    id,
    campaign_id,
    session_id,
    revision_number,
    operation_id,
    source_system,
    source_session_id,
    source_id,
    run_id,
    base_transcript_sha256,
    draft_sha256,
    payload_sha256,
    segment_count,
    word_count,
    reviewed_segments,
    warning_count,
    lineage,
    review_summary,
    segments,
    actor_profile_id
  ) values (
    v_revision_id,
    v_campaign_id,
    v_session.id,
    v_revision_number,
    v_operation_id,
    'local_companion',
    v_source_session_id,
    v_source_id,
    v_run_id,
    v_base_transcript_sha256,
    v_draft_sha256,
    v_payload_sha256,
    v_segment_count,
    v_word_count,
    v_reviewed_segments,
    v_warning_count,
    v_lineage,
    v_review,
    v_segments,
    p_actor_profile_id
  );

  v_receipt_id := gen_random_uuid();
  insert into public.transcript_publication_receipts (
    id,
    campaign_id,
    session_id,
    revision_id,
    operation_id,
    source_id,
    run_id,
    base_transcript_sha256,
    draft_sha256,
    payload_sha256,
    segment_count,
    word_count,
    actor_profile_id
  ) values (
    v_receipt_id,
    v_campaign_id,
    v_session.id,
    v_revision_id,
    v_operation_id,
    v_source_id,
    v_run_id,
    v_base_transcript_sha256,
    v_draft_sha256,
    v_payload_sha256,
    v_segment_count,
    v_word_count,
    p_actor_profile_id
  )
  returning * into v_existing;

  update public.sessions
  set current_transcript_revision_id = v_revision_id
  where id = v_session.id;

  insert into public.transcript_publication_events (
    campaign_id,
    session_id,
    operation_id,
    action,
    revision_id,
    previous_revision_id,
    actor_profile_id
  ) values (
    v_campaign_id,
    v_session.id,
    v_operation_id,
    v_action,
    v_revision_id,
    v_previous_revision_id,
    p_actor_profile_id
  );

  insert into public.audit_log (
    campaign_id,
    session_id,
    actor_id,
    action,
    table_name,
    record_id,
    old_value,
    new_value
  ) values (
    v_campaign_id,
    v_session.id,
    p_actor_profile_id,
    'transcript_revision.' || v_action,
    'transcript_revisions',
    v_revision_id,
    jsonb_build_object(
      'current_revision_id',
      v_previous_revision_id
    ),
    jsonb_build_object(
      'current_revision_id',
      v_revision_id,
      'revision_number',
      v_revision_number,
      'source_id',
      v_source_id,
      'run_id',
      v_run_id,
      'payload_sha256',
      v_payload_sha256,
      'segment_count',
      v_segment_count,
      'word_count',
      v_word_count
    )
  );

  return jsonb_build_object(
    'ok', true,
    'receipt', jsonb_build_object(
      'schemaVersion', 'tda_transcript_publication_receipt_v1',
      'status', 'committed',
      'receiptId', v_existing.id,
      'campaignId', v_existing.campaign_id,
      'sessionId', v_existing.session_id,
      'revisionId', v_existing.revision_id,
      'revisionNumber', v_revision_number,
      'operationId', v_existing.operation_id,
      'sourceId', v_existing.source_id,
      'runId', v_existing.run_id,
      'baseTranscriptSha256', v_existing.base_transcript_sha256,
      'draftSha256', v_existing.draft_sha256,
      'payloadSha256', v_existing.payload_sha256,
      'segmentCount', v_existing.segment_count,
      'wordCount', v_existing.word_count,
      'committedAt', v_existing.committed_at
    )
  );
end;
$$;

revoke all on function public.publish_transcript_revision_atomic(uuid, uuid, jsonb, boolean)
from public, anon, authenticated;
grant execute on function public.publish_transcript_revision_atomic(uuid, uuid, jsonb, boolean)
to service_role;

comment on function public.publish_transcript_revision_atomic(uuid, uuid, jsonb, boolean) is
'Candidate-only server boundary for an immutable complete transcript revision. Authorization precedes session lookup. Revision, receipt, current pointer, event and sanitized audit commit atomically; replay of the same operation is idempotent.';
