-- #1454-#1462: session campaign move v2.
-- Extends the v1 fail-closed boundary with a versioned dependency registry,
-- populated-session migration, explicit reconciliation decisions and durable
-- media preparation receipts. This migration is forward-only; the v1 receipt
-- and RPC remain valid for already committed operations.

begin;

alter table public.session_campaign_move_operations
  add column if not exists contract_version integer not null default 1
    check (contract_version between 1 and 16),
  add column if not exists decision_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(decision_summary) = 'object');

create table if not exists public.session_campaign_move_dependency_policies (
  relation_name text primary key,
  policy text not null check (
    policy in (
      'follows_session',
      'rewrite_current_ownership',
      'preserve_historical_attribution',
      'manual_reconcile'
    )
  ),
  required boolean not null default false,
  campaign_column text null,
  label text not null,
  notes text not null default ''
);

alter table public.session_campaign_move_dependency_policies enable row level security;
revoke all on table public.session_campaign_move_dependency_policies
  from public, anon, authenticated, service_role;
grant select on table public.session_campaign_move_dependency_policies to service_role;

insert into public.session_campaign_move_dependency_policies(
  relation_name, policy, required, campaign_column, label, notes
) values
  ('public.participants','manual_reconcile',true,null,'Participantes','Vínculos com entities exigem decisão; o participant em si segue a session.'),
  ('public.recording_files','follows_session',true,null,'Arquivos de gravação','Ownership deriva de session_id.'),
  ('public.processing_jobs','follows_session',false,null,'Jobs de processamento','Histórico operacional segue por session_id.'),
  ('public.audio_chunks','follows_session',false,null,'Chunks de áudio','Ownership deriva de session_id.'),
  ('public.transcript_segments','follows_session',true,null,'Segmentos legados','Ownership deriva de session_id.'),
  ('public.roll20_events','follows_session',false,null,'Eventos Roll20','Ownership deriva de session_id.'),
  ('public.session_markers','follows_session',false,null,'Markers','Ownership deriva de session_id.'),
  ('public.entity_mentions','manual_reconcile',false,null,'Menções a entidades','Pode apontar para entity da campanha de origem.'),
  ('public.canon_candidates','manual_reconcile',false,null,'Candidatos de cânone','Relações narrativas precisam ser classificadas.'),
  ('public.quote_candidates','follows_session',false,null,'Citações candidatas','Ownership deriva de session_id.'),
  ('public.outtake_candidates','follows_session',false,null,'Outtakes candidatos','Ownership deriva de session_id.'),
  ('public.review_decisions','follows_session',false,null,'Decisões de revisão','Histórico da session segue pelo UUID.'),
  ('public.publications','manual_reconcile',false,null,'Publicações legadas','Publicação pública legada exige reconciliação; privadas seguem a session.'),
  ('public.audit_log','preserve_historical_attribution',true,'campaign_id','Auditoria','campaign_id é atribuição histórica e não é reescrito.'),
  ('public.ai_usage_ledger','preserve_historical_attribution',false,'campaign_id','Ledger de IA','Atribuição/custo histórico não é reescrito.'),
  ('public.audio_speech_slices','follows_session',false,null,'Speech slices','Ownership deriva de session_id.'),
  ('public.discord_interactions','rewrite_current_ownership',false,'campaign_id','Interações Discord','Quando session-owned, campaign_id acompanha a session.'),
  ('public.table_notes','rewrite_current_ownership',false,'campaign_id','Notas da mesa','Quando session-owned, campaign_id acompanha a session.'),
  ('public.audio_artifacts','follows_session',false,null,'Artefatos de áudio','Ownership deriva de session_id.'),
  ('public.craig_manifests','follows_session',false,null,'Craig manifests','Ownership deriva de session_id.'),
  ('public.craig_track_extraction_steps','follows_session',false,null,'Craig extraction','Ownership deriva de session_id.'),
  ('public.transcript_revisions','rewrite_current_ownership',true,'campaign_id','Revisões da transcrição','campaign_id representa ownership atual; payload/ids/hashes permanecem imutáveis.'),
  ('public.transcript_publication_receipts','rewrite_current_ownership',false,'campaign_id','Receipts da transcrição','Acompanha o ownership atual; timestamps e operation ids permanecem históricos.'),
  ('public.transcript_publication_events','rewrite_current_ownership',false,'campaign_id','Eventos da transcrição','Acompanha o ownership atual; timestamps permanecem históricos.'),
  ('public.transcript_session_statistics','follows_session',false,null,'Estatísticas da transcrição','Read model deriva de session_id.'),
  ('public.session_editorial_drafts','rewrite_current_ownership',true,'campaign_id','Drafts editoriais','Todas as revisões acompanham a session sem renumeração.'),
  ('public.session_publications','rewrite_current_ownership',true,'campaign_id','Publicações editoriais','campaign_id é ownership atual; snapshot/hash/timestamp não são regenerados.'),
  ('public.session_publication_operations','rewrite_current_ownership',true,'campaign_id','Receipts de publicação','Operation ids e payload hashes permanecem intactos.'),
  ('public.transcript_assembly_publication_receipts','rewrite_current_ownership',false,'campaign_id','Receipts de Session Assembly','Ownership acompanha a session.'),
  ('public.session_campaign_move_operations','preserve_historical_attribution',true,null,'Receipts de move','Receipts de moves anteriores nunca são reescritos.')
