-- Lembra shared visual reference library.
-- Product rule: every authenticated TDA user shares the same library and can
-- create/edit/retire references. Browser roles never access these tables
-- directly; authentication is enforced by the server boundary.

create table public.lembra_references (
  id uuid primary key default gen_random_uuid(),
  title text not null
    check (char_length(btrim(title)) between 1 and 120),
  description text not null default ''
    check (char_length(description) <= 320),
  status text not null default 'active'
    check (status in ('active', 'retired')),
  staged_bucket text not null
    check (staged_bucket in ('tda-media-preview', 'tda-media-private')),
  object_key text not null,
  sha256 text not null
    check (sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null
    check (byte_size between 24 and 12582912),
  width integer not null
    check (width between 1 and 20000),
  height integer not null
    check (height between 1 and 20000),
  read_back_verified boolean not null default false,
  created_by_auth_user_id uuid not null,
  created_by_name text not null
    check (char_length(btrim(created_by_name)) between 1 and 120),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  unique (staged_bucket, object_key),
  check (
    object_key =
      'lembra/' || lower(id::text) || '/' || sha256 ||
      case mime_type
        when 'image/jpeg' then '.jpg'
        when 'image/png' then '.png'
        when 'image/webp' then '.webp'
      end
  ),
  check (status <> 'active' or read_back_verified),
  check (
    (status = 'active' and retired_at is null) or
    (status = 'retired' and retired_at is not null)
  )
);

create index lembra_references_active_created_idx
  on public.lembra_references(created_at desc, id desc)
  where status = 'active';

create index lembra_references_active_author_idx
  on public.lembra_references(created_by_auth_user_id, created_at desc)
  where status = 'active';

create table public.lembra_favorites (
  auth_user_id uuid not null,
  reference_id uuid not null
    references public.lembra_references(id)
    on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  primary key (auth_user_id, reference_id)
);

create index lembra_favorites_reference_idx
  on public.lembra_favorites(reference_id);

alter table public.lembra_references enable row level security;
alter table public.lembra_favorites enable row level security;

revoke all on public.lembra_references from public, anon, authenticated, service_role;
revoke all on public.lembra_favorites from public, anon, authenticated, service_role;

grant select, insert, update, delete on public.lembra_references to service_role;
grant select, insert, update, delete on public.lembra_favorites to service_role;

comment on table public.lembra_references is
  'Shared authenticated-only visual reference library. Binary bytes live in private Media Storage.';
comment on table public.lembra_favorites is
  'Per-auth-user visual preference over the globally shared Lembra library.';
comment on column public.lembra_references.created_by_auth_user_id is
  'Verified Supabase Auth user id captured server-side for attribution and Meus itens filtering.';
comment on column public.lembra_references.created_by_name is
  'Server-derived display-name snapshot used for attribution and search; never accepted from the browser.';
