-- #1765: HQ has its own private draft, independent of transcript revisions.
-- An existing, valid editorial publication is required. No session/editorial
-- columns are updated by this migration or the RPC below.
create table public.session_comic_drafts (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  pages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(pages) = 'array' and jsonb_array_length(pages) <= 150),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default clock_timestamp()
);
create index session_comic_drafts_campaign_idx on public.session_comic_drafts(campaign_id);
alter table public.session_comic_drafts enable row level security;
revoke all on public.session_comic_drafts from public, anon, authenticated;
grant select, insert, update on public.session_comic_drafts to service_role;

create function public.save_session_comic_draft_atomic(
  p_actor_profile_id uuid, p_campaign_slug text, p_session_id uuid,
  p_expected_revision bigint, p_pages jsonb
)
returns table(status text, revision bigint)
language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_current_publication_id uuid;
  v_current_revision bigint;
  v_page jsonb;
  v_asset_id uuid;
  v_seen uuid[] := '{}'::uuid[];
  v_prefix text;
begin
  if p_actor_profile_id is null or p_expected_revision is null
    or p_expected_revision < 0 or p_pages is null
    or jsonb_typeof(p_pages) <> 'array'
    or jsonb_array_length(p_pages) > 150 then
    return query select 'invalid_payload'::text, null::bigint;
    return;
  end if;
  if not exists (select 1 from public.profiles where id = p_actor_profile_id) then
    return query select 'forbidden'::text, null::bigint;
    return;
  end if;
  select s.campaign_id, s.current_session_publication_id
    into v_campaign_id, v_current_publication_id
  from public.sessions s
  join public.campaigns c on c.id = s.campaign_id
  where s.id = p_session_id and c.slug = p_campaign_slug
  for update of s;
  if not found then
    return query select 'not_found'::text, null::bigint;
    return;
  end if;
  if v_current_publication_id is null or not exists (
    select 1 from public.session_publications sp
    where sp.id = v_current_publication_id
      and sp.session_id = p_session_id
      and sp.campaign_id = v_campaign_id
      and btrim(sp.summary_full) <> ''
  ) then
    return query select 'summary_not_published'::text, null::bigint;
    return;
  end if;
  v_prefix := 'campaigns/' || p_campaign_slug ||
    '/sessions/' || p_session_id::text || '/comic/';
  for v_page in select value from jsonb_array_elements(p_pages) loop
    if jsonb_typeof(v_page) <> 'object'
      or jsonb_typeof(v_page->'assetId') <> 'string'
      or jsonb_typeof(v_page->'altText') <> 'string'
      or jsonb_typeof(v_page->'caption') <> 'string'
      or (v_page - 'assetId' - 'altText' - 'caption') <> '{}'::jsonb
      or char_length(v_page->>'altText') > 500
      or char_length(v_page->>'caption') > 1000 then
      return query select 'invalid_pages'::text, null::bigint;
      return;
    end if;
    begin
      v_asset_id := (v_page->>'assetId')::uuid;
    exception when invalid_text_representation then
      return query select 'invalid_pages'::text, null::bigint;
      return;
    end;
    if v_asset_id = any(v_seen) or not exists (
      select 1 from public.media_assets a
      where a.id = v_asset_id and a.campaign_id = v_campaign_id
        and a.role_hint = 'session_comic_page'
        and a.status in ('staged', 'verified_public')
        and a.read_back_verified = true
        and a.sha256 ~ '^[a-f0-9]{64}$'
        and a.mime_type in ('image/png','image/webp')
        and a.byte_size > 0 and a.width > 0 and a.height > 0
        and a.width::bigint * a.height::bigint <= 64000000
        and a.object_key = v_prefix || a.sha256 ||
          case when a.mime_type = 'image/png' then '.png' else '.webp' end
    ) then
      return query select 'invalid_pages'::text, null::bigint;
      return;
    end if;
    v_seen := array_append(v_seen, v_asset_id);
  end loop;
  select d.revision into v_current_revision from public.session_comic_drafts d
  where d.session_id = p_session_id and d.campaign_id = v_campaign_id for update;
  if found then
    if v_current_revision <> p_expected_revision then
      return query select 'conflict'::text, v_current_revision;
      return;
    end if;
    update public.session_comic_drafts d
    set pages = p_pages, revision = d.revision + 1,
        updated_by = p_actor_profile_id, updated_at = clock_timestamp()
    where d.session_id = p_session_id and d.campaign_id = v_campaign_id
    returning d.revision into v_current_revision;
  else
    if p_expected_revision <> 0 then
      return query select 'conflict'::text, 0::bigint;
      return;
    end if;
    insert into public.session_comic_drafts
      (session_id, campaign_id, revision, pages, updated_by)
    values (p_session_id, v_campaign_id, 1, p_pages, p_actor_profile_id);
    v_current_revision := 1;
  end if;
  return query select 'updated'::text, v_current_revision;
end;
$$;
revoke all on function public.save_session_comic_draft_atomic(uuid,text,uuid,bigint,jsonb) from public;
revoke execute on function public.save_session_comic_draft_atomic(uuid,text,uuid,bigint,jsonb) from anon,authenticated;
grant execute on function public.save_session_comic_draft_atomic(uuid,text,uuid,bigint,jsonb) to service_role;
