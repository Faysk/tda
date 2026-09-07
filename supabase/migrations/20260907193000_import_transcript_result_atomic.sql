insert into public.permission_catalog (action, plane, description)
values (
  'campaign.transcript.import',
  'mixed',
  'Import a local companion transcript result into an existing campaign session.'
);

do $$
begin
  if not exists (
    select 1
    from public.role_definitions rd
    where rd.slug = 'local_operator'
  ) then
    raise exception 'local_operator role is required before campaign.transcript.import can be seeded';
  end if;
end;
$$;

insert into public.role_permissions (role_id, permission_action)
select rd.id, 'campaign.transcript.import'
from public.role_definitions rd
where rd.slug = 'local_operator';

create table public.transcript_import_receipts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  actor_profile_id uuid not null references public.profiles(id),
  source_system text not null,
  source_session_id text not null,
  envelope_schema text not null,
  publication_payload_sha256 text not null,
  transcript_sha256 text not null,
  segment_count integer not null,
  created_at timestamptz not null default now(),
  constraint transcript_import_receipts_source_system_check
    check (source_system = 'local_companion'),
  constraint transcript_import_receipts_envelope_schema_check
    check (envelope_schema = 'tda_local_result_v1'),
  constraint transcript_import_receipts_publication_hash_check
    check (publication_payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint transcript_import_receipts_transcript_hash_check
    check (transcript_sha256 ~ '^[0-9a-f]{64}$'),
  constraint transcript_import_receipts_segment_count_check
    check (segment_count >= 0),
  constraint transcript_import_receipts_source_identity_key
    unique (campaign_id, source_system, source_session_id)
);

create index idx_transcript_import_receipts_session
  on public.transcript_import_receipts (session_id, created_at desc);

alter table public.transcript_import_receipts enable row level security;

revoke all on table public.transcript_import_receipts from public;
revoke all on table public.transcript_import_receipts from anon;
revoke all on table public.transcript_import_receipts from authenticated;
grant select, insert on table public.transcript_import_receipts to service_role;

comment on table public.transcript_import_receipts is
'Immutable commit marker for one accepted tda_local_result_v1 transcript import identity. Same source identity plus same hashes is replay-safe; different hashes are a conflict.';

create or replace function public.import_transcript_result_atomic(
  p_actor_profile_id uuid,
  p_campaign_id uuid,
  p_session_id uuid,
  p_source_session_id text,
  p_publication_payload_json text,
  p_publication_payload_sha256 text,
  p_transcript_json text,
  p_transcript_sha256 text
)
returns table(status text, receipt_id uuid, segment_count integer)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_slug text;
  v_publication jsonb;
  v_transcript jsonb;
  v_segments jsonb;
  v_expected_publication_hash text;
  v_expected_transcript_hash text;
  v_existing_receipt public.transcript_import_receipts%rowtype;
  v_existing_segment_count integer;
  v_segment_count integer;
  v_receipt_id uuid := gen_random_uuid();
