-- Safe private transcript revision editing for #898.
-- Browser roles stay denied; the server-side service role is the only caller.
-- A save derives a new immutable revision from the expected current revision and
-- atomically advances sessions.current_transcript_revision_id. It never mutates
-- the parent revision or public session publication state.

alter table public.transcript_revisions
  add column revision_origin text not null default 'local_companion'
  check (revision_origin in ('local_companion', 'web_edit'));

alter table public.transcript_revisions
  add column parent_revision_id uuid null
  references public.transcript_revisions(id)
  on delete restrict;

create index transcript_revisions_parent_revision_id_idx
  on public.transcript_revisions(parent_revision_id)
  where parent_revision_id is not null;

comment on column public.transcript_revisions.revision_origin is
'Origin of this immutable cloud revision. local_companion rows come from the reviewed local publication payload; web_edit rows are private server-materialized derivatives.';

comment on column public.transcript_revisions.parent_revision_id is
'Immediate immutable parent for a derived transcript revision. Web edits must point at the expected current revision they derive from.';

create function public.save_transcript_revision_edit_atomic(
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_operation_id uuid,
  p_expected_current_revision_id uuid,
  p_edits jsonb
)
returns table(status text, revision_id uuid, revision_number bigint)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_current_revision_id uuid;
  v_parent public.transcript_revisions%rowtype;
  v_existing public.transcript_revisions%rowtype;
  v_segments jsonb;
  v_new_revision_id uuid;
  v_new_revision_number bigint;
  v_edit_count integer;
  v_reviewed_segments integer;
  v_word_count bigint;
  v_content_sha256 text;
  v_review_summary jsonb;
