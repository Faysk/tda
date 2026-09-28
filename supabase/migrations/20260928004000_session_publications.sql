-- Versioned, atomic public session publication from a saved editorial draft (#793).
-- Browser roles are denied. The server-side service role is the only Data API caller.

insert into public.permission_catalog(action, plane, description)
values (
  'campaign.sessions.publish',
  'narrative',
  'Publish a saved session editorial draft to the public session archive.'
)
on conflict (action) do nothing;

do $grant$
declare
  v_role_id uuid;
begin
  if not exists (
    select 1
    from public.permission_catalog pc
    where pc.action = 'campaign.sessions.publish'
      and pc.plane = 'narrative'
  ) then
    raise exception 'campaign.sessions.publish exists with an incompatible plane or could not be defined';
  end if;

  select rd.id
  into strict v_role_id
  from public.role_definitions rd
  where rd.slug = 'site_editor'
    and rd.plane = 'narrative';

  insert into public.role_permissions(role_id, permission_action)
  values (v_role_id, 'campaign.sessions.publish')
  on conflict (role_id, permission_action) do nothing;
end;
$grant$;

create table public.session_publications (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  version bigint not null check (version > 0),
  draft_id uuid not null references public.session_editorial_drafts(id) on delete restrict,
  base_transcript_revision_id uuid not null references public.transcript_revisions(id) on delete restrict,
  cover_asset_id text not null check (char_length(cover_asset_id) between 1 and 512),
  cover_url text not null check (char_length(cover_url) between 1 and 2000),
  arc text not null default '' check (char_length(arc) <= 300),
  title text not null check (char_length(title) between 1 and 500),
  summary_short text not null check (char_length(summary_short) between 1 and 4000),
  summary_full text not null check (char_length(summary_full) between 1 and 200000),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(session_id, version)
);

alter table public.session_publications enable row level security;
revoke all on public.session_publications from public, anon, authenticated;
grant select, insert on public.session_publications to service_role;

alter table public.sessions
  add column current_session_publication_id uuid null;

alter table public.sessions
  add constraint sessions_current_session_publication_fk
  foreign key (current_session_publication_id)
  references public.session_publications(id)
  on delete set null;

create index sessions_current_session_publication_id_idx
  on public.sessions(current_session_publication_id)
  where current_session_publication_id is not null;

create index session_publications_campaign_id_idx
  on public.session_publications(campaign_id);

create index session_publications_draft_id_idx
  on public.session_publications(draft_id);

create index session_publications_base_transcript_revision_id_idx
  on public.session_publications(base_transcript_revision_id);

create index session_publications_actor_profile_id_idx
  on public.session_publications(actor_profile_id);

create table public.session_publication_operations (
  operation_id uuid primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  draft_id uuid not null references public.session_editorial_drafts(id) on delete restrict,
  publication_id uuid not null references public.session_publications(id) on delete restrict,
  expected_previous_publication_id uuid null references public.session_publications(id) on delete restrict,
  public_cover_url text not null check (char_length(public_cover_url) between 1 and 2000),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp()
);

alter table public.session_publication_operations enable row level security;
revoke all on public.session_publication_operations from public, anon, authenticated;
grant select, insert on public.session_publication_operations to service_role;

create index session_publication_operations_campaign_id_idx
  on public.session_publication_operations(campaign_id);

create index session_publication_operations_session_id_idx
  on public.session_publication_operations(session_id);

create index session_publication_operations_publication_id_idx
  on public.session_publication_operations(publication_id);

create index session_publication_operations_actor_profile_id_idx
  on public.session_publication_operations(actor_profile_id);

create function public.publish_session_editorial_atomic(
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_draft_id uuid,
  p_expected_current_publication_id uuid,
  p_operation_id uuid,
  p_public_cover_url text
)
returns table(
  status text,
  publication_id uuid,
  version bigint,
  previous_publication_id uuid,
  payload_sha256 text
)
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  v_campaign_id uuid;
  v_current_draft_id uuid;
  v_current_transcript_revision_id uuid;
  v_current_publication_id uuid;
  v_current_publication_version bigint;
  v_source_session_id text;
  v_draft public.session_editorial_drafts%rowtype;
  v_operation public.session_publication_operations%rowtype;
  v_media public.media_assets%rowtype;
  v_publication_id uuid;
  v_version bigint;
  v_payload_material text;
  v_payload_sha256 text;
  v_cover_is_asset boolean;
  v_expected_legacy_cover_url text;
  v_now timestamptz := clock_timestamp();
begin
  if p_actor_profile_id is null
     or p_campaign_slug is null
     or btrim(p_campaign_slug) = ''
     or p_session_id is null
     or p_draft_id is null
     or p_operation_id is null
     or p_public_cover_url is null
     or btrim(p_public_cover_url) = ''
     or char_length(p_public_cover_url) > 2000 then
    return query select 'invalid_payload'::text, null::uuid, null::bigint, null::uuid, null::text;
    return;
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
  ) then
    return query select 'forbidden'::text, null::uuid, null::bigint, null::uuid, null::text;
    return;
  end if;

  select
    s.campaign_id,
    s.current_editorial_draft_id,
    s.current_transcript_revision_id,
    s.current_session_publication_id,
    s.source_session_id
  into
    v_campaign_id,
    v_current_draft_id,
    v_current_transcript_revision_id,
    v_current_publication_id,
    v_source_session_id
  from public.sessions s
  join public.campaigns c on c.id = s.campaign_id
  where s.id = p_session_id
    and c.slug = p_campaign_slug
  for update of s;

  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint, null::uuid, null::text;
    return;
  end if;

  select o.*
  into v_operation
  from public.session_publication_operations o
  where o.operation_id = p_operation_id;

  if found then
    if v_operation.session_id <> p_session_id
       or v_operation.campaign_id <> v_campaign_id
       or v_operation.draft_id <> p_draft_id
       or v_operation.actor_profile_id <> p_actor_profile_id
       or v_operation.expected_previous_publication_id is distinct from p_expected_current_publication_id
       or v_operation.public_cover_url <> p_public_cover_url then
      return query select 'operation_conflict'::text, null::uuid, null::bigint, v_current_publication_id, null::text;
      return;
    end if;

    select sp.version
    into v_current_publication_version
    from public.session_publications sp
    where sp.id = v_operation.publication_id
      and sp.session_id = p_session_id
      and sp.campaign_id = v_campaign_id
      and sp.payload_sha256 = v_operation.payload_sha256;

    if not found then
      raise exception 'session publication operation receipt is inconsistent';
    end if;

    return query select
      'replay'::text,
      v_operation.publication_id,
      v_current_publication_version,
      v_operation.expected_previous_publication_id,
      v_operation.payload_sha256;
    return;
  end if;

  if v_current_publication_id is distinct from p_expected_current_publication_id then
    return query select 'stale_current'::text, null::uuid, null::bigint, v_current_publication_id, null::text;
    return;
  end if;

  if v_current_draft_id is distinct from p_draft_id then
    return query select 'draft_changed'::text, null::uuid, null::bigint, v_current_publication_id, null::text;
    return;
  end if;

  select d.*
  into v_draft
  from public.session_editorial_drafts d
  where d.id = p_draft_id
    and d.session_id = p_session_id
    and d.campaign_id = v_campaign_id;

  if not found then
    return query select 'draft_changed'::text, null::uuid, null::bigint, v_current_publication_id, null::text;
    return;
  end if;

  if v_current_transcript_revision_id is null
     or v_draft.base_transcript_revision_id <> v_current_transcript_revision_id then
    return query select 'transcript_changed'::text, null::uuid, null::bigint, v_current_publication_id, null::text;
    return;
  end if;

  if v_source_session_id is null
     or btrim(v_source_session_id) = ''
     or v_draft.cover_asset_id is null
     or btrim(v_draft.cover_asset_id) = ''
     or btrim(v_draft.title) = ''
     or btrim(v_draft.summary_short) = ''
     or btrim(v_draft.summary_full) = '' then
    return query select 'not_ready'::text, null::uuid, null::bigint, v_current_publication_id, null::text;
    return;
  end if;

  v_cover_is_asset := v_draft.cover_asset_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  if v_cover_is_asset then
    select ma.*
    into v_media
    from public.media_assets ma
    where ma.id = v_draft.cover_asset_id::uuid
      and ma.campaign_id = v_campaign_id
      and ma.role_hint = 'session_cover'
      and ma.status = 'verified_public'
      and ma.read_back_verified = true
      and ma.public_bucket = 'tda-media-public'
      and ma.public_object_key = ma.object_key
      and ma.public_delivery_verified = true
      and ma.public_verified_at is not null;

    if not found
       or v_media.object_key not like
          ('campaigns/' || p_campaign_slug || '/sessions/' || lower(p_session_id::text) || '/cover/%')
       or p_public_cover_url <> ('https://media.dnd.faysk.dev/' || v_media.public_object_key) then
      return query select 'cover_unverified'::text, null::uuid, null::bigint, v_current_publication_id, null::text;
      return;
    end if;
  else
    v_expected_legacy_cover_url := case
      when v_draft.cover_asset_id like '/assets/sessions/%'
        then 'https://dnd.faysk.dev' || v_draft.cover_asset_id
      else v_draft.cover_asset_id
    end;

    if p_public_cover_url <> v_expected_legacy_cover_url
       or position('?' in p_public_cover_url) > 0
       or position('#' in p_public_cover_url) > 0
       or not (
         p_public_cover_url like 'https://media.dnd.faysk.dev/campaigns/yuhara-main/sessions/%'
         or p_public_cover_url like 'https://dnd.faysk.dev/assets/sessions/%'
         or p_public_cover_url like 'https://dmrqnbdvbkfqzctcerbx.supabase.co/storage/v1/object/public/session-images/%'
       ) then
      return query select 'cover_unverified'::text, null::uuid, null::bigint, v_current_publication_id, null::text;
      return;
    end if;
  end if;

  v_payload_material :=
    'tda_session_publication_v1' ||
    '|session=' || p_session_id::text ||
    '|draft=' || p_draft_id::text ||
    '|transcript=' || v_draft.base_transcript_revision_id::text ||
    '|cover=' || octet_length(convert_to(p_public_cover_url, 'UTF8'))::text || ':' || p_public_cover_url ||
    '|arc=' || octet_length(convert_to(v_draft.arc, 'UTF8'))::text || ':' || v_draft.arc ||
    '|title=' || octet_length(convert_to(v_draft.title, 'UTF8'))::text || ':' || v_draft.title ||
    '|short=' || octet_length(convert_to(v_draft.summary_short, 'UTF8'))::text || ':' || v_draft.summary_short ||
    '|full=' || octet_length(convert_to(v_draft.summary_full, 'UTF8'))::text || ':' || v_draft.summary_full;

  v_payload_sha256 := encode(
    extensions.digest(convert_to(v_payload_material, 'UTF8'), 'sha256'),
    'hex'
  );

  if v_current_publication_id is not null then
    select sp.version
    into v_current_publication_version
    from public.session_publications sp
    where sp.id = v_current_publication_id
      and sp.session_id = p_session_id
      and sp.campaign_id = v_campaign_id;

    if not found then
      raise exception 'current session publication pointer is inconsistent';
    end if;
  end if;

  select coalesce(max(sp.version), 0) + 1
  into v_version
  from public.session_publications sp
  where sp.session_id = p_session_id
    and sp.campaign_id = v_campaign_id;

  v_publication_id := gen_random_uuid();

  insert into public.session_publications (
    id,
    campaign_id,
    session_id,
    version,
    draft_id,
    base_transcript_revision_id,
    cover_asset_id,
    cover_url,
    arc,
    title,
    summary_short,
    summary_full,
    payload_sha256,
    actor_profile_id,
    created_at
  ) values (
    v_publication_id,
    v_campaign_id,
    p_session_id,
    v_version,
    p_draft_id,
    v_draft.base_transcript_revision_id,
    v_draft.cover_asset_id,
    p_public_cover_url,
    v_draft.arc,
    v_draft.title,
    v_draft.summary_short,
    v_draft.summary_full,
    v_payload_sha256,
    p_actor_profile_id,
    v_now
  );

  update public.sessions s
  set
    title = v_draft.title,
    arc = nullif(v_draft.arc, ''),
    summary_short = v_draft.summary_short,
    summary_full = v_draft.summary_full,
    status = 'published',
    metadata = jsonb_set(
      jsonb_set(
        coalesce(s.metadata, '{}'::jsonb),
        '{coverImageUrl}',
        to_jsonb(p_public_cover_url),
        true
      ),
      '{heroImageUrl}',
      to_jsonb(p_public_cover_url),
      true
    ),
    current_session_publication_id = v_publication_id,
    updated_at = v_now
  where s.id = p_session_id
    and s.campaign_id = v_campaign_id
    and s.current_editorial_draft_id = p_draft_id
    and s.current_transcript_revision_id = v_draft.base_transcript_revision_id
    and s.current_session_publication_id is not distinct from p_expected_current_publication_id;

  if not found then
    raise exception 'session publication authority changed while session was locked';
  end if;

  insert into public.session_publication_operations (
    operation_id,
    campaign_id,
    session_id,
    draft_id,
    publication_id,
    expected_previous_publication_id,
    public_cover_url,
    payload_sha256,
    actor_profile_id,
    created_at
  ) values (
    p_operation_id,
    v_campaign_id,
    p_session_id,
    p_draft_id,
    v_publication_id,
    p_expected_current_publication_id,
    p_public_cover_url,
    v_payload_sha256,
    p_actor_profile_id,
    v_now
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
    p_session_id,
    p_actor_profile_id,
    'session_publication.publish',
    'session_publications',
    v_publication_id,
    case
      when p_expected_current_publication_id is null then null
      else jsonb_build_object(
        'publicationId', p_expected_current_publication_id,
        'version', v_current_publication_version
      )
    end,
    jsonb_build_object(
      'publicationId', v_publication_id,
      'version', v_version,
      'draftId', p_draft_id,
      'baseTranscriptRevisionId', v_draft.base_transcript_revision_id,
      'payloadSha256', v_payload_sha256,
      'coverAssetBacked', v_cover_is_asset,
      'titleChars', char_length(v_draft.title),
      'shortDescriptionChars', char_length(v_draft.summary_short),
      'summaryChars', char_length(v_draft.summary_full),
      'sourceSessionIdPresent', v_source_session_id is not null
    )
  );

  return query select
    'published'::text,
    v_publication_id,
    v_version,
    p_expected_current_publication_id,
    v_payload_sha256;
end;
$$;

comment on function public.publish_session_editorial_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text
)
is 'Server-only SECURITY INVOKER CAS boundary that publishes one immutable editorial snapshot while keeping transcript content private.';

revoke all on function public.publish_session_editorial_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text
) from public;
revoke execute on function public.publish_session_editorial_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text
) from anon;
revoke execute on function public.publish_session_editorial_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text
) from authenticated;
grant execute on function public.publish_session_editorial_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text
) to service_role;
