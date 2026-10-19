-- #1765: synthetic scratch-only coverage for all three HQ SQL candidates.
-- Loaded after the existing editorial publication/date contracts. No real data.
begin;
set local role service_role;

do $comic$
declare
  v_actor uuid := '33333333-3333-4333-8333-333333333333';
  v_session uuid := '22222222-2222-4222-8222-222222222222';
  v_campaign uuid := '11111111-1111-4111-8111-111111111111';
  v_transcript uuid := '44444444-4444-4444-8444-444444444444';
  v_cover uuid := '55555555-5555-4555-8555-555555555555';
  v_asset uuid := '77777777-7777-4777-8777-777777777777';
  v_operation uuid := '98000000-0000-4000-8000-000000000001';
  v_key text :=
    'campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/comic/'
    || repeat('b',64) || '.webp';
  v_cover_url text :=
    'https://media.dnd.faysk.dev/campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/'
    || repeat('a',64) || '.webp';
  v_page_url text := 'https://media.dnd.faysk.dev/' || v_key;
  v_draft_pages jsonb;
  v_public_pages jsonb;
  v_bad_pages jsonb;
  v_expected_revision bigint;
  v_current_publication uuid;
  v_expected_version bigint;
  v_before_publication_count bigint;
  v_draft_id uuid;
  v_pub_id uuid;
  v_prev uuid;
  v_status text;
  v_hash text;
  v_version bigint;
  v_rejected boolean := false;
