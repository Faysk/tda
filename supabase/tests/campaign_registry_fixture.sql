-- Synthetic-only pre-#1123 schema. Never a dump or Production seed.
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.campaigns(
  id uuid primary key,
  name text not null,
  slug text not null unique,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.profiles(
  id uuid primary key,
  display_name text not null
);

create table public.sessions(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  title text not null,
  status text not null default 'planned',
  source_system text,
  source_session_id text,
  unique(campaign_id, source_system, source_session_id)
);

create table public.entities(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  name text not null,
  slug text,
  entity_type text not null,
  unique(campaign_id, name)
);
create unique index entities_campaign_slug_unique
  on public.entities(campaign_id, slug)
  where slug is not null;

create table public.profile_characters(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  entity_id uuid references public.entities(id) on delete restrict,
  character_name text not null
);

create table public.participants(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete restrict,
  profile_id uuid references public.profiles(id) on delete restrict,
  character_entity_id uuid references public.entities(id) on delete restrict,
  character_name text
);

create table public.canon_entries(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  entity_id uuid references public.entities(id) on delete restrict,
  title text not null,
  content text not null
);

create table public.role_definitions(
  id uuid primary key,
  slug text not null unique
);

create table public.role_assignments(
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  role_id uuid not null references public.role_definitions(id),
  scope_type text not null,
  scope_id text not null,
  status text not null default 'active'
);

alter table public.campaigns enable row level security;
alter table public.sessions enable row level security;
alter table public.entities enable row level security;
alter table public.profile_characters enable row level security;
alter table public.participants enable row level security;
alter table public.canon_entries enable row level security;
alter table public.role_assignments enable row level security;

grant usage on schema public, extensions to service_role, anon, authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;

insert into public.campaigns(
  id, name, slug, description, metadata
) values (
  '11111111-1111-4111-8111-111111111111',
  'Yuhara',
  'yuhara-main',
  'Legacy campaign before #1123.',
  '{"legacy":true}'::jsonb
);

insert into public.profiles(id, display_name)
values ('33333333-3333-4333-8333-333333333333', 'Editor synthetic');

insert into public.role_definitions(id, slug)
values ('55555555-5555-4555-8555-555555555555', 'site_editor');

insert into public.role_assignments(
  profile_id, role_id, scope_type, scope_id, status
) values (
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  'campaign',
  'yuhara-main',
  'active'
);

insert into public.sessions(
  id, campaign_id, title, status, source_system, source_session_id
) values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Legacy session',
  'published',
  'local_companion',
  'shared-source'
);

insert into public.entities(
  id, campaign_id, name, slug, entity_type
) values (
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  'D synthetic legacy control',
  'shared-entity',
  'npc'
);

insert into public.profile_characters(
  campaign_id, profile_id, entity_id, character_name
) values (
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  'D synthetic legacy control'
);

insert into public.participants(
  session_id, profile_id, character_entity_id, character_name
) values (
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  'D synthetic legacy control'
);

insert into public.canon_entries(
  campaign_id, entity_id, title, content
) values (
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444444',
  'Legacy canon control',
  'Synthetic only.'
);
