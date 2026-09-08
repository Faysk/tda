do $$
declare
  actual_default text;
begin
  select column_default
    into actual_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'transcript_segments'
    and column_name = 'needs_review';

  if actual_default is distinct from 'true' then
    raise exception 'expected transcript_segments.needs_review default true, got %', actual_default;
  end if;
end
$$;
