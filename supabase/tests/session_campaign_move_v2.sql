-- Assertions for #1454-#1462 session campaign move v2.

do $tda_move_v2_contract$
declare
  v jsonb;
begin
  v := public.session_campaign_move_contract();
  if (v->>'version')::integer <> 2
     or not (v->'features' ? 'dependency_registry')
     or not (v->'features' ? 'media_prepare_commit') then
    raise exception 'v2 contract descriptor is incomplete: %', v;
  end if;

  if jsonb_array_length(public.session_campaign_move_registry_drift()) <> 0 then
    raise exception 'fixture has unclassified session relations: %',
      public.session_campaign_move_registry_drift();
  end if;

  create table public.synthetic_unclassified_session_child(
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.sessions(id)
  );
  if not (
    public.session_campaign_move_registry_drift()
    @> '[{"code":"unclassified_session_relation","relation":"public.synthetic_unclassified_session_child"}]'::jsonb
  ) then
    raise exception 'registry drift guard did not detect a new direct session relation';
  end if;
  drop table public.synthetic_unclassified_session_child;
end
$tda_move_v2_contract$;

do $tda_move_v2_private$
declare
  v jsonb;
  v_source uuid;
  v_destination uuid;
  v_hash_before text;
begin
  select id into strict v_source
  from public.campaigns where slug='yuhara-main';
  select id into strict v_destination
  from public.campaigns where slug='antes-que-seja-tarde';

  v := public.preflight_session_campaign_move(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000020',
    'move-populated-v2'
  );
  if v->>'status' <> 'ready'
     or (v->>'contractVersion')::integer <> 2
     or not (v->'plan' @> '[{"family":"participant_entity_links","classification":"decision","action":"unlink_participant_entities"}]'::jsonb)
     or not (v->'plan' @> '[{"family":"session_scoped_grants","classification":"decision","action":"revoke_session_grants"}]'::jsonb)
     or not (v->'plan' @> '[{"family":"session_cover_assets","classification":"external_prepare"}]'::jsonb)
     or jsonb_array_length(v->'blockers') <> 0 then
    raise exception 'populated preflight did not produce actionable plan: %', v;
  end if;

  v := public.move_session_campaign_v2_atomic(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000020',
    'move-populated-v2',
    '61000000-0000-4000-8000-000000000020',
    '{}'::jsonb
  );
  if v->>'status' <> 'decision_required'
     or v->>'decision' <> 'unlink_participant_entities' then
    raise exception 'missing participant decision was not rejected: %', v;
  end if;

  v := public.move_session_campaign_v2_atomic(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000020',
    'move-populated-v2',
    '61000000-0000-4000-8000-000000000020',
    '{"unlinkParticipantEntities":true,"revokeSessionGrants":true}'::jsonb
  );
  if v->>'status' <> 'preparation_required' then
    raise exception 'missing media preparation was not rejected: %', v;
  end if;

  insert into public.session_campaign_move_media_preparations(
    operation_id,asset_id,session_id,source_campaign_id,destination_campaign_id,
    source_object_key,destination_object_key,sha256,staged_bucket
  ) values (
    '61000000-0000-4000-8000-000000000020',
    '54000000-0000-4000-8000-000000000020',
    '41000000-0000-4000-8000-000000000020',
    v_source,
    v_destination,
    'campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000020/cover/' || repeat('c',64) || '.webp',
    'campaigns/antes-que-seja-tarde/sessions/41000000-0000-4000-8000-000000000020/cover/' || repeat('c',64) || '.webp',
    repeat('c',64),
    'tda-media-preview'
  );

  select payload_sha256 into strict v_hash_before
  from public.transcript_revisions
  where id='51000000-0000-4000-8000-000000000021';

  v := public.move_session_campaign_v2_atomic(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000020',
    'move-populated-v2',
    '61000000-0000-4000-8000-000000000020',
    '{"unlinkParticipantEntities":true,"revokeSessionGrants":true}'::jsonb
  );
  if v->>'status' <> 'moved' then
    raise exception 'populated v2 move failed: %', v;
  end if;

  if not exists (
    select 1 from public.sessions
    where id='41000000-0000-4000-8000-000000000020'
      and campaign_id=v_destination
      and current_transcript_revision_id='51000000-0000-4000-8000-000000000021'
      and current_editorial_draft_id='52000000-0000-4000-8000-000000000021'
  ) then
    raise exception 'session ownership/current pointers did not survive move';
  end if;

  if (
    select count(*) from public.transcript_revisions
    where session_id='41000000-0000-4000-8000-000000000020'
      and campaign_id=v_destination
  ) <> 2 then
    raise exception 'transcript revision lineage did not move';
  end if;

  if (
    select payload_sha256 from public.transcript_revisions
    where id='51000000-0000-4000-8000-000000000021'
  ) is distinct from v_hash_before then
    raise exception 'immutable transcript hash changed during move';
  end if;

  if (
    select count(*) from public.session_editorial_drafts
    where session_id='41000000-0000-4000-8000-000000000020'
      and campaign_id=v_destination
  ) <> 2 then
    raise exception 'all editorial drafts did not move';
  end if;

  if exists (
    select 1 from public.participants
    where session_id='41000000-0000-4000-8000-000000000020'
      and character_entity_id is not null
  ) then
    raise exception 'explicit participant unlink was not applied';
  end if;

  if not exists (
    select 1 from public.role_assignments
    where scope_type='session'
      and scope_id='41000000-0000-4000-8000-000000000020'
      and status='revoked'
      and revoked_by='30000000-0000-4000-8000-000000000006'
  ) then
    raise exception 'explicit session grant revoke was not audited on assignment';
  end if;

  if not exists (
    select 1 from public.media_assets
    where id='54000000-0000-4000-8000-000000000020'
      and campaign_id=v_destination
      and object_key like 'campaigns/antes-que-seja-tarde/sessions/%'
  ) then
    raise exception 'prepared cover ownership/key did not commit';
  end if;

  if not exists (
    select 1 from public.audit_log
    where action='synthetic.before_move'
      and session_id='41000000-0000-4000-8000-000000000020'
      and campaign_id=v_source
  ) then
    raise exception 'historical audit attribution was rewritten';
  end if;

  if not exists (
    select 1 from public.ai_usage_ledger
    where session_id='41000000-0000-4000-8000-000000000020'
      and campaign_id=v_source
  ) then
    raise exception 'historical AI ledger attribution was rewritten';
  end if;

  if not exists (
    select 1 from public.session_campaign_move_operations
    where operation_id='61000000-0000-4000-8000-000000000020'
      and contract_version=2
      and decision_summary->>'unlinkParticipantEntities'='true'
      and decision_summary->>'revokeSessionGrants'='true'
  ) then
    raise exception 'v2 durable receipt missing';
  end if;

  v := public.move_session_campaign_v2_atomic(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000020',
    'move-populated-v2',
    '61000000-0000-4000-8000-000000000020',
    '{"unlinkParticipantEntities":true,"revokeSessionGrants":true}'::jsonb
  );
  if v->>'status' <> 'replay' then
    raise exception 'v2 replay was not idempotent: %', v;
  end if;
