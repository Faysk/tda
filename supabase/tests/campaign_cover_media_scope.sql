\set ON_ERROR_STOP on

-- Synthetic-only #1135 contract. Runs in tools/world-entity-media-db.py against
-- a fresh Unix-socket PostgreSQL cluster; never connects to Production.
do $tda_campaign_cover_security$
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'campaign_media_bindings'
      and c.relrowsecurity
  ) then
    raise exception 'campaign_media_bindings must have RLS enabled';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'campaign_media_bindings'
  ) then
    raise exception 'campaign_media_bindings must remain deny-by-default for browser roles';
  end if;

  if has_table_privilege('anon', 'public.campaign_media_bindings', 'SELECT')
     or has_table_privilege('authenticated', 'public.campaign_media_bindings', 'SELECT')
     or has_table_privilege('anon', 'public.campaign_media_bindings', 'INSERT')
     or has_table_privilege('authenticated', 'public.campaign_media_bindings', 'INSERT') then
    raise exception 'browser roles must not read/write campaign cover bindings directly';
  end if;

  if not has_table_privilege('service_role', 'public.campaign_media_bindings', 'SELECT')
     or not has_table_privilege('service_role', 'public.campaign_media_bindings', 'INSERT')
     or not has_table_privilege('service_role', 'public.campaign_media_bindings', 'UPDATE')
     or not has_table_privilege('service_role', 'public.campaign_media_bindings', 'DELETE') then
    raise exception 'service role must own the server-only campaign cover boundary';
  end if;
end
$tda_campaign_cover_security$;

reset role;
delete from public.campaign_media_bindings;
delete from public.media_assets;

insert into public.campaigns(id, slug)
values ('52525252-5252-4525-8525-525252525252', 'campaign-b');

insert into public.media_assets(
  id, campaign_id, media_kind, role_hint, status, staged_bucket, object_key,
  sha256, mime_type, byte_size, width, height, read_back_verified,
  public_bucket, public_object_key, public_delivery_verified, public_verified_at
) values
(
  '61616161-6161-4616-8616-616161616161',
  '11111111-1111-4111-8111-111111111111',
  'image',
  'campaign_cover',
  'verified_public',
  'tda-media-preview',
  'campaigns/synthetic-campaign/campaign/cover/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'image/webp',
  1024,
  1600,
  900,
  true,
  'tda-media-public',
  'campaigns/synthetic-campaign/campaign/cover/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp',
  true,
  clock_timestamp()
),
(
  '62626262-6262-4626-8626-626262626262',
  '52525252-5252-4525-8525-525252525252',
  'image',
  'campaign_cover',
  'verified_public',
  'tda-media-preview',
  'campaigns/campaign-b/campaign/cover/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'image/webp',
  1024,
  1600,
  900,
  true,
  'tda-media-public',
  'campaigns/campaign-b/campaign/cover/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp',
  true,
  clock_timestamp()
);

insert into public.campaign_media_bindings(campaign_id, role, asset_id)
values (
  '11111111-1111-4111-8111-111111111111',
  'cover',
  '61616161-6161-4616-8616-616161616161'
);

do $tda_campaign_cover_scope$
begin
  begin
    insert into public.campaign_media_bindings(campaign_id, role, asset_id)
    values (
      '11111111-1111-4111-8111-111111111111',
      'cover',
      '62626262-6262-4626-8626-626262626262'
    )
    on conflict (campaign_id, role)
    do update set asset_id = excluded.asset_id;

    raise exception 'cross-campaign campaign-cover binding unexpectedly succeeded';
  exception when foreign_key_violation then
    null;
  end;

  if not exists (
    select 1
    from public.campaign_media_bindings
    where campaign_id = '11111111-1111-4111-8111-111111111111'
      and role = 'cover'
      and asset_id = '61616161-6161-4616-8616-616161616161'
  ) then
    raise exception 'failed cross-campaign write changed the valid campaign A binding';
  end if;

  if (
    select object_key from public.media_assets
    where id = '61616161-6161-4616-8616-616161616161'
  ) = (
    select object_key from public.media_assets
    where id = '62626262-6262-4626-8626-626262626262'
  ) then
    raise exception 'same hash in campaign A/B must not collide in storage identity';
  end if;
end
$tda_campaign_cover_scope$;

delete from public.campaign_media_bindings;
delete from public.media_assets;
delete from public.campaigns
where id = '52525252-5252-4525-8525-525252525252';

select 'CAMPAIGN_COVER_MEDIA_DATABASE_OK rls=true browser_denied=true campaign_fk=true same_hash_isolated=true rollback_pointer_only=true';
