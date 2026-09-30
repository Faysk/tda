-- Assertions for #1134 campaign discovery and authorization hardening.

do $tda_auth_test$
begin
  if not exists (
    select 1
    from public.permission_catalog
    where action = 'project.campaigns.manage'
      and plane = 'technical'
  ) then
    raise exception 'project.campaigns.manage capability missing';
  end if;

  if not exists (
    select 1
    from public.role_permissions rp
    join public.role_definitions rd on rd.id = rp.role_id
    where rd.slug = 'platform_owner'
      and rp.permission_action = 'project.campaigns.manage'
  ) then
    raise exception 'platform_owner did not receive campaign creation capability';
  end if;

  if has_function_privilege(
      'anon',
      'public.has_profile_campaign_capability(uuid,text,text,timestamptz)',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.has_profile_campaign_capability(uuid,text,text,timestamptz)',
      'execute'
    ) then
    raise exception 'internal capability helper is exposed to browser roles';
  end if;

  if not has_function_privilege(
      'anon',
      'public.campaign_public_directory()',
      'execute'
    )
    or not has_function_privilege(
      'authenticated',
      'public.campaign_public_directory()',
      'execute'
    ) then
    raise exception 'public campaign directory is not callable by browser roles';
  end if;

  if has_function_privilege(
      'anon',
      'public.campaign_edit_directory()',
      'execute'
    )
    or not has_function_privilege(
      'authenticated',
      'public.campaign_edit_directory()',
      'execute'
    ) then
    raise exception 'edit campaign directory grants are incorrect';
  end if;


  if has_function_privilege(
      'anon',
      'public.access_directory(text)',
      'execute'
    )
    or not has_function_privilege(
      'authenticated',
      'public.access_directory(text)',
      'execute'
    )
    or not has_function_privilege(
      'service_role',
      'public.access_directory(text)',
      'execute'
    ) then
    raise exception 'access directory grants are incorrect';
  end if;

  if not has_function_privilege(
      'service_role',
      'public.has_profile_campaign_capability(uuid,text,text,timestamptz)',
      'execute'
    ) then
    raise exception 'service role cannot execute the internal campaign capability helper';
  end if;

  if has_function_privilege(
      'authenticated',
      'public.submit_profile_claim(text,uuid,text,text,text,text,text[],text)',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.review_profile_claim(uuid,text,text)',
      'execute'
    ) then
    raise exception 'legacy claim RPCs remain directly executable by authenticated';
  end if;

  if not has_function_privilege(
      'service_role',
      'public.submit_profile_claim(text,uuid,text,text,text,text,text[],text)',
      'execute'
    )
    or not has_function_privilege(
      'service_role',
      'public.review_profile_claim(uuid,text,text)',
      'execute'
    ) then
    raise exception 'service role lost required legacy claim RPC execution';
  end if;

  if not coalesce(
    (select p.prosecdef
     from pg_catalog.pg_proc p
     where p.oid = 'public.has_profile_campaign_capability(uuid,text,text,timestamptz)'::regprocedure),
    false
  )
  or not coalesce(
    (select p.prosecdef
     from pg_catalog.pg_proc p
     where p.oid = 'public.campaign_public_directory()'::regprocedure),
    false
  )
  or not coalesce(
    (select p.prosecdef
     from pg_catalog.pg_proc p
     where p.oid = 'public.campaign_edit_directory()'::regprocedure),
    false
  )
  or not coalesce(
    (select p.prosecdef
     from pg_catalog.pg_proc p
     where p.oid = 'public.access_directory(text)'::regprocedure),
    false
  ) then
    raise exception 'campaign authorization boundary functions must remain SECURITY DEFINER';
  end if;

  if not coalesce(
    (select 'search_path=pg_catalog, public' = any(p.proconfig)
     from pg_catalog.pg_proc p
     where p.oid = 'public.has_profile_campaign_capability(uuid,text,text,timestamptz)'::regprocedure),
    false
  )
  or not coalesce(
    (select 'search_path=pg_catalog, public' = any(p.proconfig)
     from pg_catalog.pg_proc p
     where p.oid = 'public.campaign_public_directory()'::regprocedure),
    false
  )
  or not coalesce(
    (select 'search_path=pg_catalog, public, auth' = any(p.proconfig)
     from pg_catalog.pg_proc p
     where p.oid = 'public.campaign_edit_directory()'::regprocedure),
    false
  )
  or not coalesce(
    (select 'search_path=pg_catalog, public, auth' = any(p.proconfig)
     from pg_catalog.pg_proc p
     where p.oid = 'public.access_directory(text)'::regprocedure),
    false
  ) then
    raise exception 'campaign authorization boundary functions lost their fixed search_path';
  end if;
