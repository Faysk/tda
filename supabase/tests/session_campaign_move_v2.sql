-- Assertions for #1454 populated session campaign move v2.

do $tda_move_v2_contract$
declare
  v jsonb;
begin
  v := public.session_campaign_move_contract_v2();
  if v->>'contractVersion' <> 'tda_session_campaign_move_v2'
     or (v->>'registryComplete')::boolean is not true
     or (v->>'supportsPopulatedSessions')::boolean is not true
     or v->>'publicationPolicy' <> 'explicit_unpublish' then
    raise exception 'v2 move contract is not ready: %', v;
  end if;

  if has_function_privilege(
      'anon',
      'public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb)',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb)',
      'execute'
    )
    or has_function_privilege(
      'anon',
      'public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb)',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb)',
      'execute'
    ) then
    raise exception 'browser roles can execute the v2 move boundary';
  end if;

  if not has_function_privilege(
      'service_role',
      'public.session_campaign_move_contract_v2()',
      'execute'
    )
    or not has_function_privilege(
      'service_role',
      'public.preflight_session_campaign_move_v2(uuid,uuid,text,text,uuid,text,jsonb)',
      'execute'
    )
    or not has_function_privilege(
      'service_role',
      'public.move_session_campaign_atomic_v2(uuid,uuid,text,text,uuid,text,uuid,jsonb)',
      'execute'
    ) then
    raise exception 'service role cannot execute the v2 move boundary';
  end if;

  if has_table_privilege(
      'anon',
      'public.session_campaign_move_media_preparations',
      'select'
    )
    or has_table_privilege(
      'authenticated',
      'public.session_campaign_move_media_preparations',
      'select'
    )
    or not has_table_privilege(
      'service_role',
      'public.session_campaign_move_media_preparations',
      'select'
    )
    or not has_table_privilege(
      'service_role',
      'public.session_campaign_move_media_preparations',
      'insert'
    )
    or has_table_privilege(
      'service_role',
      'public.session_campaign_move_media_preparations',
      'update'
    )
    or has_table_privilege(
      'service_role',
      'public.session_campaign_move_media_preparations',
      'delete'
    ) then
    raise exception 'media preparation receipt privileges are not select+insert server-only';
  end if;
end
$tda_move_v2_contract$;

do $tda_move_v2_populated$
declare
  v jsonb;
  v_source uuid;
  v_destination uuid;
  v_bridge uuid;
  v_old_draft uuid := '52000000-0000-4000-8000-000000000021';
  v_current_revision uuid := '51000000-0000-4000-8000-000000000021';
