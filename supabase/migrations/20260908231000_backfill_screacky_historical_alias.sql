-- Stabilization #102: preserve a documented historical spelling as an alias.
-- This does not change canonical name, slug, entity type, visibility or canon.

begin;

do $$
declare
  target_count integer;
begin
  select count(*)
    into target_count
  from public.entities entity
  join public.campaigns campaign on campaign.id = entity.campaign_id
  where campaign.slug = 'yuhara-main'
    and entity.slug = 'screacky'
    and entity.entity_type = 'pc';

  if target_count <> 1 then
    raise exception 'Expected exactly one yuhara-main pc entity with slug screacky, found %', target_count;
  end if;

  update public.entities entity
  set aliases = array_append(coalesce(entity.aliases, '{}'::text[]), 'Screaky')
  from public.campaigns campaign
  where campaign.id = entity.campaign_id
    and campaign.slug = 'yuhara-main'
    and entity.slug = 'screacky'
    and entity.entity_type = 'pc'
    and not ('Screaky' = any(coalesce(entity.aliases, '{}'::text[])));
end
$$;

commit;
