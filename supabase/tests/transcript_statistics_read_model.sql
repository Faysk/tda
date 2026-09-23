-- Synthetic-only acceptance for #537 read model.
-- Requires transcript_import_fixture.sql + synthetic pre-seed from tools/transcript-statistics-db.py.

do $$
declare
  value integer;
begin
  select public.transcript_word_count_v1('') into value;
  if value <> 0 then raise exception 'WORD_COUNT_EMPTY'; end if;
  select public.transcript_word_count_v1(E' \n\t') into value;
  if value <> 0 then raise exception 'WORD_COUNT_WHITESPACE'; end if;
  select public.transcript_word_count_v1('um' || chr(160) || 'dois' || E'\n' || 'três') into value;
  if value <> 3 then raise exception 'WORD_COUNT_UNICODE'; end if;
  select public.transcript_word_count_v1('d''água guarda-chuva') into value;
  if value <> 2 then raise exception 'WORD_COUNT_HYPHEN_APOSTROPHE'; end if;
  select public.transcript_word_count_v1('... —') into value;
  if value <> 2 then raise exception 'WORD_COUNT_PUNCTUATION'; end if;
end
$$;

do $$
declare
  words integer;
  segments bigint;
  aggregate_words bigint;
begin
  select text_words into words
  from public.transcript_segments
  where id = '77777777-7777-4777-8777-777777777777';
  if words <> 3 then raise exception 'BACKFILL_TEXT_WORDS'; end if;

  select segment_count, word_count
  into segments, aggregate_words
  from public.transcript_session_statistics
  where session_id = '22222222-2222-4222-8222-222222222222';
  if segments <> 1 or aggregate_words <> 3 then
    raise exception 'BACKFILL_AGGREGATE';
  end if;

  select segment_count, word_count
  into segments, aggregate_words
  from public.transcript_session_statistics
  where session_id = '88888888-8888-4888-8888-888888888888';
  if segments <> 0 or aggregate_words <> 0 then
    raise exception 'ZERO_SESSION_AGGREGATE';
  end if;
end
$$;

-- New writes cannot smuggle a stale text_words value.
insert into public.transcript_segments(
  id, session_id, source_segment_id, source_sequence, start_ms, end_ms, text,
  speaker_name, needs_review, review_status, text_chars, text_words, is_empty, metadata
) values (
  '99999999-9999-4999-8999-999999999999',
  '22222222-2222-4222-8222-222222222222',
  'post-migration',
  2,
  1000,
  2000,
  'd''água guarda-chuva',
  'Synthetic',
  true,
  'pending',
  20,
  999,
  false,
  '{}'::jsonb
);

do $$
declare
  words integer;
  segments bigint;
  aggregate_words bigint;
begin
  select text_words into words
  from public.transcript_segments
  where id = '99999999-9999-4999-8999-999999999999';
  if words <> 2 then raise exception 'INSERT_DERIVED_WORDS'; end if;

  select segment_count, word_count
  into segments, aggregate_words
  from public.transcript_session_statistics
  where session_id = '22222222-2222-4222-8222-222222222222';
  if segments <> 2 or aggregate_words <> 5 then
    raise exception 'INSERT_AGGREGATE';
  end if;
end
$$;

update public.transcript_segments
set text = 'um dois três quatro'
where id = '99999999-9999-4999-8999-999999999999';

do $$
declare
  words integer;
  aggregate_words bigint;
begin
  select text_words into words
  from public.transcript_segments
  where id = '99999999-9999-4999-8999-999999999999';
  if words <> 4 then raise exception 'UPDATE_DERIVED_WORDS'; end if;

  select word_count into aggregate_words
  from public.transcript_session_statistics
  where session_id = '22222222-2222-4222-8222-222222222222';
  if aggregate_words <> 7 then raise exception 'UPDATE_AGGREGATE'; end if;
end
$$;

update public.transcript_segments
set session_id = '88888888-8888-4888-8888-888888888888'
where id = '99999999-9999-4999-8999-999999999999';

do $$
declare
  a_segments bigint;
  a_words bigint;
  b_segments bigint;
  b_words bigint;
