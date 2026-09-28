-- Governed campaign role assignment mutations for #986.
-- Server-only service_role RPC: campaign-scoped assignments, CAS, audit and last-admin safety.

begin;

create table if not exists public.campaign_permission_revisions (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, profile_id)
);

alter table public.campaign_permission_revisions enable row level security;

revoke all on table public.campaign_permission_revisions
  from public, anon, authenticated;
grant select, insert, update on table public.campaign_permission_revisions
  to service_role;

create index if not exists audit_log_permissions_operation_idx
  on public.audit_log (
    campaign_id,
    ((new_value ->> 'operationId')),
    created_at desc
  )
  where action in ('permissions.role.grant', 'permissions.role.revoke');

create or replace function public.manage_campaign_role_assignments(
  p_campaign_slug text,
  p_actor_profile_id uuid,
  p_target_profile_id uuid,
  p_expected_revision bigint,
  p_changes jsonb,
  p_operation_id uuid,
  p_reason text default null,
  p_confirm_sensitive boolean default false,
  p_confirm_self_revoke boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_campaign_id uuid;
  v_current_revision bigint;
  v_next_revision bigint;
  v_change jsonb;
  v_role_id uuid;
  v_assignment_id uuid;
  v_operation text;
  v_inserted_id uuid;
  v_old_status text;
  v_old_starts_at timestamptz;
  v_old_ends_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_sensitive_actions constant text[] := array[
    'campaign.permissions.manage',
    'campaign.sessions.publish',
    'campaign.transcript.publish',
    'narrative.canon.approve'
  ];
begin
  if p_campaign_slug is null
     or p_campaign_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'
     or p_actor_profile_id is null
     or p_target_profile_id is null
     or p_expected_revision is null
     or p_expected_revision < 0
     or p_operation_id is null
     or jsonb_typeof(p_changes) <> 'array'
     or jsonb_array_length(p_changes) < 1
     or jsonb_array_length(p_changes) > 20 then
    return jsonb_build_object('status', 'validation');
  end if;

  -- Validate the complete shape before any UUID cast or write.
  if exists (
    select 1
    from jsonb_array_elements(p_changes) change_row
    where change_row ->> 'operation' not in ('grant', 'revoke')
       or coalesce(change_row ->> 'roleId', '') !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or (
         change_row ->> 'operation' = 'revoke'
         and coalesce(change_row ->> 'assignmentId', '') !~*
             '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       )
  ) then
    return jsonb_build_object('status', 'validation');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_changes) change_row
    group by change_row ->> 'roleId'
    having count(*) > 1
  ) then
    return jsonb_build_object('status', 'validation');
  end if;

  select c.id
    into v_campaign_id
  from public.campaigns c
  where c.slug = p_campaign_slug;

  if v_campaign_id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- Serialize governed mutations within a campaign. CAS is target-scoped, while
  -- last-admin safety is a campaign-wide invariant.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('tda:permissions:' || p_campaign_slug, 0)
  );

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
  ) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if not exists (
    select 1
    from public.role_assignments ra
    join public.role_permissions rp on rp.role_id = ra.role_id
    where ra.profile_id = p_actor_profile_id
      and rp.permission_action = 'campaign.permissions.manage'
      and ra.status = 'active'
      and ra.starts_at <= v_now
      and (ra.ends_at is null or ra.ends_at > v_now)
      and (
        (ra.scope_type = 'campaign' and ra.scope_id = p_campaign_slug)
        or (ra.scope_type = 'project' and ra.scope_id = 'tda')
      )
  ) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- operationId is idempotent only for the same verified actor + target.
  if exists (
    select 1
    from public.audit_log al
    where al.campaign_id = v_campaign_id
      and al.action in ('permissions.role.grant', 'permissions.role.revoke')
      and al.new_value ->> 'operationId' = p_operation_id::text
      and (
        al.actor_id is distinct from p_actor_profile_id
        or al.new_value ->> 'targetProfileId'
           is distinct from p_target_profile_id::text
      )
  ) then
    return jsonb_build_object('status', 'validation');
  end if;

  if exists (
    select 1
    from public.audit_log al
    where al.campaign_id = v_campaign_id
      and al.actor_id = p_actor_profile_id
      and al.action in ('permissions.role.grant', 'permissions.role.revoke')
      and al.new_value ->> 'operationId' = p_operation_id::text
      and al.new_value ->> 'targetProfileId' = p_target_profile_id::text
  ) then
    select coalesce(cpr.revision, 0)
      into v_current_revision
    from public.campaign_permission_revisions cpr
    where cpr.campaign_id = v_campaign_id
      and cpr.profile_id = p_target_profile_id;

    return jsonb_build_object(
      'status', 'replayed',
      'revision', coalesce(v_current_revision, 0),
      'operationId', p_operation_id
    );
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_target_profile_id
  ) then
    return jsonb_build_object('status', 'target_not_found');
  end if;

  if not exists (
    select 1
    from public.campaign_members cm
    where cm.campaign_id = v_campaign_id
      and cm.profile_id = p_target_profile_id
  ) and not exists (
    select 1
    from public.role_assignments ra
    where ra.profile_id = p_target_profile_id
      and ra.scope_type = 'campaign'
      and ra.scope_id = p_campaign_slug
  ) then
    return jsonb_build_object('status', 'target_not_in_campaign');
  end if;

  insert into public.campaign_permission_revisions (
    campaign_id,
    profile_id,
    revision
  )
  values (
    v_campaign_id,
    p_target_profile_id,
    0
  )
  on conflict (campaign_id, profile_id) do nothing;

  select cpr.revision
    into v_current_revision
  from public.campaign_permission_revisions cpr
  where cpr.campaign_id = v_campaign_id
    and cpr.profile_id = p_target_profile_id
  for update;

  if v_current_revision is distinct from p_expected_revision then
    return jsonb_build_object(
      'status', 'conflict',
      'revision', v_current_revision
    );
  end if;

  -- Validate the entire batch before the first write.
  for v_change in
    select value
    from jsonb_array_elements(p_changes)
  loop
    v_operation := v_change ->> 'operation';
    v_role_id := (v_change ->> 'roleId')::uuid;

    if not exists (
      select 1
      from public.role_definitions rd
      where rd.id = v_role_id
    ) then
      return jsonb_build_object('status', 'role_not_found');
    end if;

    -- Campaign mutations never mint project authority.
    if exists (
      select 1
      from public.role_permissions rp
      where rp.role_id = v_role_id
        and rp.permission_action like 'project.%'
    ) then
      return jsonb_build_object('status', 'delegation_forbidden');
    end if;

    -- Sensitive campaign authority may only be delegated by someone who
    -- currently has the same effective capability.
    if v_operation = 'grant' and exists (
      select 1
      from public.role_permissions requested
      where requested.role_id = v_role_id
        and requested.permission_action = any(v_sensitive_actions)
        and not exists (
          select 1
          from public.role_assignments actor_assignment
          join public.role_permissions actor_permission
            on actor_permission.role_id = actor_assignment.role_id
          where actor_assignment.profile_id = p_actor_profile_id
            and actor_permission.permission_action =
                requested.permission_action
            and actor_assignment.status = 'active'
            and actor_assignment.starts_at <= v_now
            and (
              actor_assignment.ends_at is null
              or actor_assignment.ends_at > v_now
            )
            and (
              (
                actor_assignment.scope_type = 'campaign'
                and actor_assignment.scope_id = p_campaign_slug
              )
              or (
                actor_assignment.scope_type = 'project'
                and actor_assignment.scope_id = 'tda'
              )
            )
        )
    ) then
      return jsonb_build_object('status', 'delegation_forbidden');
    end if;

    if v_operation = 'grant' then
      if exists (
        select 1
        from public.role_permissions rp
        where rp.role_id = v_role_id
          and rp.permission_action = any(v_sensitive_actions)
      ) and not p_confirm_sensitive then
        return jsonb_build_object(
          'status', 'confirmation_required',
          'kind', 'sensitive_grant'
        );
      end if;

      if exists (
        select 1
        from public.role_assignments ra
        where ra.profile_id = p_target_profile_id
          and ra.role_id = v_role_id
          and ra.scope_type = 'campaign'
          and ra.scope_id = p_campaign_slug
          and ra.status in ('active', 'eligible')
          and ra.ends_at is null
      ) then
        return jsonb_build_object('status', 'duplicate');
      end if;
    else
      v_assignment_id := (v_change ->> 'assignmentId')::uuid;

      if not exists (
        select 1
        from public.role_assignments ra
        where ra.id = v_assignment_id
          and ra.profile_id = p_target_profile_id
          and ra.role_id = v_role_id
          and ra.scope_type = 'campaign'
          and ra.scope_id = p_campaign_slug
          and ra.status = 'active'
          and ra.starts_at <= v_now
          and (ra.ends_at is null or ra.ends_at > v_now)
      ) then
        return jsonb_build_object('status', 'assignment_not_active');
      end if;

      if p_actor_profile_id = p_target_profile_id
         and not p_confirm_self_revoke then
        return jsonb_build_object(
          'status', 'confirmation_required',
          'kind', 'self_revoke'
        );
      end if;

      if exists (
        select 1
        from public.role_permissions rp
        where rp.role_id = v_role_id
          and rp.permission_action = any(v_sensitive_actions)
      ) and not p_confirm_sensitive then
        return jsonb_build_object(
          'status', 'confirmation_required',
          'kind', 'sensitive_revoke'
        );
      end if;

      if exists (
        select 1
        from public.role_permissions rp
        where rp.role_id = v_role_id
          and rp.permission_action = 'campaign.permissions.manage'
      ) and not (
        exists (
          select 1
          from public.role_assignments ra
          join public.role_permissions rp
            on rp.role_id = ra.role_id
          where rp.permission_action = 'campaign.permissions.manage'
            and ra.status = 'active'
            and ra.starts_at <= v_now
            and (ra.ends_at is null or ra.ends_at > v_now)
            and ra.id <> v_assignment_id
            and (
              (
                ra.scope_type = 'campaign'
                and ra.scope_id = p_campaign_slug
              )
              or (
                ra.scope_type = 'project'
                and ra.scope_id = 'tda'
              )
            )
        )
        or exists (
          select 1
          from jsonb_array_elements(p_changes) planned
          join public.role_permissions planned_permission
            on planned_permission.role_id =
               (planned ->> 'roleId')::uuid
          where planned ->> 'operation' = 'grant'
            and planned_permission.permission_action =
                'campaign.permissions.manage'
        )
      ) then
        return jsonb_build_object('status', 'last_admin');
      end if;
    end if;
  end loop;

  -- All business-rule failures above this point are write-free.
  for v_change in
    select value
    from jsonb_array_elements(p_changes)
    where value ->> 'operation' = 'grant'
  loop
    v_role_id := (v_change ->> 'roleId')::uuid;

    insert into public.role_assignments (
      profile_id,
      role_id,
      scope_type,
      scope_id,
      status,
      starts_at,
      assigned_by,
      reason,
      metadata
    )
    values (
      p_target_profile_id,
      v_role_id,
      'campaign',
      p_campaign_slug,
      'active',
      v_now,
      p_actor_profile_id,
      nullif(btrim(p_reason), ''),
      jsonb_build_object(
        'operationId', p_operation_id,
        'source', 'permissions-console'
      )
    )
    returning id into v_inserted_id;

    insert into public.audit_log (
      campaign_id,
      actor_id,
      action,
      table_name,
      record_id,
      old_value,
      new_value
    )
    values (
      v_campaign_id,
      p_actor_profile_id,
      'permissions.role.grant',
      'role_assignments',
      v_inserted_id,
      null,
      jsonb_build_object(
        'operationId', p_operation_id,
        'source', 'permissions-console',
        'targetProfileId', p_target_profile_id,
        'roleId', v_role_id,
        'scopeType', 'campaign',
        'scopeId', p_campaign_slug,
        'status', 'active',
        'reason', nullif(btrim(p_reason), '')
      )
    );
  end loop;

  for v_change in
    select value
    from jsonb_array_elements(p_changes)
    where value ->> 'operation' = 'revoke'
  loop
    v_role_id := (v_change ->> 'roleId')::uuid;
    v_assignment_id := (v_change ->> 'assignmentId')::uuid;

    select
      ra.status,
      ra.starts_at,
      ra.ends_at
    into
      v_old_status,
      v_old_starts_at,
      v_old_ends_at
    from public.role_assignments ra
    where ra.id = v_assignment_id
    for update;

    update public.role_assignments
    set
      status = 'revoked',
      ends_at = v_now,
      revoked_by = p_actor_profile_id,
      reason = coalesce(nullif(btrim(p_reason), ''), reason),
      metadata = metadata || jsonb_build_object(
        'operationId', p_operation_id,
        'source', 'permissions-console'
      ),
      updated_at = v_now
    where id = v_assignment_id;

    insert into public.audit_log (
      campaign_id,
      actor_id,
      action,
      table_name,
      record_id,
      old_value,
      new_value
    )
    values (
      v_campaign_id,
      p_actor_profile_id,
      'permissions.role.revoke',
      'role_assignments',
      v_assignment_id,
      jsonb_build_object(
        'targetProfileId', p_target_profile_id,
        'roleId', v_role_id,
        'scopeType', 'campaign',
        'scopeId', p_campaign_slug,
        'status', v_old_status,
        'startsAt', v_old_starts_at,
        'endsAt', v_old_ends_at
      ),
      jsonb_build_object(
        'operationId', p_operation_id,
        'source', 'permissions-console',
        'targetProfileId', p_target_profile_id,
        'roleId', v_role_id,
        'scopeType', 'campaign',
        'scopeId', p_campaign_slug,
        'status', 'revoked',
        'reason', nullif(btrim(p_reason), '')
      )
    );
  end loop;

  update public.campaign_permission_revisions
  set
    revision = revision + 1,
    updated_at = v_now
  where campaign_id = v_campaign_id
    and profile_id = p_target_profile_id
  returning revision into v_next_revision;

  return jsonb_build_object(
    'status', 'updated',
    'revision', v_next_revision,
    'operationId', p_operation_id
  );
end;
$$;

revoke execute on function public.manage_campaign_role_assignments(
  text, uuid, uuid, bigint, jsonb, uuid, text, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.manage_campaign_role_assignments(
  text, uuid, uuid, bigint, jsonb, uuid, text, boolean, boolean
) to service_role;

comment on table public.campaign_permission_revisions is
  'Target-level optimistic concurrency revision for governed campaign role assignment mutations.';

comment on function public.manage_campaign_role_assignments(
  text, uuid, uuid, bigint, jsonb, uuid, text, boolean, boolean
) is
  'Server-only governed campaign role assignment mutation: validates authority/delegation, CAS, last-admin safety, audit and idempotent replay.';

commit;
