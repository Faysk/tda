-- Private Web transcript revision edits for #898.
-- Human edits derive a new immutable revision from the current revision.
-- The raw/local source revision and public session projection are never mutated here.

alter table public.transcript_revisions
  add column derived_from_revision_id uuid null;

alter table public.transcript_revisions
  add constraint transcript_revisions_derived_from_revision_fk
  foreign key (derived_from_revision_id)
  references public.transcript_revisions(id)
  on delete restrict;

create index transcript_revisions_derived_from_revision_id_idx
  on public.transcript_revisions(derived_from_revision_id)
  where derived_from_revision_id is not null;

create function public.save_transcript_revision_edit_atomic(
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_expected_current_revision_id uuid,
  p_operation_id uuid,
  p_changes jsonb
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
  v_new_revision_id uuid;
  v_new_revision_number bigint;
  v_segments jsonb;
  v_payload_sha256 text;
  v_segment_count integer;
  v_word_count integer;
  v_reviewed_segments integer;
  v_review_summary jsonb;
  v_change_count integer;
  v_matched_count integer;
begin
  if p_actor_profile_id is null
     or p_campaign_slug is null
     or btrim(p_campaign_slug) = ''
     or p_session_id is null
     or p_expected_current_revision_id is null
     or p_operation_id is null
     or p_changes is null
     or jsonb_typeof(p_changes) is distinct from 'array' then
    return query select 'invalid_payload'::text, null::uuid, null::bigint, null::uuid;
    return;
  end if;

  v_change_count := jsonb_array_length(p_changes);
  if v_change_count < 1 or v_change_count > 100000 then
    return query select 'invalid_payload'::text, null::uuid, null::bigint, null::uuid;
    return;
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
  ) then
    return query select 'forbidden'::text, null::uuid, null::bigint, null::uuid;
    return;
  end if;

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
    return query select 'forbidden'::text, null::uuid, null::bigint, null::uuid;
    return;
  end if;

  select s.current_transcript_revision_id
  into v_current_revision_id
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = v_campaign_id
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint, null::uuid;
    return;
  end if;

  select *
  into v_base
  from public.transcript_revisions r
  where r.id = p_expected_current_revision_id
    and r.session_id = p_session_id
    and r.campaign_id = v_campaign_id;

  if not found then
    return query select 'invalid_base'::text, null::uuid, null::bigint, v_current_revision_id;
    return;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_changes) c(value)
    where jsonb_typeof(c.value) is distinct from 'object'
       or exists (
         select 1
         from jsonb_object_keys(c.value) k(key_name)
         where k.key_name not in ('segmentKey', 'speaker', 'text')
       )
       or jsonb_typeof(c.value->'segmentKey') is distinct from 'string'
       or jsonb_typeof(c.value->'speaker') is distinct from 'string'
       or jsonb_typeof(c.value->'text') is distinct from 'string'
       or char_length(c.value->>'segmentKey') not between 1 and 300
       or char_length(btrim(c.value->>'speaker')) not between 1 and 160
       or char_length(btrim(c.value->>'text')) not between 1 and 100000
  ) then
    return query select 'invalid_payload'::text, null::uuid, null::bigint, v_current_revision_id;
    return;
  end if;

  if (
    select count(distinct c.value->>'segmentKey')
    from jsonb_array_elements(p_changes) c(value)
  ) <> v_change_count then
    return query select 'invalid_payload'::text, null::uuid, null::bigint, v_current_revision_id;
    return;
  end if;

  select count(*)
  into v_matched_count
  from jsonb_array_elements(v_base.segments) b(value)
  join jsonb_array_elements(p_changes) c(value)
    on c.value->>'segmentKey' =
       'r-' || (b.value->>'track_number') || '-' || (b.value->>'segment_id');

  if v_matched_count <> v_change_count then
    return query select 'invalid_change'::text, null::uuid, null::bigint, v_current_revision_id;
    return;
  end if;

  select jsonb_agg(
    case
      when c.value is null then b.value
      else jsonb_set(
        jsonb_set(
          b.value,
          '{speaker}',
          to_jsonb(btrim(c.value->>'speaker')),
          true
        ),
        '{text}',
        to_jsonb(btrim(c.value->>'text')),
        true
      )
    end
    order by b.ordinality
  )
  into v_segments
  from jsonb_array_elements(v_base.segments) with ordinality b(value, ordinality)
  left join jsonb_array_elements(p_changes) c(value)
    on c.value->>'segmentKey' =
       'r-' || (b.value->>'track_number') || '-' || (b.value->>'segment_id');

  if v_segments is null
     or jsonb_typeof(v_segments) is distinct from 'array'
     or jsonb_array_length(v_segments) <> v_base.segment_count then
    raise exception 'derived transcript materialization failed';
  end if;

  if v_segments = v_base.segments then
    return query
      select 'no_change'::text, v_base.id, v_base.revision_number, v_current_revision_id;
    return;
  end if;

  select
    count(*)::integer,
    count(*) filter (where (s.value->>'reviewed')::boolean)::integer,
    coalesce(
      sum(cardinality(regexp_split_to_array(btrim(s.value->>'text'), E'\\s+'))),
      0
    )::integer
  into v_segment_count, v_reviewed_segments, v_word_count
  from jsonb_array_elements(v_segments) s(value);

  v_payload_sha256 := encode(
    extensions.digest(convert_to(v_segments::text, 'UTF8'), 'sha256'),
    'hex'
  );

  v_review_summary := jsonb_set(
    jsonb_set(
      v_base.review_summary,
      '{reviewed_segments}',
      to_jsonb(v_reviewed_segments),
      true
    ),
    '{word_count}',
    to_jsonb(v_word_count),
    true
  );

  select *
  into v_existing
  from public.transcript_revisions r
  where r.session_id = p_session_id
    and r.operation_id = p_operation_id;

  if found then
    if v_existing.derived_from_revision_id is distinct from p_expected_current_revision_id
       or v_existing.actor_profile_id <> p_actor_profile_id
       or v_existing.payload_sha256 <> v_payload_sha256 then
      return query
        select 'operation_conflict'::text, null::uuid, null::bigint, v_current_revision_id;
      return;
    end if;

    return query
      select 'replay'::text, v_existing.id, v_existing.revision_number, v_current_revision_id;
    return;
  end if;

  if v_current_revision_id is distinct from p_expected_current_revision_id then
    return query
      select 'stale_current'::text, null::uuid, null::bigint, v_current_revision_id;
    return;
  end if;

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
    actor_profile_id,
    derived_from_revision_id
  ) values (
    v_new_revision_id,
    v_base.campaign_id,
    v_base.session_id,
    v_new_revision_number,
    p_operation_id,
    v_base.source_system,
    v_base.source_session_id,
    v_base.source_id,
    v_base.run_id,
    v_base.base_transcript_sha256,
    v_payload_sha256,
    v_payload_sha256,
    v_segment_count,
    v_word_count,
    v_reviewed_segments,
    v_base.warning_count,
    v_base.lineage,
    v_review_summary,
    v_segments,
    p_actor_profile_id,
    v_base.id
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
      'currentRevisionId', v_base.id,
      'revisionNumber', v_base.revision_number
    ),
    jsonb_build_object(
      'currentRevisionId', v_new_revision_id,
      'revisionNumber', v_new_revision_number,
      'derivedFromRevisionId', v_base.id,
      'changedSegments', v_change_count,
      'payloadSha256', v_payload_sha256
    )
  );

  return query
    select 'updated'::text, v_new_revision_id, v_new_revision_number, v_new_revision_id;
end;
$$;

revoke all on function public.save_transcript_revision_edit_atomic(
  uuid, text, uuid, uuid, uuid, jsonb
) from public, anon, authenticated;

grant execute on function public.save_transcript_revision_edit_atomic(
  uuid, text, uuid, uuid, uuid, jsonb
) to service_role;

comment on function public.save_transcript_revision_edit_atomic(
  uuid, text, uuid, uuid, uuid, jsonb
) is
'Server-only SECURITY INVOKER CAS boundary for private human transcript edits. Applies speaker/text deltas to the expected immutable revision, inserts a new immutable revision, swaps sessions.current_transcript_revision_id atomically, and records metadata-only audit evidence. It never mutates public session projection or prior revisions.';
