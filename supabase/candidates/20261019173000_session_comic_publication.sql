-- #1765 / candidate only. Requires both earlier HQ candidates.
-- Keep outside supabase/migrations until local Postgres tests, review and
-- coordinated UI/API rollout. The old date-only publisher remains available.
--
-- Each publication owns an immutable HQ snapshot distinct from the private
-- draft, and each public page is checked against a verified R2 media asset.

alter table public.session_publications
  add column comic_pages jsonb not null default '[]'::jsonb
  constraint session_publications_comic_pages_check
  check (
    jsonb_typeof(comic_pages) = 'array'
    and jsonb_array_length(comic_pages) <= 150
  ),
  add column comic_payload_sha256 text null
  constraint session_publications_comic_hash_check
  check (
    comic_payload_sha256 is null or
    comic_payload_sha256 ~ '^[0-9a-f]{64}$'
  );

grant update(comic_pages, comic_payload_sha256)
  on public.session_publications to service_role;

create function public.publish_session_editorial_with_comic_atomic(
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_draft_id uuid,
  p_expected_current_publication_id uuid,
  p_operation_id uuid,
  p_public_cover_url text,
  p_public_comic_pages jsonb
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
  v_draft public.session_editorial_drafts%rowtype;
  v_private_page jsonb;
  v_asset_id uuid;
  v_asset public.media_assets%rowtype;
  v_expected_pages jsonb := '[]'::jsonb;
  v_seen uuid[] := '{}'::uuid[];
  v_alt text;
  v_caption text;
  v_expected_key_prefix text;
  v_result_status text;
  v_result_publication uuid;
  v_result_version bigint;
  v_result_previous uuid;
  v_base_hash text;
  v_actual_pages jsonb;
  v_actual_hash text;
  v_comic_hash text;
begin
  if p_public_comic_pages is null or
     jsonb_typeof(p_public_comic_pages) <> 'array' or
     jsonb_array_length(p_public_comic_pages) > 150 then
    raise exception 'invalid HQ public pages' using errcode = '22023';
  end if;

  select s.campaign_id
  into v_campaign_id
  from public.sessions s
  join public.campaigns c on c.id = s.campaign_id
  where s.id = p_session_id
    and c.slug = p_campaign_slug;

  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint, null::uuid, null::text;
    return;
  end if;

  select d.*
  into v_draft
  from public.session_editorial_drafts d
  where d.id = p_draft_id
    and d.session_id = p_session_id
    and d.campaign_id = v_campaign_id;

  if not found or v_draft.comic_pages is null
     or jsonb_typeof(v_draft.comic_pages) <> 'array' then
    return query select 'draft_changed'::text, null::uuid, null::bigint, null::uuid, null::text;
    return;
  end if;

  v_expected_key_prefix :=
    'campaigns/' || p_campaign_slug || '/sessions/' || p_session_id::text || '/comic/';

  for v_private_page in
    select value from jsonb_array_elements(v_draft.comic_pages)
  loop
    if jsonb_typeof(v_private_page) <> 'object'
       or jsonb_typeof(v_private_page->'assetId') <> 'string'
       or jsonb_typeof(v_private_page->'altText') <> 'string'
       or jsonb_typeof(v_private_page->'caption') <> 'string'
       or (v_private_page - 'assetId' - 'altText' - 'caption') <> '{}'::jsonb then
      return query select 'comic_unverified'::text, null::uuid, null::bigint, null::uuid, null::text;
      return;
    end if;

    v_alt := v_private_page->>'altText';
    v_caption := v_private_page->>'caption';
    if btrim(v_alt) = '' or char_length(v_alt) > 500
       or char_length(v_caption) > 1000 then
      return query select 'comic_unverified'::text, null::uuid, null::bigint, null::uuid, null::text;
      return;
    end if;

    begin
      v_asset_id := (v_private_page->>'assetId')::uuid;
    exception when invalid_text_representation then
      return query select 'comic_unverified'::text, null::uuid, null::bigint, null::uuid, null::text;
      return;
    end;

    if v_asset_id = any(v_seen) then
      return query select 'comic_unverified'::text, null::uuid, null::bigint, null::uuid, null::text;
      return;
    end if;
    v_seen := array_append(v_seen, v_asset_id);

    select a.*
    into v_asset
    from public.media_assets a
    where a.id = v_asset_id
      and a.campaign_id = v_campaign_id
      and a.role_hint = 'session_comic_page'
      and a.status = 'verified_public'
      and a.read_back_verified = true
      and a.public_delivery_verified = true
      and a.public_bucket = 'tda-media-public'
      and a.public_verified_at is not null
      and a.sha256 ~ '^[0-9a-f]{64}

    if not found then
      return query select 'comic_unverified'::text, null::uuid, null::bigint, null::uuid, null::text;
      return;
    end if;

    v_expected_pages := v_expected_pages || jsonb_build_array(
      jsonb_build_object(
        'imageUrl', 'https://media.dnd.faysk.dev/' || v_asset.public_object_key,
        'altText', v_alt,
        'caption', v_caption
      )
    );
  end loop;

  if v_expected_pages <> p_public_comic_pages then
    return query select 'comic_unverified'::text, null::uuid, null::bigint, null::uuid, null::text;
    return;
  end if;

  -- The existing atomic CAS/receipt/audit publisher remains the authority.
  -- HQ binding happens in the SAME transaction, after its first commit.
  select r.status, r.publication_id, r.version,
         r.previous_publication_id, r.payload_sha256
  into v_result_status, v_result_publication, v_result_version,
       v_result_previous, v_base_hash
  from public.publish_session_editorial_with_date_atomic(
    p_actor_profile_id,
    p_campaign_slug,
    p_session_id,
    p_draft_id,
    p_expected_current_publication_id,
    p_operation_id,
    p_public_cover_url
  ) r;

  if v_result_status not in ('published','replay')
     or v_result_publication is null then
    return query select v_result_status, v_result_publication,
      v_result_version, v_result_previous, v_base_hash;
    return;
  end if;

  v_comic_hash := encode(
    extensions.digest(convert_to(v_expected_pages::text, 'UTF8'), 'sha256'),
    'hex'
  );

  if v_result_status = 'published' then
    update public.session_publications sp
    set comic_pages = v_expected_pages,
        comic_payload_sha256 = v_comic_hash
    where sp.id = v_result_publication
      and sp.session_id = p_session_id
      and sp.campaign_id = v_campaign_id
      and sp.draft_id = p_draft_id;

    if not found then
      raise exception 'HQ publication snapshot binding missing';
    end if;
  else
    select sp.comic_pages, sp.comic_payload_sha256
    into v_actual_pages, v_actual_hash
    from public.session_publications sp
    where sp.id = v_result_publication
      and sp.session_id = p_session_id
      and sp.campaign_id = v_campaign_id;

    if not found or v_actual_pages <> v_expected_pages
       or v_actual_hash is distinct from v_comic_hash then
      return query select 'operation_conflict'::text,
        null::uuid, null::bigint, null::uuid, null::text;
      return;
    end if;
  end if;

  return query select v_result_status, v_result_publication,
    v_result_version, v_result_previous, v_base_hash;
end;
$$;

revoke all on function public.publish_session_editorial_with_comic_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text, jsonb
) from public;
revoke execute on function public.publish_session_editorial_with_comic_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text, jsonb
) from anon, authenticated;
grant execute on function public.publish_session_editorial_with_comic_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text, jsonb
) to service_role;

