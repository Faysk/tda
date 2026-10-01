-- #1129: governed cross-campaign session move.
-- Candidate only. Depends on #1123 first-class registry and #1134 authorization
-- hardening. No remote application is implied by this file.

begin;

do $tda_move$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='campaigns' and column_name='lifecycle'
  )
  or to_regprocedure(
    'public.has_profile_campaign_capability(uuid,text,text,timestamp with time zone)'
  ) is null then
    raise exception '#1129 requires #1123 registry and #1134 authorization candidates';
  end if;
end
$tda_move$;

create table if not exists public.session_campaign_move_operations (
  operation_id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete restrict,
  source_campaign_id uuid not null references public.campaigns(id) on delete restrict,
  destination_campaign_id uuid not null references public.campaigns(id) on delete restrict,
  source_session_id text not null,
  expected_updated_at timestamptz not null,
  committed_session_updated_at timestamptz not null,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  committed_at timestamptz not null default clock_timestamp(),
  constraint session_campaign_move_campaigns_differ
    check (source_campaign_id <> destination_campaign_id),
  constraint session_campaign_move_source_id_nonempty
    check (char_length(source_session_id) between 1 and 220)
);

alter table public.session_campaign_move_operations enable row level security;
revoke all on table public.session_campaign_move_operations from public;
revoke all on table public.session_campaign_move_operations from anon;
revoke all on table public.session_campaign_move_operations from authenticated;
grant select, insert on table public.session_campaign_move_operations to service_role;

create index if not exists session_campaign_move_operations_session_idx
  on public.session_campaign_move_operations(session_id, committed_at desc);

