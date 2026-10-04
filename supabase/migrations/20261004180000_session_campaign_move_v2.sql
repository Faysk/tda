-- #1454: session campaign move v2.
-- Extends the v1 fail-closed boundary with a schema-driven dependency registry,
-- explicit reconciliation decisions, immutable-history attribution and a
-- transactional move for populated editorial sessions. External media bytes are
-- prepared/read-backed by the server before this PostgreSQL commit.

begin;

alter table public.session_campaign_move_operations
  add column if not exists contract_version text not null default 'tda_session_campaign_move_v1',
  add column if not exists decisions jsonb not null default '{}'::jsonb;

create table if not exists public.session_campaign_move_artifacts (
  operation_id uuid not null
    references public.session_campaign_move_operations(operation_id) on delete cascade,
  artifact_kind text not null check (char_length(artifact_kind) between 1 and 80),
  artifact_id uuid not null,
  related_artifact_id uuid null,
  source_campaign_id uuid not null references public.campaigns(id) on delete restrict,
  destination_campaign_id uuid not null references public.campaigns(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (operation_id, artifact_kind, artifact_id),
  check (source_campaign_id <> destination_campaign_id)
);

alter table public.session_campaign_move_artifacts enable row level security;
revoke all on table public.session_campaign_move_artifacts
  from public, anon, authenticated, service_role;
grant select, insert on table public.session_campaign_move_artifacts to service_role;

comment on table public.session_campaign_move_artifacts is
  'Sanitized lineage receipts for campaign moves. Stores identities only, never transcript/editorial text.';

create table if not exists public.session_campaign_move_media_preparations (
  operation_id uuid not null,
  source_asset_id uuid not null references public.media_assets(id) on delete restrict,
  destination_asset_id uuid not null,
  session_id uuid not null references public.sessions(id) on delete restrict,
  source_campaign_id uuid not null references public.campaigns(id) on delete restrict,
  destination_campaign_id uuid not null references public.campaigns(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  source_object_key text not null,
  destination_object_key text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}
  relation_name text primary key,
  session_column text not null default 'session_id',
  family text not null check (char_length(family) between 1 and 80),
  policy text not null check (
    policy in (
      'follows_session',
      'rewrite_current_ownership',
      'preserve_historical_attribution',
      'manual_reconcile',
      'hard_block'
    )
  ),
  required boolean not null default true,
  label text not null check (char_length(label) between 1 and 160),
  notes text null check (notes is null or char_length(notes) <= 1000)
);

alter table public.session_campaign_move_dependency_policies enable row level security;
revoke all on table public.session_campaign_move_dependency_policies
  from public, anon, authenticated, service_role;

insert into public.session_campaign_move_dependency_policies(
  relation_name, session_column, family, policy, required, label, notes
) values
  ('public.session_publication_operations','session_id','session_publication_history','preserve_historical_attribution',true,'Receipts de publicação editorial','O histórico viaja logicamente com a sessão, preservando origin_campaign_id.'),
  ('public.session_editorial_drafts','session_id','editorial_drafts','preserve_historical_attribution',true,'Histórico de drafts editoriais','Drafts existentes permanecem imutáveis; o current recebe um bridge draft no destino.'),
  ('public.transcript_assembly_publication_receipts','session_id','transcript_receipts','rewrite_current_ownership',true,'Receipts de assembly de transcrição','Ownership atual acompanha a sessão; origem permanece em origin_campaign_id.'),
  ('public.session_campaign_move_operations','session_id','move_history','preserve_historical_attribution',true,'Histórico de mudanças de campanha','Receipts anteriores nunca são reescritos.'),
  ('public.session_campaign_move_media_preparations','session_id','move_media_prepare','preserve_historical_attribution',true,'Preparações externas de capa','Receipts de prepare/read-back pertencem à intenção de move e nunca são reescritos.'),
  ('public.transcript_session_statistics','session_id','transcript_statistics','follows_session',true,'Estatísticas da transcrição','A identidade é a própria sessão.'),
  ('public.transcript_publication_events','session_id','transcript_events','rewrite_current_ownership',true,'Eventos de publicação da transcrição','Ownership atual acompanha a sessão; origem permanece em origin_campaign_id.'),
  ('public.transcript_publication_receipts','session_id','transcript_receipts','rewrite_current_ownership',true,'Receipts de publicação da transcrição','Ownership atual acompanha a sessão; origem permanece em origin_campaign_id.'),
  ('public.transcript_revisions','session_id','transcript_revisions','rewrite_current_ownership',true,'Revisões da transcrição','Payload imutável permanece idêntico; somente ownership muda, com origem preservada.'),
  ('public.craig_track_extraction_steps','session_id','processing_provenance','follows_session',true,'Provenance de extração Craig','A identidade é a própria sessão.'),
  ('public.craig_manifests','session_id','processing_provenance','follows_session',true,'Manifestos Craig','A identidade é a própria sessão.'),
  ('public.session_publications','session_id','session_publication_history','rewrite_current_ownership',true,'Histórico de publicações da sessão','Snapshots permanecem imutáveis e origin_campaign_id preserva onde foram emitidos.'),
  ('public.table_notes','session_id','table_notes','rewrite_current_ownership',true,'Notas da mesa','Ownership atual acompanha a sessão.'),
  ('public.discord_interactions','session_id','discord_interactions','rewrite_current_ownership',true,'Interações Discord','Ownership atual acompanha a sessão.'),
  ('public.audio_speech_slices','session_id','audio_provenance','follows_session',true,'Slices de fala','A identidade é a própria sessão.'),
  ('public.ai_usage_ledger','session_id','usage_ledger','preserve_historical_attribution',true,'Ledger de uso de IA','Billing/auditoria permanecem atribuídos ao contexto histórico.'),
  ('public.audit_log','session_id','audit_history','preserve_historical_attribution',true,'Auditoria histórica','Eventos antigos nunca são reclassificados como originados no destino.'),
  ('public.publications','session_id','legacy_publications','hard_block',true,'Publicações legadas','Publicações do modelo legado exigem migração manual antes do move.'),
  ('public.review_decisions','session_id','review_decisions','follows_session',true,'Decisões de revisão','A identidade é a própria sessão.'),
  ('public.outtake_candidates','session_id','outtake_candidates','follows_session',true,'Candidatos de outtake','A identidade é a própria sessão.'),
  ('public.quote_candidates','session_id','quote_candidates','follows_session',true,'Candidatos de citação','A identidade é a própria sessão.'),
  ('public.canon_candidates','session_id','canon_candidates','manual_reconcile',true,'Candidatos de cânone','Entity links precisam de decisão explícita.'),
  ('public.entity_mentions','session_id','entity_mentions','manual_reconcile',true,'Menções de entidades','Entity references da origem não atravessam campanha silenciosamente.'),
  ('public.session_markers','session_id','session_markers','follows_session',true,'Marcadores da sessão','A identidade é a própria sessão.'),
  ('public.roll20_events','session_id','roll20_events','follows_session',true,'Eventos Roll20','A identidade é a própria sessão.'),
  ('public.transcript_segments','session_id','legacy_transcript_segments','follows_session',true,'Segmentos de transcrição legados','A identidade é a própria sessão.'),
  ('public.audio_chunks','session_id','audio_chunks','follows_session',true,'Chunks de áudio','A identidade é a própria sessão.'),
  ('public.processing_jobs','session_id','processing_jobs','follows_session',true,'Jobs de processamento','A identidade é a própria sessão.'),
  ('public.recording_files','session_id','recording_files','follows_session',true,'Arquivos de gravação','A identidade é a própria sessão.'),
  ('public.participants','session_id','participants','follows_session',true,'Participantes','Participantes acompanham a sessão; character_entity_id é reconciliado separadamente.'),
  ('public.audio_artifacts','session_id','audio_artifacts','follows_session',true,'Artefatos de áudio','A identidade é a própria sessão.')
on conflict (relation_name) do update set
  session_column = excluded.session_column,
  family = excluded.family,
  policy = excluded.policy,
  required = excluded.required,
  label = excluded.label,
  notes = excluded.notes;

create or replace function public.session_campaign_move_set_origin_campaign()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $tda_move$
begin
  -- Origin attribution is database-owned. Callers cannot forge a different
  -- origin at insert time; later campaign moves update campaign_id only.
  new.origin_campaign_id := new.campaign_id;
  return new;
end;
$tda_move$;

do $tda_move$
declare
  v_table text;
  v_constraint text;
  v_trigger text;
begin
  foreach v_table in array array[
    'transcript_revisions',
    'transcript_publication_receipts',
    'transcript_publication_events',
    'transcript_assembly_publication_receipts',
    'session_editorial_drafts',
    'session_publications',
    'session_publication_operations'
  ]
  loop
    if to_regclass('public.' || v_table) is null then
      continue;
    end if;

    execute format(
      'alter table public.%I add column if not exists origin_campaign_id uuid',
      v_table
    );
    execute format(
      'update public.%I set origin_campaign_id = campaign_id where origin_campaign_id is null',
      v_table
    );
    execute format(
      'alter table public.%I alter column origin_campaign_id set not null',
      v_table
    );

    v_constraint := v_table || '_origin_campaign_id_fkey';
    if not exists (
      select 1
      from pg_constraint
      where conrelid = to_regclass('public.' || v_table)
        and conname = v_constraint
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (origin_campaign_id) references public.campaigns(id) on delete restrict',
        v_table,
        v_constraint
      );
    end if;

    v_trigger := v_table || '_set_origin_campaign';
    if not exists (
      select 1
      from pg_trigger
      where tgrelid = to_regclass('public.' || v_table)
        and tgname = v_trigger
        and not tgisinternal
    ) then
      execute format(
        'create trigger %I before insert on public.%I for each row execute function public.session_campaign_move_set_origin_campaign()',
        v_trigger,
        v_table
      );
    end if;
  end loop;
end;
$tda_move$;

create or replace function public.session_campaign_move_registry_drift()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $tda_move$
with direct_fks as (
  select distinct
    format('%I.%I', child_ns.nspname, child.relname) as relation_name,
    child_col.attname as session_column,
    con.conname as constraint_name
  from pg_constraint con
  join pg_class child on child.oid = con.conrelid
  join pg_namespace child_ns on child_ns.oid = child.relnamespace
  join pg_class target on target.oid = con.confrelid
  join pg_namespace target_ns on target_ns.oid = target.relnamespace
  join lateral unnest(con.conkey) with ordinality child_key(attnum, ord) on true
  join lateral unnest(con.confkey) with ordinality target_key(attnum, ord)
    on target_key.ord = child_key.ord
  join pg_attribute child_col
    on child_col.attrelid = child.oid
   and child_col.attnum = child_key.attnum
  join pg_attribute target_col
    on target_col.attrelid = target.oid
   and target_col.attnum = target_key.attnum
  where con.contype = 'f'
    and child_ns.nspname = 'public'
    and target_ns.nspname = 'public'
    and target.relname = 'sessions'
    and target_col.attname = 'id'
),
unknown as (
  select d.*
  from direct_fks d
  left join public.session_campaign_move_dependency_policies p
    on p.relation_name = d.relation_name
   and p.session_column = d.session_column
  where p.relation_name is null
),
missing_required as (
  select p.relation_name, p.session_column
  from public.session_campaign_move_dependency_policies p
  where p.required
    and (
      to_regclass(p.relation_name) is null
      or not exists (
        select 1
        from pg_attribute a
        where a.attrelid = to_regclass(p.relation_name)
          and a.attname = p.session_column
          and a.attnum > 0
          and not a.attisdropped
      )
    )
)
select jsonb_build_object(
  'unknown',
  coalesce(
    (select jsonb_agg(to_jsonb(unknown) order by relation_name, constraint_name) from unknown),
    '[]'::jsonb
  ),
  'missingRequired',
  coalesce(
    (select jsonb_agg(to_jsonb(missing_required) order by relation_name) from missing_required),
    '[]'::jsonb
  )
);
$tda_move$;

create or replace function public.session_campaign_move_contract_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $tda_move$
declare
  v_drift jsonb;
begin
  v_drift := public.session_campaign_move_registry_drift();
  return jsonb_build_object(
    'contractVersion', 'tda_session_campaign_move_v2',
    'registryComplete',
      jsonb_array_length(v_drift->'unknown') = 0
      and jsonb_array_length(v_drift->'missingRequired') = 0,
    'supportsPopulatedSessions', true,
    'publicationPolicy', 'explicit_unpublish',
    'supportsMediaPrepare', true,
    'supportsRecoveryReplay', true,
    'supportsDecisions', jsonb_build_array(
      'publishedPolicy:unpublish',
      'participantEntityPolicy:unlink',
      'entityMentionPolicy:detach_from_session',
      'canonPolicy:detach_entity_links',
      'sessionGrantPolicy:preserve',
      'sessionGrantPolicy:revoke',
      'legacyCoverPolicy:clear_current'
    )
  );
end;
$tda_move$;

create or replace function public.session_campaign_move_decisions(
  p_options jsonb
)
returns jsonb
language sql
immutable
security invoker
set search_path = pg_catalog, public
as $tda_move$
select jsonb_strip_nulls(jsonb_build_object(
  'publishedPolicy', p_options->>'publishedPolicy',
  'participantEntityPolicy', p_options->>'participantEntityPolicy',
  'entityMentionPolicy', p_options->>'entityMentionPolicy',
  'canonPolicy', p_options->>'canonPolicy',
  'sessionGrantPolicy', p_options->>'sessionGrantPolicy',
  'legacyCoverPolicy', p_options->>'legacyCoverPolicy'
));
$tda_move$;

create or replace function public.session_campaign_move_options_valid(
  p_options jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog, public
as $tda_move$
select
  p_options is not null
  and jsonb_typeof(p_options) = 'object'
  and not exists (
    select 1
    from jsonb_object_keys(p_options) k(key_name)
    where k.key_name not in (
      'publishedPolicy',
      'participantEntityPolicy',
      'entityMentionPolicy',
      'canonPolicy',
      'sessionGrantPolicy',
      'legacyCoverPolicy',
      'preparedCover'
    )
  )
  and coalesce(p_options->>'publishedPolicy', '') in ('', 'unpublish')
  and coalesce(p_options->>'participantEntityPolicy', '') in ('', 'unlink')
  and coalesce(p_options->>'entityMentionPolicy', '') in ('', 'detach_from_session')
  and coalesce(p_options->>'canonPolicy', '') in ('', 'detach_entity_links')
  and coalesce(p_options->>'sessionGrantPolicy', '') in ('', 'preserve', 'revoke')
  and coalesce(p_options->>'legacyCoverPolicy', '') in ('', 'clear_current')
  and (
    not (p_options ? 'preparedCover')
    or p_options->'preparedCover' is null
    or jsonb_typeof(p_options->'preparedCover') = 'object'
  );
$tda_move$;

create or replace function public.session_campaign_move_plan_v2(
  p_actor_profile_id uuid,
  p_source_campaign_id uuid,
  p_destination_campaign_id uuid,
  p_source_campaign_slug text,
  p_destination_campaign_slug text,
  p_session_id uuid,
  p_options jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $tda_move$
declare
  v_items jsonb := '[]'::jsonb;
  v_policy record;
  v_count bigint;
  v_current_draft_id uuid;
  v_current_publication_id uuid;
  v_status text;
  v_cover text;
  v_cover_valid boolean := false;
  v_linked_participants bigint := 0;
  v_entity_mentions bigint := 0;
  v_canon_linked bigint := 0;
  v_canon_published bigint := 0;
  v_session_grants bigint := 0;
  v_drift jsonb;
  v_classification text;
begin
  v_drift := public.session_campaign_move_registry_drift();
  if jsonb_array_length(v_drift->'unknown') > 0
     or jsonb_array_length(v_drift->'missingRequired') > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'dependency_registry_drift',
      'family', 'schema',
      'classification', 'hard_block',
      'resolved', false,
      'count',
        jsonb_array_length(v_drift->'unknown')
        + jsonb_array_length(v_drift->'missingRequired'),
      'message', 'O schema possui dependências de sessão sem política de move compatível.'
    ));
  end if;

  select
    s.current_editorial_draft_id,
    s.current_session_publication_id,
    s.status
  into
    v_current_draft_id,
    v_current_publication_id,
    v_status
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = p_source_campaign_id;

  if not found then
    return jsonb_build_array(jsonb_build_object(
      'code', 'session_missing',
      'family', 'session',
      'classification', 'hard_block',
      'resolved', false,
      'count', 1,
      'message', 'A sessão não existe mais no escopo de origem.'
    ));
  end if;

  for v_policy in
    select *
    from public.session_campaign_move_dependency_policies
    order by family, relation_name
  loop
    if to_regclass(v_policy.relation_name) is null then
      continue;
    end if;

    v_count := public.session_campaign_move_dependency_count(
      v_policy.relation_name,
      v_policy.session_column,
      p_session_id
    );
    if v_count <= 0 then
      continue;
    end if;

    if v_policy.relation_name in (
      'public.canon_candidates',
      'public.entity_mentions'
    ) then
      continue;
    end if;

    if v_policy.policy = 'hard_block' then
      v_classification := 'hard_block';
    elsif v_policy.policy = 'preserve_historical_attribution' then
      v_classification := 'historical';
    else
      v_classification := 'auto';
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', split_part(v_policy.relation_name, '.', 2),
      'family', v_policy.family,
      'classification', v_classification,
      'resolved', v_classification <> 'hard_block',
      'count', v_count,
      'message', v_policy.label
    ));
  end loop;

  if v_current_publication_id is not null or v_status = 'published' then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'active_publication',
      'family', 'session_publication',
      'classification', 'decision',
      'resolved', p_options->>'publishedPolicy' = 'unpublish'
        and public.has_profile_campaign_capability(
          p_actor_profile_id,
          p_source_campaign_slug,
          'campaign.sessions.publish',
          statement_timestamp()
        ),
      'count', 1,
      'actionId', 'published_unpublish',
      'selectedPolicy', p_options->>'publishedPolicy',
      'message',
        case
          when p_options->>'publishedPolicy' = 'unpublish'
            and not public.has_profile_campaign_capability(
              p_actor_profile_id,
              p_source_campaign_slug,
              'campaign.sessions.publish',
              statement_timestamp()
            )
          then 'Despublicar exige capability de publicação na campanha de origem.'
          else 'A publicação ativa precisa ser despublicada atomicamente durante o move.'
        end
    ));
  end if;

  select count(*)
  into v_linked_participants
  from public.participants p
  where p.session_id = p_session_id
    and p.character_entity_id is not null;

  if v_linked_participants > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'participant_entity_links',
      'family', 'participants',
      'classification', 'decision',
      'resolved', p_options->>'participantEntityPolicy' = 'unlink',
      'count', v_linked_participants,
      'actionId', 'participant_entity_unlink',
      'selectedPolicy', p_options->>'participantEntityPolicy',
      'message', 'Vínculos participant → entity da campanha de origem precisam ser removidos explicitamente.'
    ));
  end if;

  select count(*)
  into v_entity_mentions
  from public.entity_mentions em
  where em.session_id = p_session_id;

  if v_entity_mentions > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'entity_mentions',
      'family', 'entity_mentions',
      'classification', 'decision',
      'resolved', p_options->>'entityMentionPolicy' = 'detach_from_session',
      'count', v_entity_mentions,
      'actionId', 'entity_mentions_detach',
      'selectedPolicy', p_options->>'entityMentionPolicy',
      'message', 'Menções ligadas a entities da origem precisam ser destacadas da sessão antes do move.'
    ));
  end if;

  select count(*)
  into v_canon_linked
  from public.canon_candidates cc
  where cc.session_id = p_session_id
    and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

  if v_canon_linked > 0 then
    if to_regclass('public.canon_entries') is not null then
      select count(*)
      into v_canon_published
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id;
    end if;

    if v_canon_published > 0 then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'code', 'canon_entries_from_session',
        'family', 'canon_candidates',
        'classification', 'hard_block',
        'resolved', false,
        'count', v_canon_published,
        'message', 'Há canon já materializado a partir desta sessão; mover exige reconciliação editorial fora deste boundary.'
      ));
    else
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'code', 'canon_candidate_entity_links',
        'family', 'canon_candidates',
        'classification', 'decision',
        'resolved', p_options->>'canonPolicy' = 'detach_entity_links',
        'count', v_canon_linked,
        'actionId', 'canon_detach_entity_links',
        'selectedPolicy', p_options->>'canonPolicy',
        'message', 'Candidatos de cânone possuem links para entities da origem e precisam ser destacados explicitamente.'
      ));
    end if;
  end if;

  select count(*)
  into v_session_grants
  from public.role_assignments ra
  where ra.scope_type = 'session'
    and ra.scope_id = p_session_id::text
    and ra.status in ('active', 'eligible');

  if v_session_grants > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'session_scoped_grants',
      'family', 'authorization',
      'classification', 'decision',
      'resolved',
        p_options->>'sessionGrantPolicy' in ('preserve', 'revoke')
        and public.has_profile_campaign_capability(
          p_actor_profile_id,
          p_source_campaign_slug,
          'campaign.permissions.manage',
          statement_timestamp()
        )
        and public.has_profile_campaign_capability(
          p_actor_profile_id,
          p_destination_campaign_slug,
          'campaign.permissions.manage',
          statement_timestamp()
        ),
      'count', v_session_grants,
      'actionId', 'session_grants',
      'selectedPolicy', p_options->>'sessionGrantPolicy',
      'message',
        case
          when p_options->>'sessionGrantPolicy' in ('preserve', 'revoke')
            and not (
              public.has_profile_campaign_capability(
                p_actor_profile_id,
                p_source_campaign_slug,
                'campaign.permissions.manage',
                statement_timestamp()
              )
              and public.has_profile_campaign_capability(
                p_actor_profile_id,
                p_destination_campaign_slug,
                'campaign.permissions.manage',
                statement_timestamp()
              )
            )
          then 'Reconciliar grants exige permission management em origem e destino.'
          else 'Grants específicos da sessão precisam de decisão explícita: preservar ou revogar.'
        end
    ));
  end if;

  if v_current_draft_id is not null then
    select nullif(btrim(d.cover_asset_id), '')
    into v_cover
    from public.session_editorial_drafts d
    where d.id = v_current_draft_id
      and d.session_id = p_session_id;

    if found and v_cover is not null then
      if v_cover ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        select exists (
          select 1
          from public.media_assets ma
          where ma.id = v_cover::uuid
            and ma.campaign_id = p_source_campaign_id
            and ma.role_hint = 'session_cover'
            and ma.status in ('staged', 'verified_public')
            and ma.read_back_verified = true
            and ma.object_key like (
              'campaigns/' || p_source_campaign_slug || '/sessions/' ||
              lower(p_session_id::text) || '/cover/%'
            )
        )
        into v_cover_valid;

        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'code', case when v_cover_valid then 'current_draft_cover' else 'current_draft_cover_invalid' end,
          'family', 'session_cover',
          'classification', case when v_cover_valid then 'external_prepare' else 'hard_block' end,
          'resolved', v_cover_valid,
          'count', 1,
          'message',
            case
              when v_cover_valid
              then 'A capa atual será copiada e verificada no namespace da campanha de destino antes do commit.'
              else 'A capa atual não corresponde a um asset íntegro da campanha de origem.'
            end
        ));
      else
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'code', 'legacy_current_draft_cover',
          'family', 'session_cover',
          'classification', 'decision',
          'resolved', p_options->>'legacyCoverPolicy' = 'clear_current',
          'count', 1,
          'actionId', 'legacy_cover_clear',
          'selectedPolicy', p_options->>'legacyCoverPolicy',
          'message', 'A capa legada não pode trocar de namespace com segurança; o novo current draft precisa iniciar sem ela.'
        ));
      end if;
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'current_editorial_draft_bridge',
      'family', 'editorial_drafts',
      'classification', 'auto',
      'resolved', true,
      'count', 1,
      'message', 'O draft atual será preservado e um bridge draft imutável será criado no destino.'
    ));
  end if;

  return v_items;
end;
$tda_move$;

create or replace function public.preflight_session_campaign_move_v2(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_source_campaign_slug text,
  p_destination_campaign_slug text,
  p_session_id uuid,
  p_source_session_id text,
  p_options jsonb
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
  v_session public.sessions%rowtype;
  v_items jsonb;
  v_blockers jsonb;
  v_ready boolean;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_source_campaign_slug is null
     or p_destination_campaign_slug is null
     or p_source_campaign_slug = p_destination_campaign_slug
     or p_session_id is null
     or p_source_session_id is null
     or btrim(p_source_session_id) = ''
     or not public.session_campaign_move_options_valid(coalesce(p_options, '{}'::jsonb)) then
    return jsonb_build_object(
      'status', 'validation',
      'contractVersion', 'tda_session_campaign_move_v2',
      'blockers', '[]'::jsonb,
      'planItems', '[]'::jsonb
    );
  end if;

  p_options := coalesce(p_options, '{}'::jsonb);

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
      and p.auth_user_id = p_auth_user_id
  ) then
    return jsonb_build_object(
      'status', 'forbidden',
      'contractVersion', 'tda_session_campaign_move_v2',
      'blockers', '[]'::jsonb,
      'planItems', '[]'::jsonb
    );
  end if;

  select * into v_source
  from public.campaigns
  where slug = p_source_campaign_slug;

  select * into v_destination
  from public.campaigns
  where slug = p_destination_campaign_slug;

  if v_source.id is null or v_destination.id is null then
    return jsonb_build_object(
      'status', 'not_found',
      'contractVersion', 'tda_session_campaign_move_v2',
      'blockers', '[]'::jsonb,
      'planItems', '[]'::jsonb
    );
  end if;

  if v_source.lifecycle <> 'active' or v_destination.lifecycle <> 'active' then
    return jsonb_build_object(
      'status', 'blocked',
      'contractVersion', 'tda_session_campaign_move_v2',
      'blockers', jsonb_build_array(jsonb_build_object(
        'code', case when v_source.lifecycle <> 'active' then 'source_archived' else 'destination_archived' end,
        'count', 1,
        'message', 'Campanhas arquivadas são somente leitura para esta operação.'
      )),
      'planItems', '[]'::jsonb
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
    return jsonb_build_object(
      'status', 'forbidden',
      'contractVersion', 'tda_session_campaign_move_v2',
      'blockers', '[]'::jsonb,
      'planItems', '[]'::jsonb
    );
  end if;

  select *
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    return jsonb_build_object(
      'status', 'conflict',
      'contractVersion', 'tda_session_campaign_move_v2',
      'blockers', '[]'::jsonb,
      'planItems', '[]'::jsonb
    );
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
      'contractVersion', 'tda_session_campaign_move_v2',
      'blockers', jsonb_build_array(jsonb_build_object(
        'code', 'source_identity_collision',
        'count', 1,
        'message', 'O destino já possui uma sessão com o mesmo sourceSessionId.'
      )),
      'planItems', jsonb_build_array(jsonb_build_object(
        'code', 'source_identity_collision',
        'family', 'session',
        'classification', 'hard_block',
        'resolved', false,
        'count', 1,
        'message', 'O destino já possui uma sessão com o mesmo sourceSessionId.'
      ))
    );
  end if;

  v_items := public.session_campaign_move_plan_v2(
    p_actor_profile_id,
    v_source.id,
    v_destination.id,
    p_source_campaign_slug,
    p_destination_campaign_slug,
    p_session_id,
    p_options
  );

  select not exists (
    select 1
    from jsonb_array_elements(v_items) item
    where item->>'classification' = 'hard_block'
       or (
         item->>'classification' = 'decision'
         and coalesce((item->>'resolved')::boolean, false) is not true
       )
  )
  into v_ready;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', item->>'code',
    'count', greatest(coalesce((item->>'count')::bigint, 1), 1),
    'message', item->>'message'
  )), '[]'::jsonb)
  into v_blockers
  from jsonb_array_elements(v_items) item
  where item->>'classification' = 'hard_block'
     or (
       item->>'classification' = 'decision'
       and coalesce((item->>'resolved')::boolean, false) is not true
     );

  return jsonb_build_object(
    'status', case when v_ready then 'ready' else 'blocked' end,
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'blockers', v_blockers,
    'planItems', v_items,
    'consequences', jsonb_build_array(
      'edit_url_changes',
      'campaign_scope_changes',
      'cache_revalidation_required'
    )
  );
end;
$tda_move$;

