-- Generalize governed image media for campaign-owned cover/card assets (#1135).
-- Additive only: existing media rows and the legacy campaigns/yuhara-main namespace
-- remain untouched. Rebinding a campaign never deletes immutable R2 objects.

alter table public.media_assets
  drop constraint if exists media_assets_role_hint_check;
alter table public.media_assets
  add constraint media_assets_role_hint_check
  check (
    role_hint in (
      'portrait',
      'artwork',
      'gallery',
      'session_cover',
      'campaign_cover'
    )
  );

alter table public.media_assets
  drop constraint if exists media_assets_object_key_check;
alter table public.media_assets
  add constraint media_assets_object_key_check
  check (
    object_key ~
      '^campaigns/[a-z0-9][a-z0-9-]{0,95}/(entities/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/(portrait|artwork|gallery)|sessions/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/cover|campaign/cover)/[0-9a-f]{64}[.](png|webp)$'
  );

create table public.campaign_media_bindings (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  role text not null default 'cover' check (role = 'cover'),
  asset_id uuid not null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (campaign_id, role),
  foreign key (campaign_id, asset_id)
    references public.media_assets(campaign_id, id) on delete restrict
);

create index campaign_media_bindings_asset_idx
  on public.campaign_media_bindings(campaign_id, asset_id);

alter table public.campaign_media_bindings enable row level security;
revoke all on public.campaign_media_bindings
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.campaign_media_bindings
  to service_role;

comment on table public.campaign_media_bindings is
  'Campaign-owned semantic media bindings. Rebinding changes the pointer only; immutable R2 objects are not deleted.';
comment on constraint media_assets_role_hint_check on public.media_assets is
  'Governed image roles include World media, session covers and campaign cover/card media.';
comment on constraint media_assets_object_key_check on public.media_assets is
  'Canonical immutable keys are scoped by stable technical campaign media key and owning resource.';
