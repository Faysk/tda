-- Integration test for public.import_transcript_result_atomic.
-- ISOLATED/LOCAL DATABASE ONLY. Never run this script against production.
-- Requires the minimal fixture (or equivalent schema) plus the candidate migration.
-- All rows are synthetic and the script ends with ROLLBACK.

begin;

-- Permission matrix, invoker mode and capability seed.
do $$
declare
  v_signature text := 'public.import_transcript_result_atomic(uuid,uuid,uuid,text,text,text,text,text)';
  v_security_definer boolean;
  v_config text[];
begin
  if has_function_privilege('anon', v_signature, 'EXECUTE') then
    raise exception 'anon must not execute import_transcript_result_atomic';
  end if;
  if has_function_privilege('authenticated', v_signature, 'EXECUTE') then
    raise exception 'authenticated must not execute import_transcript_result_atomic';
  end if;
  if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
    raise exception 'service_role must execute import_transcript_result_atomic';
  end if;

  select p.prosecdef, p.proconfig
  into v_security_definer, v_config
  from pg_proc p
  where p.oid = v_signature::regprocedure;

  if v_security_definer then
    raise exception 'import_transcript_result_atomic must remain SECURITY INVOKER';
  end if;
  if not ('search_path=pg_catalog, public' = any(v_config)) then
    raise exception 'function search_path is not fixed as expected: %', v_config;
  end if;

  if has_table_privilege('anon', 'public.transcript_import_receipts', 'SELECT')
     or has_table_privilege('authenticated', 'public.transcript_import_receipts', 'SELECT') then
    raise exception 'receipt table must not be directly readable by anon/authenticated';
  end if;
  if not has_table_privilege('service_role', 'public.transcript_import_receipts', 'SELECT')
     or not has_table_privilege('service_role', 'public.transcript_import_receipts', 'INSERT') then
    raise exception 'service_role needs SELECT+INSERT on transcript_import_receipts';
  end if;
  if has_table_privilege('service_role', 'public.transcript_import_receipts', 'UPDATE')
     or has_table_privilege('service_role', 'public.transcript_import_receipts', 'DELETE') then
    raise exception 'receipt must remain immutable through service_role grants';
  end if;

  if not exists (
    select 1
    from public.permission_catalog pc
    where pc.action = 'campaign.transcript.import'
      and pc.plane = 'mixed'
  ) then
    raise exception 'campaign.transcript.import capability was not seeded';
  end if;
  if not exists (
    select 1
    from public.role_permissions rp
    join public.role_definitions rd on rd.id = rp.role_id
    where rd.slug = 'local_operator'
      and rp.permission_action = 'campaign.transcript.import'
  ) then
    raise exception 'local_operator must receive campaign.transcript.import';
  end if;
end;
$$;

create temporary table tda_test_import_payloads (
  name text primary key,
  publication_json text not null,
  publication_sha text not null,
  transcript_json text not null,
  transcript_sha text not null
) on commit drop;

insert into tda_test_import_payloads values
  (
    'base',
    '{"session":"fixture","version":1}',
    '9806e918ed5dcebfe9689a54645dac87dd45da8e219387a65538811983679a0b',
    '{"segments":[{"end":1000,"id":"seg-1","speaker":"Alice","start":0,"text":"Ola mundo","track":"alice","words":2},{"end":2200,"id":"seg-2","speaker":"","start":1000,"text":"","track":"ambient","words":0}]}',
    '06bc9fb08bc3fb7d58ae9865bebd235943400c96a545ea0f55ae8dec9afccf0f'
  ),
  (
    'empty',
    '{"session":"fixture","version":1}',
    '9806e918ed5dcebfe9689a54645dac87dd45da8e219387a65538811983679a0b',
    '{"segments":[]}',
    'cf84482b9efdd9291a36643471c6e09c79a69623f87a7b61265b660e54e69eaf'
  ),
  (
    'conflict',
    '{"session":"fixture","version":1}',
    '9806e918ed5dcebfe9689a54645dac87dd45da8e219387a65538811983679a0b',
    '{"segments":[{"end":1000,"id":"seg-1","speaker":"Alice","start":0,"text":"Changed","track":"alice","words":1}]}',
    'f391de61b8533f71a91a5b613810234e3734773fb4a3099d0d6cc40b52b72480'
  ),
  (
    'rollback',
    '{"session":"fixture","version":1}',
    '9806e918ed5dcebfe9689a54645dac87dd45da8e219387a65538811983679a0b',
    '{"segments":[{"end":1000,"id":"rollback-1","speaker":"Alice","start":0,"text":"Must roll back","track":"alice","words":3}]}',
    '8675570acf12b504fca8952f6b30b081a00f0ae11d84a48f880defd4683d9f94'
  );

