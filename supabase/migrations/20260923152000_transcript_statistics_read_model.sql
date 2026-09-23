-- Bounded transcript statistics read model.
-- Maintains one aggregate row per session with transcript segments.
-- The application still authorizes campaign access before reading this table.

create table public.transcript_session_statistics (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  segment_count bigint not null check (segment_count > 0),
  complete_text_count bigint not null check (
    complete_text_count >= 0 and complete_text_count <= segment_count
  ),
  word_count bigint not null check (word_count >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.transcript_session_statistics
is 'Server-only read model for transcript statistics. One row per session with >=1 transcript segment; maintained transactionally from transcript_segments.';

comment on column public.transcript_session_statistics.word_count
is 'Sum of canonical whitespace-token counts for non-null segment text. Consumers must treat words as unknown when complete_text_count <> segment_count.';

alter table public.transcript_session_statistics enable row level security;

revoke all on table public.transcript_session_statistics from public;
revoke all on table public.transcript_session_statistics from anon;
revoke all on table public.transcript_session_statistics from authenticated;
grant select on table public.transcript_session_statistics to service_role;

create or replace function public.transcript_statistics_word_count(p_text text)
returns bigint
language sql
immutable
parallel safe
returns null on null input
set search_path = pg_catalog
as $$
  with normalized as (
    select translate(
      p_text,
      chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
      chr(160) || chr(5760) ||
      chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) ||
      chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) ||
      chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279),
      repeat(' ', 25)
    ) as value
  )
  select case
    when btrim(value) = '' then 0::bigint
    else cardinality(regexp_split_to_array(btrim(value), ' +'))::bigint
  end
  from normalized;
$$;

comment on function public.transcript_statistics_word_count(text)
is 'Internal immutable equivalent of the Edit whitespace-token counter, including ECMAScript Unicode whitespace characters.';

revoke all on function public.transcript_statistics_word_count(text) from public;
revoke execute on function public.transcript_statistics_word_count(text) from anon;
revoke execute on function public.transcript_statistics_word_count(text) from authenticated;
revoke execute on function public.transcript_statistics_word_count(text) from service_role;

create or replace function public.maintain_transcript_session_statistics()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_old_complete bigint;
  v_old_words bigint;
  v_new_complete bigint;
  v_new_words bigint;
begin
  if tg_op in ('DELETE', 'UPDATE') then
    v_old_complete := case when old.text is null then 0 else 1 end;
    v_old_words := coalesce(public.transcript_statistics_word_count(old.text), 0);

    update public.transcript_session_statistics
    set
      segment_count = segment_count - 1,
      complete_text_count = complete_text_count - v_old_complete,
      word_count = word_count - v_old_words,
      updated_at = now()
    where session_id = old.session_id;

    if not found then
      raise exception 'TRANSCRIPT_STATS_OLD_SESSION_MISSING'
        using errcode = '23514';
    end if;

    delete from public.transcript_session_statistics
    where session_id = old.session_id
      and segment_count = 0;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new_complete := case when new.text is null then 0 else 1 end;
    v_new_words := coalesce(public.transcript_statistics_word_count(new.text), 0);

    insert into public.transcript_session_statistics (
      session_id,
      segment_count,
      complete_text_count,
      word_count,
      updated_at
    ) values (
      new.session_id,
      1,
      v_new_complete,
      v_new_words,
      now()
    )
    on conflict (session_id) do update
    set
      segment_count = public.transcript_session_statistics.segment_count + 1,
      complete_text_count =
        public.transcript_session_statistics.complete_text_count + excluded.complete_text_count,
      word_count = public.transcript_session_statistics.word_count + excluded.word_count,
      updated_at = now();
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.maintain_transcript_session_statistics()
is 'SECURITY DEFINER trigger maintaining the server-only transcript statistics read model on insert/update/delete, including session moves and null-text coverage.';

revoke all on function public.maintain_transcript_session_statistics() from public;
revoke execute on function public.maintain_transcript_session_statistics() from anon;
revoke execute on function public.maintain_transcript_session_statistics() from authenticated;
revoke execute on function public.maintain_transcript_session_statistics() from service_role;

lock table public.transcript_segments in share row exclusive mode;

insert into public.transcript_session_statistics (
  session_id,
  segment_count,
  complete_text_count,
  word_count,
  updated_at
)
select
  ts.session_id,
  count(*)::bigint,
  count(ts.text)::bigint,
  coalesce(
    sum(coalesce(public.transcript_statistics_word_count(ts.text), 0)),
    0
  )::bigint,
  now()
from public.transcript_segments ts
group by ts.session_id;

create trigger transcript_session_statistics_after_write
after insert or delete or update of session_id, text
on public.transcript_segments
for each row
execute function public.maintain_transcript_session_statistics();
