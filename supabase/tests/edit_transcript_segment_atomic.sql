-- Integration test for public.edit_transcript_segment_atomic.
-- ISOLATED/LOCAL DATABASE ONLY. Never run this script against production.
-- The script creates synthetic rows only and ends with ROLLBACK.

begin;

insert into public.campaigns (id, name, slug)
values
  ('11111111-1111-4111-8111-111111111111', 'Synthetic Campaign A', 'tda-test-edit-a'),
  ('22222222-2222-4222-8222-222222222222', 'Synthetic Campaign B', 'tda-test-edit-b');

insert into public.profiles (id, display_name, source_system, source_key)
values (
  '33333333-3333-4333-8333-333333333333',
  'Synthetic Edit Actor',
  'tda-test',
  'atomic-edit-actor'
);

insert into public.sessions (id, campaign_id, title, source_system, source_session_id)
values (
  '44444444-4444-4444-8444-444444444444',
  '11111111-1111-4111-8111-111111111111',
  'Synthetic Edit Session',
  'tda-test',
  'atomic-edit-session'
);

insert into public.transcript_segments (
  id,
  session_id,
  start_ms,
  end_ms,
  text,
  speaker_name,
  character_name,
  text_chars,
  text_words,
  is_empty,
  needs_review,
  review_status,
  revision
)
values
  (
    '55555555-5555-4555-8555-555555555555',
    '44444444-4444-4444-8444-444444444444',
    0,
    1000,
    'Original text',
    'Synthetic Speaker',
    'Synthetic Hero',
    13,
    2,
    false,
    true,
    'pending',
    0
  ),
  (
    '66666666-6666-4666-8666-666666666666',
    '44444444-4444-4444-8444-444444444444',
    1000,
    2000,
    'Rollback text',
    'Synthetic Speaker',
    'Rollback Hero',
    13,
    2,
    false,
    true,
    'pending',
    0
  );

-- Two writes with the same expected revision: exactly one succeeds.
do $$
declare
  v_first record;
  v_second record;
  v_revision bigint;
  v_character_name text;
  v_audit_count integer;
  v_old jsonb;
  v_new jsonb;
begin
  select * into v_first
  from public.edit_transcript_segment_atomic(
    '33333333-3333-4333-8333-333333333333',
    'tda-test-edit-a',
    '55555555-5555-4555-8555-555555555555',
    0,
    'Edited text',
    'Synthetic Speaker',
    'approved',
    false,
    11,
    2
  );

  if v_first.status <> 'updated' or v_first.revision <> 1 then
    raise exception 'expected first write to return updated revision=1, got %/%', v_first.status, v_first.revision;
  end if;

  select * into v_second
  from public.edit_transcript_segment_atomic(
    '33333333-3333-4333-8333-333333333333',
    'tda-test-edit-a',
    '55555555-5555-4555-8555-555555555555',
    0,
    'Conflicting text',
    'Synthetic Speaker',
    'approved',
    false,
    16,
    2
  );

  if v_second.status <> 'conflict' or v_second.revision is not null then
    raise exception 'expected second write to conflict, got %/%', v_second.status, v_second.revision;
  end if;

  select revision, character_name
  into v_revision, v_character_name
  from public.transcript_segments
  where id = '55555555-5555-4555-8555-555555555555';

  if v_revision <> 1 then
    raise exception 'revision must increment exactly once; got %', v_revision;
  end if;
  if v_character_name is distinct from 'Synthetic Hero' then
    raise exception 'character identity must be preserved when speaker does not change; got %', v_character_name;
  end if;

  select count(*), min(old_value), min(new_value)
  into v_audit_count, v_old, v_new
  from public.audit_log
  where record_id = '55555555-5555-4555-8555-555555555555'
    and action = 'transcript_segment.update';

  if v_audit_count <> 1 then
    raise exception 'expected exactly one audit row after updated+conflict; got %', v_audit_count;
  end if;
  if v_old ->> 'revision' <> '0' or v_new ->> 'revision' <> '1' then
    raise exception 'audit revisions must be 0 -> 1; got % -> %', v_old ->> 'revision', v_new ->> 'revision';
  end if;
  if v_old ->> 'character_name' <> 'Synthetic Hero' or v_new ->> 'character_name' <> 'Synthetic Hero' then
    raise exception 'audit must preserve character identity for unchanged speaker';
  end if;
end;
$$;

-- A segment that exists in campaign A must look absent through campaign B.
do $$
declare
  v_result record;
  v_audit_count integer;
begin
  select * into v_result
  from public.edit_transcript_segment_atomic(
    '33333333-3333-4333-8333-333333333333',
    'tda-test-edit-b',
    '55555555-5555-4555-8555-555555555555',
    1,
    'Cross campaign attempt',
    'Synthetic Speaker',
    'approved',
    false,
    22,
    3
  );

  if v_result.status <> 'not_found' then
    raise exception 'cross-campaign access must return not_found; got %', v_result.status;
  end if;

  select count(*) into v_audit_count
  from public.audit_log
  where record_id = '55555555-5555-4555-8555-555555555555';

  if v_audit_count <> 1 then
    raise exception 'cross-campaign attempt must not create an audit row; got total %', v_audit_count;
  end if;
end;
$$;

-- Inject an audit failure and prove the transcript UPDATE rolls back with it.
create or replace function pg_temp.fail_atomic_edit_audit()
returns trigger
language plpgsql
as $$
begin
  if new.record_id = '66666666-6666-4666-8666-666666666666'::uuid
     and new.action = 'transcript_segment.update' then
    raise exception 'synthetic audit failure';
  end if;
  return new;
end;
$$;

create trigger tda_test_fail_atomic_edit_audit
before insert on public.audit_log
for each row
execute function pg_temp.fail_atomic_edit_audit();

do $$
declare
  v_failed boolean := false;
  v_text text;
  v_revision bigint;
  v_character_name text;
  v_audit_count integer;
begin
  begin
    perform *
    from public.edit_transcript_segment_atomic(
      '33333333-3333-4333-8333-333333333333',
      'tda-test-edit-a',
      '66666666-6666-4666-8666-666666666666',
      0,
      'Should roll back',
      'Synthetic Speaker',
      'approved',
      false,
      16,
      3
    );
  exception
    when others then
      if sqlerrm = 'synthetic audit failure' then
        v_failed := true;
      else
        raise;
      end if;
  end;

  if not v_failed then
    raise exception 'expected injected audit failure';
  end if;

  select text, revision, character_name
  into v_text, v_revision, v_character_name
  from public.transcript_segments
  where id = '66666666-6666-4666-8666-666666666666';

  if v_text <> 'Rollback text' or v_revision <> 0 then
    raise exception 'segment update did not roll back after audit failure: text=%, revision=%', v_text, v_revision;
  end if;
  if v_character_name is distinct from 'Rollback Hero' then
    raise exception 'identity changed despite audit rollback; got %', v_character_name;
  end if;

  select count(*) into v_audit_count
  from public.audit_log
  where record_id = '66666666-6666-4666-8666-666666666666';

  if v_audit_count <> 0 then
    raise exception 'failed audit transaction must leave zero audit rows; got %', v_audit_count;
  end if;
end;
$$;

rollback;