end
$tda_auth_test$;

-- Public discovery is projection-only and hides private/archived campaigns.
do $tda_auth_test$
declare
  v_directory jsonb;
begin
  v_directory := public.campaign_public_directory();

  if jsonb_array_length(v_directory) <> 1 then
    raise exception 'public directory exposed unexpected campaign count: %', v_directory;
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(v_directory) row
    where row->>'routeKey' = 'cronicas-da-mesa'
      and row->>'name' = 'Crônicas da Mesa'
      and not (row ? 'technicalSlug')
      and not (row ? 'id')
  ) then
    raise exception 'public directory did not return the minimal legacy public projection';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_directory) row
    where row->>'routeKey' in ('antes-que-seja-tarde', 'archived-private')
  ) then
    raise exception 'public directory enumerated private or archived campaign';
  end if;
end
$tda_auth_test$;

-- Edit discovery is actor-scoped, including exact project/tda campaign
-- capabilities but excluding wrong project scopes and outsiders.
do $tda_auth_test$
declare
  v_directory jsonb;
begin
  perform set_config(
    'request.jwt.claim.sub',
    '90000000-0000-4000-8000-000000000001',
    false
  );
  v_directory := public.campaign_edit_directory();
  if jsonb_array_length(v_directory) <> 1
     or v_directory->0->>'technicalSlug' <> 'yuhara-main' then
    raise exception 'campaign A actor discovered sibling campaigns: %', v_directory;
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    '90000000-0000-4000-8000-000000000002',
    false
  );
  v_directory := public.campaign_edit_directory();
  if jsonb_array_length(v_directory) <> 1
     or v_directory->0->>'technicalSlug' <> 'antes-que-seja-tarde' then
    raise exception 'campaign B actor discovered sibling campaigns: %', v_directory;
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    '90000000-0000-4000-8000-000000000003',
    false
  );
  if public.campaign_edit_directory() <> '[]'::jsonb then
    raise exception 'outsider discovered private campaigns';
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    '90000000-0000-4000-8000-000000000004',
    false
  );
  v_directory := public.campaign_edit_directory();
  if jsonb_array_length(v_directory) <> 3 then
    raise exception 'project/tda exact campaign.edit.access did not cover campaigns: %', v_directory;
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    '90000000-0000-4000-8000-000000000005',
    false
  );
  if public.campaign_edit_directory() <> '[]'::jsonb then
    raise exception 'legacy project/dnd-scribe scope granted campaign discovery';
  end if;
end
$tda_auth_test$;

-- Exact capability and physical scope remain independent: project-level Edit
-- discovery does not imply campaign.read, while session/resource grants do not
-- escape into campaign discovery or access.
do $tda_auth_test$
declare
  v_actor uuid;
  v_directory jsonb;
begin
  perform set_config(
    'request.jwt.claim.sub',
    '90000000-0000-4000-8000-000000000004',
    false
  );
  if public.access_directory('yuhara-main')
     <> jsonb_build_object('ok', false, 'error', 'forbidden') then
    raise exception 'project campaign.edit.access was incorrectly widened to campaign.read';
  end if;

  foreach v_actor in array array[
    '90000000-0000-4000-8000-000000000003'::uuid,
    '90000000-0000-4000-8000-000000000008'::uuid,
    '90000000-0000-4000-8000-000000000009'::uuid,
    '90000000-0000-4000-8000-000000000010'::uuid,
    '90000000-0000-4000-8000-000000000011'::uuid,
    '90000000-0000-4000-8000-000000000099'::uuid
  ]
  loop
    perform set_config('request.jwt.claim.sub', v_actor::text, false);
    v_directory := public.campaign_edit_directory();

    if v_directory <> '[]'::jsonb then
      raise exception 'non-effective actor % discovered campaigns: %', v_actor, v_directory;
    end if;

    if public.access_directory('yuhara-main')
       <> jsonb_build_object('ok', false, 'error', 'forbidden') then
      raise exception 'non-effective actor % crossed campaign access boundary', v_actor;
    end if;
  end loop;

  if not public.has_profile_campaign_capability(
    '30000000-0000-4000-8000-000000000001',
    'yuhara-main',
    'campaign.read',
    statement_timestamp()
  ) then
    raise exception 'campaign-scoped read grant was not recognized by helper';
  end if;

  if public.has_profile_campaign_capability(
    '30000000-0000-4000-8000-000000000001',
    'antes-que-seja-tarde',
    'campaign.read',
    statement_timestamp()
  ) then
    raise exception 'campaign-scoped read grant escaped into sibling campaign';
  end if;

  if public.has_profile_campaign_capability(
    '30000000-0000-4000-8000-000000000003',
    'yuhara-main',
    'campaign.read',
    statement_timestamp()
  )
  or public.has_profile_campaign_capability(
    '30000000-0000-4000-8000-000000000010',
    'yuhara-main',
    'campaign.read',
    statement_timestamp()
  ) then
    raise exception 'session/resource scope was treated as campaign authority';
  end if;