begin
  select id into strict v_source
  from public.campaigns where slug='yuhara-main';
  select id into strict v_destination
  from public.campaigns where slug='antes-que-seja-tarde';

  v := public.preflight_session_campaign_move_v2(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000020',
    'move-populated',
    '{}'::jsonb
  );

  if v->>'status' <> 'blocked'
     or not (v->'blockers' @> '[{"code":"active_publication"}]'::jsonb)
     or not exists (
       select 1
       from jsonb_array_elements(v->'planItems') item
       where item->>'code'='current_draft_cover'
         and item->>'classification'='external_prepare'
     )
     or not exists (
       select 1
       from jsonb_array_elements(v->'planItems') item
       where item->>'code'='current_editorial_draft_bridge'
         and item->>'classification'='auto'
     ) then
    raise exception 'populated preflight did not expose the expected plan: %', v;
  end if;

  v := public.preflight_session_campaign_move_v2(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000020',
    'move-populated',
    '{"publishedPolicy":"unpublish"}'::jsonb
  );
  if v->>'status' <> 'ready' then
    raise exception 'populated session should be ready after explicit unpublish decision: %', v;
  end if;

  v := public.move_session_campaign_atomic_v2(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000020',
    'move-populated',
    '61000000-0000-4000-8000-000000000020',
    jsonb_build_object(
      'publishedPolicy','unpublish',
      'preparedCover',jsonb_build_object(
        'sourceAssetId','54000000-0000-4000-8000-000000000020',
        'destinationAssetId','54000000-0000-4000-8000-000000000021',
        'sha256',repeat('a',64),
        'mimeType','image/webp',
        'status','staged',
        'stagedBucket','tda-media-private',
        'objectKey',
          'campaigns/antes-que-seja-tarde/sessions/41000000-0000-4000-8000-000000000020/cover/' ||
          repeat('a',64) || '.webp',
        'bytes','128',
        'width','16',
        'height','8',
        'publicBucket',null,
        'publicObjectKey',null,
        'publicDeliveryVerified',false,
        'publicVerifiedAt',null
      )
    )
  ); 

  if v->>'status' <> 'media_prepare_required' then
    raise exception 'prepared cover without a durable receipt did not fail closed: %', v;
  end if;

  insert into public.session_campaign_move_media_preparations(
    operation_id,
    source_asset_id,
    destination_asset_id,
    session_id,
    source_campaign_id,
    destination_campaign_id,
    actor_profile_id,
    source_object_key,
    destination_object_key,
    sha256,
    mime_type,
    byte_size,
    width,
    height,
    status,
    staged_bucket,
    public_bucket,
    public_object_key,
    public_delivery_verified,
    public_verified_at
  ) values (
    '61000000-0000-4000-8000-000000000020',
    '54000000-0000-4000-8000-000000000020',
    '54000000-0000-4000-8000-000000000021',
    '41000000-0000-4000-8000-000000000020',
    v_source,
    v_destination,
    '30000000-0000-4000-8000-000000000006',
    'campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000020/cover/' ||
      repeat('a',64) || '.webp',
    'campaigns/antes-que-seja-tarde/sessions/41000000-0000-4000-8000-000000000020/cover/' ||
      repeat('a',64) || '.webp',
    repeat('a',64),
    'image/webp',
    128,
    16,
    8,
    'staged',
    'tda-media-private',
    null,
    null,
    false,
    null
  );

    v := public.move_session_campaign_atomic_v2(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000020',
    'move-populated',
    '61000000-0000-4000-8000-000000000020',
    jsonb_build_object(
      'publishedPolicy','unpublish',
      'preparedCover',jsonb_build_object(
        'sourceAssetId','54000000-0000-4000-8000-000000000020',
        'destinationAssetId','54000000-0000-4000-8000-000000000021',
        'sha256',repeat('a',64),
        'mimeType','image/webp',
        'status','staged',
        'stagedBucket','tda-media-private',
        'objectKey',
          'campaigns/antes-que-seja-tarde/sessions/41000000-0000-4000-8000-000000000020/cover/' ||
          repeat('a',64) || '.webp',
        'bytes','128',
        'width','16',
        'height','8',
        'publicBucket',null,
        'publicObjectKey',null,
        'publicDeliveryVerified',false,
        'publicVerifiedAt',null
      )
    )
  );

  if v->>'status' <> 'moved'

  if v->>'status' <> 'moved'
     or v->>'publicationState' <> 'unpublished'
     or v->>'contractVersion' <> 'tda_session_campaign_move_v2' then
    raise exception 'populated move did not commit: %', v;
  end if;

  select current_editorial_draft_id
  into strict v_bridge
  from public.sessions
  where id='41000000-0000-4000-8000-000000000020'
    and campaign_id=v_destination
    and status='approved'
    and current_session_publication_id is null
    and current_transcript_revision_id=v_current_revision
    and not (metadata ? 'coverImageUrl')
    and not (metadata ? 'heroImageUrl');

  if v_bridge is null or v_bridge=v_old_draft then
    raise exception 'destination bridge draft was not activated';
  end if;

  if not exists (
    select 1
    from public.session_editorial_drafts d
    where d.id=v_old_draft
      and d.campaign_id=v_source
      and d.origin_campaign_id=v_source
      and d.cover_asset_id='54000000-0000-4000-8000-000000000020'
  ) then
    raise exception 'historical source draft was mutated';
  end if;

  if not exists (
    select 1
    from public.session_editorial_drafts d
    where d.id=v_bridge
      and d.campaign_id=v_destination
      and d.origin_campaign_id=v_destination
      and d.revision=3
      and d.base_transcript_revision_id=v_current_revision
      and d.cover_asset_id='54000000-0000-4000-8000-000000000021'
  ) then
    raise exception 'bridge draft does not preserve current editorial state';
  end if;

  if (
    select count(*)
    from public.transcript_revisions tr
    where tr.session_id='41000000-0000-4000-8000-000000000020'
      and tr.campaign_id=v_destination
      and tr.origin_campaign_id=v_source
  ) <> 2 then
    raise exception 'transcript lineage did not move with source attribution';
  end if;

  if not exists (
    select 1
    from public.transcript_revisions tr
    where tr.id='51000000-0000-4000-8000-000000000021'
      and tr.parent_revision_id='51000000-0000-4000-8000-000000000020'
  ) then
    raise exception 'transcript parent lineage changed';
  end if;

  if not exists (
    select 1
    from public.session_publications sp
    where sp.id='53000000-0000-4000-8000-000000000020'
      and sp.campaign_id=v_destination
      and sp.origin_campaign_id=v_source
  ) or not exists (
    select 1
    from public.session_publication_operations spo
    where spo.operation_id='55000000-0000-4000-8000-000000000020'
      and spo.campaign_id=v_destination
      and spo.origin_campaign_id=v_source
  ) then
    raise exception 'publication history ownership/attribution is inconsistent';
  end if;

  if not exists (
    select 1
    from public.media_assets ma
    where ma.id='54000000-0000-4000-8000-000000000021'
      and ma.campaign_id=v_destination
      and ma.role_hint='session_cover'
      and ma.status='staged'
      and ma.read_back_verified
      and ma.public_bucket is null
      and ma.public_object_key is null
      and ma.public_delivery_verified is false
      and ma.public_verified_at is null
  ) then
    raise exception 'private destination cover was not staged without public delivery';
  end if;

  if not exists (
    select 1
    from public.session_campaign_move_media_preparations prep
    where prep.operation_id='61000000-0000-4000-8000-000000000020'
      and prep.source_asset_id='54000000-0000-4000-8000-000000000020'
      and prep.destination_asset_id='54000000-0000-4000-8000-000000000021'
      and prep.session_id='41000000-0000-4000-8000-000000000020'
      and prep.source_campaign_id=v_source
      and prep.destination_campaign_id=v_destination
      and prep.status='staged'
      and prep.public_object_key is null
  ) then
    raise exception 'durable media preparation receipt was not preserved';
  end if;

  if (
    select count(*)
    from public.session_campaign_move_artifacts a
    where a.operation_id='61000000-0000-4000-8000-000000000020'
  ) < 8 then
    raise exception 'move lineage receipt is unexpectedly incomplete';
  end if;

  if exists (
    select 1
    from public.audit_log a
    where a.action='session.campaign.move.v2'
      and a.session_id='41000000-0000-4000-8000-000000000020'
      and (
        coalesce(a.old_value::text,'') ilike '%full%'
        or coalesce(a.new_value::text,'') ilike '%full%'
        or coalesce(a.old_value::text,'') ilike '%transcript%'
      )
  ) then
    raise exception 'move audit contains narrative-shaped payload';
  end if;

  v := public.move_session_campaign_atomic_v2(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000020',
    'move-populated',
    '61000000-0000-4000-8000-000000000020',
    '{"publishedPolicy":"unpublish"}'::jsonb
  );
  if v->>'status' <> 'replay' then
    raise exception 'lost-response replay did not recover populated move: %', v;
  end if;

  v := public.move_session_campaign_atomic_v2(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000020',
    'move-populated',
    '61000000-0000-4000-8000-000000000020',
    '{"publishedPolicy":"unpublish","sessionGrantPolicy":"preserve"}'::jsonb
  );
  if v->>'status' <> 'operation_conflict' then
    raise exception 'same operation id accepted a different decision set: %', v;
  end if;
