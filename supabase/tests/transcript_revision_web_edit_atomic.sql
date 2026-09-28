-- Synthetic contract tests for #898. This file runs only in the disposable
-- PostgreSQL harness from tools/session-publication-db.py.
begin;

do $privileges$
begin
  if has_function_privilege(
    'anon',
    'public.save_transcript_revision_edit_atomic(uuid,text,uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'anon must not execute transcript revision edit';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.save_transcript_revision_edit_atomic(uuid,text,uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'authenticated must not execute transcript revision edit';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.save_transcript_revision_edit_atomic(uuid,text,uuid,uuid,uuid,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'service_role must execute transcript revision edit';
  end if;
end
$privileges$;

set local role service_role;

do $revision_edit$
declare
  v_status text;
  v_revision_id uuid;
  v_revision_number bigint;
  v_current uuid;
  v_parent_segments jsonb;
  v_child_segments jsonb;
  v_draft_base uuid;
begin
  select status, revision_id, revision_number
  into v_status, v_revision_id, v_revision_number
  from public.save_transcript_revision_edit_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '81000000-0000-4000-8000-000000000001',
    '44444444-4444-4444-8444-444444444444',
    '[]'::jsonb
  );
  if v_status <> 'no_change'
     or v_revision_id <> '44444444-4444-4444-8444-444444444444'::uuid
     or v_revision_number <> 1 then
    raise exception 'empty edit must be a no-op: % % %',
      v_status, v_revision_id, v_revision_number;
  end if;

  select status
  into v_status
  from public.save_transcript_revision_edit_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '81000000-0000-4000-8000-000000000002',
    '44444444-4444-4444-8444-444444444444',
    '[{"track_number":1,"segment_id":"seg-1","speaker":"Mesa","text":"tentativa","start":99}]'::jsonb
  );
  if v_status <> 'invalid_edits' then
    raise exception 'timing/extra keys must be rejected: %', v_status;
  end if;

  select status, revision_id, revision_number
  into v_status, v_revision_id, v_revision_number
  from public.save_transcript_revision_edit_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '81000000-0000-4000-8000-000000000003',
    '44444444-4444-4444-8444-444444444444',
    '[{"track_number":1,"segment_id":"seg-1","speaker":"Álya 🌲","text":"texto corrigido com café 🐉"}]'::jsonb
  );
  if v_status <> 'updated' or v_revision_number <> 2 then
    raise exception 'R1 -> R2 update failed: % %', v_status, v_revision_number;
  end if;

  select current_transcript_revision_id
  into v_current
  from public.sessions
  where id='22222222-2222-4222-8222-222222222222';
  if v_current <> v_revision_id then
    raise exception 'current pointer did not advance atomically';
  end if;

  select segments
  into v_parent_segments
  from public.transcript_revisions
  where id='44444444-4444-4444-8444-444444444444';
  select segments
  into v_child_segments
  from public.transcript_revisions
  where id=v_revision_id;

  if v_parent_segments->0->>'text' <> 'texto original'
     or v_parent_segments->0->>'speaker' <> 'Mesa' then
    raise exception 'parent revision was mutated';
  end if;
  if v_child_segments->0->>'text' <> 'texto corrigido com café 🐉'
     or v_child_segments->0->>'speaker' <> 'Álya 🌲' then
    raise exception 'child revision did not materialize edit';
  end if;
  if (v_child_segments->0->>'start')::numeric <> 1.25
     or (v_child_segments->0->>'end')::numeric <> 2.5 then
    raise exception 'timing changed during web edit';
  end if;
  if not exists (
    select 1
    from public.transcript_revisions
    where id=v_revision_id
      and revision_origin='web_edit'
      and parent_revision_id='44444444-4444-4444-8444-444444444444'
      and actor_profile_id='33333333-3333-4333-8333-333333333333'
  ) then
    raise exception 'derived revision provenance is incomplete';
  end if;

  if not exists (
    select 1
    from public.audit_log
    where action='transcript_revision.edit'
      and record_id=v_revision_id
      and old_value ? 'currentRevisionId'
      and new_value ? 'contentSha256'
      and new_value ? 'editedSegmentCount'
  ) then
    raise exception 'metadata-only audit receipt missing';
  end if;
  if exists (
    select 1
    from public.audit_log
    where action='transcript_revision.edit'
      and (coalesce(old_value::text, '') || coalesce(new_value::text, ''))
        like '%texto corrigido%'
  ) then
    raise exception 'private transcript text leaked into audit';
  end if;

  -- Replay after current changed must return the exact committed revision.
  select status, revision_id, revision_number
  into v_status, v_current, v_revision_number
  from public.save_transcript_revision_edit_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '81000000-0000-4000-8000-000000000003',
    '44444444-4444-4444-8444-444444444444',
    '[{"track_number":1,"segment_id":"seg-1","speaker":"Álya 🌲","text":"texto corrigido com café 🐉"}]'::jsonb
  );
  if v_status <> 'replay' or v_current <> v_revision_id or v_revision_number <> 2 then
    raise exception 'lost-response replay was not exact';
  end if;

  select status, revision_id
  into v_status, v_current
  from public.save_transcript_revision_edit_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '81000000-0000-4000-8000-000000000004',
    '44444444-4444-4444-8444-444444444444',
    '[{"track_number":1,"segment_id":"seg-1","speaker":"B","text":"stale"}]'::jsonb
  );
  if v_status <> 'stale_current' or v_current <> v_revision_id then
    raise exception 'stale current must preserve the winning revision';
  end if;
  if (
    select count(*)
    from public.transcript_revisions
    where session_id='22222222-2222-4222-8222-222222222222'
  ) <> 2 then
    raise exception 'stale save created a partial revision';
  end if;

  select d.base_transcript_revision_id
  into v_draft_base
  from public.sessions s
  join public.session_editorial_drafts d on d.id=s.current_editorial_draft_id
  where s.id='22222222-2222-4222-8222-222222222222';
  if v_draft_base is null or v_draft_base = v_revision_id then
    raise exception 'existing editorial draft must remain based on the older transcript';
  end if;
