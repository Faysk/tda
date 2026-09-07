#!/usr/bin/env bash
set -euo pipefail

# ISOLATED/LOCAL DATABASE ONLY. Never point TEST_DATABASE_URL at production.
# Prerequisites: psql, minimal fixture (or equivalent schema), candidate migration applied.
: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL to a disposable PostgreSQL database}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PUB='{"session":"fixture","version":1}'
PUB_SHA='9806e918ed5dcebfe9689a54645dac87dd45da8e219387a65538811983679a0b'
BASE='{"segments":[{"end":1000,"id":"seg-1","speaker":"Alice","start":0,"text":"Ola mundo","track":"alice","words":2},{"end":2200,"id":"seg-2","speaker":"","start":1000,"text":"","track":"ambient","words":0}]}'
BASE_SHA='06bc9fb08bc3fb7d58ae9865bebd235943400c96a545ea0f55ae8dec9afccf0f'
CONFLICT='{"segments":[{"end":1000,"id":"seg-1","speaker":"Alice","start":0,"text":"Changed","track":"alice","words":1}]}'
CONFLICT_SHA='f391de61b8533f71a91a5b613810234e3734773fb4a3099d0d6cc40b52b72480'

psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
insert into public.campaigns (id, name, slug)
values ('70000000-0000-4000-8000-000000000001', 'Concurrency Campaign', 'tda-test-import-concurrency');

insert into public.profiles (id, display_name)
values ('71000000-0000-4000-8000-000000000001', 'Concurrency Operator');

insert into public.role_assignments (profile_id, role_id, scope_type, scope_id, status, starts_at, reason)
select
  '71000000-0000-4000-8000-000000000001',
  rd.id,
  'campaign',
  'tda-test-import-concurrency',
  'active',
  now() - interval '1 minute',
  'synthetic two-connection test'
from public.role_definitions rd
where rd.slug = 'local_operator';

insert into public.sessions (id, campaign_id, title, source_system, source_session_id)
values
  ('72000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'Same Hash Race', 'local_companion', 'concurrency-same'),
  ('72000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', 'Different Hash Race', 'local_companion', 'concurrency-conflict');
SQL

run_a() {
  local session_id="$1" source_id="$2"
  PGAPPNAME=tda-import-a psql "$TEST_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 \
    -v pub="$PUB" -v pub_sha="$PUB_SHA" -v transcript="$BASE" -v transcript_sha="$BASE_SHA" \
    -v session_id="$session_id" -v source_id="$source_id" <<'SQL'
BEGIN;
SET LOCAL ROLE service_role;
select status || '|' || segment_count
from public.import_transcript_result_atomic(
  '71000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  :'session_id'::uuid,
  :'source_id',
  :'pub', :'pub_sha', :'transcript', :'transcript_sha'
);
select pg_sleep(3);
COMMIT;
SQL
}

run_b() {
  local session_id="$1" source_id="$2" transcript="$3" transcript_sha="$4"
  PGAPPNAME=tda-import-b psql "$TEST_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 \
    -v pub="$PUB" -v pub_sha="$PUB_SHA" -v transcript="$transcript" -v transcript_sha="$transcript_sha" \
    -v session_id="$session_id" -v source_id="$source_id" <<'SQL'
SET ROLE service_role;
select status || '|' || segment_count
from public.import_transcript_result_atomic(
  '71000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  :'session_id'::uuid,
  :'source_id',
  :'pub', :'pub_sha', :'transcript', :'transcript_sha'
);
SQL
}

# Scenario 1: same identity + same hash => one imported, one replay.
run_a '72000000-0000-4000-8000-000000000001' 'concurrency-same' >"$TMP_DIR/a-same.out" 2>"$TMP_DIR/a-same.err" &
A_PID=$!
sleep 0.4
run_b '72000000-0000-4000-8000-000000000001' 'concurrency-same' "$BASE" "$BASE_SHA" >"$TMP_DIR/b-same.out" 2>"$TMP_DIR/b-same.err" &
B_PID=$!
sleep 0.5

BLOCKING="$(psql "$TEST_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c "select coalesce(wait_event_type,'') || '|' || coalesce(wait_event,'') || '|' || cardinality(pg_blocking_pids(pid)) from pg_stat_activity where application_name='tda-import-b' order by backend_start desc limit 1")"
if [[ "$BLOCKING" != Lock\|transactionid\|* ]] || [[ "${BLOCKING##*|}" -lt 1 ]]; then
  echo "Expected B to wait on A transaction lock; observed: ${BLOCKING:-<none>}" >&2
  exit 1
fi

wait "$A_PID"
wait "$B_PID"
grep -qx 'imported|2' "$TMP_DIR/a-same.out"
grep -qx 'replay|2' "$TMP_DIR/b-same.out"

# Scenario 2: same identity + different hash => one imported, one hash_conflict.
run_a '72000000-0000-4000-8000-000000000002' 'concurrency-conflict' >"$TMP_DIR/a-conflict.out" 2>"$TMP_DIR/a-conflict.err" &
A_PID=$!
sleep 0.4
run_b '72000000-0000-4000-8000-000000000002' 'concurrency-conflict' "$CONFLICT" "$CONFLICT_SHA" >"$TMP_DIR/b-conflict.out" 2>"$TMP_DIR/b-conflict.err" &
B_PID=$!
wait "$A_PID"
wait "$B_PID"
grep -qx 'imported|2' "$TMP_DIR/a-conflict.out"
grep -qx 'hash_conflict|2' "$TMP_DIR/b-conflict.out"

psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  v_receipts integer;
  v_segments_same integer;
  v_segments_conflict integer;
begin
  select count(*) into v_receipts
  from public.transcript_import_receipts
  where campaign_id = '70000000-0000-4000-8000-000000000001';

  select count(*) into v_segments_same
  from public.transcript_segments
  where session_id = '72000000-0000-4000-8000-000000000001';

  select count(*) into v_segments_conflict
  from public.transcript_segments
  where session_id = '72000000-0000-4000-8000-000000000002';

  if v_receipts <> 2 or v_segments_same <> 2 or v_segments_conflict <> 2 then
    raise exception 'unexpected final state: receipts=%, same_segments=%, conflict_segments=%',
      v_receipts, v_segments_same, v_segments_conflict;
  end if;
end;
$$;

-- Cleanup synthetic rows. Campaign delete cascades sessions, receipts and transcript segments.
delete from public.campaigns where id = '70000000-0000-4000-8000-000000000001';
delete from public.profiles where id = '71000000-0000-4000-8000-000000000001';
SQL

echo "PASS: real two-connection import serialization, replay and hash conflict"
