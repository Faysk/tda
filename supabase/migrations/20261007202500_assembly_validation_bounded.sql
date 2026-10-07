-- #1578: the authenticated private handoff can validate up to 100,000 segments.
-- Production's inherited authenticator 8s budget cancelled the real 8,019-row
-- validation. PostgREST hoists this function-local budget for its RPC transaction.
-- Keep a finite 30s budget on this server-only entry point; retain the inherited
-- lock timeout, all authorization/validation/CAS checks and atomic rollback.
-- No role/global timeout, grant, row, function body or provider plan is changed.
-- Rollback: ALTER FUNCTION ... RESET statement_timeout; reload schema cache.
alter function public.prepare_transcript_handoff_atomic(uuid, uuid, text, jsonb, boolean)
  set statement_timeout = '30s';
notify pgrst, 'reload schema';