end
$revision_edit$;

reset role;

-- Long-session fixture: 7,500 immutable segments, then a one-segment delta.
insert into public.sessions(
  id,campaign_id,title,session_date,arc,status,summary_short,summary_full,source_session_id,metadata
) values (
  '22222222-2222-4222-8222-222222222223',
  '11111111-1111-4111-8111-111111111111',
  'Long synthetic transcript',
  '2026-09-02',
  'Synthetic',
  'approved',
  '',
  '',
  'synthetic-long',
  '{}'::jsonb
);

insert into public.transcript_revisions(
  id,campaign_id,session_id,revision_number,operation_id,source_session_id,
  segment_count,word_count,reviewed_segments,review_summary,segments,actor_profile_id
)
select
  '55555555-5555-4555-8555-555555555555',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222223',
  1,
  '55555555-5555-4555-8555-555555555556',
  'synthetic-long',
  7500,
  15000,
  7500,
  '{"reviewed_segments":7500,"word_count":15000}'::jsonb,
  jsonb_agg(
    jsonb_build_object(
      'track_number', 1,
      'segment_id', 'seg-' || g,
      'start', g::numeric,
      'end', g::numeric + 0.5,
      'speaker', 'Mesa',
      'text', 'duas palavras',
      'reviewed', true
    )
    order by g
  ),
  '33333333-3333-4333-8333-333333333333'
from generate_series(1, 7500) g;

update public.sessions
set current_transcript_revision_id='55555555-5555-4555-8555-555555555555'
where id='22222222-2222-4222-8222-222222222223';

set local role service_role;

do $long_revision$
declare
  v_status text;
  v_revision_id uuid;
  v_revision_number bigint;
begin
  select status, revision_id, revision_number
  into v_status, v_revision_id, v_revision_number
  from public.save_transcript_revision_edit_atomic(
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222223',
    '82000000-0000-4000-8000-000000000001',
    '55555555-5555-4555-8555-555555555555',
    '[{"track_number":1,"segment_id":"seg-7499","speaker":"Jogador","text":"uma correção"}]'::jsonb
  );
  if v_status <> 'updated' or v_revision_number <> 2 then
    raise exception '7,500 segment delta failed: % %', v_status, v_revision_number;
  end if;
  if (
    select segment_count
    from public.transcript_revisions
    where id=v_revision_id
  ) <> 7500 then
    raise exception 'long revision lost segments';
  end if;
  if (
    select value->>'text'
    from public.transcript_revisions tr,
         jsonb_array_elements(tr.segments) value
    where tr.id=v_revision_id
      and value->>'segment_id'='seg-7499'
  ) <> 'uma correção' then
    raise exception 'long revision edit missing';
  end if;
  if (
    select value->>'text'
    from public.transcript_revisions tr,
         jsonb_array_elements(tr.segments) value
    where tr.id='55555555-5555-4555-8555-555555555555'
      and value->>'segment_id'='seg-7499'
  ) <> 'duas palavras' then
    raise exception 'long parent was mutated';
  end if;
end
$long_revision$;

rollback;
