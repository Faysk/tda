-- Canonical World graph authoring on top of the exclusive World edit lease.
--
-- Manual authoring remains server-only and requires BOTH campaign.content.edit
-- and a live campaign.world.layout.edit lease. Browser roles never receive direct
-- table/RPC access. AI/extracted candidates are not promoted by this migration.

create table public.relation_types (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  slug text not null,
  label text not null,
  directionality text not null check (directionality in ('directed', 'symmetric')),
  family text not null check (family in (
    'affinity', 'family', 'conflict', 'authority', 'faction',
    'origin', 'mystic', 'creative', 'context'
  )),
  description text not null default '',
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (campaign_id, slug),
  check (slug ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  check (char_length(label) between 1 and 80),
  check (char_length(description) <= 1000)
);

create table public.world_relation_styles (
  campaign_id uuid not null,
  relation_type_slug text not null,
  color text not null default '#8f9aa8' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  line_style text not null default 'solid' check (line_style in ('solid', 'dashed', 'dotted')),
  line_width numeric(3,1) not null default 3.0 check (line_width between 1 and 8),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (campaign_id, relation_type_slug),
  foreign key (campaign_id, relation_type_slug)
    references public.relation_types(campaign_id, slug) on delete cascade
);

create table public.entity_relations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  source_entity_id uuid not null references public.entities(id) on delete restrict,
  target_entity_id uuid not null references public.entities(id) on delete restrict,
  relation_type_slug text not null,
  label_override text,
  status text not null default 'active' check (status in (
    'active', 'ended', 'superseded', 'retcon_pending', 'archived'
  )),
  visibility text not null default 'private_players' check (visibility in (
    'private_master', 'private_players', 'review_only', 'public_campaign', 'public_web'
  )),
  color_override text check (color_override is null or color_override ~ '^#[0-9A-Fa-f]{6}$'),
  line_style_override text check (line_style_override is null or line_style_override in ('solid', 'dashed', 'dotted')),
  line_width_override numeric(3,1) check (line_width_override is null or line_width_override between 1 and 8),
  revision bigint not null default 0 check (revision >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (campaign_id, relation_type_slug)
    references public.relation_types(campaign_id, slug) on delete restrict,
  check (source_entity_id <> target_entity_id),
  check (label_override is null or char_length(label_override) between 1 and 120)
);

create index entity_relations_campaign_status_idx
  on public.entity_relations(campaign_id, status);
create index entity_relations_source_idx
  on public.entity_relations(campaign_id, source_entity_id);
create index entity_relations_target_idx
  on public.entity_relations(campaign_id, target_entity_id);
create index entity_relations_type_idx
  on public.entity_relations(campaign_id, relation_type_slug);

create table public.entity_relation_sources (
  relation_id uuid not null references public.entity_relations(id) on delete cascade,
  canon_entry_id uuid not null references public.canon_entries(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (relation_id, canon_entry_id)
);

create table public.world_graph_heads (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.world_graph_revisions (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  revision bigint not null check (revision > 0),
  actor_id uuid references public.profiles(id) on delete set null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (campaign_id, revision)
);

alter table public.world_edit_leases
  add column base_graph_revision bigint not null default 0 check (base_graph_revision >= 0),
  add column draft_graph jsonb not null default '{}'::jsonb check (jsonb_typeof(draft_graph) = 'object'),
  add column graph_draft_initialized boolean not null default false;

-- If an expired lease is taken by a DIFFERENT editor, never carry the previous
-- editor's private factual draft into the new session. Same-editor recovery keeps it.
create function public.reset_world_graph_draft_on_lease_handoff()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if old.holder_profile_id is distinct from new.holder_profile_id then
    new.base_graph_revision := 0;
    new.draft_graph := '{}'::jsonb;
    new.graph_draft_initialized := false;
  end if;
  return new;
end;
$$;

create trigger world_edit_lease_graph_handoff
before update of holder_profile_id on public.world_edit_leases
for each row execute function public.reset_world_graph_draft_on_lease_handoff();

alter table public.relation_types enable row level security;
alter table public.world_relation_styles enable row level security;
alter table public.entity_relations enable row level security;
alter table public.entity_relation_sources enable row level security;
alter table public.world_graph_heads enable row level security;
alter table public.world_graph_revisions enable row level security;

revoke all on public.relation_types from public, anon, authenticated, service_role;
revoke all on public.world_relation_styles from public, anon, authenticated, service_role;
revoke all on public.entity_relations from public, anon, authenticated, service_role;
revoke all on public.entity_relation_sources from public, anon, authenticated, service_role;
revoke all on public.world_graph_heads from public, anon, authenticated, service_role;
revoke all on public.world_graph_revisions from public, anon, authenticated, service_role;

grant select, insert, update on public.relation_types to service_role;
grant select, insert, update on public.world_relation_styles to service_role;
grant select, insert, update on public.entity_relations to service_role;
grant select on public.entity_relation_sources to service_role;
grant select, insert, update on public.world_graph_heads to service_role;
grant select, insert on public.world_graph_revisions to service_role;

create function public.world_graph_snapshot_json(p_campaign_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'revision', coalesce((
      select h.revision from public.world_graph_heads h where h.campaign_id = p_campaign_id
    ), 0),
    'nodes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id::text,
          'name', e.name,
          'slug', e.slug,
          'entityType', e.entity_type,
          'status', coalesce(e.status, 'active'),
          'visibility', coalesce(e.visibility, 'private_players'),
          'summary', coalesce(e.summary, ''),
          'aliases', to_jsonb(e.aliases)
        ) order by e.id::text
      )
      from public.entities e
      where e.campaign_id = p_campaign_id
    ), '[]'::jsonb),
    'relationTypes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'slug', t.slug,
          'label', t.label,
          'direction', t.directionality,
          'family', t.family,
          'description', t.description,
          'isActive', t.is_active,
          'color', coalesce(s.color, '#8f9aa8'),
          'lineStyle', coalesce(s.line_style, 'solid'),
          'lineWidth', coalesce(s.line_width, 3.0)
        ) order by t.slug
      )
      from public.relation_types t
      left join public.world_relation_styles s
        on s.campaign_id = t.campaign_id and s.relation_type_slug = t.slug
      where t.campaign_id = p_campaign_id
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id::text,
          'source', r.source_entity_id::text,
          'target', r.target_entity_id::text,
          'relationType', r.relation_type_slug,
          'labelOverride', r.label_override,
          'status', r.status,
          'visibility', r.visibility,
          'colorOverride', r.color_override,
          'lineStyleOverride', r.line_style_override,
          'lineWidthOverride', r.line_width_override
        ) order by r.id::text
      )
      from public.entity_relations r
      where r.campaign_id = p_campaign_id
    ), '[]'::jsonb)
  );
