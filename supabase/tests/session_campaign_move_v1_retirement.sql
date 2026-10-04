-- Regression assertions for #1475.
-- The v2 preflight may classify a populated session as ready, therefore the v1
-- commit boundary must be unreachable by every application role.

do $tda_move_v1_retirement$
begin
  if has_function_privilege(
       'service_role',
       'public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,uuid)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,uuid)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.move_session_campaign_atomic(uuid,uuid,text,text,uuid,text,uuid)',
       'execute'
     ) then
    raise exception 'legacy v1 session campaign move commit is still executable';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.preflight_session_campaign_move(uuid,uuid,text,text,uuid,text)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.move_session_campaign_v2_atomic(uuid,uuid,text,text,uuid,text,uuid,jsonb)',
       'execute'
     ) then
    raise exception 'v2 session campaign move boundary lost required service_role grants';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.move_session_campaign_v2_atomic(uuid,uuid,text,text,uuid,text,uuid,jsonb)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.move_session_campaign_v2_atomic(uuid,uuid,text,text,uuid,text,uuid,jsonb)',
       'execute'
     ) then
    raise exception 'browser role can execute the v2 campaign move commit';
  end if;
end
$tda_move_v1_retirement$;

set role service_role;
do $tda_move_v1_direct_call$
begin
  begin
    perform public.move_session_campaign_atomic(
      null::uuid,
      null::uuid,
      'yuhara-main',
      'antes-que-seja-tarde',
      '41000000-0000-4000-8000-000000000012'::uuid,
      'move-concurrent',
      '61000000-0000-4000-8000-000000000099'::uuid
    );
    raise exception 'legacy v1 commit unexpectedly executed';
  exception
    when insufficient_privilege then
      null;
  end;
end
$tda_move_v1_direct_call$;
reset role;

select 'SESSION_CAMPAIGN_MOVE_V1_RETIRED_OK';
