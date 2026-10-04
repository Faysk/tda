-- #1485 regression assertions for campaign-move operational hardening.

do $tda_move_operational_hardening$
declare
  v_health jsonb;
begin
  v_health := public.session_campaign_move_release_health();

  if v_health ->> 'schema' <> 'tda.session-campaign-move-release-health.v1' then
    raise exception 'unexpected campaign move release-health schema: %', v_health;
  end if;
  if coalesce((v_health ->> 'ok')::boolean, false) is not true then
    raise exception 'campaign move release health is not ok: %', v_health;
  end if;
  if coalesce((v_health ->> 'contractVersion')::integer, 0) < 2 then
    raise exception 'campaign move contract regressed below v2: %', v_health;
  end if;
  if coalesce((v_health ->> 'registryDriftCount')::integer, -1) <> 0 then
    raise exception 'campaign move registry drift detected: %', v_health;
  end if;

  if not has_function_privilege(
       'service_role',
       'public.session_campaign_move_release_health()',
       'execute'
     ) then
    raise exception 'service_role cannot execute campaign move release health';
  end if;
  if has_function_privilege(
       'authenticated',
       'public.session_campaign_move_release_health()',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.session_campaign_move_release_health()',
       'execute'
     ) then
    raise exception 'browser role can execute campaign move release health';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'session_campaign_move_operations'
      and indexname = 'session_campaign_move_operations_recovery_idx'
  ) then
    raise exception 'durable recovery covering index is missing';
  end if;

  if (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and (
        (tablename = 'session_campaign_move_operations'
          and indexname in (
            'session_campaign_move_operations_session_id_idx',
            'session_campaign_move_operations_source_campaign_id_idx',
            'session_campaign_move_operations_destination_campaign_id_idx'
          ))
        or
        (tablename = 'session_campaign_move_media_preparations'
          and indexname in (
            'session_campaign_move_media_preparations_asset_id_idx',
            'session_campaign_move_media_preparations_session_id_idx',
            'session_campaign_move_media_preparations_source_campaign_id_idx',
            'session_campaign_move_media_preparations_destination_campaign_id_idx'
          ))
      )
  ) <> 7 then
    raise exception 'one or more campaign move FK covering indexes are missing';
  end if;
end
$tda_move_operational_hardening$;

set role service_role;
select public.session_campaign_move_release_health();
reset role;

select 'SESSION_CAMPAIGN_MOVE_OPERATIONAL_HARDENING_OK';
