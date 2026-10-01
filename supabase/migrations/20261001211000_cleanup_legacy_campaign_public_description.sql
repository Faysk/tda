-- #1281: remove a legacy operational seed description from public presentation.
-- Idempotent and deliberately narrow: do not overwrite a later editorial description.

update public.campaigns
set description = null
where slug = 'yuhara-main'
  and description = 'Campanha principal importada pelo pipeline local.';
