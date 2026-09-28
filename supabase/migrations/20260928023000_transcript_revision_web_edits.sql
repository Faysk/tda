-- Safe inline transcript editing for the canonical Edit session workspace (#898).
-- Reuses immutable transcript_revisions: browser edits derive a new private revision
-- from the exact current revision and atomically advance the session pointer.
-- Timing and provenance from the parent are server-owned and cannot be supplied
-- by the browser. Audit evidence is metadata-only.

alter table public.transcript_revisions
  drop constraint if exists transcript_revisions_source_system_check;

alter table public.transcript_revisions
  add constraint transcript_revisions_source_system_check
  check (source_system in ('local_companion', 'web_edit'));

alter table public.transcript_revisions
  add column parent_revision_id uuid null
    references public.transcript_revisions(id) on delete restrict,
  add column edit_delta_sha256 text null
    check (edit_delta_sha256 is null or edit_delta_sha256 ~ '^[0-9a-f]{64}$'),
  add column content_sha256 text null
    check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');

create index transcript_revisions_parent_revision_id_idx
  on public.transcript_revisions(parent_revision_id)
  where parent_revision_id is not null;

create function public.save_transcript_revision_edit_atomic(
  p_auth_user_id uuid,
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
  revision_number bigint
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_session public.sessions%rowtype;
  v_parent public.transcript_revisions%rowtype;
  v_existing public.transcript_revisions%rowtype;
  v_current_revision_number bigint;
  v_edit_count integer;
  v_matched_count integer;
  v_edit_delta_sha256 text;
  v_content_sha256 text;
  v_segments jsonb;
  v_review_summary jsonb;
  v_revision_id uuid;
  v_revision_number bigint;
  v_word_count integer;
  v_reviewed_segments integer;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_campaign_slug is null
     or btrim(p_campaign_slug) = ''
     or p_session_id is null
     or p_expected_current_revision_id is null
     or p_operation_id is null
     or p_edits is null
     or jsonb_typeof(p_edits) is distinct from 'array' then
    return query select 'invalid_payload'::text, null::uuid, null::bigint;
    return;
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
      and p.auth_user_id = p_auth_user_id
  ) then
    return query select 'forbidden'::text, null::uuid, null::bigint;
    return;
  end if;

  -- Resolve authorization before target existence to avoid a session oracle.
  select c.id
  into v_campaign_id
  from public.campaigns c
  where c.slug = p_campaign_slug
    and exists (
      select 1
      from public.role_assignments a
      join public.role_permissions rp on rp.role_id = a.role_id
      where a.profile_id = p_actor_profile_id
        and a.status = 'active'
        and a.starts_at <= clock_timestamp()
        and (a.ends_at is null or a.ends_at > clock_timestamp())
        and rp.permission_action = 'campaign.content.edit'
        and (
          (a.scope_type = 'campaign' and a.scope_id = c.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda')
        )
    );

  if not found then
    return query select 'forbidden'::text, null::uuid, null::bigint;
    return;
  end if;

  v_edit_count := jsonb_array_length(p_edits);
  if v_edit_count < 1 or v_edit_count > 100000 then
    return query select 'invalid_payload'::text, null::uuid, null::bigint;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_edits) e(value)
    where jsonb_typeof(e.value) is distinct from 'object'
       or exists (
         select 1
         from jsonb_object_keys(e.value) k(key_name)
         where k.key_name not in ('trackNumber', 'segmentId', 'speaker', 'text')
       )
       or jsonb_typeof(e.value->'trackNumber') is distinct from 'number'
       or jsonb_typeof(e.value->'segmentId') is distinct from 'string'
       or jsonb_typeof(e.value->'speaker') is distinct from 'string'
       or jsonb_typeof(e.value->'text') is distinct from 'string'
       or coalesce(e.value->>'trackNumber', '') !~ '^[0-9]{1,4}$'
       or (e.value->>'trackNumber')::integer < 1
       or char_length(e.value->>'segmentId') not between 1 and 256
       or char_length(e.value->>'speaker') not between 1 and 160
       or char_length(e.value->>'text') not between 1 and 100000
       -- Mirror isReviewStringV1 at the privileged database boundary.
       -- Speaker rejects every C0 control; text permits TAB/LF/CR only.
       or translate(e.value->>'speaker', U&'\\0001\\0002\\0003\\0004\\0005\\0006\\0007\\0008\\0009\\000A\\000B\\000C\\000D\\000E\\000F\\0010\\0011\\0012\\0013\\0014\\0015\\0016\\0017\\0018\\0019\\001A\\001B\\001C\\001D\\001E\\001F\\007F', '') <> e.value->>'speaker'
       or translate(e.value->>'text', U&'\\0001\\0002\\0003\\0004\\0005\\0006\\0007\\0008\\000B\\000C\\000E\\000F\\0010\\0011\\0012\\0013\\0014\\0015\\0016\\0017\\0018\\0019\\001A\\001B\\001C\\001D\\001E\\001F\\007F', '') <> e.value->>'text'
       -- count_words_v1 requires at least one non-White_Space token.
       or translate(e.value->>'speaker', U&'\\0009\\000A\\000B\\000C\\000D\\0020\\0085\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000', '') = ''
       or translate(e.value->>'text', U&'\\0009\\000A\\000B\\000C\\000D\\0020\\0085\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000', '') = ''
  ) then
    return query select 'invalid_payload'::text, null::uuid, null::bigint;
    return;
  end if;

  if (
    select count(*)
    from (
      select
        (value->>'trackNumber')::integer,
        value->>'segmentId'
      from jsonb_array_elements(p_edits)
      group by 1, 2
    ) unique_edits
  ) <> v_edit_count then
    return query select 'invalid_payload'::text, null::uuid, null::bigint;
    return;
  end if;

  v_edit_delta_sha256 := encode(
    extensions.digest(convert_to(p_edits::text, 'UTF8'), 'sha256'),
    'hex'
  );

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

  -- A lost-response retry is recognized before the current-pointer CAS.
  select r.*
  into v_existing
  from public.transcript_revisions r
  where r.session_id = v_session.id
    and r.operation_id = p_operation_id;

  if found then
    if v_existing.source_system = 'web_edit'
       and v_existing.parent_revision_id = p_expected_current_revision_id
       and v_existing.edit_delta_sha256 = v_edit_delta_sha256 then
      return query
        select 'replay'::text, v_existing.id, v_existing.revision_number;
      return;
    end if;
    return query select 'operation_conflict'::text, null::uuid, null::bigint;
    return;
  end if;

  if v_session.current_transcript_revision_id is distinct from
       p_expected_current_revision_id then
    select r.revision_number
    into v_current_revision_number
    from public.transcript_revisions r
    where r.id = v_session.current_transcript_revision_id
      and r.session_id = v_session.id;

    return query
      select 'stale_current'::text,
             v_session.current_transcript_revision_id,
             v_current_revision_number;
    return;
  end if;

  select r.*
  into v_parent
  from public.transcript_revisions r
  where r.id = p_expected_current_revision_id
    and r.session_id = v_session.id
    and r.campaign_id = v_campaign_id;

  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;

  if jsonb_typeof(v_parent.segments) is distinct from 'array'
     or jsonb_array_length(v_parent.segments) <> v_parent.segment_count then
    raise exception 'current transcript revision segments are inconsistent';
  end if;

  select count(*)
  into v_matched_count
  from jsonb_array_elements(p_edits) e(value)
  join jsonb_array_elements(v_parent.segments) s(value)
    on (s.value->>'track_number')::integer = (e.value->>'trackNumber')::integer
   and s.value->>'segment_id' = e.value->>'segmentId';

  if v_matched_count <> v_edit_count then
    return query select 'invalid_edit_target'::text, null::uuid, null::bigint;
    return;
  end if;

  select jsonb_agg(
    case
      when e.value is null then s.value
      else jsonb_set(
        jsonb_set(s.value, '{speaker}', to_jsonb(e.value->>'speaker'), false),
        '{text}',
        to_jsonb(e.value->>'text'),
        false
      )
    end
    order by s.ordinality
  )
  into v_segments
  from jsonb_array_elements(v_parent.segments) with ordinality s(value, ordinality)
  left join jsonb_array_elements(p_edits) e(value)
    on (s.value->>'track_number')::integer = (e.value->>'trackNumber')::integer
   and s.value->>'segment_id' = e.value->>'segmentId';

  if v_segments = v_parent.segments then
    return query
      select 'no_change'::text, v_parent.id, v_parent.revision_number;
    return;
  end if;

  select count(*) filter (
    where coalesce((value->>'reviewed')::boolean, false)
  )
  into v_reviewed_segments
  from jsonb_array_elements(v_segments);

  -- Keep the database metadata on the same count_words_v1 separator contract
  -- used by the Agent and Web. U+001C..001F and U+FEFF are deliberately not
  -- separators; no editorial text is normalized.
  select count(*)::integer
  into v_word_count
  from jsonb_array_elements(v_segments) segment(value)
  cross join lateral regexp_matches(
    translate(segment.value->>'text', U&'\\0009\\000A\\000B\\000C\\000D\\0020\\0085\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000', repeat(' ', 25)),
    '[^ ]+',
    'g'
  );

  v_review_summary := jsonb_set(
    jsonb_set(
      v_parent.review_summary,
      '{status}',
      to_jsonb('edited_web'::text),
      true
    ),
    '{word_count}',
    to_jsonb(v_word_count),
    true
  );

  v_content_sha256 := encode(
    extensions.digest(convert_to(v_segments::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select coalesce(max(r.revision_number), 0) + 1
  into v_revision_number
  from public.transcript_revisions r
  where r.session_id = v_session.id;

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
    actor_profile_id,
    parent_revision_id,
    edit_delta_sha256,
    content_sha256
  ) values (
    v_revision_id,
    v_campaign_id,
    v_session.id,
    v_revision_number,
    p_operation_id,
    'web_edit',
    v_parent.source_session_id,
    v_parent.source_id,
    v_parent.run_id,
    v_parent.base_transcript_sha256,
    v_parent.draft_sha256,
    v_parent.payload_sha256,
    v_parent.segment_count,
    v_word_count,
    v_reviewed_segments,
    v_parent.warning_count,
    v_parent.lineage,
    v_review_summary,
    v_segments,
    p_actor_profile_id,
    v_parent.id,
    v_edit_delta_sha256,
    v_content_sha256
  );

  update public.sessions s
  set current_transcript_revision_id = v_revision_id
  where s.id = v_session.id
    and s.campaign_id = v_campaign_id
    and s.current_transcript_revision_id = v_parent.id;

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
    v_session.id,
    p_actor_profile_id,
    'transcript_revision.web_edit',
    'transcript_revisions',
    v_revision_id,
    jsonb_build_object(
      'currentRevisionId', v_parent.id,
      'revisionNumber', v_parent.revision_number
    ),
    jsonb_build_object(
      'currentRevisionId', v_revision_id,
      'revisionNumber', v_revision_number,
      'operationId', p_operation_id,
      'parentRevisionId', v_parent.id,
      'changedSegments', v_edit_count,
      'editDeltaSha256', v_edit_delta_sha256,
      'contentSha256', v_content_sha256,
      'wordCount', v_word_count
    )
  );

  return query select 'updated'::text, v_revision_id, v_revision_number;
end;
$$;

comment on function public.save_transcript_revision_edit_atomic(
  uuid, uuid, text, uuid, uuid, uuid, jsonb
) is
'Server-only SECURITY INVOKER CAS boundary for private transcript corrections. Only speaker/text deltas are accepted; timing/provenance come from the immutable parent revision. Creates a new immutable revision, advances current atomically, and writes metadata-only audit evidence.';

revoke all on function public.save_transcript_revision_edit_atomic(
  uuid, uuid, text, uuid, uuid, uuid, jsonb
) from public;
revoke execute on function public.save_transcript_revision_edit_atomic(
  uuid, uuid, text, uuid, uuid, uuid, jsonb
) from anon;
revoke execute on function public.save_transcript_revision_edit_atomic(
  uuid, uuid, text, uuid, uuid, uuid, jsonb
) from authenticated;
grant execute on function public.save_transcript_revision_edit_atomic(
  uuid, uuid, text, uuid, uuid, uuid, jsonb
) to service_role;
