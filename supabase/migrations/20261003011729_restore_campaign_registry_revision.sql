-- #1326: the deployed legacy campaigns table has no updated_at column.
-- The management reader and optimistic writes require this revision token.
-- Additive recovery: no identity, visibility, membership or media changes.
begin;

alter table public.campaigns
  add column if not exists updated_at timestamptz;
update public.campaigns
set updated_at = coalesce(created_at, statement_timestamp())
where updated_at is null;
alter table public.campaigns
  alter column updated_at set default statement_timestamp(),
  alter column updated_at set not null;

create or replace function public.advance_campaign_registry_revision()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $revision$
begin
  -- Database time owns the token, including same-transaction updates and
  -- clients whose clock is behind. Never accept a reused or regressed token.
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$revision$;

revoke all on function public.advance_campaign_registry_revision() from public;
revoke all on function public.advance_campaign_registry_revision() from anon, authenticated;
drop trigger if exists campaign_registry_revision on public.campaigns;
create trigger campaign_registry_revision
before update on public.campaigns
for each row execute function public.advance_campaign_registry_revision();

comment on column public.campaigns.updated_at is
  'Database-owned optimistic concurrency token for campaign management. Changes on every update; consumers compare the last read value.';
comment on function public.advance_campaign_registry_revision() is
  'Trigger-only monotonic campaign revision. SECURITY INVOKER; changes no ownership or authorization.';
notify pgrst, 'reload schema';
commit;