on conflict (relation_name) do update set
  policy = excluded.policy,
  required = excluded.required,
  campaign_column = excluded.campaign_column,
  label = excluded.label,
  notes = excluded.notes;

create table if not exists public.session_campaign_move_media_preparations (
  operation_id uuid not null,
  asset_id uuid not null references public.media_assets(id) on delete restrict,
  session_id uuid not null references public.sessions(id) on delete restrict,
  source_campaign_id uuid not null references public.campaigns(id) on delete restrict,
  destination_campaign_id uuid not null references public.campaigns(id) on delete restrict,
  source_object_key text not null,
  destination_object_key text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  staged_bucket text not null,
  destination_public_object_key text null,
  destination_public_url text null,
  public_verified_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (operation_id, asset_id),
  check (source_campaign_id <> destination_campaign_id),
  check (
    (destination_public_object_key is null
      and destination_public_url is null
      and public_verified_at is null)
    or
    (destination_public_object_key is not null
      and destination_public_url is not null
      and public_verified_at is not null)
  )
);

alter table public.session_campaign_move_media_preparations enable row level security;
revoke all on table public.session_campaign_move_media_preparations
  from public, anon, authenticated, service_role;
grant select, insert on table public.session_campaign_move_media_preparations to service_role;

create or replace function public.session_campaign_move_contract()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'version', 2,
    'features', jsonb_build_array(
      'dependency_registry',
      'private_lineage',
      'publication_transfer',
      'media_prepare_commit',
      'explicit_unlink_participant_entities',
      'explicit_revoke_session_grants',
      'durable_replay'
    )
  );
$$;

create or replace function public.session_campaign_move_registry_drift()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with direct_relations as (
    select distinct
      quote_ident(ns.nspname) || '.' || quote_ident(rel.relname) as relation_name
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace ns on ns.oid = rel.relnamespace
    where con.contype = 'f'
      and con.confrelid = 'public.sessions'::regclass
      and ns.nspname = 'public'
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'code','unclassified_session_relation',
      'relation', d.relation_name,
      'message','Uma relação direta com sessions ainda não possui policy de campaign move.'
    ) order by d.relation_name),
    '[]'::jsonb
  )
  from direct_relations d
  left join public.session_campaign_move_dependency_policies p
    on p.relation_name = d.relation_name
  where p.relation_name is null;
$$;

