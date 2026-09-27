-- Versioned, server-only publication snapshots for public sessions (#793).
-- The public reader continues to read only denormalized public.session fields.
-- Transcript payloads are never copied into this domain.

create table public.session_editorial_publications (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  version bigint not null check (version > 0),
  source_draft_id uuid not null references public.session_editorial_drafts(id) on delete restrict,
  base_transcript_revision_id uuid not null references public.transcript_revisions(id) on delete restrict,
  cover_asset_id uuid null references public.media_assets(id) on delete restrict,
  cover_image_url text not null check (char_length(cover_image_url) between 1 and 2000),
  arc text not null check (char_length(arc) <= 300),
  title text not null check (char_length(title) between 1 and 500),
  summary_short text not null check (char_length(summary_short) between 1 and 4000),
  summary_full text not null check (char_length(summary_full) between 1 and 200000),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(session_id, version)
);

create index session_editorial_publications_campaign_idx
  on public.session_editorial_publications(campaign_id, session_id, version desc);
create index session_editorial_publications_draft_idx
  on public.session_editorial_publications(source_draft_id);

create table public.session_editorial_publication_receipts (
  operation_id uuid primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  operation_kind text not null check (operation_kind in ('publish','restore','unpublish')),
  source_draft_id uuid null references public.session_editorial_drafts(id) on delete restrict,
  target_publication_id uuid null references public.session_editorial_publications(id) on delete restrict,
  expected_current_publication_id uuid null references public.session_editorial_publications(id) on delete restrict,
  previous_publication_id uuid null references public.session_editorial_publications(id) on delete restrict,
  publication_id uuid null references public.session_editorial_publications(id) on delete restrict,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_profile_id uuid not null references public.profiles(id),
  status text not null default 'committed' check (status = 'committed'),
  created_at timestamptz not null default clock_timestamp()
);

create index session_editorial_publication_receipts_session_idx
  on public.session_editorial_publication_receipts(session_id, created_at desc);

alter table public.session_editorial_publications enable row level security;
alter table public.session_editorial_publication_receipts enable row level security;
revoke all on public.session_editorial_publications from public, anon, authenticated, service_role;
revoke all on public.session_editorial_publication_receipts from public, anon, authenticated, service_role;
grant select, insert on public.session_editorial_publications to service_role;
grant select, insert on public.session_editorial_publication_receipts to service_role;

alter table public.sessions
  add column current_session_publication_id uuid null;

alter table public.sessions
  add constraint sessions_current_session_publication_fk
  foreign key (current_session_publication_id)
  references public.session_editorial_publications(id)
  on delete set null;

create index sessions_current_session_publication_idx
  on public.sessions(current_session_publication_id)
  where current_session_publication_id is not null;

create function public.publish_session_editorial_snapshot_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_draft_id uuid,
  p_expected_current_publication_id uuid,
  p_operation_id uuid,
  p_cover_asset_id uuid,
  p_cover_image_url text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_campaign_id uuid;
  v_current_publication_id uuid;
  v_current_draft_id uuid;
  v_current_transcript_revision_id uuid;
  v_draft public.session_editorial_drafts%rowtype;
  v_existing public.session_editorial_publication_receipts%rowtype;
  v_payload jsonb;
  v_payload_sha256 text;
  v_publication_id uuid;
  v_version bigint;
  v_metadata jsonb;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_campaign_slug is null
     or btrim(p_campaign_slug) = ''
     or p_session_id is null
     or p_draft_id is null
     or p_operation_id is null
     or p_cover_image_url is null
     or btrim(p_cover_image_url) = ''
     or char_length(p_cover_image_url) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.auth_user_id = p_auth_user_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select s.campaign_id, s.current_session_publication_id,
         s.current_editorial_draft_id, s.current_transcript_revision_id
  into v_campaign_id, v_current_publication_id,
       v_current_draft_id, v_current_transcript_revision_id
  from public.sessions s
  join public.campaigns c on c.id = s.campaign_id
  where s.id = p_session_id and c.slug = p_campaign_slug
  for update of s;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if not exists (
    select 1
    from public.role_assignments a
    join public.role_permissions rp on rp.role_id = a.role_id
    where a.profile_id = p_actor_profile_id
      and a.status = 'active'
      and a.starts_at <= v_now
      and (a.ends_at is null or a.ends_at > v_now)
      and rp.permission_action = 'campaign.transcript.publish'
      and (
        (a.scope_type = 'campaign' and a.scope_id = p_campaign_slug)
        or (a.scope_type = 'project' and a.scope_id = 'tda')
      )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select d.* into v_draft
  from public.session_editorial_drafts d
  where d.id = p_draft_id
    and d.session_id = p_session_id
    and d.campaign_id = v_campaign_id;

  if not found or v_current_draft_id is distinct from p_draft_id then
    return jsonb_build_object('ok', false, 'reason', 'draft_stale');
  end if;

  if v_current_transcript_revision_id is null
     or v_draft.base_transcript_revision_id is distinct from v_current_transcript_revision_id then
    return jsonb_build_object('ok', false, 'reason', 'transcript_stale');
  end if;

  if btrim(v_draft.title) = ''
     or btrim(v_draft.summary_short) = ''
     or btrim(v_draft.summary_full) = '' then
    return jsonb_build_object('ok', false, 'reason', 'draft_incomplete');
  end if;

  if p_cover_asset_id is not null then
    if not exists (
      select 1
      from public.media_assets a
      where a.id = p_cover_asset_id
        and a.campaign_id = v_campaign_id
        and a.role_hint = 'session_cover'
        and a.status = 'verified_public'
        and a.read_back_verified
        and a.public_bucket = 'tda-media-public'
        and a.public_object_key = a.object_key
        and a.public_delivery_verified
        and a.public_verified_at is not null
        and a.object_key ~ (
          '^campaigns/' || p_campaign_slug ||
          '/sessions/' || p_session_id::text ||
          '/cover/[0-9a-f]{64}[.](png|webp)$'
        )
        and p_cover_image_url =
          'https://media.dnd.faysk.dev/' || a.public_object_key
    ) then
      return jsonb_build_object('ok', false, 'reason', 'cover_not_verified');
    end if;
  elsif not (
    p_cover_image_url ~ '^https://media[.]dnd[.]faysk[.]dev/campaigns/yuhara-main/sessions/'
    or p_cover_image_url ~ '^https://dnd[.]faysk[.]dev/assets/sessions/'
    or p_cover_image_url ~ '^https://dmrqnbdvbkfqzctcerbx[.]supabase[.]co/storage/v1/object/public/session-images/'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'cover_not_verified');
  end if;

  v_payload := jsonb_build_object(
    'schemaVersion', 'tda_session_publication_v1',
    'sessionId', p_session_id,
    'sourceDraftId', p_draft_id,
    'baseTranscriptRevisionId', v_draft.base_transcript_revision_id,
    'coverAssetId', p_cover_asset_id,
    'coverImageUrl', p_cover_image_url,
    'arc', v_draft.arc,
    'title', v_draft.title,
    'summaryShort', v_draft.summary_short,
    'summaryFull', v_draft.summary_full
  );
  v_payload_sha256 := encode(
    extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select r.* into v_existing
  from public.session_editorial_publication_receipts r
  where r.operation_id = p_operation_id;

  if found then
    if v_existing.operation_kind = 'publish'
       and v_existing.session_id = p_session_id
       and v_existing.source_draft_id = p_draft_id
       and v_existing.expected_current_publication_id is not distinct from p_expected_current_publication_id
       and v_existing.payload_sha256 = v_payload_sha256
       and v_existing.status = 'committed' then
      return jsonb_build_object(
        'ok', true,
        'replayed', true,
        'operationId', p_operation_id,
        'publicationId', v_existing.publication_id,
        'previousPublicationId', v_existing.previous_publication_id,
        'payloadSha256', v_existing.payload_sha256
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'operation_conflict');
  end if;

  if v_current_publication_id is distinct from p_expected_current_publication_id then
    return jsonb_build_object(
      'ok', false,
      'reason', 'conflict',
      'currentPublicationId', v_current_publication_id
    );
  end if;

  select coalesce(max(p.version), 0) + 1
  into v_version
  from public.session_editorial_publications p
  where p.session_id = p_session_id;

  v_publication_id := gen_random_uuid();
  insert into public.session_editorial_publications (
    id, campaign_id, session_id, version, source_draft_id,
    base_transcript_revision_id, cover_asset_id, cover_image_url,
    arc, title, summary_short, summary_full, payload_sha256,
    actor_profile_id, created_at
  ) values (
    v_publication_id, v_campaign_id, p_session_id, v_version, p_draft_id,
    v_draft.base_transcript_revision_id, p_cover_asset_id, p_cover_image_url,
    v_draft.arc, v_draft.title, v_draft.summary_short, v_draft.summary_full,
    v_payload_sha256, p_actor_profile_id, v_now
  );

  v_metadata := coalesce(
    (select s.metadata from public.sessions s where s.id = p_session_id),
    '{}'::jsonb
  );
  v_metadata := jsonb_set(
    jsonb_set(v_metadata, '{coverImageUrl}', to_jsonb(p_cover_image_url), true),
    '{heroImageUrl}', to_jsonb(p_cover_image_url), true
  );

  update public.sessions s
  set title = v_draft.title,
      arc = nullif(v_draft.arc, ''),
      summary_short = v_draft.summary_short,
      summary_full = v_draft.summary_full,
      metadata = v_metadata,
      status = 'published',
      current_session_publication_id = v_publication_id,
      updated_at = v_now
  where s.id = p_session_id
    and s.campaign_id = v_campaign_id
    and s.current_session_publication_id is not distinct from p_expected_current_publication_id;

  if not found then
    raise exception 'session publication pointer changed while row was locked';
  end if;

  insert into public.session_editorial_publication_receipts (
    operation_id, campaign_id, session_id, operation_kind,
    source_draft_id, expected_current_publication_id,
    previous_publication_id, publication_id, payload_sha256,
    actor_profile_id, status, created_at
  ) values (
    p_operation_id, v_campaign_id, p_session_id, 'publish',
    p_draft_id, p_expected_current_publication_id,
    v_current_publication_id, v_publication_id, v_payload_sha256,
    p_actor_profile_id, 'committed', v_now
  );

  insert into public.audit_log (
    campaign_id, session_id, actor_id, action, table_name, record_id,
    old_value, new_value
  ) values (
    v_campaign_id, p_session_id, p_actor_profile_id,
    'session_editorial_publication.publish',
    'session_editorial_publications',
    v_publication_id,
    case when v_current_publication_id is null then null
      else jsonb_build_object('publicationId', v_current_publication_id)
    end,
    jsonb_build_object(
      'publicationId', v_publication_id,
      'version', v_version,
      'sourceDraftId', p_draft_id,
      'payloadSha256', v_payload_sha256,
      'operationId', p_operation_id,
      'hasCoverAsset', p_cover_asset_id is not null
    )
  );

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'operationId', p_operation_id,
    'publicationId', v_publication_id,
    'previousPublicationId', v_current_publication_id,
    'version', v_version,
    'payloadSha256', v_payload_sha256
  );
end;
$$;

create function public.restore_session_editorial_publication_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_target_publication_id uuid,
  p_expected_current_publication_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_campaign_id uuid;
  v_current_publication_id uuid;
  v_target public.session_editorial_publications%rowtype;
  v_existing public.session_editorial_publication_receipts%rowtype;
  v_hash text;
  v_metadata jsonb;
begin
  if p_auth_user_id is null or p_actor_profile_id is null
     or p_campaign_slug is null or p_session_id is null
     or p_target_publication_id is null or p_operation_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and p.auth_user_id = p_auth_user_id
  ) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  select s.campaign_id, s.current_session_publication_id
  into v_campaign_id, v_current_publication_id
  from public.sessions s
  join public.campaigns c on c.id=s.campaign_id
  where s.id=p_session_id and c.slug=p_campaign_slug
  for update of s;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  if not exists (
    select 1
    from public.role_assignments a
    join public.role_permissions rp on rp.role_id=a.role_id
    where a.profile_id=p_actor_profile_id and a.status='active'
      and a.starts_at <= v_now and (a.ends_at is null or a.ends_at > v_now)
      and rp.permission_action='campaign.transcript.publish'
      and ((a.scope_type='campaign' and a.scope_id=p_campaign_slug)
        or (a.scope_type='project' and a.scope_id='tda'))
  ) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  select p.* into v_target
  from public.session_editorial_publications p
  where p.id=p_target_publication_id and p.session_id=p_session_id
    and p.campaign_id=v_campaign_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  v_hash := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'schemaVersion','tda_session_publication_restore_v1',
      'sessionId',p_session_id,
      'targetPublicationId',p_target_publication_id
    )::text,'UTF8'),'sha256'),'hex');

  select r.* into v_existing
  from public.session_editorial_publication_receipts r
  where r.operation_id=p_operation_id;
  if found then
    if v_existing.operation_kind='restore'
       and v_existing.session_id=p_session_id
       and v_existing.target_publication_id=p_target_publication_id
       and v_existing.expected_current_publication_id is not distinct from p_expected_current_publication_id
       and v_existing.payload_sha256=v_hash then
      return jsonb_build_object(
        'ok',true,'replayed',true,'operationId',p_operation_id,
        'publicationId',v_existing.publication_id,
        'previousPublicationId',v_existing.previous_publication_id,
        'payloadSha256',v_existing.payload_sha256
      );
    end if;
    return jsonb_build_object('ok',false,'reason','operation_conflict');
  end if;

  if v_current_publication_id is distinct from p_expected_current_publication_id then
    return jsonb_build_object('ok',false,'reason','conflict',
      'currentPublicationId',v_current_publication_id);
  end if;

  v_metadata := coalesce(
    (select s.metadata from public.sessions s where s.id=p_session_id),
    '{}'::jsonb
  );
  v_metadata := jsonb_set(
    jsonb_set(v_metadata,'{coverImageUrl}',to_jsonb(v_target.cover_image_url),true),
    '{heroImageUrl}',to_jsonb(v_target.cover_image_url),true
  );

  update public.sessions s
  set title=v_target.title, arc=nullif(v_target.arc,''),
      summary_short=v_target.summary_short, summary_full=v_target.summary_full,
      metadata=v_metadata, status='published',
      current_session_publication_id=p_target_publication_id,
      updated_at=v_now
  where s.id=p_session_id and s.campaign_id=v_campaign_id
    and s.current_session_publication_id is not distinct from p_expected_current_publication_id;

  insert into public.session_editorial_publication_receipts (
    operation_id,campaign_id,session_id,operation_kind,target_publication_id,
    expected_current_publication_id,previous_publication_id,publication_id,
    payload_sha256,actor_profile_id,status,created_at
  ) values (
    p_operation_id,v_campaign_id,p_session_id,'restore',p_target_publication_id,
    p_expected_current_publication_id,v_current_publication_id,p_target_publication_id,
    v_hash,p_actor_profile_id,'committed',v_now
  );

  insert into public.audit_log (
    campaign_id,session_id,actor_id,action,table_name,record_id,old_value,new_value
  ) values (
    v_campaign_id,p_session_id,p_actor_profile_id,
    'session_editorial_publication.restore','session_editorial_publications',
    p_target_publication_id,
    jsonb_build_object('publicationId',v_current_publication_id),
    jsonb_build_object('publicationId',p_target_publication_id,
      'operationId',p_operation_id,'payloadSha256',v_hash)
  );

  return jsonb_build_object(
    'ok',true,'replayed',false,'operationId',p_operation_id,
    'publicationId',p_target_publication_id,
    'previousPublicationId',v_current_publication_id,
    'version',v_target.version,'payloadSha256',v_hash
  );
