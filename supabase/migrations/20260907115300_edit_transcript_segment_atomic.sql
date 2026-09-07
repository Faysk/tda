create or replace function public.edit_transcript_segment_atomic(
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_segment_id uuid,
  p_expected_revision bigint,
  p_text text,
  p_speaker_name text,
  p_review_status text,
  p_needs_review boolean,
  p_text_chars integer,
  p_text_words integer
)
returns table(status text, revision bigint)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_session_id uuid;
  v_campaign_id uuid;
  v_current_revision bigint;
  v_old_text text;
  v_old_speaker_name text;
  v_old_character_name text;
  v_old_review_status text;
  v_old_needs_review boolean;
  v_old_text_chars integer;
  v_old_text_words integer;
  v_old_is_empty boolean;
  v_new_character_name text;
  v_new_revision bigint;
begin
  if p_actor_profile_id is null then
    raise exception 'actor profile is required' using errcode = '22023';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'expected revision must be non-negative' using errcode = '22023';
  end if;
  if p_text is null or btrim(p_text) = '' or char_length(p_text) > 10000 then
    raise exception 'text is invalid' using errcode = '22023';
  end if;
  if p_speaker_name is null or btrim(p_speaker_name) = '' or char_length(p_speaker_name) > 160 then
    raise exception 'speaker is invalid' using errcode = '22023';
  end if;
  if p_review_status is null or p_review_status not in ('pending', 'approved', 'needs_review', 'discarded') then
    raise exception 'review status is invalid' using errcode = '22023';
  end if;
  if p_needs_review is distinct from (p_review_status in ('pending', 'needs_review')) then
    raise exception 'needs_review is inconsistent with review status' using errcode = '22023';
  end if;
  if p_text_chars is null or p_text_chars < 0 or p_text_chars <> char_length(p_text) then
    raise exception 'text_chars is inconsistent with text' using errcode = '22023';
  end if;
  if p_text_words is null or p_text_words < 0 then
    raise exception 'text_words is invalid' using errcode = '22023';
  end if;

  select
    ts.session_id,
    s.campaign_id,
    ts.revision,
    ts.text,
    ts.speaker_name,
    ts.character_name,
    ts.review_status,
    ts.needs_review,
    ts.text_chars,
    ts.text_words,
    ts.is_empty
  into
    v_session_id,
    v_campaign_id,
    v_current_revision,
    v_old_text,
    v_old_speaker_name,
    v_old_character_name,
    v_old_review_status,
    v_old_needs_review,
    v_old_text_chars,
    v_old_text_words,
    v_old_is_empty
  from public.transcript_segments ts
  join public.sessions s on s.id = ts.session_id
  join public.campaigns c on c.id = s.campaign_id
  where ts.id = p_segment_id
    and c.slug = p_campaign_slug
  for update of ts;

  if not found then
    return query select 'not_found'::text, null::bigint;
    return;
  end if;

  if v_current_revision <> p_expected_revision then
    return query select 'conflict'::text, null::bigint;
    return;
  end if;

  v_new_character_name := case
    when coalesce(btrim(v_old_speaker_name), '') <> coalesce(btrim(p_speaker_name), '') then null
    else v_old_character_name
  end;

  update public.transcript_segments as ts
  set
    text = p_text,
    speaker_name = p_speaker_name,
    character_name = v_new_character_name,
    review_status = p_review_status,
    needs_review = p_needs_review,
    text_chars = p_text_chars,
    text_words = p_text_words,
    is_empty = false,
    revision = ts.revision + 1
  where ts.id = p_segment_id
    and ts.session_id = v_session_id
    and ts.revision = p_expected_revision
  returning ts.revision into v_new_revision;

  if not found then
    return query select 'conflict'::text, null::bigint;
    return;
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
    v_session_id,
    p_actor_profile_id,
    'transcript_segment.update',
    'transcript_segments',
    p_segment_id,
    jsonb_build_object(
      'text', v_old_text,
      'speaker_name', v_old_speaker_name,
      'character_name', v_old_character_name,
      'review_status', v_old_review_status,
      'needs_review', v_old_needs_review,
      'text_chars', v_old_text_chars,
      'text_words', v_old_text_words,
      'is_empty', v_old_is_empty,
      'revision', v_current_revision
    ),
    jsonb_build_object(
      'text', p_text,
      'speaker_name', p_speaker_name,
      'character_name', v_new_character_name,
      'review_status', p_review_status,
      'needs_review', p_needs_review,
      'text_chars', p_text_chars,
      'text_words', p_text_words,
      'is_empty', false,
      'revision', v_new_revision
    )
  );

  return query select 'updated'::text, v_new_revision;
end;
$$;

comment on function public.edit_transcript_segment_atomic(uuid, text, uuid, bigint, text, text, text, boolean, integer, integer)
is 'Server-only SECURITY INVOKER boundary for optimistic transcript edit + atomic audit. Actor/capability is resolved by the authorized application context; campaign/session/segment ownership is rechecked here.';

revoke all on function public.edit_transcript_segment_atomic(uuid, text, uuid, bigint, text, text, text, boolean, integer, integer) from public;
revoke execute on function public.edit_transcript_segment_atomic(uuid, text, uuid, bigint, text, text, text, boolean, integer, integer) from anon;
revoke execute on function public.edit_transcript_segment_atomic(uuid, text, uuid, bigint, text, text, text, boolean, integer, integer) from authenticated;
grant execute on function public.edit_transcript_segment_atomic(uuid, text, uuid, bigint, text, text, text, boolean, integer, integer) to service_role;
