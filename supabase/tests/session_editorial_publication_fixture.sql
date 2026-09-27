-- Synthetic-only prerequisite schema for #793 publication contract.
-- Never a production dump and never connected to a remote database.
create schema extensions;
create extension if not exists pgcrypto with schema extensions;

create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.campaigns (
  id uuid primary key,
  slug text not null unique
);
create table public.profiles (
  id uuid primary key,
  auth_user_id uuid unique
);
create table public.sessions (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  title text not null,
  slug text,
  session_date date,
  arc text,
  status text not null,
  summary_short text,
  summary_full text,
  metadata jsonb not null default '{}'::jsonb,
  source_session_id text,
  current_transcript_revision_id uuid,
  updated_at timestamptz default clock_timestamp()
);
create table public.transcript_revisions (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id),
  revision_number bigint not null,
  transcript_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create table public.permission_catalog (
  action text primary key,
  plane text,
  description text
);
create table public.role_definitions (
  id uuid primary key,
  slug text not null unique,
  plane text not null,
  description text
);
create table public.role_permissions (
  role_id uuid not null,
  permission_action text not null references public.permission_catalog(action),
  primary key(role_id, permission_action)
);
create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id),
  role_id uuid,
  scope_type text,
  scope_id text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz
);
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id),
  session_id uuid references public.sessions(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  table_name text,
  record_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz default clock_timestamp()
);
create table public.media_assets (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  media_kind text not null default 'image',
  role_hint text not null,
  status text not null,
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
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.sessions enable row level security;
alter table public.transcript_revisions enable row level security;
alter table public.media_assets enable row level security;
alter table public.audit_log enable row level security;

grant usage on schema public, extensions to service_role, anon, authenticated;
grant select, update on public.sessions to service_role;
grant select on public.campaigns, public.profiles, public.transcript_revisions,
  public.role_assignments, public.role_permissions to service_role;
grant select, update on public.media_assets to service_role;
grant insert, select on public.audit_log to service_role;

insert into public.campaigns(id,slug)
values ('11111111-1111-4111-8111-111111111111','synthetic-campaign');
insert into public.profiles(id,auth_user_id)
values (
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444'
);
insert into public.permission_catalog(action,plane,description)
values (
  'campaign.transcript.publish',
  'narrative',
  'Synthetic publication capability'
);
insert into public.role_definitions(id,slug,plane,description)
values (
  '55555555-5555-4555-8555-555555555555',
  'site_publisher',
  'narrative',
  'Synthetic site publisher'
);
insert into public.role_permissions(role_id,permission_action)
values (
  '55555555-5555-4555-8555-555555555555',
  'campaign.transcript.publish'
);
insert into public.role_assignments(
  profile_id,role_id,scope_type,scope_id,status,starts_at
) values (
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  'campaign',
  'synthetic-campaign',
  'active',
  now() - interval '1 minute'
);
insert into public.sessions(
  id,campaign_id,title,slug,session_date,arc,status,
  summary_short,summary_full,metadata,source_session_id
) values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'Versão antiga',
  'fixture-session',
  date '2026-09-27',
  'Arco antigo',
  'approved',
  'Descrição antiga',
  '# Resumo antigo',
  '{"coverImageUrl":"https://dnd.faysk.dev/assets/sessions/old.webp"}'::jsonb,
  'fixture-session'
);
insert into public.transcript_revisions(
  id,campaign_id,session_id,revision_number,transcript_payload
) values (
  '77777777-7777-4777-8777-777777777777',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  3,
  '{"segments":[{"text":"PRIVATE_TRANSCRIPT_MARKER_NEVER_PUBLIC"}]}'::jsonb
);
update public.sessions
set current_transcript_revision_id='77777777-7777-4777-8777-777777777777'
where id='22222222-2222-4222-8222-222222222222';
