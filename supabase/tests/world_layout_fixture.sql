-- Minimal synthetic contract fixture for World layout persistence and authoring.
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
  auth_user_id uuid unique,
  display_name text not null
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

create table public.sessions(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  title text not null,
  session_date date,
  status text not null default 'planned'
);

create table public.audit_log(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id),
  session_id uuid references public.sessions(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  table_name text,
  record_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz default now()
);

create table public.entities(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  slug text,
  entity_type text not null check (entity_type in ('pc','npc','location','item','organization','faction','arc','concept','song','quest','other')),
  status text default 'active',
  visibility text default 'private_players' check (visibility in ('private_master','private_players','review_only','public_campaign','public_web')),
  summary text,
  aliases text[] not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(campaign_id, name)
);
create unique index entities_campaign_slug_unique
  on public.entities(campaign_id, slug) where slug is not null;

create table public.canon_candidates(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  title text not null,
  claim text not null,
  candidate_type text not null default 'event',
  status text not null default 'candidate'
    check (status in ('candidate','approved_canon','rejected','interpretation','possible_hook','retcon_pending','private','published')),
  confidence numeric,
  related_entity_ids uuid[],
  source_segment_ids uuid[],
  source_roll20_event_ids uuid[],
  reviewer_notes text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  source_system text,
  source_run_id text,
  source_candidate_id text,
  metadata jsonb not null default '{}'::jsonb
);

create table public.canon_entries(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  entity_id uuid references public.entities(id) on delete set null,
  source_candidate_id uuid references public.canon_candidates(id) on delete set null,
  title text not null,
  content text not null,
  entry_type text not null default 'canon_candidate',
  visibility text not null default 'private_players'
    check (visibility in ('private_master','private_players','review_only','public_campaign','public_web')),
  status text not null default 'active'
    check (status in ('active','superseded','retcon_pending','archived')),
  source_run_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(campaign_id, source_candidate_id)
);

create table public.review_decisions(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  target_table text not null,
  target_id uuid not null,
  decision text not null,
  notes text,
  decided_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  source_system text,
  source_run_id text,
  source_decision_id text,
  target_source_id text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.campaigns enable row level security;
alter table public.profiles enable row level security;
alter table public.permission_catalog enable row level security;
alter table public.role_definitions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.role_assignments enable row level security;
alter table public.sessions enable row level security;
alter table public.audit_log enable row level security;
alter table public.entities enable row level security;
alter table public.canon_candidates enable row level security;
alter table public.canon_entries enable row level security;
alter table public.review_decisions enable row level security;

grant usage on schema public, extensions to service_role, anon, authenticated;
grant select on public.campaigns, public.profiles, public.permission_catalog,
  public.role_definitions, public.role_permissions, public.role_assignments, public.sessions,
  public.audit_log, public.entities, public.canon_candidates, public.canon_entries,
  public.review_decisions to service_role;
grant insert on public.audit_log to service_role;
grant insert, update on public.entities to service_role;

insert into public.campaigns(id, slug)
values ('11111111-1111-4111-8111-111111111111', 'synthetic-campaign');

insert into public.profiles(id, auth_user_id, display_name)
values (
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  'Editor Um'
);

insert into public.sessions(id, campaign_id, title, session_date, status)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Sessão sintética',
  date '2026-09-22',
  'ready_for_review'
);

insert into public.role_definitions(id, slug, plane)
values (
  '55555555-5555-4555-8555-555555555555',
  'site_editor',
  'narrative'
);

-- campaign.content.edit is an existing TDA capability in production. It is part
-- of the synthetic precondition here so the World authoring migration can prove
-- that factual editing never piggybacks on layout permission alone.
insert into public.permission_catalog(action, plane, description)
values (
  'campaign.content.edit',
  'narrative',
  'Edit reviewed campaign content.'
);

insert into public.role_permissions(role_id, permission_action)
values (
  '55555555-5555-4555-8555-555555555555',
  'campaign.content.edit'
);
