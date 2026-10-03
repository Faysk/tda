-- Reproduce the Production legacy schema (fixture intentionally has no updated_at).
begin;
do $test$
declare
  target uuid;
  previous timestamptz;
  fresh timestamptz;
  affected integer;
  before_ids uuid[];
begin
  select array_agg(id order by id) into before_ids from public.campaigns;
  select id, updated_at into target, previous from public.campaigns
  where slug = 'yuhara-main';
  if previous is null then raise exception 'revision backfill missing'; end if;

  -- Exact management SELECT: a mocked fixture previously hid the missing column.
  perform id, slug, public_slug, name, description, lifecycle, visibility,
    archived_at, updated_at from public.campaigns order by name, slug;

  update public.campaigns set name = 'Destino Sem Fim', updated_at = previous
  where id = target and updated_at = previous
  returning updated_at into fresh;
  if fresh is null or fresh <= previous then
    raise exception 'successful compare-and-set must advance revision';
  end if;
  update public.campaigns set name = 'Stale overwrite'
  where id = target and updated_at = previous;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'stale editor overwrote campaign'; end if;

  update public.campaigns set description = 'Second update', updated_at = '2000-01-01'
  where id = target and updated_at = fresh returning updated_at into previous;
  if previous <= fresh then raise exception 'revision regressed'; end if;
  if before_ids <> (select array_agg(id order by id) from public.campaigns) then
    raise exception 'campaign identities changed';
  end if;
  if has_function_privilege('anon', 'public.advance_campaign_registry_revision()', 'execute')
    or has_function_privilege('authenticated', 'public.advance_campaign_registry_revision()', 'execute') then
    raise exception 'browser can invoke trigger function';
  end if;
end;
$test$;
rollback;
select 'CAMPAIGN_REGISTRY_REVISION_SQL_OK';
