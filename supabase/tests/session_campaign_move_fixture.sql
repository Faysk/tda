-- Synthetic #1129 safe-session-move fixture. No Production data/credentials.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create table public.campaigns (
  id uuid primary key,
  name text not null,
  slug text not null unique,
  lifecycle text not null check (lifecycle in ('active','archived'))
);

create table public.profiles (
  id uuid primary key
);

create table public.role_permissions (
  role_id uuid not null,
  permission_action text not null
);

create table public.role_assignments (
  id uuid primary key,
  profile_id uuid not null references public.profiles(id),
  role_id uuid not null,
  scope_type text not null,
  scope_id text not null,
  status text not null,
  starts_at timestamptz not null,
  ends_at timestamptz
);

create table public.sessions (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  title text not null,
  status text not null,
  source_system text,
  source_session_id text,
  current_transcript_revision_id uuid,
  current_editorial_draft_id uuid,
  current_session_publication_id uuid,
  updated_at timestamptz not null default clock_timestamp()
);

create unique index sessions_source_external_unique
  on public.sessions(campaign_id, source_system, source_session_id)
  where source_system is not null and source_session_id is not null;

create table public.transcript_revisions (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.session_editorial_drafts (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.session_publications (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.session_publication_operations (
  operation_id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.publications (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.media_assets (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  object_key text not null,
  public_object_key text
);
create table public.review_decisions (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.canon_candidates (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.quote_candidates (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.outtake_candidates (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.participants (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade,
  character_entity_id uuid
);
create table public.recording_files (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.processing_jobs (
  id uuid primary key,
  session_id uuid references public.sessions(id) on delete cascade
);
create table public.audio_chunks (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.audio_speech_slices (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.transcript_segments (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.roll20_events (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.session_markers (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.table_notes (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);
create table public.discord_interactions (
  id uuid primary key,
  session_id uuid references public.sessions(id) on delete cascade
);
create table public.entity_mentions (
  id uuid primary key,
  session_id uuid references public.sessions(id) on delete cascade
);
create table public.ai_usage_ledger (
  id uuid primary key,
  session_id uuid references public.sessions(id) on delete cascade
);
create table public.audio_artifacts (
  id uuid primary key,
  session_id uuid references public.sessions(id) on delete cascade
);
create table public.craig_manifests (
  id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete cascade
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  campaign_id uuid references public.campaigns(id),
  session_id uuid references public.sessions(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  table_name text not null,
  record_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default clock_timestamp()
);

insert into public.campaigns(id,name,slug,lifecycle) values
('10000000-0000-4000-8000-000000000001','Campaign A','campaign-a','active'),
('10000000-0000-4000-8000-000000000002','Campaign B','campaign-b','active'),
('10000000-0000-4000-8000-000000000003','Campaign C','campaign-c','active'),
('10000000-0000-4000-8000-000000000004','Archived','campaign-archived','archived');

insert into public.profiles(id) values
('20000000-0000-4000-8000-000000000001'),
('20000000-0000-4000-8000-000000000002');

insert into public.role_permissions(role_id,permission_action) values
('30000000-0000-4000-8000-000000000001','campaign.content.edit');

insert into public.role_assignments(
  id,profile_id,role_id,scope_type,scope_id,status,starts_at,ends_at
) values
('31000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','campaign','campaign-a','active',clock_timestamp()-interval '1 day',null),
('31000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','campaign','campaign-b','active',clock_timestamp()-interval '1 day',null),
('31000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','campaign','campaign-c','active',clock_timestamp()-interval '1 day',null),
('31000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','campaign','campaign-a','active',clock_timestamp()-interval '1 day',null);

insert into public.sessions(id,campaign_id,title,status,source_system,source_session_id) values
('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Clean','ready_for_review','synthetic','clean-source'),
('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Transcript','ready_for_review','synthetic','transcript-source'),
('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Draft','ready_for_review','synthetic','draft-source'),
('40000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','Published','published','synthetic','published-source'),
('40000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','Media','ready_for_review','synthetic','media-source'),
('40000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','Entity participant','ready_for_review','synthetic','participant-source'),
('40000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000001','Evidence','ready_for_review','synthetic','evidence-source'),
('40000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000001','Scoped access','ready_for_review','synthetic','scoped-source'),
('40000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000001','Collision A','ready_for_review','synthetic','shared-source'),
('40000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000002','Collision B','ready_for_review','synthetic','shared-source'),
('40000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','Grant check','ready_for_review','synthetic','grant-source'),
('40000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000001','Concurrent','ready_for_review','synthetic','concurrent-source'),
('40000000-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000001','Review','ready_for_review','synthetic','review-source'),
('40000000-0000-4000-8000-000000000014','10000000-0000-4000-8000-000000000001','Publication history','ready_for_review','synthetic','publication-history-source');

insert into public.transcript_revisions(id,session_id) values
('50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002');
update public.sessions
set current_transcript_revision_id='50000000-0000-4000-8000-000000000002'
where id='40000000-0000-4000-8000-000000000002';

insert into public.session_editorial_drafts(id,session_id) values
('51000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000003');
update public.sessions
set current_editorial_draft_id='51000000-0000-4000-8000-000000000003'
where id='40000000-0000-4000-8000-000000000003';

insert into public.session_publications(id,session_id) values
('52000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000004');
update public.sessions
set current_session_publication_id='52000000-0000-4000-8000-000000000004'
where id='40000000-0000-4000-8000-000000000004';

insert into public.media_assets(id,campaign_id,object_key,public_object_key) values
('53000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001',
 'campaigns/campaign-a/sessions/40000000-0000-4000-8000-000000000005/cover/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp',
 null);

insert into public.participants(id,session_id,character_entity_id) values
('54000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-000000000006','55000000-0000-4000-8000-000000000006');

insert into public.recording_files(id,session_id) values
('56000000-0000-4000-8000-000000000007','40000000-0000-4000-8000-000000000007');

insert into public.role_assignments(
  id,profile_id,role_id,scope_type,scope_id,status,starts_at,ends_at
) values (
 '31000000-0000-4000-8000-000000000008',
 '20000000-0000-4000-8000-000000000001',
 '30000000-0000-4000-8000-000000000001',
 'session',
 '40000000-0000-4000-8000-000000000008',
 'active',
 clock_timestamp()-interval '1 day',
 null
);

insert into public.review_decisions(id,session_id) values
('57000000-0000-4000-8000-000000000013','40000000-0000-4000-8000-000000000013');

insert into public.publications(id,session_id) values
('58000000-0000-4000-8000-000000000014','40000000-0000-4000-8000-000000000014');
