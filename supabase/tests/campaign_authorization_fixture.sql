-- Synthetic extension fixture for #1134. Applied after the #1123 fixture/candidate.

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table public.profiles (
  id uuid primary key,
  display_name text not null,
  discord_id text,
  roll20_name text,
  default_character_name text,
  metadata jsonb not null default '{}'::jsonb,
  auth_user_id uuid,
  email text,
  avatar_url text,
  last_sign_in_at timestamptz,
  discord_handle text
);

create table public.permission_catalog (
  action text primary key,
  plane text not null,
  description text not null,
  created_at timestamptz not null default now()
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
  created_at timestamptz not null default now(),
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

create table public.campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null,
  created_at timestamptz default now(),
  unique (campaign_id, profile_id)
);

create table public.profile_claims (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  requester_auth_user_id uuid not null,
  requester_email text,
  requester_name text,
  target_profile_id uuid,
  requested_display_name text,
  requested_roll20_name text,
  requested_discord_id text,
  requested_discord_handle text,
  requested_character_names text[] not null default '{}',
  player_note text,
  status text not null default 'pending',
  reviewer_profile_id uuid,
  reviewed_at timestamptz,
  review_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated, service_role;

insert into public.permission_catalog(action, plane, description) values
  ('campaign.read', 'narrative', 'Read campaign'),
  ('campaign.access.manage', 'mixed', 'Manage access'),
  ('campaign.edit.access', 'narrative', 'Open Edit'),
  ('campaign.transcript.read', 'narrative', 'Read transcript'),
  ('project.monitor.read', 'technical', 'Read monitoring');

insert into public.role_definitions(id, slug, name, plane, description) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'campaign-reader', 'Campaign reader', 'narrative', 'Synthetic reader'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'campaign-manager', 'Campaign manager', 'mixed', 'Synthetic manager'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'project-transcript-reader', 'Project transcript reader', 'narrative', 'Synthetic project campaign capability'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'wrong-project-reader', 'Wrong project reader', 'narrative', 'Synthetic wrong project scope'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'platform_owner', 'Platform owner', 'technical', 'Synthetic owner');

insert into public.role_permissions(role_id, permission_action) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'campaign.read'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'campaign.edit.access'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'campaign.read'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'campaign.access.manage'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'campaign.transcript.read'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'campaign.transcript.read');

insert into public.profiles(id, display_name, auth_user_id, discord_id, discord_handle) values
  ('30000000-0000-4000-8000-000000000001', 'Legacy member', '90000000-0000-4000-8000-000000000001', 'discord-a', 'member-a'),
  ('30000000-0000-4000-8000-000000000002', 'Second member', '90000000-0000-4000-8000-000000000002', 'discord-b', 'member-b'),
  ('30000000-0000-4000-8000-000000000003', 'Outsider', '90000000-0000-4000-8000-000000000003', 'discord-o', 'outsider'),
  ('30000000-0000-4000-8000-000000000004', 'Project reader', '90000000-0000-4000-8000-000000000004', null, null),
  ('30000000-0000-4000-8000-000000000005', 'Wrong project', '90000000-0000-4000-8000-000000000005', null, null),
  ('30000000-0000-4000-8000-000000000006', 'Manager A', '90000000-0000-4000-8000-000000000006', 'discord-m', 'manager-a'),
  ('30000000-0000-4000-8000-000000000007', 'Global unlinked profile', null, 'discord-u', 'unlinked');

insert into public.campaigns(
  id, name, slug, description, metadata, lifecycle, visibility, public_slug, archived_at
) values (
  '10000000-0000-4000-8000-000000000009',
  'Arquivada privada',
  'archived-private',
  'Não deve aparecer publicamente',
  '{}'::jsonb,
  'archived',
  'public',
  'archived-private',
  clock_timestamp()
);

insert into public.campaign_members(campaign_id, profile_id, role)
select id, '30000000-0000-4000-8000-000000000001', 'player'
from public.campaigns where slug='yuhara-main';

insert into public.campaign_members(campaign_id, profile_id, role)
select id, '30000000-0000-4000-8000-000000000006', 'master'
from public.campaigns where slug='yuhara-main';

insert into public.campaign_members(campaign_id, profile_id, role)
select id, '30000000-0000-4000-8000-000000000002', 'player'
from public.campaigns where slug='antes-que-seja-tarde';

insert into public.role_assignments(
  id, profile_id, role_id, scope_type, scope_id, status, starts_at
) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','30000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','campaign','yuhara-main','active','2020-01-01'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','30000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','campaign','antes-que-seja-tarde','active','2020-01-01'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','30000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','project','tda','active','2020-01-01'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4','30000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','project','dnd-scribe','active','2020-01-01'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5','30000000-0000-4000-8000-000000000006','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','campaign','yuhara-main','active','2020-01-01');

insert into public.profile_claims(
  campaign_id, requester_auth_user_id, requester_name, requested_display_name
)
select id, '90000000-0000-4000-8000-000000000001', 'Legacy member', 'Legacy member'
from public.campaigns where slug='yuhara-main';