begin
  select segment_count, word_count into a_segments, a_words
  from public.transcript_session_statistics
  where session_id = '22222222-2222-4222-8222-222222222222';

  select segment_count, word_count into b_segments, b_words
  from public.transcript_session_statistics
  where session_id = '88888888-8888-4888-8888-888888888888';

  if a_segments <> 1 or a_words <> 3 or b_segments <> 1 or b_words <> 4 then
    raise exception 'MOVE_AGGREGATE';
  end if;
end
$$;

delete from public.transcript_segments
where id = '99999999-9999-4999-8999-999999999999';

do $$
declare
  b_segments bigint;
  b_words bigint;
begin
  select segment_count, word_count into b_segments, b_words
  from public.transcript_session_statistics
  where session_id = '88888888-8888-4888-8888-888888888888';
  if b_segments <> 0 or b_words <> 0 then
    raise exception 'DELETE_AGGREGATE';
  end if;
end
$$;

insert into public.sessions(
  id, campaign_id, source_system, source_session_id, title, session_date, duration_ms
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  'local_companion',
  'new-session',
  'Nova sessão sintética',
  date '2026-09-23',
  60000
);

do $$
declare
  segments bigint;
  aggregate_words bigint;
  view_title text;
  view_duration integer;
begin
  select segment_count, word_count into segments, aggregate_words
  from public.transcript_session_statistics
  where session_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if segments <> 0 or aggregate_words <> 0 then
    raise exception 'SESSION_SEED';
  end if;

  select title, duration_ms into view_title, view_duration
  from public.transcript_statistics_read_model_v1
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if view_title <> 'Nova sessão sintética' or view_duration <> 60000 then
    raise exception 'READ_MODEL_SESSION_FIELDS';
  end if;
end
$$;

update public.sessions
set title = 'Sessão renomeada', duration_ms = 90000
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$
declare
  view_title text;
  view_duration integer;
begin
  select title, duration_ms into view_title, view_duration
  from public.transcript_statistics_read_model_v1
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if view_title <> 'Sessão renomeada' or view_duration <> 90000 then
    raise exception 'READ_MODEL_LIVE_SESSION_FIELDS';
  end if;
end
$$;

do $$
begin
  if has_table_privilege('anon', 'public.transcript_session_statistics', 'select')
     or has_table_privilege('authenticated', 'public.transcript_session_statistics', 'select')
     or has_table_privilege('anon', 'public.transcript_statistics_read_model_v1', 'select')
     or has_table_privilege('authenticated', 'public.transcript_statistics_read_model_v1', 'select') then
    raise exception 'BROWSER_STATS_PRIVILEGE';
  end if;

  if not has_table_privilege('service_role', 'public.transcript_session_statistics', 'select')
     or not has_table_privilege('service_role', 'public.transcript_statistics_read_model_v1', 'select') then
    raise exception 'SERVICE_ROLE_STATS_SELECT_MISSING';
  end if;

  if has_function_privilege('anon', 'public.transcript_word_count_v1(text)', 'execute')
     or has_function_privilege('authenticated', 'public.transcript_word_count_v1(text)', 'execute') then
    raise exception 'WORD_COUNT_RPC_EXPOSED';
  end if;
end
$$;

-- The read surface is metadata/aggregate only.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transcript_statistics_read_model_v1'
      and column_name in ('text', 'speaker_name', 'source_segment_id')
  ) then
    raise exception 'READ_MODEL_PRIVATE_COLUMN';
  end if;
end
$$;

-- Missing aggregate state must fail a write instead of silently drifting.
delete from public.transcript_session_statistics
where session_id = '22222222-2222-4222-8222-222222222222';

do $$
begin
  begin
    update public.transcript_segments
    set text = text
    where id = '77777777-7777-4777-8777-777777777777';
    raise exception 'EXPECTED_STATS_DRIFT';
  exception
    when others then
      if sqlerrm = 'EXPECTED_STATS_DRIFT' then
        raise;
      end if;
      if position('TRANSCRIPT_STATS_DRIFT' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end
$$;
