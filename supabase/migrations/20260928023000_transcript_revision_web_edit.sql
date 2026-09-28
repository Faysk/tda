-- #898 — safe inline editing of the canonical private transcript revision.
-- A Web edit derives a new immutable revision from the current revision, preserves
-- source provenance/timing and atomically advances sessions.current_transcript_revision_id.
-- Browser roles stay denied; authorization is rechecked inside the service-role RPC.

alter table public.transcript_revisions
  add column if not exists revision_origin text not null default 'local_publication';

alter table public.transcript_revisions
  add column if not exists parent_revision_id uuid null;

alter table public.transcript_revisions
  add column if not exists content_sha256 text null
  check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.transcript_revisions'::regclass
      and conname = 'transcript_revisions_revision_origin_check'
  ) then
    alter table public.transcript_revisions
      add constraint transcript_revisions_revision_origin_check
      check (revision_origin in ('local_publication', 'web_edit'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.transcript_revisions'::regclass
      and conname = 'transcript_revisions_parent_revision_fk'
  ) then
    alter table public.transcript_revisions
      add constraint transcript_revisions_parent_revision_fk
      foreign key (parent_revision_id)
      references public.transcript_revisions(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists transcript_revisions_parent_revision_idx
  on public.transcript_revisions(parent_revision_id)
  where parent_revision_id is not null;

comment on column public.transcript_revisions.revision_origin is
  'How this immutable revision was materialized. local_publication is the historical/default Companion publication path; web_edit is a private derived revision created in Edit.';
comment on column public.transcript_revisions.parent_revision_id is
  'Immediate immutable parent when a revision is derived in Edit. Nullable for historical/local publication roots.';
comment on column public.transcript_revisions.content_sha256 is
  'Canonical SHA-256 of the complete segments JSON for Web-derived revisions. Source draft/payload hashes keep their original local-publication provenance semantics.';

create or replace function public.edit_current_transcript_revision_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_expected_current_revision_id uuid,
  p_operation_id uuid,
  p_patches jsonb
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
  v_patch_map jsonb;
  v_segments jsonb;
  v_content_sha256 text;
  v_revision_id uuid;
  v_revision_number bigint;
  v_current_revision_number bigint;
  v_patch_count integer;
  v_matched_count integer;
  v_changed_count integer;
  v_word_count integer;
  v_review_summary jsonb;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_campaign_slug is null
     or p_campaign_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
      and p.auth_user_id = p_auth_user_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
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
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_patches) patch(value)
    where jsonb_typeof(patch.value) is distinct from 'object'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_patches) patch(value)
    where exists (
         select 1
         from jsonb_object_keys(patch.value) key(name)
         where key.name not in ('id', 'speaker', 'text')
       )
       or jsonb_typeof(patch.value->'id') is distinct from 'string'
       or jsonb_typeof(patch.value->'speaker') is distinct from 'string'
       or jsonb_typeof(patch.value->'text') is distinct from 'string'
       or char_length(patch.value->>'id') not between 1 and 320
       or char_length(btrim(patch.value->>'speaker')) not between 1 and 160
       or char_length(btrim(patch.value->>'text')) not between 1 and 100000
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if (
    select count(*)
    from (
      select patch.value->>'id'
      from jsonb_array_elements(p_patches) patch(value)
      group by 1
    ) unique_patch
  ) <> v_patch_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select jsonb_object_agg(patch.value->>'id', patch.value)
  into v_patch_map
  from jsonb_array_elements(p_patches) patch(value);

  select s.*
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = v_campaign_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select r.*
  into v_parent
  from public.transcript_revisions r
  where r.id = p_expected_current_revision_id
    and r.session_id = v_session.id
    and r.campaign_id = v_campaign_id;

  if not found then
    if v_session.current_transcript_revision_id is distinct from p_expected_current_revision_id then
      select r.revision_number
      into v_current_revision_number
      from public.transcript_revisions r
      where r.id = v_session.current_transcript_revision_id;

      return jsonb_build_object(
        'ok', false,
        'reason', 'stale_current',
        'currentRevisionId', v_session.current_transcript_revision_id,
        'currentRevisionNumber', v_current_revision_number
      );
    end if;
    raise exception 'current transcript revision pointer references a missing revision';
  end if;

  select count(*)
  into v_matched_count
  from jsonb_array_elements(v_parent.segments) segment(value)
  where v_patch_map ? (
    'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id'
  );

  if v_matched_count <> v_patch_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select count(*)
  into v_changed_count
  from jsonb_array_elements(v_parent.segments) segment(value)
  where v_patch_map ? (
      'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id'
    )
    and (
      segment.value->>'speaker' is distinct from (
        v_patch_map #>> array[
          'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
          'speaker'
        ]
      )
      or segment.value->>'text' is distinct from (
        v_patch_map #>> array[
          'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
          'text'
        ]
      )
    );

  select jsonb_agg(
    case
      when v_patch_map ? (
        'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id'
      ) then
        jsonb_set(
          jsonb_set(
            segment.value,
            '{speaker}',
            v_patch_map #> array[
              'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
              'speaker'
            ],
            false
          ),
          '{text}',
          v_patch_map #> array[
            'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
            'text'
          ],
          false
        )
      else segment.value
    end
    order by segment.ordinality
  )
  into v_segments
  from jsonb_array_elements(v_parent.segments) with ordinality segment(value, ordinality);

  if v_segments is null
     or jsonb_array_length(v_segments) <> v_parent.segment_count then
    raise exception 'web edit could not materialize the complete transcript revision';
  end if;

  v_content_sha256 := encode(
    extensions.digest(convert_to(v_segments::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select r.*
  into v_existing
  from public.transcript_revisions r
  where r.session_id = v_session.id
    and r.operation_id = p_operation_id;

  if found then
    if v_existing.revision_origin = 'web_edit'
       and v_existing.parent_revision_id = p_expected_current_revision_id
       and v_existing.content_sha256 = v_content_sha256 then
      return jsonb_build_object(
        'ok', true,
        'replayed', true,
        'unchanged', false,
        'revisionId', v_existing.id,
        'revisionNumber', v_existing.revision_number,
        'parentRevisionId', v_existing.parent_revision_id,
        'changedSegments', v_changed_count
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'operation_conflict');
  end if;

  if v_session.current_transcript_revision_id is distinct from p_expected_current_revision_id then
    select r.revision_number
    into v_current_revision_number
    from public.transcript_revisions r
    where r.id = v_session.current_transcript_revision_id;

    return jsonb_build_object(
      'ok', false,
      'reason', 'stale_current',
      'currentRevisionId', v_session.current_transcript_revision_id,
      'currentRevisionNumber', v_current_revision_number
    );
  end if;

  if v_changed_count = 0 then
    return jsonb_build_object(
      'ok', true,
      'replayed', false,
      'unchanged', true,
      'revisionId', v_parent.id,
      'revisionNumber', v_parent.revision_number,
      'parentRevisionId', v_parent.parent_revision_id,
      'changedSegments', 0
    );
  end if;

  select coalesce(
    sum(cardinality(regexp_split_to_array(btrim(segment.value->>'text'), E'\\s+'))),
    0
  )::integer
  into v_word_count
  from jsonb_array_elements(v_segments) segment(value);

  v_review_summary := coalesce(v_parent.review_summary, '{}'::jsonb)
    || jsonb_build_object(
      'status', 'edited_web',
      'word_count', v_word_count,
      'reviewed_segments', v_parent.reviewed_segments,
      'total_segments', v_parent.segment_count
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
    revision_origin,
    parent_revision_id,
    content_sha256
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
    v_parent.draft_sha256,
    v_parent.payload_sha256,
    v_parent.segment_count,
    v_word_count,
    v_parent.reviewed_segments,
    v_parent.warning_count,
    v_parent.lineage,
    v_review_summary,
    v_segments,
    p_actor_profile_id,
    'web_edit',
    v_parent.id,
    v_content_sha256
  );

  update public.sessions s
  set current_transcript_revision_id = v_revision_id
  where s.id = v_session.id
    and s.current_transcript_revision_id = p_expected_current_revision_id;

  if not found then
    raise exception 'session current transcript revision changed while locked';
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
    'transcript_revision.edit',
    'transcript_revisions',
    v_revision_id,
    jsonb_build_object(
      'revision_id', v_parent.id,
      'revision_number', v_parent.revision_number,
      'payload_sha256', v_parent.payload_sha256
    ),
    jsonb_build_object(
      'revision_id', v_revision_id,
      'revision_number', v_revision_number,
      'parent_revision_id', v_parent.id,
      'operation_id', p_operation_id,
      'changed_segments', v_changed_count,
      'content_sha256', v_content_sha256
    )
  );

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'unchanged', false,
    'revisionId', v_revision_id,
    'revisionNumber', v_revision_number,
    'parentRevisionId', v_parent.id,
    'changedSegments', v_changed_count
  );
end;
$$;

comment on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) is
  'Server-only atomic boundary for #898. Rechecks campaign.content.edit, derives a complete immutable transcript revision from the expected current revision, preserves timing/source provenance, advances the current pointer with CAS, and writes metadata-only audit evidence.';

