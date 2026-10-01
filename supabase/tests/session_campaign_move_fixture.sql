-- Synthetic #1129 extension applied after #1123 + #1134 fixtures/candidates.

alter table public.sessions
  add column if not exists updated_at timestamptz not null default clock_timestamp(),
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists current_transcript_revision_id uuid,
  add column if not exists current_editorial_draft_id uuid,
  add column if not exists current_session_publication_id uuid;

insert into public.permission_catalog(action, plane, description)
values ('campaign.content.edit', 'narrative', 'Edit campaign-owned content')
on conflict (action) do nothing;

insert into public.role_definitions(id, slug, name, plane, description)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
  'session-move-editor',
  'Session move editor',
  'narrative',
  'Synthetic #1129 move role'
)
on conflict (id) do nothing;

insert into public.role_permissions(role_id, permission_action)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', 'campaign.content.edit')
on conflict do nothing;

-- Actor 1 can edit both A and B. Actor 6 can edit only A to prove destination
-- authorization is independently required.
insert into public.role_assignments(
  id, profile_id, role_id, scope_type, scope_id, status, starts_at
) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1','30000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6','campaign','yuhara-main','active','2020-01-01'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc2','30000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6','campaign','antes-que-seja-tarde','active','2020-01-01'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc3','30000000-0000-4000-8000-000000000006','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6','campaign','yuhara-main','active','2020-01-01')
on conflict (id) do nothing;

create table public.transcript_revisions (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id),
  source_session_id text,
  payload jsonb not null default '{}'::jsonb
);

create table public.transcript_publication_receipts (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id)
);

create table public.transcript_assembly_publication_receipts (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id)
);

create table public.transcript_publication_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id)
);

create table public.session_editorial_drafts (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id),
  cover_asset_id text
);

create table public.session_publications (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id),
  cover_url text not null default 'https://example.invalid/legacy-cover.webp'
);

create table public.session_publication_operations (
  operation_id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid not null references public.sessions(id)
);

create table public.ai_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid references public.sessions(id)
);

create table public.discord_interactions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid references public.sessions(id)
);

create table public.table_notes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id),
  session_id uuid references public.sessions(id)
);

create table public.publications (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id)
);

create table public.canon_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id)
);

create table public.entity_mentions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id),
  entity_id uuid references public.entities(id)
);

create table public.media_assets (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id),
  role_hint text not null,
  object_key text not null
);

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

alter table public.sessions
  add constraint sessions_current_transcript_revision_fk
  foreign key (current_transcript_revision_id) references public.transcript_revisions(id);

alter table public.sessions
  add constraint sessions_current_editorial_draft_fk
  foreign key (current_editorial_draft_id) references public.session_editorial_drafts(id);

alter table public.sessions
  add constraint sessions_current_publication_fk
  foreign key (current_session_publication_id) references public.session_publications(id);

-- Sessions used by the move matrix.
insert into public.sessions(
  id,campaign_id,title,status,source_system,source_session_id,updated_at
)
select v.id, c.id, v.title, v.status, 'local_companion', v.source_id, v.updated_at
from public.campaigns c
cross join (
  values
    ('40000000-0000-4000-8000-000000000101'::uuid,'Move empty','ready_for_review','move-empty','2026-10-01 00:00:01+00'::timestamptz),
    ('40000000-0000-4000-8000-000000000102'::uuid,'Move transcript','ready_for_review','move-transcript','2026-10-01 00:00:02+00'::timestamptz),
    ('40000000-0000-4000-8000-000000000103'::uuid,'Move draft','ready_for_review','move-draft','2026-10-01 00:00:03+00'::timestamptz),
    ('40000000-0000-4000-8000-000000000104'::uuid,'Published active','published','move-published','2026-10-01 00:00:04+00'::timestamptz),
    ('40000000-0000-4000-8000-000000000105'::uuid,'Cover R2','ready_for_review','move-cover','2026-10-01 00:00:05+00'::timestamptz),
    ('40000000-0000-4000-8000-000000000106'::uuid,'Entity participant','ready_for_review','move-entity','2026-10-01 00:00:06+00'::timestamptz),
    ('40000000-0000-4000-8000-000000000107'::uuid,'Canon provenance','ready_for_review','move-canon','2026-10-01 00:00:07+00'::timestamptz),
    ('40000000-0000-4000-8000-000000000108'::uuid,'Collision source','ready_for_review','shared-source','2026-10-01 00:00:08+00'::timestamptz),
    ('40000000-0000-4000-8000-000000000109'::uuid,'Concurrent','ready_for_review','move-concurrent','2026-10-01 00:00:09+00'::timestamptz),
    ('40000000-0000-4000-8000-000000000110'::uuid,'Scoped grant','ready_for_review','move-scoped','2026-10-01 00:00:10+00'::timestamptz)
) as v(id,title,status,source_id,updated_at)
where c.slug='yuhara-main';