end;
$$;

create function public.unpublish_session_editorial_snapshot_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_expected_current_publication_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_campaign_id uuid;
  v_current_publication_id uuid;
  v_existing public.session_editorial_publication_receipts%rowtype;
  v_hash text;
begin
  if p_auth_user_id is null or p_actor_profile_id is null
     or p_campaign_slug is null or p_session_id is null or p_operation_id is null then
    return jsonb_build_object('ok',false,'reason','invalid_payload');
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id=p_actor_profile_id and p.auth_user_id=p_auth_user_id
  ) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;

  select s.campaign_id,s.current_session_publication_id
  into v_campaign_id,v_current_publication_id
  from public.sessions s
  join public.campaigns c on c.id=s.campaign_id
  where s.id=p_session_id and c.slug=p_campaign_slug
  for update of s;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;

  if not exists (
    select 1
    from public.role_assignments a
    join public.role_permissions rp on rp.role_id=a.role_id
    where a.profile_id=p_actor_profile_id and a.status='active'
      and a.starts_at <= v_now and (a.ends_at is null or a.ends_at > v_now)
      and rp.permission_action='campaign.transcript.publish'
      and ((a.scope_type='campaign' and a.scope_id=p_campaign_slug)
        or (a.scope_type='project' and a.scope_id='tda'))
  ) then return jsonb_build_object('ok',false,'reason','forbidden'); end if;

  v_hash := encode(extensions.digest(convert_to(
    jsonb_build_object(
      'schemaVersion','tda_session_unpublish_v1',
      'sessionId',p_session_id,
      'expectedCurrentPublicationId',p_expected_current_publication_id
    )::text,'UTF8'),'sha256'),'hex');

  select r.* into v_existing
  from public.session_editorial_publication_receipts r
  where r.operation_id=p_operation_id;
  if found then
    if v_existing.operation_kind='unpublish'
       and v_existing.session_id=p_session_id
       and v_existing.expected_current_publication_id is not distinct from p_expected_current_publication_id
       and v_existing.payload_sha256=v_hash then
      return jsonb_build_object(
        'ok',true,'replayed',true,'operationId',p_operation_id,
        'publicationId',null,'previousPublicationId',v_existing.previous_publication_id,
        'payloadSha256',v_existing.payload_sha256
      );
    end if;
    return jsonb_build_object('ok',false,'reason','operation_conflict');
  end if;

  if v_current_publication_id is distinct from p_expected_current_publication_id then
    return jsonb_build_object('ok',false,'reason','conflict',
      'currentPublicationId',v_current_publication_id);
  end if;
  if v_current_publication_id is null then
    return jsonb_build_object('ok',false,'reason','not_published');
  end if;

  update public.sessions s
  set status='approved', current_session_publication_id=null, updated_at=v_now
  where s.id=p_session_id and s.campaign_id=v_campaign_id
    and s.current_session_publication_id is not distinct from p_expected_current_publication_id;

  insert into public.session_editorial_publication_receipts (
    operation_id,campaign_id,session_id,operation_kind,
    expected_current_publication_id,previous_publication_id,publication_id,
    payload_sha256,actor_profile_id,status,created_at
  ) values (
    p_operation_id,v_campaign_id,p_session_id,'unpublish',
    p_expected_current_publication_id,v_current_publication_id,null,
    v_hash,p_actor_profile_id,'committed',v_now
  );

  insert into public.audit_log (
    campaign_id,session_id,actor_id,action,table_name,record_id,old_value,new_value
  ) values (
    v_campaign_id,p_session_id,p_actor_profile_id,
    'session_editorial_publication.unpublish','sessions',p_session_id,
    jsonb_build_object('publicationId',v_current_publication_id),
    jsonb_build_object('publicationId',null,
      'operationId',p_operation_id,'payloadSha256',v_hash)
  );

  return jsonb_build_object(
    'ok',true,'replayed',false,'operationId',p_operation_id,
    'publicationId',null,'previousPublicationId',v_current_publication_id,
    'payloadSha256',v_hash
  );
