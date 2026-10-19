-- #1765 / candidate — requires companion media constraint candidate first.
-- This is not deployed. Promote to an ordered migration after isolated pgTAP
-- and publication compatibility tests are ready.
-- HQ draft pages are metadata only; the actual media remains in governed R2.
alter table public.session_editorial_drafts
  add column comic_pages jsonb not null default '[]'::jsonb
  constraint session_editorial_drafts_comic_pages_check
  check (
    jsonb_typeof(comic_pages) = 'array'
    and jsonb_array_length(comic_pages) <= 150
  );

grant update(comic_pages) on public.session_editorial_drafts to service_role;

create function public.save_session_editorial_draft_with_comic_atomic(
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_expected_revision bigint,
  p_base_transcript_revision_id uuid,
  p_cover_asset_id text,
  p_arc text,
  p_title text,
  p_summary_short text,
  p_summary_full text,
  p_session_date text,
  p_comic_pages jsonb
)
returns table(status text, draft_id uuid, revision bigint)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_page jsonb;
  v_asset_id uuid;
  v_asset public.media_assets%rowtype;
  v_seen uuid[] := '{}'::uuid[];
  v_status text;
  v_draft_id uuid;
  v_revision bigint;
  v_expected_prefix text;
  v_alt text;
  v_caption text;
begin
  if p_comic_pages is null or
     jsonb_typeof(p_comic_pages) <> 'array' or
     jsonb_array_length(p_comic_pages) > 150 then
    raise exception 'invalid HQ page collection' using errcode = '22023';
  end if;

  select s.campaign_id
  into v_campaign_id
  from public.sessions s
  join public.campaigns c on c.id = s.campaign_id
  where s.id = p_session_id
    and c.slug = p_campaign_slug
  for share of s;

  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;

  v_expected_prefix :=
    'campaigns/' || p_campaign_slug || '/sessions/' ||
    p_session_id::text || '/comic/';

  for v_page in select value from jsonb_array_elements(p_comic_pages)
  loop
    if jsonb_typeof(v_page) <> 'object' or
       jsonb_typeof(v_page->'assetId') <> 'string' or
       jsonb_typeof(v_page->'altText') <> 'string' or
       jsonb_typeof(v_page->'caption') <> 'string' or
       (v_page - 'assetId' - 'altText' - 'caption') <> '{}'::jsonb then
      raise exception 'invalid HQ page metadata' using errcode = '22023';
    end if;

    v_alt := v_page->>'altText';
    v_caption := v_page->>'caption';
    if char_length(v_alt) > 500 or char_length(v_caption) > 1000 then
      raise exception 'invalid HQ page caption length' using errcode = '22023';
    end if;

    begin
      v_asset_id := (v_page->>'assetId')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid HQ asset identity' using errcode = '22023';
    end;

    if v_asset_id = any(v_seen) then
      raise exception 'duplicate HQ asset identity' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_asset_id);

    select a.*
    into v_asset
    from public.media_assets a
    where a.id = v_asset_id
      and a.campaign_id = v_campaign_id
      and a.role_hint = 'session_comic_page'
      and a.status in ('staged', 'verified_public')
      and a.read_back_verified = true
      and a.object_key like v_expected_prefix || '%'
      and a.object_key ~ '/comic/[0-9a-f]{64}[.](png|webp)$';

    if not found then
      raise exception 'HQ asset is not verified for this session' using errcode = '22023';
    end if;
  end loop;

  select result.status, result.draft_id, result.revision
  into v_status, v_draft_id, v_revision
  from public.save_session_editorial_draft_with_date_atomic(
    p_actor_profile_id,
    p_campaign_slug,
    p_session_id,
    p_expected_revision,
    p_base_transcript_revision_id,
    p_cover_asset_id,
    p_arc,
    p_title,
    p_summary_short,
    p_summary_full,
    p_session_date
  ) result;

  if v_status = 'updated' and v_draft_id is not null then
    update public.session_editorial_drafts d
    set comic_pages = p_comic_pages
    where d.id = v_draft_id
      and d.campaign_id = v_campaign_id
      and d.session_id = p_session_id;
    if not found then
      raise exception 'HQ draft snapshot missing after save';
    end if;
  end if;

  return query select v_status, v_draft_id, v_revision;
end;
$$;

revoke all on function public.save_session_editorial_draft_with_comic_atomic(
  uuid, text, uuid, bigint, uuid, text, text, text, text, text, text, jsonb
) from public;
revoke execute on function public.save_session_editorial_draft_with_comic_atomic(
  uuid, text, uuid, bigint, uuid, text, text, text, text, text, text, jsonb
) from anon, authenticated;
grant execute on function public.save_session_editorial_draft_with_comic_atomic(
  uuid, text, uuid, bigint, uuid, text, text, text, text, text, text, jsonb
) to service_role;

comment on function public.save_session_editorial_draft_with_comic_atomic(
  uuid, text, uuid, bigint, uuid, text, text, text, text, text, text, jsonb
) is 'Server-only HQ draft wrapper: CAS saves immutable editorial draft metadata with individually validated campaign/session-scoped R2 asset references.';