revoke all on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) from public;
revoke execute on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) from anon;
revoke execute on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) to service_role;
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.transcript_revisions'::regclass
      and conname = 'transcript_revisions_revision_origin_check'
  ) then
    alter table public.transcript_revisions
      add constraint transcript_revisions_revision_origin_check
      check (revision_origin in ('local_publication', 'web_edit'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.transcript_revisions'::regclass
      and conname = 'transcript_revisions_parent_revision_fk'
  ) then
    alter table public.transcript_revisions
      add constraint transcript_revisions_parent_revision_fk
      foreign key (parent_revision_id)
      references public.transcript_revisions(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists transcript_revisions_parent_revision_idx
  on public.transcript_revisions(parent_revision_id)
  where parent_revision_id is not null;

comment on column public.transcript_revisions.revision_origin is
  'How this immutable revision was materialized. local_publication is the historical/default Companion publication path; web_edit is a private derived revision created in Edit.';
comment on column public.transcript_revisions.parent_revision_id is
  'Immediate immutable parent when a revision is derived in Edit. Nullable for historical/local publication roots.';

create or replace function public.edit_current_transcript_revision_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_expected_current_revision_id uuid,
  p_operation_id uuid,
  p_patches jsonb
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
  v_patch_map jsonb;
  v_segments jsonb;
  v_content_sha256 text;
  v_revision_id uuid;
  v_revision_number bigint;
  v_current_revision_number bigint;
  v_patch_count integer;
  v_matched_count integer;
  v_changed_count integer;
  v_word_count integer;
  v_review_summary jsonb;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_campaign_slug is null
     or p_campaign_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'
     or p_session_id is null
     or p_expected_current_revision_id is null
     or p_operation_id is null
     or p_patches is null
     or jsonb_typeof(p_patches) is distinct from 'array'
     or jsonb_array_length(p_patches) < 1
     or jsonb_array_length(p_patches) > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
      and p.auth_user_id = p_auth_user_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
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
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_patches) patch(value)
    where jsonb_typeof(patch.value) is distinct from 'object'
       or exists (
         select 1
         from jsonb_object_keys(patch.value) key(name)
         where key.name not in ('id', 'speaker', 'text')
       )
       or jsonb_typeof(patch.value->'id') is distinct from 'string'
       or jsonb_typeof(patch.value->'speaker') is distinct from 'string'
       or jsonb_typeof(patch.value->'text') is distinct from 'string'
       or char_length(patch.value->>'id') not between 1 and 320
       or char_length(btrim(patch.value->>'speaker')) not between 1 and 160
       or char_length(btrim(patch.value->>'text')) not between 1 and 100000
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select count(*)
  into v_patch_count
  from jsonb_array_elements(p_patches);

  if (
    select count(*)
    from (
      select patch.value->>'id'
      from jsonb_array_elements(p_patches) patch(value)
      group by 1
    ) unique_patch
  ) <> v_patch_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select jsonb_object_agg(patch.value->>'id', patch.value)
  into v_patch_map
  from jsonb_array_elements(p_patches) patch(value);

  select s.*
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = v_campaign_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select r.*
  into v_parent
  from public.transcript_revisions r
  where r.id = p_expected_current_revision_id
    and r.session_id = v_session.id
    and r.campaign_id = v_campaign_id;

  if not found then
    if v_session.current_transcript_revision_id is distinct from p_expected_current_revision_id then
      select r.revision_number
      into v_current_revision_number
      from public.transcript_revisions r
      where r.id = v_session.current_transcript_revision_id;

      return jsonb_build_object(
        'ok', false,
        'reason', 'stale_current',
        'currentRevisionId', v_session.current_transcript_revision_id,
        'currentRevisionNumber', v_current_revision_number
      );
    end if;
    raise exception 'current transcript revision pointer references a missing revision';
  end if;

  select count(*)
  into v_matched_count
  from jsonb_array_elements(v_parent.segments) segment(value)
  where v_patch_map ? (
    'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id'
  );

  if v_matched_count <> v_patch_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select count(*)
  into v_changed_count
  from jsonb_array_elements(v_parent.segments) segment(value)
  where v_patch_map ? (
      'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id'
    )
    and (
      segment.value->>'speaker' is distinct from (
        v_patch_map #>> array[
          'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
          'speaker'
        ]
      )
      or segment.value->>'text' is distinct from (
        v_patch_map #>> array[
          'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
          'text'
        ]
      )
    );

  select jsonb_agg(
    case
      when v_patch_map ? (
        'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id'
      ) then
        jsonb_set(
          jsonb_set(
            segment.value,
            '{speaker}',
            v_patch_map #> array[
              'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
              'speaker'
            ],
            false
          ),
          '{text}',
          v_patch_map #> array[
            'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
            'text'
          ],
          false
        )
      else segment.value
    end
    order by segment.ordinality
  )
  into v_segments
  from jsonb_array_elements(v_parent.segments) with ordinality segment(value, ordinality);

  if v_segments is null
     or jsonb_array_length(v_segments) <> v_parent.segment_count then
    raise exception 'web edit could not materialize the complete transcript revision';
  end if;

  v_content_sha256 := encode(
    extensions.digest(convert_to(v_segments::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select r.*
  into v_existing
  from public.transcript_revisions r
  where r.session_id = v_session.id
    and r.operation_id = p_operation_id;

  if found then
    if v_existing.revision_origin = 'web_edit'
       and v_existing.parent_revision_id = p_expected_current_revision_id
       and v_existing.payload_sha256 = v_content_sha256 then
      return jsonb_build_object(
        'ok', true,
        'replayed', true,
        'unchanged', false,
        'revisionId', v_existing.id,
        'revisionNumber', v_existing.revision_number,
        'parentRevisionId', v_existing.parent_revision_id,
        'changedSegments', v_changed_count
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'operation_conflict');
  end if;

  if v_session.current_transcript_revision_id is distinct from p_expected_current_revision_id then
    select r.revision_number
    into v_current_revision_number
    from public.transcript_revisions r
    where r.id = v_session.current_transcript_revision_id;

    return jsonb_build_object(
      'ok', false,
      'reason', 'stale_current',
      'currentRevisionId', v_session.current_transcript_revision_id,
      'currentRevisionNumber', v_current_revision_number
    );
  end if;

  if v_changed_count = 0 then
    return jsonb_build_object(
      'ok', true,
      'replayed', false,
      'unchanged', true,
      'revisionId', v_parent.id,
      'revisionNumber', v_parent.revision_number,
      'parentRevisionId', v_parent.parent_revision_id,
      'changedSegments', 0
    );
  end if;

  select coalesce(
    sum(cardinality(regexp_split_to_array(btrim(segment.value->>'text'), E'\\s+'))),
    0
  )::integer
  into v_word_count
  from jsonb_array_elements(v_segments) segment(value);

  v_review_summary := coalesce(v_parent.review_summary, '{}'::jsonb)
    || jsonb_build_object(
      'status', 'edited_web',
      'word_count', v_word_count,
      'reviewed_segments', v_parent.reviewed_segments,
      'total_segments', v_parent.segment_count
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
    revision_origin,
    parent_revision_id
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
    v_content_sha256,
    v_content_sha256,
    v_parent.segment_count,
    v_word_count,
    v_parent.reviewed_segments,
    v_parent.warning_count,
    v_parent.lineage,
    v_review_summary,
    v_segments,
    p_actor_profile_id,
    'web_edit',
    v_parent.id
  );

  update public.sessions s
  set current_transcript_revision_id = v_revision_id
  where s.id = v_session.id
    and s.current_transcript_revision_id = p_expected_current_revision_id;

  if not found then
    raise exception 'session current transcript revision changed while locked';
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
    'transcript_revision.edit',
    'transcript_revisions',
    v_revision_id,
    jsonb_build_object(
      'revision_id', v_parent.id,
      'revision_number', v_parent.revision_number,
      'payload_sha256', v_parent.payload_sha256
    ),
    jsonb_build_object(
      'revision_id', v_revision_id,
      'revision_number', v_revision_number,
      'parent_revision_id', v_parent.id,
      'operation_id', p_operation_id,
      'changed_segments', v_changed_count,
      'payload_sha256', v_content_sha256
    )
  );

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'unchanged', false,
    'revisionId', v_revision_id,
    'revisionNumber', v_revision_number,
    'parentRevisionId', v_parent.id,
    'changedSegments', v_changed_count
  );
end;
$$;

comment on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) is
  'Server-only atomic boundary for #898. Rechecks campaign.content.edit, derives a complete immutable transcript revision from the expected current revision, preserves timing/source provenance, advances the current pointer with CAS, and writes metadata-only audit evidence.';

