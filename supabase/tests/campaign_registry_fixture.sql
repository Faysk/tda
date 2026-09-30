-- Synthetic pre-#1123 schema. No Production data or credentials.

create table public.campaigns (
  id uuid primary key,
  name text not null,
  slug text not null unique,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.entities (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  slug text,
  entity_type text not null default 'pc',
  unique (campaign_id, name)
);

create unique index entities_campaign_slug_unique
  on public.entities(campaign_id, slug)
  where slug is not null;

create table public.profile_characters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  profile_id uuid not null,
  entity_id uuid references public.entities(id) on delete restrict,
  character_name text not null
);

create table public.sessions (
  id uuid primary key,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  title text not null,
  status text not null,
  source_system text,
  source_session_id text
);

create unique index sessions_source_external_unique
  on public.sessions(campaign_id, source_system, source_session_id)
  where source_system is not null and source_session_id is not null;

insert into public.campaigns (
  id,
  name,
  slug,
  description,
  metadata
) values (
  '10000000-0000-4000-8000-000000000001',
  'Nome legado',
  'yuhara-main',
  null,
  '{}'::jsonb
);

insert into public.entities (
  id,
  campaign_id,
  name,
  slug,
  entity_type
) values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'PC legado',
  'mesmo-slug',
  'pc'
);

insert into public.profile_characters (
  campaign_id,
  profile_id,
  entity_id,
  character_name
) values (
  '10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'PC legado'
);
