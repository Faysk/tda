-- #1426 / #1129: explicit, fail-closed session campaign move.
-- Production deployable migration promoted from the reviewed scratch candidate after #1123/#1134 activation.
-- The operation intentionally moves only sessions whose dependent domains are
-- proven safe. Unsupported dependencies are blockers, never silently cloned.

begin;

create table if not exists public.session_campaign_move_operations (
  operation_id uuid primary key,
  session_id uuid not null references public.sessions(id) on delete restrict,
  source_campaign_id uuid not null references public.campaigns(id) on delete restrict,
  destination_campaign_id uuid not null references public.campaigns(id) on delete restrict,
  source_session_id text not null,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  committed_at timestamptz not null default clock_timestamp(),
  constraint session_campaign_move_distinct_campaigns_check
    check (source_campaign_id <> destination_campaign_id)
);

alter table public.session_campaign_move_operations enable row level security;
revoke all on table public.session_campaign_move_operations from public, anon, authenticated;
grant select, insert on table public.session_campaign_move_operations to service_role;

create or replace function public.session_campaign_move_dependency_count(
  p_relation text,
  p_session_column text,
  p_session_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $tda_move$
declare
  v_relation regclass;
  v_count bigint := 0;
begin
  v_relation := to_regclass(p_relation);
  if v_relation is null then
    return 0;
  end if;
  if not exists (
    select 1
    from pg_attribute
    where attrelid = v_relation
      and attname = p_session_column
      and attnum > 0
      and not attisdropped
  ) then
    return 0;
  end if;
  execute format(
    'select count(*) from %s where %I = $1',
    v_relation,
    p_session_column
  )
  into v_count
  using p_session_id;
  return coalesce(v_count, 0);
end;
$tda_move$;

create or replace function public.session_campaign_move_blockers(
  p_session_id uuid,
  p_destination_campaign_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $tda_move$
declare
  v_session jsonb;
  v_count bigint;
  p_relation text;
  v_blockers jsonb := '[]'::jsonb;
begin
  select to_jsonb(s)
  into v_session
  from public.sessions s
  where s.id = p_session_id;

  if v_session is null then
    return jsonb_build_array(
      jsonb_build_object(
        'code', 'session_missing',
        'count', 1,
        'message', 'A sessão não existe mais.'
      )
    );
  end if;

  if nullif(v_session->>'current_session_publication_id', '') is not null
     or coalesce(v_session->>'status', '') = 'published' then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'active_publication',
      'count', 1,
      'message', 'Despublique ou migre a publicação explicitamente antes de mover.'
    ));
  end if;

  if nullif(v_session->>'current_transcript_revision_id', '') is not null then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'current_transcript_revision',
      'count', 1,
      'message', 'A revisão atual da transcrição ainda pertence à campanha de origem.'
    ));
  end if;

  if nullif(v_session->>'current_editorial_draft_id', '') is not null then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'current_editorial_draft',
      'count', 1,
      'message', 'O draft editorial atual ainda pertence à campanha de origem.'
    ));
  end if;

  if nullif(coalesce(v_session->'metadata'->>'coverImageUrl', ''), '') is not null then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'session_cover',
      'count', 1,
      'message', 'A capa publicada/staged precisa ser reconciliada antes do move.'
    ));
  end if;

  select count(*) into v_count
  from public.participants participant
  where participant.session_id = p_session_id
    and participant.character_entity_id is not null;
  if v_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'participant_entity_links',
      'count', v_count,
      'message', 'Há participantes ligados a entidades da campanha de origem.'
    ));
  end if;

  foreach p_relation in array array[
    'public.transcript_revisions',
    'public.transcript_segments',
    'public.session_editorial_drafts',
    'public.session_publications',
    'public.session_publication_operations',
    'public.recording_files',
    'public.roll20_events',
    'public.session_markers',
    'public.discord_interactions',
    'public.table_notes',
    'public.canon_candidates',
    'public.publications',
    'public.entity_mentions'
  ]
  loop
    v_count := public.session_campaign_move_dependency_count(
      p_relation,
      'session_id',
      p_session_id
    );
    if v_count > 0 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', replace(split_part(p_relation, '.', 2), 'public.', ''),
        'count', v_count,
        'message', 'Este domínio ainda não possui migração transacional segura para troca de campanha.'
      ));
    end if;
  end loop;

  if to_regclass('public.role_assignments') is not null then
    select count(*) into v_count
    from public.role_assignments assignment
    where assignment.scope_type = 'session'
      and assignment.scope_id = p_session_id::text
      and assignment.status in ('active', 'eligible');
    if v_count > 0 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'session_scoped_grants',
        'count', v_count,
        'message', 'Há grants com escopo de sessão que exigem revisão antes do move.'
      ));
    end if;
  end if;

  return v_blockers;
