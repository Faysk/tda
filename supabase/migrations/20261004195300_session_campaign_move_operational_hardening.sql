-- #1485: operational hardening for populated session campaign moves.
-- Adds read-only release health plus covering indexes for durable recovery and
-- media preparation receipts. Forward-only: do not edit the already-applied
-- v1/v2 campaign-move migrations.

begin;

create index if not exists session_campaign_move_operations_recovery_idx
  on public.session_campaign_move_operations(
    actor_profile_id,
    source_campaign_id,
    source_session_id,
    committed_at desc
  );

create index if not exists session_campaign_move_operations_session_id_idx
  on public.session_campaign_move_operations(session_id);

create index if not exists session_campaign_move_operations_source_campaign_id_idx
  on public.session_campaign_move_operations(source_campaign_id);

create index if not exists session_campaign_move_operations_destination_campaign_id_idx
  on public.session_campaign_move_operations(destination_campaign_id);

create index if not exists session_campaign_move_media_preparations_asset_id_idx
  on public.session_campaign_move_media_preparations(asset_id);

create index if not exists session_campaign_move_media_preparations_session_id_idx
  on public.session_campaign_move_media_preparations(session_id);

create index if not exists session_campaign_move_media_preparations_source_campaign_id_idx
  on public.session_campaign_move_media_preparations(source_campaign_id);

create index if not exists session_campaign_move_media_preparations_destination_campaign_id_idx
  on public.session_campaign_move_media_preparations(destination_campaign_id);

create or replace function public.session_campaign_move_release_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $tda_move_health$
declare
  v_contract jsonb;
  v_contract_version integer := 0;
  v_drift jsonb := '[]'::jsonb;
  v_drift_count integer := 0;
  v_v1 regprocedure;
  v_preflight regprocedure;
  v_v2 regprocedure;
  v_drift_helper regprocedure;
  v_service_v1 boolean := false;
  v_authenticated_v1 boolean := false;
  v_anon_v1 boolean := false;
  v_service_preflight boolean := false;
  v_authenticated_preflight boolean := false;
  v_anon_preflight boolean := false;
  v_service_v2 boolean := false;
  v_authenticated_v2 boolean := false;
  v_anon_v2 boolean := false;
  v_service_drift_helper boolean := false;
  v_ok boolean := false;
begin
  v_contract := public.session_campaign_move_contract();
  begin
    v_contract_version := coalesce((v_contract ->> 'version')::integer, 0);
  exception
    when others then
      v_contract_version := 0;
  end;

  v_drift := public.session_campaign_move_registry_drift();
  if jsonb_typeof(v_drift) = 'array' then
    v_drift_count := jsonb_array_length(v_drift);
  else
    v_drift_count := -1;
  end if;

  v_v1 := to_regprocedure(
    'public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,uuid)'
  );
  v_preflight := to_regprocedure(
    'public.preflight_session_campaign_move(uuid,uuid,text,text,uuid,text)'
  );
  v_v2 := to_regprocedure(
    'public.move_session_campaign_v2_atomic(uuid,uuid,text,text,uuid,text,uuid,jsonb)'
  );
  v_drift_helper := to_regprocedure(
    'public.session_campaign_move_registry_drift()'
  );

  if v_v1 is not null then
    v_service_v1 := has_function_privilege('service_role', v_v1, 'execute');
    v_authenticated_v1 := has_function_privilege('authenticated', v_v1, 'execute');
    v_anon_v1 := has_function_privilege('anon', v_v1, 'execute');
  end if;

  if v_preflight is not null then
    v_service_preflight := has_function_privilege('service_role', v_preflight, 'execute');
    v_authenticated_preflight := has_function_privilege('authenticated', v_preflight, 'execute');
    v_anon_preflight := has_function_privilege('anon', v_preflight, 'execute');
  end if;

  if v_v2 is not null then
    v_service_v2 := has_function_privilege('service_role', v_v2, 'execute');
    v_authenticated_v2 := has_function_privilege('authenticated', v_v2, 'execute');
    v_anon_v2 := has_function_privilege('anon', v_v2, 'execute');
  end if;

  if v_drift_helper is not null then
    v_service_drift_helper := has_function_privilege(
      'service_role',
      v_drift_helper,
      'execute'
    );
  end if;

  v_ok :=
    v_contract_version >= 2
    and v_drift_count = 0
    and v_v1 is not null
    and not v_service_v1
    and not v_authenticated_v1
    and not v_anon_v1
    and v_preflight is not null
    and v_service_preflight
    and not v_authenticated_preflight
    and not v_anon_preflight
    and v_v2 is not null
    and v_service_v2
    and not v_authenticated_v2
    and not v_anon_v2
    and v_drift_helper is not null
    and not v_service_drift_helper;

  return jsonb_build_object(
    'schema', 'tda.session-campaign-move-release-health.v1',
    'ok', v_ok,
    'contractVersion', v_contract_version,
    'registryDriftCount', v_drift_count,
    'grants', jsonb_build_object(
      'legacyCommitServiceRole', v_service_v1,
      'legacyCommitAuthenticated', v_authenticated_v1,
      'legacyCommitAnon', v_anon_v1,
      'preflightServiceRole', v_service_preflight,
      'preflightAuthenticated', v_authenticated_preflight,
      'preflightAnon', v_anon_preflight,
      'v2CommitServiceRole', v_service_v2,
      'v2CommitAuthenticated', v_authenticated_v2,
      'v2CommitAnon', v_anon_v2,
      'registryHelperServiceRole', v_service_drift_helper
    )
  );
end
$tda_move_health$;

revoke all on function public.session_campaign_move_release_health()
  from public, anon, authenticated, service_role;
grant execute on function public.session_campaign_move_release_health()
  to service_role;

comment on function public.session_campaign_move_release_health() is
  'Sanitized read-only Production release gate for the session campaign move boundary. Returns contract/drift/grant state only; no session or narrative data.';

commit;
