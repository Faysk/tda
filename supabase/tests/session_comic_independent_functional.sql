begin;
set local role service_role;

do $test$
declare
  actor_id uuid := '33333333-3333-4333-8333-333333333333';
  session_id uuid := '22222222-2222-4222-8222-222222222222';
  campaign_id uuid := '11111111-1111-4111-8111-111111111111';
  asset_id uuid := '77777777-7777-4777-8777-777777777778';
  operation_id uuid := '98000000-0000-4000-8000-000000000002';
  object_key text;
  editorial_id uuid;
  editorial_before jsonb;
  editorial_after jsonb;
  draft_pages jsonb;
  public_pages jsonb;
  result_status text;
  result_revision bigint;
  comic_id uuid;
  published_version bigint;
begin
  select s.current_session_publication_id
  into editorial_id
  from public.sessions s
  where s.id = session_id;

  if editorial_id is null then
    raise exception 'HQ_TEST_NO_EDITORIAL_PUBLICATION';
  end if;

  select to_jsonb(sp)
  into editorial_before
  from public.session_publications sp
  where sp.id = editorial_id;

  object_key :=
    'campaigns/synthetic-campaign/sessions/' ||
    session_id::text || '/comic/' ||
    repeat('e',64) || '.webp';

  insert into public.media_assets (
    id, campaign_id, media_kind, role_hint, status,
    staged_bucket, object_key, sha256, mime_type,
    byte_size, width, height, read_back_verified,
    public_bucket, public_object_key,
    public_delivery_verified, public_verified_at, created_by
  ) values (
    asset_id, campaign_id, 'image', 'session_comic_page',
    'verified_public', 'tda-media-private', object_key,
    repeat('e',64), 'image/webp', 2048, 900, 1300, true,
    'tda-media-public', object_key, true, clock_timestamp(), actor_id
  );

  draft_pages := jsonb_build_array(jsonb_build_object(
    'assetId', asset_id::text,
    'altText', 'Página sintética da HQ',
    'caption', ''
  ));

  public_pages := jsonb_build_array(jsonb_build_object(
    'imageUrl', 'https://media.dnd.faysk.dev/' || object_key,
    'altText', 'Página sintética da HQ',
    'caption', '',
    'width', 900,
    'height', 1300
  ));

  select d.status, d.revision
  into result_status, result_revision
  from public.save_session_comic_draft_atomic(
    actor_id, 'synthetic-campaign', session_id, 0, draft_pages
  ) d;

  if result_status <> 'updated' or result_revision <> 1 then
    raise exception 'HQ_DRAFT_FAILED: %, %',
      result_status, result_revision;
  end if;

  select d.status
  into result_status
  from public.save_session_comic_draft_atomic(
    actor_id, 'synthetic-campaign', session_id, 0, draft_pages
  ) d;

  if result_status <> 'conflict' then
    raise exception 'HQ_DRAFT_CONFLICT_NOT_ENFORCED: %', result_status;
  end if;

  select p.status, p.publication_id, p.version
  into result_status, comic_id, published_version
  from public.publish_session_comic_atomic(
    actor_id, 'synthetic-campaign', session_id,
    editorial_id, null, 1, operation_id, public_pages
  ) p;

  if result_status <> 'published'
     or comic_id is null or published_version <> 1 then
    raise exception 'HQ_PUBLICATION_FAILED: %, %',
      result_status, published_version;
  end if;

  select p.status
  into result_status
  from public.publish_session_comic_atomic(
    actor_id, 'synthetic-campaign', session_id,
    editorial_id, null, 1, operation_id, public_pages
  ) p;

  if result_status <> 'replay' then
    raise exception 'HQ_IDEMPOTENCY_FAILED: %', result_status;
  end if;

  if (select count(*) from public.session_comic_publications
      where public.session_comic_publications.session_id = '22222222-2222-4222-8222-222222222222'::uuid) <> 1 then
    raise exception 'HQ_DUPLICATE_PUBLICATION';
  end if;

  select to_jsonb(sp)
  into editorial_after
  from public.session_publications sp
  where sp.id = editorial_id;

  if editorial_after is distinct from editorial_before then
    raise exception 'HQ_EDITORIAL_PUBLICATION_CHANGED';
  end if;

  if (select s.current_session_publication_id
      from public.sessions s
      where s.id = session_id) is distinct from editorial_id then
    raise exception 'HQ_EDITORIAL_POINTER_CHANGED';
  end if;

  if has_function_privilege(
    'anon',
    'public.publish_session_comic_atomic(uuid,text,uuid,uuid,uuid,bigint,uuid,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'HQ_PUBLIC_RPC_EXPOSED';
  end if;

  -- Reutilizar a operação com outro conteúdo deve falhar.
  select p.status into result_status
  from public.publish_session_comic_atomic(
    actor_id, 'synthetic-campaign', session_id,
    editorial_id, null, 1, operation_id, jsonb_build_array(jsonb_build_object('imageUrl', 'https://example.com/different.webp'))
  ) p;

  if result_status <> 'operation_conflict' then
    raise exception 'HQ_OPERATION_CONFLICT_NOT_ENFORCED: %', result_status;
  end if;

  -- Uma nova publicação não pode ignorar a HQ atual.
  select p.status into result_status
  from public.publish_session_comic_atomic(
    actor_id, 'synthetic-campaign', session_id,
    editorial_id, null, 1,
    '98000000-0000-4000-8000-000000000003'::uuid,
    public_pages
  ) p;

  if result_status <> 'stale_current' then
    raise exception 'HQ_STALE_PUBLICATION_ACCEPTED: %', result_status;
  end if;

  -- Uma campanha incorreta não pode publicar a sessão.
  select p.status into result_status
  from public.publish_session_comic_atomic(
    actor_id, 'wrong-campaign', session_id,
    editorial_id, comic_id, 1,
    '98000000-0000-4000-8000-000000000004'::uuid,
    public_pages
  ) p;

  if result_status <> 'not_found' then
    raise exception 'HQ_CROSS_CAMPAIGN_ACCEPTED: %', result_status;
  end if;

  -- Uma imagem que perdeu a verificação pública deve bloquear a publicação.
  update public.media_assets
  set status = 'staged'
  where id = asset_id;

  select p.status into result_status
  from public.publish_session_comic_atomic(
    actor_id, 'synthetic-campaign', session_id,
    editorial_id, comic_id, 1,
    '98000000-0000-4000-8000-000000000005'::uuid,
    public_pages
  ) p;

  if result_status <> 'comic_unverified' then
    raise exception 'HQ_UNVERIFIED_IMAGE_ACCEPTED: %', result_status;
  end if;

  if (select count(*)
      from public.session_comic_publications cp
      where cp.session_id = '22222222-2222-4222-8222-222222222222'::uuid) <> 1 then
    raise exception 'HQ_REJECTED_OPERATION_CREATED_PUBLICATION';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.publish_session_comic_atomic(uuid,text,uuid,uuid,uuid,bigint,uuid,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'HQ_AUTHENTICATED_RPC_EXPOSED';
  end if;

  raise notice 'HQ_INDEPENDENT_FUNCTIONAL_OK';
end;
$test$;

rollback;