end
$tda_move_v2_populated$;

do $tda_move_v2_manual$
declare
  v jsonb;
  v_destination uuid;
begin
  v := public.preflight_session_campaign_move_v2(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000021',
    'move-manual',
    '{}'::jsonb
  );
  if v->>'status' <> 'blocked'
     or not (v->'blockers' @> '[{"code":"participant_entity_links"}]'::jsonb)
     or not (v->'blockers' @> '[{"code":"entity_mentions"}]'::jsonb)
     or not (v->'blockers' @> '[{"code":"canon_candidate_entity_links"}]'::jsonb)
     or not (v->'blockers' @> '[{"code":"session_scoped_grants"}]'::jsonb) then
    raise exception 'manual reconciliation plan is incomplete: %', v;
  end if;

  v := public.preflight_session_campaign_move_v2(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000021',
    'move-manual',
    '{
      "participantEntityPolicy":"unlink",
      "entityMentionPolicy":"detach_from_session",
      "canonPolicy":"detach_entity_links",
      "sessionGrantPolicy":"preserve"
    }'::jsonb
  );
  if v->>'status' <> 'ready' then
    raise exception 'explicit reconciliation should make manual session ready: %', v;
  end if;

  v := public.move_session_campaign_atomic_v2(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000021',
    'move-manual',
    '61000000-0000-4000-8000-000000000021',
    '{
      "participantEntityPolicy":"unlink",
      "entityMentionPolicy":"detach_from_session",
      "canonPolicy":"detach_entity_links",
      "sessionGrantPolicy":"preserve"
    }'::jsonb
  );
  if v->>'status' <> 'moved' then
    raise exception 'manual reconciliation move failed: %', v;
  end if;

  select id into strict v_destination
  from public.campaigns where slug='antes-que-seja-tarde';

  if not exists (
    select 1 from public.sessions
    where id='41000000-0000-4000-8000-000000000021'
      and campaign_id=v_destination
  ) then
    raise exception 'manual session did not move';
  end if;

  if exists (
    select 1 from public.participants
    where session_id='41000000-0000-4000-8000-000000000021'
      and character_entity_id is not null
  ) then
    raise exception 'participant entity link was not explicitly removed';
  end if;

  if exists (
    select 1 from public.entity_mentions
    where session_id='41000000-0000-4000-8000-000000000021'
  ) then
    raise exception 'entity mentions were not detached from the moved session';
  end if;

  if exists (
    select 1 from public.canon_candidates
    where session_id='41000000-0000-4000-8000-000000000021'
      and coalesce(cardinality(related_entity_ids),0)>0
  ) then
    raise exception 'canon candidate entity links were not detached';
  end if;

  if not exists (
    select 1 from public.role_assignments
    where scope_type='session'
      and scope_id='41000000-0000-4000-8000-000000000021'
      and status='active'
  ) then
    raise exception 'preserve grant policy unexpectedly revoked the grant';
  end if;