begin
  if has_function_privilege(
    'anon',
    'public.publish_session_editorial_with_comic_atomic(uuid,text,uuid,uuid,uuid,uuid,text,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.save_session_editorial_draft_with_comic_atomic(uuid,text,uuid,bigint,uuid,text,text,text,text,text,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'HQ_RPC_EXPOSED_TO_BROWSER';
  end if;

  insert into public.media_assets (
    id, campaign_id, media_kind, role_hint, status, staged_bucket,
    object_key, sha256, mime_type, byte_size, width, height,
    read_back_verified, created_by
  ) values (
    v_asset, v_campaign, 'image', 'session_comic_page', 'staged',
    'tda-media-private', v_key, repeat('b',64), 'image/webp',
    2048, 900, 1300, true, v_actor
  );

  v_draft_pages := jsonb_build_array(jsonb_build_object(
    'assetId', v_asset::text, 'altText', 'Duas esferas no céu', 'caption', ''
  ));
  v_public_pages := jsonb_build_array(jsonb_build_object(
    'imageUrl', v_page_url, 'altText', 'Duas esferas no céu', 'caption', ''
  ));

  select coalesce(d.revision, 0)
  into v_expected_revision
  from public.sessions s
  left join public.session_editorial_drafts d on d.id=s.current_editorial_draft_id
  where s.id=v_session;

  if v_expected_revision is null then v_expected_revision := 0; end if;
  select s.current_session_publication_id
  into v_current_publication
  from public.sessions s where s.id=v_session;
  select coalesce(max(sp.version), 0) + 1
  into v_expected_version
  from public.session_publications sp where sp.session_id=v_session;
  select count(*) into v_before_publication_count
  from public.session_publications where session_id=v_session;

  v_bad_pages := jsonb_build_array(jsonb_build_object(
    'assetId', v_cover::text, 'altText', 'Tentativa de usar uma capa', 'caption', ''
  ));
  begin
    perform 1
    from public.save_session_editorial_draft_with_comic_atomic(
      v_actor,'synthetic-campaign',v_session,v_expected_revision,v_transcript,
      v_cover::text,'Arco ilustrado','Capítulo da HQ','Resumo curto válido',
      '# História ilustrada','2026-09-01',v_bad_pages
    );
  exception when sqlstate '22023' then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'HQ_COVER_ROLE_ACCEPTED_AS_PAGE'; end if;

  select d.status,d.draft_id,d.revision
  into v_status,v_draft_id,v_version
  from public.save_session_editorial_draft_with_comic_atomic(
    v_actor,'synthetic-campaign',v_session,v_expected_revision,v_transcript,
    v_cover::text,'Arco ilustrado','Capítulo da HQ','Resumo curto válido',
    '# História ilustrada','2026-09-01',v_draft_pages
  ) d;

  if v_status <> 'updated' or v_draft_id is null
     or not exists (
       select 1 from public.session_editorial_drafts d
       where d.id=v_draft_id and d.comic_pages=v_draft_pages
     ) then
    raise exception 'HQ_DRAFT_SNAPSHOT_NOT_ATOMIC:%',v_status;
  end if;

  select p.status
  into v_status
  from public.publish_session_editorial_with_comic_atomic(
    v_actor,'synthetic-campaign',v_session,v_draft_id,v_current_publication,v_operation,
    v_cover_url,v_public_pages
  ) p;
  if v_status <> 'comic_unverified'
     or exists(select 1 from public.session_publication_operations where operation_id=v_operation) then
    raise exception 'HQ_UNPROMOTED_PAGE_WAS_PUBLISHED:%',v_status;
  end if;

  update public.media_assets
  set status='verified_public',
      public_bucket='tda-media-public',
      public_object_key=v_key,
      public_delivery_verified=true,
      public_verified_at=clock_timestamp()
  where id=v_asset;

  v_bad_pages := jsonb_build_array(jsonb_build_object(
    'imageUrl','https://media.dnd.faysk.dev/campaigns/other/sessions/'
      || v_session || '/comic/' || repeat('b',64) || '.webp',
    'altText','Duas esferas no céu','caption',''
  ));
  select p.status into v_status
  from public.publish_session_editorial_with_comic_atomic(
    v_actor,'synthetic-campaign',v_session,v_draft_id,v_current_publication,v_operation,
    v_cover_url,v_bad_pages
  ) p;
  if v_status <> 'comic_unverified' then
    raise exception 'HQ_CROSSED_CAMPAIGN_PAGE_ACCEPTED:%',v_status;
  end if;

  select p.status,p.publication_id,p.version,p.previous_publication_id,p.payload_sha256
  into v_status,v_pub_id,v_version,v_prev,v_hash
  from public.publish_session_editorial_with_comic_atomic(
    v_actor,'synthetic-campaign',v_session,v_draft_id,v_current_publication,v_operation,
    v_cover_url,v_public_pages
  ) p;

  if v_status <> 'published' or v_pub_id is null or v_version <> v_expected_version
     or v_prev is distinct from v_current_publication
     or (select s.current_session_publication_id from public.sessions s
         where s.id=v_session) <> v_pub_id
     or not exists(
       select 1 from public.session_publications sp
       where sp.id=v_pub_id and sp.comic_pages=v_public_pages
         and sp.comic_payload_sha256 ~ '^[0-9a-f]{64}$'
     ) then
    raise exception 'HQ_PUBLICATION_SNAPSHOT_INCONSISTENT:%',v_status;
  end if;

  select p.status,p.publication_id,p.payload_sha256
  into v_status,v_prev,v_hash
  from public.publish_session_editorial_with_comic_atomic(
    v_actor,'synthetic-campaign',v_session,v_draft_id,v_current_publication,v_operation,
    v_cover_url,v_public_pages
  ) p;
  if v_status <> 'replay' or v_prev <> v_pub_id
     or (select count(*) from public.session_publications where session_id=v_session) <> v_before_publication_count + 1 then
    raise exception 'HQ_PUBLICATION_IDEMPOTENCY_BROKEN:%',v_status;
  end if;

  if has_column_privilege('anon','public.session_publications','comic_pages','SELECT')
     or has_column_privilege('authenticated','public.session_editorial_drafts','comic_pages','SELECT')
     or not has_column_privilege('service_role','public.session_publications','comic_pages','UPDATE') then
    raise exception 'HQ_PUBLICATION_ACL_BROKEN';
  end if;
end;
$comic$;

rollback;
