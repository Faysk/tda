-- Restore least privilege for the bounded transcript statistics read model.
-- TDA:ALLOW_DESTRUCTIVE_MIGRATION: REVOKE removes unintended service_role table privileges only; no rows/schema objects are removed.
-- Supabase default table privileges can grant service_role more than the explicit
-- SELECT intended by the original migration, so revoke before re-granting.

revoke all on table public.transcript_session_statistics from service_role;
grant select on table public.transcript_session_statistics to service_role;

do $stats_grants$
begin
  if not has_table_privilege(
    'service_role',
    'public.transcript_session_statistics',
    'SELECT'
  ) then
    raise exception 'TRANSCRIPT_STATS_SERVICE_ROLE_SELECT_MISSING';
  end if;

  if
    has_table_privilege('service_role', 'public.transcript_session_statistics', 'INSERT')
    or has_table_privilege('service_role', 'public.transcript_session_statistics', 'UPDATE')
    or has_table_privilege('service_role', 'public.transcript_session_statistics', 'DELETE')
    or has_table_privilege('service_role', 'public.transcript_session_statistics', 'TRUNCATE')
    or has_table_privilege('service_role', 'public.transcript_session_statistics', 'REFERENCES')
    or has_table_privilege('service_role', 'public.transcript_session_statistics', 'TRIGGER')
  then
    raise exception 'TRANSCRIPT_STATS_SERVICE_ROLE_PRIVILEGE_DRIFT';
  end if;

  if
    has_table_privilege('anon', 'public.transcript_session_statistics', 'SELECT')
    or has_table_privilege('authenticated', 'public.transcript_session_statistics', 'SELECT')
  then
    raise exception 'TRANSCRIPT_STATS_BROWSER_READ_GRANT_DRIFT';
  end if;
end;
$stats_grants$;
