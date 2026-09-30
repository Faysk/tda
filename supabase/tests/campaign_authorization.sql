-- Assertions for #1134 campaign discovery and authorization hardening.

do $$
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
end
$$;

-- Public discovery is projection-only and hides private/archived campaigns.
do $$
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
$$;

-- Edit discovery is actor-scoped, including exact project/tda campaign
-- capabilities but excluding wrong project scopes and outsiders.
do $$
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
$$;

-- Revocation is observed on the next call; there is no stale cached authority.
do $$
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
$$;

-- access_directory is no longer a discovery oracle. Missing, sibling and
-- archived targets fail opaquely, while an authorized actor receives only
-- campaign-bound people/characters.
do $$
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
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9',
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
$$;

-- A forged sibling slug does not let a valid A credential act as B, and an
-- outsider cannot enumerate B even when the technical slug is known.
do $$
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
$$;


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