create or replace function public.session_campaign_move_blockers(
  p_session_id uuid,
  p_source_campaign_id uuid,
  p_destination_campaign_id uuid,
  p_source_session_id text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $tda_move$
declare
  v_blockers jsonb := '[]'::jsonb;
  v_session public.sessions%rowtype;
begin
  select *
  into v_session
  from public.sessions session_row
  where session_row.id = p_session_id
    and session_row.campaign_id = p_source_campaign_id
    and session_row.source_session_id = p_source_session_id;

  if v_session.id is null then
    return jsonb_build_array('not_found');
  end if;

  if p_source_campaign_id = p_destination_campaign_id then
    v_blockers := v_blockers || jsonb_build_array('same_campaign');
  end if;

  if exists (
    select 1
    from public.sessions sibling
    where sibling.campaign_id = p_destination_campaign_id
      and sibling.source_session_id = p_source_session_id
      and sibling.id <> p_session_id
  ) then
    v_blockers := v_blockers || jsonb_build_array('destination_collision');
  end if;

  if v_session.status = 'published'
     or v_session.current_session_publication_id is not null then
    v_blockers := v_blockers || jsonb_build_array('active_publication');
  end if;

  if exists (
    select 1
    from public.publications legacy_publication
    where legacy_publication.session_id = p_session_id
  ) then
    v_blockers := v_blockers || jsonb_build_array('legacy_publication');
  end if;

  -- Session covers currently encode the technical campaign slug in the object
  -- key. Until #1135 moves this namespace to immutable campaign identity, a
  -- cross-campaign move must not retag an R2 asset behind its bytes.
  if coalesce(v_session.metadata->>'coverImageUrl', '') like '%/campaigns/%'
     or exists (
       select 1
       from public.media_assets media
       join public.campaigns source_campaign
         on source_campaign.id = p_source_campaign_id
       where media.campaign_id = p_source_campaign_id
         and media.role_hint = 'session_cover'
         and media.object_key like
           'campaigns/' || source_campaign.slug || '/sessions/' ||
           lower(p_session_id::text) || '/%'
     )
     or exists (
       select 1
       from public.session_editorial_drafts draft
       where draft.session_id = p_session_id
         and coalesce(draft.cover_asset_id, '') <> ''
         and draft.cover_asset_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}
    v_blockers := v_blockers || jsonb_build_array('campaign_scoped_media');
  end if;

  if exists (
    select 1
    from public.participants participant
    where participant.session_id = p_session_id
      and participant.character_entity_id is not null
  ) then
    v_blockers := v_blockers || jsonb_build_array('participant_entity_links');
  end if;

  if exists (
    select 1 from public.canon_candidates candidate
    where candidate.session_id = p_session_id
  )
  or exists (
    select 1 from public.entity_mentions mention
    where mention.session_id = p_session_id
  ) then
    v_blockers := v_blockers || jsonb_build_array('canon_or_entity_provenance');
  end if;

  if exists (
    select 1
    from public.role_assignments assignment
    where assignment.scope_type in ('session', 'resource')
      and assignment.scope_id in (p_session_id::text, p_source_session_id)
      and assignment.status <> 'revoked'
  ) then
    v_blockers := v_blockers || jsonb_build_array('session_scoped_grants');
  end if;

  return v_blockers;
end;
$tda_move$;

revoke all on function public.session_campaign_move_blockers(uuid,uuid,uuid,text) from public;
revoke execute on function public.session_campaign_move_blockers(uuid,uuid,uuid,text) from anon;
revoke execute on function public.session_campaign_move_blockers(uuid,uuid,uuid,text) from authenticated;
grant execute on function public.session_campaign_move_blockers(uuid,uuid,uuid,text) to service_role;

create or replace function public.preview_session_campaign_move(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_source_campaign_slug text,
  p_destination_campaign_slug text,
  p_session_id uuid,
  p_source_session_id text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $tda_move$
declare
  v_source public.campaigns%rowtype;
  v_destination public.campaigns%rowtype;
  v_session public.sessions%rowtype;
  v_blockers jsonb;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_session_id is null
     or p_source_campaign_slug is null
     or p_destination_campaign_slug is null
     or p_source_session_id is null
     or char_length(p_source_session_id) not between 1 and 220
     or p_source_campaign_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or p_destination_campaign_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or not exists (
       select 1 from public.profiles profile
       where profile.id = p_actor_profile_id
         and profile.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not public.has_profile_campaign_capability(
    p_actor_profile_id, p_source_campaign_slug, 'campaign.content.edit', statement_timestamp()
  )
  or not public.has_profile_campaign_capability(
    p_actor_profile_id, p_destination_campaign_slug, 'campaign.content.edit', statement_timestamp()
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_source
  from public.campaigns campaign
  where campaign.slug = p_source_campaign_slug
    and campaign.lifecycle = 'active';

  select * into v_destination
  from public.campaigns campaign
  where campaign.slug = p_destination_campaign_slug
    and campaign.lifecycle = 'active';

  if v_source.id is null or v_destination.id is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_session
  from public.sessions session_row
  where session_row.id = p_session_id
    and session_row.campaign_id = v_source.id
    and session_row.source_session_id = p_source_session_id;

  if v_session.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_blockers := public.session_campaign_move_blockers(
    v_session.id,
    v_source.id,
    v_destination.id,
    p_source_session_id
  );

  return jsonb_build_object(
    'ok', true,
    'ready', jsonb_array_length(v_blockers) = 0,
    'sessionId', v_session.id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignId', v_source.id,
    'sourceCampaignSlug', v_source.slug,
    'sourceCampaignName', v_source.name,
    'destinationCampaignId', v_destination.id,
    'destinationCampaignSlug', v_destination.slug,
    'destinationCampaignName', v_destination.name,
    'expectedUpdatedAt', v_session.updated_at,
    'blockers', v_blockers
  );
end;
$tda_move$;

revoke all on function public.preview_session_campaign_move(uuid,uuid,text,text,uuid,text) from public;
revoke execute on function public.preview_session_campaign_move(uuid,uuid,text,text,uuid,text) from anon;
revoke execute on function public.preview_session_campaign_move(uuid,uuid,text,text,uuid,text) from authenticated;
grant execute on function public.preview_session_campaign_move(uuid,uuid,text,text,uuid,text) to service_role;

create or replace function public.move_session_campaign_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_source_campaign_slug text,
  p_destination_campaign_slug text,
  p_session_id uuid,
  p_source_session_id text,
  p_expected_updated_at timestamptz,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $tda_move$
declare
  v_source public.campaigns%rowtype;
  v_destination public.campaigns%rowtype;
  v_session public.sessions%rowtype;
  v_existing public.session_campaign_move_operations%rowtype;
  v_blockers jsonb;
  v_committed_updated_at timestamptz;
  v_committed_at timestamptz;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_session_id is null
     or p_operation_id is null
     or p_expected_updated_at is null
     or p_source_campaign_slug is null
     or p_destination_campaign_slug is null
     or p_source_session_id is null
     or char_length(p_source_session_id) not between 1 and 220
     or p_source_campaign_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or p_destination_campaign_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or not exists (
       select 1 from public.profiles profile
       where profile.id = p_actor_profile_id
         and profile.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_existing
  from public.session_campaign_move_operations operation
  where operation.operation_id = p_operation_id;

  if found then
    if v_existing.actor_profile_id = p_actor_profile_id
       and v_existing.session_id = p_session_id
       and v_existing.source_session_id = p_source_session_id
       and v_existing.expected_updated_at = p_expected_updated_at
       and exists (
         select 1 from public.campaigns campaign
         where campaign.id = v_existing.source_campaign_id
           and campaign.slug = p_source_campaign_slug
       )
       and exists (
         select 1 from public.campaigns campaign
         where campaign.id = v_existing.destination_campaign_id
           and campaign.slug = p_destination_campaign_slug
       ) then
      return jsonb_build_object(
        'ok', true,
        'status', 'replay',
        'operationId', v_existing.operation_id,
        'sessionId', v_existing.session_id,
        'sourceSessionId', v_existing.source_session_id,
        'sourceCampaignId', v_existing.source_campaign_id,
        'destinationCampaignId', v_existing.destination_campaign_id,
        'sessionUpdatedAt', v_existing.committed_session_updated_at,
        'committedAt', v_existing.committed_at
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'operation_conflict');
  end if;

  if not public.has_profile_campaign_capability(
    p_actor_profile_id, p_source_campaign_slug, 'campaign.content.edit', statement_timestamp()
  )
  or not public.has_profile_campaign_capability(
    p_actor_profile_id, p_destination_campaign_slug, 'campaign.content.edit', statement_timestamp()
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_source
  from public.campaigns campaign
  where campaign.slug = p_source_campaign_slug
    and campaign.lifecycle = 'active';

  select * into v_destination
  from public.campaigns campaign
  where campaign.slug = p_destination_campaign_slug
    and campaign.lifecycle = 'active';

  if v_source.id is null or v_destination.id is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('session-campaign-move:' || p_session_id::text, 0)
  );

  select * into v_session
  from public.sessions session_row
  where session_row.id = p_session_id
  for update;

  if v_session.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_session.campaign_id is distinct from v_source.id
     or v_session.source_session_id is distinct from p_source_session_id
     or v_session.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'reason', 'conflict');
  end if;

  v_blockers := public.session_campaign_move_blockers(
    v_session.id,
    v_source.id,
    v_destination.id,
    p_source_session_id
  );
  if jsonb_array_length(v_blockers) <> 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'blocked',
      'blockers', v_blockers
    );
  end if;

  -- Rows whose campaign_id is redundant with session ownership move in the
  -- same transaction. Transcript text/segments, revision payloads and content
  -- are never rewritten.
  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.transcript_assembly_publication_receipts
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.session_editorial_drafts
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.ai_usage_ledger
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.sessions
  set
    campaign_id = v_destination.id,
    updated_at = clock_timestamp()
  where id = v_session.id
    and campaign_id = v_source.id
    and updated_at = p_expected_updated_at
  returning updated_at into v_committed_updated_at;

  if v_committed_updated_at is null then
    raise exception 'session campaign CAS changed while move was locked';
  end if;

  v_committed_at := clock_timestamp();
  insert into public.session_campaign_move_operations (
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    expected_updated_at,
    committed_session_updated_at,
    actor_profile_id,
    committed_at
  ) values (
    p_operation_id,
    v_session.id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_expected_updated_at,
    v_committed_updated_at,
    p_actor_profile_id,
    v_committed_at
  );

  -- Preserve an audit edge on both sides without transcript or editorial body.
  insert into public.audit_log (
    campaign_id, session_id, actor_id, action, table_name, record_id, old_value, new_value
  ) values
  (
    v_source.id,
    v_session.id,
    p_actor_profile_id,
    'session.campaign_move_out',
    'sessions',
    v_session.id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', v_source.slug,
      'sourceSessionId', p_source_session_id,
      'updatedAt', p_expected_updated_at
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', v_destination.slug,
      'operationId', p_operation_id
    )
  ),
  (
    v_destination.id,
    v_session.id,
    p_actor_profile_id,
    'session.campaign_move_in',
    'sessions',
    v_session.id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', v_source.slug,
      'operationId', p_operation_id
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', v_destination.slug,
      'sourceSessionId', p_source_session_id,
      'updatedAt', v_committed_updated_at
    )
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'moved',
    'operationId', p_operation_id,
    'sessionId', v_session.id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignId', v_source.id,
    'destinationCampaignId', v_destination.id,
    'sessionUpdatedAt', v_committed_updated_at,
    'committedAt', v_committed_at
  );
end;
$tda_move$;

revoke all on function public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,timestamptz,uuid) from public;
revoke execute on function public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,timestamptz,uuid) from anon;
revoke execute on function public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,timestamptz,uuid) from authenticated;
grant execute on function public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,timestamptz,uuid) to service_role;