create or replace function public.move_session_campaign_atomic_v2(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_source_campaign_slug text,
  p_destination_campaign_slug text,
  p_session_id uuid,
  p_source_session_id text,
  p_operation_id uuid,
  p_options jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $tda_move$
declare
  v_existing public.session_campaign_move_operations%rowtype;
  v_source public.campaigns%rowtype;
  v_destination public.campaigns%rowtype;
  v_session public.sessions%rowtype;
  v_preflight jsonb;
  v_decisions jsonb;
  v_current_draft public.session_editorial_drafts%rowtype;
  v_bridge_draft_id uuid;
  v_bridge_revision bigint;
  v_bridge_cover text;
  v_prepared jsonb;
  v_source_media public.media_assets%rowtype;
  v_destination_media public.media_assets%rowtype;
  v_media_preparation public.session_campaign_move_media_preparations%rowtype;
  v_source_asset_id uuid;
  v_destination_asset_id uuid;
  v_expected_source_key text;
  v_expected_destination_key text;
  v_extension text;
  v_participant_unlinks bigint := 0;
  v_entity_detaches bigint := 0;
  v_canon_detaches bigint := 0;
  v_grant_count bigint := 0;
begin
  p_options := coalesce(p_options, '{}'::jsonb);
  if p_operation_id is null
     or not public.session_campaign_move_options_valid(p_options) then
    return jsonb_build_object('status', 'validation');
  end if;

  v_decisions := public.session_campaign_move_decisions(p_options);

  select *
  into v_existing
  from public.session_campaign_move_operations o
  where o.operation_id = p_operation_id;

  if found then
    if v_existing.contract_version = 'tda_session_campaign_move_v2'
       and v_existing.session_id = p_session_id
       and v_existing.actor_profile_id = p_actor_profile_id
       and v_existing.source_session_id = p_source_session_id
       and v_existing.decisions = v_decisions
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
        'contractVersion', 'tda_session_campaign_move_v2',
        'sessionId', p_session_id,
        'sourceSessionId', p_source_session_id,
        'sourceCampaignSlug', p_source_campaign_slug,
        'destinationCampaignSlug', p_destination_campaign_slug,
        'operationId', p_operation_id
      );
    end if;
    return jsonb_build_object('status', 'operation_conflict');
  end if;

  select * into v_source
  from public.campaigns
  where slug = p_source_campaign_slug;

  select * into v_destination
  from public.campaigns
  where slug = p_destination_campaign_slug;

  if v_source.id is null or v_destination.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select *
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id
  for update;

  if not found then
    return jsonb_build_object('status', 'conflict');
  end if;

  v_preflight := public.preflight_session_campaign_move_v2(
    p_auth_user_id,
    p_actor_profile_id,
    p_source_campaign_slug,
    p_destination_campaign_slug,
    p_session_id,
    p_source_session_id,
    v_decisions
  );

  if v_preflight->>'status' <> 'ready' then
    return v_preflight;
  end if;

  if v_session.current_editorial_draft_id is not null then
    select *
    into v_current_draft
    from public.session_editorial_drafts d
    where d.id = v_session.current_editorial_draft_id
      and d.session_id = p_session_id
    for share;

    if not found then
      raise exception 'current editorial draft pointer is inconsistent';
    end if;

    v_bridge_cover := nullif(btrim(v_current_draft.cover_asset_id), '');
    if v_bridge_cover is not null
       and v_bridge_cover ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_source_asset_id := v_bridge_cover::uuid;
      v_prepared := p_options->'preparedCover';

      if v_prepared is null
         or coalesce(v_prepared->>'sourceAssetId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}

      select *
      into v_source_media
      from public.media_assets ma
      where ma.id = v_source_asset_id
        and ma.campaign_id = v_source.id
        and ma.role_hint = 'session_cover'
        and ma.status in ('staged', 'verified_public')
        and ma.read_back_verified = true;

      if not found
         or v_source_media.sha256 <> v_prepared->>'sha256'
         or v_source_media.mime_type <> v_prepared->>'mimeType'
         or v_source_media.byte_size <> (v_prepared->>'bytes')::bigint
         or v_source_media.width <> (v_prepared->>'width')::integer
         or v_source_media.height <> (v_prepared->>'height')::integer then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_extension := case when v_source_media.mime_type = 'image/png' then 'png' else 'webp' end;
      v_expected_source_key :=
        'campaigns/' || p_source_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;
      v_expected_destination_key :=
        'campaigns/' || p_destination_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;

      if v_source_media.object_key <> v_expected_source_key
         or v_prepared->>'objectKey' <> v_expected_destination_key then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      select *
      into v_media_preparation
      from public.session_campaign_move_media_preparations prep
      where prep.operation_id = p_operation_id
        and prep.source_asset_id = v_source_asset_id
        and prep.destination_asset_id = v_destination_asset_id
        and prep.session_id = p_session_id
        and prep.source_campaign_id = v_source.id
        and prep.destination_campaign_id = v_destination.id
        and prep.actor_profile_id = p_actor_profile_id;

      if not found then
        return jsonb_build_object('status', 'media_prepare_required');
      end if;

      if v_media_preparation.source_object_key <> v_expected_source_key
         or v_media_preparation.destination_object_key <> v_expected_destination_key
         or v_media_preparation.sha256 <> v_prepared->>'sha256'
         or v_media_preparation.mime_type <> v_prepared->>'mimeType'
         or v_media_preparation.byte_size <> (v_prepared->>'bytes')::bigint
         or v_media_preparation.width <> (v_prepared->>'width')::integer
         or v_media_preparation.height <> (v_prepared->>'height')::integer
         or v_media_preparation.status <> v_prepared->>'status'
         or v_media_preparation.staged_bucket <> v_prepared->>'stagedBucket'
         or v_media_preparation.public_bucket is distinct from nullif(v_prepared->>'publicBucket', '')
         or v_media_preparation.public_object_key is distinct from nullif(v_prepared->>'publicObjectKey', '')
         or v_media_preparation.public_delivery_verified is distinct from
              coalesce((v_prepared->>'publicDeliveryVerified')::boolean, false)
         or v_media_preparation.public_verified_at is distinct from
              nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      select *
      into v_destination_media
      from public.media_assets ma
      where ma.id = v_destination_asset_id;

      if found then
        if v_destination_media.campaign_id <> v_destination.id
           or v_destination_media.role_hint <> 'session_cover'
           or v_destination_media.sha256 <> v_source_media.sha256
           or v_destination_media.mime_type <> v_source_media.mime_type
           or v_destination_media.byte_size <> v_source_media.byte_size
           or v_destination_media.width <> v_source_media.width
           or v_destination_media.height <> v_source_media.height
           or v_destination_media.staged_bucket <> v_prepared->>'stagedBucket'
           or v_destination_media.object_key <> v_expected_destination_key
           or v_destination_media.read_back_verified is not true then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;

        if v_destination.visibility <> 'public'
           and v_destination_media.status = 'verified_public' then
          update public.media_assets ma
          set
            status = 'staged',
            public_bucket = null,
            public_object_key = null,
            public_delivery_verified = false,
            public_verified_at = null,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'verified_public'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;

          select *
          into v_destination_media
          from public.media_assets ma
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id;
        end if;

        if v_prepared->>'status' = 'verified_public'
           and v_destination_media.status = 'staged' then
          update public.media_assets ma
          set
            status = 'verified_public',
            public_bucket = nullif(v_prepared->>'publicBucket', ''),
            public_object_key = nullif(v_prepared->>'publicObjectKey', ''),
            public_delivery_verified = coalesce(
              (v_prepared->>'publicDeliveryVerified')::boolean,
              false
            ),
            public_verified_at =
              nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'staged'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;
        elsif v_destination_media.status = 'retired' then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      else
        insert into public.media_assets(
          id,
          campaign_id,
          media_kind,
          role_hint,
          status,
          staged_bucket,
          object_key,
          sha256,
          mime_type,
          byte_size,
          width,
          height,
          read_back_verified,
          public_bucket,
          public_object_key,
          public_delivery_verified,
          public_verified_at,
          created_by
        ) values (
          v_destination_asset_id,
          v_destination.id,
          'image',
          'session_cover',
          v_prepared->>'status',
          v_prepared->>'stagedBucket',
          v_prepared->>'objectKey',
          v_prepared->>'sha256',
          v_prepared->>'mimeType',
          (v_prepared->>'bytes')::bigint,
          (v_prepared->>'width')::integer,
          (v_prepared->>'height')::integer,
          true,
          nullif(v_prepared->>'publicBucket', ''),
          nullif(v_prepared->>'publicObjectKey', ''),
          coalesce((v_prepared->>'publicDeliveryVerified')::boolean, false),
          nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
          p_actor_profile_id
        );
      end if;

      if v_prepared->>'status' = 'verified_public' then
        select *
        into v_destination_media
        from public.media_assets ma
        where ma.id = v_destination_asset_id
          and ma.campaign_id = v_destination.id
          and ma.status = 'verified_public'
          and ma.public_bucket = 'tda-media-public'
          and ma.public_object_key = ma.object_key
          and ma.public_delivery_verified = true
          and ma.public_verified_at is not null;

        if not found then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      end if;

      v_bridge_cover := v_destination_asset_id::text;
    elsif v_bridge_cover is not null then
      if p_options->>'legacyCoverPolicy' <> 'clear_current' then
        return jsonb_build_object('status', 'blocked');
      end if;
      v_bridge_cover := null;
    end if;

    select coalesce(max(d.revision), 0) + 1
    into v_bridge_revision
    from public.session_editorial_drafts d
    where d.session_id = p_session_id;

    v_bridge_draft_id := gen_random_uuid();

    insert into public.session_editorial_drafts(
      id,
      campaign_id,
      session_id,
      revision,
      base_transcript_revision_id,
      cover_asset_id,
      arc,
      title,
      summary_short,
      summary_full,
      actor_profile_id,
      created_at,
      session_date,
      session_date_captured
    ) values (
      v_bridge_draft_id,
      v_destination.id,
      p_session_id,
      v_bridge_revision,
      v_current_draft.base_transcript_revision_id,
      v_bridge_cover,
      v_current_draft.arc,
      v_current_draft.title,
      v_current_draft.summary_short,
      v_current_draft.summary_full,
      p_actor_profile_id,
      clock_timestamp(),
      v_current_draft.session_date,
      v_current_draft.session_date_captured
    );
  end if;

  insert into public.session_campaign_move_operations(
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    actor_profile_id,
    contract_version,
    decisions
  ) values (
    p_operation_id,
    p_session_id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_actor_profile_id,
    'tda_session_campaign_move_v2',
    v_decisions
  );

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select
    p_operation_id,
    'transcript_revision',
    tr.id,
    v_source.id,
    v_destination.id
  from public.transcript_revisions tr
  where tr.session_id = p_session_id
    and tr.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_receipt', r.id, v_source.id, v_destination.id
  from public.transcript_publication_receipts r
  where r.session_id = p_session_id
    and r.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_event', e.id, v_source.id, v_destination.id
  from public.transcript_publication_events e
  where e.session_id = p_session_id
    and e.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if to_regclass('public.transcript_assembly_publication_receipts') is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'transcript_assembly_receipt', r.id, v_source.id, v_destination.id
    from public.transcript_assembly_publication_receipts r
    where r.session_id = p_session_id
      and r.campaign_id = v_source.id
    on conflict do nothing;

    update public.transcript_assembly_publication_receipts
    set campaign_id = v_destination.id
    where session_id = p_session_id
      and campaign_id = v_source.id;
  end if;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication', sp.id, v_source.id, v_destination.id
  from public.session_publications sp
  where sp.session_id = p_session_id
    and sp.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication_operation', spo.operation_id, v_source.id, v_destination.id
  from public.session_publication_operations spo
  where spo.session_id = p_session_id
    and spo.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if p_options->>'participantEntityPolicy' = 'unlink' then
    select count(*)
    into v_participant_unlinks
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'participant_entity_unlink',
      p.id,
      p.character_entity_id,
      v_source.id,
      v_destination.id
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null
    on conflict do nothing;

    update public.participants
    set character_entity_id = null
    where session_id = p_session_id
      and character_entity_id is not null;
  end if;

  if p_options->>'entityMentionPolicy' = 'detach_from_session' then
    select count(*)
    into v_entity_detaches
    from public.entity_mentions em
    where em.session_id = p_session_id;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'entity_mention_detach',
      em.id,
      em.entity_id,
      v_source.id,
      v_destination.id
    from public.entity_mentions em
    where em.session_id = p_session_id
    on conflict do nothing;

    update public.entity_mentions
    set session_id = null
    where session_id = p_session_id;
  end if;

  if p_options->>'canonPolicy' = 'detach_entity_links' then
    if exists (
      select 1
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id
    ) then
      return jsonb_build_object('status', 'blocked');
    end if;

    select count(*)
    into v_canon_detaches
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'canon_candidate_entity_detach', cc.id, v_source.id, v_destination.id
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0
    on conflict do nothing;

    update public.canon_candidates
    set related_entity_ids = null
    where session_id = p_session_id
      and coalesce(cardinality(related_entity_ids), 0) > 0;
  end if;

  if p_options->>'sessionGrantPolicy' in ('preserve', 'revoke') then
    select count(*)
    into v_grant_count
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible');

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      case
        when p_options->>'sessionGrantPolicy' = 'revoke'
          then 'session_grant_revoke'
        else 'session_grant_preserve'
      end,
      ra.id,
      v_source.id,
      v_destination.id
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible')
    on conflict do nothing;

    if p_options->>'sessionGrantPolicy' = 'revoke' then
      update public.role_assignments
      set
        status = 'revoked',
        revoked_by = p_actor_profile_id,
        updated_at = clock_timestamp()
      where scope_type = 'session'
        and scope_id = p_session_id::text
        and status in ('active', 'eligible');
    end if;
  end if;

  if v_session.current_session_publication_id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'active_session_publication_unpublish',
      v_session.current_session_publication_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;
  end if;

  if v_current_draft.id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'editorial_draft_bridge',
      v_current_draft.id,
      v_bridge_draft_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;

    if v_source_asset_id is not null and v_destination_asset_id is not null then
      insert into public.session_campaign_move_artifacts(
        operation_id, artifact_kind, artifact_id, related_artifact_id,
        source_campaign_id, destination_campaign_id
      ) values (
        p_operation_id,
        'session_cover_rehome',
        v_source_asset_id,
        v_destination_asset_id,
        v_source.id,
        v_destination.id
      )
      on conflict do nothing;
    end if;
  end if;

  if v_participant_unlinks > 0
     or v_entity_detaches > 0
     or v_canon_detaches > 0
     or v_grant_count > 0 then
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
      v_destination.id,
      p_session_id,
      p_actor_profile_id,
      'session.campaign.move.reconcile',
      'sessions',
      p_session_id,
      jsonb_build_object(
        'campaignId', v_source.id,
        'participantEntityLinks', v_participant_unlinks,
        'entityMentions', v_entity_detaches,
        'canonCandidateEntityLinks', v_canon_detaches,
        'sessionGrants', v_grant_count
      ),
      jsonb_build_object(
        'campaignId', v_destination.id,
        'participantEntityPolicy', p_options->>'participantEntityPolicy',
        'entityMentionPolicy', p_options->>'entityMentionPolicy',
        'canonPolicy', p_options->>'canonPolicy',
        'sessionGrantPolicy', p_options->>'sessionGrantPolicy'
      )
    );
  end if;

  update public.sessions s
  set
    campaign_id = v_destination.id,
    current_editorial_draft_id = coalesce(v_bridge_draft_id, s.current_editorial_draft_id),
    current_session_publication_id =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then null
        else s.current_session_publication_id
      end,
    status =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then 'approved'
        else s.status
      end,
    metadata =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
        then (coalesce(s.metadata, '{}'::jsonb) - 'coverImageUrl' - 'heroImageUrl')
        else s.metadata
      end,
    updated_at = clock_timestamp()
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    raise exception 'session campaign authority changed while locked';
  end if;

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
    v_destination.id,
    p_session_id,
    p_actor_profile_id,
    'session.campaign.move.v2',
    'sessions',
    p_session_id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', p_source_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'published', v_session.current_session_publication_id is not null or v_session.status = 'published'
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', p_destination_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'publicationPolicy', p_options->>'publishedPolicy',
      'bridgeDraftId', v_bridge_draft_id,
      'contractVersion', 'tda_session_campaign_move_v2'
    )
  );

  return jsonb_build_object(
    'status', 'moved',
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'operationId', p_operation_id,
    'bridgeDraftId', v_bridge_draft_id,
    'publicationState',
      case
        when v_session.current_session_publication_id is not null or v_session.status = 'published'
          then 'unpublished'
        else 'unchanged'
      end
  );
end;
$tda_move$;

comment on function public.session_campaign_move_contract_v2() is
  'Sanitized server-only capability probe for the v2 populated-session move boundary.';
comment on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) is
  'Server-only v2 preflight. Produces a structured migration plan and requires explicit decisions for public/entity/grant boundaries.';
comment on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) is
  'Server-only v2 commit. Revalidates/locks source, preserves immutable history attribution, migrates current transcript ownership, creates a bridge draft, reconciles explicit decisions and commits the session move atomically.';

revoke all on function public.session_campaign_move_set_origin_campaign() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_registry_drift() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_contract_v2() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_decisions(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_options_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_plan_v2(uuid,uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.session_campaign_move_contract_v2() to service_role;
grant execute on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) to service_role;

commit;

         or coalesce(v_prepared->>'destinationAssetId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}

      select *
      into v_source_media
      from public.media_assets ma
      where ma.id = v_source_asset_id
        and ma.campaign_id = v_source.id
        and ma.role_hint = 'session_cover'
        and ma.status in ('staged', 'verified_public')
        and ma.read_back_verified = true;

      if not found
         or v_source_media.sha256 <> v_prepared->>'sha256'
         or v_source_media.mime_type <> v_prepared->>'mimeType'
         or v_source_media.byte_size <> (v_prepared->>'bytes')::bigint
         or v_source_media.width <> (v_prepared->>'width')::integer
         or v_source_media.height <> (v_prepared->>'height')::integer then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_extension := case when v_source_media.mime_type = 'image/png' then 'png' else 'webp' end;
      v_expected_source_key :=
        'campaigns/' || p_source_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;
      v_expected_destination_key :=
        'campaigns/' || p_destination_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;

      if v_source_media.object_key <> v_expected_source_key
         or v_prepared->>'objectKey' <> v_expected_destination_key then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      select *
      into v_destination_media
      from public.media_assets ma
      where ma.id = v_destination_asset_id;

      if found then
        if v_destination_media.campaign_id <> v_destination.id
           or v_destination_media.role_hint <> 'session_cover'
           or v_destination_media.sha256 <> v_source_media.sha256
           or v_destination_media.mime_type <> v_source_media.mime_type
           or v_destination_media.byte_size <> v_source_media.byte_size
           or v_destination_media.width <> v_source_media.width
           or v_destination_media.height <> v_source_media.height
           or v_destination_media.staged_bucket <> v_prepared->>'stagedBucket'
           or v_destination_media.object_key <> v_expected_destination_key
           or v_destination_media.read_back_verified is not true then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;

        if v_prepared->>'status' = 'verified_public'
           and v_destination_media.status = 'staged' then
          update public.media_assets ma
          set
            status = 'verified_public',
            public_bucket = nullif(v_prepared->>'publicBucket', ''),
            public_object_key = nullif(v_prepared->>'publicObjectKey', ''),
            public_delivery_verified = coalesce(
              (v_prepared->>'publicDeliveryVerified')::boolean,
              false
            ),
            public_verified_at =
              nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'staged'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;
        elsif v_destination_media.status = 'retired' then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      else
        insert into public.media_assets(
          id,
          campaign_id,
          media_kind,
          role_hint,
          status,
          staged_bucket,
          object_key,
          sha256,
          mime_type,
          byte_size,
          width,
          height,
          read_back_verified,
          public_bucket,
          public_object_key,
          public_delivery_verified,
          public_verified_at,
          created_by
        ) values (
          v_destination_asset_id,
          v_destination.id,
          'image',
          'session_cover',
          v_prepared->>'status',
          v_prepared->>'stagedBucket',
          v_prepared->>'objectKey',
          v_prepared->>'sha256',
          v_prepared->>'mimeType',
          (v_prepared->>'bytes')::bigint,
          (v_prepared->>'width')::integer,
          (v_prepared->>'height')::integer,
          true,
          nullif(v_prepared->>'publicBucket', ''),
          nullif(v_prepared->>'publicObjectKey', ''),
          coalesce((v_prepared->>'publicDeliveryVerified')::boolean, false),
          nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
          p_actor_profile_id
        );
      end if;

      if v_prepared->>'status' = 'verified_public' then
        select *
        into v_destination_media
        from public.media_assets ma
        where ma.id = v_destination_asset_id
          and ma.campaign_id = v_destination.id
          and ma.status = 'verified_public'
          and ma.public_bucket = 'tda-media-public'
          and ma.public_object_key = ma.object_key
          and ma.public_delivery_verified = true
          and ma.public_verified_at is not null;

        if not found then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      end if;

      v_bridge_cover := v_destination_asset_id::text;
    elsif v_bridge_cover is not null then
      if p_options->>'legacyCoverPolicy' <> 'clear_current' then
        return jsonb_build_object('status', 'blocked');
      end if;
      v_bridge_cover := null;
    end if;

    select coalesce(max(d.revision), 0) + 1
    into v_bridge_revision
    from public.session_editorial_drafts d
    where d.session_id = p_session_id;

    v_bridge_draft_id := gen_random_uuid();

    insert into public.session_editorial_drafts(
      id,
      campaign_id,
      session_id,
      revision,
      base_transcript_revision_id,
      cover_asset_id,
      arc,
      title,
      summary_short,
      summary_full,
      actor_profile_id,
      created_at,
      session_date,
      session_date_captured
    ) values (
      v_bridge_draft_id,
      v_destination.id,
      p_session_id,
      v_bridge_revision,
      v_current_draft.base_transcript_revision_id,
      v_bridge_cover,
      v_current_draft.arc,
      v_current_draft.title,
      v_current_draft.summary_short,
      v_current_draft.summary_full,
      p_actor_profile_id,
      clock_timestamp(),
      v_current_draft.session_date,
      v_current_draft.session_date_captured
    );
  end if;

  insert into public.session_campaign_move_operations(
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    actor_profile_id,
    contract_version,
    decisions
  ) values (
    p_operation_id,
    p_session_id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_actor_profile_id,
    'tda_session_campaign_move_v2',
    v_decisions
  );

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select
    p_operation_id,
    'transcript_revision',
    tr.id,
    v_source.id,
    v_destination.id
  from public.transcript_revisions tr
  where tr.session_id = p_session_id
    and tr.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_receipt', r.id, v_source.id, v_destination.id
  from public.transcript_publication_receipts r
  where r.session_id = p_session_id
    and r.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_event', e.id, v_source.id, v_destination.id
  from public.transcript_publication_events e
  where e.session_id = p_session_id
    and e.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if to_regclass('public.transcript_assembly_publication_receipts') is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'transcript_assembly_receipt', r.id, v_source.id, v_destination.id
    from public.transcript_assembly_publication_receipts r
    where r.session_id = p_session_id
      and r.campaign_id = v_source.id
    on conflict do nothing;

    update public.transcript_assembly_publication_receipts
    set campaign_id = v_destination.id
    where session_id = p_session_id
      and campaign_id = v_source.id;
  end if;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication', sp.id, v_source.id, v_destination.id
  from public.session_publications sp
  where sp.session_id = p_session_id
    and sp.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication_operation', spo.operation_id, v_source.id, v_destination.id
  from public.session_publication_operations spo
  where spo.session_id = p_session_id
    and spo.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if p_options->>'participantEntityPolicy' = 'unlink' then
    select count(*)
    into v_participant_unlinks
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'participant_entity_unlink',
      p.id,
      p.character_entity_id,
      v_source.id,
      v_destination.id
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null
    on conflict do nothing;

    update public.participants
    set character_entity_id = null
    where session_id = p_session_id
      and character_entity_id is not null;
  end if;

  if p_options->>'entityMentionPolicy' = 'detach_from_session' then
    select count(*)
    into v_entity_detaches
    from public.entity_mentions em
    where em.session_id = p_session_id;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'entity_mention_detach',
      em.id,
      em.entity_id,
      v_source.id,
      v_destination.id
    from public.entity_mentions em
    where em.session_id = p_session_id
    on conflict do nothing;

    update public.entity_mentions
    set session_id = null
    where session_id = p_session_id;
  end if;

  if p_options->>'canonPolicy' = 'detach_entity_links' then
    if exists (
      select 1
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id
    ) then
      return jsonb_build_object('status', 'blocked');
    end if;

    select count(*)
    into v_canon_detaches
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'canon_candidate_entity_detach', cc.id, v_source.id, v_destination.id
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0
    on conflict do nothing;

    update public.canon_candidates
    set related_entity_ids = null
    where session_id = p_session_id
      and coalesce(cardinality(related_entity_ids), 0) > 0;
  end if;

  if p_options->>'sessionGrantPolicy' in ('preserve', 'revoke') then
    select count(*)
    into v_grant_count
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible');

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      case
        when p_options->>'sessionGrantPolicy' = 'revoke'
          then 'session_grant_revoke'
        else 'session_grant_preserve'
      end,
      ra.id,
      v_source.id,
      v_destination.id
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible')
    on conflict do nothing;

    if p_options->>'sessionGrantPolicy' = 'revoke' then
      update public.role_assignments
      set
        status = 'revoked',
        revoked_by = p_actor_profile_id,
        updated_at = clock_timestamp()
      where scope_type = 'session'
        and scope_id = p_session_id::text
        and status in ('active', 'eligible');
    end if;
  end if;

  if v_session.current_session_publication_id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'active_session_publication_unpublish',
      v_session.current_session_publication_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;
  end if;

  if v_current_draft.id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'editorial_draft_bridge',
      v_current_draft.id,
      v_bridge_draft_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;

    if v_source_asset_id is not null and v_destination_asset_id is not null then
      insert into public.session_campaign_move_artifacts(
        operation_id, artifact_kind, artifact_id, related_artifact_id,
        source_campaign_id, destination_campaign_id
      ) values (
        p_operation_id,
        'session_cover_rehome',
        v_source_asset_id,
        v_destination_asset_id,
        v_source.id,
        v_destination.id
      )
      on conflict do nothing;
    end if;
  end if;

  if v_participant_unlinks > 0
     or v_entity_detaches > 0
     or v_canon_detaches > 0
     or v_grant_count > 0 then
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
      v_destination.id,
      p_session_id,
      p_actor_profile_id,
      'session.campaign.move.reconcile',
      'sessions',
      p_session_id,
      jsonb_build_object(
        'campaignId', v_source.id,
        'participantEntityLinks', v_participant_unlinks,
        'entityMentions', v_entity_detaches,
        'canonCandidateEntityLinks', v_canon_detaches,
        'sessionGrants', v_grant_count
      ),
      jsonb_build_object(
        'campaignId', v_destination.id,
        'participantEntityPolicy', p_options->>'participantEntityPolicy',
        'entityMentionPolicy', p_options->>'entityMentionPolicy',
        'canonPolicy', p_options->>'canonPolicy',
        'sessionGrantPolicy', p_options->>'sessionGrantPolicy'
      )
    );
  end if;

  update public.sessions s
  set
    campaign_id = v_destination.id,
    current_editorial_draft_id = coalesce(v_bridge_draft_id, s.current_editorial_draft_id),
    current_session_publication_id =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then null
        else s.current_session_publication_id
      end,
    status =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then 'approved'
        else s.status
      end,
    metadata =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
        then (coalesce(s.metadata, '{}'::jsonb) - 'coverImageUrl' - 'heroImageUrl')
        else s.metadata
      end,
    updated_at = clock_timestamp()
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    raise exception 'session campaign authority changed while locked';
  end if;

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
    v_destination.id,
    p_session_id,
    p_actor_profile_id,
    'session.campaign.move.v2',
    'sessions',
    p_session_id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', p_source_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'published', v_session.current_session_publication_id is not null or v_session.status = 'published'
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', p_destination_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'publicationPolicy', p_options->>'publishedPolicy',
      'bridgeDraftId', v_bridge_draft_id,
      'contractVersion', 'tda_session_campaign_move_v2'
    )
  );

  return jsonb_build_object(
    'status', 'moved',
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'operationId', p_operation_id,
    'bridgeDraftId', v_bridge_draft_id,
    'publicationState',
      case
        when v_session.current_session_publication_id is not null or v_session.status = 'published'
          then 'unpublished'
        else 'unchanged'
      end
  );
end;
$tda_move$;

comment on function public.session_campaign_move_contract_v2() is
  'Sanitized server-only capability probe for the v2 populated-session move boundary.';
comment on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) is
  'Server-only v2 preflight. Produces a structured migration plan and requires explicit decisions for public/entity/grant boundaries.';
comment on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) is
  'Server-only v2 commit. Revalidates/locks source, preserves immutable history attribution, migrates current transcript ownership, creates a bridge draft, reconciles explicit decisions and commits the session move atomically.';

