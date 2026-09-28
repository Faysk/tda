-- #898: safe inline editing for the canonical private transcript workspace.
-- The browser sends only speaker/text patches. Timing, source lineage and raw ASR
-- remain immutable. The service-role-only RPC clones the current private revision
-- and swaps sessions.current_transcript_revision_id under the same row lock.
create function public.edit_transcript_revision_atomic(
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_expected_current_revision_id uuid,
  p_operation_id uuid,
  p_edits jsonb
)
returns table(status text, revision_id uuid, revision_number bigint)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_session public.sessions%rowtype;
  v_current public.transcript_revisions%rowtype;
  v_existing public.transcript_revisions%rowtype;
  v_new_revision_id uuid;
  v_new_revision_number bigint;
  v_edit_count integer;
  v_match_count integer;
  v_word_count integer;
  v_edit_sha256 text;
  v_revision_sha256 text;
  v_new_segments jsonb;
  v_new_lineage jsonb;
  v_new_review_summary jsonb;
begin
  if p_actor_profile_id is null
     or p_campaign_slug is null
     or btrim(p_campaign_slug) = ''
     or p_session_id is null
     or p_expected_current_revision_id is null
     or p_operation_id is null then
    raise exception 'invalid transcript revision edit identity' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
  ) then
    return query select 'forbidden'::text, null::uuid, null::bigint;
    return;
  end if;

  if p_edits is null or jsonb_typeof(p_edits) <> 'array' then
    raise exception 'transcript revision edits must be an array' using errcode = '22023';
  end if;

  v_edit_count := jsonb_array_length(p_edits);
  if v_edit_count < 1 or v_edit_count > 10000 then
    raise exception 'invalid transcript revision edit count' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_edits) e(value)
    where jsonb_typeof(e.value) <> 'object'
  ) then
    raise exception 'invalid transcript revision edit shape' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_edits) e(value)
    cross join lateral jsonb_object_keys(e.value) k(key_name)
    where k.key_name not in ('id', 'speaker', 'text')
  ) then
    raise exception 'unexpected transcript revision edit field' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_edits) e(value)
    where jsonb_typeof(e.value->'id') is distinct from 'string'
       or jsonb_typeof(e.value->'speaker') is distinct from 'string'
       or jsonb_typeof(e.value->'text') is distinct from 'string'
       or btrim(e.value->>'id') = ''
       or char_length(e.value->>'id') > 512
       or btrim(e.value->>'speaker') = ''
       or char_length(e.value->>'speaker') > 160
       or btrim(e.value->>'text') = ''
       or char_length(e.value->>'text') > 10000
  ) then
    raise exception 'invalid transcript revision edit value' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_edits) e(value)
    group by e.value->>'id'
    having count(*) > 1
  ) then
    raise exception 'duplicate transcript revision edit identity' using errcode = '22023';
  end if;

  v_edit_sha256 := encode(
    extensions.digest(convert_to(p_edits::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select c.id
  into v_campaign_id
  from public.campaigns c
  where c.slug = p_campaign_slug;

  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;

  select s.*
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = v_campaign_id
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;

  select r.*
  into v_existing
  from public.transcript_revisions r
  where r.session_id = p_session_id
    and r.operation_id = p_operation_id;

  if found then
    if v_session.current_transcript_revision_id = v_existing.id
       and v_existing.lineage #>> '{editorial_edit,parentRevisionId}' = p_expected_current_revision_id::text
       and v_existing.lineage #>> '{editorial_edit,editSha256}' = v_edit_sha256 then
      return query
      select 'updated'::text, v_existing.id, v_existing.revision_number;
    else
      return query select 'conflict'::text, null::uuid, null::bigint;
    end if;
    return;
  end if;

  if v_session.current_transcript_revision_id is distinct from p_expected_current_revision_id then
    return query select 'conflict'::text, null::uuid, null::bigint;
    return;
  end if;

  select r.*
  into v_current
  from public.transcript_revisions r
  where r.id = p_expected_current_revision_id
    and r.session_id = p_session_id
    and r.campaign_id = v_campaign_id;

  if not found then
    raise exception 'current transcript revision pointer is inconsistent';
  end if;

  if jsonb_typeof(v_current.segments) <> 'array'
     or jsonb_array_length(v_current.segments) < 1
     or jsonb_array_length(v_current.segments) > 100000 then
    raise exception 'current transcript revision segments are invalid';
  end if;

  select count(*)::integer
  into v_match_count
  from jsonb_array_elements(p_edits) e(value)
  join jsonb_array_elements(v_current.segments) s(value)
    on e.value->>'id' =
       'r-' || (s.value->>'track_number') || '-' || (s.value->>'segment_id');

  if v_match_count <> v_edit_count then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;

  select jsonb_agg(
    case
      when patch.value is null then segment.value
      else jsonb_set(
        jsonb_set(
          segment.value,
          '{speaker}',
          to_jsonb(btrim(patch.value->>'speaker')),
          true
        ),
        '{text}',
        to_jsonb(btrim(patch.value->>'text')),
        true
      )
    end
    order by segment.ordinality
  )
  into v_new_segments
  from jsonb_array_elements(v_current.segments) with ordinality segment(value, ordinality)
  left join lateral (
    select edit.value
    from jsonb_array_elements(p_edits) edit(value)
    where edit.value->>'id' =
          'r-' || (segment.value->>'track_number') || '-' || (segment.value->>'segment_id')
    limit 1
  ) patch on true;

  if v_new_segments = v_current.segments then
    return query
    select 'no_change'::text, v_current.id, v_current.revision_number;
    return;
  end if;

  select coalesce(
    sum(
      case
        when btrim(segment.value->>'text') = '' then 0
        else cardinality(
          regexp_split_to_array(btrim(segment.value->>'text'), E'\\s+')
        )
      end
    ),
    0
  )::integer
  into v_word_count
  from jsonb_array_elements(v_new_segments) segment(value);

  v_revision_sha256 := encode(
    extensions.digest(convert_to(v_new_segments::text, 'UTF8'), 'sha256'),
    'hex'
  );

  v_new_lineage :=
    case
      when jsonb_typeof(v_current.lineage) = 'object' then v_current.lineage
      else jsonb_build_object('sourceLineage', v_current.lineage)
    end
    || jsonb_build_object(
      'editorial_edit',
      jsonb_build_object(
        'parentRevisionId', v_current.id,
        'parentRevisionNumber', v_current.revision_number,
        'operationId', p_operation_id,
        'editSha256', v_edit_sha256,
        'changedSegments', v_edit_count
      )
    );

  v_new_review_summary :=
    case
      when jsonb_typeof(v_current.review_summary) = 'object'
        then jsonb_set(
          v_current.review_summary,
          '{word_count}',
          to_jsonb(v_word_count),
          true
        )
      else v_current.review_summary
    end;

  select coalesce(max(r.revision_number), 0) + 1
  into v_new_revision_number
  from public.transcript_revisions r
  where r.session_id = p_session_id;

  v_new_revision_id := gen_random_uuid();

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
    v_new_revision_id,
    v_campaign_id,
    p_session_id,
    v_new_revision_number,
    p_operation_id,
    v_current.source_system,
    v_current.source_session_id,
    v_current.source_id,
    v_current.run_id,
    v_current.base_transcript_sha256,
    v_revision_sha256,
    v_revision_sha256,
    jsonb_array_length(v_new_segments),
    v_word_count,
    v_current.reviewed_segments,
    v_current.warning_count,
    v_new_lineage,
    v_new_review_summary,
    v_new_segments,
    p_actor_profile_id
  );

  update public.sessions s
  set current_transcript_revision_id = v_new_revision_id
  where s.id = p_session_id
    and s.campaign_id = v_campaign_id
    and s.current_transcript_revision_id is not distinct from p_expected_current_revision_id;

  if not found then
    raise exception 'transcript revision pointer changed while session was locked';
  end if;

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
    v_new_revision_id,
    jsonb_build_object(
      'revisionId', v_current.id,
      'revisionNumber', v_current.revision_number
    ),
    jsonb_build_object(
      'revisionId', v_new_revision_id,
      'revisionNumber', v_new_revision_number,
      'changedSegments', v_edit_count,
      'revisionSha256', v_revision_sha256
    )
  );

  return query
  select 'updated'::text, v_new_revision_id, v_new_revision_number;
end;
$$;

comment on function public.edit_transcript_revision_atomic(
  uuid, text, uuid, uuid, uuid, jsonb
)
is 'Server-only SECURITY INVOKER boundary for #898. Creates an immutable private transcript revision from speaker/text-only patches and swaps the current revision with optimistic CAS. Timing/raw ASR/public session state remain untouched; audit values contain no transcript text.';

revoke all on function public.edit_transcript_revision_atomic(
  uuid, text, uuid, uuid, uuid, jsonb
) from public;
revoke execute on function public.edit_transcript_revision_atomic(
  uuid, text, uuid, uuid, uuid, jsonb
) from anon;
revoke execute on function public.edit_transcript_revision_atomic(
  uuid, text, uuid, uuid, uuid, jsonb
) from authenticated;
grant execute on function public.edit_transcript_revision_atomic(
  uuid, text, uuid, uuid, uuid, jsonb
) to service_role;
