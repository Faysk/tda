-- Synthetic-only contract for editable/versioned session dates (#899).
-- Loaded by tools/session-publication-db.py inside an isolated PostgreSQL cluster.

do $security$
begin
  if has_function_privilege(
       'anon',
       'public.save_session_editorial_draft_with_date_atomic(uuid,text,uuid,bigint,uuid,text,text,text,text,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.save_session_editorial_draft_with_date_atomic(uuid,text,uuid,bigint,uuid,text,text,text,text,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.save_session_editorial_draft_with_date_atomic(uuid,text,uuid,bigint,uuid,text,text,text,text,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.publish_session_editorial_with_date_atomic(uuid,text,uuid,uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.publish_session_editorial_with_date_atomic(uuid,text,uuid,uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.publish_session_editorial_with_date_atomic(uuid,text,uuid,uuid,uuid,uuid,text)',
       'EXECUTE'
     ) then
    raise exception 'SESSION_EDITORIAL_DATE_FUNCTION_PRIVILEGES_INVALID';
  end if;
end;
$security$;

begin;
set local role service_role;

do $date_contract$
declare
  v_current_draft uuid;
  v_current_publication uuid;
  v_current_revision bigint;
  v_status text;
  v_draft_empty uuid;
  v_draft_valid uuid;
  v_publication uuid;
  v_version bigint;
  v_hash text;
  v_before_publications bigint;
  v_before_operations bigint;
  v_url text :=
    'https://media.dnd.faysk.dev/campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/'
    || repeat('a',64) || '.webp';
begin
  select s.current_editorial_draft_id, s.current_session_publication_id
  into v_current_draft, v_current_publication
  from public.sessions s
  where s.id='22222222-2222-4222-8222-222222222222';

  select d.revision into v_current_revision
  from public.session_editorial_drafts d
  where d.id=v_current_draft;

  select d.status, d.draft_id, d.revision
  into v_status, v_draft_empty, v_version
  from public.save_session_editorial_draft_with_date_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_current_revision,
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    'Arco data',
    'Draft sem data',
    'Descrição sem data.',
    '# Resumo sem data.',
    ''
  ) d;

  if v_status <> 'updated'
     or v_draft_empty is null
     or not exists (
       select 1
       from public.session_editorial_drafts d
       where d.id=v_draft_empty
         and d.session_date is null
         and d.session_date_captured=true
     )
     or (select session_date from public.sessions
         where id='22222222-2222-4222-8222-222222222222') <> '2026-09-01'::date then
    raise exception 'SESSION_EDITORIAL_EMPTY_DATE_DRAFT_INVALID';
  end if;

  select count(*) into v_before_publications from public.session_publications;
  select count(*) into v_before_operations from public.session_publication_operations;

  select p.status into v_status
  from public.publish_session_editorial_with_date_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_draft_empty,
    v_current_publication,
    '92000000-0000-4000-8000-000000000001',
    v_url
  ) p;

  if v_status <> 'not_ready'
     or (select count(*) from public.session_publications) <> v_before_publications
     or (select count(*) from public.session_publication_operations) <> v_before_operations then
    raise exception 'SESSION_EDITORIAL_EMPTY_DATE_PUBLISHED:%', v_status;
  end if;

  select d.status, d.draft_id, d.revision
  into v_status, v_draft_valid, v_version
  from public.save_session_editorial_draft_with_date_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_version,
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    'Arco data',
    'Draft com data',
    'Descrição com data.',
    '# Resumo com data.',
    '2024-02-29'
  ) d;

  if v_status <> 'updated'
     or v_draft_valid is null
     or (select session_date from public.session_editorial_drafts where id=v_draft_valid) <> '2024-02-29'::date
     or (select session_date_captured from public.session_editorial_drafts where id=v_draft_valid) is not true
     or (select session_date from public.sessions
         where id='22222222-2222-4222-8222-222222222222') <> '2026-09-01'::date then
    raise exception 'SESSION_EDITORIAL_VALID_DATE_DRAFT_INVALID';
  end if;

  select p.status, p.publication_id, p.version, p.payload_sha256
  into v_status, v_publication, v_version, v_hash
  from public.publish_session_editorial_with_date_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_draft_valid,
    v_current_publication,
    '92000000-0000-4000-8000-000000000002',
    v_url
  ) p;

  if v_status <> 'published'
     or v_publication is null
     or v_hash !~ '^[0-9a-f]{64}$'
     or (select session_date from public.session_publications where id=v_publication) <> '2024-02-29'::date
     or (select session_date from public.sessions
         where id='22222222-2222-4222-8222-222222222222') <> '2024-02-29'::date
     or (select payload_sha256 from public.session_publication_operations
         where operation_id='92000000-0000-4000-8000-000000000002') <> v_hash then
    raise exception 'SESSION_EDITORIAL_DATE_PUBLICATION_INVALID:%', v_status;
  end if;

  select p.status, p.publication_id, p.payload_sha256
  into v_status, v_current_draft, v_hash
  from public.publish_session_editorial_with_date_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_draft_valid,
    v_current_publication,
    '92000000-0000-4000-8000-000000000002',
    v_url
  ) p;

  if v_status <> 'replay'
     or v_current_draft <> v_publication
     or (select session_date from public.sessions
         where id='22222222-2222-4222-8222-222222222222') <> '2024-02-29'::date then
    raise exception 'SESSION_EDITORIAL_DATE_REPLAY_INVALID';
  end if;

  begin
    perform *
    from public.save_session_editorial_draft_with_date_atomic(
      '33333333-3333-4333-8333-333333333333',
      'synthetic-campaign',
      '22222222-2222-4222-8222-222222222222',
      v_version + 1,
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      'Arco',
      'Inválida',
      'Descrição',
      '# Resumo',
      '2026-02-30'
    );
    raise exception 'SESSION_EDITORIAL_INVALID_DATE_ACCEPTED';
  exception
    when sqlstate '22007' then null;
  end;

  begin
    perform *
    from public.save_session_editorial_draft_with_date_atomic(
      '33333333-3333-4333-8333-333333333333',
      'synthetic-campaign',
      '22222222-2222-4222-8222-222222222222',
      v_version + 1,
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      'Arco',
      'Inválida',
      'Descrição',
      '# Resumo',
      ' 2026-08-19 '
    );
    raise exception 'SESSION_EDITORIAL_PADDED_DATE_ACCEPTED';
  exception
    when sqlstate '22007' then null;
  end;
end;
$date_contract$;

rollback;
