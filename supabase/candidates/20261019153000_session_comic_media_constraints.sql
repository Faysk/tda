-- #1765: CANDIDATE ONLY. Do not apply before HQ editor + publish snapshot
-- contracts have been reviewed and the production migration is sequenced.
-- This patch extends the existing governable image-media constraints, retaining
-- the campaign/entity/session boundaries and all original roles.
--
-- The authoritative predecessor is
-- 20261001024500_campaign_cover_media_scope.sql. Keep campaign_cover and
-- campaign/cover keys to preserve existing campaign-owned images.

alter table public.media_assets
  drop constraint if exists media_assets_role_hint_check;
alter table public.media_assets
  add constraint media_assets_role_hint_check
  check (role_hint in ('portrait', 'artwork', 'gallery', 'session_cover', 'campaign_cover', 'session_comic_page'));

alter table public.media_assets
  drop constraint if exists media_assets_object_key_check;
alter table public.media_assets
  add constraint media_assets_object_key_check
  check (
    object_key ~ '^campaigns/[a-z0-9][a-z0-9-]{0,95}/(entities/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/(portrait|artwork|gallery)|sessions/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/(cover|comic)|campaign/cover)/[0-9a-f]{64}[.](png|webp)$'
  );

comment on constraint media_assets_role_hint_check on public.media_assets
is 'Governed images: world entity artwork, session covers, campaign covers and session comic pages.';

comment on constraint media_assets_object_key_check on public.media_assets
is 'Immutable media objects remain scoped to campaign plus owning entity/session or campaign cover.';
