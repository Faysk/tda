-- Versioned public session publication boundary (#793).
-- Private transcript payloads never enter these tables or receipts.

insert into public.permission_catalog(action, plane, description)
values (
  'campaign.session.publish',
  'mixed',
  'Publish, restore or unpublish one editorial session snapshot for an authorized campaign.'
)
on conflict (action) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.permission_catalog pc
    where pc.action = 'campaign.session.publish'
      and pc.plane = 'mixed'
  ) then
    raise exception 'campaign.session.publish exists with an incompatible plane or could not be defined';
  end if;
end;
$$;

create table public.session_publication_versions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  version_number bigint not null check (version_number > 0),
  operation_id uuid not null,
  draft_id uuid not null references public.session_editorial_drafts(id) on delete restrict,
  draft_revision bigint not null check (draft_revision > 0),
  transcript_revision_id uuid not null references public.transcript_revisions(id) on delete restrict,
  cover_asset_id uuid not null references public.media_assets(id) on delete restrict,
  cover_public_url text not null check (
    cover_public_url ~ '^https://media[.]dnd[.]faysk[.]dev/campaigns/[a-z0-9][a-z0-9-]{0,95}/sessions/[0-9a-f-]{36}/cover/[0-9a-f]{64}[.](png|webp)$'
  ),
  cover_sha256 text not null check (cover_sha256 ~ '^[0-9a-f]{64}$'),
  arc text not null default '' check (char_length(arc) <= 300),
  title text not null check (char_length(btrim(title)) between 1 and 500),
  summary_short text not null check (char_length(btrim(summary_short)) between 1 and 4000),
  summary_full text not null check (char_length(btrim(summary_full)) between 1 and 200000),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(session_id, version_number),
  unique(session_id, operation_id)
);

alter table public.session_publication_versions enable row level security;
revoke all on public.session_publication_versions from public, anon, authenticated;
grant select, insert on public.session_publication_versions to service_role;

alter table public.sessions
  add column current_publication_id uuid null;

alter table public.sessions
  add constraint sessions_current_publication_fk
  foreign key (current_publication_id)
  references public.session_publication_versions(id)
  on delete set null;

create index sessions_current_publication_id_idx
  on public.sessions(current_publication_id)
  where current_publication_id is not null;

create table public.session_publication_receipts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  publication_id uuid not null references public.session_publication_versions(id) on delete restrict,
  operation_id uuid not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_profile_id uuid not null references public.profiles(id),
  committed_at timestamptz not null default clock_timestamp(),
  unique(session_id, operation_id),
  unique(publication_id)
);

alter table public.session_publication_receipts enable row level security;
revoke all on public.session_publication_receipts from public, anon, authenticated;
grant select, insert on public.session_publication_receipts to service_role;

create table public.session_publication_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  operation_id uuid not null,
  action text not null check (action in ('publish', 'replace', 'restore', 'unpublish')),
  publication_id uuid null references public.session_publication_versions(id) on delete set null,
  previous_publication_id uuid null references public.session_publication_versions(id) on delete set null,
  actor_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(session_id, operation_id)
);

alter table public.session_publication_events enable row level security;
revoke all on public.session_publication_events from public, anon, authenticated;
grant select, insert on public.session_publication_events to service_role;

