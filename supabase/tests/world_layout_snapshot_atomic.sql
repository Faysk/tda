\set ON_ERROR_STOP on

-- Applied state defines the capability and grants it only to the existing site_editor role.
do $$
begin
  if not exists (
    select 1 from public.permission_catalog
    where action = 'campaign.world.layout.edit' and plane = 'narrative'
  ) then
    raise exception 'world layout capability was not defined';
  end if;
  if not exists (
    select 1
    from public.role_permissions rp
    join public.role_definitions rd on rd.id = rp.role_id
    where rp.permission_action = 'campaign.world.layout.edit'
      and rd.slug = 'site_editor'
      and rd.plane = 'narrative'
  ) then
    raise exception 'site_editor must receive world layout capability';
  end if;
  if (select count(*) from public.role_permissions where permission_action = 'campaign.world.layout.edit') <> 1 then
    raise exception 'world layout capability must not be granted to broader synthetic roles';
  end if;
  if exists (
    select 1 from public.role_assignments
    where role_id = '55555555-5555-4555-8555-555555555555'
  ) then
    raise exception 'capability migration must not create profile assignments';
  end if;

  if has_function_privilege(
    'anon',
    'public.save_world_layout_snapshot_atomic(uuid,uuid,text,bigint,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'anon must not execute world layout mutation';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.save_world_layout_snapshot_atomic(uuid,uuid,text,bigint,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must not execute world layout mutation directly';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.save_world_layout_snapshot_atomic(uuid,uuid,text,bigint,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'service_role must execute world layout mutation';
  end if;
  if has_table_privilege('anon', 'public.world_layout_snapshots', 'SELECT')
     or has_table_privilege('authenticated', 'public.world_layout_snapshots', 'SELECT') then
    raise exception 'world layout table must remain server-only';
  end if;
  if has_table_privilege('service_role', 'public.world_layout_snapshots', 'DELETE') then
    raise exception 'service_role must not receive DELETE';
  end if;
  if not has_table_privilege('service_role', 'public.world_layout_snapshots', 'SELECT')
     or not has_table_privilege('service_role', 'public.world_layout_snapshots', 'INSERT')
     or not has_table_privilege('service_role', 'public.world_layout_snapshots', 'UPDATE') then
    raise exception 'service_role must retain only the required World layout table privileges';
  end if;
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'world_layout_snapshots'
      and c.relrowsecurity
  ) then
    raise exception 'world layout table must have RLS enabled';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'world_layout_snapshots'
  ) then
    raise exception 'world layout storage must remain deny-by-default with no browser policy';
  end if;
end;
$$;

set role service_role;
do $$
declare
  result jsonb;
begin
  result := public.save_world_layout_snapshot_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    0,
    '{"node-a":{"x":100,"y":-50}}'::jsonb
  );
  if result <> '{"ok":false,"reason":"forbidden"}'::jsonb then
    raise exception 'write without an active site_editor assignment must be forbidden: %', result;
  end if;
end;
$$;
reset role;

insert into public.role_assignments(profile_id, role_id, scope_type, scope_id, status, starts_at)
values (
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  'campaign',
  'synthetic-campaign',
  'active',
  now() - interval '1 minute'
);

set role service_role;
do $$
declare
  result jsonb;
