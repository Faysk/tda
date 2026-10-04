-- Assertions for #1129 safe session campaign move.

do $tda_move_test$
declare
  v jsonb;
begin
  v := public.preflight_session_campaign_move(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000001',
    'move-empty'
  );
  if v->>'status' <> 'ready' or jsonb_array_length(v->'blockers') <> 0 then
    raise exception 'empty session should be movable: %', v;
  end if;

  v := public.preflight_session_campaign_move(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000003',
    'move-collision'
  );
  if v->>'status' <> 'blocked'
     or not (v->'blockers' @> '[{"code":"source_identity_collision"}]'::jsonb) then
    raise exception 'destination collision was not blocked: %', v;
  end if;

  foreach v in array array[
    public.preflight_session_campaign_move(
      '90000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000006',
      'yuhara-main','antes-que-seja-tarde','41000000-0000-4000-8000-000000000005','move-transcript'
    ),
    public.preflight_session_campaign_move(
      '90000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000006',
      'yuhara-main','antes-que-seja-tarde','41000000-0000-4000-8000-000000000006','move-draft'
    ),
    public.preflight_session_campaign_move(
      '90000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000006',
      'yuhara-main','antes-que-seja-tarde','41000000-0000-4000-8000-000000000007','move-published'
    ),
    public.preflight_session_campaign_move(
      '90000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000006',
      'yuhara-main','antes-que-seja-tarde','41000000-0000-4000-8000-000000000008','move-cover'
    ),
    public.preflight_session_campaign_move(
      '90000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000006',
      'yuhara-main','antes-que-seja-tarde','41000000-0000-4000-8000-000000000009','move-participant'
    ),
    public.preflight_session_campaign_move(
      '90000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000006',
      'yuhara-main','antes-que-seja-tarde','41000000-0000-4000-8000-000000000010','move-provenance'
    ),
    public.preflight_session_campaign_move(
      '90000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000006',
      'yuhara-main','antes-que-seja-tarde','41000000-0000-4000-8000-000000000011','move-grant'
    )
  ]
  loop
    if v->>'status' <> 'blocked' or jsonb_array_length(v->'blockers') < 1 then
      raise exception 'dependent session did not fail closed: %', v;
    end if;
  end loop;

  v := public.preflight_session_campaign_move(
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000001',
    'move-empty'
  );
  if v->>'status' <> 'forbidden' then
    raise exception 'missing destination capability was not denied: %', v;
  end if;
end
$tda_move_test$;

do $tda_move_test$
declare
  v jsonb;
  v_destination uuid;
begin
  v := public.move_session_campaign_atomic(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000001',
    'move-empty',
    '61000000-0000-4000-8000-000000000001'
  );
  if v->>'status' <> 'moved' then
    raise exception 'empty session move failed: %', v;
  end if;

  select id into strict v_destination
  from public.campaigns where slug='antes-que-seja-tarde';
  if not exists (
    select 1 from public.sessions
    where id='41000000-0000-4000-8000-000000000001'
      and campaign_id=v_destination
  ) then
    raise exception 'session campaign_id did not move';
  end if;

  if (
    select count(*) from public.audit_log
    where action='session.campaign.move'
      and session_id='41000000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'move audit missing or duplicated';
  end if;

  if exists (
    select 1 from public.audit_log
    where action='session.campaign.move'
      and (
        coalesce(old_value::text,'') ilike '%transcript%'
        or coalesce(new_value::text,'') ilike '%transcript%'
      )
  ) then
    raise exception 'move audit contains transcript-shaped payload';
  end if;

  v := public.move_session_campaign_atomic(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000001',
    'move-empty',
    '61000000-0000-4000-8000-000000000001'
  );
  if v->>'status' <> 'replay' then
    raise exception 'lost response replay was not idempotent: %', v;
  end if;

  if (
    select count(*) from public.audit_log
    where action='session.campaign.move'
      and session_id='41000000-0000-4000-8000-000000000001'
  ) <> 1 then
    raise exception 'replay duplicated audit';
  end if;

  v := public.move_session_campaign_atomic(
    '90000000-0000-4000-8000-000000000006',
    '30000000-0000-4000-8000-000000000006',
    'yuhara-main',
    'antes-que-seja-tarde',
    '41000000-0000-4000-8000-000000000012',
    'move-concurrent',
    '61000000-0000-4000-8000-000000000001'
  );
  if v->>'status' <> 'operation_conflict' then
    raise exception 'operation id reuse was not rejected: %', v;
  end if;
end
$tda_move_test$;

do $tda_move_security$
begin
  if has_table_privilege('anon','public.session_campaign_move_operations','select')
     or has_table_privilege('authenticated','public.session_campaign_move_operations','select')
     or has_function_privilege('anon','public.preflight_session_campaign_move(uuid,uuid,text,text,uuid,text)','execute')
     or has_function_privilege('authenticated','public.preflight_session_campaign_move(uuid,uuid,text,text,uuid,text)','execute')
     or has_function_privilege('anon','public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,uuid)','execute')
     or has_function_privilege('authenticated','public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,uuid)','execute') then
    raise exception 'browser role can access session move boundary';
  end if;

  if not has_table_privilege('service_role','public.session_campaign_move_operations','select')
     or not has_table_privilege('service_role','public.session_campaign_move_operations','insert')
     or has_table_privilege('service_role','public.session_campaign_move_operations','update')
     or has_table_privilege('service_role','public.session_campaign_move_operations','delete') then
    raise exception 'service_role receipt privileges are broader or narrower than select+insert';
  end if;

  if not has_function_privilege('service_role','public.preflight_session_campaign_move(uuid,uuid,text,text,uuid,text)','execute')
     or not has_function_privilege('service_role','public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,uuid)','execute')
     or has_function_privilege('service_role','public.session_campaign_move_dependency_count(text,text,uuid)','execute')
     or has_function_privilege('service_role','public.session_campaign_move_blockers(uuid,uuid)','execute') then
    raise exception 'service_role function privileges do not match the public server boundary';
  end if;
end
$tda_move_security$;

select 'SESSION_CAMPAIGN_MOVE_SQL_OK';