end
$tda_auth_test$;

-- Revocation is observed on the next call; there is no stale cached authority.
do $tda_auth_test$
begin
  update public.role_assignments
  set
    status = 'revoked',
    ends_at = clock_timestamp()
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';

  perform set_config(
    'request.jwt.claim.sub',
    '90000000-0000-4000-8000-000000000004',
    false
  );

  if public.campaign_edit_directory() <> '[]'::jsonb then
    raise exception 'revoked project grant remained effective';
  end if;
end
$tda_auth_test$;

-- access_directory is no longer a discovery oracle. Missing, sibling and
-- archived targets fail opaquely, while an authorized actor receives only
-- campaign-bound people/characters.
do $tda_auth_test$
declare
  v_allowed jsonb;
  v_cross jsonb;
  v_missing jsonb;
  v_manager jsonb;
begin
  perform set_config(
    'request.jwt.claim.sub',
    '90000000-0000-4000-8000-000000000001',
    false
  );

  v_allowed := public.access_directory('yuhara-main');
  if coalesce((v_allowed->>'ok')::boolean, false) is not true then
    raise exception 'authorized campaign member could not read access directory: %', v_allowed;
  end if;

  if v_allowed->'viewer'->>'canManageAccess' <> 'false' then
    raise exception 'reader was incorrectly elevated to access manager';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_allowed->'profiles') row
    where row->>'displayName' in ('Global unlinked profile', 'Second member')
  ) then
    raise exception 'access directory leaked global unlinked or sibling profile';
  end if;

  v_cross := public.access_directory('antes-que-seja-tarde');
  v_missing := public.access_directory('does-not-exist');

  if v_cross <> jsonb_build_object('ok', false, 'error', 'forbidden')
     or v_missing <> v_cross then
    raise exception 'cross-campaign and missing campaign errors are distinguishable';
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    '90000000-0000-4000-8000-000000000006',
    false
  );
  v_manager := public.access_directory('yuhara-main');

  if v_manager->'viewer'->>'canManageAccess' <> 'true' then
    raise exception 'campaign.access.manage was not recognized';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_manager->'profiles') row
    where row->>'displayName' = 'Global unlinked profile'
  ) then
    raise exception 'manager directory still enumerated a global unlinked profile';
  end if;

  insert into public.role_assignments(
    id, profile_id, role_id, scope_type, scope_id, status, starts_at
  ) values (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbba0',
    '30000000-0000-4000-8000-000000000006',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    'project',
    'tda',
    'active',
    '2020-01-01'
  );

  if public.access_directory('archived-private')
     <> jsonb_build_object('ok', false, 'error', 'forbidden') then
    raise exception 'archived campaign accepted normal access-directory operation';
  end if;
end
$tda_auth_test$;

-- A forged sibling slug does not let a valid A credential act as B, and an
-- outsider cannot enumerate B even when the technical slug is known.
do $tda_auth_test$
begin
  perform set_config(
    'request.jwt.claim.sub',
    '90000000-0000-4000-8000-000000000001',
    false
  );
  if public.access_directory('antes-que-seja-tarde')->>'error' <> 'forbidden' then
    raise exception 'A credential + B slug did not fail closed';
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    '90000000-0000-4000-8000-000000000003',
    false
  );
  if public.access_directory('antes-que-seja-tarde')->>'error' <> 'forbidden' then
    raise exception 'outsider enumerated known private campaign';
  end if;
end
$tda_auth_test$;


-- Execute exposed RPCs under the actual browser roles, not only as owner.
set role anon;
select public.campaign_public_directory();
reset role;

select set_config(
  'request.jwt.claim.sub',
  '90000000-0000-4000-8000-000000000001',
  false
);
set role authenticated;
select public.campaign_edit_directory();
select public.access_directory('yuhara-main');
reset role;

select 'CAMPAIGN_AUTHORIZATION_SQL_OK';