insert into public.sessions(
  id,campaign_id,title,status,source_system,source_session_id,updated_at
)
select
  '40000000-0000-4000-8000-000000000208',
  c.id,
  'Collision destination',
  'ready_for_review',
  'other_system',
  'shared-source',
  '2026-10-01 00:10:08+00'
from public.campaigns c
where c.slug='antes-que-seja-tarde';

insert into public.transcript_revisions(id,campaign_id,session_id,source_session_id,payload)
select
  '50000000-0000-4000-8000-000000000102',
  c.id,
  '40000000-0000-4000-8000-000000000102',
  'move-transcript',
  '{"text":"synthetic fixture only"}'::jsonb
from public.campaigns c where c.slug='yuhara-main';

update public.sessions
set current_transcript_revision_id='50000000-0000-4000-8000-000000000102'
where id='40000000-0000-4000-8000-000000000102';

insert into public.transcript_publication_receipts(id,campaign_id,session_id)
select '51000000-0000-4000-8000-000000000102',c.id,'40000000-0000-4000-8000-000000000102'
from public.campaigns c where c.slug='yuhara-main';

insert into public.transcript_assembly_publication_receipts(id,campaign_id,session_id)
select '52000000-0000-4000-8000-000000000102',c.id,'40000000-0000-4000-8000-000000000102'
from public.campaigns c where c.slug='yuhara-main';

insert into public.transcript_publication_events(campaign_id,session_id)
select c.id,'40000000-0000-4000-8000-000000000102'
from public.campaigns c where c.slug='yuhara-main';

insert into public.ai_usage_ledger(campaign_id,session_id)
select c.id,'40000000-0000-4000-8000-000000000102'
from public.campaigns c where c.slug='yuhara-main';

insert into public.discord_interactions(campaign_id,session_id)
select c.id,'40000000-0000-4000-8000-000000000102'
from public.campaigns c where c.slug='yuhara-main';

insert into public.table_notes(campaign_id,session_id)
select c.id,'40000000-0000-4000-8000-000000000102'
from public.campaigns c where c.slug='yuhara-main';

insert into public.session_editorial_drafts(id,campaign_id,session_id,cover_asset_id)
select
  '60000000-0000-4000-8000-000000000103',
  c.id,
  '40000000-0000-4000-8000-000000000103',
  null
from public.campaigns c where c.slug='yuhara-main';

update public.sessions
set current_editorial_draft_id='60000000-0000-4000-8000-000000000103'
where id='40000000-0000-4000-8000-000000000103';

insert into public.session_publications(id,campaign_id,session_id,cover_url)
select
  '70000000-0000-4000-8000-000000000104',
  c.id,
  '40000000-0000-4000-8000-000000000104',
  'https://media.example.invalid/legacy.webp'
from public.campaigns c where c.slug='yuhara-main';

update public.sessions
set current_session_publication_id='70000000-0000-4000-8000-000000000104'
where id='40000000-0000-4000-8000-000000000104';

insert into public.session_editorial_drafts(id,campaign_id,session_id,cover_asset_id)
select
  '60000000-0000-4000-8000-000000000105',
  c.id,
  '40000000-0000-4000-8000-000000000105',
  '80000000-0000-4000-8000-000000000105'
from public.campaigns c where c.slug='yuhara-main';

insert into public.media_assets(id,campaign_id,role_hint,object_key)
select
  '80000000-0000-4000-8000-000000000105',
  c.id,
  'session_cover',
  'campaigns/yuhara-main/sessions/40000000-0000-4000-8000-000000000105/cover/aaaaaaaa.webp'
from public.campaigns c where c.slug='yuhara-main';

insert into public.participants(session_id,character_entity_id,player_name,character_name)
values (
  '40000000-0000-4000-8000-000000000106',
  '20000000-0000-4000-8000-000000000001',
  'Synthetic player',
  'PC legado'
);

insert into public.canon_candidates(session_id)
values ('40000000-0000-4000-8000-000000000107');

insert into public.entity_mentions(session_id,entity_id)
values (
  '40000000-0000-4000-8000-000000000107',
  '20000000-0000-4000-8000-000000000001'
);

insert into public.role_assignments(
  id, profile_id, role_id, scope_type, scope_id, status, starts_at
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbd0',
  '30000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6',
  'session',
  '40000000-0000-4000-8000-000000000110',
  'active',
  '2020-01-01'
);
