-- Complete narrative links that can be recovered safely from legacy session data.
-- Do not infer or backfill human profile identity when historical participant.profile_id is absent.

begin;

update public.participants participant
set character_entity_id = entity.id
from public.sessions session,
     public.entities entity
where participant.character_entity_id is null
  and participant.session_id = session.id
  and entity.campaign_id = session.campaign_id
  and entity.entity_type = 'pc'
  and lower(entity.name) = lower(coalesce(participant.character_name, ''));

-- Narrative lookup indexes used by future memory/timeline/entity features.
create unique index if not exists entities_campaign_lower_name_unique
  on public.entities(campaign_id, lower(name));

create index if not exists entities_campaign_type_status_idx
  on public.entities(campaign_id, entity_type, status);

create index if not exists entities_aliases_gin_idx
  on public.entities using gin(aliases);

create index if not exists entity_mentions_entity_id_idx
  on public.entity_mentions(entity_id);

create index if not exists entity_mentions_session_id_idx
  on public.entity_mentions(session_id)
  where session_id is not null;

create index if not exists entity_mentions_segment_id_idx
  on public.entity_mentions(segment_id)
  where segment_id is not null;

create index if not exists entity_mentions_roll20_event_id_idx
  on public.entity_mentions(roll20_event_id)
  where roll20_event_id is not null;

create index if not exists canon_candidates_related_entity_ids_gin_idx
  on public.canon_candidates using gin(related_entity_ids);

create index if not exists profile_characters_profile_id_idx
  on public.profile_characters(profile_id);

comment on column public.participants.character_entity_id is
  'Canonical character entity represented by this participant in one session when known; may be resolved independently of historical profile linkage.';

commit;