comment on table public.session_campaign_move_operations is
'Idempotency receipts for #1129 governed cross-campaign session moves. Contains identity/timestamps only; no transcript or editorial body.';
comment on function public.preview_session_campaign_move(uuid,uuid,text,text,uuid,text) is
'Server-only #1129 preflight. Requires campaign.content.edit on active source and destination and returns blocker codes without transcript/editorial content.';
comment on function public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,timestamptz,uuid) is
'Server-only #1129 atomic move with source/destination authorization, identity binding, optimistic concurrency, blocker recheck, campaign-owned child retagging, idempotency receipt and two-sided metadata-only audit.';

commit;

     )
     or exists (
       select 1
       from public.session_publications publication
       where publication.session_id = p_session_id
         and publication.cover_url like '%/campaigns/%'
     ) then
    v_blockers := v_blockers || jsonb_build_array('campaign_scoped_media');
  end if;

  if exists (
    select 1
    from public.participants participant
    where participant.session_id = p_session_id
      and participant.character_entity_id is not null
  ) then
    v_blockers := v_blockers || jsonb_build_array('participant_entity_links');
  end if;

  if exists (
    select 1 from public.canon_candidates candidate
    where candidate.session_id = p_session_id
  )
  or exists (
    select 1 from public.entity_mentions mention
    where mention.session_id = p_session_id
  ) then
    v_blockers := v_blockers || jsonb_build_array('canon_or_entity_provenance');
  end if;

  if exists (
    select 1
    from public.role_assignments assignment
    where assignment.scope_type in ('session', 'resource')
      and assignment.scope_id in (p_session_id::text, p_source_session_id)
      and assignment.status <> 'revoked'
  ) then
    v_blockers := v_blockers || jsonb_build_array('session_scoped_grants');
  end if;

  return v_blockers;
