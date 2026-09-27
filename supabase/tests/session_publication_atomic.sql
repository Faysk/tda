-- Synthetic-only contract for versioned session publication (#793).
-- Loaded only by tools/session-publication-db.py on an isolated PostgreSQL cluster.

do $security$
begin
  if not exists (
    select 1
    from public.permission_catalog pc
    where pc.action = 'campaign.sessions.publish'
      and pc.plane = 'narrative'
  ) then
    raise exception 'SESSION_PUBLICATION_CAPABILITY_MISSING';
  end if;

  if not exists (
    select 1
    from public.role_permissions rp
    join public.role_definitions rd on rd.id = rp.role_id
    where rd.slug = 'site_editor'
      and rd.plane = 'narrative'
      and rp.permission_action = 'campaign.sessions.publish'
  ) then
    raise exception 'SESSION_PUBLICATION_SITE_EDITOR_GRANT_MISSING';
  end if;

  if exists (select 1 from public.role_assignments) then
    raise exception 'SESSION_PUBLICATION_MIGRATION_CREATED_USER_ASSIGNMENT';
  end if;

  if has_table_privilege('anon', 'public.session_publications', 'SELECT')
     or has_table_privilege('authenticated', 'public.session_publications', 'SELECT')
     or has_table_privilege('anon', 'public.session_publication_operations', 'SELECT')
     or has_table_privilege('authenticated', 'public.session_publication_operations', 'SELECT') then
    raise exception 'SESSION_PUBLICATION_TABLE_EXPOSED_TO_BROWSER_ROLE';
  end if;

  if not has_table_privilege('service_role', 'public.session_publications', 'SELECT')
     or not has_table_privilege('service_role', 'public.session_publications', 'INSERT')
     or has_table_privilege('service_role', 'public.session_publications', 'UPDATE')
     or has_table_privilege('service_role', 'public.session_publications', 'DELETE')
     or not has_table_privilege('service_role', 'public.session_publication_operations', 'SELECT')
     or not has_table_privilege('service_role', 'public.session_publication_operations', 'INSERT')
     or has_table_privilege('service_role', 'public.session_publication_operations', 'UPDATE')
     or has_table_privilege('service_role', 'public.session_publication_operations', 'DELETE') then
    raise exception 'SESSION_PUBLICATION_SERVICE_ROLE_PRIVILEGES_NOT_MINIMAL';
  end if;

  if has_function_privilege(
       'anon',
       'public.publish_session_editorial_atomic(uuid,text,uuid,uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.publish_session_editorial_atomic(uuid,text,uuid,uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.publish_session_editorial_atomic(uuid,text,uuid,uuid,uuid,uuid,text)',
       'EXECUTE'
     ) then
    raise exception 'SESSION_PUBLICATION_FUNCTION_PRIVILEGES_INVALID';
  end if;
end;
$security$;

insert into public.media_assets(
  id,
  campaign_id,
  media_kind,
  role_hint,
  status,
  staged_bucket,
  object_key,
  sha256,
  mime_type,
  byte_size,
  width,
  height,
  read_back_verified,
  public_bucket,
  public_object_key,
  public_delivery_verified,
  public_verified_at,
  created_by
) values (
  '55555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  'image',
  'session_cover',
  'verified_public',
  'tda-media-private',
  'campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/' || repeat('a',64) || '.webp',
  repeat('a',64),
  'image/webp',
  100,
  10,
  10,
  true,
  'tda-media-public',
  'campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/' || repeat('a',64) || '.webp',
  true,
  '2026-09-28T00:00:00Z',
  '33333333-3333-4333-8333-333333333333'
);

do $main$
declare
  v_draft_1 uuid;
  v_draft_2 uuid;
  v_draft_3 uuid;
  v_pub_1 uuid;
  v_pub_2 uuid;
  v_hash_1 text;
  v_hash_2 text;
  v_status text;
  v_version bigint;
  v_previous uuid;
  v_hash text;
  v_count bigint;
  v_audit_count bigint;
  v_current uuid;
  v_title text;
  v_arc text;
  v_short text;
  v_full text;
  v_session_status text;
  v_cover text;
  v_transcript uuid;
  v_failed boolean := false;
  v_url text :=
    'https://media.dnd.faysk.dev/campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/'
    || repeat('a',64) || '.webp';
begin
  set local role service_role;

  select d.status, d.draft_id, d.revision
  into v_status, v_draft_1, v_version
  from public.save_session_editorial_draft_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    0,
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    'Arco Sintético',
    'Memória Sintética Ω',
    'Descrição sintética segura.',
    '# Resumo\n\nConteúdo editorial sintético **sem transcript**.'
  ) d;

  if v_status <> 'updated' or v_version <> 1 or v_draft_1 is null then
    raise exception 'SESSION_PUBLICATION_DRAFT1_INVALID:% % %',
      v_status, v_draft_1, v_version;
  end if;

  -- A session without the route identity consumed by /sessoes/[id] cannot become
  -- a ghost published row.
  update public.sessions
  set source_session_id = null
  where id='22222222-2222-4222-8222-222222222222';

  select p.status
  into v_status
  from public.publish_session_editorial_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_draft_1,
    null,
    '90000000-0000-4000-8000-000000000099',
    v_url
  ) p;
  if v_status <> 'not_ready'
     or (select count(*) from public.session_publications) <> 0
     or (select count(*) from public.session_publication_operations) <> 0 then
    raise exception 'SESSION_PUBLICATION_ROUTELESS_SESSION_ACCEPTED:%', v_status;
  end if;

  update public.sessions
  set source_session_id = 'synthetic-public-id'
  where id='22222222-2222-4222-8222-222222222222';

  select p.status, p.publication_id, p.version, p.previous_publication_id, p.payload_sha256
  into v_status, v_pub_1, v_version, v_previous, v_hash_1
  from public.publish_session_editorial_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_draft_1,
    null,
    '90000000-0000-4000-8000-000000000001',
    v_url
  ) p;

  if v_status <> 'published'
     or v_pub_1 is null
     or v_version <> 1
     or v_previous is not null
     or v_hash_1 !~ '^[0-9a-f]{64}$' then
    raise exception 'SESSION_PUBLICATION_FIRST_INVALID:% % % % %',
      v_status, v_pub_1, v_version, v_previous, v_hash_1;
  end if;

  select
    s.current_session_publication_id,
    s.title,
    s.arc,
    s.summary_short,
    s.summary_full,
    s.status,
    s.metadata->>'coverImageUrl',
    s.current_transcript_revision_id
  into
    v_current,
    v_title,
    v_arc,
    v_short,
    v_full,
    v_session_status,
    v_cover,
    v_transcript
  from public.sessions s
  where s.id = '22222222-2222-4222-8222-222222222222';

  if v_current <> v_pub_1
     or v_title <> 'Memória Sintética Ω'
     or v_arc <> 'Arco Sintético'
     or v_short <> 'Descrição sintética segura.'
     or v_full <> E'# Resumo\n\nConteúdo editorial sintético **sem transcript**.'
     or v_session_status <> 'published'
     or v_cover <> v_url
     or v_transcript <> '44444444-4444-4444-8444-444444444444'::uuid then
    raise exception 'SESSION_PUBLICATION_PUBLIC_PROJECTION_INVALID';
  end if;

  if (select metadata->>'heroImageUrl' from public.sessions
      where id='22222222-2222-4222-8222-222222222222') <> v_url then
    raise exception 'SESSION_PUBLICATION_HERO_PROJECTION_INVALID';
  end if;

  select count(*) into v_audit_count
  from public.audit_log
  where action = 'session_publication.publish';

  -- Replay is exact and leaves no second snapshot/receipt/audit.
  select p.status, p.publication_id, p.version, p.previous_publication_id, p.payload_sha256
  into v_status, v_current, v_version, v_previous, v_hash
  from public.publish_session_editorial_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_draft_1,
    null,
    '90000000-0000-4000-8000-000000000001',
    v_url
  ) p;

  if v_status <> 'replay'
     or v_current <> v_pub_1
     or v_version <> 1
     or v_previous is not null
     or v_hash <> v_hash_1
     or (select count(*) from public.session_publications) <> 1
     or (select count(*) from public.session_publication_operations) <> 1
     or (select count(*) from public.audit_log where action='session_publication.publish') <> v_audit_count then
    raise exception 'SESSION_PUBLICATION_REPLAY_NOT_IDEMPOTENT';
  end if;

  -- Reusing an operation id with divergent authority is an explicit conflict.
  select p.status
  into v_status
  from public.publish_session_editorial_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_draft_1,
    v_pub_1,
    '90000000-0000-4000-8000-000000000001',
    v_url
  ) p;
  if v_status <> 'operation_conflict' then
    raise exception 'SESSION_PUBLICATION_DIVERGENT_OPERATION_ACCEPTED:%', v_status;
  end if;

  -- A replacement draft becomes version 2 while version 1 stays immutable.
  select d.status, d.draft_id, d.revision
  into v_status, v_draft_2, v_version
  from public.save_session_editorial_draft_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    1,
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    'Arco Sintético',
    'Memória Sintética Ω · revisão 2',
    'Descrição v2 — unicode ✓.',
    E'# Resumo v2\n\nLinha 1.\n\nLinha 2.'
  ) d;

  if v_status <> 'updated' or v_version <> 2 or v_draft_2 is null then
    raise exception 'SESSION_PUBLICATION_DRAFT2_INVALID';
  end if;

  select p.status, p.publication_id, p.version, p.previous_publication_id, p.payload_sha256
  into v_status, v_pub_2, v_version, v_previous, v_hash_2
  from public.publish_session_editorial_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_draft_2,
    v_pub_1,
    '90000000-0000-4000-8000-000000000002',
    v_url
  ) p;

  if v_status <> 'published'
     or v_pub_2 is null
     or v_pub_2 = v_pub_1
     or v_version <> 2
     or v_previous <> v_pub_1
     or v_hash_2 !~ '^[0-9a-f]{64}$'
     or v_hash_2 = v_hash_1
     or (select count(*) from public.session_publications) <> 2
     or (select count(*) from public.session_publication_operations) <> 2 then
    raise exception 'SESSION_PUBLICATION_REPLACEMENT_INVALID';
  end if;

  if not exists (
    select 1 from public.session_publications
    where id=v_pub_1 and version=1 and payload_sha256=v_hash_1
  ) then
    raise exception 'SESSION_PUBLICATION_HISTORY_LOST';
  end if;

  -- A fresh stale writer is rejected without evidence.
  v_audit_count := (
    select count(*) from public.audit_log
    where action='session_publication.publish'
  );
  select p.status
  into v_status
  from public.publish_session_editorial_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_draft_2,
    v_pub_1,
    '90000000-0000-4000-8000-000000000003',
    v_url
  ) p;
  if v_status <> 'stale_current'
     or (select count(*) from public.session_publications) <> 2
     or (select count(*) from public.session_publication_operations) <> 2
     or (select count(*) from public.audit_log where action='session_publication.publish') <> v_audit_count then
    raise exception 'SESSION_PUBLICATION_STALE_WRITE_LEFT_EVIDENCE:%', v_status;
  end if;

  -- Draft 3 is intentionally left unpublished for rollback/concurrency probes.
  select d.status, d.draft_id, d.revision
  into v_status, v_draft_3, v_version
  from public.save_session_editorial_draft_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    2,
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    'Arco Sintético',
    'Memória Sintética Ω · revisão 3',
    'Descrição v3 para rollback.',
    '# Resumo v3 para rollback.'
  ) d;
  if v_status <> 'updated' or v_version <> 3 or v_draft_3 is null then
    raise exception 'SESSION_PUBLICATION_DRAFT3_INVALID';
  end if;

  -- Fail after snapshot/pointer/receipt work; the whole publication must roll back.
  create temporary table publication_rollback_probe(flag boolean);
  insert into publication_rollback_probe values (true);

  begin
    insert into public.audit_log(
      campaign_id, session_id, actor_id, action, table_name, record_id, old_value, new_value
    ) values (
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      'synthetic.noop',
      'synthetic',
      null,
      null,
      null
    );
  exception when others then
    raise;
  end;

  -- Audit privacy: no public editorial body is copied to audit evidence.
  if exists (
    select 1
    from public.audit_log a
    where a.action = 'session_publication.publish'
      and (
        coalesce(a.old_value::text,'') || coalesce(a.new_value::text,'')
      ) ~ '(Memória Sintética|Descrição|Resumo|Conteúdo editorial)'
  ) then
    raise exception 'SESSION_PUBLICATION_AUDIT_LEAKED_EDITORIAL_BODY';
  end if;

  select current_session_publication_id into v_current
  from public.sessions
  where id='22222222-2222-4222-8222-222222222222';
  if v_current <> v_pub_2 then
    raise exception 'SESSION_PUBLICATION_CURRENT_POINTER_DRIFTED';
  end if;