end;
$tda_move$;

create or replace function public.preflight_session_campaign_move(
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
security definer
set search_path = pg_catalog, public
as $tda_move$
declare
  v_source public.campaigns%rowtype;
  v_destination public.campaigns%rowtype;
  v_session jsonb;
  v_blockers jsonb;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_source_campaign_slug is null
     or p_destination_campaign_slug is null
     or p_source_campaign_slug = p_destination_campaign_slug
     or p_session_id is null
     or p_source_session_id is null
     or btrim(p_source_session_id) = '' then
    return jsonb_build_object('status', 'validation', 'blockers', '[]'::jsonb);
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor_profile_id
      and profile.auth_user_id = p_auth_user_id
  ) then
    return jsonb_build_object('status', 'forbidden', 'blockers', '[]'::jsonb);
  end if;

  select * into v_source
  from public.campaigns
  where slug = p_source_campaign_slug;

  select * into v_destination
  from public.campaigns
  where slug = p_destination_campaign_slug;

  if v_source.id is null or v_destination.id is null then
    return jsonb_build_object('status', 'not_found', 'blockers', '[]'::jsonb);
  end if;

  if v_source.lifecycle <> 'active' or v_destination.lifecycle <> 'active' then
    return jsonb_build_object(
      'status', 'blocked',
      'blockers', jsonb_build_array(jsonb_build_object(
        'code', case when v_source.lifecycle <> 'active' then 'source_archived' else 'destination_archived' end,
        'count', 1,
        'message', 'Campanhas arquivadas são somente leitura para esta operação.'
      ))
    );
  end if;

  if not public.has_profile_campaign_capability(
      p_actor_profile_id, p_source_campaign_slug, 'campaign.content.edit', statement_timestamp()
    )
    or not public.has_profile_campaign_capability(
      p_actor_profile_id, p_destination_campaign_slug, 'campaign.content.edit', statement_timestamp()
    )
    or not public.has_profile_campaign_capability(
      p_actor_profile_id, p_source_campaign_slug, 'campaign.transcript.read', statement_timestamp()
    )
    or not public.has_profile_campaign_capability(
      p_actor_profile_id, p_destination_campaign_slug, 'campaign.transcript.read', statement_timestamp()
    ) then
    return jsonb_build_object('status', 'forbidden', 'blockers', '[]'::jsonb);
  end if;

  select to_jsonb(session_row)
  into v_session
  from public.sessions session_row
  where session_row.id = p_session_id
    and session_row.campaign_id = v_source.id
    and session_row.source_session_id = p_source_session_id;

  if v_session is null then
    return jsonb_build_object('status', 'conflict', 'blockers', '[]'::jsonb);
  end if;

  if exists (
    select 1
    from public.sessions sibling
    where sibling.campaign_id = v_destination.id
      and sibling.id <> p_session_id
      and sibling.source_session_id = p_source_session_id
  ) then
    return jsonb_build_object(
      'status', 'blocked',
      'blockers', jsonb_build_array(jsonb_build_object(
        'code', 'source_identity_collision',
        'count', 1,
        'message', 'O destino já possui uma sessão com o mesmo sourceSessionId.'
      ))
    );
  end if;

  v_blockers := public.session_campaign_move_blockers(
    p_session_id,
    v_destination.id
  );

  return jsonb_build_object(
    'status', case when jsonb_array_length(v_blockers) = 0 then 'ready' else 'blocked' end,
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'blockers', v_blockers,
    'consequences', jsonb_build_array(
      'edit_url_changes',
      'campaign_scope_changes',
      'cache_revalidation_required'
    )
  );
end;
$tda_move$;

create or replace function public.move_session_campaign_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_source_campaign_slug text,
  p_destination_campaign_slug text,
  p_session_id uuid,
  p_source_session_id text,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $tda_move$
declare
  v_existing public.session_campaign_move_operations%rowtype;
  v_source_id uuid;
  v_destination_id uuid;
  v_preflight jsonb;
