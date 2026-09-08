-- Candidate only: do not apply to the canonical Supabase before the deliberate
-- database activation gate. This storage is presentation-only and must never be
-- treated as canon, entity data or relation data.
create table public.world_layout_snapshots (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  view_name text not null check (view_name = 'overview'),
  schema_version smallint not null check (schema_version = 1),
  revision bigint not null default 0 check (revision >= 0),
  positions jsonb not null default '{}'::jsonb check (jsonb_typeof(positions) = 'object'),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (campaign_id, view_name)
);

create index world_layout_snapshots_updated_by_idx
  on public.world_layout_snapshots(updated_by);

alter table public.world_layout_snapshots enable row level security;
revoke all on public.world_layout_snapshots from public, anon, authenticated;
grant select, insert, update on public.world_layout_snapshots to service_role;

create function public.save_world_layout_snapshot_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_expected_revision bigint,
  p_positions jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_existing public.world_layout_snapshots%rowtype;
  v_saved public.world_layout_snapshots%rowtype;
  v_node_id text;
  v_position jsonb;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or not exists (
       select 1
       from public.profiles p
       where p.id = p_actor_profile_id
         and p.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if not exists (
    select 1
    from public.permission_catalog pc
    where pc.action = 'campaign.world.layout.edit'
      and pc.plane = 'narrative'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'layout_capability_undefined');
  end if;

  if p_campaign_slug is null
     or char_length(p_campaign_slug) not between 1 and 160
     or p_expected_revision is null
     or p_expected_revision < 0
     or p_positions is null
     or jsonb_typeof(p_positions) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if (select count(*) from jsonb_object_keys(p_positions)) > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  for v_node_id, v_position in
    select item.key, item.value
    from jsonb_each(p_positions) as item(key, value)
  loop
    if char_length(v_node_id) not between 1 and 160
       or v_node_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
       or jsonb_typeof(v_position) <> 'object' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if not (v_position ? 'x')
       or not (v_position ? 'y')
       or exists (
         select 1
         from jsonb_object_keys(v_position) as k(key_name)
         where k.key_name not in ('x', 'y')
       )
       or jsonb_typeof(v_position->'x') <> 'number'
       or jsonb_typeof(v_position->'y') <> 'number' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;

    if abs((v_position->>'x')::numeric) > 5000
       or abs((v_position->>'y')::numeric) > 5000 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
  end loop;

  select c.id
  into v_campaign_id
  from public.campaigns c
  where c.slug = p_campaign_slug
    and exists (
      select 1
      from public.role_assignments a
      join public.role_permissions rp on rp.role_id = a.role_id
      where a.profile_id = p_actor_profile_id
        and a.status = 'active'
        and a.starts_at <= clock_timestamp()
        and (a.ends_at is null or a.ends_at > clock_timestamp())
        and rp.permission_action = 'campaign.world.layout.edit'
        and (
          (a.scope_type = 'campaign' and a.scope_id = c.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda')
        )
    );

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select snapshot.*
  into v_existing
  from public.world_layout_snapshots snapshot
  where snapshot.campaign_id = v_campaign_id
    and snapshot.view_name = 'overview'
  for update;

  if not found then
    if p_expected_revision <> 0 then
      return jsonb_build_object(
        'ok', false,
        'reason', 'conflict',
        'revision', 0
      );
    end if;

    insert into public.world_layout_snapshots(
      campaign_id,
      view_name,
      schema_version,
      revision,
      positions,
      updated_by
    )
    values (
      v_campaign_id,
      'overview',
      1,
      1,
      p_positions,
      p_actor_profile_id
    )
    on conflict (campaign_id, view_name) do nothing
    returning * into v_saved;

    if not found then
      select snapshot.*
      into v_existing
      from public.world_layout_snapshots snapshot
      where snapshot.campaign_id = v_campaign_id
        and snapshot.view_name = 'overview'
      for update;

      return jsonb_build_object(
        'ok', false,
        'reason', 'conflict',
        'revision', coalesce(v_existing.revision, 0)
      );
    end if;

    insert into public.audit_log(
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
      'world_layout.update',
      'world_layout_snapshots',
      v_saved.id,
      null,
      jsonb_build_object(
        'schemaVersion', v_saved.schema_version,
        'view', v_saved.view_name,
        'revision', v_saved.revision,
        'positions', v_saved.positions
      )
    );

    return jsonb_build_object(
      'ok', true,
      'status', 'saved',
      'revision', v_saved.revision
    );
  end if;

  if v_existing.revision <> p_expected_revision then
    return jsonb_build_object(
      'ok', false,
      'reason', 'conflict',
      'revision', v_existing.revision
    );
  end if;

  if v_existing.positions = p_positions then
    return jsonb_build_object(
      'ok', true,
      'status', 'unchanged',
      'revision', v_existing.revision
    );
  end if;

  update public.world_layout_snapshots snapshot
  set positions = p_positions,
      schema_version = 1,
      revision = snapshot.revision + 1,
      updated_by = p_actor_profile_id,
      updated_at = clock_timestamp()
  where snapshot.id = v_existing.id
  returning * into v_saved;

  insert into public.audit_log(
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
    'world_layout.update',
    'world_layout_snapshots',
    v_saved.id,
    jsonb_build_object(
      'schemaVersion', v_existing.schema_version,
      'view', v_existing.view_name,
      'revision', v_existing.revision,
      'positions', v_existing.positions
    ),
    jsonb_build_object(
      'schemaVersion', v_saved.schema_version,
      'view', v_saved.view_name,
      'revision', v_saved.revision,
      'positions', v_saved.positions
    )
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'saved',
    'revision', v_saved.revision
  );
end;
$$;

revoke all on function public.save_world_layout_snapshot_atomic(uuid, uuid, text, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_world_layout_snapshot_atomic(uuid, uuid, text, bigint, jsonb)
  to service_role;