revoke all on function public.session_campaign_move_set_origin_campaign() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_registry_drift() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_contract_v2() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_decisions(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_options_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_plan_v2(uuid,uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.session_campaign_move_contract_v2() to service_role;
grant execute on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) to service_role;

commit;

         or (v_prepared->>'sourceAssetId')::uuid <> v_source_asset_id
         or coalesce(v_prepared->>'sha256', '') !~ '^[0-9a-f]{64}

      select *
      into v_source_media
      from public.media_assets ma
      where ma.id = v_source_asset_id
        and ma.campaign_id = v_source.id
        and ma.role_hint = 'session_cover'
        and ma.status in ('staged', 'verified_public')
        and ma.read_back_verified = true;

      if not found
         or v_source_media.sha256 <> v_prepared->>'sha256'
         or v_source_media.mime_type <> v_prepared->>'mimeType'
         or v_source_media.byte_size <> (v_prepared->>'bytes')::bigint
         or v_source_media.width <> (v_prepared->>'width')::integer
         or v_source_media.height <> (v_prepared->>'height')::integer then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_extension := case when v_source_media.mime_type = 'image/png' then 'png' else 'webp' end;
      v_expected_source_key :=
        'campaigns/' || p_source_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;
      v_expected_destination_key :=
        'campaigns/' || p_destination_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;

      if v_source_media.object_key <> v_expected_source_key
         or v_prepared->>'objectKey' <> v_expected_destination_key then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      select *
      into v_destination_media
      from public.media_assets ma
      where ma.id = v_destination_asset_id;

      if found then
        if v_destination_media.campaign_id <> v_destination.id
           or v_destination_media.role_hint <> 'session_cover'
           or v_destination_media.sha256 <> v_source_media.sha256
           or v_destination_media.mime_type <> v_source_media.mime_type
           or v_destination_media.byte_size <> v_source_media.byte_size
           or v_destination_media.width <> v_source_media.width
           or v_destination_media.height <> v_source_media.height
           or v_destination_media.staged_bucket <> v_prepared->>'stagedBucket'
           or v_destination_media.object_key <> v_expected_destination_key
           or v_destination_media.read_back_verified is not true then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;

        if v_prepared->>'status' = 'verified_public'
           and v_destination_media.status = 'staged' then
          update public.media_assets ma
          set
            status = 'verified_public',
            public_bucket = nullif(v_prepared->>'publicBucket', ''),
            public_object_key = nullif(v_prepared->>'publicObjectKey', ''),
            public_delivery_verified = coalesce(
              (v_prepared->>'publicDeliveryVerified')::boolean,
              false
            ),
            public_verified_at =
              nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'staged'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;
        elsif v_destination_media.status = 'retired' then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      else
        insert into public.media_assets(
          id,
          campaign_id,
          media_kind,
          role_hint,
          status,
          staged_bucket,
          object_key,
          sha256,
          mime_type,
          byte_size,
          width,
          height,
          read_back_verified,
          public_bucket,
          public_object_key,
          public_delivery_verified,
          public_verified_at,
          created_by
        ) values (
          v_destination_asset_id,
          v_destination.id,
          'image',
          'session_cover',
          v_prepared->>'status',
          v_prepared->>'stagedBucket',
          v_prepared->>'objectKey',
          v_prepared->>'sha256',
          v_prepared->>'mimeType',
          (v_prepared->>'bytes')::bigint,
          (v_prepared->>'width')::integer,
          (v_prepared->>'height')::integer,
          true,
          nullif(v_prepared->>'publicBucket', ''),
          nullif(v_prepared->>'publicObjectKey', ''),
          coalesce((v_prepared->>'publicDeliveryVerified')::boolean, false),
          nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
          p_actor_profile_id
        );
      end if;

      if v_prepared->>'status' = 'verified_public' then
        select *
        into v_destination_media
        from public.media_assets ma
        where ma.id = v_destination_asset_id
          and ma.campaign_id = v_destination.id
          and ma.status = 'verified_public'
          and ma.public_bucket = 'tda-media-public'
          and ma.public_object_key = ma.object_key
          and ma.public_delivery_verified = true
          and ma.public_verified_at is not null;

        if not found then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      end if;

      v_bridge_cover := v_destination_asset_id::text;
    elsif v_bridge_cover is not null then
      if p_options->>'legacyCoverPolicy' <> 'clear_current' then
        return jsonb_build_object('status', 'blocked');
      end if;
      v_bridge_cover := null;
    end if;

    select coalesce(max(d.revision), 0) + 1
    into v_bridge_revision
    from public.session_editorial_drafts d
    where d.session_id = p_session_id;

    v_bridge_draft_id := gen_random_uuid();

    insert into public.session_editorial_drafts(
      id,
      campaign_id,
      session_id,
      revision,
      base_transcript_revision_id,
      cover_asset_id,
      arc,
      title,
      summary_short,
      summary_full,
      actor_profile_id,
      created_at,
      session_date,
      session_date_captured
    ) values (
      v_bridge_draft_id,
      v_destination.id,
      p_session_id,
      v_bridge_revision,
      v_current_draft.base_transcript_revision_id,
      v_bridge_cover,
      v_current_draft.arc,
      v_current_draft.title,
      v_current_draft.summary_short,
      v_current_draft.summary_full,
      p_actor_profile_id,
      clock_timestamp(),
      v_current_draft.session_date,
      v_current_draft.session_date_captured
    );
  end if;

  insert into public.session_campaign_move_operations(
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    actor_profile_id,
    contract_version,
    decisions
  ) values (
    p_operation_id,
    p_session_id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_actor_profile_id,
    'tda_session_campaign_move_v2',
    v_decisions
  );

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select
    p_operation_id,
    'transcript_revision',
    tr.id,
    v_source.id,
    v_destination.id
  from public.transcript_revisions tr
  where tr.session_id = p_session_id
    and tr.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_receipt', r.id, v_source.id, v_destination.id
  from public.transcript_publication_receipts r
  where r.session_id = p_session_id
    and r.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_event', e.id, v_source.id, v_destination.id
  from public.transcript_publication_events e
  where e.session_id = p_session_id
    and e.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if to_regclass('public.transcript_assembly_publication_receipts') is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'transcript_assembly_receipt', r.id, v_source.id, v_destination.id
    from public.transcript_assembly_publication_receipts r
    where r.session_id = p_session_id
      and r.campaign_id = v_source.id
    on conflict do nothing;

    update public.transcript_assembly_publication_receipts
    set campaign_id = v_destination.id
    where session_id = p_session_id
      and campaign_id = v_source.id;
  end if;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication', sp.id, v_source.id, v_destination.id
  from public.session_publications sp
  where sp.session_id = p_session_id
    and sp.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication_operation', spo.operation_id, v_source.id, v_destination.id
  from public.session_publication_operations spo
  where spo.session_id = p_session_id
    and spo.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if p_options->>'participantEntityPolicy' = 'unlink' then
    select count(*)
    into v_participant_unlinks
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'participant_entity_unlink',
      p.id,
      p.character_entity_id,
      v_source.id,
      v_destination.id
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null
    on conflict do nothing;

    update public.participants
    set character_entity_id = null
    where session_id = p_session_id
      and character_entity_id is not null;
  end if;

  if p_options->>'entityMentionPolicy' = 'detach_from_session' then
    select count(*)
    into v_entity_detaches
    from public.entity_mentions em
    where em.session_id = p_session_id;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'entity_mention_detach',
      em.id,
      em.entity_id,
      v_source.id,
      v_destination.id
    from public.entity_mentions em
    where em.session_id = p_session_id
    on conflict do nothing;

    update public.entity_mentions
    set session_id = null
    where session_id = p_session_id;
  end if;

  if p_options->>'canonPolicy' = 'detach_entity_links' then
    if exists (
      select 1
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id
    ) then
      return jsonb_build_object('status', 'blocked');
    end if;

    select count(*)
    into v_canon_detaches
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'canon_candidate_entity_detach', cc.id, v_source.id, v_destination.id
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0
    on conflict do nothing;

    update public.canon_candidates
    set related_entity_ids = null
    where session_id = p_session_id
      and coalesce(cardinality(related_entity_ids), 0) > 0;
  end if;

  if p_options->>'sessionGrantPolicy' in ('preserve', 'revoke') then
    select count(*)
    into v_grant_count
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible');

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      case
        when p_options->>'sessionGrantPolicy' = 'revoke'
          then 'session_grant_revoke'
        else 'session_grant_preserve'
      end,
      ra.id,
      v_source.id,
      v_destination.id
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible')
    on conflict do nothing;

    if p_options->>'sessionGrantPolicy' = 'revoke' then
      update public.role_assignments
      set
        status = 'revoked',
        revoked_by = p_actor_profile_id,
        updated_at = clock_timestamp()
      where scope_type = 'session'
        and scope_id = p_session_id::text
        and status in ('active', 'eligible');
    end if;
  end if;

  if v_session.current_session_publication_id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'active_session_publication_unpublish',
      v_session.current_session_publication_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;
  end if;

  if v_current_draft.id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'editorial_draft_bridge',
      v_current_draft.id,
      v_bridge_draft_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;

    if v_source_asset_id is not null and v_destination_asset_id is not null then
      insert into public.session_campaign_move_artifacts(
        operation_id, artifact_kind, artifact_id, related_artifact_id,
        source_campaign_id, destination_campaign_id
      ) values (
        p_operation_id,
        'session_cover_rehome',
        v_source_asset_id,
        v_destination_asset_id,
        v_source.id,
        v_destination.id
      )
      on conflict do nothing;
    end if;
  end if;

  if v_participant_unlinks > 0
     or v_entity_detaches > 0
     or v_canon_detaches > 0
     or v_grant_count > 0 then
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
      v_destination.id,
      p_session_id,
      p_actor_profile_id,
      'session.campaign.move.reconcile',
      'sessions',
      p_session_id,
      jsonb_build_object(
        'campaignId', v_source.id,
        'participantEntityLinks', v_participant_unlinks,
        'entityMentions', v_entity_detaches,
        'canonCandidateEntityLinks', v_canon_detaches,
        'sessionGrants', v_grant_count
      ),
      jsonb_build_object(
        'campaignId', v_destination.id,
        'participantEntityPolicy', p_options->>'participantEntityPolicy',
        'entityMentionPolicy', p_options->>'entityMentionPolicy',
        'canonPolicy', p_options->>'canonPolicy',
        'sessionGrantPolicy', p_options->>'sessionGrantPolicy'
      )
    );
  end if;

  update public.sessions s
  set
    campaign_id = v_destination.id,
    current_editorial_draft_id = coalesce(v_bridge_draft_id, s.current_editorial_draft_id),
    current_session_publication_id =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then null
        else s.current_session_publication_id
      end,
    status =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then 'approved'
        else s.status
      end,
    metadata =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
        then (coalesce(s.metadata, '{}'::jsonb) - 'coverImageUrl' - 'heroImageUrl')
        else s.metadata
      end,
    updated_at = clock_timestamp()
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    raise exception 'session campaign authority changed while locked';
  end if;

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
    v_destination.id,
    p_session_id,
    p_actor_profile_id,
    'session.campaign.move.v2',
    'sessions',
    p_session_id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', p_source_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'published', v_session.current_session_publication_id is not null or v_session.status = 'published'
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', p_destination_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'publicationPolicy', p_options->>'publishedPolicy',
      'bridgeDraftId', v_bridge_draft_id,
      'contractVersion', 'tda_session_campaign_move_v2'
    )
  );

  return jsonb_build_object(
    'status', 'moved',
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'operationId', p_operation_id,
    'bridgeDraftId', v_bridge_draft_id,
    'publicationState',
      case
        when v_session.current_session_publication_id is not null or v_session.status = 'published'
          then 'unpublished'
        else 'unchanged'
      end
  );
end;
$tda_move$;

comment on function public.session_campaign_move_contract_v2() is
  'Sanitized server-only capability probe for the v2 populated-session move boundary.';
comment on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) is
  'Server-only v2 preflight. Produces a structured migration plan and requires explicit decisions for public/entity/grant boundaries.';
comment on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) is
  'Server-only v2 commit. Revalidates/locks source, preserves immutable history attribution, migrates current transcript ownership, creates a bridge draft, reconciles explicit decisions and commits the session move atomically.';

revoke all on function public.session_campaign_move_set_origin_campaign() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_registry_drift() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_contract_v2() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_decisions(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_options_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_plan_v2(uuid,uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.session_campaign_move_contract_v2() to service_role;
grant execute on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) to service_role;

commit;

         or coalesce(v_prepared->>'mimeType', '') not in ('image/png', 'image/webp')
         or coalesce(v_prepared->>'status', '') not in ('staged', 'verified_public')
         or coalesce(v_prepared->>'stagedBucket', '') not in ('tda-media-preview', 'tda-media-private')
         or coalesce(v_prepared->>'objectKey', '') = ''
         or coalesce(v_prepared->>'bytes', '') !~ '^[0-9]{1,12}

      select *
      into v_source_media
      from public.media_assets ma
      where ma.id = v_source_asset_id
        and ma.campaign_id = v_source.id
        and ma.role_hint = 'session_cover'
        and ma.status in ('staged', 'verified_public')
        and ma.read_back_verified = true;

      if not found
         or v_source_media.sha256 <> v_prepared->>'sha256'
         or v_source_media.mime_type <> v_prepared->>'mimeType'
         or v_source_media.byte_size <> (v_prepared->>'bytes')::bigint
         or v_source_media.width <> (v_prepared->>'width')::integer
         or v_source_media.height <> (v_prepared->>'height')::integer then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_extension := case when v_source_media.mime_type = 'image/png' then 'png' else 'webp' end;
      v_expected_source_key :=
        'campaigns/' || p_source_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;
      v_expected_destination_key :=
        'campaigns/' || p_destination_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;

      if v_source_media.object_key <> v_expected_source_key
         or v_prepared->>'objectKey' <> v_expected_destination_key then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      select *
      into v_destination_media
      from public.media_assets ma
      where ma.id = v_destination_asset_id;

      if found then
        if v_destination_media.campaign_id <> v_destination.id
           or v_destination_media.role_hint <> 'session_cover'
           or v_destination_media.sha256 <> v_source_media.sha256
           or v_destination_media.mime_type <> v_source_media.mime_type
           or v_destination_media.byte_size <> v_source_media.byte_size
           or v_destination_media.width <> v_source_media.width
           or v_destination_media.height <> v_source_media.height
           or v_destination_media.staged_bucket <> v_prepared->>'stagedBucket'
           or v_destination_media.object_key <> v_expected_destination_key
           or v_destination_media.read_back_verified is not true then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;

        if v_prepared->>'status' = 'verified_public'
           and v_destination_media.status = 'staged' then
          update public.media_assets ma
          set
            status = 'verified_public',
            public_bucket = nullif(v_prepared->>'publicBucket', ''),
            public_object_key = nullif(v_prepared->>'publicObjectKey', ''),
            public_delivery_verified = coalesce(
              (v_prepared->>'publicDeliveryVerified')::boolean,
              false
            ),
            public_verified_at =
              nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'staged'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;
        elsif v_destination_media.status = 'retired' then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      else
        insert into public.media_assets(
          id,
          campaign_id,
          media_kind,
          role_hint,
          status,
          staged_bucket,
          object_key,
          sha256,
          mime_type,
          byte_size,
          width,
          height,
          read_back_verified,
          public_bucket,
          public_object_key,
          public_delivery_verified,
          public_verified_at,
          created_by
        ) values (
          v_destination_asset_id,
          v_destination.id,
          'image',
          'session_cover',
          v_prepared->>'status',
          v_prepared->>'stagedBucket',
          v_prepared->>'objectKey',
          v_prepared->>'sha256',
          v_prepared->>'mimeType',
          (v_prepared->>'bytes')::bigint,
          (v_prepared->>'width')::integer,
          (v_prepared->>'height')::integer,
          true,
          nullif(v_prepared->>'publicBucket', ''),
          nullif(v_prepared->>'publicObjectKey', ''),
          coalesce((v_prepared->>'publicDeliveryVerified')::boolean, false),
          nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
          p_actor_profile_id
        );
      end if;

      if v_prepared->>'status' = 'verified_public' then
        select *
        into v_destination_media
        from public.media_assets ma
        where ma.id = v_destination_asset_id
          and ma.campaign_id = v_destination.id
          and ma.status = 'verified_public'
          and ma.public_bucket = 'tda-media-public'
          and ma.public_object_key = ma.object_key
          and ma.public_delivery_verified = true
          and ma.public_verified_at is not null;

        if not found then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      end if;

      v_bridge_cover := v_destination_asset_id::text;
    elsif v_bridge_cover is not null then
      if p_options->>'legacyCoverPolicy' <> 'clear_current' then
        return jsonb_build_object('status', 'blocked');
      end if;
      v_bridge_cover := null;
    end if;

    select coalesce(max(d.revision), 0) + 1
    into v_bridge_revision
    from public.session_editorial_drafts d
    where d.session_id = p_session_id;

    v_bridge_draft_id := gen_random_uuid();

    insert into public.session_editorial_drafts(
      id,
      campaign_id,
      session_id,
      revision,
      base_transcript_revision_id,
      cover_asset_id,
      arc,
      title,
      summary_short,
      summary_full,
      actor_profile_id,
      created_at,
      session_date,
      session_date_captured
    ) values (
      v_bridge_draft_id,
      v_destination.id,
      p_session_id,
      v_bridge_revision,
      v_current_draft.base_transcript_revision_id,
      v_bridge_cover,
      v_current_draft.arc,
      v_current_draft.title,
      v_current_draft.summary_short,
      v_current_draft.summary_full,
      p_actor_profile_id,
      clock_timestamp(),
      v_current_draft.session_date,
      v_current_draft.session_date_captured
    );
  end if;

  insert into public.session_campaign_move_operations(
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    actor_profile_id,
    contract_version,
    decisions
  ) values (
    p_operation_id,
    p_session_id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_actor_profile_id,
    'tda_session_campaign_move_v2',
    v_decisions
  );

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select
    p_operation_id,
    'transcript_revision',
    tr.id,
    v_source.id,
    v_destination.id
  from public.transcript_revisions tr
  where tr.session_id = p_session_id
    and tr.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_receipt', r.id, v_source.id, v_destination.id
  from public.transcript_publication_receipts r
  where r.session_id = p_session_id
    and r.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_event', e.id, v_source.id, v_destination.id
  from public.transcript_publication_events e
  where e.session_id = p_session_id
    and e.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if to_regclass('public.transcript_assembly_publication_receipts') is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'transcript_assembly_receipt', r.id, v_source.id, v_destination.id
    from public.transcript_assembly_publication_receipts r
    where r.session_id = p_session_id
      and r.campaign_id = v_source.id
    on conflict do nothing;

    update public.transcript_assembly_publication_receipts
    set campaign_id = v_destination.id
    where session_id = p_session_id
      and campaign_id = v_source.id;
  end if;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication', sp.id, v_source.id, v_destination.id
  from public.session_publications sp
  where sp.session_id = p_session_id
    and sp.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication_operation', spo.operation_id, v_source.id, v_destination.id
  from public.session_publication_operations spo
  where spo.session_id = p_session_id
    and spo.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if p_options->>'participantEntityPolicy' = 'unlink' then
    select count(*)
    into v_participant_unlinks
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'participant_entity_unlink',
      p.id,
      p.character_entity_id,
      v_source.id,
      v_destination.id
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null
    on conflict do nothing;

    update public.participants
    set character_entity_id = null
    where session_id = p_session_id
      and character_entity_id is not null;
  end if;

  if p_options->>'entityMentionPolicy' = 'detach_from_session' then
    select count(*)
    into v_entity_detaches
    from public.entity_mentions em
    where em.session_id = p_session_id;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'entity_mention_detach',
      em.id,
      em.entity_id,
      v_source.id,
      v_destination.id
    from public.entity_mentions em
    where em.session_id = p_session_id
    on conflict do nothing;

    update public.entity_mentions
    set session_id = null
    where session_id = p_session_id;
  end if;

  if p_options->>'canonPolicy' = 'detach_entity_links' then
    if exists (
      select 1
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id
    ) then
      return jsonb_build_object('status', 'blocked');
    end if;

    select count(*)
    into v_canon_detaches
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'canon_candidate_entity_detach', cc.id, v_source.id, v_destination.id
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0
    on conflict do nothing;

    update public.canon_candidates
    set related_entity_ids = null
    where session_id = p_session_id
      and coalesce(cardinality(related_entity_ids), 0) > 0;
  end if;

  if p_options->>'sessionGrantPolicy' in ('preserve', 'revoke') then
    select count(*)
    into v_grant_count
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible');

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      case
        when p_options->>'sessionGrantPolicy' = 'revoke'
          then 'session_grant_revoke'
        else 'session_grant_preserve'
      end,
      ra.id,
      v_source.id,
      v_destination.id
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible')
    on conflict do nothing;

    if p_options->>'sessionGrantPolicy' = 'revoke' then
      update public.role_assignments
      set
        status = 'revoked',
        revoked_by = p_actor_profile_id,
        updated_at = clock_timestamp()
      where scope_type = 'session'
        and scope_id = p_session_id::text
        and status in ('active', 'eligible');
    end if;
  end if;

  if v_session.current_session_publication_id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'active_session_publication_unpublish',
      v_session.current_session_publication_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;
  end if;

  if v_current_draft.id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'editorial_draft_bridge',
      v_current_draft.id,
      v_bridge_draft_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;

    if v_source_asset_id is not null and v_destination_asset_id is not null then
      insert into public.session_campaign_move_artifacts(
        operation_id, artifact_kind, artifact_id, related_artifact_id,
        source_campaign_id, destination_campaign_id
      ) values (
        p_operation_id,
        'session_cover_rehome',
        v_source_asset_id,
        v_destination_asset_id,
        v_source.id,
        v_destination.id
      )
      on conflict do nothing;
    end if;
  end if;

  if v_participant_unlinks > 0
     or v_entity_detaches > 0
     or v_canon_detaches > 0
     or v_grant_count > 0 then
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
      v_destination.id,
      p_session_id,
      p_actor_profile_id,
      'session.campaign.move.reconcile',
      'sessions',
      p_session_id,
      jsonb_build_object(
        'campaignId', v_source.id,
        'participantEntityLinks', v_participant_unlinks,
        'entityMentions', v_entity_detaches,
        'canonCandidateEntityLinks', v_canon_detaches,
        'sessionGrants', v_grant_count
      ),
      jsonb_build_object(
        'campaignId', v_destination.id,
        'participantEntityPolicy', p_options->>'participantEntityPolicy',
        'entityMentionPolicy', p_options->>'entityMentionPolicy',
        'canonPolicy', p_options->>'canonPolicy',
        'sessionGrantPolicy', p_options->>'sessionGrantPolicy'
      )
    );
  end if;

  update public.sessions s
  set
    campaign_id = v_destination.id,
    current_editorial_draft_id = coalesce(v_bridge_draft_id, s.current_editorial_draft_id),
    current_session_publication_id =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then null
        else s.current_session_publication_id
      end,
    status =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then 'approved'
        else s.status
      end,
    metadata =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
        then (coalesce(s.metadata, '{}'::jsonb) - 'coverImageUrl' - 'heroImageUrl')
        else s.metadata
      end,
    updated_at = clock_timestamp()
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    raise exception 'session campaign authority changed while locked';
  end if;

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
    v_destination.id,
    p_session_id,
    p_actor_profile_id,
    'session.campaign.move.v2',
    'sessions',
    p_session_id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', p_source_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'published', v_session.current_session_publication_id is not null or v_session.status = 'published'
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', p_destination_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'publicationPolicy', p_options->>'publishedPolicy',
      'bridgeDraftId', v_bridge_draft_id,
      'contractVersion', 'tda_session_campaign_move_v2'
    )
  );

  return jsonb_build_object(
    'status', 'moved',
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'operationId', p_operation_id,
    'bridgeDraftId', v_bridge_draft_id,
    'publicationState',
      case
        when v_session.current_session_publication_id is not null or v_session.status = 'published'
          then 'unpublished'
        else 'unchanged'
      end
  );
end;
$tda_move$;

comment on function public.session_campaign_move_contract_v2() is
  'Sanitized server-only capability probe for the v2 populated-session move boundary.';
comment on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) is
  'Server-only v2 preflight. Produces a structured migration plan and requires explicit decisions for public/entity/grant boundaries.';
comment on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) is
  'Server-only v2 commit. Revalidates/locks source, preserves immutable history attribution, migrates current transcript ownership, creates a bridge draft, reconciles explicit decisions and commits the session move atomically.';

revoke all on function public.session_campaign_move_set_origin_campaign() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_registry_drift() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_contract_v2() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_decisions(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_options_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_plan_v2(uuid,uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.session_campaign_move_contract_v2() to service_role;
grant execute on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) to service_role;

commit;

         or coalesce(v_prepared->>'width', '') !~ '^[0-9]{1,6}

      select *
      into v_source_media
      from public.media_assets ma
      where ma.id = v_source_asset_id
        and ma.campaign_id = v_source.id
        and ma.role_hint = 'session_cover'
        and ma.status in ('staged', 'verified_public')
        and ma.read_back_verified = true;

      if not found
         or v_source_media.sha256 <> v_prepared->>'sha256'
         or v_source_media.mime_type <> v_prepared->>'mimeType'
         or v_source_media.byte_size <> (v_prepared->>'bytes')::bigint
         or v_source_media.width <> (v_prepared->>'width')::integer
         or v_source_media.height <> (v_prepared->>'height')::integer then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_extension := case when v_source_media.mime_type = 'image/png' then 'png' else 'webp' end;
      v_expected_source_key :=
        'campaigns/' || p_source_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;
      v_expected_destination_key :=
        'campaigns/' || p_destination_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;

      if v_source_media.object_key <> v_expected_source_key
         or v_prepared->>'objectKey' <> v_expected_destination_key then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      select *
      into v_destination_media
      from public.media_assets ma
      where ma.id = v_destination_asset_id;

      if found then
        if v_destination_media.campaign_id <> v_destination.id
           or v_destination_media.role_hint <> 'session_cover'
           or v_destination_media.sha256 <> v_source_media.sha256
           or v_destination_media.mime_type <> v_source_media.mime_type
           or v_destination_media.byte_size <> v_source_media.byte_size
           or v_destination_media.width <> v_source_media.width
           or v_destination_media.height <> v_source_media.height
           or v_destination_media.staged_bucket <> v_prepared->>'stagedBucket'
           or v_destination_media.object_key <> v_expected_destination_key
           or v_destination_media.read_back_verified is not true then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;

        if v_prepared->>'status' = 'verified_public'
           and v_destination_media.status = 'staged' then
          update public.media_assets ma
          set
            status = 'verified_public',
            public_bucket = nullif(v_prepared->>'publicBucket', ''),
            public_object_key = nullif(v_prepared->>'publicObjectKey', ''),
            public_delivery_verified = coalesce(
              (v_prepared->>'publicDeliveryVerified')::boolean,
              false
            ),
            public_verified_at =
              nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'staged'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;
        elsif v_destination_media.status = 'retired' then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      else
        insert into public.media_assets(
          id,
          campaign_id,
          media_kind,
          role_hint,
          status,
          staged_bucket,
          object_key,
          sha256,
          mime_type,
          byte_size,
          width,
          height,
          read_back_verified,
          public_bucket,
          public_object_key,
          public_delivery_verified,
          public_verified_at,
          created_by
        ) values (
          v_destination_asset_id,
          v_destination.id,
          'image',
          'session_cover',
          v_prepared->>'status',
          v_prepared->>'stagedBucket',
          v_prepared->>'objectKey',
          v_prepared->>'sha256',
          v_prepared->>'mimeType',
          (v_prepared->>'bytes')::bigint,
          (v_prepared->>'width')::integer,
          (v_prepared->>'height')::integer,
          true,
          nullif(v_prepared->>'publicBucket', ''),
          nullif(v_prepared->>'publicObjectKey', ''),
          coalesce((v_prepared->>'publicDeliveryVerified')::boolean, false),
          nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
          p_actor_profile_id
        );
      end if;

      if v_prepared->>'status' = 'verified_public' then
        select *
        into v_destination_media
        from public.media_assets ma
        where ma.id = v_destination_asset_id
          and ma.campaign_id = v_destination.id
          and ma.status = 'verified_public'
          and ma.public_bucket = 'tda-media-public'
          and ma.public_object_key = ma.object_key
          and ma.public_delivery_verified = true
          and ma.public_verified_at is not null;

        if not found then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      end if;

      v_bridge_cover := v_destination_asset_id::text;
    elsif v_bridge_cover is not null then
      if p_options->>'legacyCoverPolicy' <> 'clear_current' then
        return jsonb_build_object('status', 'blocked');
      end if;
      v_bridge_cover := null;
    end if;

    select coalesce(max(d.revision), 0) + 1
    into v_bridge_revision
    from public.session_editorial_drafts d
    where d.session_id = p_session_id;

    v_bridge_draft_id := gen_random_uuid();

    insert into public.session_editorial_drafts(
      id,
      campaign_id,
      session_id,
      revision,
      base_transcript_revision_id,
      cover_asset_id,
      arc,
      title,
      summary_short,
      summary_full,
      actor_profile_id,
      created_at,
      session_date,
      session_date_captured
    ) values (
      v_bridge_draft_id,
      v_destination.id,
      p_session_id,
      v_bridge_revision,
      v_current_draft.base_transcript_revision_id,
      v_bridge_cover,
      v_current_draft.arc,
      v_current_draft.title,
      v_current_draft.summary_short,
      v_current_draft.summary_full,
      p_actor_profile_id,
      clock_timestamp(),
      v_current_draft.session_date,
      v_current_draft.session_date_captured
    );
  end if;

  insert into public.session_campaign_move_operations(
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    actor_profile_id,
    contract_version,
    decisions
  ) values (
    p_operation_id,
    p_session_id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_actor_profile_id,
    'tda_session_campaign_move_v2',
    v_decisions
  );

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select
    p_operation_id,
    'transcript_revision',
    tr.id,
    v_source.id,
    v_destination.id
  from public.transcript_revisions tr
  where tr.session_id = p_session_id
    and tr.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_receipt', r.id, v_source.id, v_destination.id
  from public.transcript_publication_receipts r
  where r.session_id = p_session_id
    and r.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_event', e.id, v_source.id, v_destination.id
  from public.transcript_publication_events e
  where e.session_id = p_session_id
    and e.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if to_regclass('public.transcript_assembly_publication_receipts') is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'transcript_assembly_receipt', r.id, v_source.id, v_destination.id
    from public.transcript_assembly_publication_receipts r
    where r.session_id = p_session_id
      and r.campaign_id = v_source.id
    on conflict do nothing;

    update public.transcript_assembly_publication_receipts
    set campaign_id = v_destination.id
    where session_id = p_session_id
      and campaign_id = v_source.id;
  end if;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication', sp.id, v_source.id, v_destination.id
  from public.session_publications sp
  where sp.session_id = p_session_id
    and sp.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication_operation', spo.operation_id, v_source.id, v_destination.id
  from public.session_publication_operations spo
  where spo.session_id = p_session_id
    and spo.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if p_options->>'participantEntityPolicy' = 'unlink' then
    select count(*)
    into v_participant_unlinks
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'participant_entity_unlink',
      p.id,
      p.character_entity_id,
      v_source.id,
      v_destination.id
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null
    on conflict do nothing;

    update public.participants
    set character_entity_id = null
    where session_id = p_session_id
      and character_entity_id is not null;
  end if;

  if p_options->>'entityMentionPolicy' = 'detach_from_session' then
    select count(*)
    into v_entity_detaches
    from public.entity_mentions em
    where em.session_id = p_session_id;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'entity_mention_detach',
      em.id,
      em.entity_id,
      v_source.id,
      v_destination.id
    from public.entity_mentions em
    where em.session_id = p_session_id
    on conflict do nothing;

    update public.entity_mentions
    set session_id = null
    where session_id = p_session_id;
  end if;

  if p_options->>'canonPolicy' = 'detach_entity_links' then
    if exists (
      select 1
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id
    ) then
      return jsonb_build_object('status', 'blocked');
    end if;

    select count(*)
    into v_canon_detaches
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'canon_candidate_entity_detach', cc.id, v_source.id, v_destination.id
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0
    on conflict do nothing;

    update public.canon_candidates
    set related_entity_ids = null
    where session_id = p_session_id
      and coalesce(cardinality(related_entity_ids), 0) > 0;
  end if;

  if p_options->>'sessionGrantPolicy' in ('preserve', 'revoke') then
    select count(*)
    into v_grant_count
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible');

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      case
        when p_options->>'sessionGrantPolicy' = 'revoke'
          then 'session_grant_revoke'
        else 'session_grant_preserve'
      end,
      ra.id,
      v_source.id,
      v_destination.id
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible')
    on conflict do nothing;

    if p_options->>'sessionGrantPolicy' = 'revoke' then
      update public.role_assignments
      set
        status = 'revoked',
        revoked_by = p_actor_profile_id,
        updated_at = clock_timestamp()
      where scope_type = 'session'
        and scope_id = p_session_id::text
        and status in ('active', 'eligible');
    end if;
  end if;

  if v_session.current_session_publication_id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'active_session_publication_unpublish',
      v_session.current_session_publication_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;
  end if;

  if v_current_draft.id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'editorial_draft_bridge',
      v_current_draft.id,
      v_bridge_draft_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;

    if v_source_asset_id is not null and v_destination_asset_id is not null then
      insert into public.session_campaign_move_artifacts(
        operation_id, artifact_kind, artifact_id, related_artifact_id,
        source_campaign_id, destination_campaign_id
      ) values (
        p_operation_id,
        'session_cover_rehome',
        v_source_asset_id,
        v_destination_asset_id,
        v_source.id,
        v_destination.id
      )
      on conflict do nothing;
    end if;
  end if;

  if v_participant_unlinks > 0
     or v_entity_detaches > 0
     or v_canon_detaches > 0
     or v_grant_count > 0 then
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
      v_destination.id,
      p_session_id,
      p_actor_profile_id,
      'session.campaign.move.reconcile',
      'sessions',
      p_session_id,
      jsonb_build_object(
        'campaignId', v_source.id,
        'participantEntityLinks', v_participant_unlinks,
        'entityMentions', v_entity_detaches,
        'canonCandidateEntityLinks', v_canon_detaches,
        'sessionGrants', v_grant_count
      ),
      jsonb_build_object(
        'campaignId', v_destination.id,
        'participantEntityPolicy', p_options->>'participantEntityPolicy',
        'entityMentionPolicy', p_options->>'entityMentionPolicy',
        'canonPolicy', p_options->>'canonPolicy',
        'sessionGrantPolicy', p_options->>'sessionGrantPolicy'
      )
    );
  end if;

  update public.sessions s
  set
    campaign_id = v_destination.id,
    current_editorial_draft_id = coalesce(v_bridge_draft_id, s.current_editorial_draft_id),
    current_session_publication_id =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then null
        else s.current_session_publication_id
      end,
    status =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then 'approved'
        else s.status
      end,
    metadata =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
        then (coalesce(s.metadata, '{}'::jsonb) - 'coverImageUrl' - 'heroImageUrl')
        else s.metadata
      end,
    updated_at = clock_timestamp()
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    raise exception 'session campaign authority changed while locked';
  end if;

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
    v_destination.id,
    p_session_id,
    p_actor_profile_id,
    'session.campaign.move.v2',
    'sessions',
    p_session_id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', p_source_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'published', v_session.current_session_publication_id is not null or v_session.status = 'published'
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', p_destination_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'publicationPolicy', p_options->>'publishedPolicy',
      'bridgeDraftId', v_bridge_draft_id,
      'contractVersion', 'tda_session_campaign_move_v2'
    )
  );

  return jsonb_build_object(
    'status', 'moved',
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'operationId', p_operation_id,
    'bridgeDraftId', v_bridge_draft_id,
    'publicationState',
      case
        when v_session.current_session_publication_id is not null or v_session.status = 'published'
          then 'unpublished'
        else 'unchanged'
      end
  );
