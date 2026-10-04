-- #1475: retire the v1 session campaign-move commit after contract v2.
--
-- Contract v2 reuses preflight_session_campaign_move(...) but commits through
-- move_session_campaign_v2_atomic(...). Leaving the v1 commit executable would
-- allow a stale Server Action to consume the v2-ready preflight and then update
-- only sessions.campaign_id, bypassing the populated-session graph migration.
--
-- Keep the historical function defined for schema/history compatibility, but
-- make every application role fail before entering its body.

begin;

revoke all on function public.move_session_campaign_atomic(
  uuid, uuid, text, text, uuid, text, uuid
) from public, anon, authenticated, service_role;

comment on function public.move_session_campaign_atomic(
  uuid, uuid, text, text, uuid, text, uuid
) is
  'Retired v1 session campaign-move commit. Contract v2 shares the preflight signature but must commit only through move_session_campaign_v2_atomic; application roles intentionally have no EXECUTE.';

commit;