create or replace function public.session_campaign_move_count(
  p_relation text,
  p_session_id uuid,
  p_required boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_relation regclass;
  v_count bigint;
begin
  v_relation := to_regclass(p_relation);
  if v_relation is null then
    return jsonb_build_object(
      'available', false,
      'required', p_required,
      'count', 0
    );
  end if;
  if not exists (
    select 1
    from pg_attribute
    where attrelid = v_relation
      and attname = 'session_id'
      and attnum > 0
      and not attisdropped
  ) then
    return jsonb_build_object(
      'available', false,
      'required', p_required,
      'count', 0
    );
  end if;
  execute format('select count(*) from %s where session_id = $1', v_relation)
    into v_count using p_session_id;
  return jsonb_build_object(
    'available', true,
    'required', p_required,
    'count', coalesce(v_count,0)
  );
end;
$$;

create or replace function public.session_campaign_move_plan(
  p_session_id uuid,
  p_destination_campaign_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_plan jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_row record;
  v_probe jsonb;
  v_count bigint;
  v_current_draft_id uuid;
  v_current_publication_id uuid;
  v_metadata jsonb;
  v_cover text;
begin
  select
    s.current_editorial_draft_id,
    s.current_session_publication_id,
    coalesce(s.metadata,'{}'::jsonb)
  into v_current_draft_id, v_current_publication_id, v_metadata
  from public.sessions s
  where s.id = p_session_id;

  if not found then
    return jsonb_build_object(
      'plan','[]'::jsonb,
      'blockers',jsonb_build_array(jsonb_build_object(
        'code','session_missing','count',1,'message','A sessão não existe mais.'
      ))
    );
  end if;

  if jsonb_array_length(public.session_campaign_move_registry_drift()) > 0 then
    v_blockers := v_blockers || public.session_campaign_move_registry_drift();
  end if;

  for v_row in
    select * from public.session_campaign_move_dependency_policies
    order by relation_name
  loop
    v_probe := public.session_campaign_move_count(
      v_row.relation_name,
      p_session_id,
      v_row.required
    );
    if not (v_probe->>'available')::boolean then
      if v_row.required then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code','schema_contract_incompatible',
          'count',1,
          'relation',v_row.relation_name,
          'message','Uma relação obrigatória do contrato de move não está disponível.'
        ));
      end if;
      continue;
    end if;
    v_count := (v_probe->>'count')::bigint;
    if v_count = 0 then
      continue;
    end if;

    if v_row.relation_name = 'public.participants' then
      select count(*) into v_count
      from public.participants p
      where p.session_id = p_session_id
        and p.character_entity_id is not null;
      if v_count > 0 then
        v_plan := v_plan || jsonb_build_array(jsonb_build_object(
          'family','participant_entity_links',
          'classification','decision',
          'count',v_count,
          'message','Vínculos de participantes com entities da origem precisam ser desvinculados explicitamente para este move.',
          'action','unlink_participant_entities'
        ));
      end if;
      continue;
    end if;

    if v_row.relation_name = 'public.entity_mentions' then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','entity_mentions',
        'count',v_count,
        'message','Menções ligadas a entities da origem ainda exigem reconciliação narrativa dedicada.'
      ));
      continue;
    end if;

    if v_row.relation_name = 'public.canon_candidates' then
      select count(*) into v_count
      from public.canon_candidates cc
      where cc.session_id = p_session_id
        and (
          coalesce(cardinality(cc.related_entity_ids),0) > 0
          or exists (
            select 1 from public.canon_entries ce
            where ce.source_candidate_id = cc.id
          )
        );
      if v_count > 0 then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code','canon_entity_links',
          'count',v_count,
          'message','Candidatos/cânone com vínculos narrativos de campanha exigem reconciliação manual.'
        ));
      end if;
      continue;
    end if;

    if v_row.relation_name = 'public.publications' then
      select count(*) into v_count
      from public.publications publication
      where publication.session_id = p_session_id
        and (
          publication.status = 'published'
          or publication.visibility in ('public_campaign','public_web')
        );
      if v_count > 0 then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code','legacy_publications',
          'count',v_count,
          'message','Publicações legadas públicas precisam ser reconciliadas antes do move.'
        ));
      end if;
      continue;
    end if;

    if v_row.policy = 'rewrite_current_ownership' then
      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        'family',split_part(v_row.relation_name,'.',2),
        'classification','auto',
        'count',v_count,
        'message',v_row.label || ' acompanhará a sessão sem regenerar conteúdo ou ids.'
      ));
    elsif v_row.policy = 'preserve_historical_attribution' then
      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        'family',split_part(v_row.relation_name,'.',2),
        'classification','historical',
        'count',v_count,
        'message',v_row.label || ' preservará a atribuição histórica original.'
      ));
    end if;
  end loop;

  if to_regclass('public.role_assignments') is not null then
    select count(*) into v_count
    from public.role_assignments assignment
    where assignment.scope_type = 'session'
      and assignment.scope_id = p_session_id::text
      and assignment.status in ('active','eligible');
    if v_count > 0 then
      v_plan := v_plan || jsonb_build_array(jsonb_build_object(
        'family','session_scoped_grants',
        'classification','decision',
        'count',v_count,
        'message','Grants específicos da sessão precisam ser revogados explicitamente antes de transferir o boundary.',
        'action','revoke_session_grants'
      ));
    end if;
  end if;

  select count(*) into v_count
  from (
    select distinct d.cover_asset_id
    from public.session_editorial_drafts d
    where d.session_id = p_session_id
      and d.cover_asset_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    union
    select distinct sp.cover_asset_id
    from public.session_publications sp
    where sp.session_id = p_session_id
      and sp.cover_asset_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) covers;
  if v_count > 0 then
    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'family','session_cover_assets',
      'classification','external_prepare',
      'count',v_count,
      'message','Capas serão copiadas e verificadas no namespace da campanha de destino antes do commit.'
    ));
  end if;

  if v_current_draft_id is not null then
    select d.cover_asset_id into v_cover
    from public.session_editorial_drafts d
    where d.id = v_current_draft_id
      and d.session_id = p_session_id;
    if v_cover is not null
       and v_cover !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code','legacy_session_cover',
        'count',1,
        'message','A capa atual usa referência legada e precisa ser substituída por asset governado antes do move.'
      ));
    end if;
  end if;

  if v_current_draft_id is null
     and nullif(v_metadata->>'coverImageUrl','') is not null
     and v_current_publication_id is null then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','legacy_session_cover',
      'count',1,
      'message','A sessão possui capa legada sem draft/publication governados; substitua a capa antes do move.'
    ));
  end if;

  return jsonb_build_object('plan',v_plan,'blockers',v_blockers);
