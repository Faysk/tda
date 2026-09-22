\set ON_ERROR_STOP on

-- Synthetic canon review contract. Never reads or mutates Production narrative data.
do $contract$
declare
  secure boolean;
  config text;
begin
  select p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '')
  into secure, config
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.oid = 'public.approve_canon_candidate_atomic(uuid,uuid,text,uuid,text)'::regprocedure;

  if secure is not true then
    raise exception 'canon approval RPC must be SECURITY DEFINER';
  end if;
  if position('search_path=pg_catalog, public' in config) = 0 then
    raise exception 'canon approval RPC must pin search_path: %', config;
  end if;
  if has_function_privilege(
       'anon',
       'public.approve_canon_candidate_atomic(uuid,uuid,text,uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.approve_canon_candidate_atomic(uuid,uuid,text,uuid,text)',
       'EXECUTE'
     ) then
    raise exception 'browser roles must not execute canon approval';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.approve_canon_candidate_atomic(uuid,uuid,text,uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'service_role must execute canon approval';
  end if;
end;
$contract$;

-- Preserve the following World provenance test's initial assumption that the
-- synthetic site_editor does not have canon approval until that test grants it.
delete from public.transcript_segments
where id in (
  '80808080-8080-4080-8080-808080808080'::uuid,
  '81818181-8181-4181-8181-818181818181'::uuid
);
delete from public.role_permissions
where role_id = '55555555-5555-4555-8555-555555555555'::uuid
  and permission_action = 'narrative.canon.approve';

insert into public.permission_catalog(action, plane, description)
values ('narrative.canon.approve', 'narrative', 'Approve reviewed narrative canon.')
on conflict (action) do nothing;

insert into public.transcript_segments(
  id, session_id, start_ms, end_ms, text, speaker_name, character_name, review_status
) values (
  '80808080-8080-4080-8080-808080808080',
  '22222222-2222-4222-8222-222222222222',
  1000,
  2500,
  'Fonte sintética aprovada.',
  'Pessoa sintética',
  'Herói sintético',
  'approved'
), (
  '81818181-8181-4181-8181-818181818181',
  '22222222-2222-4222-8222-222222222222',
  3000,
  4500,
  'Fonte sintética de rollback.',
  'Pessoa sintética',
  null,
  'pending'
);

insert into public.canon_candidates(
  id, session_id, title, claim, candidate_type, status, source_segment_ids,
  source_run_id, source_candidate_id, metadata
) values (
  '70707070-7070-4070-8070-707070707070',
  '22222222-2222-4222-8222-222222222222',
  'Evento sintético',
  'Afirmação sintética para aprovação.',
  'event',
  'candidate',
  array['80808080-8080-4080-8080-808080808080'::uuid],
  'synthetic-run',
  'synthetic-candidate-1',
  '{}'::jsonb
), (
  '71717171-7171-4171-8171-717171717171',
  '22222222-2222-4222-8222-222222222222',
  'Evento sintético rollback',
  'Este conteúdo não pode sobreviver à falha.',
  'event',
  'candidate',
  array['81818181-8181-4181-8181-818181818181'::uuid],
  'synthetic-run',
  'synthetic-candidate-2',
  '{}'::jsonb
), (
  '74747474-7474-4474-8474-747474747474',
  '22222222-2222-4222-8222-222222222222',
  'Sem fonte sintética',
  'Não pode virar cânone.',
  'event',
  'candidate',
  '{}'::uuid[],
  'synthetic-run',
  'synthetic-candidate-no-source',
  '{}'::jsonb
);

set role service_role;
do $forbidden$
declare
  result jsonb;
begin
  result := public.approve_canon_candidate_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '70707070-7070-4070-8070-707070707070',
    'Nota sintética'
  );
  if result <> '{"ok":false,"reason":"forbidden"}'::jsonb then
    raise exception 'canon approval without capability must fail closed: %', result;
  end if;
