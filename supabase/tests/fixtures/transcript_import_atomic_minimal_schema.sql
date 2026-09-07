-- Minimal disposable PostgreSQL fixture for transcript import validation.
-- ISOLATED/LOCAL DATABASE ONLY. Never run this file against production.
-- The fixture already models transcript_segments.revision; apply only
-- 20260907193000_import_transcript_result_atomic.sql after this file.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end;
$$;

grant usage on schema public to service_role;

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique
);

create table public.profiles (
  id uuid primary key,
  display_name text not null
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  title text not null,
  source_system text,
  source_session_id text
);

create unique index idx_sessions_campaign_source_unique
  on public.sessions (campaign_id, source_system, source_session_id)
  where source_system is not null and source_session_id is not null;

create table public.permission_catalog (
  action text primary key,
  plane text not null check (plane in ('technical', 'narrative', 'mixed')),
  description text not null,
  created_at timestamptz not null default now()
);

create table public.role_definitions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  plane text not null check (plane in ('technical', 'narrative', 'mixed')),
  description text not null,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.role_permissions (
  role_id uuid not null references public.role_definitions(id) on delete cascade,
  permission_action text not null references public.permission_catalog(action) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_action)
);

create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.role_definitions(id) on delete cascade,
  scope_type text not null check (scope_type in ('project', 'campaign', 'session', 'resource', 'integration')),
  scope_id text not null,
  status text not null default 'active' check (status in ('active', 'eligible', 'ended', 'revoked')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  assigned_by uuid references public.profiles(id) on delete set null,
  revoked_by uuid references public.profiles(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  speaker_profile_id uuid references public.profiles(id),
  participant_id uuid,
  character_name text,
  source_file_id uuid,
  source_chunk_id uuid,
  start_ms integer not null,
  end_ms integer not null,
  text text not null,
  raw_confidence numeric,
  language text default 'pt',
  created_at timestamptz default now(),
  source_segment_id text,
  source_sequence integer,
  track_key text,
  speaker_name text,
  speaker_role text,
  source_chunk_path text,
  response_path text,
  chunk_index integer,
  text_chars integer,
  text_words integer,
  is_empty boolean not null default false,
  needs_review boolean not null default false,
  review_status text not null default 'pending',
  tags text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  revision bigint not null default 0
);

create unique index idx_transcript_segments_session_source_unique
  on public.transcript_segments (session_id, source_segment_id)
  where source_segment_id is not null;

alter table public.campaigns enable row level security;
alter table public.profiles enable row level security;
alter table public.sessions enable row level security;
alter table public.permission_catalog enable row level security;
alter table public.role_definitions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.role_assignments enable row level security;
alter table public.transcript_segments enable row level security;

grant select on public.campaigns to service_role;
grant select on public.profiles to service_role;
grant select on public.sessions to service_role;
grant select on public.permission_catalog to service_role;
grant select on public.role_definitions to service_role;
grant select on public.role_permissions to service_role;
grant select on public.role_assignments to service_role;
grant select, insert on public.transcript_segments to service_role;

insert into public.role_definitions (id, slug, name, plane, description, is_system)
values (
  '10000000-0000-4000-8000-000000000001',
  'local_operator',
  'Local Processing Operator',
  'mixed',
  'Synthetic fixture role matching the production role slug.',
  true
);
