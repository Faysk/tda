-- Synthetic extension for #1454-#1462 session campaign move v2.
-- Applied after the v1 fixture/migration. It mirrors the relational shape used
-- by the v2 transfer boundary without copying Production narrative data.

alter table public.transcript_revisions
  add column if not exists parent_revision_id uuid references public.transcript_revisions(id) on delete restrict,
  add column if not exists revision_number bigint not null default 1,
  add column if not exists payload_sha256 text;

alter table public.session_editorial_drafts
  add column if not exists revision bigint not null default 1,
  add column if not exists base_transcript_revision_id uuid references public.transcript_revisions(id) on delete restrict,
  add column if not exists cover_asset_id text;

alter table public.session_publications
  add column if not exists version bigint not null default 1,
  add column if not exists draft_id uuid references public.session_editorial_drafts(id) on delete restrict,
  add column if not exists base_transcript_revision_id uuid references public.transcript_revisions(id) on delete restrict,
  add column if not exists cover_asset_id text,
  add column if not exists cover_url text,
  add column if not exists payload_sha256 text;

alter table public.session_publication_operations
  add column if not exists draft_id uuid references public.session_editorial_drafts(id) on delete restrict,
  add column if not exists publication_id uuid references public.session_publications(id) on delete restrict,
  add column if not exists expected_previous_publication_id uuid references public.session_publications(id) on delete restrict,
  add column if not exists payload_sha256 text;

alter table public.canon_entries
  add column if not exists source_candidate_id uuid;

create table if not exists public.recording_files (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade
);

create table if not exists public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade
);

create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete set null
);

create table if not exists public.audio_chunks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade
);

create table if not exists public.roll20_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade
);

create table if not exists public.session_markers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade
);

create table if not exists public.quote_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade
);

create table if not exists public.outtake_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade
);

create table if not exists public.review_decisions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade
);

create table if not exists public.publications (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  status text not null default 'draft',
  visibility text not null default 'private_players'
);

create table if not exists public.ai_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null
);

create table if not exists public.audio_speech_slices (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade
);

create table if not exists public.audio_artifacts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade
);

create table if not exists public.craig_manifests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade
);

create table if not exists public.craig_track_extraction_steps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade
);

create table if not exists public.transcript_publication_receipts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  revision_id uuid references public.transcript_revisions(id) on delete restrict,
  operation_id uuid not null
);

create table if not exists public.transcript_publication_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  revision_id uuid references public.transcript_revisions(id) on delete restrict,
  previous_revision_id uuid references public.transcript_revisions(id) on delete restrict,
  operation_id uuid not null
);

create table if not exists public.transcript_session_statistics (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  total_words bigint not null default 0
);

create table if not exists public.transcript_assembly_publication_receipts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  revision_id uuid references public.transcript_revisions(id) on delete restrict,
  operation_id uuid not null
);

create table if not exists public.discord_interactions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null
);

create table if not exists public.table_notes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null
);

create table if not exists public.media_assets (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  media_kind text not null default 'image',
  role_hint text not null default 'session_cover',
  status text not null default 'staged',
  staged_bucket text not null,
  object_key text not null,
  sha256 text not null,
  mime_type text not null,
  byte_size bigint not null,
  width integer not null,
  height integer not null,
  read_back_verified boolean not null default true,
  public_bucket text,
  public_object_key text,
  public_delivery_verified boolean not null default false,
  public_verified_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(campaign_id,id),
  unique(campaign_id,staged_bucket,object_key)
);

insert into public.permission_catalog(action, plane, description)
values ('campaign.permissions.manage','narrative','Manage campaign permissions')
on conflict (action) do nothing;

insert into public.role_permissions(role_id, permission_action)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','campaign.permissions.manage')
on conflict do nothing;

-- A populated, unpublished session with modern private lineage, one governed
-- cover, a participant/entity link and one session-scoped grant.
insert into public.sessions(
  id,campaign_id,title,status,source_system,source_session_id,metadata
)
select
  '41000000-0000-4000-8000-000000000020',
  c.id,
  'Move populated v2',
  'approved',
  'local_companion',
  'move-populated-v2',
  '{}'::jsonb