end
$tda_move_v2_private$;

do $tda_move_v2_published$
declare
  v jsonb;
  v_source uuid;
  v_destination uuid;
  v_payload text;
  v_cover text;
begin
  select id into strict v_source from public.campaigns where slug='yuhara-main';
  select id into strict v_destination from public.campaigns where slug='antes-que-seja-tarde';

  select payload_sha256, cover_url
  into strict v_payload, v_cover
  from public.session_publications
  where id='53000000-0000-4000-8000-000000000021';

  -- Destination is private in the registry fixture. Prepare only the staged
  -- immutable object; the DB commit must demote the old verified-public asset
  -- and remove public session media pointers.
  insert into public.session_campaign_move_media_preparations(
    operation_id,asset_id,session_id,source_campaign_id,destination_campaign_id,
    source_object_key,destination_object_key,sha256,staged_bucket
  ) values (
    '61000000-0000-4000-8000-000000000021',
    '54000000-0000-4000-8000-000000000021',
    '41000000-0000-4000-8000-000000000021',
    v_source,
    v_destination,
    'campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000021/cover/' || repeat('e',64) || '.webp',
    'campaigns/antes-que-seja-tarde/sessions/41000000-0000-4000-8000-000000000021/cover/' || repeat('e',64) || '.webp',
    repeat('e',64),
    'tda-media-preview'
  );

  v := public.move_session_campaign_v2_atomic(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000021',
    'move-published-v2',
    '61000000-0000-4000-8000-000000000021',
    '{}'::jsonb
  );
  if v->>'status' <> 'moved' then
    raise exception 'published -> private v2 move failed: %', v;
  end if;

  if not exists (
    select 1 from public.sessions
    where id='41000000-0000-4000-8000-000000000021'
      and campaign_id=v_destination
      and status='published'
      and current_session_publication_id='53000000-0000-4000-8000-000000000021'
      and metadata->>'coverImageUrl' is null
      and metadata->>'heroImageUrl' is null
  ) then
    raise exception 'private destination retained public session media pointers';
  end if;

  if not exists (
    select 1 from public.media_assets
    where id='54000000-0000-4000-8000-000000000021'
      and campaign_id=v_destination
      and status='staged'
      and public_bucket is null
      and public_object_key is null
      and public_delivery_verified=false
      and public_verified_at is null
  ) then
    raise exception 'verified-public asset was not demoted for private destination';
  end if;

  if not exists (
    select 1 from public.session_publications
    where id='53000000-0000-4000-8000-000000000021'
      and campaign_id=v_destination
      and payload_sha256=v_payload
      and cover_url=v_cover
  ) then
    raise exception 'published snapshot content/hash was regenerated during private ownership transfer';
  end if;

  if not exists (
    select 1 from public.session_publication_operations
    where operation_id='56000000-0000-4000-8000-000000000021'
      and campaign_id=v_destination
  ) then
    raise exception 'publication operation ownership did not follow private transfer';
  end if;

  -- Move the same session back to the public historical campaign. This proves
  -- that a public destination can restore a verified public delivery while the
  -- immutable publication snapshot/hash stays untouched.
  insert into public.session_campaign_move_media_preparations(
    operation_id,asset_id,session_id,source_campaign_id,destination_campaign_id,
    source_object_key,destination_object_key,sha256,staged_bucket,
    destination_public_object_key,destination_public_url,public_verified_at
  ) values (
    '61000000-0000-4000-8000-000000000022',
    '54000000-0000-4000-8000-000000000021',
    '41000000-0000-4000-8000-000000000021',
    v_destination,
    v_source,
    'campaigns/antes-que-seja-tarde/sessions/41000000-0000-4000-8000-000000000021/cover/' || repeat('e',64) || '.webp',
    'campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000021/cover/' || repeat('e',64) || '.webp',
    repeat('e',64),
    'tda-media-preview',
    'campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000021/cover/' || repeat('e',64) || '.webp',
    'https://media.dnd.faysk.dev/campaigns/yuhara-main/sessions/41000000-0000-4000-8000-000000000021/cover/' || repeat('e',64) || '.webp',
    clock_timestamp()
  );

  v := public.move_session_campaign_v2_atomic(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'antes-que-seja-tarde',
    'yuhara-main',
    '41000000-0000-4000-8000-000000000021',
    'move-published-v2',
    '61000000-0000-4000-8000-000000000022',
    '{}'::jsonb
  );
  if v->>'status' <> 'moved' then
    raise exception 'published -> public v2 move failed: %', v;
  end if;

  if not exists (
    select 1 from public.sessions
    where id='41000000-0000-4000-8000-000000000021'
      and campaign_id=v_source
      and status='published'
      and current_session_publication_id='53000000-0000-4000-8000-000000000021'
      and metadata->>'coverImageUrl' like
        'https://media.dnd.faysk.dev/campaigns/yuhara-main/%'
  ) then
    raise exception 'public destination did not restore canonical public cover metadata';
  end if;

  if not exists (
    select 1 from public.media_assets
    where id='54000000-0000-4000-8000-000000000021'
      and campaign_id=v_source
      and status='staged'
      and object_key like 'campaigns/yuhara-main/sessions/%'
  ) then
    raise exception 'staged asset ownership/key did not return to public campaign';
  end if;

  if not exists (
    select 1 from public.session_publications
    where id='53000000-0000-4000-8000-000000000021'
      and campaign_id=v_source
      and payload_sha256=v_payload
      and cover_url=v_cover
  ) then
    raise exception 'published snapshot changed during return to public campaign';
  end if;