insert into public.campaigns (id, name, slug)
values
  ('20000000-0000-4000-8000-000000000001', 'Synthetic Campaign A', 'tda-test-import-a'),
  ('20000000-0000-4000-8000-000000000002', 'Synthetic Campaign B', 'tda-test-import-b');

insert into public.profiles (id, display_name)
values
  ('30000000-0000-4000-8000-000000000001', 'Campaign Operator'),
  ('30000000-0000-4000-8000-000000000002', 'Project Operator'),
  ('30000000-0000-4000-8000-000000000003', 'Unauthorized Actor'),
  ('30000000-0000-4000-8000-000000000004', 'Legacy Scope Actor');

insert into public.role_assignments (profile_id, role_id, scope_type, scope_id, status, starts_at, reason)
select '30000000-0000-4000-8000-000000000001', rd.id, 'campaign', 'tda-test-import-a', 'active', now() - interval '1 minute', 'synthetic campaign grant'
from public.role_definitions rd where rd.slug = 'local_operator';

insert into public.role_assignments (profile_id, role_id, scope_type, scope_id, status, starts_at, reason)
select '30000000-0000-4000-8000-000000000002', rd.id, 'project', 'tda', 'active', now() - interval '1 minute', 'synthetic project grant'
from public.role_definitions rd where rd.slug = 'local_operator';

insert into public.role_assignments (profile_id, role_id, scope_type, scope_id, status, starts_at, reason)
select '30000000-0000-4000-8000-000000000004', rd.id, 'project', 'dnd-scribe', 'active', now() - interval '1 minute', 'synthetic legacy alias grant'
from public.role_definitions rd where rd.slug = 'local_operator';