from public.campaigns c
where c.slug='yuhara-main';

insert into public.transcript_revisions(
  id,campaign_id,session_id,parent_revision_id,revision_number,payload_sha256
)
select
  '51000000-0000-4000-8000-000000000020',
  c.id,
  '41000000-0000-4000-8000-000000000020',
  null,
  1,
  repeat('a',64)
from public.campaigns c where c.slug='yuhara-main';

insert into public.transcript_revisions(
  id,campaign_id,session_id,parent_revision_id,revision_number,payload_sha256
)
select
  '51000000-0000-4000-8000-000000000021',
  c.id,
  '41000000-0000-4000-8000-000000000020',
  '51000000-0000-4000-8000-000000000020',
  2,
  repeat('b',64)
from public.campaigns c where c.slug='yuhara-main';

update public.sessions
set current_transcript_revision_id='51000000-0000-4000-8000-000000000021'
where id='41000000-0000-4000-8000-000000000020';

insert into public.media_assets(
  id,campaign_id,role_hint,status,staged_bucket,object_key,sha256,mime_type,
  byte_size,width,height,read_back_verified
)
select
  '54000000-0000-4000-8000-000000000020',
  c.id,
  'session_cover',
  'staged',
  'tda-media-preview',
  'campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000020/cover/' || repeat('c',64) || '.webp',
  repeat('c',64),
  'image/webp',
  128,
  16,
  16,
  true
from public.campaigns c where c.slug='yuhara-main';

insert into public.session_editorial_drafts(
  id,campaign_id,session_id,revision,base_transcript_revision_id,cover_asset_id
)
select
  '52000000-0000-4000-8000-000000000020',
  c.id,
  '41000000-0000-4000-8000-000000000020',
  1,
  '51000000-0000-4000-8000-000000000020',
  '54000000-0000-4000-8000-000000000020'
from public.campaigns c where c.slug='yuhara-main';

insert into public.session_editorial_drafts(
  id,campaign_id,session_id,revision,base_transcript_revision_id,cover_asset_id
)
select
  '52000000-0000-4000-8000-000000000021',
  c.id,
  '41000000-0000-4000-8000-000000000020',
  2,
  '51000000-0000-4000-8000-000000000021',
  '54000000-0000-4000-8000-000000000020'
from public.campaigns c where c.slug='yuhara-main';

update public.sessions
set current_editorial_draft_id='52000000-0000-4000-8000-000000000021'
where id='41000000-0000-4000-8000-000000000020';

insert into public.transcript_publication_receipts(
  campaign_id,session_id,revision_id,operation_id
)
select
  c.id,
  '41000000-0000-4000-8000-000000000020',
  '51000000-0000-4000-8000-000000000021',
  '55000000-0000-4000-8000-000000000020'
from public.campaigns c where c.slug='yuhara-main';

insert into public.transcript_publication_events(
  campaign_id,session_id,revision_id,previous_revision_id,operation_id
)
select
  c.id,
  '41000000-0000-4000-8000-000000000020',
  '51000000-0000-4000-8000-000000000021',
  '51000000-0000-4000-8000-000000000020',
  '55000000-0000-4000-8000-000000000021'
from public.campaigns c where c.slug='yuhara-main';

insert into public.participants(session_id,character_entity_id,player_name,character_name)
values (
  '41000000-0000-4000-8000-000000000020',
  '20000000-0000-4000-8000-000000000001',
  'Player v2',
  'PC legado'
);

insert into public.role_assignments(
  id,profile_id,role_id,scope_type,scope_id,status,starts_at,ends_at
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc0',
  '30000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'session',
  '41000000-0000-4000-8000-000000000020',
  'active',
  '2020-01-01',
  null
);

insert into public.audit_log(
  campaign_id,session_id,actor_id,action,table_name,record_id,old_value,new_value
)
select
  c.id,
  '41000000-0000-4000-8000-000000000020',
  '30000000-0000-4000-8000-000000000006',
  'synthetic.before_move',
  'sessions',
  '41000000-0000-4000-8000-000000000020',
  null,
  jsonb_build_object('synthetic',true)
