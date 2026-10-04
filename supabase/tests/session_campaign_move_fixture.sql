-- Synthetic extension for #1129 / #1454 session campaign move.
-- Applied after #1123 + #1134 scratch fixtures/candidates.
-- This fixture intentionally models the real session dependency graph closely
-- enough for v2 migration/recovery tests while keeping all narrative content fake.

alter table public.sessions
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default clock_timestamp(),
  add column if not exists current_transcript_revision_id uuid,
  add column if not exists current_editorial_draft_id uuid,
  add column if not exists current_session_publication_id uuid;

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
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

create table public.transcript_revisions (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id),
  revision_number bigint not null default 1,
  parent_revision_id uuid references public.transcript_revisions(id),
  operation_id uuid not null default gen_random_uuid()
);

create table public.transcript_publication_receipts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id),
  revision_id uuid not null references public.transcript_revisions(id),
  operation_id uuid not null default gen_random_uuid()
);

create table public.transcript_publication_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id),
  revision_id uuid references public.transcript_revisions(id),
  previous_revision_id uuid references public.transcript_revisions(id),
  operation_id uuid not null default gen_random_uuid()
);

create table public.transcript_assembly_publication_receipts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id),
  revision_id uuid not null references public.transcript_revisions(id),
  operation_id uuid not null default gen_random_uuid()
);

create table public.transcript_revision_parts (
  revision_id uuid not null references public.transcript_revisions(id),
  ordinal smallint not null,
  primary key (revision_id, ordinal)
);

create table public.session_editorial_drafts (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id),
  revision bigint not null default 1,
  base_transcript_revision_id uuid not null references public.transcript_revisions(id),
  cover_asset_id text,
  arc text not null default '',
  title text not null default '',
  summary_short text not null default '',
  summary_full text not null default '',
  actor_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  session_date date,
  session_date_captured boolean not null default false,
  unique(session_id, revision)
);

create table public.session_publications (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id),
  version bigint not null default 1,
  draft_id uuid references public.session_editorial_drafts(id),
  base_transcript_revision_id uuid references public.transcript_revisions(id),
  cover_asset_id text,
  cover_url text,
  payload_sha256 text,
  unique(session_id, version)
);

create table public.session_publication_operations (
  operation_id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id),
  draft_id uuid references public.session_editorial_drafts(id),
  publication_id uuid references public.session_publications(id),
  expected_previous_publication_id uuid references public.session_publications(id)
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
  updated_at timestamptz not null default clock_timestamp(),
  unique(campaign_id, staged_bucket, object_key)
);

create table public.recording_files (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id)
);
create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id)
);
create table public.audio_chunks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id)
);
create table public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id)
);
create table public.roll20_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id)
);
create table public.session_markers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id)
);
create table public.entity_mentions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id),
  session_id uuid references public.sessions(id)
);
create table public.canon_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id),
  related_entity_ids uuid[]
);
create table public.quote_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id)
);
create table public.outtake_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id)
);
create table public.review_decisions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id)
);
create table public.publications (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id)
);
create table public.ai_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id),
  session_id uuid references public.sessions(id)
);
create table public.audio_speech_slices (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id)
);
create table public.discord_interactions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.campaigns(id),
  session_id uuid references public.sessions(id)
);
create table public.table_notes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid references public.sessions(id)
);
create table public.audio_artifacts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id)
);
create table public.craig_manifests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id)
);
create table public.craig_track_extraction_steps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id)
);
create table public.transcript_session_statistics (
  session_id uuid primary key references public.sessions(id)
);

alter table public.canon_entries
  add column if not exists source_candidate_id uuid references public.canon_candidates(id);

insert into public.permission_catalog(action, plane, description) values
  ('campaign.content.edit', 'narrative', 'Edit campaign content'),
  ('campaign.transcript.read', 'narrative', 'Read campaign transcript'),
  ('campaign.sessions.publish', 'narrative', 'Publish campaign sessions'),
  ('campaign.permissions.manage', 'mixed', 'Manage campaign permissions')
on conflict (action) do nothing;

insert into public.role_permissions(role_id, permission_action) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'campaign.content.edit'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'campaign.transcript.read'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'campaign.sessions.publish'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'campaign.permissions.manage')
on conflict do nothing;

