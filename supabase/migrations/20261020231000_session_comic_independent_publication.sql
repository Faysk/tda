-- #1765: independent HQ snapshots attached to an already published summary.
-- Keeps editorial publication records and sessions completely unchanged.
create table public.session_comic_publications (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  editorial_publication_id uuid not null references public.session_publications(id) on delete restrict,
  version bigint not null check (version > 0),
  draft_revision bigint not null check (draft_revision > 0),
  pages jsonb not null check (jsonb_typeof(pages) = 'array' and jsonb_array_length(pages) between 1 and 150),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  actor_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  unique (session_id, version)
);
create index session_comic_publications_campaign_idx on public.session_comic_publications(campaign_id);
alter table public.session_comic_publications enable row level security;
revoke all on public.session_comic_publications from public, anon, authenticated;
grant select, insert on public.session_comic_publications to service_role;

create table public.session_comic_publication_operations (
  operation_id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  publication_id uuid not null references public.session_comic_publications(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id),
  expected_previous_id uuid null,
  expected_draft_revision bigint not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.session_comic_publication_operations enable row level security;
revoke all on public.session_comic_publication_operations from public, anon, authenticated;
grant select, insert on public.session_comic_publication_operations to service_role;

create function public.publish_session_comic_atomic(
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_expected_editorial_publication_id uuid,
  p_expected_previous_comic_id uuid,
  p_expected_draft_revision bigint,
  p_operation_id uuid,
  p_public_pages jsonb
)
returns table(status text, publication_id uuid, version bigint)
language plpgsql security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  v_campaign_id uuid;
  v_editorial_id uuid;
  v_draft public.session_comic_drafts%rowtype;
  v_previous_id uuid;
  v_previous_version bigint;
  v_id uuid;
  v_version bigint;
  v_page jsonb;
  v_asset public.media_assets%rowtype;
  v_asset_id uuid;
  v_seen uuid[] := '{}'::uuid[];
  v_expected_pages jsonb := '[]'::jsonb;
  v_prefix text;
  v_hash text;
  v_op public.session_comic_publication_operations%rowtype;
begin
  if p_actor_profile_id is null or p_session_id is null
     or p_operation_id is null or p_expected_editorial_publication_id is null
     or p_expected_draft_revision is null or p_expected_draft_revision < 1
     or p_public_pages is null or jsonb_typeof(p_public_pages) <> 'array'
     or jsonb_array_length(p_public_pages) not between 1 and 150 then
    return query select 'invalid_payload'::text, null::uuid, null::bigint;
    return;
  end if;
  if not exists (select 1 from public.profiles where id = p_actor_profile_id) then
    return query select 'forbidden'::text, null::uuid, null::bigint;
    return;
  end if;

  -- Serialize HQ and editorial publication against the session lock.
  select s.campaign_id, s.current_session_publication_id
  into v_campaign_id, v_editorial_id
  from public.sessions s join public.campaigns c on c.id = s.campaign_id
  where s.id = p_session_id and c.slug = p_campaign_slug
  for update of s;
  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;

  select o.* into v_op from public.session_comic_publication_operations o
  where o.operation_id = p_operation_id;
  if found then
    if v_op.session_id <> p_session_id or v_op.campaign_id <> v_campaign_id
      or v_op.actor_profile_id <> p_actor_profile_id
      or v_op.expected_previous_id is distinct from p_expected_previous_comic_id
      or v_op.expected_draft_revision <> p_expected_draft_revision then
      return query select 'operation_conflict'::text, null::uuid, null::bigint;
      return;
    end if;
    select cp.version into v_version from public.session_comic_publications cp
    where cp.id = v_op.publication_id and cp.session_id = p_session_id;
    return query select 'replay'::text, v_op.publication_id, v_version;
    return;
  end if;

  if v_editorial_id is distinct from p_expected_editorial_publication_id
    or not exists (
      select 1 from public.session_publications sp
      where sp.id = v_editorial_id and sp.session_id = p_session_id
        and sp.campaign_id = v_campaign_id and btrim(sp.summary_full) <> ''
    ) then
    return query select 'summary_not_published'::text, null::uuid, null::bigint;
    return;
  end if;

  select cp.id, cp.version into v_previous_id, v_previous_version
  from public.session_comic_publications cp
  where cp.session_id = p_session_id and cp.campaign_id = v_campaign_id
  order by cp.version desc limit 1;

  if v_previous_id is distinct from p_expected_previous_comic_id then
    return query select 'stale_current'::text, null::uuid, null::bigint;
    return;
  end if;

  select d.* into v_draft from public.session_comic_drafts d
  where d.session_id = p_session_id and d.campaign_id = v_campaign_id
  for share;
  if not found or v_draft.revision <> p_expected_draft_revision
    or jsonb_array_length(v_draft.pages) < 1 then
    return query select 'draft_changed'::text, null::uuid, null::bigint;
    return;
  end if;

  v_prefix := 'campaigns/' || p_campaign_slug || '/sessions/' || p_session_id::text || '/comic/';
  for v_page in select value from jsonb_array_elements(v_draft.pages) loop
    if jsonb_typeof(v_page) <> 'object'
      or jsonb_typeof(v_page->'assetId') <> 'string'
      or jsonb_typeof(v_page->'altText') <> 'string'
      or jsonb_typeof(v_page->'caption') <> 'string'
      or (v_page - 'assetId' - 'altText' - 'caption') <> '{}'::jsonb
      or btrim(v_page->>'altText') = ''
      or char_length(v_page->>'altText') > 500
      or char_length(v_page->>'caption') > 1000 then
      return query select 'comic_unverified'::text, null::uuid, null::bigint;
      return;
    end if;
    begin v_asset_id := (v_page->>'assetId')::uuid;
    exception when invalid_text_representation then
      return query select 'comic_unverified'::text, null::uuid, null::bigint;
      return;
    end;
    if v_asset_id = any(v_seen) then
      return query select 'comic_unverified'::text, null::uuid, null::bigint;
      return;
    end if;
    v_seen := array_append(v_seen, v_asset_id);
    select a.* into v_asset from public.media_assets a
    where a.id = v_asset_id and a.campaign_id = v_campaign_id
      and a.role_hint = 'session_comic_page'
      and a.status = 'verified_public' and a.read_back_verified = true
      and a.public_delivery_verified = true and a.public_bucket = 'tda-media-public'
      and a.public_verified_at is not null
      and a.sha256 ~ '^[a-f0-9]{64}$'
      and a.mime_type in ('image/png','image/webp')
      and a.byte_size > 0 and a.width > 0 and a.height > 0
      and a.width::bigint * a.height::bigint <= 64000000
      and a.object_key = a.public_object_key
      and a.object_key = v_prefix || a.sha256 ||
        case when a.mime_type = 'image/png' then '.png' else '.webp' end
    for share of a;
    if not found then
      return query select 'comic_unverified'::text, null::uuid, null::bigint;
      return;
    end if;
    v_expected_pages := v_expected_pages || jsonb_build_array(jsonb_build_object(
      'imageUrl','https://media.dnd.faysk.dev/' || v_asset.public_object_key,
      'altText',v_page->>'altText','caption',v_page->>'caption',
      'width',v_asset.width,'height',v_asset.height
    ));
  end loop;

  if v_expected_pages <> p_public_pages then
    return query select 'comic_unverified'::text, null::uuid, null::bigint;
    return;
  end if;

  v_version := coalesce(v_previous_version,0) + 1;
  v_hash := encode(extensions.digest(convert_to(v_expected_pages::text,'UTF8'),'sha256'),'hex');
  insert into public.session_comic_publications(
    session_id,campaign_id,editorial_publication_id,version,draft_revision,
    pages,payload_sha256,actor_profile_id
  ) values (
    p_session_id,v_campaign_id,v_editorial_id,v_version,v_draft.revision,
    v_expected_pages,v_hash,p_actor_profile_id
  ) returning id into v_id;
  insert into public.session_comic_publication_operations(
    operation_id,session_id,campaign_id,publication_id,actor_profile_id,
    expected_previous_id,expected_draft_revision
  ) values (
    p_operation_id,p_session_id,v_campaign_id,v_id,p_actor_profile_id,
    p_expected_previous_comic_id,p_expected_draft_revision
  );
  return query select 'published'::text, v_id, v_version;
end;
$$;
revoke all on function public.publish_session_comic_atomic(uuid,text,uuid,uuid,uuid,bigint,uuid,jsonb) from public;
revoke execute on function public.publish_session_comic_atomic(uuid,text,uuid,uuid,uuid,bigint,uuid,jsonb) from anon,authenticated;
grant execute on function public.publish_session_comic_atomic(uuid,text,uuid,uuid,uuid,bigint,uuid,jsonb) to service_role;
