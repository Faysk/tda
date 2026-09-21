-- Lembra shared visual reference library foundation.
-- Bytes remain in Media Storage (current provider: Cloudflare R2).
-- PostgreSQL owns campaign scope, verified media metadata and authorship.
-- Browser roles receive no direct table grants.

insert into public.permission_catalog(action, plane, description)
values (
  'campaign.references.write',
  'narrative',
  'Add and manage shared visual references in the campaign Lembra library.'
)
on conflict (action) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.permission_catalog pc
    where pc.action = 'campaign.references.write'
      and pc.plane = 'narrative'
  ) then
    raise exception 'campaign.references.write exists with an incompatible plane or could not be defined';
  end if;
end;
$$;

-- Lembra is intentionally collaborative: campaign players, DMs and owners may
-- contribute. Read access continues to use campaign.read; callers with the write
-- capability may also read their collaboration surface through the server
-- boundary even when their role model does not separately carry campaign.read.
do $$
declare
  v_role record;
begin
  for v_role in
    select rd.id, rd.slug
    from public.role_definitions rd
    where rd.slug in ('player', 'campaign_dm', 'campaign_owner')
  loop
    insert into public.role_permissions(role_id, permission_action)
    values (v_role.id, 'campaign.references.write')
    on conflict (role_id, permission_action) do nothing;
  end loop;

  if (
    select count(*)
    from public.role_definitions rd
    where rd.slug in ('player', 'campaign_dm', 'campaign_owner')
  ) <> 3 then
    raise exception 'Expected Lembra contributor roles are missing';
  end if;
end;
$$;

do $
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.campaigns'::regclass
      and conname = 'campaigns_id_slug_unique'
  ) then
    alter table public.campaigns
      add constraint campaigns_id_slug_unique unique (id, slug);
  end if;
end;
$;

create table public.lembra_references (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null,
  campaign_slug text not null
    check (campaign_slug ~ '^[a-z0-9][a-z0-9-]{0,95}
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
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (campaign_id, staged_bucket, object_key),
  check (
    object_key =
      'campaigns/' || campaign_slug || '/lembra/' || lower(id::text) || '/' ||
      sha256 ||
      case mime_type
        when 'image/jpeg' then '.jpg'
        when 'image/png' then '.png'
        when 'image/webp' then '.webp'
      end
  ),
  check (status <> 'active' or read_back_verified)
);

create index lembra_references_campaign_created_idx
  on public.lembra_references(campaign_id, created_at desc, id desc)
  where status = 'active';

create index lembra_references_campaign_author_idx
  on public.lembra_references(campaign_id, created_by, created_at desc)
  where status = 'active';

alter table public.lembra_references enable row level security;

revoke all on public.lembra_references from public, anon, authenticated, service_role;
grant select, insert, update on public.lembra_references to service_role;

comment on table public.lembra_references is
  'Campaign-scoped shared visual references. Binary bytes live in Media Storage; browser roles have no direct table access.';

comment on column public.lembra_references.created_by is
  'Server-resolved TDA profile identity. Never accepted as free-form browser authorship.';
),
  constraint lembra_references_campaign_fkey
    foreign key (campaign_id, campaign_slug)
    references public.campaigns(id, slug)
    on delete cascade,
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
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (campaign_id, staged_bucket, object_key),
  check (
    object_key ~ '^campaigns/[a-z0-9][a-z0-9-]{0,95}/lembra/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{64}[.](jpg|png|webp)$'
  ),
  check (status <> 'active' or read_back_verified)
);

create index lembra_references_campaign_created_idx
  on public.lembra_references(campaign_id, created_at desc, id desc)
  where status = 'active';

create index lembra_references_campaign_author_idx
  on public.lembra_references(campaign_id, created_by, created_at desc)
  where status = 'active';

alter table public.lembra_references enable row level security;

revoke all on public.lembra_references from public, anon, authenticated, service_role;
grant select, insert, update on public.lembra_references to service_role;

comment on table public.lembra_references is
  'Campaign-scoped shared visual references. Binary bytes live in Media Storage; browser roles have no direct table access.';

comment on column public.lembra_references.created_by is
  'Server-resolved TDA profile identity. Never accepted as free-form browser authorship.';
