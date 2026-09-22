\set ON_ERROR_STOP on

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
    and p.oid = 'public.review_canon_candidate_atomic(uuid,uuid,text,uuid,text,text)'::regprocedure;

  if secure is not true then
    raise exception 'canon triage RPC must be SECURITY DEFINER';
  end if;
  if position('search_path=pg_catalog, public' in config) = 0 then
    raise exception 'canon triage RPC must pin search_path: %', config;
  end if;
  if has_function_privilege(
       'anon',
       'public.review_canon_candidate_atomic(uuid,uuid,text,uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.review_canon_candidate_atomic(uuid,uuid,text,uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception 'browser roles must not execute canon triage';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.review_canon_candidate_atomic(uuid,uuid,text,uuid,text,text)',
    'EXECUTE'
  ) then
    raise exception 'service_role must execute canon triage';
  end if;
end;
$contract$;

delete from public.role_permissions
where role_id='55555555-5555-4555-8555-555555555555'::uuid
  and permission_action='narrative.review.manage';

insert into public.permission_catalog(action,plane,description)
values ('narrative.review.manage','narrative','Review narrative candidates without granting canon.')
on conflict (action) do nothing;

insert into public.canon_candidates(
  id, session_id, title, claim, candidate_type, status,
  source_run_id, source_candidate_id, metadata
) values (
  '72727272-7272-4272-8272-727272727272',
  '22222222-2222-4222-8222-222222222222',
  'Interpretação sintética',
  'Claim privada sintética para triagem.',
  'interpretation',
  'candidate',
  'synthetic-run',
  'synthetic-review-1',
  '{}'::jsonb
), (
  '73737373-7373-4373-8373-737373737373',
  '22222222-2222-4222-8222-222222222222',
  'Rollback sintético',
  'Esta claim não pode sobreviver à falha.',
  'event',
  'candidate',
  'synthetic-run',
  'synthetic-review-2',
  '{}'::jsonb
);

set role service_role;
do $forbidden$
declare
  result jsonb;
begin
  result := public.review_canon_candidate_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '72727272-7272-4272-8272-727272727272',
    'interpretation',
    null
  );
  if result <> '{"ok":false,"reason":"forbidden"}'::jsonb then
    raise exception 'review without manage capability must fail closed: %', result;
  end if;
end;
$forbidden$;
reset role;

insert into public.role_permissions(role_id,permission_action)
values ('55555555-5555-4555-8555-555555555555','narrative.review.manage')
on conflict do nothing;

set role service_role;
do $main$
declare
  result jsonb;
  replay jsonb;
  invalid jsonb;
begin
  invalid := public.review_canon_candidate_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '72727272-7272-4272-8272-727272727272',
    'approved_canon',
    null
  );
  if invalid <> '{"ok":false,"reason":"invalid_payload"}'::jsonb then
    raise exception 'triage must never accept canon approval: %', invalid;
  end if;

  result := public.review_canon_candidate_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '72727272-7272-4272-8272-727272727272',
    'interpretation',
    'Revisão sintética'
  );
  if result <> '{"ok":true,"status":"reviewed","decision":"interpretation"}'::jsonb then
    raise exception 'valid triage failed: %', result;
  end if;

  if (select status from public.canon_candidates where id='72727272-7272-4272-8272-727272727272') <> 'interpretation'
     or (select reviewer_notes from public.canon_candidates where id='72727272-7272-4272-8272-727272727272') <> 'Revisão sintética'
     or exists (select 1 from public.canon_entries where source_candidate_id='72727272-7272-4272-8272-727272727272')
     or (select count(*) from public.review_decisions where target_id='72727272-7272-4272-8272-727272727272') <> 1
     or (select count(*) from public.audit_log where action='canon_candidate.review' and record_id='72727272-7272-4272-8272-727272727272') <> 1 then
    raise exception 'triage did not commit exactly one non-canon decision';
  end if;

  if exists (
    select 1 from public.audit_log
    where action='canon_candidate.review'
      and record_id='72727272-7272-4272-8272-727272727272'
      and (coalesce(old_value::text,'') || coalesce(new_value::text,'')) like '%Claim privada%'
  ) then
    raise exception 'triage audit leaked narrative content';
  end if;

  replay := public.review_canon_candidate_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '72727272-7272-4272-8272-727272727272',
    'interpretation',
    'Não sobrescrever'
  );
  if replay <> '{"ok":true,"status":"unchanged","decision":"interpretation"}'::jsonb then
    raise exception 'triage replay must be idempotent: %', replay;
  end if;
  if (select count(*) from public.review_decisions where target_id='72727272-7272-4272-8272-727272727272') <> 1
     or (select count(*) from public.audit_log where action='canon_candidate.review' and record_id='72727272-7272-4272-8272-727272727272') <> 1 then
    raise exception 'triage replay duplicated evidence';
  end if;
end;
$main$;
reset role;

create function public.fail_canon_triage_audit()
returns trigger
language plpgsql
as $probe$
begin
  if new.action='canon_candidate.review'
     and new.record_id='73737373-7373-4373-8373-737373737373'::uuid then
    raise exception 'synthetic canon triage audit failure';
  end if;
  return new;
end;
$probe$;

create trigger fail_canon_triage_audit
before insert on public.audit_log
for each row execute function public.fail_canon_triage_audit();

set role service_role;
do $rollback$
declare
  failed boolean := false;
begin
  begin
    perform public.review_canon_candidate_atomic(
      '44444444-4444-4444-8444-444444444444',
      '33333333-3333-4333-8333-333333333333',
      'synthetic-campaign',
      '73737373-7373-4373-8373-737373737373',
      'rejected',
      null
    );
  exception when others then
    if sqlerrm like '%synthetic canon triage audit failure%' then
      failed := true;
    else
      raise;
    end if;
  end;
  if not failed then
    raise exception 'late audit failure must abort triage';
  end if;
end;
$rollback$;
reset role;

drop trigger fail_canon_triage_audit on public.audit_log;
drop function public.fail_canon_triage_audit();

do $assert$
begin
  if (select status from public.canon_candidates where id='73737373-7373-4373-8373-737373737373') <> 'candidate'
     or exists (select 1 from public.review_decisions where target_id='73737373-7373-4373-8373-737373737373')
     or exists (select 1 from public.audit_log where action='canon_candidate.review' and record_id='73737373-7373-4373-8373-737373737373') then
    raise exception 'failed triage left partial state';
  end if;
end;
$assert$;

delete from public.review_decisions
where target_id in (
 '72727272-7272-4272-8272-727272727272'::uuid,
 '73737373-7373-4373-8373-737373737373'::uuid
);
delete from public.audit_log
where action='canon_candidate.review'
  and record_id in (
   '72727272-7272-4272-8272-727272727272'::uuid,
   '73737373-7373-4373-8373-737373737373'::uuid
  );
delete from public.canon_candidates
where id in (
 '72727272-7272-4272-8272-727272727272'::uuid,
 '73737373-7373-4373-8373-737373737373'::uuid
);
delete from public.role_permissions
where role_id='55555555-5555-4555-8555-555555555555'::uuid
  and permission_action='narrative.review.manage';
