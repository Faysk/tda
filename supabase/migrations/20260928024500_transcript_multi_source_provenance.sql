-- #851: additive multi-source provenance for immutable transcript publication.
-- Existing single-source request/payload/receipt v1 and RPC remain unchanged.

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
  add column assembly_transcript_sha256 text null
    check (assembly_transcript_sha256 ~ '^[0-9a-f]{64}$'),
  add column assembly_canonicalization_version text null
    check (assembly_canonicalization_version = 'tda_session_assembly_canonical_v1'),
  add column timing_policy_version text null
    check (timing_policy_version = 'tda_session_timeline_v1'),
  add column segment_boundary_policy text null
    check (segment_boundary_policy = 'segment_start_owner_v1'),
  add column timeline_fingerprint_sha256 text null
    check (timeline_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  add column participant_mapping_schema_version text null
    check (participant_mapping_schema_version = 'tda_session_participant_mapping_v1'),
  add column participant_mapping_policy text null
    check (participant_mapping_policy = 'strong_discord_or_manual_v1'),
  add column participant_mapping_sha256 text null
    check (participant_mapping_sha256 ~ '^[0-9a-f]{64}$');

alter table public.transcript_revisions
  add constraint transcript_revisions_publication_identity_check check (
    (
      publication_kind = 'single_source'
      and source_id is not null
      and run_id is not null
      and assembly_id is null
      and assembly_schema_version is null
      and assembly_inputs_sha256 is null
      and assembly_transcript_sha256 is null
      and assembly_canonicalization_version is null
      and timing_policy_version is null
      and segment_boundary_policy is null
      and timeline_fingerprint_sha256 is null
      and participant_mapping_schema_version is null
      and participant_mapping_policy is null
      and participant_mapping_sha256 is null
    )
    or
    (
      publication_kind = 'session_assembly'
      and source_id is null
      and run_id is null
      and assembly_id is not null
      and assembly_schema_version = 'tda_session_assembly_v1'
      and assembly_inputs_sha256 = assembly_id
      and assembly_transcript_sha256 = base_transcript_sha256
      and assembly_canonicalization_version = 'tda_session_assembly_canonical_v1'
      and timing_policy_version = 'tda_session_timeline_v1'
      and segment_boundary_policy = 'segment_start_owner_v1'
      and timeline_fingerprint_sha256 is not null
      and participant_mapping_schema_version = 'tda_session_participant_mapping_v1'
      and participant_mapping_policy = 'strong_discord_or_manual_v1'
      and participant_mapping_sha256 is not null
    )
  );

create index transcript_revisions_assembly_id_idx
  on public.transcript_revisions(assembly_id)
  where assembly_id is not null;

create table public.transcript_revision_parts (
  revision_id uuid not null references public.transcript_revisions(id) on delete cascade,
  ordinal smallint not null check (ordinal between 0 and 63),
  part_id text not null check (part_id ~ '^[0-9a-f]{32}$'),
  source_id text not null check (source_id ~ '^craig-[0-9a-f]{64}$'),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  run_id text not null check (run_id ~ '^[A-Za-z0-9_-]{1,196}$'),
  run_transcript_sha256 text not null check (run_transcript_sha256 ~ '^[0-9a-f]{64}$'),
  session_offset_seconds double precision not null
    check (session_offset_seconds between 0 and 604800),
  trim_start_seconds double precision not null
    check (trim_start_seconds between 0 and 604800),
  trim_end_seconds double precision null
    check (
      trim_end_seconds is null
      or trim_end_seconds between trim_start_seconds and 604800
    ),
  overlap_resolution text null
    check (
      overlap_resolution is null
      or overlap_resolution in ('prefer_earlier_until', 'prefer_later_from')
    ),
  overlap_boundary_seconds double precision null
    check (
      overlap_boundary_seconds is null
      or overlap_boundary_seconds between 0 and 604800
    ),
  primary key (revision_id, ordinal),
  unique (revision_id, part_id),
  unique (revision_id, source_id),
  check ((overlap_resolution is null) = (overlap_boundary_seconds is null)),
  check (source_sha256 = substring(source_id from 7))
);

create index transcript_revision_parts_source_run_idx
  on public.transcript_revision_parts(source_id, run_id);

alter table public.transcript_revision_parts enable row level security;
revoke all on public.transcript_revision_parts
from public, anon, authenticated, service_role;
grant select, insert on public.transcript_revision_parts to service_role;

comment on table public.transcript_revision_parts is
'Immutable ordered source/run provenance for Session Assembly transcript revisions. No raw audio, local paths, tokens or transcript text are stored here.';

create table public.transcript_assembly_publication_receipts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  revision_id uuid not null unique references public.transcript_revisions(id) on delete cascade,
  operation_id uuid not null,
  assembly_id text not null check (assembly_id ~ '^[0-9a-f]{64}$'),
  part_count integer not null check (part_count between 1 and 64),
  base_transcript_sha256 text not null check (base_transcript_sha256 ~ '^[0-9a-f]{64}$'),
  draft_sha256 text not null check (draft_sha256 ~ '^[0-9a-f]{64}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  segment_count integer not null check (segment_count between 1 and 100000),
  word_count integer not null check (word_count >= 0),
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  committed_at timestamptz not null default now(),
  unique (session_id, operation_id)
);

create index transcript_assembly_receipts_campaign_id_idx
  on public.transcript_assembly_publication_receipts(campaign_id);
create index transcript_assembly_receipts_actor_profile_id_idx
  on public.transcript_assembly_publication_receipts(actor_profile_id);

alter table public.transcript_assembly_publication_receipts enable row level security;
revoke all on public.transcript_assembly_publication_receipts
from public, anon, authenticated, service_role;
grant select, insert on public.transcript_assembly_publication_receipts to service_role;

comment on table public.transcript_assembly_publication_receipts is
'Idempotency receipts for Session Assembly transcript publication. Identity is hash/UUID metadata only.';

create or replace function public.inherit_transcript_revision_provenance()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_parent public.transcript_revisions%rowtype;
begin
  if new.parent_revision_id is null then
    return new;
  end if;

  select *
  into v_parent
  from public.transcript_revisions r
  where r.id = new.parent_revision_id;

  if not found
     or v_parent.campaign_id <> new.campaign_id
     or v_parent.session_id <> new.session_id then
    raise exception 'transcript revision parent provenance mismatch';
  end if;

  new.publication_kind := v_parent.publication_kind;
  new.source_session_id := v_parent.source_session_id;
  new.source_id := v_parent.source_id;
  new.run_id := v_parent.run_id;
  new.assembly_id := v_parent.assembly_id;
  new.assembly_schema_version := v_parent.assembly_schema_version;
  new.assembly_inputs_sha256 := v_parent.assembly_inputs_sha256;
  new.assembly_transcript_sha256 := v_parent.assembly_transcript_sha256;
  new.assembly_canonicalization_version := v_parent.assembly_canonicalization_version;
  new.timing_policy_version := v_parent.timing_policy_version;
  new.segment_boundary_policy := v_parent.segment_boundary_policy;
  new.timeline_fingerprint_sha256 := v_parent.timeline_fingerprint_sha256;
  new.participant_mapping_schema_version := v_parent.participant_mapping_schema_version;
  new.participant_mapping_policy := v_parent.participant_mapping_policy;
  new.participant_mapping_sha256 := v_parent.participant_mapping_sha256;
  return new;
end;
$$;

revoke all on function public.inherit_transcript_revision_provenance() from public;
revoke execute on function public.inherit_transcript_revision_provenance() from anon, authenticated;
grant execute on function public.inherit_transcript_revision_provenance() to service_role;

create trigger transcript_revision_inherit_provenance
before insert on public.transcript_revisions
for each row
when (new.parent_revision_id is not null)
execute function public.inherit_transcript_revision_provenance();

create or replace function public.copy_transcript_revision_parts_from_parent()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_expected integer;
  v_copied integer;
begin
  if new.parent_revision_id is null or new.publication_kind <> 'session_assembly' then
    return new;
  end if;

  select count(*)::integer
  into v_expected
  from public.transcript_revision_parts p
  where p.revision_id = new.parent_revision_id;

  if v_expected < 1 or v_expected > 64 then
    raise exception 'session assembly parent provenance missing';
  end if;

  insert into public.transcript_revision_parts (
    revision_id,
    ordinal,
    part_id,
    source_id,
    source_sha256,
    run_id,
    run_transcript_sha256,
    session_offset_seconds,
    trim_start_seconds,
    trim_end_seconds,
    overlap_resolution,
    overlap_boundary_seconds
  )
  select
    new.id,
    p.ordinal,
    p.part_id,
    p.source_id,
    p.source_sha256,
    p.run_id,
    p.run_transcript_sha256,
    p.session_offset_seconds,
    p.trim_start_seconds,
    p.trim_end_seconds,
    p.overlap_resolution,
    p.overlap_boundary_seconds
  from public.transcript_revision_parts p
  where p.revision_id = new.parent_revision_id
  order by p.ordinal;

  get diagnostics v_copied = row_count;
  if v_copied <> v_expected then
    raise exception 'session assembly provenance copy incomplete';
  end if;
  return new;
end;
$$;

revoke all on function public.copy_transcript_revision_parts_from_parent() from public;
revoke execute on function public.copy_transcript_revision_parts_from_parent() from anon, authenticated;
grant execute on function public.copy_transcript_revision_parts_from_parent() to service_role;

create trigger transcript_revision_copy_parts
after insert on public.transcript_revisions
for each row
when (new.parent_revision_id is not null)
execute function public.copy_transcript_revision_parts_from_parent();

create or replace function public.publish_transcript_assembly_revision_atomic(
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
  v_expected_current_revision_id uuid;
  v_base_transcript_sha256 text;
  v_draft_sha256 text;
  v_payload_sha256 text;
  v_payload_json text;
  v_payload jsonb;
  v_provenance jsonb;
  v_lineage jsonb;
  v_review jsonb;
  v_segments jsonb;
  v_session public.sessions%rowtype;
  v_existing public.transcript_assembly_publication_receipts%rowtype;
  v_revision_id uuid;
  v_revision_number bigint;
  v_previous_revision_id uuid;
  v_action text;
  v_segment_count integer;
  v_word_count integer;
  v_reviewed_segments integer;
  v_warning_count integer;
  v_part_count integer;
  v_receipt_id uuid;
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
     or jsonb_typeof(p_input) is distinct from 'object'
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
         'provenance',
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
     or (
       p_input->'expectedCurrentRevisionId' <> 'null'::jsonb
       and (
         jsonb_typeof(p_input->'expectedCurrentRevisionId') is distinct from 'string'
         or coalesce(p_input->>'expectedCurrentRevisionId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       )
     )
     or p_input->>'sourceSystem' is distinct from 'local_companion'
     or coalesce(p_input->>'sourceSessionId', '') !~ '^[A-Za-z0-9_-]{1,160}$'
     or jsonb_typeof(p_input->'provenance') is distinct from 'object'
     or coalesce(p_input->>'baseTranscriptSha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_input->>'draftSha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_input->>'payloadSha256', '') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_input->'payloadJson') is distinct from 'string'
     or coalesce(p_input->>'segmentCount', '') !~ '^[0-9]{1,6}$'
     or (p_input->>'segmentCount')::integer not between 1 and 100000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  v_campaign_id := (p_input->>'campaignId')::uuid;
  v_session_id := (p_input->>'sessionId')::uuid;
  v_operation_id := (p_input->>'operationId')::uuid;
  v_expected_current_revision_id := case
    when p_input->'expectedCurrentRevisionId' = 'null'::jsonb then null
    else (p_input->>'expectedCurrentRevisionId')::uuid
  end;
  v_source_session_id := p_input->>'sourceSessionId';
  v_provenance := p_input->'provenance';
  v_base_transcript_sha256 := p_input->>'baseTranscriptSha256';
  v_draft_sha256 := p_input->>'draftSha256';
  v_payload_sha256 := p_input->>'payloadSha256';
  v_payload_json := p_input->>'payloadJson';
  v_segment_count := (p_input->>'segmentCount')::integer;

  -- Authorization is resolved before target/session existence.
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
  from public.transcript_assembly_publication_receipts r
  where r.session_id = v_session.id
    and r.operation_id = v_operation_id;

  if found then
    v_part_count := case
      when jsonb_typeof(v_provenance->'parts') = 'array'
      then jsonb_array_length(v_provenance->'parts')
      else 0
    end;
    if v_existing.campaign_id <> v_campaign_id
       or v_existing.assembly_id is distinct from v_provenance->>'assembly_id'
       or v_existing.part_count <> v_part_count
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
      and r.session_id = v_session.id
      and r.publication_kind = 'session_assembly';

    if not found then
      raise exception 'assembly publication receipt references a missing revision';
    end if;

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
  elsif p_lookup_only then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- A UUID cannot be reused across source-run and assembly publication modes.
  if exists (
    select 1
    from public.transcript_revisions r
    where r.session_id = v_session.id
      and r.operation_id = v_operation_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'conflict');
  end if;

  -- Lost-response replay above intentionally precedes current-pointer CAS.
  if v_session.current_transcript_revision_id is distinct from v_expected_current_revision_id then
    return jsonb_build_object('ok', false, 'reason', 'stale_current');
  end if;

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

  if jsonb_typeof(v_provenance) is distinct from 'object'
     or exists (
       select 1
       from jsonb_object_keys(v_provenance) as k(key_name)
       where k.key_name not in (
         'schema_version',
         'assembly_schema_version',
         'canonicalization_version',
         'assembly_id',
         'inputs_sha256',
         'campaign_id',
         'session_id',
         'transcript_sha256',
         'timing_policy_version',
         'segment_boundary_policy',
         'timeline_fingerprint_sha256',
         'participant_mapping_schema_version',
         'participant_mapping_policy',
         'participant_mapping_sha256',
         'parts'
       )
     )
     or v_provenance->>'schema_version' is distinct from 'tda_transcript_multi_source_provenance_v1'
     or v_provenance->>'assembly_schema_version' is distinct from 'tda_session_assembly_v1'
     or v_provenance->>'canonicalization_version' is distinct from 'tda_session_assembly_canonical_v1'
     or coalesce(v_provenance->>'assembly_id', '') !~ '^[0-9a-f]{64}$'
     or v_provenance->>'inputs_sha256' is distinct from v_provenance->>'assembly_id'
     or v_provenance->>'campaign_id' is distinct from v_campaign_slug
     or v_provenance->>'session_id' is distinct from v_source_session_id
     or coalesce(v_provenance->>'transcript_sha256', '') !~ '^[0-9a-f]{64}$'
     or v_provenance->>'transcript_sha256' is distinct from v_base_transcript_sha256
     or v_provenance->>'timing_policy_version' is distinct from 'tda_session_timeline_v1'
     or v_provenance->>'segment_boundary_policy' is distinct from 'segment_start_owner_v1'
     or coalesce(v_provenance->>'timeline_fingerprint_sha256', '') !~ '^[0-9a-f]{64}$'
     or v_provenance->>'participant_mapping_schema_version' is distinct from 'tda_session_participant_mapping_v1'
     or v_provenance->>'participant_mapping_policy' is distinct from 'strong_discord_or_manual_v1'
     or coalesce(v_provenance->>'participant_mapping_sha256', '') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(v_provenance->'parts') is distinct from 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  v_part_count := jsonb_array_length(v_provenance->'parts');
  if v_part_count not between 1 and 64 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_provenance->'parts') with ordinality raw(value, position)
    where jsonb_typeof(raw.value) is distinct from 'object'
       or exists (
         select 1
         from jsonb_object_keys(raw.value) as k(key_name)
         where k.key_name not in (
           'part_id',
           'source_id',
           'source_sha256',
           'run_id',
           'transcript_sha256',
           'ordinal',
           'session_offset_seconds',
           'trim_start_seconds',
           'trim_end_seconds',
           'overlap_resolution',
           'overlap_boundary_seconds'
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
           or (raw.value->>'trim_end_seconds')::numeric < (raw.value->>'trim_start_seconds')::numeric
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
    select count(*)
    from (
      select value->>'part_id'
      from jsonb_array_elements(v_provenance->'parts')
      group by 1
    ) unique_parts
  ) <> v_part_count
  or (
    select count(*)
    from (
      select value->>'source_id'
      from jsonb_array_elements(v_provenance->'parts')
      group by 1
    ) unique_sources
  ) <> v_part_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if jsonb_typeof(v_payload) is distinct from 'object'
     or v_payload->>'schema_version' is distinct from 'tda_transcript_publication_v2'
     or v_payload->>'publication_kind' is distinct from 'session_assembly'
     or exists (
       select 1
       from jsonb_object_keys(v_payload) as k(key_name)
       where k.key_name not in (
         'schema_version',
         'publication_kind',
         'base_transcript_sha256',
         'draft_sha256',
         'lineage',
         'provenance',
         'review',
         'segments'
       )
     )
     or v_payload->>'base_transcript_sha256' is distinct from v_base_transcript_sha256
     or v_payload->>'draft_sha256' is distinct from v_draft_sha256
     or v_payload->'provenance' is distinct from v_provenance
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
       where k.key_name not in ('kind', 'assembly_id', 'assembly_schema_version')
     )
     or v_lineage->>'kind' is distinct from 'session_assembly'
     or v_lineage->>'assembly_id' is distinct from v_provenance->>'assembly_id'
     or v_lineage->>'assembly_schema_version' is distinct from 'tda_session_assembly_v1' then
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
           'assembly_segment_id',
           'part_id',
           'source_id',
           'run_id',
           'source_segment_id',
           'track_number',
           'start',
           'end',
           'text',
           'speaker',
           'reviewed'
         )
       )
       or coalesce(raw.value->>'assembly_segment_id', '') !~ '^[0-9a-f]{64}
       or coalesce(raw.value->>'source_id', '') !~ '^craig-[0-9a-f]{64}$'
       or coalesce(raw.value->>'run_id', '') !~ '^[A-Za-z0-9_-]{1,196}$'
       or char_length(raw.value->>'source_segment_id') not between 1 and 256
       or jsonb_typeof(raw.value->'track_number') is distinct from 'number'
       or coalesce(raw.value->>'track_number', '') !~ '^[0-9]{1,4}$'
       or (raw.value->>'track_number')::integer < 1
       or jsonb_typeof(raw.value->'start') is distinct from 'number'
       or jsonb_typeof(raw.value->'end') is distinct from 'number'
       or (raw.value->>'start')::numeric < 0
       or (raw.value->>'end')::numeric < (raw.value->>'start')::numeric
       or (raw.value->>'end')::numeric > 604800
       or jsonb_typeof(raw.value->'text') is distinct from 'string'
       or jsonb_typeof(raw.value->'speaker') is distinct from 'string'
       or jsonb_typeof(raw.value->'reviewed') is distinct from 'boolean'
       or char_length(raw.value->>'text') not between 1 and 100000
       or char_length(raw.value->>'speaker') not between 1 and 160
       or translate(
         raw.value->>'speaker',
         U&'\0001\0002\0003\0004\0005\0006\0007\0008\0009\000A\000B\000C\000D\000E\000F\0010\0011\0012\0013\0014\0015\0016\0017\0018\0019\001A\001B\001C\001D\001E\001F\007F',
         ''
       ) <> raw.value->>'speaker'
       or translate(
         raw.value->>'text',
         U&'\0001\0002\0003\0004\0005\0006\0007\0008\000B\000C\000E\000F\0010\0011\0012\0013\0014\0015\0016\0017\0018\0019\001A\001B\001C\001D\001E\001F\007F',
         ''
       ) <> raw.value->>'text'
       or translate(
         raw.value->>'speaker',
         U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000',
         ''
       ) = ''
       or translate(
         raw.value->>'text',
         U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000',
         ''
       ) = ''
       or not exists (
         select 1
         from jsonb_array_elements(v_provenance->'parts') part(value)
         where part.value->>'part_id' = raw.value->>'part_id'
           and part.value->>'source_id' = raw.value->>'source_id'
           and part.value->>'run_id' = raw.value->>'run_id'
       )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if (
    select count(*)
    from (
      select value->>'assembly_segment_id'
      from jsonb_array_elements(v_segments)
      group by 1
    ) unique_segments
  ) <> v_segment_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select count(*) filter (
    where coalesce((value->>'reviewed')::boolean, false)
  )
  into v_reviewed_segments
  from jsonb_array_elements(v_segments);

  select count(*)::integer
  into v_word_count
  from jsonb_array_elements(v_segments) segment(value)
  cross join lateral string_to_table(
    translate(
      segment.value->>'text',
      U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000',
      repeat(' ', 25)
    ),
    ' '
  ) token(value)
  where token.value <> '';

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
  v_action := case when v_previous_revision_id is null then 'publish' else 'replace' end;

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
    actor_profile_id,
    publication_kind,
    assembly_id,
    assembly_schema_version,
    assembly_inputs_sha256,
    assembly_transcript_sha256,
    assembly_canonicalization_version,
    timing_policy_version,
    segment_boundary_policy,
    timeline_fingerprint_sha256,
    participant_mapping_schema_version,
    participant_mapping_policy,
    participant_mapping_sha256
  ) values (
    v_revision_id,
    v_campaign_id,
    v_session.id,
    v_revision_number,
    v_operation_id,
    'local_companion',
    v_source_session_id,
    null,
    null,
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
    p_actor_profile_id,
    'session_assembly',
    v_provenance->>'assembly_id',
    v_provenance->>'assembly_schema_version',
    v_provenance->>'inputs_sha256',
    v_provenance->>'transcript_sha256',
    v_provenance->>'canonicalization_version',
    v_provenance->>'timing_policy_version',
    v_provenance->>'segment_boundary_policy',
    v_provenance->>'timeline_fingerprint_sha256',
    v_provenance->>'participant_mapping_schema_version',
    v_provenance->>'participant_mapping_policy',
    v_provenance->>'participant_mapping_sha256'
  );

  insert into public.transcript_revision_parts (
    revision_id,
    ordinal,
    part_id,
    source_id,
    source_sha256,
    run_id,
    run_transcript_sha256,
    session_offset_seconds,
    trim_start_seconds,
    trim_end_seconds,
    overlap_resolution,
    overlap_boundary_seconds
  )
  select
    v_revision_id,
    (raw.value->>'ordinal')::smallint,
    raw.value->>'part_id',
    raw.value->>'source_id',
    raw.value->>'source_sha256',
    raw.value->>'run_id',
    raw.value->>'transcript_sha256',
    (raw.value->>'session_offset_seconds')::double precision,
    (raw.value->>'trim_start_seconds')::double precision,
    case
      when raw.value->'trim_end_seconds' = 'null'::jsonb then null
      else (raw.value->>'trim_end_seconds')::double precision
    end,
    case
      when raw.value->'overlap_resolution' = 'null'::jsonb then null
      else raw.value->>'overlap_resolution'
    end,
    case
      when raw.value->'overlap_boundary_seconds' = 'null'::jsonb then null
      else (raw.value->>'overlap_boundary_seconds')::double precision
    end
  from jsonb_array_elements(v_provenance->'parts') raw(value)
  order by (raw.value->>'ordinal')::integer;

  v_receipt_id := gen_random_uuid();
  insert into public.transcript_assembly_publication_receipts (
    id,
    campaign_id,
    session_id,
    revision_id,
    operation_id,
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
    v_provenance->>'assembly_id',
    v_part_count,
    v_base_transcript_sha256,
    v_draft_sha256,
    v_payload_sha256,
    v_segment_count,
    v_word_count,
    p_actor_profile_id
  )
  returning * into v_existing;

  update public.sessions s
  set current_transcript_revision_id = v_revision_id
  where s.id = v_session.id
    and s.campaign_id = v_campaign_id
    and s.current_transcript_revision_id is not distinct from v_expected_current_revision_id;

  if not found then
    raise exception 'transcript revision pointer changed while session was locked';
  end if;

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
      'current_revision_id', v_previous_revision_id
    ),
    jsonb_build_object(
      'current_revision_id', v_revision_id,
      'revision_number', v_revision_number,
      'publication_kind', 'session_assembly',
      'assembly_id', v_provenance->>'assembly_id',
      'assembly_inputs_sha256', v_provenance->>'inputs_sha256',
      'assembly_transcript_sha256', v_provenance->>'transcript_sha256',
      'participant_mapping_sha256', v_provenance->>'participant_mapping_sha256',
      'part_count', v_part_count,
      'payload_sha256', v_payload_sha256,
      'segment_count', v_segment_count,
      'word_count', v_word_count
    )
  );

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
end;
$$;