end;
$$;

comment on table public.session_editorial_publications is
  'Immutable public-session editorial snapshots. No transcript text or segment payload is stored here.';
comment on table public.session_editorial_publication_receipts is
  'Immutable idempotency/receipt ledger for publish, restore and unpublish operations.';
comment on function public.publish_session_editorial_snapshot_atomic(
  uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text
) is 'Server-only SECURITY INVOKER publish boundary with current-publication CAS and durable operation replay.';
comment on function public.restore_session_editorial_publication_atomic(
  uuid,uuid,text,uuid,uuid,uuid,uuid
) is 'Server-only SECURITY INVOKER restore boundary for prior immutable session editorial publications.';
comment on function public.unpublish_session_editorial_snapshot_atomic(
  uuid,uuid,text,uuid,uuid,uuid
) is 'Server-only SECURITY INVOKER unpublish boundary preserving immutable publication history.';

revoke all on function public.publish_session_editorial_snapshot_atomic(
  uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text
) from public, anon, authenticated;
revoke all on function public.restore_session_editorial_publication_atomic(
  uuid,uuid,text,uuid,uuid,uuid,uuid
) from public, anon, authenticated;
revoke all on function public.unpublish_session_editorial_snapshot_atomic(
  uuid,uuid,text,uuid,uuid,uuid
) from public, anon, authenticated;

grant execute on function public.publish_session_editorial_snapshot_atomic(
  uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text
) to service_role;
grant execute on function public.restore_session_editorial_publication_atomic(
  uuid,uuid,text,uuid,uuid,uuid,uuid
) to service_role;
grant execute on function public.unpublish_session_editorial_snapshot_atomic(
  uuid,uuid,text,uuid,uuid,uuid
) to service_role;
