-- Synthetic-only contract tests for #898.
do $security$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='transcript_revisions'
      and column_name='derived_from_revision_id'
  ) then
    raise exception 'TRANSCRIPT_REVISION_EDIT_DERIVATION_COLUMN_MISSING';
  end if;

  if has_function_privilege(
       'anon',
       'public.save_transcript_revision_edit_atomic(uuid,text,uuid,uuid,uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.save_transcript_revision_edit_atomic(uuid,text,uuid,uuid,uuid,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.save_transcript_revision_edit_atomic(uuid,text,uuid,uuid,uuid,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'TRANSCRIPT_REVISION_EDIT_FUNCTION_PRIVILEGES_INVALID';
  end if;
end;
$security$;

do $main$
declare
  v_status text;
  v_revision_id uuid;
  v_revision_number bigint;
  v_current uuid;
  v_before jsonb;
  v_after jsonb;
begin
  set local role service_role;

  select segments into v_before
  from public.transcript_revisions
  where id='44444444-4444-4444-8444-444444444444';

  select e.status
  into v_status
  from public.save_transcript_revision_edit_atomic(
    '33333333-3333-4333-8333-333333333334',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444444',
    '71000000-0000-4000-8000-000000000000',
    '[{"segmentKey":"r-1-seg-a","speaker":"Alya","text":"Negado"}]'::jsonb
  ) e;
  if v_status <> 'forbidden' then
    raise exception 'TRANSCRIPT_REVISION_EDIT_UNAUTHORIZED_ACCEPTED:%', v_status;
  end if;

  select e.status
  into v_status
  from public.save_transcript_revision_edit_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444444',
    '71000000-0000-4000-8000-000000000001',
    '[{"segmentKey":"r-1-seg-a","speaker":"Alya","text":"Primeira fala sintética"}]'::jsonb
  ) e;
  if v_status <> 'no_change'
     or (select count(*) from public.transcript_revisions) <> 1
     or (select count(*) from public.audit_log where action='transcript_revision.edit') <> 0 then
    raise exception 'TRANSCRIPT_REVISION_EDIT_NOOP_CREATED_EVIDENCE:%', v_status;
  end if;

  select e.status, e.revision_id, e.revision_number, e.current_revision_id
  into v_status, v_revision_id, v_revision_number, v_current
  from public.save_transcript_revision_edit_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444444',
    '71000000-0000-4000-8000-000000000002',
    '[
      {"segmentKey":"r-1-seg-a","speaker":"Alya Renomeada","text":"Primeira fala corrigida"},
      {"segmentKey":"r-2-seg-b","speaker":"Sense","text":"Segunda fala com acento: ação"}
    ]'::jsonb
  ) e;

  if v_status <> 'updated'
     or v_revision_id is null
     or v_revision_number <> 4
     or v_current <> v_revision_id then
    raise exception 'TRANSCRIPT_REVISION_EDIT_UPDATE_INVALID:% % % %',
      v_status, v_revision_id, v_revision_number, v_current;
  end if;

  if (select current_transcript_revision_id from public.sessions
      where id='22222222-2222-4222-8222-222222222222') <> v_revision_id then
    raise exception 'TRANSCRIPT_REVISION_EDIT_POINTER_NOT_SWAPPED';
  end if;

  select segments into v_after
  from public.transcript_revisions
  where id='44444444-4444-4444-8444-444444444444';
  if v_after is distinct from v_before then
    raise exception 'TRANSCRIPT_REVISION_EDIT_MUTATED_BASE';
  end if;

  if not exists (
    select 1
    from public.transcript_revisions r
    where r.id=v_revision_id
      and r.derived_from_revision_id='44444444-4444-4444-8444-444444444444'::uuid
      and r.revision_number=4
      and r.segment_count=2
      and r.reviewed_segments=1
      and r.payload_sha256 ~ '^[0-9a-f]{64}$'
      and r.draft_sha256=r.payload_sha256
      and r.segments->0->>'speaker'='Alya Renomeada'
      and r.segments->0->>'text'='Primeira fala corrigida'
      and r.segments->0->>'start'='1.25'
      and r.segments->0->>'end'='2.5'
      and r.segments->0->>'reviewed'='true'
      and r.segments->1->>'text'='Segunda fala com acento: ação'
  ) then
    raise exception 'TRANSCRIPT_REVISION_EDIT_DERIVED_SNAPSHOT_INVALID';
  end if;

  if (select title from public.sessions
      where id='22222222-2222-4222-8222-222222222222') <> 'Synthetic private session'
     or (select status from public.sessions
         where id='22222222-2222-4222-8222-222222222222') <> 'published' then
    raise exception 'TRANSCRIPT_REVISION_EDIT_TOUCHED_PUBLIC_SESSION';
  end if;

  if exists (
    select 1
    from public.audit_log a
    where a.action='transcript_revision.edit'
      and (coalesce(a.old_value::text,'') || coalesce(a.new_value::text,'')) ~
          '(Primeira fala|Segunda fala|Alya Renomeada|Sense)'
  ) then
    raise exception 'TRANSCRIPT_REVISION_EDIT_AUDIT_LEAKED_CONTENT';
  end if;

  select e.status, e.revision_id, e.revision_number
  into v_status, v_current, v_revision_number
  from public.save_transcript_revision_edit_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444444',
    '71000000-0000-4000-8000-000000000002',
    '[
      {"segmentKey":"r-1-seg-a","speaker":"Alya Renomeada","text":"Primeira fala corrigida"},
      {"segmentKey":"r-2-seg-b","speaker":"Sense","text":"Segunda fala com acento: ação"}
    ]'::jsonb
  ) e;
  if v_status <> 'replay'
     or v_current <> v_revision_id
     or v_revision_number <> 4
     or (select count(*) from public.transcript_revisions) <> 2
     or (select count(*) from public.audit_log where action='transcript_revision.edit') <> 1 then
    raise exception 'TRANSCRIPT_REVISION_EDIT_REPLAY_NOT_IDEMPOTENT:%', v_status;
  end if;

  select e.status
  into v_status
  from public.save_transcript_revision_edit_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444444',
    '71000000-0000-4000-8000-000000000002',
    '[{"segmentKey":"r-1-seg-a","speaker":"Outra","text":"Outro conteúdo"}]'::jsonb
  ) e;
  if v_status <> 'operation_conflict' then
    raise exception 'TRANSCRIPT_REVISION_EDIT_OPERATION_REUSE_ACCEPTED:%', v_status;
  end if;

  select e.status
  into v_status
  from public.save_transcript_revision_edit_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444444',
    '71000000-0000-4000-8000-000000000003',
    '[{"segmentKey":"r-1-seg-a","speaker":"Alya","text":"Tentativa stale"}]'::jsonb
  ) e;
  if v_status <> 'stale_current'
     or (select count(*) from public.transcript_revisions) <> 2
     or (select count(*) from public.audit_log where action='transcript_revision.edit') <> 1 then
    raise exception 'TRANSCRIPT_REVISION_EDIT_STALE_LEFT_EVIDENCE:%', v_status;
  end if;

  -- A stale tab must not be told "no change" merely because its local delta
  -- matches the old base. The baseline itself changed.
  select e.status
  into v_status
  from public.save_transcript_revision_edit_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '44444444-4444-4444-8444-444444444444',
    '71000000-0000-4000-8000-000000000005',
    '[{"segmentKey":"r-1-seg-a","speaker":"Alya","text":"Primeira fala sintética"}]'::jsonb
  ) e;
  if v_status <> 'stale_current' then
    raise exception 'TRANSCRIPT_REVISION_EDIT_STALE_NOOP_ACCEPTED:%', v_status;
  end if;

  -- Wrong campaign must fail closed without revealing whether the session exists.
  select e.status
  into v_status
  from public.save_transcript_revision_edit_atomic(
    '33333333-3333-4333-8333-333333333333',
    'other-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_revision_id,
    '71000000-0000-4000-8000-000000000006',
    '[{"segmentKey":"r-1-seg-a","speaker":"Alya","text":"Negado por campanha"}]'::jsonb
  ) e;
  if v_status <> 'forbidden' then
    raise exception 'TRANSCRIPT_REVISION_EDIT_WRONG_CAMPAIGN_ACCEPTED:%', v_status;
  end if;

  -- Capability loss between page load and save is revalidated inside the RPC.
  update public.role_assignments
  set status='revoked'
  where profile_id='33333333-3333-4333-8333-333333333333';

  select e.status
  into v_status
  from public.save_transcript_revision_edit_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_revision_id,
    '71000000-0000-4000-8000-000000000007',
    '[{"segmentKey":"r-1-seg-a","speaker":"Alya","text":"Negado após revoke"}]'::jsonb
  ) e;
  if v_status <> 'forbidden' then
    raise exception 'TRANSCRIPT_REVISION_EDIT_REVOKED_CAPABILITY_ACCEPTED:%', v_status;
  end if;

  update public.role_assignments
  set status='active'
  where profile_id='33333333-3333-4333-8333-333333333333';
