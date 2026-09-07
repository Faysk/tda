-- Candidate only: application remains disabled until deliberate activation.
create table public.transcript_import_receipts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  source_system text not null check (source_system = 'local_companion'),
  source_session_id text not null,
  publication_id text not null check (publication_id ~ '^[0-9a-f]{64}$'),
  transcript_sha256 text not null check (transcript_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  segment_payload_sha256 text not null check (segment_payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_profile_id uuid not null references public.profiles(id),
  job_id text not null,
  segment_count integer not null check (segment_count between 1 and 10000),
  committed_at timestamptz not null default clock_timestamp(),
  unique(campaign_id, source_system, source_session_id),
  unique(session_id)
);
alter table public.transcript_import_receipts enable row level security;
revoke all on public.transcript_import_receipts from public, anon, authenticated;
grant select, insert on public.transcript_import_receipts to service_role;

create function public.import_transcript_bundle_atomic(
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
  v_campaign_slug text;
  v_source_session_id text;
  v_publication_id text;
  v_transcript_sha256 text;
  v_manifest_sha256 text;
  v_job_id text;
  v_publication_payload_json text;
  v_transcript_json text;
  v_publication jsonb;
  v_manifest jsonb;
  v_raw_transcript jsonb;
  v_segments jsonb;
  v_session public.sessions%rowtype;
  v_receipt public.transcript_import_receipts%rowtype;
  v_projection_digest text;
  v_publication_digest text;
  v_transcript_digest text;
  v_id uuid;
  v_sequence integer := 0;
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
    where pc.action = 'campaign.transcript.import'
      and pc.plane = 'mixed'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'import_capability_undefined');
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
         'sourceSystem',
         'sourceSessionId',
         'publicationId',
         'transcriptSha256',
         'envelopeSchema',
         'jobId',
         'manifestSha256',
         'publicationPayloadJson',
         'transcriptJson',
         'segments'
       )
     ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if coalesce(p_input->>'campaignId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(p_input->>'sessionId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_input->>'sourceSystem' is distinct from 'local_companion'
     or coalesce(p_input->>'sourceSessionId', '') !~ '^[A-Za-z0-9_-]{1,160}$'
     or coalesce(p_input->>'publicationId', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_input->>'transcriptSha256', '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  v_campaign_id := (p_input->>'campaignId')::uuid;
  v_session_id := (p_input->>'sessionId')::uuid;
  v_source_session_id := p_input->>'sourceSessionId';
  v_publication_id := p_input->>'publicationId';
  v_transcript_sha256 := p_input->>'transcriptSha256';

  -- Resolve campaign and exact capability scope as one authorization predicate.
  -- A missing campaign and a campaign outside the actor's scope are deliberately indistinguishable.
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
        and rp.permission_action = 'campaign.transcript.import'
        and (
          (a.scope_type = 'campaign' and a.scope_id = c.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda')
        )
    );

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not p_lookup_only then
    if p_input->>'envelopeSchema' is distinct from 'tda_local_result_v1'
       or coalesce(p_input->>'jobId', '') !~ '^[A-Za-z0-9_-]{1,160}$'
       or coalesce(p_input->>'manifestSha256', '') !~ '^[0-9a-f]{64}$'
       or jsonb_typeof(p_input->'segments') is distinct from 'array'
       or jsonb_array_length(p_input->'segments') not between 1 and 10000
       or jsonb_typeof(p_input->'publicationPayloadJson') is distinct from 'string'
       or jsonb_typeof(p_input->'transcriptJson') is distinct from 'string' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    v_job_id := p_input->>'jobId';
    v_manifest_sha256 := p_input->>'manifestSha256';
    v_publication_payload_json := p_input->>'publicationPayloadJson';
    v_transcript_json := p_input->>'transcriptJson';
    v_segments := p_input->'segments';

    if btrim(v_publication_payload_json) = ''
       or btrim(v_transcript_json) = ''
       or octet_length(v_publication_payload_json) > 2000000
       or octet_length(v_transcript_json) > 2000000 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    v_publication_digest := encode(
      extensions.digest(convert_to(v_publication_payload_json, 'UTF8'), 'sha256'),
      'hex'
    );
    v_transcript_digest := encode(
      extensions.digest(convert_to(v_transcript_json, 'UTF8'), 'sha256'),
      'hex'
    );

    if v_publication_digest <> v_publication_id
       or v_transcript_digest <> v_transcript_sha256 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    begin
      v_publication := v_publication_payload_json::jsonb;
      v_raw_transcript := v_transcript_json::jsonb;
    exception
      when others then
        return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end;

    if jsonb_typeof(v_publication) is distinct from 'object'
       or v_publication->>'schema_version' is distinct from 'publication_bundle_v1'
       or jsonb_typeof(v_publication->'session') is distinct from 'object'
       or v_publication->'session'->>'source_id' is distinct from v_source_session_id
       or jsonb_typeof(v_publication->'source_manifest') is distinct from 'object'
       or jsonb_typeof(v_publication->'recap') is distinct from 'object'
       or v_publication->'recap'->'short' is distinct from 'null'::jsonb
       or v_publication->'recap'->'full' is distinct from 'null'::jsonb
       or jsonb_typeof(v_publication->'approved_entries') is distinct from 'array'
       or jsonb_array_length(v_publication->'approved_entries') <> 0
       or jsonb_typeof(v_publication->'open_threads') is distinct from 'array'
       or jsonb_array_length(v_publication->'open_threads') <> 0
       or exists (
         select 1
         from jsonb_object_keys(v_publication) as k(key_name)
         where k.key_name not in (
           'schema_version', 'session', 'recap', 'approved_entries', 'open_threads', 'source_manifest'
         )
       ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    v_manifest := v_publication->'source_manifest';
    if v_manifest->'local_only' is distinct from 'true'::jsonb
       or jsonb_typeof(v_manifest->'recording_format') is distinct from 'string'
       or coalesce(v_manifest->>'recording_format', '') = ''
       or jsonb_typeof(v_manifest->'transcript_segments') is distinct from 'number'
       or coalesce(v_manifest->>'transcript_segments', '') !~ '^[0-9]{1,5}$'
       or jsonb_typeof(v_manifest->'duration_seconds') is distinct from 'number'
       or coalesce(v_manifest->>'transcript_sha256', '') !~ '^[0-9a-f]{64}$'
       or v_manifest->>'transcript_sha256' is distinct from v_transcript_sha256
       or coalesce(v_manifest->>'manifest_sha256', '') !~ '^[0-9a-f]{64}$'
       or v_manifest->>'manifest_sha256' is distinct from v_manifest_sha256 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if jsonb_typeof(v_raw_transcript) is distinct from 'array'
       or jsonb_array_length(v_raw_transcript) not between 1 and 10000
       or jsonb_array_length(v_raw_transcript) <> jsonb_array_length(v_segments)
       or jsonb_array_length(v_raw_transcript) <> (v_manifest->>'transcript_segments')::integer then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_raw_transcript) raw(value)
      where jsonb_typeof(raw.value) is distinct from 'object'
         or jsonb_typeof(raw.value->'id') is distinct from 'string'
         or jsonb_typeof(raw.value->'speaker') is distinct from 'string'
         or jsonb_typeof(raw.value->'track') is distinct from 'string'
         or jsonb_typeof(raw.value->'start') is distinct from 'number'
         or jsonb_typeof(raw.value->'end') is distinct from 'number'
         or jsonb_typeof(raw.value->'text') is distinct from 'string'
         or jsonb_typeof(raw.value->'words') is distinct from 'array'
         or exists (
           select 1
           from jsonb_object_keys(raw.value) as k(key_name)
           where k.key_name not in ('id', 'speaker', 'track', 'start', 'end', 'text', 'words')
         )
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_raw_transcript) raw(value)
      where char_length(raw.value->>'id') not between 1 and 160
         or char_length(raw.value->>'speaker') not between 1 and 160
         or char_length(raw.value->>'track') not between 1 and 160
         or raw.value->>'track' ~ '[/\\:]'
         or char_length(btrim(raw.value->>'text')) not between 1 and 10000
         or (raw.value->>'start')::numeric < 0
         or (raw.value->>'start')::numeric > 604800
         or (raw.value->>'end')::numeric < (raw.value->>'start')::numeric
         or (raw.value->>'end')::numeric > 604800
         or jsonb_array_length(raw.value->'words') > 3000
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_raw_transcript) raw(value)
      cross join lateral jsonb_array_elements(raw.value->'words') word(value)
      where jsonb_typeof(word.value) is distinct from 'object'
         or jsonb_typeof(word.value->'word') is distinct from 'string'
         or jsonb_typeof(word.value->'start') is distinct from 'number'
         or jsonb_typeof(word.value->'end') is distinct from 'number'
         or jsonb_typeof(word.value->'probability') is distinct from 'number'
         or char_length(word.value->>'word') not between 1 and 1000
         or exists (
           select 1
           from jsonb_object_keys(word.value) as k(key_name)
           where k.key_name not in ('word', 'start', 'end', 'probability')
         )
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_raw_transcript) raw(value)
      cross join lateral jsonb_array_elements(raw.value->'words') word(value)
      where (word.value->>'start')::numeric < 0
         or (word.value->>'start')::numeric > 604800
         or (word.value->>'end')::numeric < (word.value->>'start')::numeric
         or (word.value->>'end')::numeric > 604800
         or (word.value->>'probability')::numeric < 0
         or (word.value->>'probability')::numeric > 1
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if round((v_manifest->>'duration_seconds')::numeric * 1000)::bigint <> (
      select max(round((raw.value->>'end')::numeric * 1000)::bigint)
      from jsonb_array_elements(v_raw_transcript) raw(value)
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_segments) normalized(value)
      where jsonb_typeof(normalized.value) is distinct from 'object'
         or jsonb_typeof(normalized.value->'sourceSegmentId') is distinct from 'string'
         or jsonb_typeof(normalized.value->'startMs') is distinct from 'number'
         or jsonb_typeof(normalized.value->'endMs') is distinct from 'number'
         or jsonb_typeof(normalized.value->'text') is distinct from 'string'
         or jsonb_typeof(normalized.value->'speakerName') is distinct from 'string'
         or jsonb_typeof(normalized.value->'trackKey') is distinct from 'string'
         or exists (
           select 1
           from jsonb_object_keys(normalized.value) as k(key_name)
           where k.key_name not in ('sourceSegmentId', 'startMs', 'endMs', 'text', 'speakerName', 'trackKey')
         )
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_segments) normalized(value)
      where char_length(normalized.value->>'sourceSegmentId') not between 1 and 160
         or coalesce(normalized.value->>'startMs', '') !~ '^[0-9]{1,9}$'
         or coalesce(normalized.value->>'endMs', '') !~ '^[0-9]{1,9}$'
         or (normalized.value->>'endMs')::bigint < (normalized.value->>'startMs')::bigint
         or (normalized.value->>'endMs')::bigint > 604800000
         or char_length(btrim(normalized.value->>'text')) not between 1 and 10000
         or char_length(normalized.value->>'speakerName') not between 1 and 160
         or char_length(normalized.value->>'trackKey') not between 1 and 160
         or normalized.value->>'trackKey' ~ '[/\\:]'
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if (
      select count(distinct normalized.value->>'sourceSegmentId')
      from jsonb_array_elements(v_segments) normalized(value)
    ) <> jsonb_array_length(v_segments) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_raw_transcript) with ordinality raw(value, ordinality)
      join jsonb_array_elements(v_segments) with ordinality normalized(value, ordinality)
        using (ordinality)
      where normalized.value->>'sourceSegmentId' is distinct from raw.value->>'id'
         or normalized.value->>'speakerName' is distinct from raw.value->>'speaker'
         or normalized.value->>'trackKey' is distinct from raw.value->>'track'
         or normalized.value->>'text' is distinct from raw.value->>'text'
         or (normalized.value->>'startMs')::bigint <> round((raw.value->>'start')::numeric * 1000)::bigint
         or (normalized.value->>'endMs')::bigint <> round((raw.value->>'end')::numeric * 1000)::bigint
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    v_projection_digest := encode(
      extensions.digest(convert_to(v_segments::text, 'UTF8'), 'sha256'),
      'hex'
    );
  end if;

  -- The exact physical source ownership is checked and locked only after auth/scope validation.
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
  into v_receipt
  from public.transcript_import_receipts r
  where r.session_id = v_session.id;

  if found then
    if v_receipt.campaign_id <> v_session.campaign_id
       or v_receipt.source_system <> 'local_companion'
       or v_receipt.source_session_id <> v_session.source_session_id
       or v_receipt.publication_id <> v_publication_id
       or v_receipt.transcript_sha256 <> v_transcript_sha256
       or (
         not p_lookup_only
         and (
           v_receipt.manifest_sha256 <> v_manifest_sha256
           or v_receipt.segment_payload_sha256 <> v_projection_digest
         )
       ) then
      return jsonb_build_object('ok', false, 'reason', 'conflict');
    end if;
  elsif p_lookup_only then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  else
    -- An unreceipted existing transcript is never silently adopted or overwritten.
    if exists (
      select 1
      from public.transcript_segments ts
      where ts.session_id = v_session.id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'conflict');
    end if;

    v_id := gen_random_uuid();
    for v_segment in
      select value
      from jsonb_array_elements(v_segments)
    loop
      insert into public.transcript_segments (
        id,
        session_id,
        source_segment_id,
        source_sequence,
        start_ms,
        end_ms,
        text,
        speaker_name,
        track_key,
        needs_review,
        review_status,
        text_chars,
        text_words,
        is_empty,
        revision,
        metadata
      ) values (
        gen_random_uuid(),
        v_session.id,
        v_segment->>'sourceSegmentId',
        v_sequence,
        (v_segment->>'startMs')::integer,
        (v_segment->>'endMs')::integer,
        v_segment->>'text',
        v_segment->>'speakerName',
        v_segment->>'trackKey',
        true,
        'pending',
        char_length(v_segment->>'text'),
        cardinality(regexp_split_to_array(btrim(v_segment->>'text'), E'\\s+')),
        false,
        0,
        jsonb_build_object(
          'import_receipt_id', v_id,
          'source_system', 'local_companion'
        )
      );
      v_sequence := v_sequence + 1;
    end loop;

    insert into public.transcript_import_receipts (
      id,
      campaign_id,
      session_id,
      source_system,
      source_session_id,
      publication_id,
      transcript_sha256,
      manifest_sha256,
      segment_payload_sha256,
      actor_profile_id,
      job_id,
      segment_count
    ) values (
      v_id,
      v_session.campaign_id,
      v_session.id,
      'local_companion',
      v_session.source_session_id,
      v_publication_id,
      v_transcript_sha256,
      v_manifest_sha256,
      v_projection_digest,
      p_actor_profile_id,
      v_job_id,
      v_sequence
    )
    returning * into v_receipt;

    insert into public.audit_log (
      campaign_id,
      session_id,
      actor_id,
      action,
      table_name,
      record_id,
      new_value
    ) values (
      v_session.campaign_id,
      v_session.id,
      p_actor_profile_id,
      'transcript.import',
      'transcript_import_receipts',
      v_id,
      jsonb_build_object(
        'receipt_id', v_id,
        'segment_count', v_sequence,
        'publication_id', v_receipt.publication_id,
        'transcript_sha256', v_receipt.transcript_sha256
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'receipt', jsonb_build_object(
      'schemaVersion', 'tda_transcript_receipt_v1',
      'status', 'committed',
      'receiptId', v_receipt.id,
      'campaignId', v_receipt.campaign_id,
      'sessionId', v_receipt.session_id,
      'sourceSystem', v_receipt.source_system,
      'sourceSessionId', v_receipt.source_session_id,
      'publicationId', v_receipt.publication_id,
      'transcriptSha256', v_receipt.transcript_sha256,
      'segmentCount', v_receipt.segment_count,
      'committedAt', v_receipt.committed_at
    )
  );
end;
$$;

revoke all on function public.import_transcript_bundle_atomic(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.import_transcript_bundle_atomic(uuid, uuid, jsonb, boolean) to service_role;
comment on function public.import_transcript_bundle_atomic(uuid, uuid, jsonb, boolean) is
'Server-only import or receipt lookup. Verified Auth identity, campaign.transcript.import scope, exact session/source ownership, canonical UTF-8 artifact hashes, normalized projection, receipt and audit are revalidated atomically. No canon, recap or session creation.';