begin
  if p_actor_profile_id is null
     or p_campaign_slug is null
     or btrim(p_campaign_slug) = ''
     or p_session_id is null
     or p_operation_id is null
     or p_expected_current_revision_id is null
     or p_edits is null
     or jsonb_typeof(p_edits) is distinct from 'array'
     or jsonb_array_length(p_edits) > 100000 then
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

  select s.campaign_id, s.current_transcript_revision_id
  into v_campaign_id, v_current_revision_id
  from public.sessions s
  join public.campaigns c on c.id = s.campaign_id
  where s.id = p_session_id
    and c.slug = p_campaign_slug
  for update of s;

  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;

  select tr.*
  into v_parent
  from public.transcript_revisions tr
  where tr.id = p_expected_current_revision_id
    and tr.session_id = p_session_id
    and tr.campaign_id = v_campaign_id;

  if not found
     or jsonb_typeof(v_parent.segments) is distinct from 'array'
     or jsonb_array_length(v_parent.segments) <> v_parent.segment_count then
    return query select 'invalid_base'::text, null::uuid, null::bigint;
    return;
  end if;

  v_edit_count := jsonb_array_length(p_edits);

  if exists (
    select 1
    from jsonb_array_elements(p_edits) e(value)
    where jsonb_typeof(e.value) is distinct from 'object'
       or (
         select count(*)
         from jsonb_object_keys(e.value) k
       ) <> 4
       or exists (
         select 1
         from jsonb_object_keys(e.value) k
         where k not in ('track_number', 'segment_id', 'speaker', 'text')
       )
       or jsonb_typeof(e.value->'track_number') is distinct from 'number'
       or jsonb_typeof(e.value->'segment_id') is distinct from 'string'
       or jsonb_typeof(e.value->'speaker') is distinct from 'string'
       or jsonb_typeof(e.value->'text') is distinct from 'string'
       or coalesce(e.value->>'track_number', '') !~ '^[0-9]{1,4}$'
       or (e.value->>'track_number')::integer < 1
       or char_length(e.value->>'segment_id') not between 1 and 256
       or char_length(e.value->>'speaker') not between 1 and 160
       or btrim(e.value->>'speaker') = ''
       or char_length(e.value->>'text') not between 1 and 100000
       or btrim(e.value->>'text') = ''
  ) then
    return query select 'invalid_edits'::text, null::uuid, null::bigint;
    return;
  end if;

  if (
    select count(*)
    from (
      select
        (e.value->>'track_number')::integer as track_number,
        e.value->>'segment_id' as segment_id
      from jsonb_array_elements(p_edits) e(value)
      group by 1, 2
    ) unique_edits
  ) <> v_edit_count then
    return query select 'invalid_edits'::text, null::uuid, null::bigint;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_edits) e(value)
    where not exists (
      select 1
      from jsonb_array_elements(v_parent.segments) base(value)
      where (base.value->>'track_number')::integer =
            (e.value->>'track_number')::integer
        and base.value->>'segment_id' = e.value->>'segment_id'
    )
  ) then
    return query select 'invalid_edits'::text, null::uuid, null::bigint;
    return;
  end if;

  with edits as materialized (
    select
      (value->>'track_number')::integer as track_number,
      value->>'segment_id' as segment_id,
      value->'speaker' as speaker,
      value->'text' as text
    from jsonb_array_elements(p_edits)
  ),
  rebuilt as (
    select
      base.ordinality,
      case
        when edits.segment_id is null then base.value
        else jsonb_set(
          jsonb_set(base.value, '{speaker}', edits.speaker, false),
          '{text}',
          edits.text,
          false
        )
      end as value
    from jsonb_array_elements(v_parent.segments)
      with ordinality as base(value, ordinality)
    left join edits
      on edits.track_number = (base.value->>'track_number')::integer
     and edits.segment_id = base.value->>'segment_id'
  )
  select jsonb_agg(value order by ordinality)
  into v_segments
  from rebuilt;

  if v_segments is null
     or jsonb_typeof(v_segments) is distinct from 'array'
     or jsonb_array_length(v_segments) <> v_parent.segment_count then
    raise exception 'transcript revision rebuild failed';
  end if;

  -- Lost-response replay is checked before current-pointer CAS.
  select tr.*
  into v_existing
  from public.transcript_revisions tr
  where tr.session_id = p_session_id
    and tr.operation_id = p_operation_id;

  if found then
    if v_existing.revision_origin = 'web_edit'
       and v_existing.parent_revision_id = p_expected_current_revision_id
       and v_existing.segments = v_segments then
      return query
        select 'replay'::text, v_existing.id, v_existing.revision_number;
      return;
    end if;
    return query select 'conflict'::text, null::uuid, null::bigint;
    return;
  end if;

  if v_current_revision_id is distinct from p_expected_current_revision_id then
    return query
      select 'stale_current'::text, v_current_revision_id, null::bigint;
    return;
  end if;

  if v_segments = v_parent.segments then
    return query
      select 'no_change'::text, v_parent.id, v_parent.revision_number;
    return;
  end if;

  select
    count(*) filter (where coalesce((value->>'reviewed')::boolean, false)),
    coalesce(
      sum(
        case
          when btrim(normalized_text) = '' then 0
          else cardinality(regexp_split_to_array(btrim(normalized_text), ' +'))
        end
      ),
      0
    )::bigint
  into v_reviewed_segments, v_word_count
  from (
    select
      value,
      translate(
        value->>'text',
        chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
        chr(133) || chr(160) || chr(5760) ||
        chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) ||
        chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) ||
        chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288),
        repeat(' ', 25)
      ) as normalized_text
    from jsonb_array_elements(v_segments)
  ) normalized;

  v_content_sha256 := encode(
    extensions.digest(convert_to(v_segments::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_review_summary := v_parent.review_summary;
  if jsonb_typeof(v_review_summary) = 'object' then
    v_review_summary := jsonb_set(
      jsonb_set(
        v_review_summary,
        '{reviewed_segments}',
        to_jsonb(v_reviewed_segments),
        true
      ),
      '{word_count}',
      to_jsonb(v_word_count),
      true
    );
  end if;

  select coalesce(max(tr.revision_number), 0) + 1
  into v_new_revision_number
  from public.transcript_revisions tr
  where tr.session_id = p_session_id;

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
    actor_profile_id,
    revision_origin,
    parent_revision_id
  ) values (
    v_new_revision_id,
    v_campaign_id,
    p_session_id,
    v_new_revision_number,
    p_operation_id,
    v_parent.source_system,
    v_parent.source_session_id,
    v_parent.source_id,
    v_parent.run_id,
    v_parent.base_transcript_sha256,
    v_content_sha256,
    v_content_sha256,
    v_parent.segment_count,
    v_word_count,
    v_reviewed_segments,
    v_parent.warning_count,
    v_parent.lineage,
    v_review_summary,
    v_segments,
    p_actor_profile_id,
    'web_edit',
    v_parent.id
  );

  update public.sessions s
  set current_transcript_revision_id = v_new_revision_id
  where s.id = p_session_id
    and s.campaign_id = v_campaign_id
    and s.current_transcript_revision_id = p_expected_current_revision_id;

  if not found then
    raise exception 'transcript current pointer changed while session was locked';
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
      'currentRevisionId', v_parent.id,
      'revisionNumber', v_parent.revision_number
    ),
    jsonb_build_object(
      'currentRevisionId', v_new_revision_id,
      'revisionNumber', v_new_revision_number,
      'parentRevisionId', v_parent.id,
      'editedSegmentCount', v_edit_count,
      'segmentCount', v_parent.segment_count,
      'wordCount', v_word_count,
      'contentSha256', v_content_sha256
    )
  );

  return query
    select 'updated'::text, v_new_revision_id, v_new_revision_number;
end;
$$;

comment on function public.save_transcript_revision_edit_atomic(
  uuid, text, uuid, uuid, uuid, jsonb
)
is 'Server-only SECURITY INVOKER CAS boundary for private transcript edits. The caller supplies only speaker/text deltas; timing and segment identity are materialized from the immutable parent. Save inserts a new revision, advances current atomically and writes metadata-only audit evidence.';

revoke all on function public.save_transcript_revision_edit_atomic(
  uuid, text, uuid, uuid, uuid, jsonb
) from public;
revoke execute on function public.save_transcript_revision_edit_atomic(
  uuid, text, uuid, uuid, uuid, jsonb
) from anon;
revoke execute on function public.save_transcript_revision_edit_atomic(
  uuid, text, uuid, uuid, uuid, jsonb
) from authenticated;
grant execute on function public.save_transcript_revision_edit_atomic(
  uuid, text, uuid, uuid, uuid, jsonb
) to service_role;
