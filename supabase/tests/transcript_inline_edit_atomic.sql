-- Synthetic-only contract for #898. Never run against the connected Supabase project.
begin;

do $privileges$
begin
  if has_function_privilege(
    'anon',
    'public.edit_current_transcript_revision_atomic(uuid,text,uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.edit_current_transcript_revision_atomic(uuid,text,uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.edit_current_transcript_revision_atomic(uuid,text,uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'INLINE_TRANSCRIPT_EDIT_RPC_GRANTS_INVALID';
  end if;
end;
$privileges$;

set local role service_role;

do $main$
declare
  v_status text;
  v_revision_id uuid;
  v_revision_number bigint;
  v_current_revision_id uuid;
  v_first_revision_id uuid;
  v_before_count integer;
  v_before_audit integer;
begin
  select current_transcript_revision_id
  into v_first_revision_id
  from public.sessions
  where id='22222222-2222-4222-8222-222222222222'::uuid;

  select status, revision_id, revision_number, current_revision_id
  into v_status, v_revision_id, v_revision_number, v_current_revision_id
  from public.edit_current_transcript_revision_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_first_revision_id,
    '93000000-0000-4000-8000-000000000001',
    '[{"track_number":1,"segment_id":"1-0","speaker":"Álya corrigida","text":"Coração 🌲 corrigido"}]'::jsonb
  );

  if v_status <> 'updated'
     or v_revision_id is null
     or v_revision_number <> 2
     or v_current_revision_id <> v_revision_id
     or (select current_transcript_revision_id from public.sessions where id='22222222-2222-4222-8222-222222222222') <> v_revision_id then
    raise exception 'INLINE_TRANSCRIPT_EDIT_UPDATE_INVALID:%:%:%', v_status, v_revision_number, v_current_revision_id;
  end if;

  if (select segments->0->>'text' from public.transcript_revisions where id=v_first_revision_id) <> 'Texto original da Álya'
     or (select segments->0->>'speaker' from public.transcript_revisions where id=v_first_revision_id) <> 'Álya'
     or (select segments->0->>'text' from public.transcript_revisions where id=v_revision_id) <> 'Coração 🌲 corrigido'
     or (select segments->0->>'speaker' from public.transcript_revisions where id=v_revision_id) <> 'Álya corrigida'
     or (select segments->0->>'start' from public.transcript_revisions where id=v_revision_id) <> '0.0'
     or (select segments->0->>'end' from public.transcript_revisions where id=v_revision_id) <> '1.0'
     or (select segments->1->>'text' from public.transcript_revisions where id=v_revision_id) <> 'Resposta intacta.' then
    raise exception 'INLINE_TRANSCRIPT_EDIT_IMMUTABILITY_OR_TIMING_INVALID';
  end if;

  if (select count(*) from public.transcript_revisions where session_id='22222222-2222-4222-8222-222222222222') <> 2
     or (select count(*) from public.audit_log where action='transcript_revision.edit') <> 1
     or exists (
       select 1
       from public.audit_log
       where action='transcript_revision.edit'
         and (
           old_value ? 'text'
           or new_value ? 'text'
           or old_value::text like '%Texto original%'
           or new_value::text like '%Coração%'
         )
     ) then
    raise exception 'INLINE_TRANSCRIPT_EDIT_AUDIT_INVALID';
  end if;

  select status, revision_id, revision_number, current_revision_id
  into v_status, v_current_revision_id, v_revision_number, v_revision_id
  from public.edit_current_transcript_revision_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_first_revision_id,
    '93000000-0000-4000-8000-000000000001',
    '[{"track_number":1,"segment_id":"1-0","speaker":"Álya corrigida","text":"Coração 🌲 corrigido"}]'::jsonb
  );

  if v_status <> 'replay'
     or v_revision_number <> 2
     or (select count(*) from public.transcript_revisions where session_id='22222222-2222-4222-8222-222222222222') <> 2
     or (select count(*) from public.audit_log where action='transcript_revision.edit') <> 1 then
    raise exception 'INLINE_TRANSCRIPT_EDIT_REPLAY_INVALID:%:%', v_status, v_revision_number;
  end if;

  select status
  into v_status
  from public.edit_current_transcript_revision_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_first_revision_id,
    '93000000-0000-4000-8000-000000000001',
    '[{"track_number":1,"segment_id":"1-0","speaker":"Álya corrigida","text":"Outro conteúdo"}]'::jsonb
  );
  if v_status <> 'conflict' then
    raise exception 'INLINE_TRANSCRIPT_EDIT_OPERATION_CONFLICT_NOT_REJECTED:%', v_status;
  end if;

  select current_transcript_revision_id
  into v_current_revision_id
  from public.sessions
  where id='22222222-2222-4222-8222-222222222222';

  select status
  into v_status
  from public.edit_current_transcript_revision_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_first_revision_id,
    '93000000-0000-4000-8000-000000000002',
    '[{"track_number":2,"segment_id":"2-0","speaker":"Sense","text":"Mudança stale"}]'::jsonb
  );
  if v_status <> 'stale_current' then
    raise exception 'INLINE_TRANSCRIPT_EDIT_STALE_NOT_REJECTED:%', v_status;
  end if;

  select count(*), (select count(*) from public.audit_log where action='transcript_revision.edit')
  into v_before_count, v_before_audit
  from public.transcript_revisions
  where session_id='22222222-2222-4222-8222-222222222222';

  select status
  into v_status
  from public.edit_current_transcript_revision_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_current_revision_id,
    '93000000-0000-4000-8000-000000000003',
    '[{"track_number":1,"segment_id":"1-0","speaker":"Álya corrigida","text":"Coração 🌲 corrigido"}]'::jsonb
  );
  if v_status <> 'unchanged'
     or (select count(*) from public.transcript_revisions where session_id='22222222-2222-4222-8222-222222222222') <> v_before_count
     or (select count(*) from public.audit_log where action='transcript_revision.edit') <> v_before_audit then
    raise exception 'INLINE_TRANSCRIPT_EDIT_NOOP_INVALID:%', v_status;
  end if;

  select status
  into v_status
  from public.edit_current_transcript_revision_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_current_revision_id,
    '93000000-0000-4000-8000-000000000004',
    '[{"track_number":9,"segment_id":"missing","speaker":"Ninguém","text":"Não existe"}]'::jsonb
  );
  if v_status <> 'invalid_edit' then
    raise exception 'INLINE_TRANSCRIPT_EDIT_UNKNOWN_SEGMENT_NOT_REJECTED:%', v_status;
  end if;
