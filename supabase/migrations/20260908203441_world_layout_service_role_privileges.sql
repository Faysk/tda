-- Production hardening for Supabase default privileges: the World layout table
-- must expose only the operations required by the server-side snapshot boundary.
revoke all on table public.world_layout_snapshots from service_role;
grant select, insert, update on table public.world_layout_snapshots to service_role;