comment on function public.publish_session_editorial_with_comic_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text, jsonb
) is 'Candidate server-only HQ publication wrapper. Verifies public media and writes HQ snapshot atomically with the editorial CAS publication.';

      and a.mime_type in ('image/png', 'image/webp')
      and a.byte_size > 0 and a.width > 0 and a.height > 0
      and a.object_key = a.public_object_key
      and a.object_key = v_expected_key_prefix || a.sha256 ||
        case when a.mime_type = 'image/png' then '.png' else '.webp' end
    for share of a;

    if not found then
      return query select 'comic_unverified'::text, null::uuid, null::bigint, null::uuid, null::text;
      return;
    end if;

    v_expected_pages := v_expected_pages || jsonb_build_array(
      jsonb_build_object(
        'imageUrl', 'https://media.dnd.faysk.dev/' || v_asset.public_object_key,
        'altText', v_alt,
        'caption', v_caption
      )
    );
  end loop;

  if v_expected_pages <> p_public_comic_pages then
    return query select 'comic_unverified'::text, null::uuid, null::bigint, null::uuid, null::text;
    return;
  end if;

  -- The existing atomic CAS/receipt/audit publisher remains the authority.
  -- HQ binding happens in the SAME transaction, after its first commit.
  select r.status, r.publication_id, r.version,
         r.previous_publication_id, r.payload_sha256
  into v_result_status, v_result_publication, v_result_version,
       v_result_previous, v_base_hash
  from public.publish_session_editorial_with_date_atomic(
    p_actor_profile_id,
    p_campaign_slug,
    p_session_id,
    p_draft_id,
    p_expected_current_publication_id,
    p_operation_id,
    p_public_cover_url
  ) r;

  if v_result_status not in ('published','replay')
     or v_result_publication is null then
    return query select v_result_status, v_result_publication,
      v_result_version, v_result_previous, v_base_hash;
    return;
  end if;

  v_comic_hash := encode(
    extensions.digest(convert_to(v_expected_pages::text, 'UTF8'), 'sha256'),
    'hex'
  );

  if v_result_status = 'published' then
    update public.session_publications sp
    set comic_pages = v_expected_pages,
        comic_payload_sha256 = v_comic_hash
    where sp.id = v_result_publication
      and sp.session_id = p_session_id
      and sp.campaign_id = v_campaign_id
      and sp.draft_id = p_draft_id;

    if not found then
      raise exception 'HQ publication snapshot binding missing';
    end if;
  else
    select sp.comic_pages, sp.comic_payload_sha256
    into v_actual_pages, v_actual_hash
    from public.session_publications sp
    where sp.id = v_result_publication
      and sp.session_id = p_session_id
      and sp.campaign_id = v_campaign_id;

    if not found or v_actual_pages <> v_expected_pages
       or v_actual_hash is distinct from v_comic_hash then
      return query select 'operation_conflict'::text,
        null::uuid, null::bigint, null::uuid, null::text;
      return;
    end if;
  end if;

  return query select v_result_status, v_result_publication,
    v_result_version, v_result_previous, v_base_hash;
end;
$$;

revoke all on function public.publish_session_editorial_with_comic_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text, jsonb
) from public;
revoke execute on function public.publish_session_editorial_with_comic_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text, jsonb
) from anon, authenticated;
grant execute on function public.publish_session_editorial_with_comic_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text, jsonb
) to service_role;

comment on function public.publish_session_editorial_with_comic_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text, jsonb
) is 'Candidate server-only HQ publication wrapper. Verifies public media and writes HQ snapshot atomically with the editorial CAS publication.';