revoke all on function public.publish_transcript_assembly_revision_atomic(
  uuid, uuid, jsonb, boolean
) from public;
revoke execute on function public.publish_transcript_assembly_revision_atomic(
  uuid, uuid, jsonb, boolean
) from anon;
revoke execute on function public.publish_transcript_assembly_revision_atomic(
  uuid, uuid, jsonb, boolean
) from authenticated;
grant execute on function public.publish_transcript_assembly_revision_atomic(
  uuid, uuid, jsonb, boolean
) to service_role;

comment on function public.publish_transcript_assembly_revision_atomic(
  uuid, uuid, jsonb, boolean
) is
'Server-only SECURITY INVOKER boundary for immutable Session Assembly transcript publication. Authorization precedes target lookup; revision, ordered part provenance, receipt, current pointer, event and metadata-only audit commit atomically.';

comment on column public.transcript_revisions.publication_kind is
'Discriminates historical/single-source revision provenance from Session Assembly provenance without rewriting older rows.';
comment on column public.transcript_revisions.assembly_id is
'Session Assembly identity; equals the canonical inputs SHA-256 for assembly-backed revisions.';

       or raw.value->>'segment_id' is distinct from raw.value->>'assembly_segment_id'
       or coalesce(raw.value->>'part_id', '') !~ '^[0-9a-f]{32}
       or coalesce(raw.value->>'source_id', '') !~ '^craig-[0-9a-f]{64}$'
       or coalesce(raw.value->>'run_id', '') !~ '^[A-Za-z0-9_-]{1,196}$'
       or char_length(raw.value->>'source_segment_id') not between 1 and 256
       or jsonb_typeof(raw.value->'track_number') is distinct from 'number'
       or coalesce(raw.value->>'track_number', '') !~ '^[0-9]{1,4}$'
       or (raw.value->>'track_number')::integer < 1
       or jsonb_typeof(raw.value->'start') is distinct from 'number'
       or jsonb_typeof(raw.value->'end') is distinct from 'number'
       or (raw.value->>'start')::numeric < 0
       or (raw.value->>'end')::numeric < (raw.value->>'start')::numeric
       or (raw.value->>'end')::numeric > 604800
       or jsonb_typeof(raw.value->'text') is distinct from 'string'
       or jsonb_typeof(raw.value->'speaker') is distinct from 'string'
       or jsonb_typeof(raw.value->'reviewed') is distinct from 'boolean'
       or char_length(raw.value->>'text') not between 1 and 100000
       or char_length(raw.value->>'speaker') not between 1 and 160
       or translate(
         raw.value->>'speaker',
         U&'\0001\0002\0003\0004\0005\0006\0007\0008\0009\000A\000B\000C\000D\000E\000F\0010\0011\0012\0013\0014\0015\0016\0017\0018\0019\001A\001B\001C\001D\001E\001F\007F',
         ''
       ) <> raw.value->>'speaker'
       or translate(
         raw.value->>'text',
         U&'\0001\0002\0003\0004\0005\0006\0007\0008\000B\000C\000E\000F\0010\0011\0012\0013\0014\0015\0016\0017\0018\0019\001A\001B\001C\001D\001E\001F\007F',
         ''
       ) <> raw.value->>'text'
       or translate(
         raw.value->>'speaker',
         U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000',
         ''
       ) = ''
       or translate(
         raw.value->>'text',
         U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000',
         ''
       ) = ''
       or not exists (
         select 1
         from jsonb_array_elements(v_provenance->'parts') part(value)
         where part.value->>'part_id' = raw.value->>'part_id'
           and part.value->>'source_id' = raw.value->>'source_id'
           and part.value->>'run_id' = raw.value->>'run_id'
       )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if (
    select count(*)
    from (
      select value->>'assembly_segment_id'
      from jsonb_array_elements(v_segments)
      group by 1
    ) unique_segments
  ) <> v_segment_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select count(*) filter (
    where coalesce((value->>'reviewed')::boolean, false)
  )
  into v_reviewed_segments
  from jsonb_array_elements(v_segments);

  select count(*)::integer
  into v_word_count
  from jsonb_array_elements(v_segments) segment(value)
  cross join lateral string_to_table(
    translate(
      segment.value->>'text',
      U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000',
      repeat(' ', 25)
    ),
    ' '
  ) token(value)
  where token.value <> '';

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
  v_action := case when v_previous_revision_id is null then 'publish' else 'replace' end;

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
    actor_profile_id,
    publication_kind,
    assembly_id,
    assembly_schema_version,
    assembly_inputs_sha256,
    assembly_transcript_sha256,
    assembly_canonicalization_version,
    timing_policy_version,
    segment_boundary_policy,
    timeline_fingerprint_sha256,
    participant_mapping_schema_version,
    participant_mapping_policy,
    participant_mapping_sha256
  ) values (
    v_revision_id,
    v_campaign_id,
    v_session.id,
    v_revision_number,
    v_operation_id,
    'local_companion',
    v_source_session_id,
    null,
    null,
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
    p_actor_profile_id,
    'session_assembly',
    v_provenance->>'assembly_id',
    v_provenance->>'assembly_schema_version',
    v_provenance->>'inputs_sha256',
    v_provenance->>'transcript_sha256',
    v_provenance->>'canonicalization_version',
    v_provenance->>'timing_policy_version',
    v_provenance->>'segment_boundary_policy',
    v_provenance->>'timeline_fingerprint_sha256',
    v_provenance->>'participant_mapping_schema_version',
    v_provenance->>'participant_mapping_policy',
    v_provenance->>'participant_mapping_sha256'
  );

  insert into public.transcript_revision_parts (
    revision_id,
    ordinal,
    part_id,
    source_id,
    source_sha256,
    run_id,
    run_transcript_sha256,
    session_offset_seconds,
    trim_start_seconds,
    trim_end_seconds,
    overlap_resolution,
    overlap_boundary_seconds
  )
  select
    v_revision_id,
    (raw.value->>'ordinal')::smallint,
    raw.value->>'part_id',
    raw.value->>'source_id',
    raw.value->>'source_sha256',
    raw.value->>'run_id',
    raw.value->>'transcript_sha256',
    (raw.value->>'session_offset_seconds')::double precision,
    (raw.value->>'trim_start_seconds')::double precision,
    case
      when raw.value->'trim_end_seconds' = 'null'::jsonb then null
      else (raw.value->>'trim_end_seconds')::double precision
    end,
    case
      when raw.value->'overlap_resolution' = 'null'::jsonb then null
      else raw.value->>'overlap_resolution'
    end,
    case
      when raw.value->'overlap_boundary_seconds' = 'null'::jsonb then null
      else (raw.value->>'overlap_boundary_seconds')::double precision
    end
  from jsonb_array_elements(v_provenance->'parts') raw(value)
  order by (raw.value->>'ordinal')::integer;

  v_receipt_id := gen_random_uuid();
  insert into public.transcript_assembly_publication_receipts (
    id,
    campaign_id,
    session_id,
    revision_id,
    operation_id,
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
    v_provenance->>'assembly_id',
    v_part_count,
    v_base_transcript_sha256,
    v_draft_sha256,
    v_payload_sha256,
    v_segment_count,
    v_word_count,
    p_actor_profile_id
  )
  returning * into v_existing;

  update public.sessions s
  set current_transcript_revision_id = v_revision_id
  where s.id = v_session.id
    and s.campaign_id = v_campaign_id
    and s.current_transcript_revision_id is not distinct from v_expected_current_revision_id;

  if not found then
    raise exception 'transcript revision pointer changed while session was locked';
  end if;

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
      'current_revision_id', v_previous_revision_id
    ),
    jsonb_build_object(
      'current_revision_id', v_revision_id,
      'revision_number', v_revision_number,
      'publication_kind', 'session_assembly',
      'assembly_id', v_provenance->>'assembly_id',
      'assembly_inputs_sha256', v_provenance->>'inputs_sha256',
      'assembly_transcript_sha256', v_provenance->>'transcript_sha256',
      'participant_mapping_sha256', v_provenance->>'participant_mapping_sha256',
      'part_count', v_part_count,
      'payload_sha256', v_payload_sha256,
      'segment_count', v_segment_count,
      'word_count', v_word_count
    )
  );

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
end;
$$;

