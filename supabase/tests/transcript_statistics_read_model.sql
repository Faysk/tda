-- Synthetic-only assertions for the bounded transcript statistics read model.
-- Loaded against the isolated local database harness; all mutations roll back.

begin;

do $$
declare
  v_count bigint;
begin
  if public.transcript_statistics_word_count('') <> 0 then
    raise exception 'WORD_COUNT_EMPTY_INVALID';
  end if;
  if public.transcript_statistics_word_count('  um  dois' || chr(10) || 'três  ') <> 3 then
    raise exception 'WORD_COUNT_ASCII_WHITESPACE_INVALID';
  end if;
  if public.transcript_statistics_word_count('um' || chr(160) || 'dois' || chr(8239) || 'três') <> 3 then
    raise exception 'WORD_COUNT_UNICODE_WHITESPACE_INVALID';
  end if;
  if public.transcript_statistics_word_count('... —') <> 2 then
    raise exception 'WORD_COUNT_PUNCTUATION_INVALID';
  end if;
end;
$$;

insert into public.sessions (
  id, campaign_id, source_system, source_session_id
) values (
  '99999999-9999-4999-8999-999999999991',
  '11111111-1111-4111-8111-111111111111',
  'local_companion',
  'stats-read-model'
);

insert into public.transcript_segments (
  id,
  session_id,
  source_segment_id,
  source_sequence,
  start_ms,
  end_ms,
  text,
  speaker_name,
  character_name,
  track_key,
  needs_review,
  review_status,
  text_chars,
  text_words,
  is_empty,
  revision
) values
(
  '99999999-9999-4999-8999-999999999992',
  '99999999-9999-4999-8999-999999999991',
  'stats-a',
  1,
  0,
  1000,
  'um' || chr(160) || 'dois',
  'A',
  null,
  'track-a',
  true,
  'pending',
  7,
  999,
  false,
  0
),
(
  '99999999-9999-4999-8999-999999999993',
  '99999999-9999-4999-8999-999999999991',
  'stats-b',
  2,
  1000,
  2000,
  null,
  'B',
  null,
  'track-b',
  true,
  'pending',
  0,
  999,
  true,
  0
);

do $$
declare
  v_segment_count bigint;
  v_complete_count bigint;
  v_words bigint;
begin
  select segment_count, complete_text_count, word_count
  into v_segment_count, v_complete_count, v_words
  from public.transcript_session_statistics
  where session_id = '99999999-9999-4999-8999-999999999991';

  if v_segment_count <> 2 or v_complete_count <> 1 or v_words <> 2 then
    raise exception 'STATS_INSERT_DELTA_INVALID: % % %',
      v_segment_count, v_complete_count, v_words;
  end if;
end;
$$;

update public.transcript_segments
set text = 'três quatro cinco', text_words = 999
where id = '99999999-9999-4999-8999-999999999993';

do $$
declare
  v_segment_count bigint;
  v_complete_count bigint;
  v_words bigint;
begin
  select segment_count, complete_text_count, word_count
  into v_segment_count, v_complete_count, v_words
  from public.transcript_session_statistics
  where session_id = '99999999-9999-4999-8999-999999999991';

  if v_segment_count <> 2 or v_complete_count <> 2 or v_words <> 5 then
    raise exception 'STATS_UPDATE_DELTA_INVALID: % % %',
      v_segment_count, v_complete_count, v_words;
  end if;
end;
$$;

delete from public.transcript_segments
where id = '99999999-9999-4999-8999-999999999992';

do $$
declare
  v_segment_count bigint;
  v_complete_count bigint;
  v_words bigint;
begin
  select segment_count, complete_text_count, word_count
  into v_segment_count, v_complete_count, v_words
  from public.transcript_session_statistics
  where session_id = '99999999-9999-4999-8999-999999999991';

  if v_segment_count <> 1 or v_complete_count <> 1 or v_words <> 3 then
    raise exception 'STATS_DELETE_DELTA_INVALID: % % %',
      v_segment_count, v_complete_count, v_words;
  end if;
end;
$$;

delete from public.transcript_segments
where id = '99999999-9999-4999-8999-999999999993';

do $$
begin
  if exists (
    select 1 from public.transcript_session_statistics
    where session_id = '99999999-9999-4999-8999-999999999991'
  ) then
    raise exception 'STATS_EMPTY_SESSION_ROW_NOT_REMOVED';
  end if;
end;
$$;

rollback;
