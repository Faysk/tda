-- #1129 — safe campaign-aware session move
-- Candidate only until the cross-campaign gate #1138 is green.

create table if not exists public.session_campaign_move_operations (
  operation_id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete restrict,
  source_campaign_id uuid not null references public.campaigns(id) on delete restrict,
  destination_campaign_id uuid not null references public.campaigns(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  source_session_id text null,
  committed_at timestamptz not null default now()
);

alter table public.session_campaign_move_operations enable row level security;
revoke all on table public.session_campaign_move_operations from anon, authenticated;
grant select, insert on table public.session_campaign_move_operations to service_role;

create or replace function public.preflight_session_campaign_move(
  p_session_id uuid,
  p_source_campaign_slug text,
  p_destination_campaign_slug text
)
returns table(status text, source_campaign_id uuid, destination_campaign_id uuid, blockers jsonb)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_session public.sessions%rowtype;
  v_source uuid;
  v_destination uuid;
  v_blockers jsonb := '[]'::jsonb;
begin
  select id into v_source from public.campaigns where slug = p_source_campaign_slug;
  select id into v_destination from public.campaigns where slug = p_destination_campaign_slug;

  if v_source is null or v_destination is null or v_source = v_destination then
    return query select 'invalid_target', v_source, v_destination, '["invalid_target"]'::jsonb;
    return;
  end if;

  select * into v_session
  from public.sessions
  where id = p_session_id and campaign_id = v_source;

  if not found then
    return query select 'not_found', v_source, v_destination, '[]'::jsonb;
    return;
  end if;

  if v_session.status = 'published' or v_session.current_session_publication_id is not null then
    v_blockers := v_blockers || '"published_session"'::jsonb;
  end if;
  if v_session.current_transcript_revision_id is not null
     or exists(select 1 from public.transcript_revisions r where r.session_id = p_session_id) then
    v_blockers := v_blockers || '"transcript_revision"'::jsonb;
  end if;
  if v_session.current_editorial_draft_id is not null
     or exists(select 1 from public.session_editorial_drafts d where d.session_id = p_session_id) then
    v_blockers := v_blockers || '"editorial_draft"'::jsonb;
  end if;
  if exists(select 1 from public.session_publications p where p.session_id = p_session_id)
     or exists(select 1 from public.session_publication_operations o where o.session_id = p_session_id) then
    v_blockers := v_blockers || '"publication_history"'::jsonb;
  end if;
  if exists(
    select 1 from public.media_assets m
    where m.campaign_id = v_source
      and (
        m.object_key like ('campaigns/' || p_source_campaign_slug || '/sessions/' || p_session_id::text || '/%')
        or m.public_object_key like ('campaigns/' || p_source_campaign_slug || '/sessions/' || p_session_id::text || '/%')
      )
  ) then
    v_blockers := v_blockers || '"session_media"'::jsonb;
  end if;
  if exists(select 1 from public.review_decisions r where r.session_id = p_session_id)
     or exists(select 1 from public.canon_candidates c where c.session_id = p_session_id) then
    v_blockers := v_blockers || '"review_or_canon"'::jsonb;
  end if;
  if exists(
    select 1 from public.participants p
    where p.session_id = p_session_id and p.character_entity_id is not null
  ) then
    v_blockers := v_blockers || '"entity_linked_participant"'::jsonb;
  end if;
  if v_session.source_session_id is not null and exists(
    select 1 from public.sessions sibling
    where sibling.campaign_id = v_destination
      and sibling.source_session_id = v_session.source_session_id
      and sibling.id <> p_session_id
  ) then
    v_blockers := v_blockers || '"destination_source_collision"'::jsonb;
  end if;

  return query
  select case when jsonb_array_length(v_blockers) = 0 then 'ready' else 'blocked' end,
         v_source,
         v_destination,
         v_blockers;
end;
$$;

revoke all on function public.preflight_session_campaign_move(uuid,text,text) from public, anon, authenticated;
grant execute on function public.preflight_session_campaign_move(uuid,text,text) to service_role;

create or replace function public.move_session_campaign_atomic(
  p_operation_id uuid,
  p_actor_profile_id uuid,
  p_session_id uuid,
  p_source_campaign_slug text,
  p_destination_campaign_slug text
)
returns table(status text, blockers jsonb, source_campaign_id uuid, destination_campaign_id uuid)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_session public.sessions%rowtype;
  v_source uuid;
  v_destination uuid;
  v_preflight record;
  v_existing public.session_campaign_move_operations%rowtype;
begin
  select * into v_existing
  from public.session_campaign_move_operations
  where operation_id = p_operation_id;

  if found then
    if v_existing.session_id <> p_session_id
       or v_existing.actor_profile_id <> p_actor_profile_id then
      return query select 'operation_conflict', '[]'::jsonb,
        v_existing.source_campaign_id, v_existing.destination_campaign_id;
    else
      return query select 'replay', '[]'::jsonb,
        v_existing.source_campaign_id, v_existing.destination_campaign_id;
    end if;
    return;
  end if;

  select id into v_source from public.campaigns where slug = p_source_campaign_slug;
  select id into v_destination from public.campaigns where slug = p_destination_campaign_slug;
  if v_source is null or v_destination is null or v_source = v_destination then
    return query select 'invalid_target', '["invalid_target"]'::jsonb, v_source, v_destination;
    return;
  end if;

  select * into v_session
  from public.sessions
  where id = p_session_id and campaign_id = v_source
  for update;

  if not found then
    return query select 'not_found', '[]'::jsonb, v_source, v_destination;
    return;
  end if;

  select * into v_preflight
  from public.preflight_session_campaign_move(
    p_session_id,
    p_source_campaign_slug,
    p_destination_campaign_slug
  );

  if v_preflight.status <> 'ready' then
    return query select v_preflight.status, v_preflight.blockers, v_source, v_destination;
    return;
  end if;

  update public.sessions
  set campaign_id = v_destination,
      updated_at = now()
  where id = p_session_id and campaign_id = v_source;

  if not found then
    return query select 'conflict', '[]'::jsonb, v_source, v_destination;
    return;
  end if;

  insert into public.session_campaign_move_operations(
    operation_id, session_id, source_campaign_id, destination_campaign_id,
    actor_profile_id, source_session_id
  ) values (
    p_operation_id, p_session_id, v_source, v_destination,
    p_actor_profile_id, v_session.source_session_id
  );

  insert into public.audit_log(
    campaign_id, session_id, actor_id, action, table_name, record_id, old_value, new_value
  ) values (
    v_destination, p_session_id, p_actor_profile_id, 'session_campaign_move',
    'sessions', p_session_id,
    jsonb_build_object('campaign_id', v_source),
    jsonb_build_object(
      'campaign_id', v_destination,
      'operation_id', p_operation_id,
      'source_session_id', v_session.source_session_id
    )
  );

  return query select 'moved', '[]'::jsonb, v_source, v_destination;
end;
$$;

revoke all on function public.move_session_campaign_atomic(uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.move_session_campaign_atomic(uuid,uuid,uuid,text,text) to service_role;