revoke all on function public.publish_transcript_assembly_revision_atomic(
  uuid, uuid, jsonb, boolean
) from public;
revoke execute on function public.publish_transcript_assembly_revision_atomic(
  uuid, uuid, jsonb, boolean
) from anon;
revoke execute on function public.publish_transcript_assembly_revision_atomic(
  uuid, uuid, jsonb, boolean
) from authenticated;
grant execute on function public.publish_transcript_assembly_revision_atomic(
  uuid, uuid, jsonb, boolean
) to service_role;

comment on function public.publish_transcript_assembly_revision_atomic(
  uuid, uuid, jsonb, boolean
) is
'Server-only SECURITY INVOKER boundary for immutable Session Assembly transcript publication. Authorization precedes target lookup; revision, ordered part provenance, receipt, current pointer, event and metadata-only audit commit atomically.';

comment on column public.transcript_revisions.publication_kind is
'Discriminates historical/single-source revision provenance from Session Assembly provenance without rewriting older rows.';
comment on column public.transcript_revisions.assembly_id is
'Session Assembly identity; equals the canonical inputs SHA-256 for assembly-backed revisions.';

       or coalesce(raw.value->>'source_id', '') !~ '^craig-[0-9a-f]{64}$'
       or coalesce(raw.value->>'run_id', '') !~ '^[A-Za-z0-9_-]{1,196}$'
       or char_length(raw.value->>'source_segment_id') not between 1 and 256
       or jsonb_typeof(raw.value->'track_number') is distinct from 'number'
       or coalesce(raw.value->>'track_number', '') !~ '^[0-9]{1,4}$'
       or (raw.value->>'track_number')::integer < 1
       or jsonb_typeof(raw.value->'start') is distinct from 'number'
       or jsonb_typeof(raw.value->'end') is distinct from 'number'
       or (raw.value->>'start')::numeric < 0
       or (raw.value->>'end')::numeric < (raw.value->>'start')::numeric
       or (raw.value->>'end')::numeric > 604800
       or jsonb_typeof(raw.value->'text') is distinct from 'string'
       or jsonb_typeof(raw.value->'speaker') is distinct from 'string'
       or jsonb_typeof(raw.value->'reviewed') is distinct from 'boolean'
       or char_length(raw.value->>'text') not between 1 and 100000
       or char_length(raw.value->>'speaker') not between 1 and 160
       or translate(
         raw.value->>'speaker',
         U&'\0001\0002\0003\0004\0005\0006\0007\0008\0009\000A\000B\000C\000D\000E\000F\0010\0011\0012\0013\0014\0015\0016\0017\0018\0019\001A\001B\001C\001D\001E\001F\007F',
         ''
       ) <> raw.value->>'speaker'
       or translate(
         raw.value->>'text',
         U&'\0001\0002\0003\0004\0005\0006\0007\0008\000B\000C\000E\000F\0010\0011\0012\0013\0014\0015\0016\0017\0018\0019\001A\001B\001C\001D\001E\001F\007F',
         ''
       ) <> raw.value->>'text'
       or translate(
         raw.value->>'speaker',
         U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000',
         ''
       ) = ''
       or translate(
         raw.value->>'text',
         U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000',
         ''
       ) = ''
       or not exists (
         select 1
         from jsonb_array_elements(v_provenance->'parts') part(value)
         where part.value->>'part_id' = raw.value->>'part_id'
           and part.value->>'source_id' = raw.value->>'source_id'
           and part.value->>'run_id' = raw.value->>'run_id'
       )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if (
    select count(*)
    from (
      select value->>'assembly_segment_id'
      from jsonb_array_elements(v_segments)
      group by 1
    ) unique_segments
  ) <> v_segment_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select count(*) filter (
    where coalesce((value->>'reviewed')::boolean, false)
  )
  into v_reviewed_segments
  from jsonb_array_elements(v_segments);

  select count(*)::integer
  into v_word_count
  from jsonb_array_elements(v_segments) segment(value)
  cross join lateral string_to_table(
    translate(
      segment.value->>'text',
      U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000',
      repeat(' ', 25)
    ),
    ' '
  ) token(value)
  where token.value <> '';

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
  v_action := case when v_previous_revision_id is null then 'publish' else 'replace' end;

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
    actor_profile_id,
    publication_kind,
    assembly_id,
    assembly_schema_version,
    assembly_inputs_sha256,
    assembly_transcript_sha256,
    assembly_canonicalization_version,
    timing_policy_version,
    segment_boundary_policy,
    timeline_fingerprint_sha256,
    participant_mapping_schema_version,
    participant_mapping_policy,
    participant_mapping_sha256
  ) values (
    v_revision_id,
    v_campaign_id,
    v_session.id,
    v_revision_number,
    v_operation_id,
    'local_companion',
    v_source_session_id,
    null,
    null,
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
    p_actor_profile_id,
    'session_assembly',
    v_provenance->>'assembly_id',
    v_provenance->>'assembly_schema_version',
    v_provenance->>'inputs_sha256',
    v_provenance->>'transcript_sha256',
    v_provenance->>'canonicalization_version',
    v_provenance->>'timing_policy_version',
    v_provenance->>'segment_boundary_policy',
    v_provenance->>'timeline_fingerprint_sha256',
    v_provenance->>'participant_mapping_schema_version',
    v_provenance->>'participant_mapping_policy',
    v_provenance->>'participant_mapping_sha256'
  );

  insert into public.transcript_revision_parts (
    revision_id,
    ordinal,
    part_id,
    source_id,
    source_sha256,
    run_id,
    run_transcript_sha256,
    session_offset_seconds,
    trim_start_seconds,
    trim_end_seconds,
    overlap_resolution,
    overlap_boundary_seconds
  )
  select
    v_revision_id,
    (raw.value->>'ordinal')::smallint,
    raw.value->>'part_id',
    raw.value->>'source_id',
    raw.value->>'source_sha256',
    raw.value->>'run_id',
    raw.value->>'transcript_sha256',
    (raw.value->>'session_offset_seconds')::double precision,
    (raw.value->>'trim_start_seconds')::double precision,
    case
      when raw.value->'trim_end_seconds' = 'null'::jsonb then null
      else (raw.value->>'trim_end_seconds')::double precision
    end,
    case
      when raw.value->'overlap_resolution' = 'null'::jsonb then null
      else raw.value->>'overlap_resolution'
    end,
    case
      when raw.value->'overlap_boundary_seconds' = 'null'::jsonb then null
      else (raw.value->>'overlap_boundary_seconds')::double precision
    end
  from jsonb_array_elements(v_provenance->'parts') raw(value)
  order by (raw.value->>'ordinal')::integer;

  v_receipt_id := gen_random_uuid();
  insert into public.transcript_assembly_publication_receipts (
    id,
    campaign_id,
    session_id,
    revision_id,
    operation_id,
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
    v_provenance->>'assembly_id',
    v_part_count,
    v_base_transcript_sha256,
    v_draft_sha256,
    v_payload_sha256,
    v_segment_count,
    v_word_count,
    p_actor_profile_id
  )
  returning * into v_existing;

  update public.sessions s
  set current_transcript_revision_id = v_revision_id
  where s.id = v_session.id
    and s.campaign_id = v_campaign_id
    and s.current_transcript_revision_id is not distinct from v_expected_current_revision_id;

  if not found then
    raise exception 'transcript revision pointer changed while session was locked';
  end if;

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
      'current_revision_id', v_previous_revision_id
    ),
    jsonb_build_object(
      'current_revision_id', v_revision_id,
      'revision_number', v_revision_number,
      'publication_kind', 'session_assembly',
      'assembly_id', v_provenance->>'assembly_id',
      'assembly_inputs_sha256', v_provenance->>'inputs_sha256',
      'assembly_transcript_sha256', v_provenance->>'transcript_sha256',
      'participant_mapping_sha256', v_provenance->>'participant_mapping_sha256',
      'part_count', v_part_count,
      'payload_sha256', v_payload_sha256,
      'segment_count', v_segment_count,
      'word_count', v_word_count
    )
  );

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
end;
$$;

revoke all on function public.publish_transcript_assembly_revision_atomic(
  uuid, uuid, jsonb, boolean
) from public;
revoke execute on function public.publish_transcript_assembly_revision_atomic(
  uuid, uuid, jsonb, boolean
) from anon;
revoke execute on function public.publish_transcript_assembly_revision_atomic(
  uuid, uuid, jsonb, boolean
) from authenticated;
grant execute on function public.publish_transcript_assembly_revision_atomic(
  uuid, uuid, jsonb, boolean
) to service_role;

comment on function public.publish_transcript_assembly_revision_atomic(
  uuid, uuid, jsonb, boolean
) is
'Server-only SECURITY INVOKER boundary for immutable Session Assembly transcript publication. Authorization precedes target lookup; revision, ordered part provenance, receipt, current pointer, event and metadata-only audit commit atomically.';

comment on column public.transcript_revisions.publication_kind is
'Discriminates historical/single-source revision provenance from Session Assembly provenance without rewriting older rows.';
comment on column public.transcript_revisions.assembly_id is
'Session Assembly identity; equals the canonical inputs SHA-256 for assembly-backed revisions.';