end;
$$;

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
as $$
declare
  v_source public.campaigns%rowtype;
  v_destination public.campaigns%rowtype;
  v_session public.sessions%rowtype;
  v_plan jsonb;
  v_blockers jsonb;
  v_grants bigint := 0;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_source_campaign_slug is null
     or p_destination_campaign_slug is null
     or p_source_campaign_slug = p_destination_campaign_slug
     or p_session_id is null
     or p_source_session_id is null
     or btrim(p_source_session_id) = '' then
    return jsonb_build_object('status','validation','contractVersion',2,'blockers','[]'::jsonb,'plan','[]'::jsonb);
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id
      and p.auth_user_id = p_auth_user_id
  ) then
    return jsonb_build_object('status','forbidden','contractVersion',2,'blockers','[]'::jsonb,'plan','[]'::jsonb);
  end if;

  select * into v_source from public.campaigns where slug = p_source_campaign_slug;
  select * into v_destination from public.campaigns where slug = p_destination_campaign_slug;
  if v_source.id is null or v_destination.id is null then
    return jsonb_build_object('status','not_found','contractVersion',2,'blockers','[]'::jsonb,'plan','[]'::jsonb);
  end if;
  if v_source.lifecycle <> 'active' or v_destination.lifecycle <> 'active' then
    return jsonb_build_object(
      'status','blocked','contractVersion',2,'plan','[]'::jsonb,
      'blockers',jsonb_build_array(jsonb_build_object(
        'code',case when v_source.lifecycle <> 'active' then 'source_archived' else 'destination_archived' end,
        'count',1,'message','Campanhas arquivadas são somente leitura para esta operação.'
      ))
    );
  end if;

  if not public.has_profile_campaign_capability(
      p_actor_profile_id,p_source_campaign_slug,'campaign.content.edit',statement_timestamp())
    or not public.has_profile_campaign_capability(
      p_actor_profile_id,p_destination_campaign_slug,'campaign.content.edit',statement_timestamp())
    or not public.has_profile_campaign_capability(
      p_actor_profile_id,p_source_campaign_slug,'campaign.transcript.read',statement_timestamp())
    or not public.has_profile_campaign_capability(
      p_actor_profile_id,p_destination_campaign_slug,'campaign.transcript.read',statement_timestamp()) then
    return jsonb_build_object('status','forbidden','contractVersion',2,'blockers','[]'::jsonb,'plan','[]'::jsonb);
  end if;

  select * into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;
  if not found then
    return jsonb_build_object('status','conflict','contractVersion',2,'blockers','[]'::jsonb,'plan','[]'::jsonb);
  end if;

  if exists (
    select 1 from public.sessions sibling
    where sibling.campaign_id = v_destination.id
      and sibling.id <> p_session_id
      and sibling.source_session_id = p_source_session_id
  ) then
    return jsonb_build_object(
      'status','blocked','contractVersion',2,'plan','[]'::jsonb,
      'blockers',jsonb_build_array(jsonb_build_object(
        'code','source_identity_collision','count',1,
        'message','O destino já possui uma sessão com o mesmo sourceSessionId.'
      ))
    );
  end if;

  select
    result->'plan',
    result->'blockers'
  into v_plan, v_blockers
  from (
    select public.session_campaign_move_plan(p_session_id,v_destination.id) result
  ) plan_result;

  if to_regclass('public.role_assignments') is not null then
    select count(*) into v_grants
    from public.role_assignments a
    where a.scope_type='session'
      and a.scope_id=p_session_id::text
      and a.status in ('active','eligible');
  end if;
  if v_grants > 0
     and not public.has_profile_campaign_capability(
       p_actor_profile_id,p_source_campaign_slug,'campaign.permissions.manage',statement_timestamp()
     ) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code','grant_management_forbidden','count',v_grants,
      'message','Existem grants específicos da sessão, mas esta conta não pode gerenciar permissões na origem.'
    ));
  end if;

  return jsonb_build_object(
    'status',case when jsonb_array_length(v_blockers)=0 then 'ready' else 'blocked' end,
    'contractVersion',2,
    'sessionId',p_session_id,
    'sourceSessionId',p_source_session_id,
    'sourceCampaignSlug',p_source_campaign_slug,
    'destinationCampaignSlug',p_destination_campaign_slug,
    'blockers',v_blockers,
    'plan',v_plan,
    'consequences',jsonb_build_array(
      'edit_url_changes',
      'campaign_scope_changes',
      'public_route_changes',
      'cache_revalidation_required'
    )
  );