end;
$forbidden$;
reset role;

insert into public.role_permissions(role_id, permission_action)
values (
  '55555555-5555-4555-8555-555555555555',
  'narrative.canon.approve'
)
on conflict do nothing;

set role service_role;
do $main$
declare
  result jsonb;
  replay jsonb;
  missing jsonb;
  wrong_auth jsonb;
  canon_id uuid;
begin
  wrong_auth := public.approve_canon_candidate_atomic(
    '99999999-9999-4999-8999-999999999999',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '70707070-7070-4070-8070-707070707070',
    null
  );
  if wrong_auth <> '{"ok":false,"reason":"forbidden"}'::jsonb then
    raise exception 'unbound auth identity must be forbidden: %', wrong_auth;
  end if;

  missing := public.approve_canon_candidate_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '72727272-7272-4272-8272-727272727272',
    null
  );
  if missing <> '{"ok":false,"reason":"not_found"}'::jsonb then
    raise exception 'authorized missing candidate must return not_found: %', missing;
  end if;

  result := public.approve_canon_candidate_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '74747474-7474-4474-8474-747474747474',
    null
  );
  if result <> '{"ok":false,"reason":"source_required"}'::jsonb then
    raise exception 'candidate without resolvable source must not become canon: %', result;
  end if;
  if exists (
       select 1 from public.canon_entries
       where source_candidate_id='74747474-7474-4474-8474-747474747474'::uuid
     )
     or exists (
       select 1 from public.review_decisions
       where target_id='74747474-7474-4474-8474-747474747474'::uuid
     )
     or exists (
       select 1 from public.audit_log
       where record_id='74747474-7474-4474-8474-747474747474'::uuid
     ) then
    raise exception 'source_required rejection must be side-effect free';
  end if;

  result := public.approve_canon_candidate_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '70707070-7070-4070-8070-707070707070',
    'Nota sintética aprovada'
  );
  if result->>'ok' <> 'true'
     or result->>'status' <> 'approved'
     or result->>'visibility' <> 'review_only' then
    raise exception 'valid candidate approval failed: %', result;
  end if;
  canon_id := (result->>'canonEntryId')::uuid;

  if not exists (
       select 1
       from public.canon_entries canon
       where canon.id = canon_id
         and canon.source_candidate_id = '70707070-7070-4070-8070-707070707070'::uuid
         and canon.visibility = 'review_only'
         and canon.status = 'active'
         and canon.title = 'Evento sintético'
         and canon.content = 'Afirmação sintética para aprovação.'
     )
     or not exists (
       select 1
       from public.canon_candidates candidate
       where candidate.id = '70707070-7070-4070-8070-707070707070'::uuid
         and candidate.status = 'approved_canon'
         and candidate.approved_by = '33333333-3333-4333-8333-333333333333'::uuid
         and candidate.approved_at is not null
         and candidate.reviewer_notes = 'Nota sintética aprovada'
     )
     or (select count(*) from public.review_decisions
         where target_table='canon_candidates'
           and target_id='70707070-7070-4070-8070-707070707070'::uuid
           and decision='approved_canon') <> 1
     or (select count(*) from public.audit_log
         where action='canon_candidate.approve'
           and record_id='70707070-7070-4070-8070-707070707070'::uuid) <> 1 then
    raise exception 'approved candidate did not commit one coherent review transaction';
  end if;

  if exists (
    select 1
    from public.audit_log audit
    where audit.action='canon_candidate.approve'
      and (
        coalesce(audit.old_value::text, '') || coalesce(audit.new_value::text, '')
      ) like '%Afirmação sintética%'
  ) then
    raise exception 'canon approval audit leaked narrative content';
  end if;

  replay := public.approve_canon_candidate_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '70707070-7070-4070-8070-707070707070',
    'Outra nota não deve sobrescrever decisão existente'
  );
  if replay->>'ok' <> 'true'
     or replay->>'status' <> 'unchanged'
     or replay->>'canonEntryId' <> canon_id::text then
    raise exception 'canon approval replay must be idempotent: %', replay;
  end if;

  if (select count(*) from public.canon_entries
      where source_candidate_id='70707070-7070-4070-8070-707070707070'::uuid) <> 1
     or (select count(*) from public.review_decisions
         where target_id='70707070-7070-4070-8070-707070707070'::uuid) <> 1
     or (select count(*) from public.audit_log
         where action='canon_candidate.approve'
           and record_id='70707070-7070-4070-8070-707070707070'::uuid) <> 1 then
    raise exception 'canon approval replay duplicated evidence';
  end if;
