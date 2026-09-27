-- Extend the governed image-media foundation for private session covers (#792).

alter table public.media_assets
  drop constraint if exists media_assets_role_hint_check;
alter table public.media_assets
  add constraint media_assets_role_hint_check
  check (role_hint in ('portrait', 'artwork', 'gallery', 'session_cover'));

alter table public.media_assets
  drop constraint if exists media_assets_object_key_check;
alter table public.media_assets
  add constraint media_assets_object_key_check
  check (
    object_key ~ '^campaigns/[a-z0-9][a-z0-9-]{0,95}/(entities/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/(portrait|artwork|gallery)|sessions/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/cover)/[0-9a-f]{64}[.](png|webp)$'
  );

comment on constraint media_assets_role_hint_check on public.media_assets
is 'Governed image roles include world media and private session-cover staging.';

comment on constraint media_assets_object_key_check on public.media_assets
is 'Canonical immutable keys are scoped to the campaign and owning entity/session.';
