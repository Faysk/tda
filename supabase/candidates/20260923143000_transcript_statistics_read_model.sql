-- Candidate for #537. Not applied to Production by this PR.
-- Persist per-session transcript counts so /transcricoes no longer scans transcript text on every render.

begin;

create or replace function public.transcript_word_count_v1(value text)
returns integer
language sql
immutable
parallel safe
as $$
  select case
    when value is null then null
    when value ~ E'^\\s*$' then 0
    else cardinality(
      regexp_split_to_array(
        regexp_replace(value, E'^\\s+|\\s+$', '', 'g'),
        E'\\s+'
      )
    )
  end
$$;

revoke all on function public.transcript_word_count_v1(text) from public;
revoke all on function public.transcript_word_count_v1(text) from anon;
revoke all on function public.transcript_word_count_v1(text) from authenticated;
grant execute on function public.transcript_word_count_v1(text) to service_role;

create or replace function public.sync_transcript_segment_words_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.text_words := public.transcript_word_count_v1(new.text);
  return new;
end
$$;

drop trigger if exists transcript_segments_sync_words_v1 on public.transcript_segments;
create trigger transcript_segments_sync_words_v1
before insert or update of text, text_words
on public.transcript_segments
for each row
execute function public.sync_transcript_segment_words_v1();

-- Establish a trustworthy baseline before the aggregate trigger starts consuming deltas.
update public.transcript_segments
set text_words = public.transcript_word_count_v1(text)
where text_words is distinct from public.transcript_word_count_v1(text);

create table if not exists public.transcript_session_statistics (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  segment_count bigint not null default 0 check (segment_count >= 0),
  word_count bigint not null default 0 check (word_count >= 0),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.transcript_session_statistics enable row level security;
revoke all on table public.transcript_session_statistics from public;
revoke all on table public.transcript_session_statistics from anon;
revoke all on table public.transcript_session_statistics from authenticated;
grant select on table public.transcript_session_statistics to service_role;

insert into public.transcript_session_statistics(session_id, segment_count, word_count, updated_at)
select
  s.id,
  count(ts.id)::bigint,
  coalesce(sum(ts.text_words::bigint), 0)::bigint,
  clock_timestamp()
from public.sessions s
left join public.transcript_segments ts on ts.session_id = s.id
group by s.id
on conflict (session_id) do update
set
  segment_count = excluded.segment_count,
  word_count = excluded.word_count,
  updated_at = excluded.updated_at;

create or replace function public.seed_transcript_session_statistics_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.transcript_session_statistics(session_id)
  values (new.id)
  on conflict (session_id) do nothing;
  return new;
end
$$;

drop trigger if exists sessions_seed_transcript_statistics_v1 on public.sessions;
create trigger sessions_seed_transcript_statistics_v1
after insert
on public.sessions
for each row
execute function public.seed_transcript_session_statistics_v1();

create or replace function public.apply_transcript_session_statistics_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  old_words bigint;
  new_words bigint;
begin
  if tg_op <> 'INSERT' then
    old_words := old.text_words::bigint;
    if old_words is null then
      raise exception 'TRANSCRIPT_STATS_WORDS_MISSING';
    end if;
  end if;

  if tg_op <> 'DELETE' then
    new_words := new.text_words::bigint;
    if new_words is null then
      raise exception 'TRANSCRIPT_STATS_WORDS_MISSING';
    end if;
  end if;

  if tg_op = 'INSERT' then
    insert into public.transcript_session_statistics(
      session_id,
      segment_count,
      word_count,
      updated_at
    )
    values (new.session_id, 1, new_words, clock_timestamp())
    on conflict (session_id) do update
    set
      segment_count = public.transcript_session_statistics.segment_count + 1,
      word_count = public.transcript_session_statistics.word_count + excluded.word_count,
      updated_at = excluded.updated_at;
    return new;
  end if;

  if tg_op = 'DELETE' then
    update public.transcript_session_statistics
    set
      segment_count = segment_count - 1,
      word_count = word_count - old_words,
      updated_at = clock_timestamp()
    where session_id = old.session_id
      and segment_count >= 1
      and word_count >= old_words;
    if not found then
      raise exception 'TRANSCRIPT_STATS_DRIFT';
    end if;
    return old;
  end if;

  if old.session_id = new.session_id then
    update public.transcript_session_statistics
    set
      word_count = word_count - old_words + new_words,
      updated_at = clock_timestamp()
    where session_id = new.session_id
      and segment_count >= 1
      and word_count >= old_words;
    if not found then
      raise exception 'TRANSCRIPT_STATS_DRIFT';
    end if;
    return new;
  end if;

  update public.transcript_session_statistics
  set
    segment_count = segment_count - 1,
    word_count = word_count - old_words,
    updated_at = clock_timestamp()
  where session_id = old.session_id
    and segment_count >= 1
    and word_count >= old_words;
  if not found then
    raise exception 'TRANSCRIPT_STATS_DRIFT';
  end if;

  insert into public.transcript_session_statistics(
    session_id,
    segment_count,
    word_count,
    updated_at
  )
  values (new.session_id, 1, new_words, clock_timestamp())
  on conflict (session_id) do update
  set
    segment_count = public.transcript_session_statistics.segment_count + 1,
    word_count = public.transcript_session_statistics.word_count + excluded.word_count,
    updated_at = excluded.updated_at;

  return new;
end
$$;

drop trigger if exists transcript_segments_apply_statistics_v1 on public.transcript_segments;
create trigger transcript_segments_apply_statistics_v1
after insert or update of session_id, text, text_words or delete
on public.transcript_segments
for each row
execute function public.apply_transcript_session_statistics_v1();

create or replace view public.transcript_statistics_read_model_v1
with (security_invoker = true)
as
select
  s.id,
  s.title,
  s.session_date,
  s.duration_ms,
  c.slug as campaign_slug,
  st.segment_count,
  st.word_count
from public.sessions s
join public.campaigns c on c.id = s.campaign_id
join public.transcript_session_statistics st on st.session_id = s.id;

revoke all on table public.transcript_statistics_read_model_v1 from public;
revoke all on table public.transcript_statistics_read_model_v1 from anon;
revoke all on table public.transcript_statistics_read_model_v1 from authenticated;
grant select on table public.transcript_statistics_read_model_v1 to service_role;

comment on table public.transcript_session_statistics is
  'Server-only bounded read model for private transcript statistics. Maintained transactionally from transcript_segments.';
comment on view public.transcript_statistics_read_model_v1 is
  'Server-only per-session statistics view; never exposes transcript text.';

commit;
