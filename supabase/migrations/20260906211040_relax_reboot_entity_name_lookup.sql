-- Keep the legacy exact-name uniqueness required by dnd-scribe's canon consolidator.
-- Remove only the extra case-insensitive uniqueness introduced by the reboot and
-- retain a non-unique lookup index for future entity resolution.

begin;

drop index if exists public.entities_campaign_lower_name_unique;

create index if not exists entities_campaign_lower_name_idx
  on public.entities(campaign_id, lower(name));

comment on constraint entities_campaign_id_name_key on public.entities is
  'Legacy compatibility constraint. dnd-scribe canon consolidator uses ON CONFLICT (campaign_id, name). Remove only after that workflow migrates to canonical entity UUID/slug identity.';

commit;