revoke all on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) from public;
revoke execute on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) from anon;
revoke execute on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) to service_role;

     or p_session_id is null
     or p_expected_current_revision_id is null
     or p_operation_id is null
     or p_patches is null
     or jsonb_typeof(p_patches) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  v_patch_count := jsonb_array_length(p_patches);
  if v_patch_count < 1 or v_patch_count > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
      and p.auth_user_id = p_auth_user_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
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
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_patches) patch(value)
    where jsonb_typeof(patch.value) is distinct from 'object'
       or exists (
         select 1
         from jsonb_object_keys(patch.value) key(name)
         where key.name not in ('id', 'speaker', 'text')
       )
       or jsonb_typeof(patch.value->'id') is distinct from 'string'
       or jsonb_typeof(patch.value->'speaker') is distinct from 'string'
       or jsonb_typeof(patch.value->'text') is distinct from 'string'
       or char_length(patch.value->>'id') not between 1 and 320
       or char_length(btrim(patch.value->>'speaker')) not between 1 and 160
       or char_length(btrim(patch.value->>'text')) not between 1 and 100000
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select count(*)
  into v_patch_count
  from jsonb_array_elements(p_patches);

  if (
    select count(*)
    from (
      select patch.value->>'id'
      from jsonb_array_elements(p_patches) patch(value)
      group by 1
    ) unique_patch
  ) <> v_patch_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select jsonb_object_agg(patch.value->>'id', patch.value)
  into v_patch_map
  from jsonb_array_elements(p_patches) patch(value);

  select s.*
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = v_campaign_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select r.*
  into v_parent
  from public.transcript_revisions r
  where r.id = p_expected_current_revision_id
    and r.session_id = v_session.id
    and r.campaign_id = v_campaign_id;

  if not found then
    if v_session.current_transcript_revision_id is distinct from p_expected_current_revision_id then
      select r.revision_number
      into v_current_revision_number
      from public.transcript_revisions r
      where r.id = v_session.current_transcript_revision_id;

      return jsonb_build_object(
        'ok', false,
        'reason', 'stale_current',
        'currentRevisionId', v_session.current_transcript_revision_id,
        'currentRevisionNumber', v_current_revision_number
      );
    end if;
    raise exception 'current transcript revision pointer references a missing revision';
  end if;

  select count(*)
  into v_matched_count
  from jsonb_array_elements(v_parent.segments) segment(value)
  where v_patch_map ? (
    'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id'
  );

  if v_matched_count <> v_patch_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select count(*)
  into v_changed_count
  from jsonb_array_elements(v_parent.segments) segment(value)
  where v_patch_map ? (
      'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id'
    )
    and (
      segment.value->>'speaker' is distinct from (
        v_patch_map #>> array[
          'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
          'speaker'
        ]
      )
      or segment.value->>'text' is distinct from (
        v_patch_map #>> array[
          'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
          'text'
        ]
      )
    );

  select jsonb_agg(
    case
      when v_patch_map ? (
        'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id'
      ) then
        jsonb_set(
          jsonb_set(
            segment.value,
            '{speaker}',
            v_patch_map #> array[
              'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
              'speaker'
            ],
            false
          ),
          '{text}',
          v_patch_map #> array[
            'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
            'text'
          ],
          false
        )
      else segment.value
    end
    order by segment.ordinality
  )
  into v_segments
  from jsonb_array_elements(v_parent.segments) with ordinality segment(value, ordinality);

  if v_segments is null
     or jsonb_array_length(v_segments) <> v_parent.segment_count then
    raise exception 'web edit could not materialize the complete transcript revision';
  end if;

  v_content_sha256 := encode(
    extensions.digest(convert_to(v_segments::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select r.*
  into v_existing
  from public.transcript_revisions r
  where r.session_id = v_session.id
    and r.operation_id = p_operation_id;

  if found then
    if v_existing.revision_origin = 'web_edit'
       and v_existing.parent_revision_id = p_expected_current_revision_id
       and v_existing.content_sha256 = v_content_sha256 then
      return jsonb_build_object(
        'ok', true,
        'replayed', true,
        'unchanged', false,
        'revisionId', v_existing.id,
        'revisionNumber', v_existing.revision_number,
        'parentRevisionId', v_existing.parent_revision_id,
        'changedSegments', v_changed_count
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'operation_conflict');
  end if;

  if v_session.current_transcript_revision_id is distinct from p_expected_current_revision_id then
    select r.revision_number
    into v_current_revision_number
    from public.transcript_revisions r
    where r.id = v_session.current_transcript_revision_id;

    return jsonb_build_object(
      'ok', false,
      'reason', 'stale_current',
      'currentRevisionId', v_session.current_transcript_revision_id,
      'currentRevisionNumber', v_current_revision_number
    );
  end if;

  if v_changed_count = 0 then
    return jsonb_build_object(
      'ok', true,
      'replayed', false,
      'unchanged', true,
      'revisionId', v_parent.id,
      'revisionNumber', v_parent.revision_number,
      'parentRevisionId', v_parent.parent_revision_id,
      'changedSegments', 0
    );
  end if;

  select coalesce(
    sum(cardinality(regexp_split_to_array(btrim(segment.value->>'text'), E'\\s+'))),
    0
  )::integer
  into v_word_count
  from jsonb_array_elements(v_segments) segment(value);

  v_review_summary := coalesce(v_parent.review_summary, '{}'::jsonb)
    || jsonb_build_object(
      'status', 'edited_web',
      'word_count', v_word_count,
      'reviewed_segments', v_parent.reviewed_segments,
      'total_segments', v_parent.segment_count
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
    revision_origin,
    parent_revision_id,
    content_sha256
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
    v_parent.draft_sha256,
    v_parent.payload_sha256,
    v_parent.segment_count,
    v_word_count,
    v_parent.reviewed_segments,
    v_parent.warning_count,
    v_parent.lineage,
    v_review_summary,
    v_segments,
    p_actor_profile_id,
    'web_edit',
    v_parent.id,
    v_content_sha256
  );

  update public.sessions s
  set current_transcript_revision_id = v_revision_id
  where s.id = v_session.id
    and s.current_transcript_revision_id = p_expected_current_revision_id;

  if not found then
    raise exception 'session current transcript revision changed while locked';
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
    'transcript_revision.edit',
    'transcript_revisions',
    v_revision_id,
    jsonb_build_object(
      'revision_id', v_parent.id,
      'revision_number', v_parent.revision_number,
      'payload_sha256', v_parent.payload_sha256
    ),
    jsonb_build_object(
      'revision_id', v_revision_id,
      'revision_number', v_revision_number,
      'parent_revision_id', v_parent.id,
      'operation_id', p_operation_id,
      'changed_segments', v_changed_count,
      'content_sha256', v_content_sha256
    )
  );

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'unchanged', false,
    'revisionId', v_revision_id,
    'revisionNumber', v_revision_number,
    'parentRevisionId', v_parent.id,
    'changedSegments', v_changed_count
  );
end;
$$;

comment on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) is
  'Server-only atomic boundary for #898. Rechecks campaign.content.edit, derives a complete immutable transcript revision from the expected current revision, preserves timing/source provenance, advances the current pointer with CAS, and writes metadata-only audit evidence.';