begin
  result := public.save_world_layout_snapshot_atomic(
    '66666666-6666-4666-8666-666666666666',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    0,
    '{}'::jsonb
  );
  if result <> '{"ok":false,"reason":"forbidden"}'::jsonb then
    raise exception 'unbound auth identity must be forbidden: %', result;
  end if;

  result := public.save_world_layout_snapshot_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'other-campaign',
    0,
    '{}'::jsonb
  );
  if result <> '{"ok":false,"reason":"forbidden"}'::jsonb then
    raise exception 'wrong campaign must be forbidden without disclosure: %', result;
  end if;

  for result in
    select public.save_world_layout_snapshot_atomic(
      '44444444-4444-4444-8444-444444444444',
      '33333333-3333-4333-8333-333333333333',
      'synthetic-campaign',
      0,
      payload
    )
    from (values
      ('[]'::jsonb),
      ('{"node-a":{"x":6000,"y":0}}'::jsonb),
      ('{"node-a":{"x":0}}'::jsonb),
      ('{"node-a":{"x":0,"y":0,"z":1}}'::jsonb),
      ('{"bad node":{"x":0,"y":0}}'::jsonb)
    ) as malformed(payload)
  loop
    if result <> '{"ok":false,"reason":"invalid_payload"}'::jsonb then
      raise exception 'malformed layout must be rejected: %', result;
    end if;
  end loop;

  result := public.save_world_layout_snapshot_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    0,
    '{"node-a":{"x":100,"y":-50}}'::jsonb
  );
  if result <> '{"ok":true,"status":"saved","revision":1}'::jsonb then
    raise exception 'initial save failed: %', result;
  end if;
  if (select revision from public.world_layout_snapshots) <> 1
     or (select positions from public.world_layout_snapshots) <> '{"node-a":{"x":100,"y":-50}}'::jsonb
     or (select count(*) from public.audit_log where action = 'world_layout.update') <> 1 then
    raise exception 'initial save invariants failed';
  end if;

  result := public.save_world_layout_snapshot_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    1,
    '{"node-a":{"x":100,"y":-50}}'::jsonb
  );
  if result <> '{"ok":true,"status":"unchanged","revision":1}'::jsonb
     or (select count(*) from public.audit_log where action = 'world_layout.update') <> 1 then
    raise exception 'no-op save must not bump revision or audit: %', result;
  end if;

  result := public.save_world_layout_snapshot_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    0,
    '{"node-a":{"x":200,"y":-50}}'::jsonb
  );
  if result <> '{"ok":false,"reason":"conflict","revision":1}'::jsonb
     or (select revision from public.world_layout_snapshots) <> 1
     or (select count(*) from public.audit_log where action = 'world_layout.update') <> 1 then
    raise exception 'stale writer must conflict without mutation: %', result;
  end if;

  result := public.save_world_layout_snapshot_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    1,
    '{"node-a":{"x":200,"y":-50},"node-b":{"x":-320,"y":75}}'::jsonb
  );
  if result <> '{"ok":true,"status":"saved","revision":2}'::jsonb then
    raise exception 'second save failed: %', result;
  end if;
  if (select revision from public.world_layout_snapshots) <> 2
     or (select count(*) from public.audit_log where action = 'world_layout.update') <> 2
     or not exists (
       select 1 from public.audit_log
       where action = 'world_layout.update'
         and old_value->>'revision' = '1'
         and new_value->>'revision' = '2'
         and old_value->'positions' = '{"node-a":{"x":100,"y":-50}}'::jsonb
         and new_value->'positions' = '{"node-a":{"x":200,"y":-50},"node-b":{"x":-320,"y":75}}'::jsonb
     ) then
    raise exception 'revision/audit transition invariants failed';
  end if;
end;
$$;
reset role;

create function public.fail_world_layout_audit()
returns trigger
language plpgsql
as $$
begin
  raise exception 'synthetic world layout audit failure';
end;
$$;
create trigger fail_world_layout_audit
before insert on public.audit_log
for each row execute function public.fail_world_layout_audit();

set role service_role;
do $$
declare
  failure_seen boolean := false;
begin
  begin
    perform public.save_world_layout_snapshot_atomic(
      '44444444-4444-4444-8444-444444444444',
      '33333333-3333-4333-8333-333333333333',
      'synthetic-campaign',
      2,
      '{"node-a":{"x":240,"y":-40}}'::jsonb
    );
  exception
    when others then
      if position('synthetic world layout audit failure' in sqlerrm) > 0 then
        failure_seen := true;
      else
        raise;
      end if;
  end;

  if not failure_seen then
    raise exception 'expected synthetic audit failure was not raised';
  end if;
  if (select revision from public.world_layout_snapshots) <> 2
     or (select count(*) from public.audit_log where action = 'world_layout.update') <> 2 then
    raise exception 'audit failure must roll back the snapshot update';
  end if;
end;
$$;
reset role;

drop trigger fail_world_layout_audit on public.audit_log;
drop function public.fail_world_layout_audit();
