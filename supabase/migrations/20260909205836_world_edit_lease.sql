-- Exclusive World Explorer edit lease.
--
-- This migration prepares a server-only lease/draft boundary for editorial layout.
-- It does not change entities, canon or relation semantics. The public browser never
-- receives direct table access; service_role calls the RPCs after application auth.
create table public.world_edit_leases (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  holder_profile_id uuid not null references public.profiles(id) on delete restrict,
  lease_token uuid not null,
  base_layout_revision bigint not null default 0 check (base_layout_revision >= 0),
  draft_positions jsonb not null default '{}'::jsonb check (jsonb_typeof(draft_positions) = 'object'),
  acquired_at timestamptz not null default clock_timestamp(),
  heartbeat_at timestamptz not null default clock_timestamp(),
  draft_updated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > acquired_at)
);

create index world_edit_leases_holder_profile_idx
  on public.world_edit_leases(holder_profile_id);

alter table public.world_edit_leases enable row level security;
revoke all on public.world_edit_leases from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.world_edit_leases to service_role;

create function public.acquire_world_edit_lease_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_existing public.world_edit_leases%rowtype;
  v_layout_revision bigint := 0;
  v_layout_positions jsonb := '{}'::jsonb;
  v_now timestamptz := clock_timestamp();
  v_holder_label text;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_lease_token is null
     or p_campaign_slug is null
     or p_campaign_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$'
     or not exists (
       select 1
       from public.profiles p
       where p.id = p_actor_profile_id
         and p.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

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
        and a.starts_at <= v_now
        and (a.ends_at is null or a.ends_at > v_now)
        and rp.permission_action = 'campaign.world.layout.edit'
        and (
          (a.scope_type = 'campaign' and a.scope_id = c.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda')
        )
    );

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- A missing lease row cannot be protected by SELECT ... FOR UPDATE. Serialize
  -- acquisition per campaign so two first editors cannot race into a unique-key error.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_campaign_id::text, 0)
  );
  v_now := clock_timestamp();

  select snapshot.revision, snapshot.positions
  into v_layout_revision, v_layout_positions
  from public.world_layout_snapshots snapshot
  where snapshot.campaign_id = v_campaign_id
    and snapshot.view_name = 'overview';

  if not found then
    v_layout_revision := 0;
    v_layout_positions := '{}'::jsonb;
  end if;

  select lease.*
  into v_existing
  from public.world_edit_leases lease
  where lease.campaign_id = v_campaign_id
  for update;

  if found then
    if v_existing.expires_at > v_now then
      if v_existing.holder_profile_id = p_actor_profile_id
         and v_existing.lease_token = p_lease_token then
        update public.world_edit_leases lease
        set heartbeat_at = v_now,
            expires_at = v_now + interval '60 seconds'
        where lease.campaign_id = v_campaign_id
        returning * into v_existing;

        return jsonb_build_object(
          'ok', true,
          'status', 'resumed',
          'baseRevision', v_existing.base_layout_revision,
          'draftPositions', v_existing.draft_positions,
          'expiresAt', v_existing.expires_at
        );
      end if;

      select p.display_name
      into v_holder_label
      from public.profiles p
      where p.id = v_existing.holder_profile_id;

      return jsonb_build_object(
        'ok', false,
        'reason', 'busy',
        'holderLabel', coalesce(v_holder_label, 'Outra pessoa'),
        'sameActor', v_existing.holder_profile_id = p_actor_profile_id,
        'expiresAt', v_existing.expires_at
      );
    end if;

    if v_existing.holder_profile_id = p_actor_profile_id then
      update public.world_edit_leases lease
      set lease_token = p_lease_token,
          heartbeat_at = v_now,
          expires_at = v_now + interval '60 seconds'
      where lease.campaign_id = v_campaign_id
      returning * into v_existing;

      return jsonb_build_object(
        'ok', true,
        'status', 'recovered',
        'baseRevision', v_existing.base_layout_revision,
        'draftPositions', v_existing.draft_positions,
        'expiresAt', v_existing.expires_at
      );
    end if;

    update public.world_edit_leases lease
    set holder_profile_id = p_actor_profile_id,
        lease_token = p_lease_token,
        base_layout_revision = v_layout_revision,
        draft_positions = v_layout_positions,
        acquired_at = v_now,
        heartbeat_at = v_now,
        draft_updated_at = v_now,
        expires_at = v_now + interval '60 seconds'
    where lease.campaign_id = v_campaign_id
    returning * into v_existing;
  else
    insert into public.world_edit_leases(
      campaign_id,
      holder_profile_id,
      lease_token,
      base_layout_revision,
      draft_positions,
      acquired_at,
      heartbeat_at,
      draft_updated_at,
      expires_at
    )
    values (
      v_campaign_id,
      p_actor_profile_id,
      p_lease_token,
      v_layout_revision,
      v_layout_positions,
      v_now,
      v_now,
      v_now,
      v_now + interval '60 seconds'
    )
    returning * into v_existing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'acquired',
    'baseRevision', v_existing.base_layout_revision,
    'draftPositions', v_existing.draft_positions,
    'expiresAt', v_existing.expires_at
  );
