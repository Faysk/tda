alter table public.transcript_segments
  add column revision bigint not null default 0;

comment on column public.transcript_segments.revision is
  'Monotonic optimistic-concurrency counter for transcript edits; increment exactly once per successful canonical edit.';
