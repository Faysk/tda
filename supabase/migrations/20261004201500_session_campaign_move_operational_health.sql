-- #1487: sanitized operational health for session campaign move v2.
--
-- This RPC is service-role only. It proves the runtime boundary that the
-- application depends on without reading any session/campaign/narrative data.

begin;

create or replace function public.session_campaign_move_operational_health()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with contract as (
    select public.session_campaign_move_contract() as value
  ),
  drift as (
    select public.session_campaign_move_registry_drift() as value
  ),
  posture as (
    select
      has_function_privilege(
        'service_role',
        'public.preflight_session_campaign_move(uuid,uuid,text,text,uuid,text)',
        'execute'
      ) as preflight_service_exec,
      has_function_privilege(
        'service_role',
        'public.move_session_campaign_v2_atomic(uuid,uuid,text,text,uuid,text,uuid,jsonb)',
        'execute'
      ) as v2_service_exec,
      has_function_privilege(
        'anon',
        'public.move_session_campaign_v2_atomic(uuid,uuid,text,text,uuid,text,uuid,jsonb)',
        'execute'
      ) as v2_anon_exec,
      has_function_privilege(
        'authenticated',
        'public.move_session_campaign_v2_atomic(uuid,uuid,text,text,uuid,text,uuid,jsonb)',
        'execute'
      ) as v2_authenticated_exec,
      has_function_privilege(
        'service_role',
        'public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,uuid)',
        'execute'
      ) as v1_service_exec,
      has_function_privilege(
        'anon',
        'public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,uuid)',
        'execute'
      ) as v1_anon_exec,
      has_function_privilege(
        'authenticated',
        'public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,uuid)',
        'execute'
      ) as v1_authenticated_exec
  )
  select jsonb_build_object(
    'ready',
      coalesce((contract.value ->> 'version')::integer, 0) = 2
      and jsonb_array_length(drift.value) = 0
      and posture.preflight_service_exec
      and posture.v2_service_exec
      and not posture.v2_anon_exec
      and not posture.v2_authenticated_exec
      and not posture.v1_service_exec
      and not posture.v1_anon_exec
      and not posture.v1_authenticated_exec,
    'contractVersion', coalesce((contract.value ->> 'version')::integer, 0),
    'registryDriftCount', jsonb_array_length(drift.value),
    'legacyV1Retired',
      not posture.v1_service_exec
      and not posture.v1_anon_exec
      and not posture.v1_authenticated_exec,
    'v2ServiceOnly',
      posture.v2_service_exec
      and not posture.v2_anon_exec
      and not posture.v2_authenticated_exec,
    'preflightServiceReady', posture.preflight_service_exec
  )
  from contract, drift, posture;
$$;

revoke all on function public.session_campaign_move_operational_health()
  from public, anon, authenticated, service_role;
grant execute on function public.session_campaign_move_operational_health()
  to service_role;

comment on function public.session_campaign_move_operational_health() is
  'Service-only sanitized readiness proof for session campaign move v2. Reads schema/privilege metadata only; never narrative data.';

commit;
