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
  v_permission_count integer;
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

  select count(*) into v_permission_count
  from public.role_permissions rp
  join public.role_definitions rd on rd.id = rp.role_id
  where rd.slug = 'local_operator'
    and rp.permission_action = 'campaign.transcript.import';

  if v_permission_count <> 1 then
    raise exception 'local_operator must receive campaign.transcript.import exactly once';
  end if;
end;
$$;

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

insert into public.role_assignments (
  profile_id,
  role_id,
  scope_type,
  scope_id,
  status,
  starts_at,
  reason
)
select
  '30000000-0000-4000-8000-000000000001',
  rd.id,
  'campaign',
  'tda-test-import-a',
  'active',
  now() - interval '1 minute',
  'synthetic campaign import grant'
from public.role_definitions rd
where rd.slug = 'local_operator';

insert into public.role_assignments (
  profile_id,
  role_id,
  scope_type,
  scope_id,
  status,
  starts_at,
  reason
)
select
  '30000000-0000-4000-8000-000000000002',
  rd.id,
  'project',
  'tda',
  'active',
  now() - interval '1 minute',
  'synthetic canonical project import grant'
from public.role_definitions rd
where rd.slug = 'local_operator';

insert into public.role_assignments (
  profile_id,
  role_id,
  scope_type,
  scope_id,
  status,
  starts_at,
  reason
)
select
  '30000000-0000-4000-8000-000000000004',
  rd.id,
  'project',
  'dnd-scribe',
  'active',
  now() - interval '1 minute',
  'synthetic legacy alias grant'
from public.role_definitions rd
where rd.slug = 'local_operator';

