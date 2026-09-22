-- Post-rollout least-privilege and FK-index hardening for transcript publication.
-- Keeps immutable publication evidence insert/select-only for the application service role.

revoke all privileges on table
  public.transcript_revisions,
  public.transcript_publication_receipts,
  public.transcript_publication_events
from service_role;

grant select, insert on table
  public.transcript_revisions,
  public.transcript_publication_receipts,
  public.transcript_publication_events
to service_role;

create index if not exists sessions_current_transcript_revision_id_idx
  on public.sessions(current_transcript_revision_id)
  where current_transcript_revision_id is not null;

create index if not exists transcript_revisions_campaign_id_idx
  on public.transcript_revisions(campaign_id);

create index if not exists transcript_revisions_actor_profile_id_idx
  on public.transcript_revisions(actor_profile_id);

create index if not exists transcript_publication_receipts_campaign_id_idx
  on public.transcript_publication_receipts(campaign_id);

create index if not exists transcript_publication_receipts_actor_profile_id_idx
  on public.transcript_publication_receipts(actor_profile_id);

create index if not exists transcript_publication_events_campaign_id_idx
  on public.transcript_publication_events(campaign_id);

create index if not exists transcript_publication_events_revision_id_idx
  on public.transcript_publication_events(revision_id)
  where revision_id is not null;

create index if not exists transcript_publication_events_previous_revision_id_idx
  on public.transcript_publication_events(previous_revision_id)
  where previous_revision_id is not null;

create index if not exists transcript_publication_events_actor_profile_id_idx
  on public.transcript_publication_events(actor_profile_id);