revoke all on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) from public;
revoke execute on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) from anon;
revoke execute on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) to service_role;
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.transcript_revisions'::regclass
      and conname = 'transcript_revisions_revision_origin_check'
  ) then
    alter table public.transcript_revisions
      add constraint transcript_revisions_revision_origin_check
      check (revision_origin in ('local_publication', 'web_edit'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.transcript_revisions'::regclass
      and conname = 'transcript_revisions_parent_revision_fk'
  ) then
    alter table public.transcript_revisions
      add constraint transcript_revisions_parent_revision_fk
      foreign key (parent_revision_id)
      references public.transcript_revisions(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists transcript_revisions_parent_revision_idx
  on public.transcript_revisions(parent_revision_id)
  where parent_revision_id is not null;

comment on column public.transcript_revisions.revision_origin is
  'How this immutable revision was materialized. local_publication is the historical/default Companion publication path; web_edit is a private derived revision created in Edit.';
comment on column public.transcript_revisions.parent_revision_id is
  'Immediate immutable parent when a revision is derived in Edit. Nullable for historical/local publication roots.';

create or replace function public.edit_current_transcript_revision_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_expected_current_revision_id uuid,
  p_operation_id uuid,
  p_patches jsonb
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
  v_patch_map jsonb;
  v_segments jsonb;
  v_content_sha256 text;
  v_revision_id uuid;
  v_revision_number bigint;
  v_current_revision_number bigint;
  v_patch_count integer;
  v_matched_count integer;
  v_changed_count integer;
  v_word_count integer;
  v_review_summary jsonb;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_campaign_slug is null
     or p_campaign_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'
     or p_session_id is null
     or p_expected_current_revision_id is null
     or p_operation_id is null
     or p_patches is null
     or jsonb_typeof(p_patches) is distinct from 'array'
     or jsonb_array_length(p_patches) < 1
     or jsonb_array_length(p_patches) > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
      and p.auth_user_id = p_auth_user_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
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
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_patches) patch(value)
    where jsonb_typeof(patch.value) is distinct from 'object'
       or exists (
         select 1
         from jsonb_object_keys(patch.value) key(name)
         where key.name not in ('id', 'speaker', 'text')
       )
       or jsonb_typeof(patch.value->'id') is distinct from 'string'
       or jsonb_typeof(patch.value->'speaker') is distinct from 'string'
       or jsonb_typeof(patch.value->'text') is distinct from 'string'
       or char_length(patch.value->>'id') not between 1 and 320
       or char_length(btrim(patch.value->>'speaker')) not between 1 and 160
       or char_length(btrim(patch.value->>'text')) not between 1 and 100000
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select count(*)
  into v_patch_count
  from jsonb_array_elements(p_patches);

  if (
    select count(*)
    from (
      select patch.value->>'id'
      from jsonb_array_elements(p_patches) patch(value)
      group by 1
    ) unique_patch
  ) <> v_patch_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select jsonb_object_agg(patch.value->>'id', patch.value)
  into v_patch_map
  from jsonb_array_elements(p_patches) patch(value);

  select s.*
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = v_campaign_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select r.*
  into v_parent
  from public.transcript_revisions r
  where r.id = p_expected_current_revision_id
    and r.session_id = v_session.id
    and r.campaign_id = v_campaign_id;

  if not found then
    if v_session.current_transcript_revision_id is distinct from p_expected_current_revision_id then
      select r.revision_number
      into v_current_revision_number
      from public.transcript_revisions r
      where r.id = v_session.current_transcript_revision_id;

      return jsonb_build_object(
        'ok', false,
        'reason', 'stale_current',
        'currentRevisionId', v_session.current_transcript_revision_id,
        'currentRevisionNumber', v_current_revision_number
      );
    end if;
    raise exception 'current transcript revision pointer references a missing revision';
  end if;

  select count(*)
  into v_matched_count
  from jsonb_array_elements(v_parent.segments) segment(value)
  where v_patch_map ? (
    'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id'
  );

  if v_matched_count <> v_patch_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select count(*)
  into v_changed_count
  from jsonb_array_elements(v_parent.segments) segment(value)
  where v_patch_map ? (
      'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id'
    )
    and (
      segment.value->>'speaker' is distinct from (
        v_patch_map #>> array[
          'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
          'speaker'
        ]
      )
      or segment.value->>'text' is distinct from (
        v_patch_map #>> array[
          'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
          'text'
        ]
      )
    );

  select jsonb_agg(
    case
      when v_patch_map ? (
        'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id'
      ) then
        jsonb_set(
          jsonb_set(
            segment.value,
            '{speaker}',
            v_patch_map #> array[
              'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
              'speaker'
            ],
            false
          ),
          '{text}',
          v_patch_map #> array[
            'r-' || segment.value->>'track_number' || '-' || segment.value->>'segment_id',
            'text'
          ],
          false
        )
      else segment.value
    end
    order by segment.ordinality
  )
  into v_segments
  from jsonb_array_elements(v_parent.segments) with ordinality segment(value, ordinality);

  if v_segments is null
     or jsonb_array_length(v_segments) <> v_parent.segment_count then
    raise exception 'web edit could not materialize the complete transcript revision';
  end if;

  v_content_sha256 := encode(
    extensions.digest(convert_to(v_segments::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select r.*
  into v_existing
  from public.transcript_revisions r
  where r.session_id = v_session.id
    and r.operation_id = p_operation_id;

  if found then
    if v_existing.revision_origin = 'web_edit'
       and v_existing.parent_revision_id = p_expected_current_revision_id
       and v_existing.payload_sha256 = v_content_sha256 then
      return jsonb_build_object(
        'ok', true,
        'replayed', true,
        'unchanged', false,
        'revisionId', v_existing.id,
        'revisionNumber', v_existing.revision_number,
        'parentRevisionId', v_existing.parent_revision_id,
        'changedSegments', v_changed_count
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'operation_conflict');
  end if;

  if v_session.current_transcript_revision_id is distinct from p_expected_current_revision_id then
    select r.revision_number
    into v_current_revision_number
    from public.transcript_revisions r
    where r.id = v_session.current_transcript_revision_id;

    return jsonb_build_object(
      'ok', false,
      'reason', 'stale_current',
      'currentRevisionId', v_session.current_transcript_revision_id,
      'currentRevisionNumber', v_current_revision_number
    );
  end if;

  if v_changed_count = 0 then
    return jsonb_build_object(
      'ok', true,
      'replayed', false,
      'unchanged', true,
      'revisionId', v_parent.id,
      'revisionNumber', v_parent.revision_number,
      'parentRevisionId', v_parent.parent_revision_id,
      'changedSegments', 0
    );
  end if;

  select coalesce(
    sum(cardinality(regexp_split_to_array(btrim(segment.value->>'text'), E'\\s+'))),
    0
  )::integer
  into v_word_count
  from jsonb_array_elements(v_segments) segment(value);

  v_review_summary := coalesce(v_parent.review_summary, '{}'::jsonb)
    || jsonb_build_object(
      'status', 'edited_web',
      'word_count', v_word_count,
      'reviewed_segments', v_parent.reviewed_segments,
      'total_segments', v_parent.segment_count
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
    revision_origin,
    parent_revision_id
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
    v_content_sha256,
    v_content_sha256,
    v_parent.segment_count,
    v_word_count,
    v_parent.reviewed_segments,
    v_parent.warning_count,
    v_parent.lineage,
    v_review_summary,
    v_segments,
    p_actor_profile_id,
    'web_edit',
    v_parent.id
  );

  update public.sessions s
  set current_transcript_revision_id = v_revision_id
  where s.id = v_session.id
    and s.current_transcript_revision_id = p_expected_current_revision_id;

  if not found then
    raise exception 'session current transcript revision changed while locked';
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
    'transcript_revision.edit',
    'transcript_revisions',
    v_revision_id,
    jsonb_build_object(
      'revision_id', v_parent.id,
      'revision_number', v_parent.revision_number,
      'payload_sha256', v_parent.payload_sha256
    ),
    jsonb_build_object(
      'revision_id', v_revision_id,
      'revision_number', v_revision_number,
      'parent_revision_id', v_parent.id,
      'operation_id', p_operation_id,
      'changed_segments', v_changed_count,
      'payload_sha256', v_content_sha256
    )
  );

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'unchanged', false,
    'revisionId', v_revision_id,
    'revisionNumber', v_revision_number,
    'parentRevisionId', v_parent.id,
    'changedSegments', v_changed_count
  );
end;
$$;

comment on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) is
  'Server-only atomic boundary for #898. Rechecks campaign.content.edit, derives a complete immutable transcript revision from the expected current revision, preserves timing/source provenance, advances the current pointer with CAS, and writes metadata-only audit evidence.';

revoke all on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) from public;
revoke execute on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) from anon;
revoke execute on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) from authenticated;
grant execute on function public.edit_current_transcript_revision_atomic(uuid, uuid, text, uuid, uuid, uuid, jsonb) to service_role;