end;
$$;

create or replace function public.move_session_campaign_v2_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_source_campaign_slug text,
  p_destination_campaign_slug text,
  p_session_id uuid,
  p_source_session_id text,
  p_operation_id uuid,
  p_decisions jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.session_campaign_move_operations%rowtype;
  v_source_id uuid;
  v_destination_id uuid;
  v_preflight jsonb;
  v_participant_links bigint := 0;
  v_session_grants bigint := 0;
  v_cover_asset_id uuid;
  v_prep public.session_campaign_move_media_preparations%rowtype;
  v_decisions jsonb := coalesce(p_decisions,'{}'::jsonb);
  v_relation text;
begin
  if p_operation_id is null
     or jsonb_typeof(v_decisions) <> 'object' then
    return jsonb_build_object('status','validation','contractVersion',2);
  end if;

  select * into v_existing
  from public.session_campaign_move_operations o
  where o.operation_id = p_operation_id;
  if found then
    if v_existing.session_id = p_session_id
       and v_existing.actor_profile_id = p_actor_profile_id
       and v_existing.source_session_id = p_source_session_id
       and exists (select 1 from public.campaigns c where c.id=v_existing.source_campaign_id and c.slug=p_source_campaign_slug)
       and exists (select 1 from public.campaigns c where c.id=v_existing.destination_campaign_id and c.slug=p_destination_campaign_slug) then
      return jsonb_build_object(
        'status','replay','contractVersion',v_existing.contract_version,
        'sessionId',p_session_id,'sourceSessionId',p_source_session_id,
        'sourceCampaignSlug',p_source_campaign_slug,
        'destinationCampaignSlug',p_destination_campaign_slug,
        'operationId',p_operation_id
      );
    end if;
    return jsonb_build_object('status','operation_conflict','contractVersion',2);
  end if;

  select id into v_source_id from public.campaigns where slug=p_source_campaign_slug;
  select id into v_destination_id from public.campaigns where slug=p_destination_campaign_slug;
  if v_source_id is null or v_destination_id is null then
    return jsonb_build_object('status','not_found','contractVersion',2);
  end if;

  perform 1
  from public.sessions s
  where s.id=p_session_id
    and s.campaign_id=v_source_id
    and s.source_session_id=p_source_session_id
  for update;
  if not found then
    return jsonb_build_object('status','conflict','contractVersion',2);
  end if;

  -- Rare administrative operation: briefly fence the session-owned relations
  -- that can create new reconciliation blockers while the row lock is held.
  lock table public.participants in share row exclusive mode;
  lock table public.role_assignments in share row exclusive mode;
  lock table public.entity_mentions in share row exclusive mode;
  lock table public.canon_candidates in share row exclusive mode;
  lock table public.publications in share row exclusive mode;
  lock table public.transcript_revisions in share row exclusive mode;
  lock table public.transcript_publication_receipts in share row exclusive mode;
  lock table public.transcript_publication_events in share row exclusive mode;
  lock table public.session_editorial_drafts in share row exclusive mode;
  lock table public.session_publications in share row exclusive mode;
  lock table public.session_publication_operations in share row exclusive mode;
  lock table public.media_assets in share row exclusive mode;
  lock table public.discord_interactions in share row exclusive mode;
  lock table public.table_notes in share row exclusive mode;

  v_preflight := public.preflight_session_campaign_move(
    p_auth_user_id,p_actor_profile_id,p_source_campaign_slug,p_destination_campaign_slug,
    p_session_id,p_source_session_id
  );
  if v_preflight->>'status' <> 'ready' then
    return v_preflight;
  end if;

  select count(*) into v_participant_links
  from public.participants p
  where p.session_id=p_session_id
    and p.character_entity_id is not null;
  if v_participant_links > 0
     and coalesce((v_decisions->>'unlinkParticipantEntities')::boolean,false) is not true then
    return jsonb_build_object(
      'status','decision_required','contractVersion',2,
      'decision','unlink_participant_entities','count',v_participant_links
    );
  end if;

  select count(*) into v_session_grants
  from public.role_assignments a
  where a.scope_type='session'
    and a.scope_id=p_session_id::text
    and a.status in ('active','eligible');
  if v_session_grants > 0
     and coalesce((v_decisions->>'revokeSessionGrants')::boolean,false) is not true then
    return jsonb_build_object(
      'status','decision_required','contractVersion',2,
      'decision','revoke_session_grants','count',v_session_grants
    );
  end if;

  for v_cover_asset_id in
    select distinct cover_asset_id::uuid
    from (
      select d.cover_asset_id
      from public.session_editorial_drafts d
      where d.session_id=p_session_id
        and d.cover_asset_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      union
      select sp.cover_asset_id
      from public.session_publications sp
      where sp.session_id=p_session_id
        and sp.cover_asset_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) cover_ids
  loop
    select * into v_prep
    from public.session_campaign_move_media_preparations prep
    where prep.operation_id=p_operation_id
      and prep.asset_id=v_cover_asset_id
      and prep.session_id=p_session_id
      and prep.source_campaign_id=v_source_id
      and prep.destination_campaign_id=v_destination_id;
    if not found then
      return jsonb_build_object(
        'status','preparation_required','contractVersion',2,
        'assetId',v_cover_asset_id
      );
    end if;
    if not exists (
      select 1 from public.media_assets ma
      where ma.id=v_cover_asset_id
        and ma.campaign_id=v_source_id
        and ma.role_hint='session_cover'
        and ma.object_key=v_prep.source_object_key
        and ma.sha256=v_prep.sha256
        and ma.read_back_verified=true
    ) then
      return jsonb_build_object(
        'status','preparation_conflict','contractVersion',2,
        'assetId',v_cover_asset_id
      );
    end if;
  end loop;

  if v_participant_links > 0 then
    update public.participants p
    set
      metadata=jsonb_set(
        coalesce(p.metadata,'{}'::jsonb),
        '{campaignMoveDetachedEntityId}',
        to_jsonb(p.character_entity_id::text),
        true
      ),
      character_entity_id=null
    where p.session_id=p_session_id
      and p.character_entity_id is not null;
  end if;

  if v_session_grants > 0 then
    update public.role_assignments a
    set
      status='revoked',
      ends_at=coalesce(a.ends_at,clock_timestamp()),
      revoked_by=p_actor_profile_id,
      reason=coalesce(a.reason,'Revogado durante transferência explícita da sessão entre campanhas.'),
      metadata=jsonb_set(
        coalesce(a.metadata,'{}'::jsonb),
        '{sessionCampaignMoveOperationId}',
        to_jsonb(p_operation_id::text),
        true
      ),
      updated_at=clock_timestamp()
    where a.scope_type='session'
      and a.scope_id=p_session_id::text
      and a.status in ('active','eligible');
  end if;

  update public.transcript_revisions set campaign_id=v_destination_id where session_id=p_session_id;
  update public.transcript_publication_receipts set campaign_id=v_destination_id where session_id=p_session_id;
  update public.transcript_publication_events set campaign_id=v_destination_id where session_id=p_session_id;
  update public.session_editorial_drafts set campaign_id=v_destination_id where session_id=p_session_id;
  update public.session_publications set campaign_id=v_destination_id where session_id=p_session_id;
  update public.session_publication_operations set campaign_id=v_destination_id where session_id=p_session_id;
  update public.discord_interactions set campaign_id=v_destination_id
    where session_id=p_session_id and campaign_id=v_source_id;
  update public.table_notes set campaign_id=v_destination_id
    where session_id=p_session_id and campaign_id=v_source_id;
  if to_regclass('public.transcript_assembly_publication_receipts') is not null then
    execute 'update public.transcript_assembly_publication_receipts set campaign_id=$1 where session_id=$2'
      using v_destination_id,p_session_id;
  end if;

  for v_prep in
    select * from public.session_campaign_move_media_preparations prep
    where prep.operation_id=p_operation_id
      and prep.session_id=p_session_id
      and prep.source_campaign_id=v_source_id
      and prep.destination_campaign_id=v_destination_id
  loop
    update public.media_assets ma
    set
      campaign_id=v_destination_id,
      object_key=v_prep.destination_object_key,
      public_object_key=case
        when ma.status='verified_public' then v_prep.destination_public_object_key
        else ma.public_object_key
      end,
      public_delivery_verified=case
        when ma.status='verified_public' then v_prep.public_verified_at is not null
        else ma.public_delivery_verified
      end,
      public_verified_at=case
        when ma.status='verified_public' then v_prep.public_verified_at
        else ma.public_verified_at
      end,
      updated_at=clock_timestamp()
    where ma.id=v_prep.asset_id
      and ma.campaign_id=v_source_id
      and ma.object_key=v_prep.source_object_key
      and ma.sha256=v_prep.sha256;
    if not found then
      raise exception 'campaign move media preparation changed before commit';
    end if;
  end loop;

  update public.sessions s
  set
    campaign_id=v_destination_id,
    metadata=case
      when exists (
        select 1
        from public.session_editorial_drafts d
        join public.session_campaign_move_media_preparations prep
          on prep.operation_id=p_operation_id
         and prep.asset_id=d.cover_asset_id::uuid
        where d.id=s.current_editorial_draft_id
          and d.cover_asset_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and prep.destination_public_url is not null
      ) then
        jsonb_set(
          jsonb_set(
            coalesce(s.metadata,'{}'::jsonb),
            '{coverImageUrl}',
            to_jsonb((
              select prep.destination_public_url
              from public.session_editorial_drafts d
              join public.session_campaign_move_media_preparations prep
                on prep.operation_id=p_operation_id
               and prep.asset_id=d.cover_asset_id::uuid
              where d.id=s.current_editorial_draft_id
              limit 1
            )),
            true
          ),
          '{heroImageUrl}',
          to_jsonb((
            select prep.destination_public_url
            from public.session_editorial_drafts d
            join public.session_campaign_move_media_preparations prep
              on prep.operation_id=p_operation_id
             and prep.asset_id=d.cover_asset_id::uuid
            where d.id=s.current_editorial_draft_id
            limit 1
          )),
          true
        )
      else s.metadata
    end
  where s.id=p_session_id
    and s.campaign_id=v_source_id
    and s.source_session_id=p_source_session_id;
  if not found then
    raise exception 'session ownership changed while move was locked';
  end if;

  insert into public.audit_log(
    campaign_id,session_id,actor_id,action,table_name,record_id,old_value,new_value
  ) values (
    v_destination_id,p_session_id,p_actor_profile_id,'session.campaign.move.v2','sessions',p_session_id,
    jsonb_build_object(
      'campaignId',v_source_id,
      'campaignSlug',p_source_campaign_slug,
      'sourceSessionId',p_source_session_id
    ),
    jsonb_build_object(
      'campaignId',v_destination_id,
      'campaignSlug',p_destination_campaign_slug,
      'sourceSessionId',p_source_session_id,
      'participantEntityLinksDetached',v_participant_links,
      'sessionGrantsRevoked',v_session_grants
    )
  );

  insert into public.session_campaign_move_operations(
    operation_id,session_id,source_campaign_id,destination_campaign_id,
    source_session_id,actor_profile_id,contract_version,decision_summary
  ) values (
    p_operation_id,p_session_id,v_source_id,v_destination_id,
    p_source_session_id,p_actor_profile_id,2,
    jsonb_build_object(
      'unlinkParticipantEntities',v_participant_links > 0,
      'participantEntityLinksDetached',v_participant_links,
      'revokeSessionGrants',v_session_grants > 0,
      'sessionGrantsRevoked',v_session_grants
    )
  );

  return jsonb_build_object(
    'status','moved','contractVersion',2,
    'sessionId',p_session_id,'sourceSessionId',p_source_session_id,
    'sourceCampaignSlug',p_source_campaign_slug,
    'destinationCampaignSlug',p_destination_campaign_slug,
    'operationId',p_operation_id
  );