begin
  if p_actor_profile_id is null
     or p_campaign_id is null
     or p_session_id is null then
    raise exception 'actor, campaign and session are required' using errcode = '22023';
  end if;

  if p_source_session_id is null
     or btrim(p_source_session_id) = ''
     or char_length(p_source_session_id) > 220 then
    raise exception 'source session id is invalid' using errcode = '22023';
  end if;

  if p_publication_payload_json is null or p_transcript_json is null then
    raise exception 'canonical import artifact JSON strings are required' using errcode = '22023';
  end if;

  if p_publication_payload_sha256 is null
     or p_publication_payload_sha256 !~ '^[0-9a-f]{64}$'
     or p_transcript_sha256 is null
     or p_transcript_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'artifact sha256 values must be lowercase hexadecimal' using errcode = '22023';
  end if;

  v_expected_publication_hash := encode(
    extensions.digest(convert_to(p_publication_payload_json, 'UTF8'), 'sha256'),
    'hex'
  );
  v_expected_transcript_hash := encode(
    extensions.digest(convert_to(p_transcript_json, 'UTF8'), 'sha256'),
    'hex'
  );

  if p_publication_payload_sha256 <> v_expected_publication_hash
     or p_transcript_sha256 <> v_expected_transcript_hash then
    raise exception 'artifact sha256 does not match exact UTF-8 payload' using errcode = '22023';
  end if;

  begin
    v_publication := p_publication_payload_json::jsonb;
    v_transcript := p_transcript_json::jsonb;
  exception
    when others then
      raise exception 'import artifact contains invalid JSON' using errcode = '22023';
  end;

  if jsonb_typeof(v_publication) <> 'object' then
    raise exception 'publication payload JSON must be an object' using errcode = '22023';
  end if;

  if jsonb_typeof(v_transcript) = 'array' then
    v_segments := v_transcript;
  elsif jsonb_typeof(v_transcript) = 'object'
        and jsonb_typeof(v_transcript -> 'segments') = 'array' then
    v_segments := v_transcript -> 'segments';
  else
    raise exception 'transcript JSON must be a segment array or an object containing segments[]' using errcode = '22023';
  end if;

  select c.slug
  into v_campaign_slug
  from public.campaigns c
  where c.id = p_campaign_id;

  if not found then
    return query select 'not_found'::text, null::uuid, null::integer;
    return;
  end if;

  if not exists (
    select 1
    from public.role_assignments ra
    join public.role_permissions rp on rp.role_id = ra.role_id
    where ra.profile_id = p_actor_profile_id
      and rp.permission_action = 'campaign.transcript.import'
      and ra.status = 'active'
      and ra.starts_at <= now()
      and (ra.ends_at is null or ra.ends_at > now())
      and (
        (ra.scope_type = 'campaign' and ra.scope_id = v_campaign_slug)
        or (ra.scope_type = 'project' and ra.scope_id = 'tda')
      )
  ) then
    raise exception 'actor lacks campaign.transcript.import' using errcode = '42501';
  end if;

  perform 1
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = p_campaign_id
    and s.source_system = 'local_companion'
    and s.source_session_id = p_source_session_id
  for update of s;

  if not found then
    return query select 'not_found'::text, null::uuid, null::integer;
    return;
  end if;

  select r.*
  into v_existing_receipt
  from public.transcript_import_receipts r
  where r.campaign_id = p_campaign_id
    and r.source_system = 'local_companion'
    and r.source_session_id = p_source_session_id;

  if found then
    if v_existing_receipt.session_id <> p_session_id then
      raise exception 'receipt/session source identity mismatch' using errcode = '23514';
    end if;

    if v_existing_receipt.publication_payload_sha256 = p_publication_payload_sha256
       and v_existing_receipt.transcript_sha256 = p_transcript_sha256 then
      return query
      select
        'replay'::text,
        v_existing_receipt.id,
        v_existing_receipt.segment_count;
      return;
    end if;

    return query
    select
      'hash_conflict'::text,
      v_existing_receipt.id,
      v_existing_receipt.segment_count;
    return;
  end if;

  select count(*)::integer
  into v_existing_segment_count
  from public.transcript_segments ts
  where ts.session_id = p_session_id;

  if v_existing_segment_count > 0 then
    return query
    select 'legacy_unreceipted'::text, null::uuid, v_existing_segment_count;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_segments) item(value)
    where jsonb_typeof(item.value) <> 'object'
       or not (item.value ? 'id')
       or not (item.value ? 'start')
       or not (item.value ? 'end')
       or not (item.value ? 'text')
       or not (item.value ? 'words')
       or jsonb_typeof(item.value -> 'id') <> 'string'
       or jsonb_typeof(item.value -> 'start') <> 'number'
       or jsonb_typeof(item.value -> 'end') <> 'number'
       or jsonb_typeof(item.value -> 'text') <> 'string'
       or jsonb_typeof(item.value -> 'words') <> 'number'
       or ((item.value ? 'speaker') and jsonb_typeof(item.value -> 'speaker') not in ('string', 'null'))
       or ((item.value ? 'track') and jsonb_typeof(item.value -> 'track') not in ('string', 'null'))
       or (item.value ->> 'start') !~ '^[0-9]+$'
       or (item.value ->> 'end') !~ '^[0-9]+$'
       or (item.value ->> 'words') !~ '^[0-9]+$'
  ) then
    raise exception 'transcript contains an invalid legacy segment shape' using errcode = '22023';
  end if;

  begin
    select count(*)::integer
    into v_segment_count
    from jsonb_to_recordset(v_segments) as x(
      id text,
      speaker text,
      track text,
      start bigint,
      "end" bigint,
      text text,
      words bigint
    );
  exception
    when others then
      raise exception 'transcript segment scalar values are invalid' using errcode = '22023';
  end;

  if exists (
    select 1
    from jsonb_to_recordset(v_segments) as x(id text)
    group by x.id
    having count(*) > 1
  ) then
    raise exception 'transcript contains duplicate segment ids' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_segments) as x(
      id text,
      speaker text,
      track text,
      start bigint,
      "end" bigint,
      text text,
      words bigint
    )
    where x.id is null
       or btrim(x.id) = ''
       or char_length(x.id) > 220
       or x.start is null
       or x.start < 0
       or x.start > 2147483647
       or x."end" is null
       or x."end" < x.start
       or x."end" > 2147483647
       or x.text is null
       or char_length(x.text) > 10000
       or x.words is null
       or x.words < 0
       or x.words > 2147483647
       or (x.speaker is not null and char_length(x.speaker) > 160)
       or (x.track is not null and char_length(x.track) > 220)
  ) then
    raise exception 'transcript segment values are out of bounds' using errcode = '22023';
  end if;

  insert into public.transcript_segments (
    session_id,
    start_ms,
    end_ms,
    text,
    source_segment_id,
    source_sequence,
    track_key,
    speaker_name,
    text_chars,
    text_words,
    is_empty,
    needs_review,
    review_status,
    revision
  )
  select
    p_session_id,
    x.start::integer,
    x."end"::integer,
    x.text,
    x.id,
    (item.ordinality - 1)::integer,
    nullif(btrim(x.track), ''),
    nullif(btrim(x.speaker), ''),
    char_length(x.text),
    x.words::integer,
    btrim(x.text) = '',
    true,
    'pending',
    0
  from jsonb_array_elements(v_segments) with ordinality item(value, ordinality)
  cross join lateral jsonb_to_record(item.value) as x(
    id text,
    speaker text,
    track text,
    start bigint,
    "end" bigint,
    text text,
    words bigint
  )
  order by item.ordinality;

  insert into public.transcript_import_receipts (
    id,
    campaign_id,
    session_id,
    actor_profile_id,
    source_system,
    source_session_id,
    envelope_schema,
    publication_payload_sha256,
    transcript_sha256,
    segment_count
  ) values (
    v_receipt_id,
    p_campaign_id,
    p_session_id,
    p_actor_profile_id,
    'local_companion',
    p_source_session_id,
    'tda_local_result_v1',
    p_publication_payload_sha256,
    p_transcript_sha256,
    v_segment_count
  );

  return query select 'imported'::text, v_receipt_id, v_segment_count;
end;
$$;

comment on function public.import_transcript_result_atomic(uuid, uuid, uuid, text, text, text, text, text)
is 'Server-only SECURITY INVOKER boundary for tda_local_result_v1 transcript imports. Rechecks campaign.transcript.import, session/campaign/source ownership, exact UTF-8 artifact hashes and source idempotency; inserts only allowlisted pending-review segments plus one immutable receipt atomically.';

revoke all on function public.import_transcript_result_atomic(uuid, uuid, uuid, text, text, text, text, text) from public;
revoke execute on function public.import_transcript_result_atomic(uuid, uuid, uuid, text, text, text, text, text) from anon;
revoke execute on function public.import_transcript_result_atomic(uuid, uuid, uuid, text, text, text, text, text) from authenticated;
grant execute on function public.import_transcript_result_atomic(uuid, uuid, uuid, text, text, text, text, text) to service_role;
