-- #1129 — safe campaign-aware session move
-- Candidate only until the cross-campaign gate #1138 is green.
--
-- This boundary deliberately moves only sessions whose campaign-owned
-- dependencies are proven safe. Domains without a reviewed rebind policy block
-- the operation instead of being cloned, rewritten or silently orphaned.

create table if not exists public.session_campaign_move_operations (
  operation_id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete restrict,
  source_campaign_id uuid not null references public.campaigns(id) on delete restrict,
  destination_campaign_id uuid not null references public.campaigns(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  source_session_id text not null check (char_length(source_session_id) between 1 and 220),
  committed_at timestamptz not null default clock_timestamp()
);

alter table public.session_campaign_move_operations enable row level security;
revoke all on table public.session_campaign_move_operations from public, anon, authenticated;
grant select, insert on table public.session_campaign_move_operations to service_role;

create index if not exists session_campaign_move_operations_session_id_idx
  on public.session_campaign_move_operations(session_id);

create index if not exists session_campaign_move_operations_source_campaign_id_idx
  on public.session_campaign_move_operations(source_campaign_id);

create index if not exists session_campaign_move_operations_destination_campaign_id_idx
  on public.session_campaign_move_operations(destination_campaign_id);

create or replace function public.preflight_session_campaign_move(
  p_actor_profile_id uuid,
  p_session_id uuid,
  p_source_session_id text,
  p_source_campaign_slug text,
  p_destination_campaign_slug text
)
returns table(
  status text,
  source_campaign_id uuid,
  destination_campaign_id uuid,
  blockers jsonb
)
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
  if p_actor_profile_id is null
     or p_session_id is null
     or p_source_session_id is null
     or char_length(p_source_session_id) not between 1 and 220
     or p_source_campaign_slug is null
     or btrim(p_source_campaign_slug) = ''
     or p_destination_campaign_slug is null
     or btrim(p_destination_campaign_slug) = ''
     or p_source_campaign_slug = p_destination_campaign_slug then
    return query
    select 'invalid_target'::text, null::uuid, null::uuid, '["invalid_target"]'::jsonb;
    return;
  end if;

  select c.id
  into v_source
  from public.campaigns c
  where c.slug = p_source_campaign_slug
    and c.lifecycle = 'active';

  select c.id
  into v_destination
  from public.campaigns c
  where c.slug = p_destination_campaign_slug
    and c.lifecycle = 'active';

  if v_source is null or v_destination is null or v_source = v_destination then
    return query
    select 'invalid_target'::text, v_source, v_destination, '["invalid_target"]'::jsonb;
    return;
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
  ) then
    return query select 'forbidden'::text, v_source, v_destination, '[]'::jsonb;
    return;
  end if;

  -- Defense in depth: both campaigns require current content-edit authority.
  -- The web action performs the same authorization before invoking this RPC.
  if exists (
    select 1
    from (values (p_source_campaign_slug), (p_destination_campaign_slug)) wanted(slug)
    where not exists (
      select 1
      from public.role_assignments a
      join public.role_permissions rp on rp.role_id = a.role_id
      where a.profile_id = p_actor_profile_id
        and a.status = 'active'
        and a.starts_at <= clock_timestamp()
        and (a.ends_at is null or a.ends_at > clock_timestamp())
        and rp.permission_action = 'campaign.content.edit'
        and (
          (a.scope_type = 'campaign' and a.scope_id = wanted.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda')
        )
    )
  ) then
    return query select 'forbidden'::text, v_source, v_destination, '[]'::jsonb;
    return;
  end if;

  select s.*
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = v_source
    and s.source_session_id = p_source_session_id;

  if not found then
    return query select 'not_found'::text, v_source, v_destination, '[]'::jsonb;
    return;
  end if;

  -- Public state is never implicitly redirected/unpublished by a move.
  if v_session.status = 'published'
     or v_session.current_session_publication_id is not null then
    v_blockers := v_blockers || '"published_session"'::jsonb;
  end if;

  -- Modern private transcript revisions are immutable and campaign-bound.
  if v_session.current_transcript_revision_id is not null
     or exists (
       select 1
       from public.transcript_revisions r
       where r.session_id = p_session_id
     ) then
    v_blockers := v_blockers || '"transcript_revision"'::jsonb;
  end if;

  if v_session.current_editorial_draft_id is not null
     or exists (
       select 1
       from public.session_editorial_drafts d
       where d.session_id = p_session_id
     ) then
    v_blockers := v_blockers || '"editorial_draft"'::jsonb;
  end if;

  -- Both the new immutable publication domain and the historical publication
  -- table block until an explicit cross-campaign publication policy exists.
  if exists (
       select 1
       from public.session_publications p
       where p.session_id = p_session_id
     )
     or exists (
       select 1
       from public.session_publication_operations o
       where o.session_id = p_session_id
     )
     or exists (
       select 1
       from public.publications p
       where p.session_id = p_session_id
     ) then
    v_blockers := v_blockers || '"publication_history"'::jsonb;
  end if;

  -- R2 object keys are campaign namespaces. Never rename/copy/rebind objects
  -- inside this transaction.
  if exists (
    select 1
    from public.media_assets m
    where m.campaign_id = v_source
      and (
        m.object_key like (
          'campaigns/' || p_source_campaign_slug || '/sessions/' ||
          p_session_id::text || '/%'
        )
        or m.public_object_key like (
          'campaigns/' || p_source_campaign_slug || '/sessions/' ||
          p_session_id::text || '/%'
        )
      )
  ) then
    v_blockers := v_blockers || '"session_media"'::jsonb;
  end if;

  if exists (
       select 1 from public.review_decisions r
       where r.session_id = p_session_id
     )
     or exists (
       select 1 from public.canon_candidates c
       where c.session_id = p_session_id
     )
     or exists (
       select 1 from public.quote_candidates q
       where q.session_id = p_session_id
     )
     or exists (
       select 1 from public.outtake_candidates o
       where o.session_id = p_session_id
     ) then
    v_blockers := v_blockers || '"review_or_canon"'::jsonb;
  end if;

  -- Participant occurrences without a character entity can follow the session.
  -- An entity binding cannot: entity ownership is campaign-qualified.
  if exists (
    select 1
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null
  ) then
    v_blockers := v_blockers || '"entity_linked_participant"'::jsonb;
  end if;

  -- Conservative lineage gate. These records are evidence/processing history.
  -- Some are only session-bound today, while others also carry campaign context;
  -- none is silently rewritten until its move policy is reviewed explicitly.
  if exists (select 1 from public.recording_files r where r.session_id = p_session_id)
     or exists (select 1 from public.processing_jobs j where j.session_id = p_session_id)
     or exists (select 1 from public.audio_chunks a where a.session_id = p_session_id)
     or exists (select 1 from public.audio_speech_slices s where s.session_id = p_session_id)
     or exists (select 1 from public.transcript_segments t where t.session_id = p_session_id)
     or exists (select 1 from public.roll20_events e where e.session_id = p_session_id)
     or exists (select 1 from public.session_markers m where m.session_id = p_session_id)
     or exists (select 1 from public.table_notes n where n.session_id = p_session_id)
     or exists (select 1 from public.discord_interactions d where d.session_id = p_session_id)
     or exists (select 1 from public.entity_mentions e where e.session_id = p_session_id)
     or exists (select 1 from public.ai_usage_ledger a where a.session_id = p_session_id)
     or exists (select 1 from public.audio_artifacts a where a.session_id = p_session_id)
     or exists (select 1 from public.craig_manifests c where c.session_id = p_session_id) then
    v_blockers := v_blockers || '"session_evidence_or_lineage"'::jsonb;
  end if;

  -- Session-scoped grants must not silently change campaign meaning.
  if exists (
    select 1
    from public.role_assignments a
    where a.scope_type = 'session'
      and a.scope_id = p_session_id::text
      and a.status in ('active', 'eligible')
  ) then
    v_blockers := v_blockers || '"session_scoped_access"'::jsonb;
  end if;

  -- source_session_id is intentionally unique only inside a campaign.
  if exists (
    select 1
    from public.sessions sibling
    where sibling.campaign_id = v_destination
      and sibling.source_session_id = p_source_session_id
      and sibling.id <> p_session_id
  ) then
    v_blockers := v_blockers || '"destination_source_collision"'::jsonb;
  end if;

  return query
  select
    case
      when jsonb_array_length(v_blockers) = 0 then 'ready'
      else 'blocked'
    end,
    v_source,
    v_destination,
    v_blockers;
end;
$$;

comment on function public.preflight_session_campaign_move(
  uuid, uuid, text, text, text
) is
'Server-only, zero-write #1129 preflight. Reauthorizes actor in source and destination and returns explicit blockers for campaign-bound session dependencies.';

revoke all on function public.preflight_session_campaign_move(
  uuid, uuid, text, text, text
) from public;
revoke execute on function public.preflight_session_campaign_move(
  uuid, uuid, text, text, text
) from anon;
revoke execute on function public.preflight_session_campaign_move(
  uuid, uuid, text, text, text
) from authenticated;
grant execute on function public.preflight_session_campaign_move(
  uuid, uuid, text, text, text
) to service_role;

create or replace function public.move_session_campaign_atomic(
  p_operation_id uuid,
  p_actor_profile_id uuid,
  p_session_id uuid,
  p_source_session_id text,
  p_source_campaign_slug text,
  p_destination_campaign_slug text
)
returns table(
  status text,
  blockers jsonb,
  source_campaign_id uuid,
  destination_campaign_id uuid
)
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
  if p_operation_id is null
     or p_actor_profile_id is null
     or p_session_id is null
     or p_source_session_id is null
     or char_length(p_source_session_id) not between 1 and 220
     or p_source_campaign_slug is null
     or btrim(p_source_campaign_slug) = ''
     or p_destination_campaign_slug is null
     or btrim(p_destination_campaign_slug) = ''
     or p_source_campaign_slug = p_destination_campaign_slug then
    return query
    select 'invalid_target'::text, '["invalid_target"]'::jsonb, null::uuid, null::uuid;
    return;
  end if;

  select c.id
  into v_source
  from public.campaigns c
  where c.slug = p_source_campaign_slug
    and c.lifecycle = 'active';

  select c.id
  into v_destination
  from public.campaigns c
  where c.slug = p_destination_campaign_slug
    and c.lifecycle = 'active';

  if v_source is null or v_destination is null or v_source = v_destination then
    return query
    select 'invalid_target'::text, '["invalid_target"]'::jsonb, v_source, v_destination;
    return;
  end if;

  -- Reauthorize before exposing a receipt or target state.
  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
  )
  or exists (
    select 1
    from (values (p_source_campaign_slug), (p_destination_campaign_slug)) wanted(slug)
    where not exists (
      select 1
      from public.role_assignments a
      join public.role_permissions rp on rp.role_id = a.role_id
      where a.profile_id = p_actor_profile_id
        and a.status = 'active'
        and a.starts_at <= clock_timestamp()
        and (a.ends_at is null or a.ends_at > clock_timestamp())
        and rp.permission_action = 'campaign.content.edit'
        and (
          (a.scope_type = 'campaign' and a.scope_id = wanted.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda')
        )
    )
  ) then
    return query select 'forbidden'::text, '[]'::jsonb, v_source, v_destination;
    return;
  end if;

  select o.*
  into v_existing
  from public.session_campaign_move_operations o
  where o.operation_id = p_operation_id;

  if found then
    if v_existing.session_id <> p_session_id
       or v_existing.actor_profile_id <> p_actor_profile_id
       or v_existing.source_campaign_id <> v_source
       or v_existing.destination_campaign_id <> v_destination
       or v_existing.source_session_id <> p_source_session_id then
      return query
      select 'operation_conflict'::text, '[]'::jsonb,
             v_existing.source_campaign_id, v_existing.destination_campaign_id;
    else
      return query
      select 'replay'::text, '[]'::jsonb,
             v_existing.source_campaign_id, v_existing.destination_campaign_id;
    end if;
    return;
  end if;

  -- Serialize the exact source session. A second concurrent move observes the
  -- committed destination and returns not_found/conflict instead of double-write.
  select s.*
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = v_source
    and s.source_session_id = p_source_session_id
  for update;

  if not found then
    return query select 'not_found'::text, '[]'::jsonb, v_source, v_destination;
    return;
  end if;

  -- Serialize the destination logical identity among callers of this boundary.
  -- The campaign-qualified unique index remains the final race fence against
  -- writers that do not participate in this advisory lock.
  perform pg_advisory_xact_lock(
    hashtextextended(
      v_destination::text || ':' ||
      coalesce(v_session.source_system, '') || ':' ||
      p_source_session_id,
      0
    )
  );

  select *
  into v_preflight
  from public.preflight_session_campaign_move(
    p_actor_profile_id,
    p_session_id,
    p_source_session_id,
    p_source_campaign_slug,
    p_destination_campaign_slug
  );

  if v_preflight.status <> 'ready' then
    return query
    select v_preflight.status, v_preflight.blockers, v_source, v_destination;
    return;
  end if;

  begin
    update public.sessions s
    set campaign_id = v_destination,
        updated_at = clock_timestamp()
    where s.id = p_session_id
      and s.campaign_id = v_source
      and s.source_session_id = p_source_session_id;

    if not found then
      return query select 'conflict'::text, '[]'::jsonb, v_source, v_destination;
      return;
    end if;

    insert into public.session_campaign_move_operations(
      operation_id,
      session_id,
      source_campaign_id,
      destination_campaign_id,
      actor_profile_id,
      source_session_id
    ) values (
      p_operation_id,
      p_session_id,
      v_source,
      v_destination,
      p_actor_profile_id,
      p_source_session_id
    );

    insert into public.audit_log(
      campaign_id,
      session_id,
      actor_id,
      action,
      table_name,
      record_id,
      old_value,
      new_value
    ) values (
      v_destination,
      p_session_id,
      p_actor_profile_id,
      'session_campaign_move',
      'sessions',
      p_session_id,
      jsonb_build_object(
        'campaignId', v_source,
        'campaignSlug', p_source_campaign_slug,
        'sourceSessionId', p_source_session_id
      ),
      jsonb_build_object(
        'campaignId', v_destination,
        'campaignSlug', p_destination_campaign_slug,
        'sourceSessionId', p_source_session_id,
        'operationId', p_operation_id
      )
    );
  exception
    when unique_violation or foreign_key_violation then
      -- The subtransaction above is rolled back in full. No receipt or audit row
      -- survives a destination collision or a concurrent integrity change.
      return query select 'conflict'::text, '[]'::jsonb, v_source, v_destination;
      return;
  end;

  return query select 'moved'::text, '[]'::jsonb, v_source, v_destination;
end;
$$;

comment on function public.move_session_campaign_atomic(
  uuid, uuid, uuid, text, text, text
) is
'Server-only #1129 atomic move for dependency-free sessions. Reauthorizes both campaigns, locks source identity, re-runs preflight, writes one receipt and metadata-only audit row, and is idempotent by operation_id.';

revoke all on function public.move_session_campaign_atomic(
  uuid, uuid, uuid, text, text, text
) from public;
revoke execute on function public.move_session_campaign_atomic(
  uuid, uuid, uuid, text, text, text
) from anon;
revoke execute on function public.move_session_campaign_atomic(
  uuid, uuid, uuid, text, text, text
) from authenticated;
grant execute on function public.move_session_campaign_atomic(
  uuid, uuid, uuid, text, text, text
) to service_role;