end;
$$;

comment on function public.session_campaign_move_contract() is
  'Sanitized server-only capability descriptor for session campaign move v2.';
comment on table public.session_campaign_move_dependency_policies is
  'Versioned default-deny classification of direct session-owned relations for campaign transfer.';
comment on table public.session_campaign_move_media_preparations is
  'Idempotent evidence that session-cover bytes were materialized/read-back verified in the destination namespace before the DB commit.';
comment on function public.move_session_campaign_v2_atomic(uuid,uuid,text,text,uuid,text,uuid,jsonb) is
  'Campaign move v2: locks/revalidates the session, requires prepared cover media and explicit reconciliation decisions, rewrites current ownership atomically and preserves historical ledgers.';

revoke all on function public.session_campaign_move_contract()
  from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_registry_drift()
  from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_count(text,uuid,boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_plan(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.preflight_session_campaign_move(uuid,uuid,text,text,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.move_session_campaign_v2_atomic(uuid,uuid,text,text,uuid,text,uuid,jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.session_campaign_move_contract() to service_role;
grant execute on function public.preflight_session_campaign_move(uuid,uuid,text,text,uuid,text) to service_role;
grant execute on function public.move_session_campaign_v2_atomic(uuid,uuid,text,text,uuid,text,uuid,jsonb) to service_role;

commit;