end;
$tda_move$;

comment on function public.session_campaign_move_contract_v2() is
  'Sanitized server-only capability probe for the v2 populated-session move boundary.';
comment on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) is
  'Server-only v2 preflight. Produces a structured migration plan and requires explicit decisions for public/entity/grant boundaries.';
comment on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) is
  'Server-only v2 commit. Revalidates/locks source, preserves immutable history attribution, migrates current transcript ownership, creates a bridge draft, reconciles explicit decisions and commits the session move atomically.';

revoke all on function public.session_campaign_move_set_origin_campaign() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_registry_drift() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_contract_v2() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_decisions(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_options_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_plan_v2(uuid,uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.session_campaign_move_contract_v2() to service_role;
grant execute on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) to service_role;

commit;

         or coalesce(v_prepared->>'height', '') !~ '^[0-9]{1,6}

      select *
      into v_source_media
      from public.media_assets ma
      where ma.id = v_source_asset_id
        and ma.campaign_id = v_source.id
        and ma.role_hint = 'session_cover'
        and ma.status in ('staged', 'verified_public')
        and ma.read_back_verified = true;

      if not found
         or v_source_media.sha256 <> v_prepared->>'sha256'
         or v_source_media.mime_type <> v_prepared->>'mimeType'
         or v_source_media.byte_size <> (v_prepared->>'bytes')::bigint
         or v_source_media.width <> (v_prepared->>'width')::integer
         or v_source_media.height <> (v_prepared->>'height')::integer then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_extension := case when v_source_media.mime_type = 'image/png' then 'png' else 'webp' end;
      v_expected_source_key :=
        'campaigns/' || p_source_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;
      v_expected_destination_key :=
        'campaigns/' || p_destination_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;

      if v_source_media.object_key <> v_expected_source_key
         or v_prepared->>'objectKey' <> v_expected_destination_key then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      select *
      into v_destination_media
      from public.media_assets ma
      where ma.id = v_destination_asset_id;

      if found then
        if v_destination_media.campaign_id <> v_destination.id
           or v_destination_media.role_hint <> 'session_cover'
           or v_destination_media.sha256 <> v_source_media.sha256
           or v_destination_media.mime_type <> v_source_media.mime_type
           or v_destination_media.byte_size <> v_source_media.byte_size
           or v_destination_media.width <> v_source_media.width
           or v_destination_media.height <> v_source_media.height
           or v_destination_media.staged_bucket <> v_prepared->>'stagedBucket'
           or v_destination_media.object_key <> v_expected_destination_key
           or v_destination_media.read_back_verified is not true then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;

        if v_prepared->>'status' = 'verified_public'
           and v_destination_media.status = 'staged' then
          update public.media_assets ma
          set
            status = 'verified_public',
            public_bucket = nullif(v_prepared->>'publicBucket', ''),
            public_object_key = nullif(v_prepared->>'publicObjectKey', ''),
            public_delivery_verified = coalesce(
              (v_prepared->>'publicDeliveryVerified')::boolean,
              false
            ),
            public_verified_at =
              nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'staged'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;
        elsif v_destination_media.status = 'retired' then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      else
        insert into public.media_assets(
          id,
          campaign_id,
          media_kind,
          role_hint,
          status,
          staged_bucket,
          object_key,
          sha256,
          mime_type,
          byte_size,
          width,
          height,
          read_back_verified,
          public_bucket,
          public_object_key,
          public_delivery_verified,
          public_verified_at,
          created_by
        ) values (
          v_destination_asset_id,
          v_destination.id,
          'image',
          'session_cover',
          v_prepared->>'status',
          v_prepared->>'stagedBucket',
          v_prepared->>'objectKey',
          v_prepared->>'sha256',
          v_prepared->>'mimeType',
          (v_prepared->>'bytes')::bigint,
          (v_prepared->>'width')::integer,
          (v_prepared->>'height')::integer,
          true,
          nullif(v_prepared->>'publicBucket', ''),
          nullif(v_prepared->>'publicObjectKey', ''),
          coalesce((v_prepared->>'publicDeliveryVerified')::boolean, false),
          nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
          p_actor_profile_id
        );
      end if;

      if v_prepared->>'status' = 'verified_public' then
        select *
        into v_destination_media
        from public.media_assets ma
        where ma.id = v_destination_asset_id
          and ma.campaign_id = v_destination.id
          and ma.status = 'verified_public'
          and ma.public_bucket = 'tda-media-public'
          and ma.public_object_key = ma.object_key
          and ma.public_delivery_verified = true
          and ma.public_verified_at is not null;

        if not found then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      end if;

      v_bridge_cover := v_destination_asset_id::text;
    elsif v_bridge_cover is not null then
      if p_options->>'legacyCoverPolicy' <> 'clear_current' then
        return jsonb_build_object('status', 'blocked');
      end if;
      v_bridge_cover := null;
    end if;

    select coalesce(max(d.revision), 0) + 1
    into v_bridge_revision
    from public.session_editorial_drafts d
    where d.session_id = p_session_id;

    v_bridge_draft_id := gen_random_uuid();

    insert into public.session_editorial_drafts(
      id,
      campaign_id,
      session_id,
      revision,
      base_transcript_revision_id,
      cover_asset_id,
      arc,
      title,
      summary_short,
      summary_full,
      actor_profile_id,
      created_at,
      session_date,
      session_date_captured
    ) values (
      v_bridge_draft_id,
      v_destination.id,
      p_session_id,
      v_bridge_revision,
      v_current_draft.base_transcript_revision_id,
      v_bridge_cover,
      v_current_draft.arc,
      v_current_draft.title,
      v_current_draft.summary_short,
      v_current_draft.summary_full,
      p_actor_profile_id,
      clock_timestamp(),
      v_current_draft.session_date,
      v_current_draft.session_date_captured
    );
  end if;

  insert into public.session_campaign_move_operations(
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    actor_profile_id,
    contract_version,
    decisions
  ) values (
    p_operation_id,
    p_session_id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_actor_profile_id,
    'tda_session_campaign_move_v2',
    v_decisions
  );

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select
    p_operation_id,
    'transcript_revision',
    tr.id,
    v_source.id,
    v_destination.id
  from public.transcript_revisions tr
  where tr.session_id = p_session_id
    and tr.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_receipt', r.id, v_source.id, v_destination.id
  from public.transcript_publication_receipts r
  where r.session_id = p_session_id
    and r.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_event', e.id, v_source.id, v_destination.id
  from public.transcript_publication_events e
  where e.session_id = p_session_id
    and e.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if to_regclass('public.transcript_assembly_publication_receipts') is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'transcript_assembly_receipt', r.id, v_source.id, v_destination.id
    from public.transcript_assembly_publication_receipts r
    where r.session_id = p_session_id
      and r.campaign_id = v_source.id
    on conflict do nothing;

    update public.transcript_assembly_publication_receipts
    set campaign_id = v_destination.id
    where session_id = p_session_id
      and campaign_id = v_source.id;
  end if;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication', sp.id, v_source.id, v_destination.id
  from public.session_publications sp
  where sp.session_id = p_session_id
    and sp.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication_operation', spo.operation_id, v_source.id, v_destination.id
  from public.session_publication_operations spo
  where spo.session_id = p_session_id
    and spo.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if p_options->>'participantEntityPolicy' = 'unlink' then
    select count(*)
    into v_participant_unlinks
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'participant_entity_unlink',
      p.id,
      p.character_entity_id,
      v_source.id,
      v_destination.id
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null
    on conflict do nothing;

    update public.participants
    set character_entity_id = null
    where session_id = p_session_id
      and character_entity_id is not null;
  end if;

  if p_options->>'entityMentionPolicy' = 'detach_from_session' then
    select count(*)
    into v_entity_detaches
    from public.entity_mentions em
    where em.session_id = p_session_id;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'entity_mention_detach',
      em.id,
      em.entity_id,
      v_source.id,
      v_destination.id
    from public.entity_mentions em
    where em.session_id = p_session_id
    on conflict do nothing;

    update public.entity_mentions
    set session_id = null
    where session_id = p_session_id;
  end if;

  if p_options->>'canonPolicy' = 'detach_entity_links' then
    if exists (
      select 1
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id
    ) then
      return jsonb_build_object('status', 'blocked');
    end if;

    select count(*)
    into v_canon_detaches
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'canon_candidate_entity_detach', cc.id, v_source.id, v_destination.id
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0
    on conflict do nothing;

    update public.canon_candidates
    set related_entity_ids = null
    where session_id = p_session_id
      and coalesce(cardinality(related_entity_ids), 0) > 0;
  end if;

  if p_options->>'sessionGrantPolicy' in ('preserve', 'revoke') then
    select count(*)
    into v_grant_count
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible');

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      case
        when p_options->>'sessionGrantPolicy' = 'revoke'
          then 'session_grant_revoke'
        else 'session_grant_preserve'
      end,
      ra.id,
      v_source.id,
      v_destination.id
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible')
    on conflict do nothing;

    if p_options->>'sessionGrantPolicy' = 'revoke' then
      update public.role_assignments
      set
        status = 'revoked',
        revoked_by = p_actor_profile_id,
        updated_at = clock_timestamp()
      where scope_type = 'session'
        and scope_id = p_session_id::text
        and status in ('active', 'eligible');
    end if;
  end if;

  if v_session.current_session_publication_id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'active_session_publication_unpublish',
      v_session.current_session_publication_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;
  end if;

  if v_current_draft.id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'editorial_draft_bridge',
      v_current_draft.id,
      v_bridge_draft_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;

    if v_source_asset_id is not null and v_destination_asset_id is not null then
      insert into public.session_campaign_move_artifacts(
        operation_id, artifact_kind, artifact_id, related_artifact_id,
        source_campaign_id, destination_campaign_id
      ) values (
        p_operation_id,
        'session_cover_rehome',
        v_source_asset_id,
        v_destination_asset_id,
        v_source.id,
        v_destination.id
      )
      on conflict do nothing;
    end if;
  end if;

  if v_participant_unlinks > 0
     or v_entity_detaches > 0
     or v_canon_detaches > 0
     or v_grant_count > 0 then
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
      v_destination.id,
      p_session_id,
      p_actor_profile_id,
      'session.campaign.move.reconcile',
      'sessions',
      p_session_id,
      jsonb_build_object(
        'campaignId', v_source.id,
        'participantEntityLinks', v_participant_unlinks,
        'entityMentions', v_entity_detaches,
        'canonCandidateEntityLinks', v_canon_detaches,
        'sessionGrants', v_grant_count
      ),
      jsonb_build_object(
        'campaignId', v_destination.id,
        'participantEntityPolicy', p_options->>'participantEntityPolicy',
        'entityMentionPolicy', p_options->>'entityMentionPolicy',
        'canonPolicy', p_options->>'canonPolicy',
        'sessionGrantPolicy', p_options->>'sessionGrantPolicy'
      )
    );
  end if;

  update public.sessions s
  set
    campaign_id = v_destination.id,
    current_editorial_draft_id = coalesce(v_bridge_draft_id, s.current_editorial_draft_id),
    current_session_publication_id =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then null
        else s.current_session_publication_id
      end,
    status =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then 'approved'
        else s.status
      end,
    metadata =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
        then (coalesce(s.metadata, '{}'::jsonb) - 'coverImageUrl' - 'heroImageUrl')
        else s.metadata
      end,
    updated_at = clock_timestamp()
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    raise exception 'session campaign authority changed while locked';
  end if;

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
    v_destination.id,
    p_session_id,
    p_actor_profile_id,
    'session.campaign.move.v2',
    'sessions',
    p_session_id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', p_source_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'published', v_session.current_session_publication_id is not null or v_session.status = 'published'
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', p_destination_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'publicationPolicy', p_options->>'publishedPolicy',
      'bridgeDraftId', v_bridge_draft_id,
      'contractVersion', 'tda_session_campaign_move_v2'
    )
  );

  return jsonb_build_object(
    'status', 'moved',
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'operationId', p_operation_id,
    'bridgeDraftId', v_bridge_draft_id,
    'publicationState',
      case
        when v_session.current_session_publication_id is not null or v_session.status = 'published'
          then 'unpublished'
        else 'unchanged'
      end
  );
end;
$tda_move$;

comment on function public.session_campaign_move_contract_v2() is
  'Sanitized server-only capability probe for the v2 populated-session move boundary.';
comment on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) is
  'Server-only v2 preflight. Produces a structured migration plan and requires explicit decisions for public/entity/grant boundaries.';
comment on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) is
  'Server-only v2 commit. Revalidates/locks source, preserves immutable history attribution, migrates current transcript ownership, creates a bridge draft, reconciles explicit decisions and commits the session move atomically.';

revoke all on function public.session_campaign_move_set_origin_campaign() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_registry_drift() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_contract_v2() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_decisions(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_options_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_plan_v2(uuid,uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.session_campaign_move_contract_v2() to service_role;
grant execute on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) to service_role;

commit;
 then
        return jsonb_build_object('status', 'media_prepare_required');
      end if;

      -- A private destination must never gain a newly public session-cover
      -- object as a side effect of moving an already-public source session.
      if v_destination.visibility <> 'public'
         and v_prepared->>'status' = 'verified_public' then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_destination_asset_id := (v_prepared->>'destinationAssetId')::uuid;

      select *
      into v_source_media
      from public.media_assets ma
      where ma.id = v_source_asset_id
        and ma.campaign_id = v_source.id
        and ma.role_hint = 'session_cover'
        and ma.status in ('staged', 'verified_public')
        and ma.read_back_verified = true;

      if not found
         or v_source_media.sha256 <> v_prepared->>'sha256'
         or v_source_media.mime_type <> v_prepared->>'mimeType'
         or v_source_media.byte_size <> (v_prepared->>'bytes')::bigint
         or v_source_media.width <> (v_prepared->>'width')::integer
         or v_source_media.height <> (v_prepared->>'height')::integer then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_extension := case when v_source_media.mime_type = 'image/png' then 'png' else 'webp' end;
      v_expected_source_key :=
        'campaigns/' || p_source_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;
      v_expected_destination_key :=
        'campaigns/' || p_destination_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;

      if v_source_media.object_key <> v_expected_source_key
         or v_prepared->>'objectKey' <> v_expected_destination_key then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      select *
      into v_destination_media
      from public.media_assets ma
      where ma.id = v_destination_asset_id;

      if found then
        if v_destination_media.campaign_id <> v_destination.id
           or v_destination_media.role_hint <> 'session_cover'
           or v_destination_media.sha256 <> v_source_media.sha256
           or v_destination_media.mime_type <> v_source_media.mime_type
           or v_destination_media.byte_size <> v_source_media.byte_size
           or v_destination_media.width <> v_source_media.width
           or v_destination_media.height <> v_source_media.height
           or v_destination_media.staged_bucket <> v_prepared->>'stagedBucket'
           or v_destination_media.object_key <> v_expected_destination_key
           or v_destination_media.read_back_verified is not true then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;

        if v_prepared->>'status' = 'verified_public'
           and v_destination_media.status = 'staged' then
          update public.media_assets ma
          set
            status = 'verified_public',
            public_bucket = nullif(v_prepared->>'publicBucket', ''),
            public_object_key = nullif(v_prepared->>'publicObjectKey', ''),
            public_delivery_verified = coalesce(
              (v_prepared->>'publicDeliveryVerified')::boolean,
              false
            ),
            public_verified_at =
              nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'staged'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;
        elsif v_destination_media.status = 'retired' then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      else
        insert into public.media_assets(
          id,
          campaign_id,
          media_kind,
          role_hint,
          status,
          staged_bucket,
          object_key,
          sha256,
          mime_type,
          byte_size,
          width,
          height,
          read_back_verified,
          public_bucket,
          public_object_key,
          public_delivery_verified,
          public_verified_at,
          created_by
        ) values (
          v_destination_asset_id,
          v_destination.id,
          'image',
          'session_cover',
          v_prepared->>'status',
          v_prepared->>'stagedBucket',
          v_prepared->>'objectKey',
          v_prepared->>'sha256',
          v_prepared->>'mimeType',
          (v_prepared->>'bytes')::bigint,
          (v_prepared->>'width')::integer,
          (v_prepared->>'height')::integer,
          true,
          nullif(v_prepared->>'publicBucket', ''),
          nullif(v_prepared->>'publicObjectKey', ''),
          coalesce((v_prepared->>'publicDeliveryVerified')::boolean, false),
          nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
          p_actor_profile_id
        );
      end if;

      if v_prepared->>'status' = 'verified_public' then
        select *
        into v_destination_media
        from public.media_assets ma
        where ma.id = v_destination_asset_id
          and ma.campaign_id = v_destination.id
          and ma.status = 'verified_public'
          and ma.public_bucket = 'tda-media-public'
          and ma.public_object_key = ma.object_key
          and ma.public_delivery_verified = true
          and ma.public_verified_at is not null;

        if not found then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      end if;

      v_bridge_cover := v_destination_asset_id::text;
    elsif v_bridge_cover is not null then
      if p_options->>'legacyCoverPolicy' <> 'clear_current' then
        return jsonb_build_object('status', 'blocked');
      end if;
      v_bridge_cover := null;
    end if;

    select coalesce(max(d.revision), 0) + 1
    into v_bridge_revision
    from public.session_editorial_drafts d
    where d.session_id = p_session_id;

    v_bridge_draft_id := gen_random_uuid();

    insert into public.session_editorial_drafts(
      id,
      campaign_id,
      session_id,
      revision,
      base_transcript_revision_id,
      cover_asset_id,
      arc,
      title,
      summary_short,
      summary_full,
      actor_profile_id,
      created_at,
      session_date,
      session_date_captured
    ) values (
      v_bridge_draft_id,
      v_destination.id,
      p_session_id,
      v_bridge_revision,
      v_current_draft.base_transcript_revision_id,
      v_bridge_cover,
      v_current_draft.arc,
      v_current_draft.title,
      v_current_draft.summary_short,
      v_current_draft.summary_full,
      p_actor_profile_id,
      clock_timestamp(),
      v_current_draft.session_date,
      v_current_draft.session_date_captured
    );
  end if;

  insert into public.session_campaign_move_operations(
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    actor_profile_id,
    contract_version,
    decisions
  ) values (
    p_operation_id,
    p_session_id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_actor_profile_id,
    'tda_session_campaign_move_v2',
    v_decisions
  );

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select
    p_operation_id,
    'transcript_revision',
    tr.id,
    v_source.id,
    v_destination.id
  from public.transcript_revisions tr
  where tr.session_id = p_session_id
    and tr.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_receipt', r.id, v_source.id, v_destination.id
  from public.transcript_publication_receipts r
  where r.session_id = p_session_id
    and r.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_event', e.id, v_source.id, v_destination.id
  from public.transcript_publication_events e
  where e.session_id = p_session_id
    and e.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if to_regclass('public.transcript_assembly_publication_receipts') is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'transcript_assembly_receipt', r.id, v_source.id, v_destination.id
    from public.transcript_assembly_publication_receipts r
    where r.session_id = p_session_id
      and r.campaign_id = v_source.id
    on conflict do nothing;

    update public.transcript_assembly_publication_receipts
    set campaign_id = v_destination.id
    where session_id = p_session_id
      and campaign_id = v_source.id;
  end if;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication', sp.id, v_source.id, v_destination.id
  from public.session_publications sp
  where sp.session_id = p_session_id
    and sp.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication_operation', spo.operation_id, v_source.id, v_destination.id
  from public.session_publication_operations spo
  where spo.session_id = p_session_id
    and spo.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if p_options->>'participantEntityPolicy' = 'unlink' then
    select count(*)
    into v_participant_unlinks
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'participant_entity_unlink',
      p.id,
      p.character_entity_id,
      v_source.id,
      v_destination.id
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null
    on conflict do nothing;

    update public.participants
    set character_entity_id = null
    where session_id = p_session_id
      and character_entity_id is not null;
  end if;

  if p_options->>'entityMentionPolicy' = 'detach_from_session' then
    select count(*)
    into v_entity_detaches
    from public.entity_mentions em
    where em.session_id = p_session_id;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'entity_mention_detach',
      em.id,
      em.entity_id,
      v_source.id,
      v_destination.id
    from public.entity_mentions em
    where em.session_id = p_session_id
    on conflict do nothing;

    update public.entity_mentions
    set session_id = null
    where session_id = p_session_id;
  end if;

  if p_options->>'canonPolicy' = 'detach_entity_links' then
    if exists (
      select 1
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id
    ) then
      return jsonb_build_object('status', 'blocked');
    end if;

    select count(*)
    into v_canon_detaches
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'canon_candidate_entity_detach', cc.id, v_source.id, v_destination.id
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0
    on conflict do nothing;

    update public.canon_candidates
    set related_entity_ids = null
    where session_id = p_session_id
      and coalesce(cardinality(related_entity_ids), 0) > 0;
  end if;

  if p_options->>'sessionGrantPolicy' in ('preserve', 'revoke') then
    select count(*)
    into v_grant_count
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible');

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      case
        when p_options->>'sessionGrantPolicy' = 'revoke'
          then 'session_grant_revoke'
        else 'session_grant_preserve'
      end,
      ra.id,
      v_source.id,
      v_destination.id
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible')
    on conflict do nothing;

    if p_options->>'sessionGrantPolicy' = 'revoke' then
      update public.role_assignments
      set
        status = 'revoked',
        revoked_by = p_actor_profile_id,
        updated_at = clock_timestamp()
      where scope_type = 'session'
        and scope_id = p_session_id::text
        and status in ('active', 'eligible');
    end if;
  end if;

  if v_session.current_session_publication_id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'active_session_publication_unpublish',
      v_session.current_session_publication_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;
  end if;

  if v_current_draft.id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'editorial_draft_bridge',
      v_current_draft.id,
      v_bridge_draft_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;

    if v_source_asset_id is not null and v_destination_asset_id is not null then
      insert into public.session_campaign_move_artifacts(
        operation_id, artifact_kind, artifact_id, related_artifact_id,
        source_campaign_id, destination_campaign_id
      ) values (
        p_operation_id,
        'session_cover_rehome',
        v_source_asset_id,
        v_destination_asset_id,
        v_source.id,
        v_destination.id
      )
      on conflict do nothing;
    end if;
  end if;

  if v_participant_unlinks > 0
     or v_entity_detaches > 0
     or v_canon_detaches > 0
     or v_grant_count > 0 then
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
      v_destination.id,
      p_session_id,
      p_actor_profile_id,
      'session.campaign.move.reconcile',
      'sessions',
      p_session_id,
      jsonb_build_object(
        'campaignId', v_source.id,
        'participantEntityLinks', v_participant_unlinks,
        'entityMentions', v_entity_detaches,
        'canonCandidateEntityLinks', v_canon_detaches,
        'sessionGrants', v_grant_count
      ),
      jsonb_build_object(
        'campaignId', v_destination.id,
        'participantEntityPolicy', p_options->>'participantEntityPolicy',
        'entityMentionPolicy', p_options->>'entityMentionPolicy',
        'canonPolicy', p_options->>'canonPolicy',
        'sessionGrantPolicy', p_options->>'sessionGrantPolicy'
      )
    );
  end if;

  update public.sessions s
  set
    campaign_id = v_destination.id,
    current_editorial_draft_id = coalesce(v_bridge_draft_id, s.current_editorial_draft_id),
    current_session_publication_id =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then null
        else s.current_session_publication_id
      end,
    status =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then 'approved'
        else s.status
      end,
    metadata =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
        then (coalesce(s.metadata, '{}'::jsonb) - 'coverImageUrl' - 'heroImageUrl')
        else s.metadata
      end,
    updated_at = clock_timestamp()
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    raise exception 'session campaign authority changed while locked';
  end if;

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
    v_destination.id,
    p_session_id,
    p_actor_profile_id,
    'session.campaign.move.v2',
    'sessions',
    p_session_id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', p_source_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'published', v_session.current_session_publication_id is not null or v_session.status = 'published'
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', p_destination_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'publicationPolicy', p_options->>'publishedPolicy',
      'bridgeDraftId', v_bridge_draft_id,
      'contractVersion', 'tda_session_campaign_move_v2'
    )
  );

  return jsonb_build_object(
    'status', 'moved',
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'operationId', p_operation_id,
    'bridgeDraftId', v_bridge_draft_id,
    'publicationState',
      case
        when v_session.current_session_publication_id is not null or v_session.status = 'published'
          then 'unpublished'
        else 'unchanged'
      end
  );
end;
$tda_move$;

comment on function public.session_campaign_move_contract_v2() is
  'Sanitized server-only capability probe for the v2 populated-session move boundary.';
comment on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) is
  'Server-only v2 preflight. Produces a structured migration plan and requires explicit decisions for public/entity/grant boundaries.';
comment on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) is
  'Server-only v2 commit. Revalidates/locks source, preserves immutable history attribution, migrates current transcript ownership, creates a bridge draft, reconciles explicit decisions and commits the session move atomically.';

