-- Keep newly-created transcript segments aligned with the application invariant:
-- pending review status implies the segment needs review.
-- Historical rows are intentionally not backfilled here.
alter table public.transcript_segments
  alter column needs_review set default true;