insert into public.sessions (id, campaign_id, title, source_system, source_session_id)
values
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Fresh Import', 'local_companion', 'fixture-source-1'),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'Project Import', 'local_companion', 'fixture-source-2'),
  ('40000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'Legacy Unreceipted', 'local_companion', 'fixture-source-legacy'),
  ('40000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000001', 'Receipt Rollback', 'local_companion', 'fixture-source-rollback'),
  ('40000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000002', 'Other Campaign', 'local_companion', 'fixture-source-other'),
  ('40000000-0000-4000-8000-000000000006', '20000000-0000-4000-8000-000000000001', 'Legacy Scope Denied', 'local_companion', 'fixture-source-legacy-scope');

insert into public.transcript_segments (
  id,
  session_id,
  start_ms,
  end_ms,
  text,
  source_segment_id,
  source_sequence,
  text_chars,
  text_words,
  is_empty,
  needs_review,
  review_status,
  revision
) values (
  '50000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000003',
  0,
  100,
  'Existing legacy row',
  'legacy-1',
  0,
  19,
  3,
  false,
  true,
  'pending',
  0
);

-- First import: exact canonical Python-style strings and hashes.
do $$
declare
  v_result record;
  v_receipt_count integer;
  v_segment_count integer;
  v_bad_identity_count integer;
  v_first record;
  v_second record;
begin
  select * into v_result
  from public.import_transcript_result_atomic(
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'fixture-source-1',
    '{"session":"fixture","version":1}',
    '9806e918ed5dcebfe9689a54645dac87dd45da8e219387a65538811983679a0b',
    '{"segments":[{"end":1000,"id":"seg-1","speaker":"Alice","start":0,"text":"Ola mundo","track":"alice","words":2},{"end":2200,"id":"seg-2","speaker":"","start":1000,"text":"","track":"ambient","words":0}]}',
    '06bc9fb08bc3fb7d58ae9865bebd235943400c96a545ea0f55ae8dec9afccf0f'
  );

  if v_result.status <> 'imported' or v_result.receipt_id is null or v_result.segment_count <> 2 then
    raise exception 'expected imported/receipt/2, got %/%/%', v_result.status, v_result.receipt_id, v_result.segment_count;
  end if;

  select count(*) into v_receipt_count
  from public.transcript_import_receipts r
  where r.campaign_id = '20000000-0000-4000-8000-000000000001'
    and r.source_system = 'local_companion'
    and r.source_session_id = 'fixture-source-1'
    and r.actor_profile_id = '30000000-0000-4000-8000-000000000001'
    and r.envelope_schema = 'tda_local_result_v1'
    and r.publication_payload_sha256 = '9806e918ed5dcebfe9689a54645dac87dd45da8e219387a65538811983679a0b'
    and r.transcript_sha256 = '06bc9fb08bc3fb7d58ae9865bebd235943400c96a545ea0f55ae8dec9afccf0f'
    and r.segment_count = 2;

  if v_receipt_count <> 1 then
    raise exception 'expected exactly one durable receipt; got %', v_receipt_count;
  end if;

  select count(*) into v_segment_count
  from public.transcript_segments ts
  where ts.session_id = '40000000-0000-4000-8000-000000000001';

  if v_segment_count <> 2 then
    raise exception 'expected exactly two imported segments; got %', v_segment_count;
  end if;

  select * into v_first
  from public.transcript_segments ts
  where ts.session_id = '40000000-0000-4000-8000-000000000001'
    and ts.source_segment_id = 'seg-1';

  if v_first.source_sequence <> 0
     or v_first.start_ms <> 0
     or v_first.end_ms <> 1000
     or v_first.speaker_name <> 'Alice'
     or v_first.track_key <> 'alice'
     or v_first.text <> 'Ola mundo'
     or v_first.text_words <> 2
     or v_first.text_chars <> 9
     or v_first.is_empty
     or not v_first.needs_review
     or v_first.review_status <> 'pending'
     or v_first.revision <> 0 then
    raise exception 'first segment mapping is inconsistent: %', row_to_json(v_first);
  end if;

  select * into v_second
  from public.transcript_segments ts
  where ts.session_id = '40000000-0000-4000-8000-000000000001'
    and ts.source_segment_id = 'seg-2';

  if v_second.source_sequence <> 1
     or v_second.speaker_name is not null
     or v_second.track_key <> 'ambient'
     or v_second.text <> ''
     or v_second.text_words <> 0
     or not v_second.is_empty
     or not v_second.needs_review
     or v_second.review_status <> 'pending'
     or v_second.revision <> 0 then
    raise exception 'second segment mapping is inconsistent: %', row_to_json(v_second);
  end if;

  select count(*) into v_bad_identity_count
  from public.transcript_segments ts
  where ts.session_id = '40000000-0000-4000-8000-000000000001'
    and (ts.speaker_profile_id is not null or ts.participant_id is not null or ts.character_name is not null);

  if v_bad_identity_count <> 0 then
    raise exception 'import must not invent structured speaker/participant/character identity';
  end if;
end;
$$;

-- Exact replay is a no-op and returns the existing receipt.
do $$
declare
  v_result record;
  v_receipts integer;
  v_segments integer;
begin
  select * into v_result
  from public.import_transcript_result_atomic(
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'fixture-source-1',
    '{"session":"fixture","version":1}',
    '9806e918ed5dcebfe9689a54645dac87dd45da8e219387a65538811983679a0b',
    '{"segments":[{"end":1000,"id":"seg-1","speaker":"Alice","start":0,"text":"Ola mundo","track":"alice","words":2},{"end":2200,"id":"seg-2","speaker":"","start":1000,"text":"","track":"ambient","words":0}]}',
    '06bc9fb08bc3fb7d58ae9865bebd235943400c96a545ea0f55ae8dec9afccf0f'
  );

  if v_result.status <> 'replay' or v_result.receipt_id is null or v_result.segment_count <> 2 then
    raise exception 'expected replay with existing receipt; got %/%/%', v_result.status, v_result.receipt_id, v_result.segment_count;
  end if;

  select count(*) into v_receipts from public.transcript_import_receipts
  where session_id = '40000000-0000-4000-8000-000000000001';
  select count(*) into v_segments from public.transcript_segments
  where session_id = '40000000-0000-4000-8000-000000000001';

  if v_receipts <> 1 or v_segments <> 2 then
    raise exception 'replay changed persisted cardinality: receipts=%, segments=%', v_receipts, v_segments;
  end if;
end;
$$;

-- Same source identity with different exact artifact hash must conflict without writes.
do $$
declare
  v_result record;
  v_segments integer;
begin
  select * into v_result
  from public.import_transcript_result_atomic(
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'fixture-source-1',
    '{"session":"fixture","version":1}',
    '9806e918ed5dcebfe9689a54645dac87dd45da8e219387a65538811983679a0b',
    '{"segments":[{"end":1000,"id":"seg-1","speaker":"Alice","start":0,"text":"Changed","track":"alice","words":1}]}',
    'f391de61b8533f71a91a5b613810234e3734773fb4a3099d0d6cc40b52b72480'
  );

  if v_result.status <> 'hash_conflict' or v_result.receipt_id is null or v_result.segment_count <> 2 then
    raise exception 'expected hash_conflict preserving receipt; got %/%/%', v_result.status, v_result.receipt_id, v_result.segment_count;
  end if;

  select count(*) into v_segments from public.transcript_segments
  where session_id = '40000000-0000-4000-8000-000000000001';
  if v_segments <> 2 then
    raise exception 'hash conflict changed segment count: %', v_segments;
  end if;
end;
$$;

-- Existing transcript without a receipt is fail-closed; no adoption or replacement occurs.
do $$
declare
  v_result record;
  v_receipts integer;
  v_segments integer;
begin
  select * into v_result
  from public.import_transcript_result_atomic(
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000003',
    'fixture-source-legacy',
    '{"session":"fixture","version":1}',
    '9806e918ed5dcebfe9689a54645dac87dd45da8e219387a65538811983679a0b',
    '{"segments":[]}',
    '9c17cd7cd30705e19d0fa451fc4c8bb0a5a8c7a35c9f3fb09710c00ab9dc7f43'
  );

  if v_result.status <> 'legacy_unreceipted' or v_result.receipt_id is not null or v_result.segment_count <> 1 then
    raise exception 'expected legacy_unreceipted/1, got %/%/%', v_result.status, v_result.receipt_id, v_result.segment_count;
  end if;

  select count(*) into v_receipts from public.transcript_import_receipts
  where session_id = '40000000-0000-4000-8000-000000000003';
  select count(*) into v_segments from public.transcript_segments
  where session_id = '40000000-0000-4000-8000-000000000003';

  if v_receipts <> 0 or v_segments <> 1 then
    raise exception 'legacy_unreceipted must not mutate state: receipts=%, segments=%', v_receipts, v_segments;
  end if;
end;
$$;

-- Canonical project/tda grant inherits to campaign; wrong campaign/session ownership returns not_found.
do $$
declare
  v_result record;
begin
  select * into v_result
  from public.import_transcript_result_atomic(
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000005',
    'fixture-source-other',
    '{"session":"fixture","version":1}',
    '9806e918ed5dcebfe9689a54645dac87dd45da8e219387a65538811983679a0b',
    '{"segments":[]}',
    '9c17cd7cd30705e19d0fa451fc4c8bb0a5a8c7a35c9f3fb09710c00ab9dc7f43'
  );

  if v_result.status <> 'not_found' then
    raise exception 'cross-campaign session must return not_found; got %', v_result.status;
  end if;
end;
$$;

-- Project/tda can import a session in the campaign.
do $$
declare
  v_result record;
begin
  select * into v_result
  from public.import_transcript_result_atomic(
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002',
    'fixture-source-2',
    '{"session":"fixture","version":1}',
    '9806e918ed5dcebfe9689a54645dac87dd45da8e219387a65538811983679a0b',
    '{"segments":[]}',
    '9c17cd7cd30705e19d0fa451fc4c8bb0a5a8c7a35c9f3fb09710c00ab9dc7f43'
  );

  if v_result.status <> 'imported' or v_result.segment_count <> 0 then
    raise exception 'project/tda inheritance should import empty transcript; got %/%', v_result.status, v_result.segment_count;
  end if;
end;
$$;

-- Unprivileged profile and legacy project/dnd-scribe alias are denied.
do $$
declare
  v_denied boolean := false;
begin
  begin
    perform * from public.import_transcript_result_atomic(
      '30000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000006',
      'fixture-source-legacy-scope',
      '{"session":"fixture","version":1}',
      '9806e918ed5dcebfe9689a54645dac87dd45da8e219387a65538811983679a0b',
      '{"segments":[]}',
      '9c17cd7cd30705e19d0fa451fc4c8bb0a5a8c7a35c9f3fb09710c00ab9dc7f43'
    );
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'profile without campaign.transcript.import must be denied';
  end if;

  v_denied := false;
  begin
    perform * from public.import_transcript_result_atomic(
      '30000000-0000-4000-8000-000000000004',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000006',
      'fixture-source-legacy-scope',
      '{"session":"fixture","version":1}',
      '9806e918ed5dcebfe9689a54645dac87dd45da8e219387a65538811983679a0b',
      '{"segments":[]}',
      '9c17cd7cd30705e19d0fa451fc4c8bb0a5a8c7a35c9f3fb09710c00ab9dc7f43'
    );
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'legacy project/dnd-scribe scope must not authorize the reboot importer';
  end if;
end;
$$;

-- Exact hash mismatch is rejected before any persistence.
do $$
declare
  v_failed boolean := false;
begin
  begin
    perform * from public.import_transcript_result_atomic(
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000006',
      'fixture-source-legacy-scope',
      '{"session":"fixture","version":1}',
      '0000000000000000000000000000000000000000000000000000000000000000',
      '{"segments":[]}',
      '9c17cd7cd30705e19d0fa451fc4c8bb0a5a8c7a35c9f3fb09710c00ab9dc7f43'
    );
  exception when invalid_parameter_value then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'mismatched exact UTF-8 hash must be rejected';
  end if;
end;
$$;

-- Inject receipt failure and prove every inserted segment rolls back with the receipt.
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
  v_failed boolean := false;
  v_receipts integer;
  v_segments integer;
begin
  begin
    perform * from public.import_transcript_result_atomic(
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000004',
      'fixture-source-rollback',
      '{"session":"fixture","version":1}',
      '9806e918ed5dcebfe9689a54645dac87dd45da8e219387a65538811983679a0b',
      '{"segments":[{"end":1000,"id":"rollback-1","speaker":"Alice","start":0,"text":"Must roll back","track":"alice","words":3}]}',
      'f9873525dd0faf1c7c9ff6c187fa4b2f7dc45c9d8c7337c3f5ad9c7bc5a9b6f1'
    );
  exception when others then
    if sqlerrm = 'synthetic receipt failure' then
      v_failed := true;
    else
      raise;
    end if;
  end;

  if not v_failed then
    raise exception 'expected synthetic receipt failure';
  end if;

  select count(*) into v_receipts from public.transcript_import_receipts
  where session_id = '40000000-0000-4000-8000-000000000004';
  select count(*) into v_segments from public.transcript_segments
  where session_id = '40000000-0000-4000-8000-000000000004';

  if v_receipts <> 0 or v_segments <> 0 then
    raise exception 'receipt failure must roll back whole import: receipts=%, segments=%', v_receipts, v_segments;
  end if;
end;
$$;

rollback;