revoke all on function public.session_campaign_move_set_origin_campaign() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_registry_drift() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_contract_v2() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_decisions(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_options_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_plan_v2(uuid,uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.session_campaign_move_contract_v2() to service_role;
grant execute on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) to service_role;

commit;
),
  mime_type text not null check (mime_type in ('image/png', 'image/webp')),
  byte_size bigint not null check (byte_size between 24 and 8388608),
  width integer not null check (width between 1 and 16384),
  height integer not null check (height between 1 and 16384),
  status text not null check (status in ('staged', 'verified_public')),
  staged_bucket text not null check (staged_bucket in ('tda-media-preview', 'tda-media-private')),
  public_bucket text null check (public_bucket is null or public_bucket = 'tda-media-public'),
  public_object_key text null,
  public_delivery_verified boolean not null default false,
  public_verified_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (operation_id, source_asset_id),
  check (source_campaign_id <> destination_campaign_id),
  check (
    (status = 'verified_public'
      and public_bucket = 'tda-media-public'
      and public_object_key = destination_object_key
      and public_delivery_verified = true
      and public_verified_at is not null)
    or
    (status = 'staged'
      and public_bucket is null
      and public_object_key is null
      and public_delivery_verified = false
      and public_verified_at is null)
  )
);

alter table public.session_campaign_move_media_preparations enable row level security;
revoke all on table public.session_campaign_move_media_preparations
  from public, anon, authenticated, service_role;
grant select, insert on table public.session_campaign_move_media_preparations
  to service_role;

comment on table public.session_campaign_move_media_preparations is
  'Durable sanitized receipts for external session-cover preparation. Bytes remain in governed object storage; this table records only verified identities and hashes.';

create table if not exists public.session_campaign_move_dependency_policies (
  relation_name text primary key,
  session_column text not null default 'session_id',
  family text not null check (char_length(family) between 1 and 80),
  policy text not null check (
    policy in (
      'follows_session',
      'rewrite_current_ownership',
      'preserve_historical_attribution',
      'manual_reconcile',
      'hard_block'
    )
  ),
  required boolean not null default true,
  label text not null check (char_length(label) between 1 and 160),
  notes text null check (notes is null or char_length(notes) <= 1000)
);

alter table public.session_campaign_move_dependency_policies enable row level security;
revoke all on table public.session_campaign_move_dependency_policies
  from public, anon, authenticated, service_role;

insert into public.session_campaign_move_dependency_policies(
  relation_name, session_column, family, policy, required, label, notes
) values
  ('public.session_publication_operations','session_id','session_publication_history','preserve_historical_attribution',true,'Receipts de publicação editorial','O histórico viaja logicamente com a sessão, preservando origin_campaign_id.'),
  ('public.session_editorial_drafts','session_id','editorial_drafts','preserve_historical_attribution',true,'Histórico de drafts editoriais','Drafts existentes permanecem imutáveis; o current recebe um bridge draft no destino.'),
  ('public.transcript_assembly_publication_receipts','session_id','transcript_receipts','rewrite_current_ownership',true,'Receipts de assembly de transcrição','Ownership atual acompanha a sessão; origem permanece em origin_campaign_id.'),
  ('public.session_campaign_move_operations','session_id','move_history','preserve_historical_attribution',true,'Histórico de mudanças de campanha','Receipts anteriores nunca são reescritos.'),
  ('public.transcript_session_statistics','session_id','transcript_statistics','follows_session',true,'Estatísticas da transcrição','A identidade é a própria sessão.'),
  ('public.transcript_publication_events','session_id','transcript_events','rewrite_current_ownership',true,'Eventos de publicação da transcrição','Ownership atual acompanha a sessão; origem permanece em origin_campaign_id.'),
  ('public.transcript_publication_receipts','session_id','transcript_receipts','rewrite_current_ownership',true,'Receipts de publicação da transcrição','Ownership atual acompanha a sessão; origem permanece em origin_campaign_id.'),
  ('public.transcript_revisions','session_id','transcript_revisions','rewrite_current_ownership',true,'Revisões da transcrição','Payload imutável permanece idêntico; somente ownership muda, com origem preservada.'),
  ('public.craig_track_extraction_steps','session_id','processing_provenance','follows_session',true,'Provenance de extração Craig','A identidade é a própria sessão.'),
  ('public.craig_manifests','session_id','processing_provenance','follows_session',true,'Manifestos Craig','A identidade é a própria sessão.'),
  ('public.session_publications','session_id','session_publication_history','rewrite_current_ownership',true,'Histórico de publicações da sessão','Snapshots permanecem imutáveis e origin_campaign_id preserva onde foram emitidos.'),
  ('public.table_notes','session_id','table_notes','rewrite_current_ownership',true,'Notas da mesa','Ownership atual acompanha a sessão.'),
  ('public.discord_interactions','session_id','discord_interactions','rewrite_current_ownership',true,'Interações Discord','Ownership atual acompanha a sessão.'),
  ('public.audio_speech_slices','session_id','audio_provenance','follows_session',true,'Slices de fala','A identidade é a própria sessão.'),
  ('public.ai_usage_ledger','session_id','usage_ledger','preserve_historical_attribution',true,'Ledger de uso de IA','Billing/auditoria permanecem atribuídos ao contexto histórico.'),
  ('public.audit_log','session_id','audit_history','preserve_historical_attribution',true,'Auditoria histórica','Eventos antigos nunca são reclassificados como originados no destino.'),
  ('public.publications','session_id','legacy_publications','hard_block',true,'Publicações legadas','Publicações do modelo legado exigem migração manual antes do move.'),
  ('public.review_decisions','session_id','review_decisions','follows_session',true,'Decisões de revisão','A identidade é a própria sessão.'),
  ('public.outtake_candidates','session_id','outtake_candidates','follows_session',true,'Candidatos de outtake','A identidade é a própria sessão.'),
  ('public.quote_candidates','session_id','quote_candidates','follows_session',true,'Candidatos de citação','A identidade é a própria sessão.'),
  ('public.canon_candidates','session_id','canon_candidates','manual_reconcile',true,'Candidatos de cânone','Entity links precisam de decisão explícita.'),
  ('public.entity_mentions','session_id','entity_mentions','manual_reconcile',true,'Menções de entidades','Entity references da origem não atravessam campanha silenciosamente.'),
  ('public.session_markers','session_id','session_markers','follows_session',true,'Marcadores da sessão','A identidade é a própria sessão.'),
  ('public.roll20_events','session_id','roll20_events','follows_session',true,'Eventos Roll20','A identidade é a própria sessão.'),
  ('public.transcript_segments','session_id','legacy_transcript_segments','follows_session',true,'Segmentos de transcrição legados','A identidade é a própria sessão.'),
  ('public.audio_chunks','session_id','audio_chunks','follows_session',true,'Chunks de áudio','A identidade é a própria sessão.'),
  ('public.processing_jobs','session_id','processing_jobs','follows_session',true,'Jobs de processamento','A identidade é a própria sessão.'),
  ('public.recording_files','session_id','recording_files','follows_session',true,'Arquivos de gravação','A identidade é a própria sessão.'),
  ('public.participants','session_id','participants','follows_session',true,'Participantes','Participantes acompanham a sessão; character_entity_id é reconciliado separadamente.'),
  ('public.audio_artifacts','session_id','audio_artifacts','follows_session',true,'Artefatos de áudio','A identidade é a própria sessão.')
on conflict (relation_name) do update set
  session_column = excluded.session_column,
  family = excluded.family,
  policy = excluded.policy,
  required = excluded.required,
  label = excluded.label,
  notes = excluded.notes;

create or replace function public.session_campaign_move_set_origin_campaign()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $tda_move$
begin
  -- Origin attribution is database-owned. Callers cannot forge a different
  -- origin at insert time; later campaign moves update campaign_id only.
  new.origin_campaign_id := new.campaign_id;
  return new;
end;
$tda_move$;

do $tda_move$
declare
  v_table text;
  v_constraint text;
  v_trigger text;
begin
  foreach v_table in array array[
    'transcript_revisions',
    'transcript_publication_receipts',
    'transcript_publication_events',
    'transcript_assembly_publication_receipts',
    'session_editorial_drafts',
    'session_publications',
    'session_publication_operations'
  ]
  loop
    if to_regclass('public.' || v_table) is null then
      continue;
    end if;

    execute format(
      'alter table public.%I add column if not exists origin_campaign_id uuid',
      v_table
    );
    execute format(
      'update public.%I set origin_campaign_id = campaign_id where origin_campaign_id is null',
      v_table
    );
    execute format(
      'alter table public.%I alter column origin_campaign_id set not null',
      v_table
    );

    v_constraint := v_table || '_origin_campaign_id_fkey';
    if not exists (
      select 1
      from pg_constraint
      where conrelid = to_regclass('public.' || v_table)
        and conname = v_constraint
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (origin_campaign_id) references public.campaigns(id) on delete restrict',
        v_table,
        v_constraint
      );
    end if;

    v_trigger := v_table || '_set_origin_campaign';
    if not exists (
      select 1
      from pg_trigger
      where tgrelid = to_regclass('public.' || v_table)
        and tgname = v_trigger
        and not tgisinternal
    ) then
      execute format(
        'create trigger %I before insert on public.%I for each row execute function public.session_campaign_move_set_origin_campaign()',
        v_trigger,
        v_table
      );
    end if;
  end loop;
end;
$tda_move$;

create or replace function public.session_campaign_move_registry_drift()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $tda_move$
with direct_fks as (
  select distinct
    format('%I.%I', child_ns.nspname, child.relname) as relation_name,
    child_col.attname as session_column,
    con.conname as constraint_name
  from pg_constraint con
  join pg_class child on child.oid = con.conrelid
  join pg_namespace child_ns on child_ns.oid = child.relnamespace
  join pg_class target on target.oid = con.confrelid
  join pg_namespace target_ns on target_ns.oid = target.relnamespace
  join lateral unnest(con.conkey) with ordinality child_key(attnum, ord) on true
  join lateral unnest(con.confkey) with ordinality target_key(attnum, ord)
    on target_key.ord = child_key.ord
  join pg_attribute child_col
    on child_col.attrelid = child.oid
   and child_col.attnum = child_key.attnum
  join pg_attribute target_col
    on target_col.attrelid = target.oid
   and target_col.attnum = target_key.attnum
  where con.contype = 'f'
    and child_ns.nspname = 'public'
    and target_ns.nspname = 'public'
    and target.relname = 'sessions'
    and target_col.attname = 'id'
),
unknown as (
  select d.*
  from direct_fks d
  left join public.session_campaign_move_dependency_policies p
    on p.relation_name = d.relation_name
   and p.session_column = d.session_column
  where p.relation_name is null
),
missing_required as (
  select p.relation_name, p.session_column
  from public.session_campaign_move_dependency_policies p
  where p.required
    and (
      to_regclass(p.relation_name) is null
      or not exists (
        select 1
        from pg_attribute a
        where a.attrelid = to_regclass(p.relation_name)
          and a.attname = p.session_column
          and a.attnum > 0
          and not a.attisdropped
      )
    )
)
select jsonb_build_object(
  'unknown',
  coalesce(
    (select jsonb_agg(to_jsonb(unknown) order by relation_name, constraint_name) from unknown),
    '[]'::jsonb
  ),
  'missingRequired',
  coalesce(
    (select jsonb_agg(to_jsonb(missing_required) order by relation_name) from missing_required),
    '[]'::jsonb
  )
);
$tda_move$;

create or replace function public.session_campaign_move_contract_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $tda_move$
declare
  v_drift jsonb;
begin
  v_drift := public.session_campaign_move_registry_drift();
  return jsonb_build_object(
    'contractVersion', 'tda_session_campaign_move_v2',
    'registryComplete',
      jsonb_array_length(v_drift->'unknown') = 0
      and jsonb_array_length(v_drift->'missingRequired') = 0,
    'supportsPopulatedSessions', true,
    'publicationPolicy', 'explicit_unpublish',
    'supportsMediaPrepare', true,
    'supportsRecoveryReplay', true,
    'supportsDecisions', jsonb_build_array(
      'publishedPolicy:unpublish',
      'participantEntityPolicy:unlink',
      'entityMentionPolicy:detach_from_session',
      'canonPolicy:detach_entity_links',
      'sessionGrantPolicy:preserve',
      'sessionGrantPolicy:revoke',
      'legacyCoverPolicy:clear_current'
    )
  );
end;
$tda_move$;

create or replace function public.session_campaign_move_decisions(
  p_options jsonb
)
returns jsonb
language sql
immutable
security invoker
set search_path = pg_catalog, public
as $tda_move$
select jsonb_strip_nulls(jsonb_build_object(
  'publishedPolicy', p_options->>'publishedPolicy',
  'participantEntityPolicy', p_options->>'participantEntityPolicy',
  'entityMentionPolicy', p_options->>'entityMentionPolicy',
  'canonPolicy', p_options->>'canonPolicy',
  'sessionGrantPolicy', p_options->>'sessionGrantPolicy',
  'legacyCoverPolicy', p_options->>'legacyCoverPolicy'
));
$tda_move$;

create or replace function public.session_campaign_move_options_valid(
  p_options jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog, public
as $tda_move$
select
  p_options is not null
  and jsonb_typeof(p_options) = 'object'
  and not exists (
    select 1
    from jsonb_object_keys(p_options) k(key_name)
    where k.key_name not in (
      'publishedPolicy',
      'participantEntityPolicy',
      'entityMentionPolicy',
      'canonPolicy',
      'sessionGrantPolicy',
      'legacyCoverPolicy',
      'preparedCover'
    )
  )
  and coalesce(p_options->>'publishedPolicy', '') in ('', 'unpublish')
  and coalesce(p_options->>'participantEntityPolicy', '') in ('', 'unlink')
  and coalesce(p_options->>'entityMentionPolicy', '') in ('', 'detach_from_session')
  and coalesce(p_options->>'canonPolicy', '') in ('', 'detach_entity_links')
  and coalesce(p_options->>'sessionGrantPolicy', '') in ('', 'preserve', 'revoke')
  and coalesce(p_options->>'legacyCoverPolicy', '') in ('', 'clear_current')
  and (
    not (p_options ? 'preparedCover')
    or p_options->'preparedCover' is null
    or jsonb_typeof(p_options->'preparedCover') = 'object'
  );
$tda_move$;

create or replace function public.session_campaign_move_plan_v2(
  p_actor_profile_id uuid,
  p_source_campaign_id uuid,
  p_destination_campaign_id uuid,
  p_source_campaign_slug text,
  p_destination_campaign_slug text,
  p_session_id uuid,
  p_options jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $tda_move$
declare
  v_items jsonb := '[]'::jsonb;
  v_policy record;
  v_count bigint;
  v_current_draft_id uuid;
  v_current_publication_id uuid;
  v_status text;
  v_cover text;
  v_cover_valid boolean := false;
  v_linked_participants bigint := 0;
  v_entity_mentions bigint := 0;
  v_canon_linked bigint := 0;
  v_canon_published bigint := 0;
  v_session_grants bigint := 0;
  v_drift jsonb;
  v_classification text;
begin
  v_drift := public.session_campaign_move_registry_drift();
  if jsonb_array_length(v_drift->'unknown') > 0
     or jsonb_array_length(v_drift->'missingRequired') > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'dependency_registry_drift',
      'family', 'schema',
      'classification', 'hard_block',
      'resolved', false,
      'count',
        jsonb_array_length(v_drift->'unknown')
        + jsonb_array_length(v_drift->'missingRequired'),
      'message', 'O schema possui dependências de sessão sem política de move compatível.'
    ));
  end if;

  select
    s.current_editorial_draft_id,
    s.current_session_publication_id,
    s.status
  into
    v_current_draft_id,
    v_current_publication_id,
    v_status
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = p_source_campaign_id;

  if not found then
    return jsonb_build_array(jsonb_build_object(
      'code', 'session_missing',
      'family', 'session',
      'classification', 'hard_block',
      'resolved', false,
      'count', 1,
      'message', 'A sessão não existe mais no escopo de origem.'
    ));
  end if;

  for v_policy in
    select *
    from public.session_campaign_move_dependency_policies
    order by family, relation_name
  loop
    if to_regclass(v_policy.relation_name) is null then
      continue;
    end if;

    v_count := public.session_campaign_move_dependency_count(
      v_policy.relation_name,
      v_policy.session_column,
      p_session_id
    );
    if v_count <= 0 then
      continue;
    end if;

    if v_policy.relation_name in (
      'public.canon_candidates',
      'public.entity_mentions'
    ) then
      continue;
    end if;

    if v_policy.policy = 'hard_block' then
      v_classification := 'hard_block';
    elsif v_policy.policy = 'preserve_historical_attribution' then
      v_classification := 'historical';
    else
      v_classification := 'auto';
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', split_part(v_policy.relation_name, '.', 2),
      'family', v_policy.family,
      'classification', v_classification,
      'resolved', v_classification <> 'hard_block',
      'count', v_count,
      'message', v_policy.label
    ));
  end loop;

  if v_current_publication_id is not null or v_status = 'published' then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'active_publication',
      'family', 'session_publication',
      'classification', 'decision',
      'resolved', p_options->>'publishedPolicy' = 'unpublish'
        and public.has_profile_campaign_capability(
          p_actor_profile_id,
          p_source_campaign_slug,
          'campaign.sessions.publish',
          statement_timestamp()
        ),
      'count', 1,
      'actionId', 'published_unpublish',
      'selectedPolicy', p_options->>'publishedPolicy',
      'message',
        case
          when p_options->>'publishedPolicy' = 'unpublish'
            and not public.has_profile_campaign_capability(
              p_actor_profile_id,
              p_source_campaign_slug,
              'campaign.sessions.publish',
              statement_timestamp()
            )
          then 'Despublicar exige capability de publicação na campanha de origem.'
          else 'A publicação ativa precisa ser despublicada atomicamente durante o move.'
        end
    ));
  end if;

  select count(*)
  into v_linked_participants
  from public.participants p
  where p.session_id = p_session_id
    and p.character_entity_id is not null;

  if v_linked_participants > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'participant_entity_links',
      'family', 'participants',
      'classification', 'decision',
      'resolved', p_options->>'participantEntityPolicy' = 'unlink',
      'count', v_linked_participants,
      'actionId', 'participant_entity_unlink',
      'selectedPolicy', p_options->>'participantEntityPolicy',
      'message', 'Vínculos participant → entity da campanha de origem precisam ser removidos explicitamente.'
    ));
  end if;

  select count(*)
  into v_entity_mentions
  from public.entity_mentions em
  where em.session_id = p_session_id;

  if v_entity_mentions > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'entity_mentions',
      'family', 'entity_mentions',
      'classification', 'decision',
      'resolved', p_options->>'entityMentionPolicy' = 'detach_from_session',
      'count', v_entity_mentions,
      'actionId', 'entity_mentions_detach',
      'selectedPolicy', p_options->>'entityMentionPolicy',
      'message', 'Menções ligadas a entities da origem precisam ser destacadas da sessão antes do move.'
    ));
  end if;

  select count(*)
  into v_canon_linked
  from public.canon_candidates cc
  where cc.session_id = p_session_id
    and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

  if v_canon_linked > 0 then
    if to_regclass('public.canon_entries') is not null then
      select count(*)
      into v_canon_published
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id;
    end if;

    if v_canon_published > 0 then
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'code', 'canon_entries_from_session',
        'family', 'canon_candidates',
        'classification', 'hard_block',
        'resolved', false,
        'count', v_canon_published,
        'message', 'Há canon já materializado a partir desta sessão; mover exige reconciliação editorial fora deste boundary.'
      ));
    else
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'code', 'canon_candidate_entity_links',
        'family', 'canon_candidates',
        'classification', 'decision',
        'resolved', p_options->>'canonPolicy' = 'detach_entity_links',
        'count', v_canon_linked,
        'actionId', 'canon_detach_entity_links',
        'selectedPolicy', p_options->>'canonPolicy',
        'message', 'Candidatos de cânone possuem links para entities da origem e precisam ser destacados explicitamente.'
      ));
    end if;
  end if;

  select count(*)
  into v_session_grants
  from public.role_assignments ra
  where ra.scope_type = 'session'
    and ra.scope_id = p_session_id::text
    and ra.status in ('active', 'eligible');

  if v_session_grants > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'session_scoped_grants',
      'family', 'authorization',
      'classification', 'decision',
      'resolved',
        p_options->>'sessionGrantPolicy' in ('preserve', 'revoke')
        and public.has_profile_campaign_capability(
          p_actor_profile_id,
          p_source_campaign_slug,
          'campaign.permissions.manage',
          statement_timestamp()
        )
        and public.has_profile_campaign_capability(
          p_actor_profile_id,
          p_destination_campaign_slug,
          'campaign.permissions.manage',
          statement_timestamp()
        ),
      'count', v_session_grants,
      'actionId', 'session_grants',
      'selectedPolicy', p_options->>'sessionGrantPolicy',
      'message',
        case
          when p_options->>'sessionGrantPolicy' in ('preserve', 'revoke')
            and not (
              public.has_profile_campaign_capability(
                p_actor_profile_id,
                p_source_campaign_slug,
                'campaign.permissions.manage',
                statement_timestamp()
              )
              and public.has_profile_campaign_capability(
                p_actor_profile_id,
                p_destination_campaign_slug,
                'campaign.permissions.manage',
                statement_timestamp()
              )
            )
          then 'Reconciliar grants exige permission management em origem e destino.'
          else 'Grants específicos da sessão precisam de decisão explícita: preservar ou revogar.'
        end
    ));
  end if;

  if v_current_draft_id is not null then
    select nullif(btrim(d.cover_asset_id), '')
    into v_cover
    from public.session_editorial_drafts d
    where d.id = v_current_draft_id
      and d.session_id = p_session_id;

    if found and v_cover is not null then
      if v_cover ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        select exists (
          select 1
          from public.media_assets ma
          where ma.id = v_cover::uuid
            and ma.campaign_id = p_source_campaign_id
            and ma.role_hint = 'session_cover'
            and ma.status in ('staged', 'verified_public')
            and ma.read_back_verified = true
            and ma.object_key like (
              'campaigns/' || p_source_campaign_slug || '/sessions/' ||
              lower(p_session_id::text) || '/cover/%'
            )
        )
        into v_cover_valid;

        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'code', case when v_cover_valid then 'current_draft_cover' else 'current_draft_cover_invalid' end,
          'family', 'session_cover',
          'classification', case when v_cover_valid then 'external_prepare' else 'hard_block' end,
          'resolved', v_cover_valid,
          'count', 1,
          'message',
            case
              when v_cover_valid
              then 'A capa atual será copiada e verificada no namespace da campanha de destino antes do commit.'
              else 'A capa atual não corresponde a um asset íntegro da campanha de origem.'
            end
        ));
      else
        v_items := v_items || jsonb_build_array(jsonb_build_object(
          'code', 'legacy_current_draft_cover',
          'family', 'session_cover',
          'classification', 'decision',
          'resolved', p_options->>'legacyCoverPolicy' = 'clear_current',
          'count', 1,
          'actionId', 'legacy_cover_clear',
          'selectedPolicy', p_options->>'legacyCoverPolicy',
          'message', 'A capa legada não pode trocar de namespace com segurança; o novo current draft precisa iniciar sem ela.'
        ));
      end if;
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'current_editorial_draft_bridge',
      'family', 'editorial_drafts',
      'classification', 'auto',
      'resolved', true,
      'count', 1,
      'message', 'O draft atual será preservado e um bridge draft imutável será criado no destino.'
    ));
  end if;

  return v_items;
end;
$tda_move$;

create or replace function public.preflight_session_campaign_move_v2(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_source_campaign_slug text,
  p_destination_campaign_slug text,
  p_session_id uuid,
  p_source_session_id text,
  p_options jsonb
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
  v_session public.sessions%rowtype;
  v_items jsonb;
  v_blockers jsonb;
  v_ready boolean;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_source_campaign_slug is null
     or p_destination_campaign_slug is null
     or p_source_campaign_slug = p_destination_campaign_slug
     or p_session_id is null
     or p_source_session_id is null
     or btrim(p_source_session_id) = ''
     or not public.session_campaign_move_options_valid(coalesce(p_options, '{}'::jsonb)) then
    return jsonb_build_object(
      'status', 'validation',
      'contractVersion', 'tda_session_campaign_move_v2',
      'blockers', '[]'::jsonb,
      'planItems', '[]'::jsonb
    );
  end if;

  p_options := coalesce(p_options, '{}'::jsonb);

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
      and p.auth_user_id = p_auth_user_id
  ) then
    return jsonb_build_object(
      'status', 'forbidden',
      'contractVersion', 'tda_session_campaign_move_v2',
      'blockers', '[]'::jsonb,
      'planItems', '[]'::jsonb
    );
  end if;

  select * into v_source
  from public.campaigns
  where slug = p_source_campaign_slug;

  select * into v_destination
  from public.campaigns
  where slug = p_destination_campaign_slug;

  if v_source.id is null or v_destination.id is null then
    return jsonb_build_object(
      'status', 'not_found',
      'contractVersion', 'tda_session_campaign_move_v2',
      'blockers', '[]'::jsonb,
      'planItems', '[]'::jsonb
    );
  end if;

  if v_source.lifecycle <> 'active' or v_destination.lifecycle <> 'active' then
    return jsonb_build_object(
      'status', 'blocked',
      'contractVersion', 'tda_session_campaign_move_v2',
      'blockers', jsonb_build_array(jsonb_build_object(
        'code', case when v_source.lifecycle <> 'active' then 'source_archived' else 'destination_archived' end,
        'count', 1,
        'message', 'Campanhas arquivadas são somente leitura para esta operação.'
      )),
      'planItems', '[]'::jsonb
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
    return jsonb_build_object(
      'status', 'forbidden',
      'contractVersion', 'tda_session_campaign_move_v2',
      'blockers', '[]'::jsonb,
      'planItems', '[]'::jsonb
    );
  end if;

  select *
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    return jsonb_build_object(
      'status', 'conflict',
      'contractVersion', 'tda_session_campaign_move_v2',
      'blockers', '[]'::jsonb,
      'planItems', '[]'::jsonb
    );
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
      'contractVersion', 'tda_session_campaign_move_v2',
      'blockers', jsonb_build_array(jsonb_build_object(
        'code', 'source_identity_collision',
        'count', 1,
        'message', 'O destino já possui uma sessão com o mesmo sourceSessionId.'
      )),
      'planItems', jsonb_build_array(jsonb_build_object(
        'code', 'source_identity_collision',
        'family', 'session',
        'classification', 'hard_block',
        'resolved', false,
        'count', 1,
        'message', 'O destino já possui uma sessão com o mesmo sourceSessionId.'
      ))
    );
  end if;

  v_items := public.session_campaign_move_plan_v2(
    p_actor_profile_id,
    v_source.id,
    v_destination.id,
    p_source_campaign_slug,
    p_destination_campaign_slug,
    p_session_id,
    p_options
  );

  select not exists (
    select 1
    from jsonb_array_elements(v_items) item
    where item->>'classification' = 'hard_block'
       or (
         item->>'classification' = 'decision'
         and coalesce((item->>'resolved')::boolean, false) is not true
       )
  )
  into v_ready;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', item->>'code',
    'count', greatest(coalesce((item->>'count')::bigint, 1), 1),
    'message', item->>'message'
  )), '[]'::jsonb)
  into v_blockers
  from jsonb_array_elements(v_items) item
  where item->>'classification' = 'hard_block'
     or (
       item->>'classification' = 'decision'
       and coalesce((item->>'resolved')::boolean, false) is not true
     );

  return jsonb_build_object(
    'status', case when v_ready then 'ready' else 'blocked' end,
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'blockers', v_blockers,
    'planItems', v_items,
    'consequences', jsonb_build_array(
      'edit_url_changes',
      'campaign_scope_changes',
      'cache_revalidation_required'
    )
  );
end;
$tda_move$;

