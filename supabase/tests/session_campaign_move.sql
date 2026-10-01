-- #1129 synthetic assertions. No Production data or credentials.

do $tda_move_test$
declare
  v_result jsonb;
  v_expected timestamptz;
  v_source_id uuid;
  v_destination_id uuid;
begin
  select id into v_source_id from public.campaigns where slug='yuhara-main';
  select id into v_destination_id from public.campaigns where slug='antes-que-seja-tarde';

  -- Unauthorized / one-sided authorization cannot use preflight as an oracle.
  v_result := public.preview_session_campaign_move(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000101',
    'move-empty'
  );
  if v_result <> jsonb_build_object('ok', false, 'reason', 'forbidden') then
    raise exception 'destination authorization did not fail closed: %', v_result;
  end if;

  -- Empty session: ready preflight, atomic commit and idempotent replay.
  v_result := public.preview_session_campaign_move(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main',
    'antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000101',
    'move-empty'
  );
  if coalesce((v_result->>'ok')::boolean,false) is not true
     or coalesce((v_result->>'ready')::boolean,false) is not true
     or v_result->'blockers' <> '[]'::jsonb then
    raise exception 'empty session preflight was not ready: %', v_result;
  end if;
  v_expected := (v_result->>'expectedUpdatedAt')::timestamptz;

  v_result := public.move_session_campaign_atomic(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main',
    'antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000101',
    'move-empty',
    v_expected,
    '91000000-0000-4000-8000-000000000101'
  );
  if v_result->>'status' <> 'moved' then
    raise exception 'empty session did not move: %', v_result;
  end if;
  if not exists (
    select 1 from public.sessions
    where id='40000000-0000-4000-8000-000000000101'
      and campaign_id=v_destination_id
  ) then
    raise exception 'moved session is not in destination';
  end if;
  if (
    select count(*) from public.audit_log
    where session_id='40000000-0000-4000-8000-000000000101'
      and action in ('session.campaign_move_out','session.campaign_move_in')
  ) <> 2 then
    raise exception 'two-sided move audit missing';
  end if;
  if exists (
    select 1 from public.audit_log
    where session_id='40000000-0000-4000-8000-000000000101'
      and (old_value::text ilike '%transcript%' or new_value::text ilike '%transcript%')
  ) then
    raise exception 'audit unexpectedly contains transcript-shaped content';
  end if;

  v_result := public.move_session_campaign_atomic(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main',
    'antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000101',
    'move-empty',
    v_expected,
    '91000000-0000-4000-8000-000000000101'
  );
  if v_result->>'status' <> 'replay' then
    raise exception 'lost-response retry did not replay receipt: %', v_result;
  end if;
  if (
    select count(*) from public.session_campaign_move_operations
    where operation_id='91000000-0000-4000-8000-000000000101'
  ) <> 1 then
    raise exception 'idempotency receipt duplicated';
  end if;
  if (
    select count(*) from public.audit_log
    where session_id='40000000-0000-4000-8000-000000000101'
      and action in ('session.campaign_move_out','session.campaign_move_in')
  ) <> 2 then
    raise exception 'replay duplicated audit';
  end if;

  -- Private transcript revision + receipts + campaign-owned auxiliary rows move
  -- together while the revision payload remains byte-for-byte identical.
  v_result := public.preview_session_campaign_move(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main','antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000102','move-transcript'
  );
  if coalesce((v_result->>'ready')::boolean,false) is not true then
    raise exception 'private transcript session unexpectedly blocked: %', v_result;
  end if;
  v_expected := (v_result->>'expectedUpdatedAt')::timestamptz;
  v_result := public.move_session_campaign_atomic(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main','antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000102','move-transcript',
    v_expected,'91000000-0000-4000-8000-000000000102'
  );
  if v_result->>'status' <> 'moved' then
    raise exception 'transcript session did not move: %', v_result;
  end if;
  if exists (
    select 1 from (
      select campaign_id from public.transcript_revisions where session_id='40000000-0000-4000-8000-000000000102'
      union all
      select campaign_id from public.transcript_publication_receipts where session_id='40000000-0000-4000-8000-000000000102'
      union all
      select campaign_id from public.transcript_assembly_publication_receipts where session_id='40000000-0000-4000-8000-000000000102'
      union all
      select campaign_id from public.transcript_publication_events where session_id='40000000-0000-4000-8000-000000000102'
      union all
      select campaign_id from public.ai_usage_ledger where session_id='40000000-0000-4000-8000-000000000102'
      union all
      select campaign_id from public.discord_interactions where session_id='40000000-0000-4000-8000-000000000102'
      union all
      select campaign_id from public.table_notes where session_id='40000000-0000-4000-8000-000000000102'
    ) owned
    where owned.campaign_id <> v_destination_id
  ) then
    raise exception 'campaign-owned transcript auxiliaries were not moved atomically';
  end if;
  if (
    select payload from public.transcript_revisions
    where id='50000000-0000-4000-8000-000000000102'
  ) <> '{"text":"synthetic fixture only"}'::jsonb then
    raise exception 'transcript payload changed during ownership move';
  end if;

  -- Private editorial draft without campaign-scoped cover is portable.
  v_result := public.preview_session_campaign_move(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main','antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000103','move-draft'
  );
  if coalesce((v_result->>'ready')::boolean,false) is not true then
    raise exception 'draft session unexpectedly blocked: %', v_result;
  end if;
  v_expected := (v_result->>'expectedUpdatedAt')::timestamptz;
  perform public.move_session_campaign_atomic(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main','antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000103','move-draft',
    v_expected,'91000000-0000-4000-8000-000000000103'
  );
  if not exists (
    select 1 from public.session_editorial_drafts
    where id='60000000-0000-4000-8000-000000000103'
      and campaign_id=v_destination_id
  ) then
    raise exception 'editorial draft campaign ownership did not move';
  end if;

  -- Active publication is an explicit blocker. No write may occur.
  v_result := public.preview_session_campaign_move(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main','antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000104','move-published'
  );
  if not (v_result->'blockers' ? 'active_publication') then
    raise exception 'active publication blocker missing: %', v_result;
  end if;

  -- Campaign-scoped cover namespace blocks until #1135 can migrate bytes/key.
  v_result := public.preview_session_campaign_move(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main','antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000105','move-cover'
  );
  if not (v_result->'blockers' ? 'campaign_scoped_media') then
    raise exception 'R2 cover blocker missing: %', v_result;
  end if;

  -- Participant/entity references are campaign-owned and never copied by name.
  v_result := public.preview_session_campaign_move(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main','antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000106','move-entity'
  );
  if not (v_result->'blockers' ? 'participant_entity_links') then
    raise exception 'participant entity blocker missing: %', v_result;
  end if;

  -- Canon/entity provenance remains explicit; no automatic cross-campaign clone.
  v_result := public.preview_session_campaign_move(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main','antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000107','move-canon'
  );
  if not (v_result->'blockers' ? 'canon_or_entity_provenance') then
    raise exception 'canon/provenance blocker missing: %', v_result;
  end if;

  -- Same sourceSessionId may exist independently in A/B. Moving A into B then
  -- becomes an explicit collision rather than an ambiguous lookup.
  if (
    select count(*) from public.sessions where source_session_id='shared-source'
  ) <> 2 then
    raise exception 'same sourceSessionId cross-campaign fixture not preserved';
  end if;
  v_result := public.preview_session_campaign_move(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main','antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000108','shared-source'
  );
  if not (v_result->'blockers' ? 'destination_collision') then
    raise exception 'destination source collision blocker missing: %', v_result;
  end if;

  -- Session/resource scoped grants do not silently change physical scope.
  v_result := public.preview_session_campaign_move(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main','antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000110','move-scoped'
  );
  if not (v_result->'blockers' ? 'session_scoped_grants') then
    raise exception 'session scoped grant blocker missing: %', v_result;
  end if;

  -- Optimistic concurrency: a stale preflight must not overwrite a newer row.
  v_result := public.preview_session_campaign_move(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main','antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000109','move-concurrent'
  );
  v_expected := (v_result->>'expectedUpdatedAt')::timestamptz;
  update public.sessions
  set updated_at = updated_at + interval '1 second'
  where id='40000000-0000-4000-8000-000000000109';

  v_result := public.move_session_campaign_atomic(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main','antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000109','move-concurrent',
    v_expected,'91000000-0000-4000-8000-000000000109'
  );
  if v_result <> jsonb_build_object('ok', false, 'reason', 'conflict') then
    raise exception 'stale CAS did not conflict: %', v_result;
  end if;
  if not exists (
    select 1 from public.sessions
    where id='40000000-0000-4000-8000-000000000109'
      and campaign_id=v_source_id
  ) then
    raise exception 'stale CAS partially moved session';
  end if;

  -- Reusing an operation ID for another payload is never treated as replay.
  v_result := public.move_session_campaign_atomic(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main','antes-que-seja-tarde',
    '40000000-0000-4000-8000-000000000109','move-concurrent',
    v_expected,'91000000-0000-4000-8000-000000000101'
  );
  if v_result <> jsonb_build_object('ok', false, 'reason', 'operation_conflict') then
    raise exception 'operation id payload mismatch was not rejected: %', v_result;
  end if;
end
$tda_move_test$;

-- Browser roles must not execute either preview or mutation boundary.
set role anon;
do $tda_move_test$
begin
  begin
    perform public.preview_session_campaign_move(
      null,null,'yuhara-main','antes-que-seja-tarde',
      '40000000-0000-4000-8000-000000000104','move-published'
    );
    raise exception 'anon executed move preflight';
  exception when insufficient_privilege then null;
  end;
end
$tda_move_test$;
reset role;

set role authenticated;
do $tda_move_test$
begin
  begin
    perform public.move_session_campaign_atomic(
      null,null,'yuhara-main','antes-que-seja-tarde',
      '40000000-0000-4000-8000-000000000104','move-published',
      clock_timestamp(),gen_random_uuid()
    );
    raise exception 'authenticated executed move mutation';
  exception when insufficient_privilege then null;
  end;
end
$tda_move_test$;
reset role;

select 'SESSION_CAMPAIGN_MOVE_SQL_OK';