end;
$$;

create function public.renew_world_edit_lease_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_existing public.world_edit_leases%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_lease_token is null
     or not exists (
       select 1
       from public.profiles p
       where p.id = p_actor_profile_id
         and p.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

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
        and a.starts_at <= v_now
        and (a.ends_at is null or a.ends_at > v_now)
        and rp.permission_action = 'campaign.world.layout.edit'
        and (
          (a.scope_type = 'campaign' and a.scope_id = c.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda')
        )
    );

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select lease.*
  into v_existing
  from public.world_edit_leases lease
  where lease.campaign_id = v_campaign_id
  for update;

  v_now := clock_timestamp();
  if not found
     or v_existing.holder_profile_id <> p_actor_profile_id
     or v_existing.lease_token <> p_lease_token
     or v_existing.expires_at <= v_now then
    return jsonb_build_object('ok', false, 'reason', 'lease_lost');
  end if;

  update public.world_edit_leases lease
  set heartbeat_at = v_now,
      expires_at = v_now + interval '60 seconds'
  where lease.campaign_id = v_campaign_id
  returning * into v_existing;

  return jsonb_build_object(
    'ok', true,
    'status', 'renewed',
    'expiresAt', v_existing.expires_at
  );
end;
$$;

create function public.save_world_edit_layout_draft_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_lease_token uuid,
  p_positions jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_existing public.world_edit_leases%rowtype;
  v_now timestamptz := clock_timestamp();
  v_node_id text;
  v_position jsonb;
  v_current_revision bigint := 0;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_lease_token is null
     or p_positions is null
     or jsonb_typeof(p_positions) <> 'object'
     or not exists (
       select 1
       from public.profiles p
       where p.id = p_actor_profile_id
         and p.auth_user_id = p_auth_user_id
     ) then
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
       or jsonb_typeof(v_position) <> 'object'
       or not (v_position ? 'x')
       or not (v_position ? 'y')
       or exists (
         select 1
         from jsonb_object_keys(v_position) as k(key_name)
         where k.key_name not in ('x', 'y')
       )
       or jsonb_typeof(v_position->'x') <> 'number'
       or jsonb_typeof(v_position->'y') <> 'number'
       or abs((v_position->>'x')::numeric) > 5000
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
        and a.starts_at <= v_now
        and (a.ends_at is null or a.ends_at > v_now)
        and rp.permission_action = 'campaign.world.layout.edit'
        and (
          (a.scope_type = 'campaign' and a.scope_id = c.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda')
        )
    );

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select lease.*
  into v_existing
  from public.world_edit_leases lease
  where lease.campaign_id = v_campaign_id
  for update;

  v_now := clock_timestamp();
  if not found
     or v_existing.holder_profile_id <> p_actor_profile_id
     or v_existing.lease_token <> p_lease_token
     or v_existing.expires_at <= v_now then
    return jsonb_build_object('ok', false, 'reason', 'lease_lost');
  end if;

  select snapshot.revision
  into v_current_revision
  from public.world_layout_snapshots snapshot
  where snapshot.campaign_id = v_campaign_id
    and snapshot.view_name = 'overview';

  if not found then
    v_current_revision := 0;
  end if;

  -- Preserve the latest private draft even when publication has moved forward. The
  -- caller gets a conflict and can reconcile without silently losing its composition.
  update public.world_edit_leases lease
  set draft_positions = p_positions,
      draft_updated_at = v_now,
      heartbeat_at = v_now,
      expires_at = v_now + interval '60 seconds'
  where lease.campaign_id = v_campaign_id
  returning * into v_existing;

  if v_current_revision <> v_existing.base_layout_revision then
    return jsonb_build_object(
      'ok', false,
      'reason', 'conflict',
      'revision', v_current_revision
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'draft_saved',
    'baseRevision', v_existing.base_layout_revision,
    'expiresAt', v_existing.expires_at
  );
end;
$$;

create function public.publish_world_edit_layout_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_existing public.world_edit_leases%rowtype;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_lease_token is null
     or not exists (
       select 1
       from public.profiles p
       where p.id = p_actor_profile_id
         and p.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

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
        and a.starts_at <= v_now
        and (a.ends_at is null or a.ends_at > v_now)
        and rp.permission_action = 'campaign.world.layout.edit'
        and (
          (a.scope_type = 'campaign' and a.scope_id = c.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda')
        )
    );

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select lease.*
  into v_existing
  from public.world_edit_leases lease
  where lease.campaign_id = v_campaign_id
  for update;

  v_now := clock_timestamp();
  if not found
     or v_existing.holder_profile_id <> p_actor_profile_id
     or v_existing.lease_token <> p_lease_token
     or v_existing.expires_at <= v_now then
    return jsonb_build_object('ok', false, 'reason', 'lease_lost');
  end if;

  v_result := public.save_world_layout_snapshot_atomic(
    p_auth_user_id,
    p_actor_profile_id,
    p_campaign_slug,
    v_existing.base_layout_revision,
    v_existing.draft_positions
  );

  if coalesce((v_result->>'ok')::boolean, false) then
    delete from public.world_edit_leases lease
    where lease.campaign_id = v_campaign_id
      and lease.holder_profile_id = p_actor_profile_id
      and lease.lease_token = p_lease_token;
  end if;

  return v_result;
end;
$$;

create function public.release_world_edit_lease_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_lease_token uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_lease_token is null
     or not exists (
       select 1
       from public.profiles p
       where p.id = p_actor_profile_id
         and p.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select c.id
  into v_campaign_id
  from public.campaigns c
  where c.slug = p_campaign_slug;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  delete from public.world_edit_leases lease
  where lease.campaign_id = v_campaign_id
    and lease.holder_profile_id = p_actor_profile_id
    and lease.lease_token = p_lease_token;

  return jsonb_build_object('ok', true, 'status', 'released');
end;
$$;

revoke all on function public.acquire_world_edit_lease_atomic(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.renew_world_edit_lease_atomic(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.save_world_edit_layout_draft_atomic(uuid, uuid, text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.publish_world_edit_layout_atomic(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.release_world_edit_lease_atomic(uuid, uuid, text, uuid)
  from public, anon, authenticated;

grant execute on function public.acquire_world_edit_lease_atomic(uuid, uuid, text, uuid) to service_role;
grant execute on function public.renew_world_edit_lease_atomic(uuid, uuid, text, uuid) to service_role;
grant execute on function public.save_world_edit_layout_draft_atomic(uuid, uuid, text, uuid, jsonb) to service_role;
grant execute on function public.publish_world_edit_layout_atomic(uuid, uuid, text, uuid) to service_role;
grant execute on function public.release_world_edit_lease_atomic(uuid, uuid, text, uuid) to service_role;
