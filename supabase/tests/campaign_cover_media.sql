\set ON_ERROR_STOP on

-- Synthetic-only contract for #1135 campaign-owned cover bindings.
-- Executed by tools/world-entity-media-db.py inside disposable PostgreSQL 16.
-- No remote database, R2 bucket or private content is contacted.

do $$
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'campaign_media_bindings'
      and c.relrowsecurity
  ) then
    raise exception 'campaign media bindings must exist with RLS enabled';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'campaign_media_bindings'
  ) then
    raise exception 'campaign media bindings must remain deny-by-default for browser roles';
  end if;

  if has_table_privilege('anon', 'public.campaign_media_bindings', 'SELECT')
     or has_table_privilege('authenticated', 'public.campaign_media_bindings', 'SELECT')
     or has_table_privilege('anon', 'public.campaign_media_bindings', 'INSERT')
     or has_table_privilege('authenticated', 'public.campaign_media_bindings', 'INSERT') then
    raise exception 'browser roles must not access campaign media bindings directly';
  end if;

  if not has_table_privilege('service_role', 'public.campaign_media_bindings', 'SELECT')
     or not has_table_privilege('service_role', 'public.campaign_media_bindings', 'INSERT')
     or not has_table_privilege('service_role', 'public.campaign_media_bindings', 'UPDATE')
     or not has_table_privilege('service_role', 'public.campaign_media_bindings', 'DELETE') then
    raise exception 'service role must own the server-side campaign media binding path';
  end if;
end;
$$;

reset role;
delete from public.campaign_media_bindings;
delete from public.media_assets;

insert into public.campaigns(id, slug)
values ('52525252-5252-4525-8525-525252525252', 'other-media-campaign');

-- Same bytes/hash in A and B are legal because storage identity is scoped by the
-- immutable technical campaign key, not by public name/route.
insert into public.media_assets(
  id, campaign_id, media_kind, role_hint, status, staged_bucket, object_key,
  sha256, mime_type, byte_size, width, height, read_back_verified
) values
(
  '53535353-5353-4535-8535-535353535353',
  '11111111-1111-4111-8111-111111111111',
  'image',
  'campaign_cover',
  'staged',
  'tda-media-preview',
  'campaigns/synthetic-campaign/campaign/cover/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.webp',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'image/webp',
  1024,
  512,
  512,
  true
),
(
  '54545454-5454-4545-8545-545454545454',
  '52525252-5252-4525-8525-525252525252',
  'image',
  'campaign_cover',
  'staged',
  'tda-media-preview',
  'campaigns/other-media-campaign/campaign/cover/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.webp',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'image/webp',
  1024,
  512,
  512,
  true
);

-- Campaign A must never bind Campaign B's asset even when role/hash/filename are
-- otherwise identical. The composite FK is the database-level isolation gate.
do $$
begin
  begin
    insert into public.campaign_media_bindings(
      campaign_id, role, asset_id
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'cover',
      '54545454-5454-4545-8545-545454545454'
    );
    raise exception 'cross-campaign cover binding unexpectedly succeeded';
  exception when foreign_key_violation then
    null;
  end;
end;
$$;

insert into public.campaign_media_bindings(campaign_id, role, asset_id)
values
(
  '11111111-1111-4111-8111-111111111111',
  'cover',
  '53535353-5353-4535-8535-535353535353'
),
(
  '52525252-5252-4525-8525-525252525252',
  'cover',
  '54545454-5454-4545-8545-545454545454'
);

do $$
begin
  if (select count(*) from public.campaign_media_bindings) <> 2 then
    raise exception 'expected one independent cover binding per campaign';
  end if;

  if exists (
    select 1
    from public.campaign_media_bindings b
    join public.media_assets a on a.id = b.asset_id
    where b.campaign_id <> a.campaign_id
  ) then
    raise exception 'campaign media binding leaked across campaign ownership';
  end if;

  if not exists (
    select 1 from public.media_assets
    where campaign_id = '11111111-1111-4111-8111-111111111111'
      and object_key like 'campaigns/synthetic-campaign/campaign/cover/%'
      and sha256 = repeat('c', 64)
  ) or not exists (
    select 1 from public.media_assets
    where campaign_id = '52525252-5252-4525-8525-525252525252'
      and object_key like 'campaigns/other-media-campaign/campaign/cover/%'
      and sha256 = repeat('c', 64)
  ) then
    raise exception 'same-hash A/B storage namespaces were not preserved';
  end if;
end;
$$;

-- Rollback/replacement is a pointer operation: removing Campaign A's cover
-- binding must leave its immutable media asset available for audit/rebind.
delete from public.campaign_media_bindings
where campaign_id = '11111111-1111-4111-8111-111111111111'
  and role = 'cover';

do $$
begin
  if exists (
    select 1 from public.campaign_media_bindings
    where campaign_id = '11111111-1111-4111-8111-111111111111'
      and role = 'cover'
  ) then
    raise exception 'campaign cover rollback must remove only the semantic binding';
  end if;

  if not exists (
    select 1 from public.media_assets
    where id = '53535353-5353-4535-8535-535353535353'
      and campaign_id = '11111111-1111-4111-8111-111111111111'
  ) then
    raise exception 'campaign cover rollback unexpectedly deleted the immutable asset';
  end if;
end;
$$;

delete from public.campaign_media_bindings;
delete from public.media_assets;
delete from public.campaigns
where id = '52525252-5252-4525-8525-525252525252';

select 'CAMPAIGN_COVER_MEDIA_DATABASE_OK synthetic=true rls=true cross_campaign_binding=true same_hash_namespaces=true pointer_rollback=true';
