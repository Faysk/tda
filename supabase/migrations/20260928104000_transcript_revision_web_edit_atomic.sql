-- Immutable Web transcript revision editing for #898.
-- Existing transcript revisions remain immutable. The current pointer advances with
-- expected-current CAS; browser roles never receive direct RPC access.
create or replace function public.save_transcript_revision_edit_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_expected_current_revision_id uuid,
  p_operation_id uuid,
  p_segments jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_session public.sessions%rowtype;
  v_parent public.transcript_revisions%rowtype;
  v_existing public.transcript_revisions%rowtype;
  v_revision_id uuid;
  v_revision_number bigint;
  v_segment_count integer;
  v_word_count integer;
  v_reviewed_segments integer;
  v_changed_segments integer;
  v_segments_sha256 text;
  v_payload_sha256 text;
  v_lineage jsonb;
  v_review_summary jsonb;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_campaign_slug is null
     or btrim(p_campaign_slug) = ''
     or p_session_id is null
     or p_expected_current_revision_id is null
     or p_operation_id is null
     or p_segments is null
     or jsonb_typeof(p_segments) is distinct from 'array'
     or not exists (
       select 1
       from public.profiles p
       where p.id = p_actor_profile_id
         and p.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- Authorization is resolved before target/session existence to avoid cross-campaign disclosure.
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
    return jsonb_build_object('status', 'forbidden');
  end if;

  select s.*
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = v_campaign_id
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Lost-response replay is resolved before CAS. A reused operation with a
  -- different parent or payload is rejected rather than silently re-applied.
  select r.*
  into v_existing
  from public.transcript_revisions r
  where r.session_id = v_session.id
    and r.operation_id = p_operation_id;

  if found then
    if v_existing.lineage->>'derivation' is distinct from 'web_edit'
       or v_existing.lineage->>'parent_revision_id' is distinct from p_expected_current_revision_id::text
       or v_existing.segments is distinct from p_segments then
      return jsonb_build_object('status', 'operation_conflict');
    end if;

    return jsonb_build_object(
      'status',
      case
        when v_session.current_transcript_revision_id = v_existing.id then 'replay'
        else 'replay_stale'
      end,
      'revision_id', v_existing.id,
      'revision_number', v_existing.revision_number,
      'current_revision_id', v_session.current_transcript_revision_id,
      'changed_segments',
        coalesce((v_existing.lineage->>'changed_segments')::integer, 0)
    );
  end if;

  if v_session.current_transcript_revision_id is distinct from p_expected_current_revision_id then
    return jsonb_build_object(
      'status', 'stale_current',
      'current_revision_id', v_session.current_transcript_revision_id
    );
  end if;

  select r.*
  into v_parent
  from public.transcript_revisions r
  where r.id = p_expected_current_revision_id
    and r.session_id = v_session.id
    and r.campaign_id = v_campaign_id;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  v_segment_count := jsonb_array_length(p_segments);
  if v_segment_count < 1
     or v_segment_count > 100000
     or jsonb_typeof(v_parent.segments) is distinct from 'array'
     or jsonb_array_length(v_parent.segments) <> v_segment_count
     or octet_length(p_segments::text) > 33554432 then
    return jsonb_build_object('status', 'invalid_payload');
  end if;

  -- Only speaker/text may change. Order, identity, timing, reviewed state and
  -- every other structural field must remain byte-for-byte equivalent as JSONB.
  if exists (
    select 1
    from jsonb_array_elements(v_parent.segments) with ordinality parent(value, ordinal)
    join jsonb_array_elements(p_segments) with ordinality candidate(value, ordinal)
      using (ordinal)
    where jsonb_typeof(candidate.value) is distinct from 'object'
       or jsonb_typeof(parent.value) is distinct from 'object'
       or (candidate.value - 'text' - 'speaker')
          is distinct from (parent.value - 'text' - 'speaker')
       or jsonb_typeof(candidate.value->'text') is distinct from 'string'
       or jsonb_typeof(candidate.value->'speaker') is distinct from 'string'
       or char_length(btrim(candidate.value->>'text')) not between 1 and 100000
       or char_length(btrim(candidate.value->>'speaker')) not between 1 and 160
  ) then
    return jsonb_build_object('status', 'invalid_payload');
  end if;

  select count(*)
  into v_changed_segments
  from jsonb_array_elements(v_parent.segments) with ordinality parent(value, ordinal)
  join jsonb_array_elements(p_segments) with ordinality candidate(value, ordinal)
    using (ordinal)
  where candidate.value->>'text' is distinct from parent.value->>'text'
     or candidate.value->>'speaker' is distinct from parent.value->>'speaker';

  if v_changed_segments = 0 then
    return jsonb_build_object(
      'status', 'no_changes',
      'revision_id', v_parent.id,
      'revision_number', v_parent.revision_number,
      'current_revision_id', v_parent.id,
      'changed_segments', 0
    );
  end if;

  select
    count(*) filter (where coalesce((value->>'reviewed')::boolean, false)),
    coalesce(
      sum(
        cardinality(
          regexp_split_to_array(btrim(value->>'text'), E'\\s+')
        )
      ),
      0
    )
  into v_reviewed_segments, v_word_count
  from jsonb_array_elements(p_segments);

  select coalesce(max(r.revision_number), 0) + 1
  into v_revision_number
  from public.transcript_revisions r
  where r.session_id = v_session.id;

  v_revision_id := gen_random_uuid();
  v_segments_sha256 := encode(
    extensions.digest(convert_to(p_segments::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_payload_sha256 := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'schema_version', 'tda_transcript_web_edit_v1',
          'parent_revision_id', v_parent.id,
          'segments', p_segments
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  v_lineage := coalesce(v_parent.lineage, '{}'::jsonb) || jsonb_build_object(
    'derivation', 'web_edit',
    'parent_revision_id', v_parent.id,
    'changed_segments', v_changed_segments,
    'edited_at', clock_timestamp()
  );
  v_review_summary := jsonb_set(
    coalesce(v_parent.review_summary, '{}'::jsonb),
    '{word_count}',
    to_jsonb(v_word_count),
    true
  );

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
    v_parent.campaign_id,
    v_parent.session_id,
    v_revision_number,
    p_operation_id,
    v_parent.source_system,
    v_parent.source_session_id,
    v_parent.source_id,
    v_parent.run_id,
    v_parent.base_transcript_sha256,
    v_segments_sha256,
    v_payload_sha256,
    v_segment_count,
    v_word_count,
    v_reviewed_segments,
    v_parent.warning_count,
    v_lineage,
    v_review_summary,
    p_segments,
    p_actor_profile_id
  );

  update public.sessions s
  set current_transcript_revision_id = v_revision_id
  where s.id = v_session.id
    and s.current_transcript_revision_id = p_expected_current_revision_id;

  if not found then
    raise exception 'transcript current pointer changed while session row was locked';
  end if;

  -- Deliberately metadata-only: transcript text/speaker never enter audit_log.
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
      'current_revision_id', v_parent.id,
      'revision_number', v_parent.revision_number
    ),
    jsonb_build_object(
      'current_revision_id', v_revision_id,
      'revision_number', v_revision_number,
      'parent_revision_id', v_parent.id,
      'changed_segments', v_changed_segments,
      'segment_count', v_segment_count,
      'word_count', v_word_count,
      'segments_sha256', v_segments_sha256
    )
  );

  return jsonb_build_object(
    'status', 'updated',
    'revision_id', v_revision_id,
    'revision_number', v_revision_number,
    'current_revision_id', v_revision_id,
    'changed_segments', v_changed_segments
  );
end;
$$;

revoke all on function public.save_transcript_revision_edit_atomic(
  uuid, uuid, text, uuid, uuid, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.save_transcript_revision_edit_atomic(
  uuid, uuid, text, uuid, uuid, uuid, jsonb
) to service_role;

comment on function public.save_transcript_revision_edit_atomic(
  uuid, uuid, text, uuid, uuid, uuid, jsonb
) is
'Server-only immutable transcript edit boundary. Requires campaign.content.edit, preserves structural/timing fields, advances current_transcript_revision_id with expected-current CAS, supports idempotent operation replay and emits metadata-only audit evidence.';
