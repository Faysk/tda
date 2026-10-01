-- Synthetic extension for #1129 session campaign move.
-- Applied after #1123 + #1134 scratch fixtures/candidates.

alter table public.sessions
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists current_transcript_revision_id uuid,
  add column if not exists current_editorial_draft_id uuid,
  add column if not exists current_session_publication_id uuid;

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid,
  session_id uuid,
  actor_id uuid,
  action text not null,
  table_name text not null,
  record_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create table public.transcript_revisions (
  id uuid primary key,
  campaign_id uuid not null,
  session_id uuid not null
);
create table public.session_editorial_drafts (
  id uuid primary key,
  campaign_id uuid not null,
  session_id uuid not null
);
create table public.session_publications (
  id uuid primary key,
  campaign_id uuid not null,
  session_id uuid not null
);
create table public.session_publication_operations (
  operation_id uuid primary key,
  campaign_id uuid not null,
  session_id uuid not null
);
create table public.entity_mentions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid
);

insert into public.permission_catalog(action, plane, description) values
  ('campaign.content.edit', 'narrative', 'Edit campaign content'),
  ('campaign.transcript.read', 'narrative', 'Read campaign transcript')
on conflict (action) do nothing;

insert into public.role_permissions(role_id, permission_action) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'campaign.content.edit'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'campaign.transcript.read')
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
    ('41000000-0000-4000-8000-000000000012'::uuid,'Move concurrent','ready_for_review','move-concurrent','{}'::jsonb)
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

insert into public.transcript_revisions(id,campaign_id,session_id)
select
  '51000000-0000-4000-8000-000000000005',
  campaign.id,
  '41000000-0000-4000-8000-000000000005'
from public.campaigns campaign where campaign.slug='yuhara-main';
update public.sessions
set current_transcript_revision_id='51000000-0000-4000-8000-000000000005'
where id='41000000-0000-4000-8000-000000000005';

insert into public.session_editorial_drafts(id,campaign_id,session_id)
select
  '52000000-0000-4000-8000-000000000006',
  campaign.id,
  '41000000-0000-4000-8000-000000000006'
from public.campaigns campaign where campaign.slug='yuhara-main';
update public.sessions
set current_editorial_draft_id='52000000-0000-4000-8000-000000000006'
where id='41000000-0000-4000-8000-000000000006';

insert into public.session_publications(id,campaign_id,session_id)
select
  '53000000-0000-4000-8000-000000000007',
  campaign.id,
  '41000000-0000-4000-8000-000000000007'
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

insert into public.entity_mentions(session_id)
values ('41000000-0000-4000-8000-000000000010');

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
