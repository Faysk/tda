-- Minimal synthetic RBAC schema for #986. No production rows or credentials.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create table public.campaigns (
  id uuid primary key,
  slug text not null unique,
  name text not null
);

create table public.profiles (
  id uuid primary key,
  display_name text not null,
  auth_user_id uuid
);

create table public.role_definitions (
  id uuid primary key,
  slug text not null unique,
  name text not null,
  plane text not null default 'narrative',
  description text not null default '',
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.role_permissions (
  role_id uuid not null references public.role_definitions(id) on delete cascade,
  permission_action text not null,
  primary key (role_id, permission_action)
);

create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.role_definitions(id) on delete restrict,
  scope_type text not null,
  scope_id text not null,
  status text not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  assigned_by uuid references public.profiles(id),
  revoked_by uuid references public.profiles(id),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index role_assignments_open_unique
  on public.role_assignments(profile_id, role_id, scope_type, scope_id)
  where status in ('active', 'eligible') and ends_at is null;

create table public.campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text,
  created_at timestamptz not null default now(),
  unique (campaign_id, profile_id)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id),
  session_id uuid,
  actor_id uuid references public.profiles(id),
  action text not null,
  table_name text,
  record_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

alter table public.campaigns enable row level security;
alter table public.profiles enable row level security;
alter table public.role_definitions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.role_assignments enable row level security;
alter table public.campaign_members enable row level security;
alter table public.audit_log enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete
  on public.campaigns,
     public.profiles,
     public.role_definitions,
     public.role_permissions,
     public.role_assignments,
     public.campaign_members,
     public.audit_log
  to service_role;

insert into public.campaigns(id, slug, name) values
  ('10000000-0000-4000-8000-000000000001', 'yuhara-main', 'Sintética'),
  ('10000000-0000-4000-8000-000000000002', 'solo', 'Solo');

insert into public.profiles(id, display_name) values
  ('11111111-1111-4111-8111-111111111111', 'Admin'),
  ('22222222-2222-4222-8222-222222222222', 'Target'),
  ('33333333-3333-4333-8333-333333333333', 'Sem authority'),
  ('44444444-4444-4444-8444-444444444444', 'Fora da campaign'),
  ('55555555-5555-4555-8555-555555555555', 'Solo admin');

insert into public.role_definitions(id, slug, name, plane, description) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'manager', 'Manager', 'technical', 'Manage'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'reader', 'Reader', 'narrative', 'Read'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'project-operator', 'Project', 'technical', 'Project'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'publisher', 'Publisher', 'narrative', 'Publish');

insert into public.role_permissions(role_id, permission_action) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'campaign.permissions.manage'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'campaign.transcript.read'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'project.jobs.run'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'campaign.sessions.publish');

insert into public.campaign_members(campaign_id, profile_id, role) values
  ('10000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'synthetic'),
  ('10000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'synthetic'),
  ('10000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'synthetic'),
  ('10000000-0000-4000-8000-000000000002', '55555555-5555-4555-8555-555555555555', 'synthetic');

insert into public.role_assignments(
  id, profile_id, role_id, scope_type, scope_id, status, starts_at
) values
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'campaign', 'yuhara-main', 'active', '2020-01-01'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '55555555-5555-4555-8555-555555555555',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'campaign', 'solo', 'active', '2020-01-01'
  );
