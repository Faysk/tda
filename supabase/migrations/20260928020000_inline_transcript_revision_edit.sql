-- #898 — immutable inline transcript corrections from the canonical Edit workspace.
-- The browser never calls this RPC directly. The authorized server action resolves
-- campaign.content.edit first; this SECURITY INVOKER boundary rechecks campaign/session
-- ownership, performs current-pointer CAS, clones the immutable revision and writes only
-- metadata/hashes to audit_log.

create or replace function public.edit_current_transcript_revision_atomic(
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_expected_current_revision_id uuid,
  p_operation_id uuid,
  p_edits jsonb
)
returns table(
  status text,
  revision_id uuid,
  revision_number bigint,
  current_revision_id uuid
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_current_revision_id uuid;
  v_base public.transcript_revisions%rowtype;
  v_existing public.transcript_revisions%rowtype;
  v_edit jsonb;
  v_index bigint;
  v_unique_count integer;
  v_segments jsonb;
  v_lineage jsonb;
  v_review_summary jsonb;
  v_request_sha256 text;
  v_draft_sha256 text;
  v_payload_sha256 text;
  v_revision_id uuid;
  v_revision_number bigint;
  v_reviewed_segments integer;
  v_word_count integer;
begin
  if p_actor_profile_id is null
     or p_campaign_slug is null
     or btrim(p_campaign_slug) = ''
     or p_session_id is null
     or p_expected_current_revision_id is null
     or p_operation_id is null
     or p_edits is null
     or jsonb_typeof(p_edits) is distinct from 'array'
     or jsonb_array_length(p_edits) > 10000
     or octet_length(p_edits::text) > 8388608 then
    return query select
      'invalid_payload'::text,
      null::uuid,
      null::bigint,
      null::uuid;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_edits) e(value)
    where jsonb_typeof(e.value) is distinct from 'object'
       or exists (
         select 1
         from jsonb_object_keys(e.value) k(key_name)
         where k.key_name not in ('track_number', 'segment_id', 'speaker', 'text')
       )
       or jsonb_typeof(e.value->'track_number') is distinct from 'number'
       or jsonb_typeof(e.value->'segment_id') is distinct from 'string'
       or jsonb_typeof(e.value->'speaker') is distinct from 'string'
       or jsonb_typeof(e.value->'text') is distinct from 'string'
       or coalesce(e.value->>'track_number', '') !~ '^[0-9]{1,4}$'
       or (e.value->>'track_number')::integer < 1
       or char_length(e.value->>'segment_id') not between 1 and 256
       or char_length(btrim(e.value->>'speaker')) not between 1 and 160
       or char_length(btrim(e.value->>'text')) not between 1 and 100000
  ) then
    return query select
      'invalid_payload'::text,
      null::uuid,
      null::bigint,
      null::uuid;
    return;
  end if;

  select count(*)
  into v_unique_count
  from (
    select
      (e.value->>'track_number')::integer as track_number,
      e.value->>'segment_id' as segment_id
    from jsonb_array_elements(p_edits) e(value)
    group by 1, 2
  ) unique_edits;

  if v_unique_count <> jsonb_array_length(p_edits) then
    return query select
      'invalid_payload'::text,
      null::uuid,
      null::bigint,
      null::uuid;
    return;
  end if;

  v_request_sha256 := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'schema_version', 'tda_transcript_inline_edit_v1',
          'expected_current_revision_id', p_expected_current_revision_id,
          'edits', p_edits
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select s.campaign_id, s.current_transcript_revision_id
  into v_campaign_id, v_current_revision_id
  from public.sessions s
  join public.campaigns c on c.id = s.campaign_id
  where s.id = p_session_id
    and c.slug = p_campaign_slug
  for update of s;

  if not found then
    return query select
      'not_found'::text,
      null::uuid,
      null::bigint,
      null::uuid;
    return;
  end if;

  select r.*
  into v_existing
  from public.transcript_revisions r
  where r.session_id = p_session_id
    and r.operation_id = p_operation_id;

  if found then
    if v_existing.lineage->'inline_edit'->>'request_sha256' <> v_request_sha256
       or v_existing.lineage->'inline_edit'->>'request_sha256' is null then
      return query select
        'conflict'::text,
        null::uuid,
        null::bigint,
        v_current_revision_id;
    elsif v_current_revision_id is distinct from v_existing.id then
      return query select
        'stale_current'::text,
        null::uuid,
        null::bigint,
        v_current_revision_id;
    else
      return query select
        'replay'::text,
        v_existing.id,
        v_existing.revision_number,
        v_current_revision_id;
    end if;
    return;
  end if;

  if v_current_revision_id is distinct from p_expected_current_revision_id then
    return query select
      'stale_current'::text,
      null::uuid,
      null::bigint,
      v_current_revision_id;
    return;
  end if;

  select r.*
  into v_base
  from public.transcript_revisions r
  where r.id = p_expected_current_revision_id
    and r.session_id = p_session_id
    and r.campaign_id = v_campaign_id;

  if not found
     or jsonb_typeof(v_base.segments) is distinct from 'array' then
    return query select
      'not_found'::text,
      null::uuid,
      null::bigint,
      v_current_revision_id;
    return;
  end if;

  v_segments := v_base.segments;

  for v_edit in
    select e.value
    from jsonb_array_elements(p_edits) e(value)
  loop
    select segment.ordinality - 1
    into v_index
    from jsonb_array_elements(v_segments) with ordinality segment(value, ordinality)
    where coalesce(segment.value->>'track_number', '') = v_edit->>'track_number'
      and segment.value->>'segment_id' = v_edit->>'segment_id'
    limit 1;

    if not found then
      return query select
        'invalid_edit'::text,
        null::uuid,
        null::bigint,
        v_current_revision_id;
      return;
    end if;

    v_segments := jsonb_set(
      v_segments,
      array[v_index::text, 'speaker'],
      to_jsonb(btrim(v_edit->>'speaker')),
      false
    );
    v_segments := jsonb_set(
      v_segments,
      array[v_index::text, 'text'],
      to_jsonb(btrim(v_edit->>'text')),
      false
    );
  end loop;

  if v_segments = v_base.segments then
    return query select
      'unchanged'::text,
      v_base.id,
      v_base.revision_number,
      v_current_revision_id;
    return;
  end if;

  select
    count(*) filter (where coalesce((segment.value->>'reviewed')::boolean, false)),
    coalesce(
      sum(
        cardinality(
          regexp_split_to_array(btrim(segment.value->>'text'), E'\\s+')
        )
      ),
      0
    )
  into v_reviewed_segments, v_word_count
  from jsonb_array_elements(v_segments) segment(value);

  v_review_summary := jsonb_set(
    jsonb_set(
      coalesce(v_base.review_summary, '{}'::jsonb),
      '{reviewed_segments}',
      to_jsonb(v_reviewed_segments),
      true
    ),
    '{word_count}',
    to_jsonb(v_word_count),
    true
  );

  v_lineage := coalesce(v_base.lineage, '{}'::jsonb) || jsonb_build_object(
    'inline_edit',
    jsonb_build_object(
      'schema_version', 'tda_transcript_inline_edit_v1',
      'base_revision_id', p_expected_current_revision_id,
      'request_sha256', v_request_sha256
    )
  );

  v_draft_sha256 := encode(
    extensions.digest(convert_to(v_segments::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_payload_sha256 := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'schema_version', 'tda_transcript_inline_edit_v1',
          'base_revision_id', p_expected_current_revision_id,
          'lineage', v_lineage,
          'review', v_review_summary,
          'segments', v_segments
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select coalesce(max(r.revision_number), 0) + 1
  into v_revision_number
  from public.transcript_revisions r
  where r.session_id = p_session_id;

  v_revision_id := gen_random_uuid();

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
    v_base.campaign_id,
    v_base.session_id,
    v_revision_number,
    p_operation_id,
    v_base.source_system,
    v_base.source_session_id,
    v_base.source_id,
    v_base.run_id,
    v_base.base_transcript_sha256,
    v_draft_sha256,
    v_payload_sha256,
    jsonb_array_length(v_segments),
    v_word_count,
    v_reviewed_segments,
    v_base.warning_count,
    v_lineage,
    v_review_summary,
    v_segments,
    p_actor_profile_id
  );

  update public.sessions s
  set current_transcript_revision_id = v_revision_id
  where s.id = p_session_id
    and s.campaign_id = v_campaign_id;

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
    p_session_id,
    p_actor_profile_id,
    'transcript_revision.edit',
    'transcript_revisions',
    v_revision_id,
    jsonb_build_object(
      'revision_id', v_base.id,
      'revision_number', v_base.revision_number,
      'payload_sha256', v_base.payload_sha256,
      'segment_count', v_base.segment_count
    ),
    jsonb_build_object(
      'revision_id', v_revision_id,
      'revision_number', v_revision_number,
      'payload_sha256', v_payload_sha256,
      'segment_count', jsonb_array_length(v_segments),
      'changed_segment_count', jsonb_array_length(p_edits)
    )
  );

  return query select
    'updated'::text,
    v_revision_id,
    v_revision_number,
    v_revision_id;
end;
$$;

comment on function public.edit_current_transcript_revision_atomic(uuid, text, uuid, uuid, uuid, jsonb)
is 'Server-only SECURITY INVOKER CAS boundary for #898. Clones the immutable current transcript revision, applies speaker/text-only edits, switches the current pointer atomically and audits metadata/hashes without transcript text.';

revoke all on function public.edit_current_transcript_revision_atomic(uuid, text, uuid, uuid, uuid, jsonb) from public;
revoke execute on function public.edit_current_transcript_revision_atomic(uuid, text, uuid, uuid, uuid, jsonb) from anon;
revoke execute on function public.edit_current_transcript_revision_atomic(uuid, text, uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.edit_current_transcript_revision_atomic(uuid, text, uuid, uuid, uuid, jsonb) to service_role;
