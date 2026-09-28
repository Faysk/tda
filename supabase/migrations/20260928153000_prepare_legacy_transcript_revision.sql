-- #984: explicit, private upgrade from legacy transcript_segments into the
-- immutable transcript revision model used by the canonical Edit workspace.
-- No public session fields are changed and no transcript publication receipt is
-- created. The browser supplies only the identity of the legacy snapshot it saw.

alter table public.transcript_revisions
  drop constraint if exists transcript_revisions_source_system_check;

alter table public.transcript_revisions
  add constraint transcript_revisions_source_system_check
  check (source_system in ('local_companion', 'web_edit', 'legacy_import'));

alter table public.transcript_revisions
  drop constraint if exists transcript_revisions_source_id_check;

alter table public.transcript_revisions
  add constraint transcript_revisions_source_id_check
  check (
    source_id is null
    or source_id ~ '^(craig|legacy)-[0-9a-f]{64}$'
  );

create function public.prepare_legacy_transcript_revision_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_operation_id uuid,
  p_expected_snapshot_sha256 text
)
returns table(
  status text,
  revision_id uuid,
  revision_number bigint,
  snapshot_sha256 text,
  segment_count integer
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_session public.sessions%rowtype;
  v_existing public.transcript_revisions%rowtype;
  v_revision_id uuid;
  v_revision_number bigint;
  v_segments jsonb;
  v_segment_count integer;
  v_unique_count integer;
  v_word_count integer;
  v_snapshot_material text;
  v_snapshot_sha256 text;
  v_content_sha256 text;
  v_valid boolean;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_campaign_slug is null
     or btrim(p_campaign_slug) = ''
     or p_session_id is null
     or p_operation_id is null
     or p_expected_snapshot_sha256 is null
     or p_expected_snapshot_sha256 !~ '^[0-9a-f]{64}$'
     or not exists (
       select 1
       from public.profiles p
       where p.id = p_actor_profile_id
         and p.auth_user_id = p_auth_user_id
     ) then
    return query
      select 'forbidden'::text, null::uuid, null::bigint, null::text, null::integer;
    return;
  end if;

  -- Authorization is resolved before target existence to avoid a session oracle.
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
    return query
      select 'forbidden'::text, null::uuid, null::bigint, null::text, null::integer;
    return;
  end if;

  select s.*
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = v_campaign_id
  for update;

  if not found then
    return query
      select 'not_found'::text, null::uuid, null::bigint, null::text, null::integer;
    return;
  end if;

  -- A lost-response retry is recognized before current-pointer reconciliation.
  select r.*
  into v_existing
  from public.transcript_revisions r
  where r.session_id = v_session.id
    and r.operation_id = p_operation_id;

  if found then
    if v_existing.source_system = 'legacy_import'
       and v_existing.base_transcript_sha256 = p_expected_snapshot_sha256 then
      return query
        select
          'replay'::text,
          v_existing.id,
          v_existing.revision_number,
          v_existing.base_transcript_sha256,
          v_existing.segment_count;
      return;
    end if;
    return query
      select 'operation_conflict'::text, null::uuid, null::bigint, null::text, null::integer;
    return;
  end if;

  -- Any current immutable revision means the session already crossed the modern
  -- handoff. Never create a second legacy-derived base underneath it.
  if v_session.current_transcript_revision_id is not null then
    select r.*
    into v_existing
    from public.transcript_revisions r
    where r.id = v_session.current_transcript_revision_id
      and r.session_id = v_session.id
      and r.campaign_id = v_campaign_id;

    if not found then
      raise exception 'current transcript revision pointer is inconsistent';
    end if;

    return query
      select
        'already_prepared'::text,
        v_existing.id,
        v_existing.revision_number,
        v_existing.base_transcript_sha256,
        v_existing.segment_count;
    return;
  end if;

  if v_session.source_session_id is null
     or char_length(v_session.source_session_id) not between 1 and 160 then
    return query
      select 'invalid_legacy'::text, null::uuid, null::bigint, null::text, null::integer;
    return;
  end if;

  with normalized as (
    select
      coalesce(nullif(btrim(ts.source_segment_id), ''), ts.id::text) as segment_id,
      case
        when btrim(coalesce(ts.track_key, '')) ~ '^[0-9]{1,9}$'
          and btrim(ts.track_key)::bigint between 1 and 9999
        then btrim(ts.track_key)::integer
        else 1
      end as track_number,
      ts.start_ms,
      ts.end_ms,
      coalesce(
        nullif(btrim(ts.character_name), ''),
        nullif(btrim(ts.speaker_name), ''),
        nullif(btrim(ts.track_key), ''),
        'Mesa'
      ) as speaker,
      ts.text
    from public.transcript_segments ts
    where ts.session_id = v_session.id
  ),
  measured as (
    select
      n.*,
      (
        char_length(n.segment_id) between 1 and 256
        and n.start_ms >= 0
        and n.end_ms >= n.start_ms
        and n.end_ms <= 604800000
        and char_length(n.speaker) between 1 and 160
        and char_length(n.text) between 1 and 100000
        and translate(
          n.speaker,
          U&'\0001\0002\0003\0004\0005\0006\0007\0008\0009\000A\000B\000C\000D\000E\000F\0010\0011\0012\0013\0014\0015\0016\0017\0018\0019\001A\001B\001C\001D\001E\001F\007F',
          ''
        ) = n.speaker
        and translate(
          n.text,
          U&'\0001\0002\0003\0004\0005\0006\0007\0008\000B\000C\000E\000F\0010\0011\0012\0013\0014\0015\0016\0017\0018\0019\001A\001B\001C\001D\001E\001F\007F',
          ''
        ) = n.text
        and translate(
          n.speaker,
          U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000',
          ''
        ) <> ''
        and translate(
          n.text,
          U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000',
          ''
        ) <> ''
      ) as row_valid,
      (
        n.track_number::text || ':' ||
        octet_length(n.segment_id)::text || ':' || n.segment_id || ':' ||
        n.start_ms::text || ':' ||
        n.end_ms::text || ':' ||
        octet_length(n.speaker)::text || ':' || n.speaker || ':' ||
        octet_length(n.text)::text || ':' || n.text || E'\n'
      ) as fingerprint_line
    from normalized n
  )
  select
    count(*)::integer,
    count(distinct (m.track_number, m.segment_id))::integer,
    coalesce(bool_and(m.row_valid), false),
    jsonb_agg(
      jsonb_build_object(
        'track_number', m.track_number,
        'segment_id', m.segment_id,
        'start', m.start_ms::numeric / 1000,
        'end', m.end_ms::numeric / 1000,
        'text', m.text,
        'speaker', m.speaker,
        'reviewed', false
      )
      order by m.start_ms, m.end_ms, m.track_number, m.segment_id
    ),
    string_agg(
      m.fingerprint_line,
      ''
      order by m.start_ms, m.end_ms, m.track_number, m.segment_id
    )
  into
    v_segment_count,
    v_unique_count,
    v_valid,
    v_segments,
    v_snapshot_material
  from measured m;

  if v_segment_count = 0 then
    return query
      select 'empty_legacy'::text, null::uuid, null::bigint, null::text, 0::integer;
    return;
  end if;

  if v_segment_count > 100000
     or v_unique_count <> v_segment_count
     or not v_valid
     or v_segments is null
     or v_snapshot_material is null then
    return query
      select 'invalid_legacy'::text, null::uuid, null::bigint, null::text, v_segment_count;
    return;
  end if;

  v_snapshot_sha256 := encode(
    extensions.digest(convert_to(v_snapshot_material, 'UTF8'), 'sha256'),
    'hex'
  );

  if v_snapshot_sha256 <> p_expected_snapshot_sha256 then
    return query
      select
        'stale_legacy'::text,
        null::uuid,
        null::bigint,
        v_snapshot_sha256,
        v_segment_count;
    return;
  end if;

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
    content_sha256,
    publication_kind
  ) values (
    v_revision_id,
    v_campaign_id,
    v_session.id,
    v_revision_number,
    p_operation_id,
    'legacy_import',
    v_session.source_session_id,
    'legacy-' || v_snapshot_sha256,
    'legacy-' || substring(v_snapshot_sha256 from 1 for 32),
    v_snapshot_sha256,
    v_content_sha256,
    v_content_sha256,
    v_segment_count,
    v_word_count,
    0,
    0,
    jsonb_build_object(
      'profile_id', 'legacy-import',
      'engine', 'legacy',
      'model', 'transcript_segments',
      'model_revision', null,
      'device', null,
      'compute_type', null,
      'alignment', null,
      'completed_at', null
    ),
    jsonb_build_object(
      'status', 'legacy_prepared',
      'draft_revision', 0,
      'reviewed_segments', 0,
      'total_segments', v_segment_count,
      'warning_count', 0,
      'word_count', v_word_count
    ),
    v_segments,
    p_actor_profile_id,
    null,
    null,
    v_content_sha256,
    'single_source'
  );

  update public.sessions s
  set current_transcript_revision_id = v_revision_id
  where s.id = v_session.id
    and s.campaign_id = v_campaign_id
    and s.current_transcript_revision_id is null;

  if not found then
    raise exception 'legacy transcript current pointer changed while session was locked';
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
    'transcript_revision.legacy_prepare',
    'transcript_revisions',
    v_revision_id,
    jsonb_build_object(
      'currentRevisionId', null,
      'source', 'transcript_segments'
    ),
    jsonb_build_object(
      'currentRevisionId', v_revision_id,
      'revisionNumber', v_revision_number,
      'operationId', p_operation_id,
      'sourceSystem', 'legacy_import',
      'legacySnapshotSha256', v_snapshot_sha256,
      'contentSha256', v_content_sha256,
      'segmentCount', v_segment_count,
      'wordCount', v_word_count
    )
  );

  return query
    select
      'prepared'::text,
      v_revision_id,
      v_revision_number,
      v_snapshot_sha256,
      v_segment_count;
end;
$$;

comment on function public.prepare_legacy_transcript_revision_atomic(
  uuid, uuid, text, uuid, uuid, text
) is
'Server-only SECURITY INVOKER boundary for #984. Materializes the exact legacy transcript_segments snapshot into one immutable private revision after content-edit authorization and snapshot CAS. It never mutates public session editorial fields or publishes transcript content.';

revoke all on function public.prepare_legacy_transcript_revision_atomic(
  uuid, uuid, text, uuid, uuid, text
) from public;
revoke execute on function public.prepare_legacy_transcript_revision_atomic(
  uuid, uuid, text, uuid, uuid, text
) from anon;
revoke execute on function public.prepare_legacy_transcript_revision_atomic(
  uuid, uuid, text, uuid, uuid, text
) from authenticated;
grant execute on function public.prepare_legacy_transcript_revision_atomic(
  uuid, uuid, text, uuid, uuid, text
) to service_role;