insert into public.role_assignments(
  id, profile_id, role_id, scope_type, scope_id, status, starts_at, ends_at
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba1',
  '30000000-0000-4000-8000-000000000006',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'campaign',
  'antes-que-seja-tarde',
  'active',
  '2020-01-01',
  null
);

insert into public.sessions(
  id,campaign_id,title,status,source_system,source_session_id,metadata
)
select seed.id, campaign.id, seed.title, seed.status, 'local_companion', seed.source_id, seed.metadata
from (
  values
    ('41000000-0000-4000-8000-000000000001'::uuid,'Move empty','ready_for_review','move-empty','{}'::jsonb),
    ('41000000-0000-4000-8000-000000000003'::uuid,'Move collision source','ready_for_review','move-collision','{}'::jsonb),
    ('41000000-0000-4000-8000-000000000005'::uuid,'Move transcript','ready_for_review','move-transcript','{}'::jsonb),
    ('41000000-0000-4000-8000-000000000006'::uuid,'Move draft','ready_for_review','move-draft','{}'::jsonb),
    ('41000000-0000-4000-8000-000000000007'::uuid,'Move published','published','move-published','{}'::jsonb),
    ('41000000-0000-4000-8000-000000000008'::uuid,'Move cover','ready_for_review','move-cover',jsonb_build_object('coverImageUrl','https://media.invalid/cover.webp')),
    ('41000000-0000-4000-8000-000000000009'::uuid,'Move participant entity','ready_for_review','move-participant','{}'::jsonb),
    ('41000000-0000-4000-8000-000000000010'::uuid,'Move provenance','ready_for_review','move-provenance','{}'::jsonb),
    ('41000000-0000-4000-8000-000000000011'::uuid,'Move scoped grant','ready_for_review','move-grant','{}'::jsonb),
    ('41000000-0000-4000-8000-000000000012'::uuid,'Move concurrent','ready_for_review','move-concurrent','{}'::jsonb),
    ('41000000-0000-4000-8000-000000000020'::uuid,'Move populated','published','move-populated','{}'::jsonb),
    ('41000000-0000-4000-8000-000000000021'::uuid,'Move manual reconciliation','ready_for_review','move-manual','{}'::jsonb),
    ('41000000-0000-4000-8000-000000000022'::uuid,'Move canon hard block','ready_for_review','move-canon-hard','{}'::jsonb),
    ('41000000-0000-4000-8000-000000000023'::uuid,'Move concurrent v2','ready_for_review','move-concurrent-v2','{}'::jsonb)
) seed(id,title,status,source_id,metadata)
cross join public.campaigns campaign
where campaign.slug='yuhara-main';

insert into public.sessions(
  id,campaign_id,title,status,source_system,source_session_id,metadata
)
select
  '41000000-0000-4000-8000-000000000004',
  campaign.id,
  'Destination collision',
  'ready_for_review',
  'local_companion',
  'move-collision',
  '{}'::jsonb
from public.campaigns campaign
where campaign.slug='antes-que-seja-tarde';

-- v1 blocker fixtures.
insert into public.transcript_revisions(id,campaign_id,session_id,revision_number)
select
  '51000000-0000-4000-8000-000000000005',
  campaign.id,
  '41000000-0000-4000-8000-000000000005',
  1
from public.campaigns campaign where campaign.slug='yuhara-main';
update public.sessions
set current_transcript_revision_id='51000000-0000-4000-8000-000000000005'
where id='41000000-0000-4000-8000-000000000005';

insert into public.transcript_revisions(id,campaign_id,session_id,revision_number)
select
  '51000000-0000-4000-8000-000000000006',
  campaign.id,
  '41000000-0000-4000-8000-000000000006',
  1
from public.campaigns campaign where campaign.slug='yuhara-main';
insert into public.session_editorial_drafts(
  id,campaign_id,session_id,revision,base_transcript_revision_id,
  title,actor_profile_id
)
select
  '52000000-0000-4000-8000-000000000006',
  campaign.id,
  '41000000-0000-4000-8000-000000000006',
  1,
  '51000000-0000-4000-8000-000000000006',
  'Draft',
  '30000000-0000-4000-8000-000000000006'
