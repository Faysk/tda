-- #1487: operational health regression for session campaign move v2.

do $$
declare
  v_health jsonb;
begin
  set local role service_role;
  select public.session_campaign_move_operational_health() into v_health;

  if coalesce((v_health ->> 'ready')::boolean, false) is not true then
    raise exception 'operational health is not ready: %', v_health;
  end if;
  if (v_health ->> 'contractVersion')::integer <> 2 then
    raise exception 'unexpected contract version: %', v_health;
  end if;
  if (v_health ->> 'registryDriftCount')::integer <> 0 then
    raise exception 'registry drift must be zero: %', v_health;
  end if;
  if coalesce((v_health ->> 'legacyV1Retired')::boolean, false) is not true then
    raise exception 'legacy v1 must remain retired: %', v_health;
  end if;
  if coalesce((v_health ->> 'v2ServiceOnly')::boolean, false) is not true then
    raise exception 'v2 commit must remain service-role only: %', v_health;
  end if;
  if coalesce((v_health ->> 'preflightServiceReady')::boolean, false) is not true then
    raise exception 'preflight must remain service-role ready: %', v_health;
  end if;
end
$$;

do $$
begin
  set local role anon;
  begin
    perform public.session_campaign_move_operational_health();
    raise exception 'anon unexpectedly executed operational health';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

do $$
begin
  set local role authenticated;
  begin
    perform public.session_campaign_move_operational_health();
    raise exception 'authenticated unexpectedly executed operational health';
  exception
    when insufficient_privilege then null;
  end;
end
$$;

select 'SESSION_CAMPAIGN_MOVE_OPERATIONAL_HEALTH_OK';