from public.campaigns c where c.slug='yuhara-main';

insert into public.ai_usage_ledger(campaign_id,session_id)
select
  c.id,'41000000-0000-4000-8000-000000000020'
from public.campaigns c where c.slug='yuhara-main';

-- A published session verifies that current publication ownership can move
-- without regenerating its immutable payload hash/timestamp.
insert into public.sessions(
  id,campaign_id,title,status,source_system,source_session_id,metadata
)
select
  '41000000-0000-4000-8000-000000000021',
  c.id,
  'Move published v2',
  'published',
  'local_companion',
  'move-published-v2',
  '{}'::jsonb
from public.campaigns c where c.slug='yuhara-main';

insert into public.transcript_revisions(
  id,campaign_id,session_id,revision_number,payload_sha256
)
select
  '51000000-0000-4000-8000-000000000022',
  c.id,
  '41000000-0000-4000-8000-000000000021',
  1,
  repeat('d',64)
from public.campaigns c where c.slug='yuhara-main';

update public.sessions
set current_transcript_revision_id='51000000-0000-4000-8000-000000000022'
where id='41000000-0000-4000-8000-000000000021';

insert into public.media_assets(
  id,campaign_id,role_hint,status,staged_bucket,object_key,sha256,mime_type,
  byte_size,width,height,read_back_verified,public_bucket,public_object_key,
  public_delivery_verified,public_verified_at
)
select
  '54000000-0000-4000-8000-000000000021',
  c.id,
  'session_cover',
  'verified_public',
  'tda-media-preview',
  'campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000021/cover/' || repeat('e',64) || '.webp',
  repeat('e',64),
  'image/webp',
  128,
  16,
  16,
  true,
  'tda-media-public',
  'campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000021/cover/' || repeat('e',64) || '.webp',
  true,
  clock_timestamp()
from public.campaigns c where c.slug='yuhara-main';

insert into public.session_editorial_drafts(
  id,campaign_id,session_id,revision,base_transcript_revision_id,cover_asset_id
)
select
  '52000000-0000-4000-8000-000000000022',
  c.id,
  '41000000-0000-4000-8000-000000000021',
  1,
  '51000000-0000-4000-8000-000000000022',
  '54000000-0000-4000-8000-000000000021'
from public.campaigns c where c.slug='yuhara-main';

update public.sessions
set current_editorial_draft_id='52000000-0000-4000-8000-000000000022'
where id='41000000-0000-4000-8000-000000000021';

insert into public.session_publications(
  id,campaign_id,session_id,version,draft_id,base_transcript_revision_id,
  cover_asset_id,cover_url,payload_sha256
)
select
  '53000000-0000-4000-8000-000000000021',
  c.id,
  '41000000-0000-4000-8000-000000000021',
  1,
  '52000000-0000-4000-8000-000000000022',
  '51000000-0000-4000-8000-000000000022',
  '54000000-0000-4000-8000-000000000021',
  'https://media.dnd.faysk.dev/campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000021/cover/' || repeat('e',64) || '.webp',
  repeat('f',64)
from public.campaigns c where c.slug='yuhara-main';

insert into public.session_publication_operations(
  operation_id,campaign_id,session_id,draft_id,publication_id,payload_sha256
)
select
  '56000000-0000-4000-8000-000000000021',
  c.id,
  '41000000-0000-4000-8000-000000000021',
  '52000000-0000-4000-8000-000000000022',
  '53000000-0000-4000-8000-000000000021',
  repeat('f',64)
from public.campaigns c where c.slug='yuhara-main';

update public.sessions
set
  current_session_publication_id='53000000-0000-4000-8000-000000000021',
  metadata=jsonb_build_object(
    'coverImageUrl',
    'https://media.dnd.faysk.dev/campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000021/cover/' || repeat('e',64) || '.webp',
    'heroImageUrl',
    'https://media.dnd.faysk.dev/campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000021/cover/' || repeat('e',64) || '.webp'
  )
where id='41000000-0000-4000-8000-000000000021';