from public.campaigns campaign where campaign.slug='yuhara-main';
update public.sessions
set current_editorial_draft_id='52000000-0000-4000-8000-000000000006'
where id='41000000-0000-4000-8000-000000000006';

insert into public.transcript_revisions(id,campaign_id,session_id,revision_number)
select
  '51000000-0000-4000-8000-000000000007',
  campaign.id,
  '41000000-0000-4000-8000-000000000007',
  1
from public.campaigns campaign where campaign.slug='yuhara-main';
insert into public.session_editorial_drafts(
  id,campaign_id,session_id,revision,base_transcript_revision_id,
  title,actor_profile_id
)
select
  '52000000-0000-4000-8000-000000000007',
  campaign.id,
  '41000000-0000-4000-8000-000000000007',
  1,
  '51000000-0000-4000-8000-000000000007',
  'Draft published',
  '30000000-0000-4000-8000-000000000006'
from public.campaigns campaign where campaign.slug='yuhara-main';
insert into public.session_publications(
  id,campaign_id,session_id,version,draft_id,base_transcript_revision_id
)
select
  '53000000-0000-4000-8000-000000000007',
  campaign.id,
  '41000000-0000-4000-8000-000000000007',
  1,
  '52000000-0000-4000-8000-000000000007',
  '51000000-0000-4000-8000-000000000007'
from public.campaigns campaign where campaign.slug='yuhara-main';
update public.sessions
set current_session_publication_id='53000000-0000-4000-8000-000000000007'
where id='41000000-0000-4000-8000-000000000007';

insert into public.participants(session_id,character_entity_id,player_name,character_name)
values (
  '41000000-0000-4000-8000-000000000009',
  '20000000-0000-4000-8000-000000000001',
  'Player',
  'PC legado'
);

insert into public.entity_mentions(entity_id,session_id)
values (
  '20000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000010'
);

insert into public.role_assignments(
  id,profile_id,role_id,scope_type,scope_id,status,starts_at,ends_at
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba2',
  '30000000-0000-4000-8000-000000000006',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  'session',
  '41000000-0000-4000-8000-000000000011',
  'active',
  '2020-01-01',
  null
);

-- v2 populated fixture: two transcript revisions, two immutable drafts,
-- one active publication/receipt/event and one modern verified public cover.
insert into public.transcript_revisions(
  id,campaign_id,session_id,revision_number,parent_revision_id
)
select seed.id, c.id, '41000000-0000-4000-8000-000000000020', seed.revision, seed.parent_id
from (
  values
    ('51000000-0000-4000-8000-000000000020'::uuid,1::bigint,null::uuid),
    ('51000000-0000-4000-8000-000000000021'::uuid,2::bigint,'51000000-0000-4000-8000-000000000020'::uuid)
) seed(id,revision,parent_id)
cross join public.campaigns c
where c.slug='yuhara-main';

insert into public.media_assets(
  id,campaign_id,role_hint,status,staged_bucket,object_key,sha256,mime_type,
  byte_size,width,height,read_back_verified,public_bucket,public_object_key,
  public_delivery_verified,public_verified_at,created_by
)
select
  '54000000-0000-4000-8000-000000000020',
  c.id,
  'session_cover',
  'verified_public',
  'tda-media-private',
  'campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000020/cover/' || repeat('a',64) || '.webp',
  repeat('a',64),
  'image/webp',
  128,
  16,
  8,
  true,
  'tda-media-public',
  'campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000020/cover/' || repeat('a',64) || '.webp',
  true,
  clock_timestamp(),
  '30000000-0000-4000-8000-000000000006'
from public.campaigns c where c.slug='yuhara-main';

insert into public.session_editorial_drafts(
  id,campaign_id,session_id,revision,base_transcript_revision_id,cover_asset_id,
  arc,title,summary_short,summary_full,actor_profile_id,session_date,session_date_captured
)
select seed.id,c.id,'41000000-0000-4000-8000-000000000020',seed.revision,
  seed.base_revision,seed.cover,'Arc',seed.title,'short','full',
  '30000000-0000-4000-8000-000000000006','2026-01-02',true