end;
$tda_move$;

revoke all on function public.session_campaign_move_blockers(uuid,uuid,uuid,text) from public;
revoke execute on function public.session_campaign_move_blockers(uuid,uuid,uuid,text) from anon;
revoke execute on function public.session_campaign_move_blockers(uuid,uuid,uuid,text) from authenticated;
grant execute on function public.session_campaign_move_blockers(uuid,uuid,uuid,text) to service_role;

create or replace function public.preview_session_campaign_move(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_source_campaign_slug text,
  p_destination_campaign_slug text,
  p_session_id uuid,
  p_source_session_id text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public
as $tda_move$
declare
  v_source public.campaigns%rowtype;
  v_destination public.campaigns%rowtype;
  v_session public.sessions%rowtype;
  v_blockers jsonb;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_session_id is null
     or p_source_campaign_slug is null
     or p_destination_campaign_slug is null
     or p_source_session_id is null
     or char_length(p_source_session_id) not between 1 and 220
     or p_source_campaign_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or p_destination_campaign_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or not exists (
       select 1 from public.profiles profile
       where profile.id = p_actor_profile_id
         and profile.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not public.has_profile_campaign_capability(
    p_actor_profile_id, p_source_campaign_slug, 'campaign.content.edit', statement_timestamp()
  )
  or not public.has_profile_campaign_capability(
    p_actor_profile_id, p_destination_campaign_slug, 'campaign.content.edit', statement_timestamp()
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_source
  from public.campaigns campaign
  where campaign.slug = p_source_campaign_slug
    and campaign.lifecycle = 'active';

  select * into v_destination
  from public.campaigns campaign
  where campaign.slug = p_destination_campaign_slug
    and campaign.lifecycle = 'active';

  if v_source.id is null or v_destination.id is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_session
  from public.sessions session_row
  where session_row.id = p_session_id
    and session_row.campaign_id = v_source.id
    and session_row.source_session_id = p_source_session_id;

  if v_session.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  v_blockers := public.session_campaign_move_blockers(
    v_session.id,
    v_source.id,
    v_destination.id,
    p_source_session_id
  );

  return jsonb_build_object(
    'ok', true,
    'ready', jsonb_array_length(v_blockers) = 0,
    'sessionId', v_session.id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignId', v_source.id,
    'sourceCampaignSlug', v_source.slug,
    'sourceCampaignName', v_source.name,
    'destinationCampaignId', v_destination.id,
    'destinationCampaignSlug', v_destination.slug,
    'destinationCampaignName', v_destination.name,
    'expectedUpdatedAt', v_session.updated_at,
    'blockers', v_blockers
  );
end;
$tda_move$;

revoke all on function public.preview_session_campaign_move(uuid,uuid,text,text,uuid,text) from public;
revoke execute on function public.preview_session_campaign_move(uuid,uuid,text,text,uuid,text) from anon;
revoke execute on function public.preview_session_campaign_move(uuid,uuid,text,text,uuid,text) from authenticated;
grant execute on function public.preview_session_campaign_move(uuid,uuid,text,text,uuid,text) to service_role;

create or replace function public.move_session_campaign_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_source_campaign_slug text,
  p_destination_campaign_slug text,
  p_session_id uuid,
  p_source_session_id text,
  p_expected_updated_at timestamptz,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $tda_move$
declare
  v_source public.campaigns%rowtype;
  v_destination public.campaigns%rowtype;
  v_session public.sessions%rowtype;
  v_existing public.session_campaign_move_operations%rowtype;
  v_blockers jsonb;
  v_committed_updated_at timestamptz;
  v_committed_at timestamptz;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_session_id is null
     or p_operation_id is null
     or p_expected_updated_at is null
     or p_source_campaign_slug is null
     or p_destination_campaign_slug is null
     or p_source_session_id is null
     or char_length(p_source_session_id) not between 1 and 220
     or p_source_campaign_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or p_destination_campaign_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or not exists (
       select 1 from public.profiles profile
       where profile.id = p_actor_profile_id
         and profile.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_existing
  from public.session_campaign_move_operations operation
  where operation.operation_id = p_operation_id;

  if found then
    if v_existing.actor_profile_id = p_actor_profile_id
       and v_existing.session_id = p_session_id
       and v_existing.source_session_id = p_source_session_id
       and v_existing.expected_updated_at = p_expected_updated_at
       and exists (
         select 1 from public.campaigns campaign
         where campaign.id = v_existing.source_campaign_id
           and campaign.slug = p_source_campaign_slug
       )
       and exists (
         select 1 from public.campaigns campaign
         where campaign.id = v_existing.destination_campaign_id
           and campaign.slug = p_destination_campaign_slug
       ) then
      return jsonb_build_object(
        'ok', true,
        'status', 'replay',
        'operationId', v_existing.operation_id,
        'sessionId', v_existing.session_id,
        'sourceSessionId', v_existing.source_session_id,
        'sourceCampaignId', v_existing.source_campaign_id,
        'destinationCampaignId', v_existing.destination_campaign_id,
        'sessionUpdatedAt', v_existing.committed_session_updated_at,
        'committedAt', v_existing.committed_at
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'operation_conflict');
  end if;

  if not public.has_profile_campaign_capability(
    p_actor_profile_id, p_source_campaign_slug, 'campaign.content.edit', statement_timestamp()
  )
  or not public.has_profile_campaign_capability(
    p_actor_profile_id, p_destination_campaign_slug, 'campaign.content.edit', statement_timestamp()
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select * into v_source
  from public.campaigns campaign
  where campaign.slug = p_source_campaign_slug
    and campaign.lifecycle = 'active';

  select * into v_destination
  from public.campaigns campaign
  where campaign.slug = p_destination_campaign_slug
    and campaign.lifecycle = 'active';

  if v_source.id is null or v_destination.id is null then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('session-campaign-move:' || p_session_id::text, 0)
  );

  select * into v_session
  from public.sessions session_row
  where session_row.id = p_session_id
  for update;

  if v_session.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_session.campaign_id is distinct from v_source.id
     or v_session.source_session_id is distinct from p_source_session_id
     or v_session.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'reason', 'conflict');
  end if;

  v_blockers := public.session_campaign_move_blockers(
    v_session.id,
    v_source.id,
    v_destination.id,
    p_source_session_id
  );
  if jsonb_array_length(v_blockers) <> 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'blocked',
      'blockers', v_blockers
    );
  end if;

  -- Rows whose campaign_id is redundant with session ownership move in the
  -- same transaction. Transcript text/segments, revision payloads and content
  -- are never rewritten.
  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.transcript_assembly_publication_receipts
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.session_editorial_drafts
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.ai_usage_ledger
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = v_session.id and campaign_id = v_source.id;

  update public.sessions
  set
    campaign_id = v_destination.id,
    updated_at = clock_timestamp()
  where id = v_session.id
    and campaign_id = v_source.id
    and updated_at = p_expected_updated_at
  returning updated_at into v_committed_updated_at;

  if v_committed_updated_at is null then
    raise exception 'session campaign CAS changed while move was locked';
  end if;

  v_committed_at := clock_timestamp();
  insert into public.session_campaign_move_operations (
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    expected_updated_at,
    committed_session_updated_at,
    actor_profile_id,
    committed_at
  ) values (
    p_operation_id,
    v_session.id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_expected_updated_at,
    v_committed_updated_at,
    p_actor_profile_id,
    v_committed_at
  );

  -- Preserve an audit edge on both sides without transcript or editorial body.
  insert into public.audit_log (
    campaign_id, session_id, actor_id, action, table_name, record_id, old_value, new_value
  ) values
  (
    v_source.id,
    v_session.id,
    p_actor_profile_id,
    'session.campaign_move_out',
    'sessions',
    v_session.id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', v_source.slug,
      'sourceSessionId', p_source_session_id,
      'updatedAt', p_expected_updated_at
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', v_destination.slug,
      'operationId', p_operation_id
    )
  ),
  (
    v_destination.id,
    v_session.id,
    p_actor_profile_id,
    'session.campaign_move_in',
    'sessions',
    v_session.id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', v_source.slug,
      'operationId', p_operation_id
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', v_destination.slug,
      'sourceSessionId', p_source_session_id,
      'updatedAt', v_committed_updated_at
    )
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'moved',
    'operationId', p_operation_id,
    'sessionId', v_session.id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignId', v_source.id,
    'destinationCampaignId', v_destination.id,
    'sessionUpdatedAt', v_committed_updated_at,
    'committedAt', v_committed_at
  );
end;
$tda_move$;

revoke all on function public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,timestamptz,uuid) from public;
revoke execute on function public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,timestamptz,uuid) from anon;
revoke execute on function public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,timestamptz,uuid) from authenticated;
grant execute on function public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,timestamptz,uuid) to service_role;

comment on table public.session_campaign_move_operations is
'Idempotency receipts for #1129 governed cross-campaign session moves. Contains identity/timestamps only; no transcript or editorial body.';
comment on function public.preview_session_campaign_move(uuid,uuid,text,text,uuid,text) is
'Server-only #1129 preflight. Requires campaign.content.edit on active source and destination and returns blocker codes without transcript/editorial content.';
comment on function public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,timestamptz,uuid) is
'Server-only #1129 atomic move with source/destination authorization, identity binding, optimistic concurrency, blocker recheck, campaign-owned child retagging, idempotency receipt and two-sided metadata-only audit.';

commit;
