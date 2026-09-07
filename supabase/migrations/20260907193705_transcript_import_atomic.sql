-- Candidate only: application remains disabled until deliberate activation.
create table public.transcript_import_receipts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id),
  source_system text not null check (source_system = 'local_companion'),
  source_session_id text not null,
  publication_id text not null check (publication_id ~ '^[0-9a-f]{64}$'),
  transcript_sha256 text not null check (transcript_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  segment_payload_sha256 text not null,
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
  p_auth_user_id uuid, p_actor_profile_id uuid, p_input jsonb, p_lookup_only boolean default false
)
returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  v_session public.sessions%rowtype;
  v_campaign_slug text;
  v_receipt public.transcript_import_receipts%rowtype;
  v_segments jsonb;
  v_segment jsonb;
  v_digest text;
  v_id uuid;
  v_sequence integer := 0;
begin
  if p_auth_user_id is null or p_actor_profile_id is null or not exists (
    select 1 from public.profiles where id = p_actor_profile_id and auth_user_id = p_auth_user_id
  ) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if not exists (select 1 from public.permission_catalog where action = 'campaign.transcript.import') then
    return jsonb_build_object('ok', false, 'reason', 'import_capability_undefined');
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or octet_length(p_input::text) > 2000000 or p_lookup_only is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;
  -- Lock the owning session before checking an existing receipt or inserting any evidence.
  select s.* into v_session from public.sessions s
  where s.id = (p_input->>'sessionId')::uuid
    and s.campaign_id = (p_input->>'campaignId')::uuid
    and s.source_system = 'local_companion'
    and p_input->>'sourceSystem' = 'local_companion'
    and s.source_session_id = p_input->>'sourceSessionId'
  for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select slug into v_campaign_slug from public.campaigns where id = v_session.campaign_id;
  if not exists (
    select 1 from public.role_assignments a
    join public.role_permissions rp on rp.role_id = a.role_id
    where a.profile_id = p_actor_profile_id and a.status = 'active'
      and a.starts_at <= clock_timestamp() and (a.ends_at is null or a.ends_at > clock_timestamp())
      and rp.permission_action = 'campaign.transcript.import'
      and ((a.scope_type = 'campaign' and a.scope_id = v_campaign_slug)
        or (a.scope_type = 'project' and a.scope_id = 'tda'))
  ) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;
  if coalesce(p_input->>'publicationId', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_input->>'transcriptSha256', '') !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;
  if not p_lookup_only then
    v_segments := p_input->'segments';
    if jsonb_typeof(v_segments) is distinct from 'array' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    if jsonb_array_length(v_segments) not between 1 and 10000
      or coalesce(p_input->>'manifestSha256', '') !~ '^[0-9a-f]{64}$'
      or coalesce(p_input->>'jobId', '') !~ '^[A-Za-z0-9_-]{1,160}$' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    for v_segment in select value from jsonb_array_elements(v_segments) loop
      if jsonb_typeof(v_segment) <> 'object'
        or jsonb_typeof(v_segment->'text') is distinct from 'string'
        or length(btrim(v_segment->>'text')) not between 1 and 10000
        or coalesce(v_segment->>'sourceSegmentId', '') = ''
        or length(v_segment->>'sourceSegmentId') > 160
        or coalesce(v_segment->>'speakerName', '') = '' or length(v_segment->>'speakerName') > 160
        or coalesce(v_segment->>'trackKey', '') = '' or length(v_segment->>'trackKey') > 160
        or v_segment->>'trackKey' ~ '[/\\:]'
        or coalesce(v_segment->>'startMs', '') !~ '^[0-9]{1,9}$'
        or coalesce(v_segment->>'endMs', '') !~ '^[0-9]{1,9}$'
        or (v_segment->>'endMs')::bigint < (v_segment->>'startMs')::bigint
        or (v_segment->>'endMs')::bigint > 604800000 then
        return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
      end if;
    end loop;
    if (select count(distinct value->>'sourceSegmentId') from jsonb_array_elements(v_segments)) <> jsonb_array_length(v_segments) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    v_digest := encode(sha256(convert_to(v_segments::text, 'UTF8')), 'hex');
  end if;

  select * into v_receipt from public.transcript_import_receipts where session_id = v_session.id;
  if found then
    if v_receipt.campaign_id <> v_session.campaign_id or v_receipt.source_session_id <> v_session.source_session_id
      or v_receipt.publication_id <> p_input->>'publicationId'
      or v_receipt.transcript_sha256 <> p_input->>'transcriptSha256'
      or (not p_lookup_only and (v_receipt.segment_payload_sha256 <> v_digest or v_receipt.manifest_sha256 <> p_input->>'manifestSha256')) then
      return jsonb_build_object('ok', false, 'reason', 'conflict');
    end if;
  elsif p_lookup_only then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  else
    -- An unreceipted existing transcript is never silently adopted or overwritten.
    if exists (select 1 from public.transcript_segments where session_id = v_session.id) then
      return jsonb_build_object('ok', false, 'reason', 'conflict');
    end if;
    v_id := gen_random_uuid();
    for v_segment in select value from jsonb_array_elements(v_segments) loop
      insert into public.transcript_segments(id, session_id, source_segment_id, source_sequence, start_ms, end_ms, text, speaker_name, track_key, needs_review, review_status, text_chars, text_words, metadata)
      values (gen_random_uuid(), v_session.id, v_segment->>'sourceSegmentId', v_sequence,
        (v_segment->>'startMs')::integer, (v_segment->>'endMs')::integer,
        v_segment->>'text', v_segment->>'speakerName', v_segment->>'trackKey', true, 'pending',
        char_length(v_segment->>'text'), cardinality(regexp_split_to_array(btrim(v_segment->>'text'), '\s+')),
        jsonb_build_object('import_receipt_id', v_id, 'source_system', 'local_companion'));
      v_sequence := v_sequence + 1;
    end loop;
    insert into public.transcript_import_receipts(id, campaign_id, session_id, source_system, source_session_id, publication_id, transcript_sha256, manifest_sha256, segment_payload_sha256, actor_profile_id, job_id, segment_count)
    values (v_id, v_session.campaign_id, v_session.id, 'local_companion', v_session.source_session_id,
      p_input->>'publicationId', p_input->>'transcriptSha256', p_input->>'manifestSha256', v_digest, p_actor_profile_id, p_input->>'jobId', v_sequence)
    returning * into v_receipt;
    insert into public.audit_log(campaign_id, session_id, actor_id, action, table_name, record_id, new_value)
    values (v_session.campaign_id, v_session.id, p_actor_profile_id, 'transcript.import', 'transcript_import_receipts', v_id,
      jsonb_build_object('receipt_id', v_id, 'segment_count', v_sequence, 'publication_id', v_receipt.publication_id));
  end if;
  return jsonb_build_object('ok', true, 'receipt', jsonb_build_object(
    'schemaVersion', 'tda_transcript_receipt_v1', 'status', 'committed', 'receiptId', v_receipt.id,
    'campaignId', v_receipt.campaign_id, 'sessionId', v_receipt.session_id,
    'sourceSystem', v_receipt.source_system, 'sourceSessionId', v_receipt.source_session_id,
    'publicationId', v_receipt.publication_id, 'transcriptSha256', v_receipt.transcript_sha256,
    'segmentCount', v_receipt.segment_count, 'committedAt', v_receipt.committed_at));
end;
$$;
revoke all on function public.import_transcript_bundle_atomic(uuid, uuid, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.import_transcript_bundle_atomic(uuid, uuid, jsonb, boolean) to service_role;
comment on function public.import_transcript_bundle_atomic(uuid, uuid, jsonb, boolean) is
'Server-only import or receipt lookup. Verified Auth identity supplied by the trusted server; capability and source ownership revalidated here. No canon, recap or session creation.';