insert into public.sessions (id, campaign_id, title, source_system, source_session_id)
values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Fresh Import', 'local_companion', 'fixture-source-1'),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Project Import', 'local_companion', 'fixture-source-2'),
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Legacy Unreceipted', 'local_companion', 'fixture-source-legacy'),
  ('40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'Receipt Rollback', 'local_companion', 'fixture-source-rollback'),
  ('40000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000002', 'Other Campaign', 'local_companion', 'fixture-source-other'),
  ('40000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', 'Legacy Scope Denied', 'local_companion', 'fixture-source-legacy-scope');

insert into public.transcript_segments (
  id, session_id, start_ms, end_ms, text, source_segment_id, source_sequence,
  text_chars, text_words, is_empty, needs_review, review_status, revision
) values (
  '50000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000003',
  0, 100, 'Existing legacy row', 'legacy-1', 0, 19, 3, false, true, 'pending', 0
);

-- First import maps only the allowlisted legacy segment fields and creates one receipt.
do $$
declare
  p record;
  r record;
  s1 record;
  s2 record;
  v_count integer;
begin
  select * into p from tda_test_import_payloads where name = 'base';
  select * into r from public.import_transcript_result_atomic(
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'fixture-source-1', p.publication_json, p.publication_sha, p.transcript_json, p.transcript_sha
  );

  if r.status <> 'imported' or r.receipt_id is null or r.segment_count <> 2 then
    raise exception 'expected imported/receipt/2, got %/%/%', r.status, r.receipt_id, r.segment_count;
  end if;

  select count(*) into v_count from public.transcript_import_receipts
  where campaign_id = '20000000-0000-4000-8000-000000000001'
    and session_id = '40000000-0000-4000-8000-000000000001'
    and actor_profile_id = '30000000-0000-4000-8000-000000000001'
    and source_system = 'local_companion'
    and source_session_id = 'fixture-source-1'
    and envelope_schema = 'tda_local_result_v1'
    and publication_payload_sha256 = p.publication_sha
    and transcript_sha256 = p.transcript_sha
    and segment_count = 2;
  if v_count <> 1 then raise exception 'expected exactly one durable receipt'; end if;

  select * into s1 from public.transcript_segments where session_id = '40000000-0000-4000-8000-000000000001' and source_segment_id = 'seg-1';
  select * into s2 from public.transcript_segments where session_id = '40000000-0000-4000-8000-000000000001' and source_segment_id = 'seg-2';

  if s1.source_sequence <> 0 or s1.start_ms <> 0 or s1.end_ms <> 1000
     or s1.speaker_name <> 'Alice' or s1.track_key <> 'alice'
     or s1.text <> 'Ola mundo' or s1.text_words <> 2 or s1.text_chars <> 9
     or s1.is_empty or not s1.needs_review or s1.review_status <> 'pending' or s1.revision <> 0 then
    raise exception 'first segment mapping is inconsistent';
  end if;
  if s2.source_sequence <> 1 or s2.speaker_name is not null or s2.track_key <> 'ambient'
     or s2.text <> '' or s2.text_words <> 0 or not s2.is_empty
     or not s2.needs_review or s2.review_status <> 'pending' or s2.revision <> 0 then
    raise exception 'second segment mapping is inconsistent';
  end if;

  select count(*) into v_count from public.transcript_segments
  where session_id = '40000000-0000-4000-8000-000000000001'
    and (speaker_profile_id is not null or participant_id is not null or character_name is not null);
  if v_count <> 0 then raise exception 'import must not invent structured identity'; end if;
end;
$$;

-- Exact replay is a no-op; same source identity with a different artifact is a conflict.
do $$
declare
  p record;
  r record;
  v_receipts integer;
  v_segments integer;
begin
  select * into p from tda_test_import_payloads where name = 'base';
  select * into r from public.import_transcript_result_atomic(
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'fixture-source-1', p.publication_json, p.publication_sha, p.transcript_json, p.transcript_sha
  );
  if r.status <> 'replay' or r.receipt_id is null or r.segment_count <> 2 then
    raise exception 'expected replay/receipt/2, got %/%/%', r.status, r.receipt_id, r.segment_count;
  end if;

  select * into p from tda_test_import_payloads where name = 'conflict';
  select * into r from public.import_transcript_result_atomic(
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'fixture-source-1', p.publication_json, p.publication_sha, p.transcript_json, p.transcript_sha
  );
  if r.status <> 'hash_conflict' or r.receipt_id is null or r.segment_count <> 2 then
    raise exception 'expected hash_conflict preserving receipt, got %/%/%', r.status, r.receipt_id, r.segment_count;
  end if;

  select count(*) into v_receipts from public.transcript_import_receipts where session_id = '40000000-0000-4000-8000-000000000001';
  select count(*) into v_segments from public.transcript_segments where session_id = '40000000-0000-4000-8000-000000000001';
  if v_receipts <> 1 or v_segments <> 2 then
    raise exception 'replay/conflict changed cardinality: receipts=%, segments=%', v_receipts, v_segments;
  end if;
end;
$$;

-- Existing segments without receipt are never silently adopted or replaced.
do $$
declare
  p record;
  r record;
begin
  select * into p from tda_test_import_payloads where name = 'empty';
  select * into r from public.import_transcript_result_atomic(
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000003',
    'fixture-source-legacy', p.publication_json, p.publication_sha, p.transcript_json, p.transcript_sha
  );
  if r.status <> 'legacy_unreceipted' or r.receipt_id is not null or r.segment_count <> 1 then
    raise exception 'expected legacy_unreceipted/1, got %/%/%', r.status, r.receipt_id, r.segment_count;
  end if;
  if exists (select 1 from public.transcript_import_receipts where session_id = '40000000-0000-4000-8000-000000000003') then
    raise exception 'legacy_unreceipted must not create receipt';
  end if;
end;
$$;

-- project/tda inherits the exact campaign capability; cross-campaign ownership still fails closed.
do $$
declare
  p record;
  r record;
begin
  select * into p from tda_test_import_payloads where name = 'empty';
  select * into r from public.import_transcript_result_atomic(
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002',
    'fixture-source-2', p.publication_json, p.publication_sha, p.transcript_json, p.transcript_sha
  );
  if r.status <> 'imported' or r.segment_count <> 0 then
    raise exception 'project/tda capability should import empty transcript, got %/%', r.status, r.segment_count;
  end if;

  select * into r from public.import_transcript_result_atomic(
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000005',
    'fixture-source-other', p.publication_json, p.publication_sha, p.transcript_json, p.transcript_sha
  );
  if r.status <> 'not_found' then
    raise exception 'cross-campaign session must return not_found, got %', r.status;
  end if;
end;
$$;

-- No capability and legacy project/dnd-scribe scope are denied.
do $$
declare
  p record;
  v_denied boolean;
begin
  select * into p from tda_test_import_payloads where name = 'empty';

  v_denied := false;
  begin
    perform * from public.import_transcript_result_atomic(
      '30000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000006',
      'fixture-source-legacy-scope', p.publication_json, p.publication_sha, p.transcript_json, p.transcript_sha
    );
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'actor without import capability must be denied'; end if;

  v_denied := false;
  begin
    perform * from public.import_transcript_result_atomic(
      '30000000-0000-4000-8000-000000000004',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000006',
      'fixture-source-legacy-scope', p.publication_json, p.publication_sha, p.transcript_json, p.transcript_sha
    );
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'project/dnd-scribe must not authorize reboot import'; end if;
end;
$$;

-- Hashes are verified against the exact UTF-8 strings before persistence.
do $$
declare
  p record;
  v_failed boolean := false;
begin
  select * into p from tda_test_import_payloads where name = 'empty';
  begin
    perform * from public.import_transcript_result_atomic(
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000006',
      'fixture-source-legacy-scope', p.publication_json,
      '0000000000000000000000000000000000000000000000000000000000000000',
      p.transcript_json, p.transcript_sha
    );
  exception when invalid_parameter_value then v_failed := true;
  end;
  if not v_failed then raise exception 'mismatched exact UTF-8 hash must be rejected'; end if;
end;
$$;

-- Receipt insertion is the commit marker: forcing it to fail rolls every segment back.
create or replace function public.tda_test_fail_transcript_import_receipt_20260907()
returns trigger
language plpgsql
as $$
begin
  if new.source_session_id = 'fixture-source-rollback' then
    raise exception 'synthetic receipt failure';
  end if;
  return new;
end;
$$;

create trigger tda_test_fail_transcript_import_receipt
before insert on public.transcript_import_receipts
for each row
execute function public.tda_test_fail_transcript_import_receipt_20260907();

do $$
declare
  p record;
  v_failed boolean := false;
  v_receipts integer;
  v_segments integer;
begin
  select * into p from tda_test_import_payloads where name = 'rollback';
  begin
    perform * from public.import_transcript_result_atomic(
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000004',
      'fixture-source-rollback', p.publication_json, p.publication_sha, p.transcript_json, p.transcript_sha
    );
  exception when others then
    if sqlerrm = 'synthetic receipt failure' then v_failed := true; else raise; end if;
  end;
  if not v_failed then raise exception 'expected synthetic receipt failure'; end if;

  select count(*) into v_receipts from public.transcript_import_receipts where session_id = '40000000-0000-4000-8000-000000000004';
  select count(*) into v_segments from public.transcript_segments where session_id = '40000000-0000-4000-8000-000000000004';
  if v_receipts <> 0 or v_segments <> 0 then
    raise exception 'receipt failure must roll back whole import: receipts=%, segments=%', v_receipts, v_segments;
  end if;
end;
$$;

rollback;