end;
$main$;

create function public.fail_transcript_revision_edit_audit_probe()
returns trigger
language plpgsql
as $$
begin
  if new.action='transcript_revision.edit' then
    raise exception 'synthetic transcript revision audit failure';
  end if;
  return new;
end;
$$;

create trigger fail_transcript_revision_edit_audit_probe
before insert on public.audit_log
for each row execute function public.fail_transcript_revision_edit_audit_probe();

do $rollback$
declare
  v_current uuid;
  v_before_count bigint;
  v_failed boolean := false;
begin
  select current_transcript_revision_id into v_current
  from public.sessions
  where id='22222222-2222-4222-8222-222222222222';
  select count(*) into v_before_count from public.transcript_revisions;

  begin
    set local role service_role;
    perform *
    from public.save_transcript_revision_edit_atomic(
      '33333333-3333-4333-8333-333333333333',
      'synthetic-campaign',
      '22222222-2222-4222-8222-222222222222',
      v_current,
      '71000000-0000-4000-8000-000000000004',
      '[{"segmentKey":"r-1-seg-a","speaker":"Alya final","text":"Falha sintética"}]'::jsonb
    );
  exception
    when others then
      if sqlerrm not like '%synthetic transcript revision audit failure%' then
        raise;
      end if;
      v_failed := true;
  end;

  if not v_failed then
    raise exception 'TRANSCRIPT_REVISION_EDIT_ROLLBACK_PROBE_DID_NOT_FAIL';
  end if;

  if (select current_transcript_revision_id from public.sessions
      where id='22222222-2222-4222-8222-222222222222') is distinct from v_current
     or (select count(*) from public.transcript_revisions) <> v_before_count then
    raise exception 'TRANSCRIPT_REVISION_EDIT_FAILED_COMMIT_LEFT_PARTIAL_STATE';
  end if;
end;
$rollback$;

drop trigger fail_transcript_revision_edit_audit_probe on public.audit_log;
drop function public.fail_transcript_revision_edit_audit_probe();

select current_transcript_revision_id::text
from public.sessions
where id='22222222-2222-4222-8222-222222222222';