create or replace function public.move_session_campaign_atomic_v2(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_source_campaign_slug text,
  p_destination_campaign_slug text,
  p_session_id uuid,
  p_source_session_id text,
  p_operation_id uuid,
  p_options jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $tda_move$
declare
  v_existing public.session_campaign_move_operations%rowtype;
  v_source public.campaigns%rowtype;
  v_destination public.campaigns%rowtype;
  v_session public.sessions%rowtype;
  v_preflight jsonb;
  v_decisions jsonb;
  v_current_draft public.session_editorial_drafts%rowtype;
  v_bridge_draft_id uuid;
  v_bridge_revision bigint;
  v_bridge_cover text;
  v_prepared jsonb;
  v_source_media public.media_assets%rowtype;
  v_destination_media public.media_assets%rowtype;
  v_source_asset_id uuid;
  v_destination_asset_id uuid;
  v_expected_source_key text;
  v_expected_destination_key text;
  v_extension text;
  v_participant_unlinks bigint := 0;
  v_entity_detaches bigint := 0;
  v_canon_detaches bigint := 0;
  v_grant_count bigint := 0;
begin
  p_options := coalesce(p_options, '{}'::jsonb);
  if p_operation_id is null
     or not public.session_campaign_move_options_valid(p_options) then
    return jsonb_build_object('status', 'validation');
  end if;

  v_decisions := public.session_campaign_move_decisions(p_options);

  select *
  into v_existing
  from public.session_campaign_move_operations o
  where o.operation_id = p_operation_id;

  if found then
    if v_existing.contract_version = 'tda_session_campaign_move_v2'
       and v_existing.session_id = p_session_id
       and v_existing.actor_profile_id = p_actor_profile_id
       and v_existing.source_session_id = p_source_session_id
       and v_existing.decisions = v_decisions
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
        'contractVersion', 'tda_session_campaign_move_v2',
        'sessionId', p_session_id,
        'sourceSessionId', p_source_session_id,
        'sourceCampaignSlug', p_source_campaign_slug,
        'destinationCampaignSlug', p_destination_campaign_slug,
        'operationId', p_operation_id
      );
    end if;
    return jsonb_build_object('status', 'operation_conflict');
  end if;

  select * into v_source
  from public.campaigns
  where slug = p_source_campaign_slug;

  select * into v_destination
  from public.campaigns
  where slug = p_destination_campaign_slug;

  if v_source.id is null or v_destination.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select *
  into v_session
  from public.sessions s
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id
  for update;

  if not found then
    return jsonb_build_object('status', 'conflict');
  end if;

  v_preflight := public.preflight_session_campaign_move_v2(
    p_auth_user_id,
    p_actor_profile_id,
    p_source_campaign_slug,
    p_destination_campaign_slug,
    p_session_id,
    p_source_session_id,
    v_decisions
  );

  if v_preflight->>'status' <> 'ready' then
    return v_preflight;
  end if;

  if v_session.current_editorial_draft_id is not null then
    select *
    into v_current_draft
    from public.session_editorial_drafts d
    where d.id = v_session.current_editorial_draft_id
      and d.session_id = p_session_id
    for share;

    if not found then
      raise exception 'current editorial draft pointer is inconsistent';
    end if;

    v_bridge_cover := nullif(btrim(v_current_draft.cover_asset_id), '');
    if v_bridge_cover is not null
       and v_bridge_cover ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_source_asset_id := v_bridge_cover::uuid;
      v_prepared := p_options->'preparedCover';

      if v_prepared is null
         or coalesce(v_prepared->>'sourceAssetId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}

      select *
      into v_source_media
      from public.media_assets ma
      where ma.id = v_source_asset_id
        and ma.campaign_id = v_source.id
        and ma.role_hint = 'session_cover'
        and ma.status in ('staged', 'verified_public')
        and ma.read_back_verified = true;

      if not found
         or v_source_media.sha256 <> v_prepared->>'sha256'
         or v_source_media.mime_type <> v_prepared->>'mimeType'
         or v_source_media.byte_size <> (v_prepared->>'bytes')::bigint
         or v_source_media.width <> (v_prepared->>'width')::integer
         or v_source_media.height <> (v_prepared->>'height')::integer then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_extension := case when v_source_media.mime_type = 'image/png' then 'png' else 'webp' end;
      v_expected_source_key :=
        'campaigns/' || p_source_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;
      v_expected_destination_key :=
        'campaigns/' || p_destination_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;

      if v_source_media.object_key <> v_expected_source_key
         or v_prepared->>'objectKey' <> v_expected_destination_key then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      select *
      into v_destination_media
      from public.media_assets ma
      where ma.id = v_destination_asset_id;

      if found then
        if v_destination_media.campaign_id <> v_destination.id
           or v_destination_media.role_hint <> 'session_cover'
           or v_destination_media.sha256 <> v_source_media.sha256
           or v_destination_media.mime_type <> v_source_media.mime_type
           or v_destination_media.byte_size <> v_source_media.byte_size
           or v_destination_media.width <> v_source_media.width
           or v_destination_media.height <> v_source_media.height
           or v_destination_media.staged_bucket <> v_prepared->>'stagedBucket'
           or v_destination_media.object_key <> v_expected_destination_key
           or v_destination_media.read_back_verified is not true then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;

        if v_destination.visibility <> 'public'
           and v_destination_media.status = 'verified_public' then
          update public.media_assets ma
          set
            status = 'staged',
            public_bucket = null,
            public_object_key = null,
            public_delivery_verified = false,
            public_verified_at = null,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'verified_public'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;

          select *
          into v_destination_media
          from public.media_assets ma
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id;
        end if;

        if v_prepared->>'status' = 'verified_public'
           and v_destination_media.status = 'staged' then
          update public.media_assets ma
          set
            status = 'verified_public',
            public_bucket = nullif(v_prepared->>'publicBucket', ''),
            public_object_key = nullif(v_prepared->>'publicObjectKey', ''),
            public_delivery_verified = coalesce(
              (v_prepared->>'publicDeliveryVerified')::boolean,
              false
            ),
            public_verified_at =
              nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'staged'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;
        elsif v_destination_media.status = 'retired' then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      else
        insert into public.media_assets(
          id,
          campaign_id,
          media_kind,
          role_hint,
          status,
          staged_bucket,
          object_key,
          sha256,
          mime_type,
          byte_size,
          width,
          height,
          read_back_verified,
          public_bucket,
          public_object_key,
          public_delivery_verified,
          public_verified_at,
          created_by
        ) values (
          v_destination_asset_id,
          v_destination.id,
          'image',
          'session_cover',
          v_prepared->>'status',
          v_prepared->>'stagedBucket',
          v_prepared->>'objectKey',
          v_prepared->>'sha256',
          v_prepared->>'mimeType',
          (v_prepared->>'bytes')::bigint,
          (v_prepared->>'width')::integer,
          (v_prepared->>'height')::integer,
          true,
          nullif(v_prepared->>'publicBucket', ''),
          nullif(v_prepared->>'publicObjectKey', ''),
          coalesce((v_prepared->>'publicDeliveryVerified')::boolean, false),
          nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
          p_actor_profile_id
        );
      end if;

      if v_prepared->>'status' = 'verified_public' then
        select *
        into v_destination_media
        from public.media_assets ma
        where ma.id = v_destination_asset_id
          and ma.campaign_id = v_destination.id
          and ma.status = 'verified_public'
          and ma.public_bucket = 'tda-media-public'
          and ma.public_object_key = ma.object_key
          and ma.public_delivery_verified = true
          and ma.public_verified_at is not null;

        if not found then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      end if;

      v_bridge_cover := v_destination_asset_id::text;
    elsif v_bridge_cover is not null then
      if p_options->>'legacyCoverPolicy' <> 'clear_current' then
        return jsonb_build_object('status', 'blocked');
      end if;
      v_bridge_cover := null;
    end if;

    select coalesce(max(d.revision), 0) + 1
    into v_bridge_revision
    from public.session_editorial_drafts d
    where d.session_id = p_session_id;

    v_bridge_draft_id := gen_random_uuid();

    insert into public.session_editorial_drafts(
      id,
      campaign_id,
      session_id,
      revision,
      base_transcript_revision_id,
      cover_asset_id,
      arc,
      title,
      summary_short,
      summary_full,
      actor_profile_id,
      created_at,
      session_date,
      session_date_captured
    ) values (
      v_bridge_draft_id,
      v_destination.id,
      p_session_id,
      v_bridge_revision,
      v_current_draft.base_transcript_revision_id,
      v_bridge_cover,
      v_current_draft.arc,
      v_current_draft.title,
      v_current_draft.summary_short,
      v_current_draft.summary_full,
      p_actor_profile_id,
      clock_timestamp(),
      v_current_draft.session_date,
      v_current_draft.session_date_captured
    );
  end if;

  insert into public.session_campaign_move_operations(
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    actor_profile_id,
    contract_version,
    decisions
  ) values (
    p_operation_id,
    p_session_id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_actor_profile_id,
    'tda_session_campaign_move_v2',
    v_decisions
  );

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select
    p_operation_id,
    'transcript_revision',
    tr.id,
    v_source.id,
    v_destination.id
  from public.transcript_revisions tr
  where tr.session_id = p_session_id
    and tr.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_receipt', r.id, v_source.id, v_destination.id
  from public.transcript_publication_receipts r
  where r.session_id = p_session_id
    and r.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_event', e.id, v_source.id, v_destination.id
  from public.transcript_publication_events e
  where e.session_id = p_session_id
    and e.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if to_regclass('public.transcript_assembly_publication_receipts') is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'transcript_assembly_receipt', r.id, v_source.id, v_destination.id
    from public.transcript_assembly_publication_receipts r
    where r.session_id = p_session_id
      and r.campaign_id = v_source.id
    on conflict do nothing;

    update public.transcript_assembly_publication_receipts
    set campaign_id = v_destination.id
    where session_id = p_session_id
      and campaign_id = v_source.id;
  end if;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication', sp.id, v_source.id, v_destination.id
  from public.session_publications sp
  where sp.session_id = p_session_id
    and sp.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication_operation', spo.operation_id, v_source.id, v_destination.id
  from public.session_publication_operations spo
  where spo.session_id = p_session_id
    and spo.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if p_options->>'participantEntityPolicy' = 'unlink' then
    select count(*)
    into v_participant_unlinks
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'participant_entity_unlink',
      p.id,
      p.character_entity_id,
      v_source.id,
      v_destination.id
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null
    on conflict do nothing;

    update public.participants
    set character_entity_id = null
    where session_id = p_session_id
      and character_entity_id is not null;
  end if;

  if p_options->>'entityMentionPolicy' = 'detach_from_session' then
    select count(*)
    into v_entity_detaches
    from public.entity_mentions em
    where em.session_id = p_session_id;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'entity_mention_detach',
      em.id,
      em.entity_id,
      v_source.id,
      v_destination.id
    from public.entity_mentions em
    where em.session_id = p_session_id
    on conflict do nothing;

    update public.entity_mentions
    set session_id = null
    where session_id = p_session_id;
  end if;

  if p_options->>'canonPolicy' = 'detach_entity_links' then
    if exists (
      select 1
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id
    ) then
      return jsonb_build_object('status', 'blocked');
    end if;

    select count(*)
    into v_canon_detaches
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'canon_candidate_entity_detach', cc.id, v_source.id, v_destination.id
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0
    on conflict do nothing;

    update public.canon_candidates
    set related_entity_ids = null
    where session_id = p_session_id
      and coalesce(cardinality(related_entity_ids), 0) > 0;
  end if;

  if p_options->>'sessionGrantPolicy' in ('preserve', 'revoke') then
    select count(*)
    into v_grant_count
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible');

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      case
        when p_options->>'sessionGrantPolicy' = 'revoke'
          then 'session_grant_revoke'
        else 'session_grant_preserve'
      end,
      ra.id,
      v_source.id,
      v_destination.id
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible')
    on conflict do nothing;

    if p_options->>'sessionGrantPolicy' = 'revoke' then
      update public.role_assignments
      set
        status = 'revoked',
        revoked_by = p_actor_profile_id,
        updated_at = clock_timestamp()
      where scope_type = 'session'
        and scope_id = p_session_id::text
        and status in ('active', 'eligible');
    end if;
  end if;

  if v_session.current_session_publication_id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'active_session_publication_unpublish',
      v_session.current_session_publication_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;
  end if;

  if v_current_draft.id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'editorial_draft_bridge',
      v_current_draft.id,
      v_bridge_draft_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;

    if v_source_asset_id is not null and v_destination_asset_id is not null then
      insert into public.session_campaign_move_artifacts(
        operation_id, artifact_kind, artifact_id, related_artifact_id,
        source_campaign_id, destination_campaign_id
      ) values (
        p_operation_id,
        'session_cover_rehome',
        v_source_asset_id,
        v_destination_asset_id,
        v_source.id,
        v_destination.id
      )
      on conflict do nothing;
    end if;
  end if;

  if v_participant_unlinks > 0
     or v_entity_detaches > 0
     or v_canon_detaches > 0
     or v_grant_count > 0 then
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
      v_destination.id,
      p_session_id,
      p_actor_profile_id,
      'session.campaign.move.reconcile',
      'sessions',
      p_session_id,
      jsonb_build_object(
        'campaignId', v_source.id,
        'participantEntityLinks', v_participant_unlinks,
        'entityMentions', v_entity_detaches,
        'canonCandidateEntityLinks', v_canon_detaches,
        'sessionGrants', v_grant_count
      ),
      jsonb_build_object(
        'campaignId', v_destination.id,
        'participantEntityPolicy', p_options->>'participantEntityPolicy',
        'entityMentionPolicy', p_options->>'entityMentionPolicy',
        'canonPolicy', p_options->>'canonPolicy',
        'sessionGrantPolicy', p_options->>'sessionGrantPolicy'
      )
    );
  end if;

  update public.sessions s
  set
    campaign_id = v_destination.id,
    current_editorial_draft_id = coalesce(v_bridge_draft_id, s.current_editorial_draft_id),
    current_session_publication_id =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then null
        else s.current_session_publication_id
      end,
    status =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then 'approved'
        else s.status
      end,
    metadata =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
        then (coalesce(s.metadata, '{}'::jsonb) - 'coverImageUrl' - 'heroImageUrl')
        else s.metadata
      end,
    updated_at = clock_timestamp()
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    raise exception 'session campaign authority changed while locked';
  end if;

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
    v_destination.id,
    p_session_id,
    p_actor_profile_id,
    'session.campaign.move.v2',
    'sessions',
    p_session_id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', p_source_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'published', v_session.current_session_publication_id is not null or v_session.status = 'published'
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', p_destination_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'publicationPolicy', p_options->>'publishedPolicy',
      'bridgeDraftId', v_bridge_draft_id,
      'contractVersion', 'tda_session_campaign_move_v2'
    )
  );

  return jsonb_build_object(
    'status', 'moved',
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'operationId', p_operation_id,
    'bridgeDraftId', v_bridge_draft_id,
    'publicationState',
      case
        when v_session.current_session_publication_id is not null or v_session.status = 'published'
          then 'unpublished'
        else 'unchanged'
      end
  );
end;
$tda_move$;

comment on function public.session_campaign_move_contract_v2() is
  'Sanitized server-only capability probe for the v2 populated-session move boundary.';
comment on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) is
  'Server-only v2 preflight. Produces a structured migration plan and requires explicit decisions for public/entity/grant boundaries.';
comment on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) is
  'Server-only v2 commit. Revalidates/locks source, preserves immutable history attribution, migrates current transcript ownership, creates a bridge draft, reconciles explicit decisions and commits the session move atomically.';

revoke all on function public.session_campaign_move_set_origin_campaign() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_registry_drift() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_contract_v2() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_decisions(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_options_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_plan_v2(uuid,uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.session_campaign_move_contract_v2() to service_role;
grant execute on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) to service_role;

commit;

         or coalesce(v_prepared->>'destinationAssetId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}

      select *
      into v_source_media
      from public.media_assets ma
      where ma.id = v_source_asset_id
        and ma.campaign_id = v_source.id
        and ma.role_hint = 'session_cover'
        and ma.status in ('staged', 'verified_public')
        and ma.read_back_verified = true;

      if not found
         or v_source_media.sha256 <> v_prepared->>'sha256'
         or v_source_media.mime_type <> v_prepared->>'mimeType'
         or v_source_media.byte_size <> (v_prepared->>'bytes')::bigint
         or v_source_media.width <> (v_prepared->>'width')::integer
         or v_source_media.height <> (v_prepared->>'height')::integer then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_extension := case when v_source_media.mime_type = 'image/png' then 'png' else 'webp' end;
      v_expected_source_key :=
        'campaigns/' || p_source_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;
      v_expected_destination_key :=
        'campaigns/' || p_destination_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;

      if v_source_media.object_key <> v_expected_source_key
         or v_prepared->>'objectKey' <> v_expected_destination_key then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      select *
      into v_destination_media
      from public.media_assets ma
      where ma.id = v_destination_asset_id;

      if found then
        if v_destination_media.campaign_id <> v_destination.id
           or v_destination_media.role_hint <> 'session_cover'
           or v_destination_media.sha256 <> v_source_media.sha256
           or v_destination_media.mime_type <> v_source_media.mime_type
           or v_destination_media.byte_size <> v_source_media.byte_size
           or v_destination_media.width <> v_source_media.width
           or v_destination_media.height <> v_source_media.height
           or v_destination_media.staged_bucket <> v_prepared->>'stagedBucket'
           or v_destination_media.object_key <> v_expected_destination_key
           or v_destination_media.read_back_verified is not true then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;

        if v_prepared->>'status' = 'verified_public'
           and v_destination_media.status = 'staged' then
          update public.media_assets ma
          set
            status = 'verified_public',
            public_bucket = nullif(v_prepared->>'publicBucket', ''),
            public_object_key = nullif(v_prepared->>'publicObjectKey', ''),
            public_delivery_verified = coalesce(
              (v_prepared->>'publicDeliveryVerified')::boolean,
              false
            ),
            public_verified_at =
              nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'staged'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;
        elsif v_destination_media.status = 'retired' then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      else
        insert into public.media_assets(
          id,
          campaign_id,
          media_kind,
          role_hint,
          status,
          staged_bucket,
          object_key,
          sha256,
          mime_type,
          byte_size,
          width,
          height,
          read_back_verified,
          public_bucket,
          public_object_key,
          public_delivery_verified,
          public_verified_at,
          created_by
        ) values (
          v_destination_asset_id,
          v_destination.id,
          'image',
          'session_cover',
          v_prepared->>'status',
          v_prepared->>'stagedBucket',
          v_prepared->>'objectKey',
          v_prepared->>'sha256',
          v_prepared->>'mimeType',
          (v_prepared->>'bytes')::bigint,
          (v_prepared->>'width')::integer,
          (v_prepared->>'height')::integer,
          true,
          nullif(v_prepared->>'publicBucket', ''),
          nullif(v_prepared->>'publicObjectKey', ''),
          coalesce((v_prepared->>'publicDeliveryVerified')::boolean, false),
          nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
          p_actor_profile_id
        );
      end if;

      if v_prepared->>'status' = 'verified_public' then
        select *
        into v_destination_media
        from public.media_assets ma
        where ma.id = v_destination_asset_id
          and ma.campaign_id = v_destination.id
          and ma.status = 'verified_public'
          and ma.public_bucket = 'tda-media-public'
          and ma.public_object_key = ma.object_key
          and ma.public_delivery_verified = true
          and ma.public_verified_at is not null;

        if not found then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      end if;

      v_bridge_cover := v_destination_asset_id::text;
    elsif v_bridge_cover is not null then
      if p_options->>'legacyCoverPolicy' <> 'clear_current' then
        return jsonb_build_object('status', 'blocked');
      end if;
      v_bridge_cover := null;
    end if;

    select coalesce(max(d.revision), 0) + 1
    into v_bridge_revision
    from public.session_editorial_drafts d
    where d.session_id = p_session_id;

    v_bridge_draft_id := gen_random_uuid();

    insert into public.session_editorial_drafts(
      id,
      campaign_id,
      session_id,
      revision,
      base_transcript_revision_id,
      cover_asset_id,
      arc,
      title,
      summary_short,
      summary_full,
      actor_profile_id,
      created_at,
      session_date,
      session_date_captured
    ) values (
      v_bridge_draft_id,
      v_destination.id,
      p_session_id,
      v_bridge_revision,
      v_current_draft.base_transcript_revision_id,
      v_bridge_cover,
      v_current_draft.arc,
      v_current_draft.title,
      v_current_draft.summary_short,
      v_current_draft.summary_full,
      p_actor_profile_id,
      clock_timestamp(),
      v_current_draft.session_date,
      v_current_draft.session_date_captured
    );
  end if;

  insert into public.session_campaign_move_operations(
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    actor_profile_id,
    contract_version,
    decisions
  ) values (
    p_operation_id,
    p_session_id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_actor_profile_id,
    'tda_session_campaign_move_v2',
    v_decisions
  );

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select
    p_operation_id,
    'transcript_revision',
    tr.id,
    v_source.id,
    v_destination.id
  from public.transcript_revisions tr
  where tr.session_id = p_session_id
    and tr.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_receipt', r.id, v_source.id, v_destination.id
  from public.transcript_publication_receipts r
  where r.session_id = p_session_id
    and r.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_event', e.id, v_source.id, v_destination.id
  from public.transcript_publication_events e
  where e.session_id = p_session_id
    and e.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if to_regclass('public.transcript_assembly_publication_receipts') is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'transcript_assembly_receipt', r.id, v_source.id, v_destination.id
    from public.transcript_assembly_publication_receipts r
    where r.session_id = p_session_id
      and r.campaign_id = v_source.id
    on conflict do nothing;

    update public.transcript_assembly_publication_receipts
    set campaign_id = v_destination.id
    where session_id = p_session_id
      and campaign_id = v_source.id;
  end if;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication', sp.id, v_source.id, v_destination.id
  from public.session_publications sp
  where sp.session_id = p_session_id
    and sp.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication_operation', spo.operation_id, v_source.id, v_destination.id
  from public.session_publication_operations spo
  where spo.session_id = p_session_id
    and spo.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if p_options->>'participantEntityPolicy' = 'unlink' then
    select count(*)
    into v_participant_unlinks
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'participant_entity_unlink',
      p.id,
      p.character_entity_id,
      v_source.id,
      v_destination.id
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null
    on conflict do nothing;

    update public.participants
    set character_entity_id = null
    where session_id = p_session_id
      and character_entity_id is not null;
  end if;

  if p_options->>'entityMentionPolicy' = 'detach_from_session' then
    select count(*)
    into v_entity_detaches
    from public.entity_mentions em
    where em.session_id = p_session_id;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'entity_mention_detach',
      em.id,
      em.entity_id,
      v_source.id,
      v_destination.id
    from public.entity_mentions em
    where em.session_id = p_session_id
    on conflict do nothing;

    update public.entity_mentions
    set session_id = null
    where session_id = p_session_id;
  end if;

  if p_options->>'canonPolicy' = 'detach_entity_links' then
    if exists (
      select 1
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id
    ) then
      return jsonb_build_object('status', 'blocked');
    end if;

    select count(*)
    into v_canon_detaches
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'canon_candidate_entity_detach', cc.id, v_source.id, v_destination.id
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0
    on conflict do nothing;

    update public.canon_candidates
    set related_entity_ids = null
    where session_id = p_session_id
      and coalesce(cardinality(related_entity_ids), 0) > 0;
  end if;

  if p_options->>'sessionGrantPolicy' in ('preserve', 'revoke') then
    select count(*)
    into v_grant_count
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible');

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      case
        when p_options->>'sessionGrantPolicy' = 'revoke'
          then 'session_grant_revoke'
        else 'session_grant_preserve'
      end,
      ra.id,
      v_source.id,
      v_destination.id
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible')
    on conflict do nothing;

    if p_options->>'sessionGrantPolicy' = 'revoke' then
      update public.role_assignments
      set
        status = 'revoked',
        revoked_by = p_actor_profile_id,
        updated_at = clock_timestamp()
      where scope_type = 'session'
        and scope_id = p_session_id::text
        and status in ('active', 'eligible');
    end if;
  end if;

  if v_session.current_session_publication_id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'active_session_publication_unpublish',
      v_session.current_session_publication_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;
  end if;

  if v_current_draft.id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'editorial_draft_bridge',
      v_current_draft.id,
      v_bridge_draft_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;

    if v_source_asset_id is not null and v_destination_asset_id is not null then
      insert into public.session_campaign_move_artifacts(
        operation_id, artifact_kind, artifact_id, related_artifact_id,
        source_campaign_id, destination_campaign_id
      ) values (
        p_operation_id,
        'session_cover_rehome',
        v_source_asset_id,
        v_destination_asset_id,
        v_source.id,
        v_destination.id
      )
      on conflict do nothing;
    end if;
  end if;

  if v_participant_unlinks > 0
     or v_entity_detaches > 0
     or v_canon_detaches > 0
     or v_grant_count > 0 then
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
      v_destination.id,
      p_session_id,
      p_actor_profile_id,
      'session.campaign.move.reconcile',
      'sessions',
      p_session_id,
      jsonb_build_object(
        'campaignId', v_source.id,
        'participantEntityLinks', v_participant_unlinks,
        'entityMentions', v_entity_detaches,
        'canonCandidateEntityLinks', v_canon_detaches,
        'sessionGrants', v_grant_count
      ),
      jsonb_build_object(
        'campaignId', v_destination.id,
        'participantEntityPolicy', p_options->>'participantEntityPolicy',
        'entityMentionPolicy', p_options->>'entityMentionPolicy',
        'canonPolicy', p_options->>'canonPolicy',
        'sessionGrantPolicy', p_options->>'sessionGrantPolicy'
      )
    );
  end if;

  update public.sessions s
  set
    campaign_id = v_destination.id,
    current_editorial_draft_id = coalesce(v_bridge_draft_id, s.current_editorial_draft_id),
    current_session_publication_id =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then null
        else s.current_session_publication_id
      end,
    status =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then 'approved'
        else s.status
      end,
    metadata =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
        then (coalesce(s.metadata, '{}'::jsonb) - 'coverImageUrl' - 'heroImageUrl')
        else s.metadata
      end,
    updated_at = clock_timestamp()
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    raise exception 'session campaign authority changed while locked';
  end if;

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
    v_destination.id,
    p_session_id,
    p_actor_profile_id,
    'session.campaign.move.v2',
    'sessions',
    p_session_id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', p_source_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'published', v_session.current_session_publication_id is not null or v_session.status = 'published'
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', p_destination_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'publicationPolicy', p_options->>'publishedPolicy',
      'bridgeDraftId', v_bridge_draft_id,
      'contractVersion', 'tda_session_campaign_move_v2'
    )
  );

  return jsonb_build_object(
    'status', 'moved',
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'operationId', p_operation_id,
    'bridgeDraftId', v_bridge_draft_id,
    'publicationState',
      case
        when v_session.current_session_publication_id is not null or v_session.status = 'published'
          then 'unpublished'
        else 'unchanged'
      end
  );
end;
$tda_move$;

comment on function public.session_campaign_move_contract_v2() is
  'Sanitized server-only capability probe for the v2 populated-session move boundary.';
comment on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) is
  'Server-only v2 preflight. Produces a structured migration plan and requires explicit decisions for public/entity/grant boundaries.';
comment on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) is
  'Server-only v2 commit. Revalidates/locks source, preserves immutable history attribution, migrates current transcript ownership, creates a bridge draft, reconciles explicit decisions and commits the session move atomically.';