$$;

create function public.acquire_world_graph_draft_atomic(
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
  v_lease public.world_edit_leases%rowtype;
  v_now timestamptz := clock_timestamp();
  v_revision bigint := 0;
  v_draft jsonb;
begin
  if p_auth_user_id is null or p_actor_profile_id is null or p_lease_token is null
     or not exists (
       select 1 from public.profiles p
       where p.id = p_actor_profile_id and p.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select c.id into v_campaign_id
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
        and rp.permission_action = 'campaign.content.edit'
        and ((a.scope_type = 'campaign' and a.scope_id = c.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda'))
    );
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select lease.* into v_lease
  from public.world_edit_leases lease
  where lease.campaign_id = v_campaign_id
  for update;
  v_now := clock_timestamp();
  if not found
     or v_lease.holder_profile_id <> p_actor_profile_id
     or v_lease.lease_token <> p_lease_token
     or v_lease.expires_at <= v_now then
    return jsonb_build_object('ok', false, 'reason', 'lease_lost');
  end if;

  insert into public.world_graph_heads(campaign_id, revision, updated_by)
  values (v_campaign_id, 0, p_actor_profile_id)
  on conflict (campaign_id) do nothing;

  select h.revision into v_revision
  from public.world_graph_heads h
  where h.campaign_id = v_campaign_id;

  if not v_lease.graph_draft_initialized then
    v_draft := public.world_graph_snapshot_json(v_campaign_id);
    update public.world_edit_leases lease
    set base_graph_revision = v_revision,
        draft_graph = v_draft,
        graph_draft_initialized = true,
        heartbeat_at = v_now,
        expires_at = v_now + interval '60 seconds'
    where lease.campaign_id = v_campaign_id
    returning * into v_lease;
  else
    v_draft := v_lease.draft_graph;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', case when v_lease.graph_draft_initialized then 'ready' else 'ready' end,
    'baseRevision', v_lease.base_graph_revision,
    'draftGraph', v_draft,
    'expiresAt', v_lease.expires_at
  );
end;
$$;

create function public.save_world_graph_draft_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_lease_token uuid,
  p_draft jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_lease public.world_edit_leases%rowtype;
  v_now timestamptz := clock_timestamp();
  v_revision bigint := 0;
begin
  if p_auth_user_id is null or p_actor_profile_id is null or p_lease_token is null
     or p_draft is null or jsonb_typeof(p_draft) <> 'object'
     or p_draft->>'schemaVersion' <> '1'
     or jsonb_typeof(p_draft->'nodes') <> 'array'
     or jsonb_typeof(p_draft->'edges') <> 'array'
     or jsonb_typeof(p_draft->'relationTypes') <> 'array'
     or jsonb_array_length(p_draft->'nodes') > 1000
     or jsonb_array_length(p_draft->'edges') > 5000
     or jsonb_array_length(p_draft->'relationTypes') > 200
     or octet_length(p_draft::text) > 2097152
     or not exists (
       select 1 from public.profiles p
       where p.id = p_actor_profile_id and p.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select c.id into v_campaign_id
  from public.campaigns c
  where c.slug = p_campaign_slug
    and exists (
      select 1 from public.role_assignments a
      join public.role_permissions rp on rp.role_id = a.role_id
      where a.profile_id = p_actor_profile_id
        and a.status = 'active'
        and a.starts_at <= v_now
        and (a.ends_at is null or a.ends_at > v_now)
        and rp.permission_action = 'campaign.content.edit'
        and ((a.scope_type = 'campaign' and a.scope_id = c.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda'))
    );
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select lease.* into v_lease
  from public.world_edit_leases lease
  where lease.campaign_id = v_campaign_id
  for update;
  v_now := clock_timestamp();
  if not found
     or v_lease.holder_profile_id <> p_actor_profile_id
     or v_lease.lease_token <> p_lease_token
     or v_lease.expires_at <= v_now
     or not v_lease.graph_draft_initialized then
    return jsonb_build_object('ok', false, 'reason', 'lease_lost');
  end if;

  if not ((p_draft->>'revision') ~ '^[0-9]+$')
     or (p_draft->>'revision')::bigint <> v_lease.base_graph_revision then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  select h.revision into v_revision
  from public.world_graph_heads h
  where h.campaign_id = v_campaign_id;
  if not found then v_revision := 0; end if;

  update public.world_edit_leases lease
  set draft_graph = p_draft,
      heartbeat_at = v_now,
      expires_at = v_now + interval '60 seconds'
  where lease.campaign_id = v_campaign_id;

  if v_revision <> v_lease.base_graph_revision then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'revision', v_revision);
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'draft_saved',
    'baseRevision', v_lease.base_graph_revision,
    'expiresAt', v_now + interval '60 seconds'
  );
end;
$$;

create function public.publish_world_edit_state_atomic(
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
  v_lease public.world_edit_leases%rowtype;
  v_now timestamptz := clock_timestamp();
  v_head_revision bigint := 0;
  v_old_graph jsonb;
  v_new_graph jsonb;
  v_layout_result jsonb;
  v_graph_changed boolean := false;
  v_next_revision bigint;
  v_node jsonb;
  v_type jsonb;
  v_edge jsonb;
  v_node_id uuid;
  v_source uuid;
  v_target uuid;
  v_tmp uuid;
  v_edge_id uuid;
  v_type_slug text;
  v_direction text;
  v_aliases text[];
begin
  if p_auth_user_id is null or p_actor_profile_id is null or p_lease_token is null
     or not exists (
       select 1 from public.profiles p
       where p.id = p_actor_profile_id and p.auth_user_id = p_auth_user_id
     ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select c.id into v_campaign_id
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
        and rp.permission_action = 'campaign.content.edit'
        and ((a.scope_type = 'campaign' and a.scope_id = c.slug)
          or (a.scope_type = 'project' and a.scope_id = 'tda'))
    );
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select lease.* into v_lease
  from public.world_edit_leases lease
  where lease.campaign_id = v_campaign_id
  for update;
  v_now := clock_timestamp();
  if not found
     or v_lease.holder_profile_id <> p_actor_profile_id
     or v_lease.lease_token <> p_lease_token
     or v_lease.expires_at <= v_now
     or not v_lease.graph_draft_initialized then
    return jsonb_build_object('ok', false, 'reason', 'lease_lost');
  end if;

  insert into public.world_graph_heads(campaign_id, revision, updated_by)
  values (v_campaign_id, 0, p_actor_profile_id)
  on conflict (campaign_id) do nothing;

  select h.revision into v_head_revision
  from public.world_graph_heads h
  where h.campaign_id = v_campaign_id
  for update;

  if v_head_revision <> v_lease.base_graph_revision then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'revision', v_head_revision);
  end if;

  if jsonb_typeof(v_lease.draft_graph) <> 'object'
     or v_lease.draft_graph->>'schemaVersion' <> '1'
     or jsonb_typeof(v_lease.draft_graph->'nodes') <> 'array'
     or jsonb_typeof(v_lease.draft_graph->'edges') <> 'array'
     or jsonb_typeof(v_lease.draft_graph->'relationTypes') <> 'array'
     or jsonb_array_length(v_lease.draft_graph->'nodes') > 1000
     or jsonb_array_length(v_lease.draft_graph->'edges') > 5000
     or jsonb_array_length(v_lease.draft_graph->'relationTypes') > 200 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  -- Validate relation type definitions before any write.
  for v_type in select value from jsonb_array_elements(v_lease.draft_graph->'relationTypes')
  loop
    if jsonb_typeof(v_type) <> 'object'
       or coalesce(v_type->>'slug','') !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
       or char_length(btrim(coalesce(v_type->>'label',''))) not between 1 and 80
       or v_type->>'direction' not in ('directed','symmetric')
       or v_type->>'family' not in ('affinity','family','conflict','authority','faction','origin','mystic','creative','context')
       or char_length(coalesce(v_type->>'description','')) > 1000
       or coalesce(v_type->>'color','') !~ '^#[0-9A-Fa-f]{6}$'
       or v_type->>'lineStyle' not in ('solid','dashed','dotted')
       or not ((v_type->>'lineWidth') ~ '^[0-9]+([.][0-9]+)?$')
       or (v_type->>'lineWidth')::numeric not between 1 and 8 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
  end loop;

  if exists (
    select 1 from (
      select value->>'slug' slug, count(*) n
      from jsonb_array_elements(v_lease.draft_graph->'relationTypes')
      group by value->>'slug'
    ) d where d.n > 1
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  -- Validate every entity draft record and prevent collisions with legacy unique keys.
  for v_node in select value from jsonb_array_elements(v_lease.draft_graph->'nodes')
  loop
    begin v_node_id := (v_node->>'id')::uuid; exception when others then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end;
    if jsonb_typeof(v_node) <> 'object'
       or char_length(btrim(coalesce(v_node->>'name',''))) not between 1 and 160
       or coalesce(v_node->>'entityType','') not in ('pc','npc','location','item','organization','faction','arc','concept','song','quest','other')
       or char_length(coalesce(v_node->>'status','active')) not between 1 and 32
       or coalesce(v_node->>'visibility','') not in ('private_master','private_players','review_only','public_campaign','public_web')
       or char_length(coalesce(v_node->>'summary','')) > 4000
       or (v_node->'aliases' is not null and jsonb_typeof(v_node->'aliases') <> 'array')
       or (v_node->>'slug' is not null and coalesce(v_node->>'slug','') !~ '^[a-z0-9][a-z0-9-]{0,95}$') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    if jsonb_array_length(coalesce(v_node->'aliases','[]'::jsonb)) > 50
       or exists (
         select 1 from jsonb_array_elements_text(coalesce(v_node->'aliases','[]'::jsonb)) a(alias)
         where char_length(a.alias) not between 1 and 160
       ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    if exists (
      select 1 from public.entities e
      where e.id = v_node_id and e.campaign_id <> v_campaign_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    if exists (
      select 1 from public.entities e
      where e.campaign_id = v_campaign_id
        and e.id <> v_node_id
        and (e.name = btrim(v_node->>'name')
          or ((v_node->>'slug') is not null and e.slug = v_node->>'slug'))
    ) then
      return jsonb_build_object('ok', false, 'reason', 'duplicate');
    end if;
  end loop;

  if exists (
    select 1 from (
      select value->>'id' id, count(*) n
      from jsonb_array_elements(v_lease.draft_graph->'nodes') group by value->>'id'
    ) d where d.n > 1
  ) or exists (
    select 1 from (
      select btrim(value->>'name') name, count(*) n
      from jsonb_array_elements(v_lease.draft_graph->'nodes') group by btrim(value->>'name')
    ) d where d.n > 1
  ) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  -- Validate relations against draft/current endpoints and types.
  for v_edge in select value from jsonb_array_elements(v_lease.draft_graph->'edges')
  loop
    begin
      v_edge_id := (v_edge->>'id')::uuid;
      v_source := (v_edge->>'source')::uuid;
      v_target := (v_edge->>'target')::uuid;
    exception when others then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end;
    v_type_slug := v_edge->>'relationType';
    if jsonb_typeof(v_edge) <> 'object'
       or v_source = v_target
       or coalesce(v_type_slug,'') !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
       or coalesce(v_edge->>'status','') not in ('active','ended','superseded','retcon_pending','archived')
       or coalesce(v_edge->>'visibility','') not in ('private_master','private_players','review_only','public_campaign','public_web')
       or (v_edge->>'labelOverride' is not null and char_length(v_edge->>'labelOverride') not between 1 and 120)
       or (v_edge->>'colorOverride' is not null and (v_edge->>'colorOverride') !~ '^#[0-9A-Fa-f]{6}$')
       or (v_edge->>'lineStyleOverride' is not null and v_edge->>'lineStyleOverride' not in ('solid','dashed','dotted'))
       or (v_edge->>'lineWidthOverride' is not null and (
         not ((v_edge->>'lineWidthOverride') ~ '^[0-9]+([.][0-9]+)?$')
         or (v_edge->>'lineWidthOverride')::numeric not between 1 and 8
       )) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_lease.draft_graph->'nodes') n where n->>'id' = v_source::text
    ) and not exists (
      select 1 from public.entities e where e.id = v_source and e.campaign_id = v_campaign_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_lease.draft_graph->'nodes') n where n->>'id' = v_target::text
    ) and not exists (
      select 1 from public.entities e where e.id = v_target and e.campaign_id = v_campaign_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    if not exists (
      select 1 from jsonb_array_elements(v_lease.draft_graph->'relationTypes') t where t->>'slug' = v_type_slug
    ) and not exists (
      select 1 from public.relation_types t where t.campaign_id = v_campaign_id and t.slug = v_type_slug
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
    if exists (
      select 1 from public.entity_relations r where r.id = v_edge_id and r.campaign_id <> v_campaign_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
    end if;
  end loop;

  if exists (
    select 1 from (
      select value->>'id' id, count(*) n
      from jsonb_array_elements(v_lease.draft_graph->'edges') group by value->>'id'
    ) d where d.n > 1
  ) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  v_old_graph := public.world_graph_snapshot_json(v_campaign_id);

  -- Layout save happens in this same SQL transaction. Any later database error
  -- rolls it back together with factual changes and audit rows.
  v_layout_result := public.save_world_layout_snapshot_atomic(
    p_auth_user_id,
    p_actor_profile_id,
    p_campaign_slug,
    v_lease.base_layout_revision,
    v_lease.draft_positions
  );
  if coalesce((v_layout_result->>'ok')::boolean, false) is not true then
    if v_layout_result->>'reason' = 'conflict' then
      return jsonb_build_object(
        'ok', false,
        'reason', 'conflict',
        'revision', v_head_revision,
        'layoutRevision', v_layout_result->'revision'
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', coalesce(v_layout_result->>'reason','dependency_unavailable'));
  end if;

  -- Upsert semantic relation types and their presentation defaults.
  for v_type in select value from jsonb_array_elements(v_lease.draft_graph->'relationTypes')
  loop
    insert into public.relation_types(
      campaign_id, slug, label, directionality, family, description,
      is_system, is_active, created_by, updated_by, updated_at
    ) values (
      v_campaign_id,
      v_type->>'slug',
      btrim(v_type->>'label'),
      v_type->>'direction',
      v_type->>'family',
      coalesce(v_type->>'description',''),
      false,
      coalesce((v_type->>'isActive')::boolean, true),
      p_actor_profile_id,
      p_actor_profile_id,
      v_now
    )
    on conflict (campaign_id, slug) do update set
      label = excluded.label,
      directionality = excluded.directionality,
      family = excluded.family,
      description = excluded.description,
      is_active = excluded.is_active,
      updated_by = p_actor_profile_id,
      updated_at = v_now;

    insert into public.world_relation_styles(
      campaign_id, relation_type_slug, color, line_style, line_width, updated_by, updated_at
    ) values (
      v_campaign_id,
      v_type->>'slug',
      lower(v_type->>'color'),
      v_type->>'lineStyle',
      (v_type->>'lineWidth')::numeric,
      p_actor_profile_id,
      v_now
    )
    on conflict (campaign_id, relation_type_slug) do update set
      color = excluded.color,
      line_style = excluded.line_style,
      line_width = excluded.line_width,
      updated_by = p_actor_profile_id,
      updated_at = v_now;
  end loop;

  for v_node in select value from jsonb_array_elements(v_lease.draft_graph->'nodes')
  loop
    v_node_id := (v_node->>'id')::uuid;
    select coalesce(array_agg(alias order by alias), '{}'::text[])
    into v_aliases
    from jsonb_array_elements_text(coalesce(v_node->'aliases','[]'::jsonb)) a(alias);

    insert into public.entities(
      id, campaign_id, name, slug, entity_type, status, visibility, summary, aliases, updated_at
    ) values (
      v_node_id,
      v_campaign_id,
      btrim(v_node->>'name'),
      nullif(v_node->>'slug',''),
      v_node->>'entityType',
      coalesce(nullif(v_node->>'status',''),'active'),
      v_node->>'visibility',
      nullif(v_node->>'summary',''),
      v_aliases,
      v_now
    )
    on conflict (id) do update set
      name = excluded.name,
      slug = excluded.slug,
      entity_type = excluded.entity_type,
      status = excluded.status,
      visibility = excluded.visibility,
      summary = excluded.summary,
      aliases = excluded.aliases,
      updated_at = v_now;
  end loop;

  for v_edge in select value from jsonb_array_elements(v_lease.draft_graph->'edges')
  loop
    v_edge_id := (v_edge->>'id')::uuid;
    v_source := (v_edge->>'source')::uuid;
    v_target := (v_edge->>'target')::uuid;
    v_type_slug := v_edge->>'relationType';
    select t.directionality into v_direction
    from public.relation_types t
    where t.campaign_id = v_campaign_id and t.slug = v_type_slug;
    if v_direction = 'symmetric' and v_source::text > v_target::text then
      v_tmp := v_source; v_source := v_target; v_target := v_tmp;
    end if;

    if exists (
      select 1 from public.entity_relations r
      where r.campaign_id = v_campaign_id
        and r.id <> v_edge_id
        and r.relation_type_slug = v_type_slug
        and r.status = 'active'
        and (
          (v_direction = 'symmetric' and least(r.source_entity_id::text, r.target_entity_id::text) = least(v_source::text, v_target::text)
            and greatest(r.source_entity_id::text, r.target_entity_id::text) = greatest(v_source::text, v_target::text))
          or (v_direction = 'directed' and r.source_entity_id = v_source and r.target_entity_id = v_target)
        )
    ) then
      raise exception using errcode = '23505', message = 'duplicate active relation';
    end if;

    insert into public.entity_relations(
      id, campaign_id, source_entity_id, target_entity_id, relation_type_slug,
      label_override, status, visibility, color_override, line_style_override,
      line_width_override, revision, created_by, updated_by, updated_at
    ) values (
      v_edge_id,
      v_campaign_id,
      v_source,
      v_target,
      v_type_slug,
      nullif(v_edge->>'labelOverride',''),
      v_edge->>'status',
      v_edge->>'visibility',
      nullif(lower(v_edge->>'colorOverride'),''),
      nullif(v_edge->>'lineStyleOverride',''),
      case when v_edge->>'lineWidthOverride' is null then null else (v_edge->>'lineWidthOverride')::numeric end,
      0,
      p_actor_profile_id,
      p_actor_profile_id,
      v_now
    )
    on conflict (id) do update set
      source_entity_id = excluded.source_entity_id,
      target_entity_id = excluded.target_entity_id,
      relation_type_slug = excluded.relation_type_slug,
      label_override = excluded.label_override,
      status = excluded.status,
      visibility = excluded.visibility,
      color_override = excluded.color_override,
      line_style_override = excluded.line_style_override,
      line_width_override = excluded.line_width_override,
      revision = public.entity_relations.revision + 1,
      updated_by = p_actor_profile_id,
      updated_at = v_now;
  end loop;

  v_new_graph := public.world_graph_snapshot_json(v_campaign_id);
  -- Ignore the revision field itself when deciding whether factual content changed.
  v_graph_changed := (v_old_graph - 'revision') is distinct from (v_new_graph - 'revision');

  if v_graph_changed then
    v_next_revision := v_head_revision + 1;
    update public.world_graph_heads
    set revision = v_next_revision, updated_by = p_actor_profile_id, updated_at = v_now
    where campaign_id = v_campaign_id;
    v_new_graph := jsonb_set(v_new_graph, '{revision}', to_jsonb(v_next_revision), true);
    insert into public.world_graph_revisions(campaign_id, revision, actor_id, snapshot)
    values (v_campaign_id, v_next_revision, p_actor_profile_id, v_new_graph);
    insert into public.audit_log(campaign_id, actor_id, action, table_name, old_value, new_value)
    values (
      v_campaign_id,
      p_actor_profile_id,
      'world_graph.publish',
      'world_graph_revisions',
      jsonb_build_object('revision', v_head_revision),
      jsonb_build_object('revision', v_next_revision)
    );
  else
    v_next_revision := v_head_revision;
  end if;

  delete from public.world_edit_leases
  where campaign_id = v_campaign_id
    and holder_profile_id = p_actor_profile_id
    and lease_token = p_lease_token;

  return jsonb_build_object(
    'ok', true,
    'status', case
      when v_graph_changed or v_layout_result->>'status' = 'saved' then 'saved'
      else 'unchanged'
    end,
    'graphRevision', v_next_revision,
    'layoutRevision', (v_layout_result->>'revision')::bigint,
    'graphChanged', v_graph_changed,
    'layoutChanged', v_layout_result->>'status' = 'saved'
  );
end;
$$;

comment on table public.relation_types is
  'Per-campaign relation semantics. Manual World authoring is capability-gated server-side.';
comment on table public.entity_relations is
  'Canonical/historical first-class relations between entities; never inferred from layout.';
comment on table public.world_graph_revisions is
  'Append-only snapshots of explicit human World graph publications.';

revoke all on function public.reset_world_graph_draft_on_lease_handoff() from public, anon, authenticated;
revoke all on function public.world_graph_snapshot_json(uuid) from public, anon, authenticated;
revoke all on function public.acquire_world_graph_draft_atomic(uuid,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.save_world_graph_draft_atomic(uuid,uuid,text,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.publish_world_edit_state_atomic(uuid,uuid,text,uuid) from public, anon, authenticated;

grant execute on function public.reset_world_graph_draft_on_lease_handoff() to service_role;
grant execute on function public.world_graph_snapshot_json(uuid) to service_role;
grant execute on function public.acquire_world_graph_draft_atomic(uuid,uuid,text,uuid) to service_role;
grant execute on function public.save_world_graph_draft_atomic(uuid,uuid,text,uuid,jsonb) to service_role;
grant execute on function public.publish_world_edit_state_atomic(uuid,uuid,text,uuid) to service_role;