end;
$main$;

reset role;

create function public.fail_inline_transcript_edit_audit() returns trigger
language plpgsql as $failure$
begin
  if new.action = 'transcript_revision.edit' then
    raise exception 'synthetic inline transcript audit failure';
  end if;
  return new;
end;
$failure$;

create trigger fail_inline_transcript_edit_audit
before insert on public.audit_log
for each row execute function public.fail_inline_transcript_edit_audit();

set local role service_role;

do $rollback$
declare
  v_current uuid;
  v_revisions integer;
  v_audits integer;
begin
  select current_transcript_revision_id
  into v_current
  from public.sessions
  where id='22222222-2222-4222-8222-222222222222';

  select count(*) into v_revisions
  from public.transcript_revisions
  where session_id='22222222-2222-4222-8222-222222222222';

  select count(*) into v_audits
  from public.audit_log
  where action='transcript_revision.edit';

  begin
    perform *
    from public.edit_current_transcript_revision_atomic(
      '33333333-3333-4333-8333-333333333333',
      'synthetic-campaign',
      '22222222-2222-4222-8222-222222222222',
      v_current,
      '93000000-0000-4000-8000-000000000005',
      '[{"track_number":2,"segment_id":"2-0","speaker":"Sense","text":"Falha deve reverter"}]'::jsonb
    );
    raise exception 'INLINE_TRANSCRIPT_EDIT_EXPECTED_AUDIT_FAILURE';
  exception
    when others then
      if sqlerrm = 'INLINE_TRANSCRIPT_EDIT_EXPECTED_AUDIT_FAILURE' then
        raise;
      end if;
  end;

  if (select current_transcript_revision_id from public.sessions where id='22222222-2222-4222-8222-222222222222') <> v_current
     or (select count(*) from public.transcript_revisions where session_id='22222222-2222-4222-8222-222222222222') <> v_revisions
     or (select count(*) from public.audit_log where action='transcript_revision.edit') <> v_audits then
    raise exception 'INLINE_TRANSCRIPT_EDIT_ROLLBACK_INVALID';
  end if;
end;
$rollback$;

reset role;
drop trigger fail_inline_transcript_edit_audit on public.audit_log;
drop function public.fail_inline_transcript_edit_audit();

rollback;