end
$tda_move_v2_published$;

do $tda_move_v2_security$
begin
  if has_table_privilege('anon','public.session_campaign_move_dependency_policies','select')
     or has_table_privilege('authenticated','public.session_campaign_move_dependency_policies','select')
     or has_table_privilege('anon','public.session_campaign_move_media_preparations','select')
     or has_table_privilege('authenticated','public.session_campaign_move_media_preparations','select')
     or has_function_privilege('anon','public.session_campaign_move_contract()','execute')
     or has_function_privilege('authenticated','public.session_campaign_move_contract()','execute')
     or has_function_privilege('anon','public.move_session_campaign_v2_atomic(uuid,uuid,text,text,uuid,text,uuid,jsonb)','execute')
     or has_function_privilege('authenticated','public.move_session_campaign_v2_atomic(uuid,uuid,text,text,uuid,text,uuid,jsonb)','execute') then
    raise exception 'browser role can access v2 move internals';
  end if;

  if not has_function_privilege('service_role','public.session_campaign_move_contract()','execute')
     or not has_function_privilege('service_role','public.preflight_session_campaign_move(uuid,uuid,text,text,uuid,text)','execute')
     or not has_function_privilege('service_role','public.move_session_campaign_v2_atomic(uuid,uuid,text,text,uuid,text,uuid,jsonb)','execute') then
    raise exception 'service_role cannot execute v2 move boundary';
  end if;
end
$tda_move_v2_security$;

select 'SESSION_CAMPAIGN_MOVE_V2_SQL_OK';