revoke all on function public.session_campaign_move_set_origin_campaign() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_registry_drift() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_contract_v2() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_decisions(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_options_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_plan_v2(uuid,uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.session_campaign_move_contract_v2() to service_role;
grant execute on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) to service_role;

commit;

         or (v_prepared->>'sourceAssetId')::uuid <> v_source_asset_id
         or coalesce(v_prepared->>'sha256', '') !~ '^[0-9a-f]{64}

      select *
      into v_source_media
      from public.media_assets ma
      where ma.id = v_source_asset_id
        and ma.campaign_id = v_source.id
        and ma.role_hint = 'session_cover'
        and ma.status in ('staged', 'verified_public')
        and ma.read_back_verified = true;

      if not found
         or v_source_media.sha256 <> v_prepared->>'sha256'
         or v_source_media.mime_type <> v_prepared->>'mimeType'
         or v_source_media.byte_size <> (v_prepared->>'bytes')::bigint
         or v_source_media.width <> (v_prepared->>'width')::integer
         or v_source_media.height <> (v_prepared->>'height')::integer then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_extension := case when v_source_media.mime_type = 'image/png' then 'png' else 'webp' end;
      v_expected_source_key :=
        'campaigns/' || p_source_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;
      v_expected_destination_key :=
        'campaigns/' || p_destination_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;

      if v_source_media.object_key <> v_expected_source_key
         or v_prepared->>'objectKey' <> v_expected_destination_key then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      select *
      into v_destination_media
      from public.media_assets ma
      where ma.id = v_destination_asset_id;

      if found then
        if v_destination_media.campaign_id <> v_destination.id
           or v_destination_media.role_hint <> 'session_cover'
           or v_destination_media.sha256 <> v_source_media.sha256
           or v_destination_media.mime_type <> v_source_media.mime_type
           or v_destination_media.byte_size <> v_source_media.byte_size
           or v_destination_media.width <> v_source_media.width
           or v_destination_media.height <> v_source_media.height
           or v_destination_media.staged_bucket <> v_prepared->>'stagedBucket'
           or v_destination_media.object_key <> v_expected_destination_key
           or v_destination_media.read_back_verified is not true then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;

        if v_prepared->>'status' = 'verified_public'
           and v_destination_media.status = 'staged' then
          update public.media_assets ma
          set
            status = 'verified_public',
            public_bucket = nullif(v_prepared->>'publicBucket', ''),
            public_object_key = nullif(v_prepared->>'publicObjectKey', ''),
            public_delivery_verified = coalesce(
              (v_prepared->>'publicDeliveryVerified')::boolean,
              false
            ),
            public_verified_at =
              nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'staged'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;
        elsif v_destination_media.status = 'retired' then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      else
        insert into public.media_assets(
          id,
          campaign_id,
          media_kind,
          role_hint,
          status,
          staged_bucket,
          object_key,
          sha256,
          mime_type,
          byte_size,
          width,
          height,
          read_back_verified,
          public_bucket,
          public_object_key,
          public_delivery_verified,
          public_verified_at,
          created_by
        ) values (
          v_destination_asset_id,
          v_destination.id,
          'image',
          'session_cover',
          v_prepared->>'status',
          v_prepared->>'stagedBucket',
          v_prepared->>'objectKey',
          v_prepared->>'sha256',
          v_prepared->>'mimeType',
          (v_prepared->>'bytes')::bigint,
          (v_prepared->>'width')::integer,
          (v_prepared->>'height')::integer,
          true,
          nullif(v_prepared->>'publicBucket', ''),
          nullif(v_prepared->>'publicObjectKey', ''),
          coalesce((v_prepared->>'publicDeliveryVerified')::boolean, false),
          nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
          p_actor_profile_id
        );
      end if;

      if v_prepared->>'status' = 'verified_public' then
        select *
        into v_destination_media
        from public.media_assets ma
        where ma.id = v_destination_asset_id
          and ma.campaign_id = v_destination.id
          and ma.status = 'verified_public'
          and ma.public_bucket = 'tda-media-public'
          and ma.public_object_key = ma.object_key
          and ma.public_delivery_verified = true
          and ma.public_verified_at is not null;

        if not found then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      end if;

      v_bridge_cover := v_destination_asset_id::text;
    elsif v_bridge_cover is not null then
      if p_options->>'legacyCoverPolicy' <> 'clear_current' then
        return jsonb_build_object('status', 'blocked');
      end if;
      v_bridge_cover := null;
    end if;

    select coalesce(max(d.revision), 0) + 1
    into v_bridge_revision
    from public.session_editorial_drafts d
    where d.session_id = p_session_id;

    v_bridge_draft_id := gen_random_uuid();

    insert into public.session_editorial_drafts(
      id,
      campaign_id,
      session_id,
      revision,
      base_transcript_revision_id,
      cover_asset_id,
      arc,
      title,
      summary_short,
      summary_full,
      actor_profile_id,
      created_at,
      session_date,
      session_date_captured
    ) values (
      v_bridge_draft_id,
      v_destination.id,
      p_session_id,
      v_bridge_revision,
      v_current_draft.base_transcript_revision_id,
      v_bridge_cover,
      v_current_draft.arc,
      v_current_draft.title,
      v_current_draft.summary_short,
      v_current_draft.summary_full,
      p_actor_profile_id,
      clock_timestamp(),
      v_current_draft.session_date,
      v_current_draft.session_date_captured
    );
  end if;

  insert into public.session_campaign_move_operations(
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    actor_profile_id,
    contract_version,
    decisions
  ) values (
    p_operation_id,
    p_session_id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_actor_profile_id,
    'tda_session_campaign_move_v2',
    v_decisions
  );

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select
    p_operation_id,
    'transcript_revision',
    tr.id,
    v_source.id,
    v_destination.id
  from public.transcript_revisions tr
  where tr.session_id = p_session_id
    and tr.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_receipt', r.id, v_source.id, v_destination.id
  from public.transcript_publication_receipts r
  where r.session_id = p_session_id
    and r.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_event', e.id, v_source.id, v_destination.id
  from public.transcript_publication_events e
  where e.session_id = p_session_id
    and e.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if to_regclass('public.transcript_assembly_publication_receipts') is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'transcript_assembly_receipt', r.id, v_source.id, v_destination.id
    from public.transcript_assembly_publication_receipts r
    where r.session_id = p_session_id
      and r.campaign_id = v_source.id
    on conflict do nothing;

    update public.transcript_assembly_publication_receipts
    set campaign_id = v_destination.id
    where session_id = p_session_id
      and campaign_id = v_source.id;
  end if;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication', sp.id, v_source.id, v_destination.id
  from public.session_publications sp
  where sp.session_id = p_session_id
    and sp.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication_operation', spo.operation_id, v_source.id, v_destination.id
  from public.session_publication_operations spo
  where spo.session_id = p_session_id
    and spo.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if p_options->>'participantEntityPolicy' = 'unlink' then
    select count(*)
    into v_participant_unlinks
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'participant_entity_unlink',
      p.id,
      p.character_entity_id,
      v_source.id,
      v_destination.id
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null
    on conflict do nothing;

    update public.participants
    set character_entity_id = null
    where session_id = p_session_id
      and character_entity_id is not null;
  end if;

  if p_options->>'entityMentionPolicy' = 'detach_from_session' then
    select count(*)
    into v_entity_detaches
    from public.entity_mentions em
    where em.session_id = p_session_id;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'entity_mention_detach',
      em.id,
      em.entity_id,
      v_source.id,
      v_destination.id
    from public.entity_mentions em
    where em.session_id = p_session_id
    on conflict do nothing;

    update public.entity_mentions
    set session_id = null
    where session_id = p_session_id;
  end if;

  if p_options->>'canonPolicy' = 'detach_entity_links' then
    if exists (
      select 1
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id
    ) then
      return jsonb_build_object('status', 'blocked');
    end if;

    select count(*)
    into v_canon_detaches
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'canon_candidate_entity_detach', cc.id, v_source.id, v_destination.id
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0
    on conflict do nothing;

    update public.canon_candidates
    set related_entity_ids = null
    where session_id = p_session_id
      and coalesce(cardinality(related_entity_ids), 0) > 0;
  end if;

  if p_options->>'sessionGrantPolicy' in ('preserve', 'revoke') then
    select count(*)
    into v_grant_count
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible');

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      case
        when p_options->>'sessionGrantPolicy' = 'revoke'
          then 'session_grant_revoke'
        else 'session_grant_preserve'
      end,
      ra.id,
      v_source.id,
      v_destination.id
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible')
    on conflict do nothing;

    if p_options->>'sessionGrantPolicy' = 'revoke' then
      update public.role_assignments
      set
        status = 'revoked',
        revoked_by = p_actor_profile_id,
        updated_at = clock_timestamp()
      where scope_type = 'session'
        and scope_id = p_session_id::text
        and status in ('active', 'eligible');
    end if;
  end if;

  if v_session.current_session_publication_id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'active_session_publication_unpublish',
      v_session.current_session_publication_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;
  end if;

  if v_current_draft.id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'editorial_draft_bridge',
      v_current_draft.id,
      v_bridge_draft_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;

    if v_source_asset_id is not null and v_destination_asset_id is not null then
      insert into public.session_campaign_move_artifacts(
        operation_id, artifact_kind, artifact_id, related_artifact_id,
        source_campaign_id, destination_campaign_id
      ) values (
        p_operation_id,
        'session_cover_rehome',
        v_source_asset_id,
        v_destination_asset_id,
        v_source.id,
        v_destination.id
      )
      on conflict do nothing;
    end if;
  end if;

  if v_participant_unlinks > 0
     or v_entity_detaches > 0
     or v_canon_detaches > 0
     or v_grant_count > 0 then
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
      v_destination.id,
      p_session_id,
      p_actor_profile_id,
      'session.campaign.move.reconcile',
      'sessions',
      p_session_id,
      jsonb_build_object(
        'campaignId', v_source.id,
        'participantEntityLinks', v_participant_unlinks,
        'entityMentions', v_entity_detaches,
        'canonCandidateEntityLinks', v_canon_detaches,
        'sessionGrants', v_grant_count
      ),
      jsonb_build_object(
        'campaignId', v_destination.id,
        'participantEntityPolicy', p_options->>'participantEntityPolicy',
        'entityMentionPolicy', p_options->>'entityMentionPolicy',
        'canonPolicy', p_options->>'canonPolicy',
        'sessionGrantPolicy', p_options->>'sessionGrantPolicy'
      )
    );
  end if;

  update public.sessions s
  set
    campaign_id = v_destination.id,
    current_editorial_draft_id = coalesce(v_bridge_draft_id, s.current_editorial_draft_id),
    current_session_publication_id =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then null
        else s.current_session_publication_id
      end,
    status =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then 'approved'
        else s.status
      end,
    metadata =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
        then (coalesce(s.metadata, '{}'::jsonb) - 'coverImageUrl' - 'heroImageUrl')
        else s.metadata
      end,
    updated_at = clock_timestamp()
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    raise exception 'session campaign authority changed while locked';
  end if;

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
    v_destination.id,
    p_session_id,
    p_actor_profile_id,
    'session.campaign.move.v2',
    'sessions',
    p_session_id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', p_source_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'published', v_session.current_session_publication_id is not null or v_session.status = 'published'
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', p_destination_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'publicationPolicy', p_options->>'publishedPolicy',
      'bridgeDraftId', v_bridge_draft_id,
      'contractVersion', 'tda_session_campaign_move_v2'
    )
  );

  return jsonb_build_object(
    'status', 'moved',
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'operationId', p_operation_id,
    'bridgeDraftId', v_bridge_draft_id,
    'publicationState',
      case
        when v_session.current_session_publication_id is not null or v_session.status = 'published'
          then 'unpublished'
        else 'unchanged'
      end
  );
end;
$tda_move$;

comment on function public.session_campaign_move_contract_v2() is
  'Sanitized server-only capability probe for the v2 populated-session move boundary.';
comment on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) is
  'Server-only v2 preflight. Produces a structured migration plan and requires explicit decisions for public/entity/grant boundaries.';
comment on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) is
  'Server-only v2 commit. Revalidates/locks source, preserves immutable history attribution, migrates current transcript ownership, creates a bridge draft, reconciles explicit decisions and commits the session move atomically.';

revoke all on function public.session_campaign_move_set_origin_campaign() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_registry_drift() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_contract_v2() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_decisions(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_options_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_plan_v2(uuid,uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.session_campaign_move_contract_v2() to service_role;
grant execute on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) to service_role;

commit;

         or coalesce(v_prepared->>'mimeType', '') not in ('image/png', 'image/webp')
         or coalesce(v_prepared->>'status', '') not in ('staged', 'verified_public')
         or coalesce(v_prepared->>'stagedBucket', '') not in ('tda-media-preview', 'tda-media-private')
         or coalesce(v_prepared->>'objectKey', '') = ''
         or coalesce(v_prepared->>'bytes', '') !~ '^[0-9]{1,12}

      select *
      into v_source_media
      from public.media_assets ma
      where ma.id = v_source_asset_id
        and ma.campaign_id = v_source.id
        and ma.role_hint = 'session_cover'
        and ma.status in ('staged', 'verified_public')
        and ma.read_back_verified = true;

      if not found
         or v_source_media.sha256 <> v_prepared->>'sha256'
         or v_source_media.mime_type <> v_prepared->>'mimeType'
         or v_source_media.byte_size <> (v_prepared->>'bytes')::bigint
         or v_source_media.width <> (v_prepared->>'width')::integer
         or v_source_media.height <> (v_prepared->>'height')::integer then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_extension := case when v_source_media.mime_type = 'image/png' then 'png' else 'webp' end;
      v_expected_source_key :=
        'campaigns/' || p_source_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;
      v_expected_destination_key :=
        'campaigns/' || p_destination_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;

      if v_source_media.object_key <> v_expected_source_key
         or v_prepared->>'objectKey' <> v_expected_destination_key then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      select *
      into v_destination_media
      from public.media_assets ma
      where ma.id = v_destination_asset_id;

      if found then
        if v_destination_media.campaign_id <> v_destination.id
           or v_destination_media.role_hint <> 'session_cover'
           or v_destination_media.sha256 <> v_source_media.sha256
           or v_destination_media.mime_type <> v_source_media.mime_type
           or v_destination_media.byte_size <> v_source_media.byte_size
           or v_destination_media.width <> v_source_media.width
           or v_destination_media.height <> v_source_media.height
           or v_destination_media.staged_bucket <> v_prepared->>'stagedBucket'
           or v_destination_media.object_key <> v_expected_destination_key
           or v_destination_media.read_back_verified is not true then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;

        if v_prepared->>'status' = 'verified_public'
           and v_destination_media.status = 'staged' then
          update public.media_assets ma
          set
            status = 'verified_public',
            public_bucket = nullif(v_prepared->>'publicBucket', ''),
            public_object_key = nullif(v_prepared->>'publicObjectKey', ''),
            public_delivery_verified = coalesce(
              (v_prepared->>'publicDeliveryVerified')::boolean,
              false
            ),
            public_verified_at =
              nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'staged'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;
        elsif v_destination_media.status = 'retired' then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      else
        insert into public.media_assets(
          id,
          campaign_id,
          media_kind,
          role_hint,
          status,
          staged_bucket,
          object_key,
          sha256,
          mime_type,
          byte_size,
          width,
          height,
          read_back_verified,
          public_bucket,
          public_object_key,
          public_delivery_verified,
          public_verified_at,
          created_by
        ) values (
          v_destination_asset_id,
          v_destination.id,
          'image',
          'session_cover',
          v_prepared->>'status',
          v_prepared->>'stagedBucket',
          v_prepared->>'objectKey',
          v_prepared->>'sha256',
          v_prepared->>'mimeType',
          (v_prepared->>'bytes')::bigint,
          (v_prepared->>'width')::integer,
          (v_prepared->>'height')::integer,
          true,
          nullif(v_prepared->>'publicBucket', ''),
          nullif(v_prepared->>'publicObjectKey', ''),
          coalesce((v_prepared->>'publicDeliveryVerified')::boolean, false),
          nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
          p_actor_profile_id
        );
      end if;

      if v_prepared->>'status' = 'verified_public' then
        select *
        into v_destination_media
        from public.media_assets ma
        where ma.id = v_destination_asset_id
          and ma.campaign_id = v_destination.id
          and ma.status = 'verified_public'
          and ma.public_bucket = 'tda-media-public'
          and ma.public_object_key = ma.object_key
          and ma.public_delivery_verified = true
          and ma.public_verified_at is not null;

        if not found then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      end if;

      v_bridge_cover := v_destination_asset_id::text;
    elsif v_bridge_cover is not null then
      if p_options->>'legacyCoverPolicy' <> 'clear_current' then
        return jsonb_build_object('status', 'blocked');
      end if;
      v_bridge_cover := null;
    end if;

    select coalesce(max(d.revision), 0) + 1
    into v_bridge_revision
    from public.session_editorial_drafts d
    where d.session_id = p_session_id;

    v_bridge_draft_id := gen_random_uuid();

    insert into public.session_editorial_drafts(
      id,
      campaign_id,
      session_id,
      revision,
      base_transcript_revision_id,
      cover_asset_id,
      arc,
      title,
      summary_short,
      summary_full,
      actor_profile_id,
      created_at,
      session_date,
      session_date_captured
    ) values (
      v_bridge_draft_id,
      v_destination.id,
      p_session_id,
      v_bridge_revision,
      v_current_draft.base_transcript_revision_id,
      v_bridge_cover,
      v_current_draft.arc,
      v_current_draft.title,
      v_current_draft.summary_short,
      v_current_draft.summary_full,
      p_actor_profile_id,
      clock_timestamp(),
      v_current_draft.session_date,
      v_current_draft.session_date_captured
    );
  end if;

  insert into public.session_campaign_move_operations(
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    actor_profile_id,
    contract_version,
    decisions
  ) values (
    p_operation_id,
    p_session_id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_actor_profile_id,
    'tda_session_campaign_move_v2',
    v_decisions
  );

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select
    p_operation_id,
    'transcript_revision',
    tr.id,
    v_source.id,
    v_destination.id
  from public.transcript_revisions tr
  where tr.session_id = p_session_id
    and tr.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_receipt', r.id, v_source.id, v_destination.id
  from public.transcript_publication_receipts r
  where r.session_id = p_session_id
    and r.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_event', e.id, v_source.id, v_destination.id
  from public.transcript_publication_events e
  where e.session_id = p_session_id
    and e.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if to_regclass('public.transcript_assembly_publication_receipts') is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'transcript_assembly_receipt', r.id, v_source.id, v_destination.id
    from public.transcript_assembly_publication_receipts r
    where r.session_id = p_session_id
      and r.campaign_id = v_source.id
    on conflict do nothing;

    update public.transcript_assembly_publication_receipts
    set campaign_id = v_destination.id
    where session_id = p_session_id
      and campaign_id = v_source.id;
  end if;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication', sp.id, v_source.id, v_destination.id
  from public.session_publications sp
  where sp.session_id = p_session_id
    and sp.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication_operation', spo.operation_id, v_source.id, v_destination.id
  from public.session_publication_operations spo
  where spo.session_id = p_session_id
    and spo.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if p_options->>'participantEntityPolicy' = 'unlink' then
    select count(*)
    into v_participant_unlinks
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'participant_entity_unlink',
      p.id,
      p.character_entity_id,
      v_source.id,
      v_destination.id
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null
    on conflict do nothing;

    update public.participants
    set character_entity_id = null
    where session_id = p_session_id
      and character_entity_id is not null;
  end if;

  if p_options->>'entityMentionPolicy' = 'detach_from_session' then
    select count(*)
    into v_entity_detaches
    from public.entity_mentions em
    where em.session_id = p_session_id;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'entity_mention_detach',
      em.id,
      em.entity_id,
      v_source.id,
      v_destination.id
    from public.entity_mentions em
    where em.session_id = p_session_id
    on conflict do nothing;

    update public.entity_mentions
    set session_id = null
    where session_id = p_session_id;
  end if;

  if p_options->>'canonPolicy' = 'detach_entity_links' then
    if exists (
      select 1
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id
    ) then
      return jsonb_build_object('status', 'blocked');
    end if;

    select count(*)
    into v_canon_detaches
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'canon_candidate_entity_detach', cc.id, v_source.id, v_destination.id
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0
    on conflict do nothing;

    update public.canon_candidates
    set related_entity_ids = null
    where session_id = p_session_id
      and coalesce(cardinality(related_entity_ids), 0) > 0;
  end if;

  if p_options->>'sessionGrantPolicy' in ('preserve', 'revoke') then
    select count(*)
    into v_grant_count
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible');

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      case
        when p_options->>'sessionGrantPolicy' = 'revoke'
          then 'session_grant_revoke'
        else 'session_grant_preserve'
      end,
      ra.id,
      v_source.id,
      v_destination.id
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible')
    on conflict do nothing;

    if p_options->>'sessionGrantPolicy' = 'revoke' then
      update public.role_assignments
      set
        status = 'revoked',
        revoked_by = p_actor_profile_id,
        updated_at = clock_timestamp()
      where scope_type = 'session'
        and scope_id = p_session_id::text
        and status in ('active', 'eligible');
    end if;
  end if;

  if v_session.current_session_publication_id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'active_session_publication_unpublish',
      v_session.current_session_publication_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;
  end if;

  if v_current_draft.id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'editorial_draft_bridge',
      v_current_draft.id,
      v_bridge_draft_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;

    if v_source_asset_id is not null and v_destination_asset_id is not null then
      insert into public.session_campaign_move_artifacts(
        operation_id, artifact_kind, artifact_id, related_artifact_id,
        source_campaign_id, destination_campaign_id
      ) values (
        p_operation_id,
        'session_cover_rehome',
        v_source_asset_id,
        v_destination_asset_id,
        v_source.id,
        v_destination.id
      )
      on conflict do nothing;
    end if;
  end if;

  if v_participant_unlinks > 0
     or v_entity_detaches > 0
     or v_canon_detaches > 0
     or v_grant_count > 0 then
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
      v_destination.id,
      p_session_id,
      p_actor_profile_id,
      'session.campaign.move.reconcile',
      'sessions',
      p_session_id,
      jsonb_build_object(
        'campaignId', v_source.id,
        'participantEntityLinks', v_participant_unlinks,
        'entityMentions', v_entity_detaches,
        'canonCandidateEntityLinks', v_canon_detaches,
        'sessionGrants', v_grant_count
      ),
      jsonb_build_object(
        'campaignId', v_destination.id,
        'participantEntityPolicy', p_options->>'participantEntityPolicy',
        'entityMentionPolicy', p_options->>'entityMentionPolicy',
        'canonPolicy', p_options->>'canonPolicy',
        'sessionGrantPolicy', p_options->>'sessionGrantPolicy'
      )
    );
  end if;

  update public.sessions s
  set
    campaign_id = v_destination.id,
    current_editorial_draft_id = coalesce(v_bridge_draft_id, s.current_editorial_draft_id),
    current_session_publication_id =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then null
        else s.current_session_publication_id
      end,
    status =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then 'approved'
        else s.status
      end,
    metadata =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
        then (coalesce(s.metadata, '{}'::jsonb) - 'coverImageUrl' - 'heroImageUrl')
        else s.metadata
      end,
    updated_at = clock_timestamp()
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    raise exception 'session campaign authority changed while locked';
  end if;

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
    v_destination.id,
    p_session_id,
    p_actor_profile_id,
    'session.campaign.move.v2',
    'sessions',
    p_session_id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', p_source_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'published', v_session.current_session_publication_id is not null or v_session.status = 'published'
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', p_destination_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'publicationPolicy', p_options->>'publishedPolicy',
      'bridgeDraftId', v_bridge_draft_id,
      'contractVersion', 'tda_session_campaign_move_v2'
    )
  );

  return jsonb_build_object(
    'status', 'moved',
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'operationId', p_operation_id,
    'bridgeDraftId', v_bridge_draft_id,
    'publicationState',
      case
        when v_session.current_session_publication_id is not null or v_session.status = 'published'
          then 'unpublished'
        else 'unchanged'
      end
  );
end;
$tda_move$;

comment on function public.session_campaign_move_contract_v2() is
  'Sanitized server-only capability probe for the v2 populated-session move boundary.';
comment on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) is
  'Server-only v2 preflight. Produces a structured migration plan and requires explicit decisions for public/entity/grant boundaries.';
comment on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) is
  'Server-only v2 commit. Revalidates/locks source, preserves immutable history attribution, migrates current transcript ownership, creates a bridge draft, reconciles explicit decisions and commits the session move atomically.';

revoke all on function public.session_campaign_move_set_origin_campaign() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_registry_drift() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_contract_v2() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_decisions(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_options_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_plan_v2(uuid,uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.session_campaign_move_contract_v2() to service_role;
grant execute on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) to service_role;

commit;

         or coalesce(v_prepared->>'width', '') !~ '^[0-9]{1,6}

      select *
      into v_source_media
      from public.media_assets ma
      where ma.id = v_source_asset_id
        and ma.campaign_id = v_source.id
        and ma.role_hint = 'session_cover'
        and ma.status in ('staged', 'verified_public')
        and ma.read_back_verified = true;

      if not found
         or v_source_media.sha256 <> v_prepared->>'sha256'
         or v_source_media.mime_type <> v_prepared->>'mimeType'
         or v_source_media.byte_size <> (v_prepared->>'bytes')::bigint
         or v_source_media.width <> (v_prepared->>'width')::integer
         or v_source_media.height <> (v_prepared->>'height')::integer then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_extension := case when v_source_media.mime_type = 'image/png' then 'png' else 'webp' end;
      v_expected_source_key :=
        'campaigns/' || p_source_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;
      v_expected_destination_key :=
        'campaigns/' || p_destination_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;

      if v_source_media.object_key <> v_expected_source_key
         or v_prepared->>'objectKey' <> v_expected_destination_key then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      select *
      into v_destination_media
      from public.media_assets ma
      where ma.id = v_destination_asset_id;

      if found then
        if v_destination_media.campaign_id <> v_destination.id
           or v_destination_media.role_hint <> 'session_cover'
           or v_destination_media.sha256 <> v_source_media.sha256
           or v_destination_media.mime_type <> v_source_media.mime_type
           or v_destination_media.byte_size <> v_source_media.byte_size
           or v_destination_media.width <> v_source_media.width
           or v_destination_media.height <> v_source_media.height
           or v_destination_media.staged_bucket <> v_prepared->>'stagedBucket'
           or v_destination_media.object_key <> v_expected_destination_key
           or v_destination_media.read_back_verified is not true then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;

        if v_prepared->>'status' = 'verified_public'
           and v_destination_media.status = 'staged' then
          update public.media_assets ma
          set
            status = 'verified_public',
            public_bucket = nullif(v_prepared->>'publicBucket', ''),
            public_object_key = nullif(v_prepared->>'publicObjectKey', ''),
            public_delivery_verified = coalesce(
              (v_prepared->>'publicDeliveryVerified')::boolean,
              false
            ),
            public_verified_at =
              nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'staged'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;
        elsif v_destination_media.status = 'retired' then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      else
        insert into public.media_assets(
          id,
          campaign_id,
          media_kind,
          role_hint,
          status,
          staged_bucket,
          object_key,
          sha256,
          mime_type,
          byte_size,
          width,
          height,
          read_back_verified,
          public_bucket,
          public_object_key,
          public_delivery_verified,
          public_verified_at,
          created_by
        ) values (
          v_destination_asset_id,
          v_destination.id,
          'image',
          'session_cover',
          v_prepared->>'status',
          v_prepared->>'stagedBucket',
          v_prepared->>'objectKey',
          v_prepared->>'sha256',
          v_prepared->>'mimeType',
          (v_prepared->>'bytes')::bigint,
          (v_prepared->>'width')::integer,
          (v_prepared->>'height')::integer,
          true,
          nullif(v_prepared->>'publicBucket', ''),
          nullif(v_prepared->>'publicObjectKey', ''),
          coalesce((v_prepared->>'publicDeliveryVerified')::boolean, false),
          nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
          p_actor_profile_id
        );
      end if;

      if v_prepared->>'status' = 'verified_public' then
        select *
        into v_destination_media
        from public.media_assets ma
        where ma.id = v_destination_asset_id
          and ma.campaign_id = v_destination.id
          and ma.status = 'verified_public'
          and ma.public_bucket = 'tda-media-public'
          and ma.public_object_key = ma.object_key
          and ma.public_delivery_verified = true
          and ma.public_verified_at is not null;

        if not found then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      end if;

      v_bridge_cover := v_destination_asset_id::text;
    elsif v_bridge_cover is not null then
      if p_options->>'legacyCoverPolicy' <> 'clear_current' then
        return jsonb_build_object('status', 'blocked');
      end if;
      v_bridge_cover := null;
    end if;

    select coalesce(max(d.revision), 0) + 1
    into v_bridge_revision
    from public.session_editorial_drafts d
    where d.session_id = p_session_id;

    v_bridge_draft_id := gen_random_uuid();

    insert into public.session_editorial_drafts(
      id,
      campaign_id,
      session_id,
      revision,
      base_transcript_revision_id,
      cover_asset_id,
      arc,
      title,
      summary_short,
      summary_full,
      actor_profile_id,
      created_at,
      session_date,
      session_date_captured
    ) values (
      v_bridge_draft_id,
      v_destination.id,
      p_session_id,
      v_bridge_revision,
      v_current_draft.base_transcript_revision_id,
      v_bridge_cover,
      v_current_draft.arc,
      v_current_draft.title,
      v_current_draft.summary_short,
      v_current_draft.summary_full,
      p_actor_profile_id,
      clock_timestamp(),
      v_current_draft.session_date,
      v_current_draft.session_date_captured
    );
  end if;

  insert into public.session_campaign_move_operations(
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    actor_profile_id,
    contract_version,
    decisions
  ) values (
    p_operation_id,
    p_session_id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_actor_profile_id,
    'tda_session_campaign_move_v2',
    v_decisions
  );

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select
    p_operation_id,
    'transcript_revision',
    tr.id,
    v_source.id,
    v_destination.id
  from public.transcript_revisions tr
  where tr.session_id = p_session_id
    and tr.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_receipt', r.id, v_source.id, v_destination.id
  from public.transcript_publication_receipts r
  where r.session_id = p_session_id
    and r.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_event', e.id, v_source.id, v_destination.id
  from public.transcript_publication_events e
  where e.session_id = p_session_id
    and e.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if to_regclass('public.transcript_assembly_publication_receipts') is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'transcript_assembly_receipt', r.id, v_source.id, v_destination.id
    from public.transcript_assembly_publication_receipts r
    where r.session_id = p_session_id
      and r.campaign_id = v_source.id
    on conflict do nothing;

    update public.transcript_assembly_publication_receipts
    set campaign_id = v_destination.id
    where session_id = p_session_id
      and campaign_id = v_source.id;
  end if;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication', sp.id, v_source.id, v_destination.id
  from public.session_publications sp
  where sp.session_id = p_session_id
    and sp.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication_operation', spo.operation_id, v_source.id, v_destination.id
  from public.session_publication_operations spo
  where spo.session_id = p_session_id
    and spo.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if p_options->>'participantEntityPolicy' = 'unlink' then
    select count(*)
    into v_participant_unlinks
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'participant_entity_unlink',
      p.id,
      p.character_entity_id,
      v_source.id,
      v_destination.id
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null
    on conflict do nothing;

    update public.participants
    set character_entity_id = null
    where session_id = p_session_id
      and character_entity_id is not null;
  end if;

  if p_options->>'entityMentionPolicy' = 'detach_from_session' then
    select count(*)
    into v_entity_detaches
    from public.entity_mentions em
    where em.session_id = p_session_id;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'entity_mention_detach',
      em.id,
      em.entity_id,
      v_source.id,
      v_destination.id
    from public.entity_mentions em
    where em.session_id = p_session_id
    on conflict do nothing;

    update public.entity_mentions
    set session_id = null
    where session_id = p_session_id;
  end if;

  if p_options->>'canonPolicy' = 'detach_entity_links' then
    if exists (
      select 1
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id
    ) then
      return jsonb_build_object('status', 'blocked');
    end if;

    select count(*)
    into v_canon_detaches
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'canon_candidate_entity_detach', cc.id, v_source.id, v_destination.id
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0
    on conflict do nothing;

    update public.canon_candidates
    set related_entity_ids = null
    where session_id = p_session_id
      and coalesce(cardinality(related_entity_ids), 0) > 0;
  end if;

  if p_options->>'sessionGrantPolicy' in ('preserve', 'revoke') then
    select count(*)
    into v_grant_count
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible');

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      case
        when p_options->>'sessionGrantPolicy' = 'revoke'
          then 'session_grant_revoke'
        else 'session_grant_preserve'
      end,
      ra.id,
      v_source.id,
      v_destination.id
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible')
    on conflict do nothing;

    if p_options->>'sessionGrantPolicy' = 'revoke' then
      update public.role_assignments
      set
        status = 'revoked',
        revoked_by = p_actor_profile_id,
        updated_at = clock_timestamp()
      where scope_type = 'session'
        and scope_id = p_session_id::text
        and status in ('active', 'eligible');
    end if;
  end if;

  if v_session.current_session_publication_id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'active_session_publication_unpublish',
      v_session.current_session_publication_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;
  end if;

  if v_current_draft.id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'editorial_draft_bridge',
      v_current_draft.id,
      v_bridge_draft_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;

    if v_source_asset_id is not null and v_destination_asset_id is not null then
      insert into public.session_campaign_move_artifacts(
        operation_id, artifact_kind, artifact_id, related_artifact_id,
        source_campaign_id, destination_campaign_id
      ) values (
        p_operation_id,
        'session_cover_rehome',
        v_source_asset_id,
        v_destination_asset_id,
        v_source.id,
        v_destination.id
      )
      on conflict do nothing;
    end if;
  end if;

  if v_participant_unlinks > 0
     or v_entity_detaches > 0
     or v_canon_detaches > 0
     or v_grant_count > 0 then
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
      v_destination.id,
      p_session_id,
      p_actor_profile_id,
      'session.campaign.move.reconcile',
      'sessions',
      p_session_id,
      jsonb_build_object(
        'campaignId', v_source.id,
        'participantEntityLinks', v_participant_unlinks,
        'entityMentions', v_entity_detaches,
        'canonCandidateEntityLinks', v_canon_detaches,
        'sessionGrants', v_grant_count
      ),
      jsonb_build_object(
        'campaignId', v_destination.id,
        'participantEntityPolicy', p_options->>'participantEntityPolicy',
        'entityMentionPolicy', p_options->>'entityMentionPolicy',
        'canonPolicy', p_options->>'canonPolicy',
        'sessionGrantPolicy', p_options->>'sessionGrantPolicy'
      )
    );
  end if;

  update public.sessions s
  set
    campaign_id = v_destination.id,
    current_editorial_draft_id = coalesce(v_bridge_draft_id, s.current_editorial_draft_id),
    current_session_publication_id =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then null
        else s.current_session_publication_id
      end,
    status =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then 'approved'
        else s.status
      end,
    metadata =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
        then (coalesce(s.metadata, '{}'::jsonb) - 'coverImageUrl' - 'heroImageUrl')
        else s.metadata
      end,
    updated_at = clock_timestamp()
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    raise exception 'session campaign authority changed while locked';
  end if;

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
    v_destination.id,
    p_session_id,
    p_actor_profile_id,
    'session.campaign.move.v2',
    'sessions',
    p_session_id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', p_source_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'published', v_session.current_session_publication_id is not null or v_session.status = 'published'
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', p_destination_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'publicationPolicy', p_options->>'publishedPolicy',
      'bridgeDraftId', v_bridge_draft_id,
      'contractVersion', 'tda_session_campaign_move_v2'
    )
  );

  return jsonb_build_object(
    'status', 'moved',
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'operationId', p_operation_id,
    'bridgeDraftId', v_bridge_draft_id,
    'publicationState',
      case
        when v_session.current_session_publication_id is not null or v_session.status = 'published'
          then 'unpublished'
        else 'unchanged'
      end
  );