begin
  if p_operation_id is null then
    return jsonb_build_object('status', 'validation');
  end if;

  select * into v_existing
  from public.session_campaign_move_operations operation
  where operation.operation_id = p_operation_id;

  if v_existing.operation_id is not null then
    if v_existing.session_id = p_session_id
       and v_existing.actor_profile_id = p_actor_profile_id
       and v_existing.source_session_id = p_source_session_id
       and exists (
         select 1 from public.campaigns c
         where c.id = v_existing.source_campaign_id
           and c.slug = p_source_campaign_slug
       )
       and exists (
         select 1 from public.campaigns c
         where c.id = v_existing.destination_campaign_id
           and c.slug = p_destination_campaign_slug
       ) then
      return jsonb_build_object(
        'status', 'replay',
        'sessionId', p_session_id,
        'sourceSessionId', p_source_session_id,
        'sourceCampaignSlug', p_source_campaign_slug,
        'destinationCampaignSlug', p_destination_campaign_slug,
        'operationId', p_operation_id
      );
    end if;
    return jsonb_build_object('status', 'operation_conflict');
  end if;

  select campaign.id into v_source_id
  from public.campaigns campaign
  where campaign.slug = p_source_campaign_slug;

  select campaign.id into v_destination_id
  from public.campaigns campaign
  where campaign.slug = p_destination_campaign_slug;

  if v_source_id is null or v_destination_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  perform 1
  from public.sessions session_row
  where session_row.id = p_session_id
    and session_row.campaign_id = v_source_id
    and session_row.source_session_id = p_source_session_id
  for update;

  if not found then
    return jsonb_build_object('status', 'conflict');
  end if;

  v_preflight := public.preflight_session_campaign_move(
    p_auth_user_id,
    p_actor_profile_id,
    p_source_campaign_slug,
    p_destination_campaign_slug,
    p_session_id,
    p_source_session_id
  );

  if v_preflight->>'status' <> 'ready' then
    return v_preflight;
  end if;

  update public.sessions
  set campaign_id = v_destination_id
  where id = p_session_id
    and campaign_id = v_source_id
    and source_session_id = p_source_session_id;

  if not found then
    return jsonb_build_object('status', 'conflict');
  end if;

  insert into public.audit_log (
    campaign_id,
    session_id,
    actor_id,
    action,
    table_name,
    record_id,
    old_value,
    new_value
  ) values (
    v_destination_id,
    p_session_id,
    p_actor_profile_id,
    'session.campaign.move',
    'sessions',
    p_session_id,
    jsonb_build_object(
      'campaignId', v_source_id,
      'campaignSlug', p_source_campaign_slug,
      'sourceSessionId', p_source_session_id
    ),
    jsonb_build_object(
      'campaignId', v_destination_id,
      'campaignSlug', p_destination_campaign_slug,
      'sourceSessionId', p_source_session_id
    )
  );

  insert into public.session_campaign_move_operations (
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    actor_profile_id
  ) values (
    p_operation_id,
    p_session_id,
    v_source_id,
    v_destination_id,
    p_source_session_id,
    p_actor_profile_id
  );

  return jsonb_build_object(
    'status', 'moved',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'operationId', p_operation_id
  );
end;
$tda_move$;

comment on function public.preflight_session_campaign_move(uuid,uuid,text,text,uuid,text) is
  'Server-only #1129 preflight. Rechecks actor binding/capabilities, source identity, destination collision and dependent domains without mutating the session.';
comment on function public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,uuid) is
  'Server-only #1129 atomic move. Locks the source session, reruns preflight, changes campaign_id, records sanitized audit and durable idempotency receipt in one transaction.';
comment on table public.session_campaign_move_operations is
  'Durable idempotency receipts for #1129 session campaign moves. Contains identities only; never transcript text.';

revoke all on function public.session_campaign_move_dependency_count(text,text,uuid) from public, anon, authenticated;
revoke all on function public.session_campaign_move_blockers(uuid,uuid) from public, anon, authenticated;
revoke all on function public.preflight_session_campaign_move(uuid,uuid,text,text,uuid,text) from public, anon, authenticated;
revoke all on function public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.session_campaign_move_dependency_count(text,text,uuid) to service_role;
grant execute on function public.session_campaign_move_blockers(uuid,uuid) to service_role;
grant execute on function public.preflight_session_campaign_move(uuid,uuid,text,text,uuid,text) to service_role;
grant execute on function public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,uuid) to service_role;

commit;
