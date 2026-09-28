-- Synthetic-only fixture for session publication. Never run against connected Supabase.
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
  id uuid primary key
);
create table public.sessions(
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  title text not null,
  session_date date,
  arc text,
  status text not null,
  summary_short text,
  summary_full text,
  source_session_id text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now(),
  current_transcript_revision_id uuid
);
create table public.transcript_revisions(
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id),
  revision_number bigint not null default 1,
  operation_id uuid not null default gen_random_uuid(),
  source_system text not null default 'local_companion',
  source_session_id text not null default 'synthetic-source',
  source_id text not null default ('craig-' || repeat('a', 64)),
  run_id text not null default 'synthetic-run',
  base_transcript_sha256 text not null default repeat('b', 64),
  draft_sha256 text not null default repeat('c', 64),
  payload_sha256 text not null default repeat('d', 64),
  segment_count integer not null default 1,
  word_count integer not null default 2,
  reviewed_segments integer not null default 1,
  warning_count integer not null default 0,
  lineage jsonb not null default '{"engine":"synthetic"}'::jsonb,
  review_summary jsonb not null default '{"reviewed_segments":1,"word_count":2}'::jsonb,
  segments jsonb not null default '[{"track_number":1,"segment_id":"seg-1","start":1.25,"end":2.5,"speaker":"Mesa","text":"texto original","reviewed":true}]'::jsonb,
  actor_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(session_id, revision_number),
  unique(session_id, operation_id)
);
alter table public.sessions
  add constraint sessions_current_transcript_revision_fk
  foreign key(current_transcript_revision_id)
  references public.transcript_revisions(id)
  on delete set null;

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

create table public.permission_catalog(
  action text primary key,
  plane text not null,
  description text
);
create table public.role_definitions(
  id uuid primary key,
  slug text not null unique,
  plane text not null
);
create table public.role_permissions(
  role_id uuid not null references public.role_definitions(id),
  permission_action text not null references public.permission_catalog(action),
  primary key(role_id, permission_action)
);
create table public.role_assignments(
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id),
  role_id uuid references public.role_definitions(id),
  scope_type text,
  scope_id text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz
);

create table public.media_assets(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  media_kind text not null default 'image',
  role_hint text not null default 'portrait',
  status text not null default 'staged',
  staged_bucket text not null,
  object_key text not null,
  sha256 text not null,
  mime_type text not null,
  byte_size bigint not null,
  width integer not null,
  height integer not null,
  read_back_verified boolean not null default false,
  public_bucket text,
  public_object_key text,
  public_delivery_verified boolean not null default false,
  public_verified_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint media_assets_role_hint_check
    check (role_hint in ('portrait','artwork','gallery')),
  constraint media_assets_object_key_check
    check (
      object_key ~ '^campaigns/[a-z0-9][a-z0-9-]{0,95}/entities/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/(portrait|artwork|gallery)/[0-9a-f]{64}[.](png|webp)$'
    )
);

alter table public.sessions enable row level security;
alter table public.media_assets enable row level security;
grant usage on schema public, extensions to service_role, anon, authenticated;
grant select on public.campaigns, public.profiles, public.sessions, public.transcript_revisions, public.media_assets, public.audit_log, public.permission_catalog, public.role_definitions, public.role_permissions to service_role;
grant insert on public.transcript_revisions to service_role;
grant update on public.sessions, public.media_assets to service_role;
grant insert on public.media_assets, public.audit_log to service_role;

insert into public.campaigns(id,slug)
values ('11111111-1111-4111-8111-111111111111','synthetic-campaign');
insert into public.profiles(id)
values ('33333333-3333-4333-8333-333333333333');
insert into public.role_definitions(id,slug,plane)
values ('66666666-6666-4666-8666-666666666666','site_editor','narrative');
insert into public.sessions(
  id,campaign_id,title,session_date,arc,status,summary_short,summary_full,source_session_id,metadata
) values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Legacy title',
  '2026-09-01',
  'Legacy arc',
  'approved',
  'Legacy short',
  'Legacy full',
  'synthetic-public-id',
  '{}'::jsonb
);
insert into public.transcript_revisions(
  id,campaign_id,session_id,revision_number,operation_id,actor_profile_id
)
values (
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  1,
  '44444444-4444-4444-8444-444444444445',
  '33333333-3333-4333-8333-333333333333'
);
update public.sessions
set current_transcript_revision_id='44444444-4444-4444-8444-444444444444'
where id='22222222-2222-4222-8222-222222222222';
