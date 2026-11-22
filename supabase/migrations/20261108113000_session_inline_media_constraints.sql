-- #1796: Inline illustrations share the governed session media pipeline.
-- Add only a distinct role + immutable /inline key. Do not change cover/HQ constraints.
alter table public.media_assets
  drop constraint if exists media_assets_role_hint_check;
alter table public.media_assets
  add constraint media_assets_role_hint_check
  check (role_hint in ('portrait', 'artwork', 'gallery', 'session_cover', 'campaign_cover', 'session_comic_page', 'session_inline_image'));

alter table public.media_assets
  drop constraint if exists media_assets_object_key_check;
alter table public.media_assets
  add constraint media_assets_object_key_check
  check (
    object_key ~ '^campaigns/[a-z0-9][a-z0-9-]{0,95}/(entities/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/(portrait|artwork|gallery)|sessions/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/(cover|comic|inline)|campaign/cover)/[0-9a-f]{64}[.](png|webp)$'
  );
comment on constraint media_assets_role_hint_check on public.media_assets is
'Governed image roles include world, cover, HQ, and inline session illustrations.';
comment on constraint media_assets_object_key_check on public.media_assets is
'Immutable image objects are scoped to campaign and entity/session.';