end;
$main$;
reset role;

-- Force a late audit failure and prove entry + candidate + decision roll back.
create function public.fail_canon_approval_audit()
returns trigger
language plpgsql
as $probe$
begin
  if new.action = 'canon_candidate.approve'
     and new.record_id = '71717171-7171-4171-8171-717171717171'::uuid then
    raise exception 'synthetic canon approval audit failure';
  end if;
  return new;
end;
$probe$;

create trigger fail_canon_approval_audit
before insert on public.audit_log
for each row execute function public.fail_canon_approval_audit();

set role service_role;
do $rollback$
declare
  failed boolean := false;
begin
  begin
    perform public.approve_canon_candidate_atomic(
      '44444444-4444-4444-8444-444444444444',
      '33333333-3333-4333-8333-333333333333',
      'synthetic-campaign',
      '71717171-7171-4171-8171-717171717171',
      null
    );
  exception when others then
    if sqlerrm like '%synthetic canon approval audit failure%' then
      failed := true;
    else
      raise;
    end if;
  end;

  if not failed then
    raise exception 'late audit failure must abort canon approval';
  end if;
end;
$rollback$;
reset role;

drop trigger fail_canon_approval_audit on public.audit_log;
drop function public.fail_canon_approval_audit();

do $rollback_assert$
begin
  if exists (
       select 1 from public.canon_entries
       where source_candidate_id='71717171-7171-4171-8171-717171717171'::uuid
     )
     or exists (
       select 1 from public.review_decisions
       where target_id='71717171-7171-4171-8171-717171717171'::uuid
     )
     or exists (
       select 1 from public.audit_log
       where action='canon_candidate.approve'
         and record_id='71717171-7171-4171-8171-717171717171'::uuid
     )
     or (select status from public.canon_candidates
         where id='71717171-7171-4171-8171-717171717171'::uuid) <> 'candidate' then
    raise exception 'failed canon approval left partial state';
  end if;
end;
$rollback_assert$;

-- Leave shared fixtures pristine for the provenance suite that follows.
delete from public.review_decisions
where target_table='canon_candidates'
  and target_id in (
    '70707070-7070-4070-8070-707070707070'::uuid,
    '71717171-7171-4171-8171-717171717171'::uuid,
    '74747474-7474-4474-8474-747474747474'::uuid
  );
delete from public.audit_log
where action='canon_candidate.approve'
  and record_id in (
    '70707070-7070-4070-8070-707070707070'::uuid,
    '71717171-7171-4171-8171-717171717171'::uuid
  );
delete from public.canon_entries
where source_candidate_id in (
  '70707070-7070-4070-8070-707070707070'::uuid,
  '71717171-7171-4171-8171-717171717171'::uuid
);
delete from public.canon_candidates
where id in (
  '70707070-7070-4070-8070-707070707070'::uuid,
  '71717171-7171-4171-8171-717171717171'::uuid,
  '74747474-7474-4474-8474-747474747474'::uuid
);
delete from public.transcript_segments
where id in (
  '80808080-8080-4080-8080-808080808080'::uuid,
  '81818181-8181-4181-8181-818181818181'::uuid
);
delete from public.role_permissions
where role_id = '55555555-5555-4555-8555-555555555555'::uuid
  and permission_action = 'narrative.canon.approve';