create function public.publish_session_editorial_snapshot_atomic(
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
  v_expected_current uuid;
  v_draft_id uuid;
  v_draft_revision bigint;
  v_transcript_revision_id uuid;
  v_cover_asset_id uuid;
  v_cover_public_url text;
  v_cover_sha256 text;
  v_payload_sha256 text;
  v_computed_sha256 text;
  v_session public.sessions%rowtype;
  v_draft public.session_editorial_drafts%rowtype;
  v_asset public.media_assets%rowtype;
  v_existing public.session_publication_receipts%rowtype;
  v_publication_id uuid;
  v_version_number bigint;
  v_previous_publication_id uuid;
  v_receipt_id uuid;
  v_action text;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or not exists (
       select 1 from public.profiles p
       where p.id = p_actor_profile_id
         and p.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or p_lookup_only is null
     or exists (
       select 1 from jsonb_object_keys(p_input) k(key_name)
       where k.key_name not in (
         'campaignId',
         'sessionId',
         'operationId',
         'expectedCurrentPublicationId',
         'draftId',
         'draftRevision',
         'transcriptRevisionId',
         'coverAssetId',
         'coverPublicUrl',
         'coverSha256',
         'payloadSha256'
       )
     )
     or coalesce(p_input->>'campaignId', '') !~ '^[0-9a-f-]{36}$'
     or coalesce(p_input->>'sessionId', '') !~ '^[0-9a-f-]{36}$'
     or coalesce(p_input->>'operationId', '') !~ '^[0-9a-f-]{36}$'
     or (
       p_input->'expectedCurrentPublicationId' <> 'null'::jsonb
       and coalesce(p_input->>'expectedCurrentPublicationId', '') !~ '^[0-9a-f-]{36}$'
     )
     or coalesce(p_input->>'draftId', '') !~ '^[0-9a-f-]{36}$'
     or coalesce(p_input->>'draftRevision', '') !~ '^[1-9][0-9]{0,18}$'
     or coalesce(p_input->>'transcriptRevisionId', '') !~ '^[0-9a-f-]{36}$'
     or coalesce(p_input->>'coverAssetId', '') !~ '^[0-9a-f-]{36}$'
     or coalesce(p_input->>'coverSha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_input->>'payloadSha256', '') !~ '^[0-9a-f]{64}$'
     or char_length(coalesce(p_input->>'coverPublicUrl', '')) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  v_campaign_id := (p_input->>'campaignId')::uuid;
  v_session_id := (p_input->>'sessionId')::uuid;
  v_operation_id := (p_input->>'operationId')::uuid;
  v_expected_current := case
    when p_input->'expectedCurrentPublicationId' is null
      or p_input->'expectedCurrentPublicationId' = 'null'::jsonb then null
    else (p_input->>'expectedCurrentPublicationId')::uuid
  end;
  v_draft_id := (p_input->>'draftId')::uuid;
  v_draft_revision := (p_input->>'draftRevision')::bigint;
  v_transcript_revision_id := (p_input->>'transcriptRevisionId')::uuid;
  v_cover_asset_id := (p_input->>'coverAssetId')::uuid;
  v_cover_public_url := p_input->>'coverPublicUrl';
  v_cover_sha256 := p_input->>'coverSha256';
  v_payload_sha256 := p_input->>'payloadSha256';

  -- Resolve authorization before revealing whether the target session exists.
  if not exists (
    select 1
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
          and rp.permission_action = 'campaign.session.publish'
          and (
            (a.scope_type = 'campaign' and a.scope_id = c.slug)
            or (a.scope_type = 'project' and a.scope_id = 'tda')
          )
      )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select s.*
  into v_session
  from public.sessions s
  where s.id = v_session_id
    and s.campaign_id = v_campaign_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select r.*
  into v_existing
  from public.session_publication_receipts r
  where r.session_id = v_session.id
    and r.operation_id = v_operation_id;

  if found then
    if v_existing.payload_sha256 <> v_payload_sha256 then
      return jsonb_build_object('ok', false, 'reason', 'conflict');
    end if;

    select v.version_number
    into v_version_number
    from public.session_publication_versions v
    where v.id = v_existing.publication_id
      and v.session_id = v_session.id;

    if not found then
      raise exception 'session publication receipt references missing version';
    end if;

    return jsonb_build_object(
      'ok', true,
      'receipt', jsonb_build_object(
        'schemaVersion', 'tda_session_publication_receipt_v1',
        'status', 'committed',
        'receiptId', v_existing.id,
        'campaignId', v_existing.campaign_id,
        'sessionId', v_existing.session_id,
        'publicationId', v_existing.publication_id,
        'versionNumber', v_version_number,
        'operationId', v_existing.operation_id,
        'payloadSha256', v_existing.payload_sha256,
        'committedAt', v_existing.committed_at
      )
    );
  elsif p_lookup_only then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_session.current_publication_id is distinct from v_expected_current then
    return jsonb_build_object('ok', false, 'reason', 'stale_current');
  end if;

  if v_session.current_editorial_draft_id is distinct from v_draft_id then
    return jsonb_build_object('ok', false, 'reason', 'stale_draft');
  end if;

  select d.*
  into v_draft
  from public.session_editorial_drafts d
  where d.id = v_draft_id
    and d.session_id = v_session.id
    and d.campaign_id = v_campaign_id
    and d.revision = v_draft_revision
    and d.base_transcript_revision_id = v_transcript_revision_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'stale_draft');
  end if;

  if v_session.current_transcript_revision_id is distinct from v_transcript_revision_id then
    return jsonb_build_object('ok', false, 'reason', 'stale_transcript');
  end if;

  if char_length(btrim(v_draft.title)) < 1
     or char_length(btrim(v_draft.summary_short)) < 1
     or char_length(btrim(v_draft.summary_full)) < 1
     or v_draft.cover_asset_id is distinct from v_cover_asset_id::text then
    return jsonb_build_object('ok', false, 'reason', 'not_ready');
  end if;

  select m.*
  into v_asset
  from public.media_assets m
  where m.id = v_cover_asset_id
    and m.campaign_id = v_campaign_id
    and m.role_hint = 'session_cover'
    and m.status = 'verified_public'
    and m.sha256 = v_cover_sha256
    and m.read_back_verified
    and m.public_bucket = 'tda-media-public'
    and m.public_object_key is not null
    and m.public_delivery_verified
    and m.public_verified_at is not null;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'cover_not_ready');
  end if;

  if v_asset.public_object_key !~ (
       '^campaigns/' ||
       (select c.slug from public.campaigns c where c.id = v_campaign_id) ||
       '/sessions/' || v_session.id::text ||
       '/cover/[0-9a-f]{64}[.](png|webp)$'
     )
     or v_cover_public_url is distinct from
       ('https://media.dnd.faysk.dev/' || v_asset.public_object_key) then
    return jsonb_build_object('ok', false, 'reason', 'cover_not_ready');
  end if;

  v_computed_sha256 := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'schemaVersion', 'tda_session_publication_payload_v1',
          'sessionId', v_session.id,
          'draftId', v_draft.id,
          'draftRevision', v_draft.revision,
          'transcriptRevisionId', v_transcript_revision_id,
          'coverAssetId', v_cover_asset_id,
          'coverPublicUrl', v_cover_public_url,
          'coverSha256', v_cover_sha256,
          'arc', v_draft.arc,
          'title', v_draft.title,
          'summaryShort', v_draft.summary_short,
          'summaryFull', v_draft.summary_full
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if v_computed_sha256 <> v_payload_sha256 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select coalesce(max(v.version_number), 0) + 1
  into v_version_number
  from public.session_publication_versions v
  where v.session_id = v_session.id;

  v_publication_id := gen_random_uuid();
  v_previous_publication_id := v_session.current_publication_id;
  v_action := case when v_previous_publication_id is null then 'publish' else 'replace' end;

  insert into public.session_publication_versions (
    id,
    campaign_id,
    session_id,
    version_number,
    operation_id,
    draft_id,
    draft_revision,
    transcript_revision_id,
    cover_asset_id,
    cover_public_url,
    cover_sha256,
    arc,
    title,
    summary_short,
    summary_full,
    payload_sha256,
    actor_profile_id
  ) values (
    v_publication_id,
    v_campaign_id,
    v_session.id,
    v_version_number,
    v_operation_id,
    v_draft.id,
    v_draft.revision,
    v_transcript_revision_id,
    v_cover_asset_id,
    v_cover_public_url,
    v_cover_sha256,
    v_draft.arc,
    v_draft.title,
    v_draft.summary_short,
    v_draft.summary_full,
    v_payload_sha256,
    p_actor_profile_id
  );

  update public.sessions
  set
    title = v_draft.title,
    arc = nullif(v_draft.arc, ''),
    summary_short = v_draft.summary_short,
    summary_full = v_draft.summary_full,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'coverImageUrl', v_cover_public_url,
      'heroImageUrl', v_cover_public_url
    ),
    status = 'published',
    current_publication_id = v_publication_id,
    updated_at = clock_timestamp()
  where id = v_session.id;

  v_receipt_id := gen_random_uuid();
  insert into public.session_publication_receipts (
    id,
    campaign_id,
    session_id,
    publication_id,
    operation_id,
    payload_sha256,
    actor_profile_id
  ) values (
    v_receipt_id,
    v_campaign_id,
    v_session.id,
    v_publication_id,
    v_operation_id,
    v_payload_sha256,
    p_actor_profile_id
  )
  returning * into v_existing;

  insert into public.session_publication_events (
    campaign_id,
    session_id,
    operation_id,
    action,
    publication_id,
    previous_publication_id,
    actor_profile_id
  ) values (
    v_campaign_id,
    v_session.id,
    v_operation_id,
    v_action,
    v_publication_id,
    v_previous_publication_id,
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
    'session_publication.' || v_action,
    'session_publication_versions',
    v_publication_id,
    jsonb_build_object('currentPublicationId', v_previous_publication_id),
    jsonb_build_object(
      'currentPublicationId', v_publication_id,
      'versionNumber', v_version_number,
      'draftId', v_draft.id,
      'draftRevision', v_draft.revision,
      'transcriptRevisionId', v_transcript_revision_id,
      'coverAssetId', v_cover_asset_id,
      'payloadSha256', v_payload_sha256
    )
  );

  return jsonb_build_object(
    'ok', true,
    'receipt', jsonb_build_object(
      'schemaVersion', 'tda_session_publication_receipt_v1',
      'status', 'committed',
      'receiptId', v_existing.id,
      'campaignId', v_existing.campaign_id,
      'sessionId', v_existing.session_id,
      'publicationId', v_existing.publication_id,
      'versionNumber', v_version_number,
      'operationId', v_existing.operation_id,
      'payloadSha256', v_existing.payload_sha256,
      'committedAt', v_existing.committed_at
    )
  );
