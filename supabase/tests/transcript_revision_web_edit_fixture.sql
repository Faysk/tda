-- Synthetic-only fixture for transcript revision editing (#898).
-- Never run against connected Supabase.
create schema extensions;
create extension if not exists pgcrypto with schema extensions;
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.campaigns(id uuid primary key, slug text not null unique);
create table public.profiles(
  id uuid primary key,
  auth_user_id uuid not null unique
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
  profile_id uuid not null references public.profiles(id),
  role_id uuid not null references public.role_definitions(id),
  scope_type text not null,
  scope_id text not null,
  status text not null,
  starts_at timestamptz not null,
  ends_at timestamptz
);
create table public.sessions(
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  current_transcript_revision_id uuid
);
create table public.transcript_revisions(
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id),
  revision_number bigint not null,
  operation_id uuid not null,
  source_system text not null,
  source_session_id text not null,
  source_id text not null,
  run_id text not null,
  base_transcript_sha256 text not null,
  draft_sha256 text not null,
  payload_sha256 text not null,
  segment_count integer not null,
  word_count integer not null,
  reviewed_segments integer not null,
  warning_count integer not null,
  lineage jsonb not null,
  review_summary jsonb not null,
  segments jsonb not null,
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

alter table public.sessions enable row level security;
alter table public.transcript_revisions enable row level security;
alter table public.audit_log enable row level security;
grant usage on schema public, extensions to service_role;
grant select on public.campaigns, public.profiles, public.permission_catalog,
  public.role_definitions, public.role_permissions, public.role_assignments,
  public.sessions, public.transcript_revisions, public.audit_log to service_role;
grant insert on public.transcript_revisions, public.audit_log to service_role;
grant update on public.sessions to service_role;

insert into public.campaigns(id, slug)
values ('11111111-1111-4111-8111-111111111111', 'synthetic-campaign');
insert into public.profiles(id, auth_user_id)
values (
  '33333333-3333-4333-8333-333333333333',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);
insert into public.permission_catalog(action, plane, description)
values ('campaign.content.edit', 'narrative', 'Synthetic edit permission');
insert into public.role_definitions(id, slug, plane)
values ('66666666-6666-4666-8666-666666666666', 'site_editor', 'narrative');
insert into public.role_permissions(role_id, permission_action)
values (
  '66666666-6666-4666-8666-666666666666',
  'campaign.content.edit'
);
insert into public.role_assignments(
  profile_id, role_id, scope_type, scope_id, status, starts_at
) values (
  '33333333-3333-4333-8333-333333333333',
  '66666666-6666-4666-8666-666666666666',
  'campaign',
  'synthetic-campaign',
  'active',
  clock_timestamp() - interval '1 hour'
);
insert into public.sessions(id, campaign_id)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111'
);
insert into public.transcript_revisions(
  id, campaign_id, session_id, revision_number, operation_id,
  source_system, source_session_id, source_id, run_id,
  base_transcript_sha256, draft_sha256, payload_sha256,
  segment_count, word_count, reviewed_segments, warning_count,
  lineage, review_summary, segments, actor_profile_id
) values (
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  1,
  '77777777-7777-4777-8777-777777777777',
  'local_companion',
  'synthetic-session',
  'craig-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'run-synthetic-1',
  repeat('a', 64),
  repeat('b', 64),
  repeat('c', 64),
  2,
  4,
  2,
  0,
  '{"profile_id":"qwen-quality"}'::jsonb,
  '{"status":"approved_local","draft_revision":1,"reviewed_segments":2,"total_segments":2,"warning_count":0,"word_count":4}'::jsonb,
  '[
    {"track_number":1,"segment_id":"s1","start":1.25,"end":2.50,"text":"Olá mesa","speaker":"Alya","reviewed":true},
    {"track_number":2,"segment_id":"s2","start":3.00,"end":4.75,"text":"Resposta curta","speaker":"Borin","reviewed":true}
  ]'::jsonb,
  '33333333-3333-4333-8333-333333333333'
);
update public.sessions
set current_transcript_revision_id = '44444444-4444-4444-8444-444444444444'
where id = '22222222-2222-4222-8222-222222222222';