from (
  values
    ('52000000-0000-4000-8000-000000000020'::uuid,1::bigint,'51000000-0000-4000-8000-000000000020'::uuid,null::text,'Draft r1'),
    ('52000000-0000-4000-8000-000000000021'::uuid,2::bigint,'51000000-0000-4000-8000-000000000021'::uuid,'54000000-0000-4000-8000-000000000020'::text,'Draft r2')
) seed(id,revision,base_revision,cover,title)
cross join public.campaigns c
where c.slug='yuhara-main';

insert into public.session_publications(
  id,campaign_id,session_id,version,draft_id,base_transcript_revision_id,
  cover_asset_id,cover_url,payload_sha256
)
select
  '53000000-0000-4000-8000-000000000020',
  c.id,
  '41000000-0000-4000-8000-000000000020',
  1,
  '52000000-0000-4000-8000-000000000021',
  '51000000-0000-4000-8000-000000000021',
  '54000000-0000-4000-8000-000000000020',
  'https://media.dnd.faysk.dev/campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000020/cover/' || repeat('a',64) || '.webp',
  repeat('b',64)
from public.campaigns c where c.slug='yuhara-main';

insert into public.session_publication_operations(
  operation_id,campaign_id,session_id,draft_id,publication_id
)
select
  '55000000-0000-4000-8000-000000000020',
  c.id,
  '41000000-0000-4000-8000-000000000020',
  '52000000-0000-4000-8000-000000000021',
  '53000000-0000-4000-8000-000000000020'
from public.campaigns c where c.slug='yuhara-main';

insert into public.transcript_publication_receipts(
  campaign_id,session_id,revision_id,operation_id
)
select c.id,'41000000-0000-4000-8000-000000000020',
  '51000000-0000-4000-8000-000000000021',
  '56000000-0000-4000-8000-000000000020'
from public.campaigns c where c.slug='yuhara-main';

insert into public.transcript_publication_events(
  campaign_id,session_id,revision_id,previous_revision_id,operation_id
)
select c.id,'41000000-0000-4000-8000-000000000020',
  '51000000-0000-4000-8000-000000000021',
  '51000000-0000-4000-8000-000000000020',
  '57000000-0000-4000-8000-000000000020'
from public.campaigns c where c.slug='yuhara-main';

update public.sessions
set
  current_transcript_revision_id='51000000-0000-4000-8000-000000000021',
  current_editorial_draft_id='52000000-0000-4000-8000-000000000021',
  current_session_publication_id='53000000-0000-4000-8000-000000000020',
  metadata=jsonb_build_object(
    'coverImageUrl',
    'https://media.dnd.faysk.dev/campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000020/cover/' || repeat('a',64) || '.webp',
    'heroImageUrl',
    'https://media.dnd.faysk.dev/campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000020/cover/' || repeat('a',64) || '.webp'
  )
where id='41000000-0000-4000-8000-000000000020';

-- v2 explicit reconciliation fixture.
insert into public.participants(session_id,character_entity_id,player_name,character_name)
values (
  '41000000-0000-4000-8000-000000000021',
  '20000000-0000-4000-8000-000000000001',
  'Player manual',
  'PC legado'
);
insert into public.entity_mentions(entity_id,session_id)
values (
  '20000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000021'
);
insert into public.canon_candidates(session_id,related_entity_ids)
values (
  '41000000-0000-4000-8000-000000000021',
  array['20000000-0000-4000-8000-000000000001'::uuid]
);
insert into public.role_assignments(
  id,profile_id,role_id,scope_type,scope_id,status,starts_at
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba3',
  '30000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'session',
  '41000000-0000-4000-8000-000000000021',
  'active',
  '2020-01-01'
);

-- A candidate with materialized canon remains an explicit hard blocker.
insert into public.canon_candidates(id,session_id,related_entity_ids)
values (
  '58000000-0000-4000-8000-000000000022',
  '41000000-0000-4000-8000-000000000022',
  array['20000000-0000-4000-8000-000000000001'::uuid]
);
insert into public.canon_entries(
  campaign_id,entity_id,title,content,source_candidate_id
)
select c.id,'20000000-0000-4000-8000-000000000001','Synthetic canon','Synthetic',
  '58000000-0000-4000-8000-000000000022'
from public.campaigns c where c.slug='yuhara-main';