end;
$$;

revoke all on function public.publish_session_editorial_snapshot_atomic(uuid, uuid, jsonb, boolean)
from public, anon, authenticated;
grant execute on function public.publish_session_editorial_snapshot_atomic(uuid, uuid, jsonb, boolean)
to service_role;

create function public.set_current_session_publication_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_id uuid,
  p_session_id uuid,
  p_operation_id uuid,
  p_publication_id uuid,
  p_expected_current_publication_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_session public.sessions%rowtype;
  v_publication public.session_publication_versions%rowtype;
  v_existing public.session_publication_events%rowtype;
  v_previous uuid;
  v_action text;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_campaign_id is null
     or p_session_id is null
     or p_operation_id is null
     or not exists (
       select 1 from public.profiles p
       where p.id = p_actor_profile_id
         and p.auth_user_id = p_auth_user_id
     )
     or not exists (
       select 1
       from public.campaigns c
       where c.id = p_campaign_id
         and exists (
           select 1
           from public.role_assignments a
           join public.role_permissions rp on rp.role_id = a.role_id
           where a.profile_id = p_actor_profile_id
             and a.status = 'active'
             and a.starts_at <= clock_timestamp()
             and (a.ends_at is null or a.ends_at > clock_timestamp())
             and rp.permission_action = 'campaign.session.publish'
             and (
               (a.scope_type = 'campaign' and a.scope_id = c.slug)
               or (a.scope_type = 'project' and a.scope_id = 'tda')
             )
         )
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select s.*
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = p_campaign_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select e.*
  into v_existing
  from public.session_publication_events e
  where e.session_id = p_session_id
    and e.operation_id = p_operation_id;

  if found then
    v_action := case when p_publication_id is null then 'unpublish' else 'restore' end;
    if v_existing.action <> v_action
       or v_existing.publication_id is distinct from p_publication_id then
      return jsonb_build_object('ok', false, 'reason', 'conflict');
    end if;
    return jsonb_build_object(
      'ok', true,
      'event', jsonb_build_object(
        'schemaVersion', 'tda_session_publication_event_v1',
        'eventId', v_existing.id,
        'action', v_existing.action,
        'publicationId', v_existing.publication_id,
        'previousPublicationId', v_existing.previous_publication_id,
        'committedAt', v_existing.created_at
      )
    );
  end if;

  if v_session.current_publication_id is distinct from p_expected_current_publication_id then
    return jsonb_build_object('ok', false, 'reason', 'stale_current');
  end if;

  v_previous := v_session.current_publication_id;

  if p_publication_id is null then
    v_action := 'unpublish';
    update public.sessions
    set status = 'approved',
        current_publication_id = null,
        updated_at = clock_timestamp()
    where id = p_session_id;
  else
    select v.*
    into v_publication
    from public.session_publication_versions v
    where v.id = p_publication_id
      and v.session_id = p_session_id
      and v.campaign_id = p_campaign_id;

    if not found then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;

    v_action := 'restore';
    update public.sessions
    set title = v_publication.title,
        arc = nullif(v_publication.arc, ''),
        summary_short = v_publication.summary_short,
        summary_full = v_publication.summary_full,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'coverImageUrl', v_publication.cover_public_url,
          'heroImageUrl', v_publication.cover_public_url
        ),
        status = 'published',
        current_publication_id = v_publication.id,
        updated_at = clock_timestamp()
    where id = p_session_id;
  end if;

  insert into public.session_publication_events (
    campaign_id,
    session_id,
    operation_id,
    action,
    publication_id,
    previous_publication_id,
    actor_profile_id
  ) values (
    p_campaign_id,
    p_session_id,
    p_operation_id,
    v_action,
    p_publication_id,
    v_previous,
    p_actor_profile_id
  )
  returning * into v_existing;

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
    p_campaign_id,
    p_session_id,
    p_actor_profile_id,
    'session_publication.' || v_action,
    'sessions',
    p_session_id,
    jsonb_build_object('currentPublicationId', v_previous),
    jsonb_build_object('currentPublicationId', p_publication_id)
  );

  return jsonb_build_object(
    'ok', true,
    'event', jsonb_build_object(
      'schemaVersion', 'tda_session_publication_event_v1',
      'eventId', v_existing.id,
      'action', v_existing.action,
      'publicationId', v_existing.publication_id,
      'previousPublicationId', v_existing.previous_publication_id,
      'committedAt', v_existing.created_at
    )
  );
end;
$$;

revoke all on function public.set_current_session_publication_atomic(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.set_current_session_publication_atomic(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid
) to service_role;

-- Deliberate rollout grant to the existing narrative Site Editor role.
do $$
declare
  v_role_id uuid;
begin
  select rd.id
  into strict v_role_id
  from public.role_definitions rd
  where rd.slug = 'site_editor'
    and rd.plane = 'narrative';

  insert into public.role_permissions(role_id, permission_action)
  values (v_role_id, 'campaign.session.publish')
  on conflict (role_id, permission_action) do nothing;
end;
$$;

comment on function public.publish_session_editorial_snapshot_atomic(uuid, uuid, jsonb, boolean) is
'Server-only idempotent CAS publication of one saved editorial draft. Commits immutable version, receipt, event and narrow public sessions read-model fields atomically without publishing transcript content.';
comment on function public.set_current_session_publication_atomic(uuid, uuid, uuid, uuid, uuid, uuid, uuid) is
'Server-only restore/unpublish boundary for immutable session publication history.';