end;
$main$;

-- Install a selective failure probe as owner. It is dropped after the rollback check.
create function public.fail_session_publication_audit_probe()
returns trigger
language plpgsql
as $$
begin
  if new.action = 'session_publication.publish' then
    raise exception 'synthetic session publication audit failure';
  end if;
  return new;
end;
$$;

create trigger fail_session_publication_audit_probe
before insert on public.audit_log
for each row execute function public.fail_session_publication_audit_probe();

do $rollback$
declare
  v_draft uuid;
  v_current uuid;
  v_status text;
  v_before_publications bigint;
  v_before_operations bigint;
  v_before_audits bigint;
  v_failed boolean := false;
  v_url text :=
    'https://media.dnd.faysk.dev/campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/'
    || repeat('a',64) || '.webp';
begin
  select current_editorial_draft_id, current_session_publication_id
  into v_draft, v_current
  from public.sessions
  where id='22222222-2222-4222-8222-222222222222';

  select count(*) into v_before_publications from public.session_publications;
  select count(*) into v_before_operations from public.session_publication_operations;
  select count(*) into v_before_audits
  from public.audit_log where action='session_publication.publish';

  begin
    set local role service_role;
    perform *
    from public.publish_session_editorial_atomic(
      '33333333-3333-4333-8333-333333333333',
      'synthetic-campaign',
      '22222222-2222-4222-8222-222222222222',
      v_draft,
      v_current,
      '90000000-0000-4000-8000-000000000004',
      v_url
    );
  exception
    when others then
      if sqlerrm not like '%synthetic session publication audit failure%' then
        raise;
      end if;
      v_failed := true;
  end;

  if not v_failed then
    raise exception 'SESSION_PUBLICATION_ROLLBACK_PROBE_DID_NOT_FAIL';
  end if;

  if (select current_session_publication_id from public.sessions
      where id='22222222-2222-4222-8222-222222222222') is distinct from v_current
     or (select count(*) from public.session_publications) <> v_before_publications
     or (select count(*) from public.session_publication_operations) <> v_before_operations
     or (select count(*) from public.audit_log where action='session_publication.publish') <> v_before_audits then
    raise exception 'SESSION_PUBLICATION_FAILED_COMMIT_LEFT_PARTIAL_STATE';
  end if;
end;
$rollback$;

drop trigger fail_session_publication_audit_probe on public.audit_log;
drop function public.fail_session_publication_audit_probe();

-- Assertions consumed by the Python concurrent-writer probe.
select
  current_editorial_draft_id::text || '|' ||
  current_session_publication_id::text
from public.sessions
where id='22222222-2222-4222-8222-222222222222';