end;
$tda_move$;

comment on function public.session_campaign_move_contract_v2() is
  'Sanitized server-only capability probe for the v2 populated-session move boundary.';
comment on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) is
  'Server-only v2 preflight. Produces a structured migration plan and requires explicit decisions for public/entity/grant boundaries.';
comment on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) is
  'Server-only v2 commit. Revalidates/locks source, preserves immutable history attribution, migrates current transcript ownership, creates a bridge draft, reconciles explicit decisions and commits the session move atomically.';

revoke all on function public.session_campaign_move_set_origin_campaign() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_registry_drift() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_contract_v2() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_decisions(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_options_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_plan_v2(uuid,uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.session_campaign_move_contract_v2() to service_role;
grant execute on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) to service_role;

commit;

         or coalesce(v_prepared->>'height', '') !~ '^[0-9]{1,6}

      select *
      into v_source_media
      from public.media_assets ma
      where ma.id = v_source_asset_id
        and ma.campaign_id = v_source.id
        and ma.role_hint = 'session_cover'
        and ma.status in ('staged', 'verified_public')
        and ma.read_back_verified = true;

      if not found
         or v_source_media.sha256 <> v_prepared->>'sha256'
         or v_source_media.mime_type <> v_prepared->>'mimeType'
         or v_source_media.byte_size <> (v_prepared->>'bytes')::bigint
         or v_source_media.width <> (v_prepared->>'width')::integer
         or v_source_media.height <> (v_prepared->>'height')::integer then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_extension := case when v_source_media.mime_type = 'image/png' then 'png' else 'webp' end;
      v_expected_source_key :=
        'campaigns/' || p_source_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;
      v_expected_destination_key :=
        'campaigns/' || p_destination_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;

      if v_source_media.object_key <> v_expected_source_key
         or v_prepared->>'objectKey' <> v_expected_destination_key then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      select *
      into v_destination_media
      from public.media_assets ma
      where ma.id = v_destination_asset_id;

      if found then
        if v_destination_media.campaign_id <> v_destination.id
           or v_destination_media.role_hint <> 'session_cover'
           or v_destination_media.sha256 <> v_source_media.sha256
           or v_destination_media.mime_type <> v_source_media.mime_type
           or v_destination_media.byte_size <> v_source_media.byte_size
           or v_destination_media.width <> v_source_media.width
           or v_destination_media.height <> v_source_media.height
           or v_destination_media.staged_bucket <> v_prepared->>'stagedBucket'
           or v_destination_media.object_key <> v_expected_destination_key
           or v_destination_media.read_back_verified is not true then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;

        if v_prepared->>'status' = 'verified_public'
           and v_destination_media.status = 'staged' then
          update public.media_assets ma
          set
            status = 'verified_public',
            public_bucket = nullif(v_prepared->>'publicBucket', ''),
            public_object_key = nullif(v_prepared->>'publicObjectKey', ''),
            public_delivery_verified = coalesce(
              (v_prepared->>'publicDeliveryVerified')::boolean,
              false
            ),
            public_verified_at =
              nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'staged'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;
        elsif v_destination_media.status = 'retired' then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      else
        insert into public.media_assets(
          id,
          campaign_id,
          media_kind,
          role_hint,
          status,
          staged_bucket,
          object_key,
          sha256,
          mime_type,
          byte_size,
          width,
          height,
          read_back_verified,
          public_bucket,
          public_object_key,
          public_delivery_verified,
          public_verified_at,
          created_by
        ) values (
          v_destination_asset_id,
          v_destination.id,
          'image',
          'session_cover',
          v_prepared->>'status',
          v_prepared->>'stagedBucket',
          v_prepared->>'objectKey',
          v_prepared->>'sha256',
          v_prepared->>'mimeType',
          (v_prepared->>'bytes')::bigint,
          (v_prepared->>'width')::integer,
          (v_prepared->>'height')::integer,
          true,
          nullif(v_prepared->>'publicBucket', ''),
          nullif(v_prepared->>'publicObjectKey', ''),
          coalesce((v_prepared->>'publicDeliveryVerified')::boolean, false),
          nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
          p_actor_profile_id
        );
      end if;

      if v_prepared->>'status' = 'verified_public' then
        select *
        into v_destination_media
        from public.media_assets ma
        where ma.id = v_destination_asset_id
          and ma.campaign_id = v_destination.id
          and ma.status = 'verified_public'
          and ma.public_bucket = 'tda-media-public'
          and ma.public_object_key = ma.object_key
          and ma.public_delivery_verified = true
          and ma.public_verified_at is not null;

        if not found then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      end if;

      v_bridge_cover := v_destination_asset_id::text;
    elsif v_bridge_cover is not null then
      if p_options->>'legacyCoverPolicy' <> 'clear_current' then
        return jsonb_build_object('status', 'blocked');
      end if;
      v_bridge_cover := null;
    end if;

    select coalesce(max(d.revision), 0) + 1
    into v_bridge_revision
    from public.session_editorial_drafts d
    where d.session_id = p_session_id;

    v_bridge_draft_id := gen_random_uuid();

    insert into public.session_editorial_drafts(
      id,
      campaign_id,
      session_id,
      revision,
      base_transcript_revision_id,
      cover_asset_id,
      arc,
      title,
      summary_short,
      summary_full,
      actor_profile_id,
      created_at,
      session_date,
      session_date_captured
    ) values (
      v_bridge_draft_id,
      v_destination.id,
      p_session_id,
      v_bridge_revision,
      v_current_draft.base_transcript_revision_id,
      v_bridge_cover,
      v_current_draft.arc,
      v_current_draft.title,
      v_current_draft.summary_short,
      v_current_draft.summary_full,
      p_actor_profile_id,
      clock_timestamp(),
      v_current_draft.session_date,
      v_current_draft.session_date_captured
    );
  end if;

  insert into public.session_campaign_move_operations(
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    actor_profile_id,
    contract_version,
    decisions
  ) values (
    p_operation_id,
    p_session_id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_actor_profile_id,
    'tda_session_campaign_move_v2',
    v_decisions
  );

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select
    p_operation_id,
    'transcript_revision',
    tr.id,
    v_source.id,
    v_destination.id
  from public.transcript_revisions tr
  where tr.session_id = p_session_id
    and tr.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_receipt', r.id, v_source.id, v_destination.id
  from public.transcript_publication_receipts r
  where r.session_id = p_session_id
    and r.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_event', e.id, v_source.id, v_destination.id
  from public.transcript_publication_events e
  where e.session_id = p_session_id
    and e.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if to_regclass('public.transcript_assembly_publication_receipts') is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'transcript_assembly_receipt', r.id, v_source.id, v_destination.id
    from public.transcript_assembly_publication_receipts r
    where r.session_id = p_session_id
      and r.campaign_id = v_source.id
    on conflict do nothing;

    update public.transcript_assembly_publication_receipts
    set campaign_id = v_destination.id
    where session_id = p_session_id
      and campaign_id = v_source.id;
  end if;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication', sp.id, v_source.id, v_destination.id
  from public.session_publications sp
  where sp.session_id = p_session_id
    and sp.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication_operation', spo.operation_id, v_source.id, v_destination.id
  from public.session_publication_operations spo
  where spo.session_id = p_session_id
    and spo.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if p_options->>'participantEntityPolicy' = 'unlink' then
    select count(*)
    into v_participant_unlinks
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'participant_entity_unlink',
      p.id,
      p.character_entity_id,
      v_source.id,
      v_destination.id
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null
    on conflict do nothing;

    update public.participants
    set character_entity_id = null
    where session_id = p_session_id
      and character_entity_id is not null;
  end if;

  if p_options->>'entityMentionPolicy' = 'detach_from_session' then
    select count(*)
    into v_entity_detaches
    from public.entity_mentions em
    where em.session_id = p_session_id;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'entity_mention_detach',
      em.id,
      em.entity_id,
      v_source.id,
      v_destination.id
    from public.entity_mentions em
    where em.session_id = p_session_id
    on conflict do nothing;

    update public.entity_mentions
    set session_id = null
    where session_id = p_session_id;
  end if;

  if p_options->>'canonPolicy' = 'detach_entity_links' then
    if exists (
      select 1
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id
    ) then
      return jsonb_build_object('status', 'blocked');
    end if;

    select count(*)
    into v_canon_detaches
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'canon_candidate_entity_detach', cc.id, v_source.id, v_destination.id
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0
    on conflict do nothing;

    update public.canon_candidates
    set related_entity_ids = null
    where session_id = p_session_id
      and coalesce(cardinality(related_entity_ids), 0) > 0;
  end if;

  if p_options->>'sessionGrantPolicy' in ('preserve', 'revoke') then
    select count(*)
    into v_grant_count
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible');

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      case
        when p_options->>'sessionGrantPolicy' = 'revoke'
          then 'session_grant_revoke'
        else 'session_grant_preserve'
      end,
      ra.id,
      v_source.id,
      v_destination.id
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible')
    on conflict do nothing;

    if p_options->>'sessionGrantPolicy' = 'revoke' then
      update public.role_assignments
      set
        status = 'revoked',
        revoked_by = p_actor_profile_id,
        updated_at = clock_timestamp()
      where scope_type = 'session'
        and scope_id = p_session_id::text
        and status in ('active', 'eligible');
    end if;
  end if;

  if v_session.current_session_publication_id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'active_session_publication_unpublish',
      v_session.current_session_publication_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;
  end if;

  if v_current_draft.id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'editorial_draft_bridge',
      v_current_draft.id,
      v_bridge_draft_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;

    if v_source_asset_id is not null and v_destination_asset_id is not null then
      insert into public.session_campaign_move_artifacts(
        operation_id, artifact_kind, artifact_id, related_artifact_id,
        source_campaign_id, destination_campaign_id
      ) values (
        p_operation_id,
        'session_cover_rehome',
        v_source_asset_id,
        v_destination_asset_id,
        v_source.id,
        v_destination.id
      )
      on conflict do nothing;
    end if;
  end if;

  if v_participant_unlinks > 0
     or v_entity_detaches > 0
     or v_canon_detaches > 0
     or v_grant_count > 0 then
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
      v_destination.id,
      p_session_id,
      p_actor_profile_id,
      'session.campaign.move.reconcile',
      'sessions',
      p_session_id,
      jsonb_build_object(
        'campaignId', v_source.id,
        'participantEntityLinks', v_participant_unlinks,
        'entityMentions', v_entity_detaches,
        'canonCandidateEntityLinks', v_canon_detaches,
        'sessionGrants', v_grant_count
      ),
      jsonb_build_object(
        'campaignId', v_destination.id,
        'participantEntityPolicy', p_options->>'participantEntityPolicy',
        'entityMentionPolicy', p_options->>'entityMentionPolicy',
        'canonPolicy', p_options->>'canonPolicy',
        'sessionGrantPolicy', p_options->>'sessionGrantPolicy'
      )
    );
  end if;

  update public.sessions s
  set
    campaign_id = v_destination.id,
    current_editorial_draft_id = coalesce(v_bridge_draft_id, s.current_editorial_draft_id),
    current_session_publication_id =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then null
        else s.current_session_publication_id
      end,
    status =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then 'approved'
        else s.status
      end,
    metadata =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
        then (coalesce(s.metadata, '{}'::jsonb) - 'coverImageUrl' - 'heroImageUrl')
        else s.metadata
      end,
    updated_at = clock_timestamp()
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    raise exception 'session campaign authority changed while locked';
  end if;

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
    v_destination.id,
    p_session_id,
    p_actor_profile_id,
    'session.campaign.move.v2',
    'sessions',
    p_session_id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', p_source_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'published', v_session.current_session_publication_id is not null or v_session.status = 'published'
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', p_destination_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'publicationPolicy', p_options->>'publishedPolicy',
      'bridgeDraftId', v_bridge_draft_id,
      'contractVersion', 'tda_session_campaign_move_v2'
    )
  );

  return jsonb_build_object(
    'status', 'moved',
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'operationId', p_operation_id,
    'bridgeDraftId', v_bridge_draft_id,
    'publicationState',
      case
        when v_session.current_session_publication_id is not null or v_session.status = 'published'
          then 'unpublished'
        else 'unchanged'
      end
  );
end;
$tda_move$;

comment on function public.session_campaign_move_contract_v2() is
  'Sanitized server-only capability probe for the v2 populated-session move boundary.';
comment on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) is
  'Server-only v2 preflight. Produces a structured migration plan and requires explicit decisions for public/entity/grant boundaries.';
comment on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) is
  'Server-only v2 commit. Revalidates/locks source, preserves immutable history attribution, migrates current transcript ownership, creates a bridge draft, reconciles explicit decisions and commits the session move atomically.';

revoke all on function public.session_campaign_move_set_origin_campaign() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_registry_drift() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_contract_v2() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_decisions(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_options_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_plan_v2(uuid,uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.session_campaign_move_contract_v2() to service_role;
grant execute on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) to service_role;

commit;
 then
        return jsonb_build_object('status', 'media_prepare_required');
      end if;

      -- A private destination must never gain a newly public session-cover
      -- object as a side effect of moving an already-public source session.
      if v_destination.visibility <> 'public'
         and v_prepared->>'status' = 'verified_public' then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_destination_asset_id := (v_prepared->>'destinationAssetId')::uuid;

      select *
      into v_source_media
      from public.media_assets ma
      where ma.id = v_source_asset_id
        and ma.campaign_id = v_source.id
        and ma.role_hint = 'session_cover'
        and ma.status in ('staged', 'verified_public')
        and ma.read_back_verified = true;

      if not found
         or v_source_media.sha256 <> v_prepared->>'sha256'
         or v_source_media.mime_type <> v_prepared->>'mimeType'
         or v_source_media.byte_size <> (v_prepared->>'bytes')::bigint
         or v_source_media.width <> (v_prepared->>'width')::integer
         or v_source_media.height <> (v_prepared->>'height')::integer then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      v_extension := case when v_source_media.mime_type = 'image/png' then 'png' else 'webp' end;
      v_expected_source_key :=
        'campaigns/' || p_source_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;
      v_expected_destination_key :=
        'campaigns/' || p_destination_campaign_slug || '/sessions/' ||
        lower(p_session_id::text) || '/cover/' || v_source_media.sha256 || '.' || v_extension;

      if v_source_media.object_key <> v_expected_source_key
         or v_prepared->>'objectKey' <> v_expected_destination_key then
        return jsonb_build_object('status', 'media_prepare_stale');
      end if;

      select *
      into v_destination_media
      from public.media_assets ma
      where ma.id = v_destination_asset_id;

      if found then
        if v_destination_media.campaign_id <> v_destination.id
           or v_destination_media.role_hint <> 'session_cover'
           or v_destination_media.sha256 <> v_source_media.sha256
           or v_destination_media.mime_type <> v_source_media.mime_type
           or v_destination_media.byte_size <> v_source_media.byte_size
           or v_destination_media.width <> v_source_media.width
           or v_destination_media.height <> v_source_media.height
           or v_destination_media.staged_bucket <> v_prepared->>'stagedBucket'
           or v_destination_media.object_key <> v_expected_destination_key
           or v_destination_media.read_back_verified is not true then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;

        if v_prepared->>'status' = 'verified_public'
           and v_destination_media.status = 'staged' then
          update public.media_assets ma
          set
            status = 'verified_public',
            public_bucket = nullif(v_prepared->>'publicBucket', ''),
            public_object_key = nullif(v_prepared->>'publicObjectKey', ''),
            public_delivery_verified = coalesce(
              (v_prepared->>'publicDeliveryVerified')::boolean,
              false
            ),
            public_verified_at =
              nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
            updated_at = clock_timestamp()
          where ma.id = v_destination_asset_id
            and ma.campaign_id = v_destination.id
            and ma.status = 'staged'
            and ma.read_back_verified = true;

          if not found then
            return jsonb_build_object('status', 'media_prepare_stale');
          end if;
        elsif v_destination_media.status = 'retired' then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      else
        insert into public.media_assets(
          id,
          campaign_id,
          media_kind,
          role_hint,
          status,
          staged_bucket,
          object_key,
          sha256,
          mime_type,
          byte_size,
          width,
          height,
          read_back_verified,
          public_bucket,
          public_object_key,
          public_delivery_verified,
          public_verified_at,
          created_by
        ) values (
          v_destination_asset_id,
          v_destination.id,
          'image',
          'session_cover',
          v_prepared->>'status',
          v_prepared->>'stagedBucket',
          v_prepared->>'objectKey',
          v_prepared->>'sha256',
          v_prepared->>'mimeType',
          (v_prepared->>'bytes')::bigint,
          (v_prepared->>'width')::integer,
          (v_prepared->>'height')::integer,
          true,
          nullif(v_prepared->>'publicBucket', ''),
          nullif(v_prepared->>'publicObjectKey', ''),
          coalesce((v_prepared->>'publicDeliveryVerified')::boolean, false),
          nullif(v_prepared->>'publicVerifiedAt', '')::timestamptz,
          p_actor_profile_id
        );
      end if;

      if v_prepared->>'status' = 'verified_public' then
        select *
        into v_destination_media
        from public.media_assets ma
        where ma.id = v_destination_asset_id
          and ma.campaign_id = v_destination.id
          and ma.status = 'verified_public'
          and ma.public_bucket = 'tda-media-public'
          and ma.public_object_key = ma.object_key
          and ma.public_delivery_verified = true
          and ma.public_verified_at is not null;

        if not found then
          return jsonb_build_object('status', 'media_prepare_stale');
        end if;
      end if;

      v_bridge_cover := v_destination_asset_id::text;
    elsif v_bridge_cover is not null then
      if p_options->>'legacyCoverPolicy' <> 'clear_current' then
        return jsonb_build_object('status', 'blocked');
      end if;
      v_bridge_cover := null;
    end if;

    select coalesce(max(d.revision), 0) + 1
    into v_bridge_revision
    from public.session_editorial_drafts d
    where d.session_id = p_session_id;

    v_bridge_draft_id := gen_random_uuid();

    insert into public.session_editorial_drafts(
      id,
      campaign_id,
      session_id,
      revision,
      base_transcript_revision_id,
      cover_asset_id,
      arc,
      title,
      summary_short,
      summary_full,
      actor_profile_id,
      created_at,
      session_date,
      session_date_captured
    ) values (
      v_bridge_draft_id,
      v_destination.id,
      p_session_id,
      v_bridge_revision,
      v_current_draft.base_transcript_revision_id,
      v_bridge_cover,
      v_current_draft.arc,
      v_current_draft.title,
      v_current_draft.summary_short,
      v_current_draft.summary_full,
      p_actor_profile_id,
      clock_timestamp(),
      v_current_draft.session_date,
      v_current_draft.session_date_captured
    );
  end if;

  insert into public.session_campaign_move_operations(
    operation_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    source_session_id,
    actor_profile_id,
    contract_version,
    decisions
  ) values (
    p_operation_id,
    p_session_id,
    v_source.id,
    v_destination.id,
    p_source_session_id,
    p_actor_profile_id,
    'tda_session_campaign_move_v2',
    v_decisions
  );

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select
    p_operation_id,
    'transcript_revision',
    tr.id,
    v_source.id,
    v_destination.id
  from public.transcript_revisions tr
  where tr.session_id = p_session_id
    and tr.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_revisions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_receipt', r.id, v_source.id, v_destination.id
  from public.transcript_publication_receipts r
  where r.session_id = p_session_id
    and r.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_receipts
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'transcript_publication_event', e.id, v_source.id, v_destination.id
  from public.transcript_publication_events e
  where e.session_id = p_session_id
    and e.campaign_id = v_source.id
  on conflict do nothing;

  update public.transcript_publication_events
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if to_regclass('public.transcript_assembly_publication_receipts') is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'transcript_assembly_receipt', r.id, v_source.id, v_destination.id
    from public.transcript_assembly_publication_receipts r
    where r.session_id = p_session_id
      and r.campaign_id = v_source.id
    on conflict do nothing;

    update public.transcript_assembly_publication_receipts
    set campaign_id = v_destination.id
    where session_id = p_session_id
      and campaign_id = v_source.id;
  end if;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication', sp.id, v_source.id, v_destination.id
  from public.session_publications sp
  where sp.session_id = p_session_id
    and sp.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publications
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  insert into public.session_campaign_move_artifacts(
    operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
  )
  select p_operation_id, 'session_publication_operation', spo.operation_id, v_source.id, v_destination.id
  from public.session_publication_operations spo
  where spo.session_id = p_session_id
    and spo.campaign_id = v_source.id
  on conflict do nothing;

  update public.session_publication_operations
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.discord_interactions
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  update public.table_notes
  set campaign_id = v_destination.id
  where session_id = p_session_id
    and campaign_id = v_source.id;

  if p_options->>'participantEntityPolicy' = 'unlink' then
    select count(*)
    into v_participant_unlinks
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'participant_entity_unlink',
      p.id,
      p.character_entity_id,
      v_source.id,
      v_destination.id
    from public.participants p
    where p.session_id = p_session_id
      and p.character_entity_id is not null
    on conflict do nothing;

    update public.participants
    set character_entity_id = null
    where session_id = p_session_id
      and character_entity_id is not null;
  end if;

  if p_options->>'entityMentionPolicy' = 'detach_from_session' then
    select count(*)
    into v_entity_detaches
    from public.entity_mentions em
    where em.session_id = p_session_id;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      'entity_mention_detach',
      em.id,
      em.entity_id,
      v_source.id,
      v_destination.id
    from public.entity_mentions em
    where em.session_id = p_session_id
    on conflict do nothing;

    update public.entity_mentions
    set session_id = null
    where session_id = p_session_id;
  end if;

  if p_options->>'canonPolicy' = 'detach_entity_links' then
    if exists (
      select 1
      from public.canon_entries ce
      join public.canon_candidates cc on cc.id = ce.source_candidate_id
      where cc.session_id = p_session_id
    ) then
      return jsonb_build_object('status', 'blocked');
    end if;

    select count(*)
    into v_canon_detaches
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0;

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select p_operation_id, 'canon_candidate_entity_detach', cc.id, v_source.id, v_destination.id
    from public.canon_candidates cc
    where cc.session_id = p_session_id
      and coalesce(cardinality(cc.related_entity_ids), 0) > 0
    on conflict do nothing;

    update public.canon_candidates
    set related_entity_ids = null
    where session_id = p_session_id
      and coalesce(cardinality(related_entity_ids), 0) > 0;
  end if;

  if p_options->>'sessionGrantPolicy' in ('preserve', 'revoke') then
    select count(*)
    into v_grant_count
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible');

    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    )
    select
      p_operation_id,
      case
        when p_options->>'sessionGrantPolicy' = 'revoke'
          then 'session_grant_revoke'
        else 'session_grant_preserve'
      end,
      ra.id,
      v_source.id,
      v_destination.id
    from public.role_assignments ra
    where ra.scope_type = 'session'
      and ra.scope_id = p_session_id::text
      and ra.status in ('active', 'eligible')
    on conflict do nothing;

    if p_options->>'sessionGrantPolicy' = 'revoke' then
      update public.role_assignments
      set
        status = 'revoked',
        revoked_by = p_actor_profile_id,
        updated_at = clock_timestamp()
      where scope_type = 'session'
        and scope_id = p_session_id::text
        and status in ('active', 'eligible');
    end if;
  end if;

  if v_session.current_session_publication_id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'active_session_publication_unpublish',
      v_session.current_session_publication_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;
  end if;

  if v_current_draft.id is not null then
    insert into public.session_campaign_move_artifacts(
      operation_id, artifact_kind, artifact_id, related_artifact_id,
      source_campaign_id, destination_campaign_id
    ) values (
      p_operation_id,
      'editorial_draft_bridge',
      v_current_draft.id,
      v_bridge_draft_id,
      v_source.id,
      v_destination.id
    )
    on conflict do nothing;

    if v_source_asset_id is not null and v_destination_asset_id is not null then
      insert into public.session_campaign_move_artifacts(
        operation_id, artifact_kind, artifact_id, related_artifact_id,
        source_campaign_id, destination_campaign_id
      ) values (
        p_operation_id,
        'session_cover_rehome',
        v_source_asset_id,
        v_destination_asset_id,
        v_source.id,
        v_destination.id
      )
      on conflict do nothing;
    end if;
  end if;

  if v_participant_unlinks > 0
     or v_entity_detaches > 0
     or v_canon_detaches > 0
     or v_grant_count > 0 then
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
      v_destination.id,
      p_session_id,
      p_actor_profile_id,
      'session.campaign.move.reconcile',
      'sessions',
      p_session_id,
      jsonb_build_object(
        'campaignId', v_source.id,
        'participantEntityLinks', v_participant_unlinks,
        'entityMentions', v_entity_detaches,
        'canonCandidateEntityLinks', v_canon_detaches,
        'sessionGrants', v_grant_count
      ),
      jsonb_build_object(
        'campaignId', v_destination.id,
        'participantEntityPolicy', p_options->>'participantEntityPolicy',
        'entityMentionPolicy', p_options->>'entityMentionPolicy',
        'canonPolicy', p_options->>'canonPolicy',
        'sessionGrantPolicy', p_options->>'sessionGrantPolicy'
      )
    );
  end if;

  update public.sessions s
  set
    campaign_id = v_destination.id,
    current_editorial_draft_id = coalesce(v_bridge_draft_id, s.current_editorial_draft_id),
    current_session_publication_id =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then null
        else s.current_session_publication_id
      end,
    status =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
          then 'approved'
        else s.status
      end,
    metadata =
      case
        when s.current_session_publication_id is not null or s.status = 'published'
        then (coalesce(s.metadata, '{}'::jsonb) - 'coverImageUrl' - 'heroImageUrl')
        else s.metadata
      end,
    updated_at = clock_timestamp()
  where s.id = p_session_id
    and s.campaign_id = v_source.id
    and s.source_session_id = p_source_session_id;

  if not found then
    raise exception 'session campaign authority changed while locked';
  end if;

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
    v_destination.id,
    p_session_id,
    p_actor_profile_id,
    'session.campaign.move.v2',
    'sessions',
    p_session_id,
    jsonb_build_object(
      'campaignId', v_source.id,
      'campaignSlug', p_source_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'published', v_session.current_session_publication_id is not null or v_session.status = 'published'
    ),
    jsonb_build_object(
      'campaignId', v_destination.id,
      'campaignSlug', p_destination_campaign_slug,
      'sourceSessionId', p_source_session_id,
      'publicationPolicy', p_options->>'publishedPolicy',
      'bridgeDraftId', v_bridge_draft_id,
      'contractVersion', 'tda_session_campaign_move_v2'
    )
  );

  return jsonb_build_object(
    'status', 'moved',
    'contractVersion', 'tda_session_campaign_move_v2',
    'sessionId', p_session_id,
    'sourceSessionId', p_source_session_id,
    'sourceCampaignSlug', p_source_campaign_slug,
    'destinationCampaignSlug', p_destination_campaign_slug,
    'operationId', p_operation_id,
    'bridgeDraftId', v_bridge_draft_id,
    'publicationState',
      case
        when v_session.current_session_publication_id is not null or v_session.status = 'published'
          then 'unpublished'
        else 'unchanged'
      end
  );
end;
$tda_move$;

comment on function public.session_campaign_move_contract_v2() is
  'Sanitized server-only capability probe for the v2 populated-session move boundary.';
comment on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) is
  'Server-only v2 preflight. Produces a structured migration plan and requires explicit decisions for public/entity/grant boundaries.';
comment on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) is
  'Server-only v2 commit. Revalidates/locks source, preserves immutable history attribution, migrates current transcript ownership, creates a bridge draft, reconciles explicit decisions and commits the session move atomically.';

revoke all on function public.session_campaign_move_set_origin_campaign() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_registry_drift() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_contract_v2() from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_decisions(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_options_valid(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.session_campaign_move_plan_v2(uuid,uuid,uuid,text,text,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) from public, anon, authenticated, service_role;

grant execute on function public.session_campaign_move_contract_v2() to service_role;
grant execute on function public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
grant execute on function public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb) to service_role;

commit;
