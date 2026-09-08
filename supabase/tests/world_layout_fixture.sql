-- Minimal synthetic contract fixture for World layout persistence.
-- Never a dump or production seed.
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.campaigns(
  id uuid primary key,
  slug text not null unique
);

create table public.profiles(
  id uuid primary key,
  auth_user_id uuid unique
);

create table public.permission_catalog(
  action text primary key,
  plane text not null check (plane in ('technical', 'narrative', 'mixed')),
  description text not null,
  created_at timestamptz not null default now()
);

create table public.role_definitions(
  id uuid primary key,
  slug text not null unique,
  plane text not null check (plane in ('technical', 'narrative', 'mixed'))
);

create table public.role_permissions(
  role_id uuid not null,
  permission_action text not null references public.permission_catalog(action),
  primary key(role_id, permission_action)
);

create table public.role_assignments(
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  role_id uuid not null,
  scope_type text not null check (scope_type in ('project', 'campaign', 'session', 'resource', 'integration')),
  scope_id text not null,
  status text not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz
);

create table public.audit_log(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  table_name text,
  record_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz default now()
);

alter table public.campaigns enable row level security;
alter table public.profiles enable row level security;
alter table public.permission_catalog enable row level security;
alter table public.role_definitions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.role_assignments enable row level security;
alter table public.audit_log enable row level security;

grant usage on schema public, extensions to service_role, anon, authenticated;
grant select on public.campaigns, public.profiles, public.permission_catalog,
  public.role_definitions, public.role_permissions, public.role_assignments, public.audit_log to service_role;
grant insert on public.audit_log to service_role;

insert into public.campaigns(id, slug)
values ('11111111-1111-4111-8111-111111111111', 'synthetic-campaign');

insert into public.profiles(id, auth_user_id)
values (
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
);

insert into public.role_definitions(id, slug, plane)
values (
  '55555555-5555-4555-8555-555555555555',
  'site_editor',
  'narrative'
);