end
$tda_move_v2_manual$;

do $tda_move_v2_canon_hard$
declare
  v jsonb;
begin
  v := public.preflight_session_campaign_move_v2(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000022',
    'move-canon-hard',
    '{"canonPolicy":"detach_entity_links"}'::jsonb
  );
  if v->>'status' <> 'blocked'
     or not (v->'blockers' @> '[{"code":"canon_entries_from_session"}]'::jsonb) then
    raise exception 'materialized canon must remain a hard blocker: %', v;
  end if;
end
$tda_move_v2_canon_hard$;

do $tda_move_v2_drift$
declare
  v jsonb;
begin
  create table public.synthetic_unclassified_session_dependency (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.sessions(id)
  );

  v := public.session_campaign_move_contract_v2();
  if (v->>'registryComplete')::boolean is true then
    raise exception 'unclassified session FK did not break registry readiness: %', v;
  end if;

  v := public.preflight_session_campaign_move_v2(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000012',
    'move-concurrent',
    '{}'::jsonb
  );
  if v->>'status' <> 'blocked'
     or not (v->'blockers' @> '[{"code":"dependency_registry_drift"}]'::jsonb) then
    raise exception 'registry drift did not fail preflight closed: %', v;
  end if;

  drop table public.synthetic_unclassified_session_dependency;

  v := public.session_campaign_move_contract_v2();
  if (v->>'registryComplete')::boolean is not true then
    raise exception 'registry did not recover after synthetic drift was removed: %', v;
  end if;
end
$tda_move_v2_drift$;

select 'SESSION_CAMPAIGN_MOVE_V2_SQL_OK';
