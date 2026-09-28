-- Synthetic-only contract for private immutable transcript corrections (#898).
-- Runs after transcript_publication_revisions.sql in the isolated scratch cluster.
-- Never execute against the connected Supabase project.

do $privileges$
begin
  if has_function_privilege(
       'anon',
       'public.save_transcript_revision_edit_atomic(uuid,uuid,text,uuid,uuid,uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.save_transcript_revision_edit_atomic(uuid,uuid,text,uuid,uuid,uuid,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.save_transcript_revision_edit_atomic(uuid,uuid,text,uuid,uuid,uuid,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'TRANSCRIPT_WEB_EDIT_FUNCTION_PRIVILEGES_INVALID';
  end if;
end;
$privileges$;

insert into public.permission_catalog(action, plane, description)
values (
  'campaign.content.edit',
  'narrative',
  'Synthetic private transcript correction capability.'
)
on conflict (action) do nothing;

insert into public.role_permissions(role_id, permission_action)
values (
  '66666666-6666-4666-8666-666666666666',
  'campaign.content.edit'
)
on conflict do nothing;

insert into public.role_assignments(
  profile_id, role_id, scope_type, scope_id, status, starts_at
) values (
  '33333333-3333-4333-8333-333333333333',
  '66666666-6666-4666-8666-666666666666',
  'campaign',
  'synthetic-campaign',
  'active',
  now()
);

insert into public.transcript_revisions (
  id,
  campaign_id,
  session_id,
  revision_number,
  operation_id,
  source_system,
  source_session_id,
  source_id,
  run_id,
  base_transcript_sha256,
  draft_sha256,
  payload_sha256,
  segment_count,
  word_count,
  reviewed_segments,
  warning_count,
  lineage,
  review_summary,
  segments,
  actor_profile_id
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  1,
  'a1000000-0000-4000-8000-000000000001',
  'local_companion',
  'fixture-source',
  'craig-' || repeat('a',64),
  'run-web-edit-base',
  repeat('b',64),
  repeat('d',64),
  repeat('e',64),
  2,
  5,
  2,
  0,
  '{"profile_id":"whisper-detailed","engine":"synthetic"}'::jsonb,
  '{"status":"approved_local","draft_revision":1,"reviewed_segments":2,"total_segments":2,"warning_count":0,"word_count":5}'::jsonb,
  jsonb_build_array(
    jsonb_build_object(
      'track_number',1,'segment_id','1-0','start',1.25,'end',2.5,
      'text','Texto original um','speaker','Alice','reviewed',true
    ),
    jsonb_build_object(
      'track_number',2,'segment_id','2-0','start',1.5,'end',3.0,
      'text','Texto original dois','speaker','Bob','reviewed',true
    )
  ),
  '33333333-3333-4333-8333-333333333333'
);

update public.sessions
set current_transcript_revision_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
where id='22222222-2222-4222-8222-222222222222';

-- Selective rollback probe: revision 3 must disappear together with the pointer
-- change if metadata-only audit persistence fails.
create function public.fail_transcript_web_edit_audit_probe() returns trigger
language plpgsql as $probe$
begin
  if new.action = 'transcript_revision.web_edit'
     and new.new_value->>'revisionNumber' = '3' then
    raise exception 'synthetic transcript web edit audit failure';
  end if;
  return new;
end;
$probe$;

create trigger fail_transcript_web_edit_audit
before insert on public.audit_log
for each row execute function public.fail_transcript_web_edit_audit_probe();

do $contract$
declare
  v_status text;
  v_revision uuid;
  v_number bigint;
  v_current uuid;
  v_before_count bigint;
  v_failed boolean := false;
begin
  -- Authorization is evaluated before target existence.
  select e.status
  into v_status
  from public.save_transcript_revision_edit_atomic(
    '99999999-9999-4999-8999-999999999999',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a2000000-0000-4000-8000-000000000001',
    '[{"trackNumber":1,"segmentId":"1-0","speaker":"Alya","text":"Negado"}]'::jsonb
  ) e;
  if v_status <> 'forbidden' then
    raise exception 'TRANSCRIPT_WEB_EDIT_AUTH_ORACLE:%', v_status;
  end if;

  set local role service_role;

  -- Browser payload can address only stable identity + speaker/text. Timing stays
  -- server-owned in the parent revision.
  select e.status, e.revision_id, e.revision_number
  into v_status, v_revision, v_number
  from public.save_transcript_revision_edit_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a2000000-0000-4000-8000-000000000002',
    '[{"trackNumber":1,"segmentId":"1-0","speaker":"Álya","text":"Texto corrigido 🌲"}]'::jsonb
  ) e;

  if v_status <> 'updated' or v_revision is null or v_number <> 2 then
    raise exception 'TRANSCRIPT_WEB_EDIT_UPDATE_INVALID:% % %',
      v_status, v_revision, v_number;
  end if;

  select current_transcript_revision_id into v_current
  from public.sessions
  where id='22222222-2222-4222-8222-222222222222';

  if v_current <> v_revision
     or (select count(*) from public.transcript_revisions) <> 2
     or (select source_system from public.transcript_revisions where id=v_revision) <> 'web_edit'
     or (select parent_revision_id from public.transcript_revisions where id=v_revision)
        <> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     or (select segments->0->>'speaker' from public.transcript_revisions where id=v_revision) <> 'Álya'
     or (select segments->0->>'text' from public.transcript_revisions where id=v_revision) <> 'Texto corrigido 🌲'
     or (select segments->0->>'start' from public.transcript_revisions where id=v_revision) <> '1.25'
     or (select segments->0->>'end' from public.transcript_revisions where id=v_revision) <> '2.5'
     or (select segments->1->>'text' from public.transcript_revisions where id=v_revision) <> 'Texto original dois'
     or (select segments->0->>'text' from public.transcript_revisions
         where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 'Texto original um' then
    raise exception 'TRANSCRIPT_WEB_EDIT_IMMUTABILITY_OR_TIMING_INVALID';
  end if;

  if exists (
    select 1
    from public.audit_log a
    where a.action='transcript_revision.web_edit'
      and (coalesce(a.old_value::text,'') || coalesce(a.new_value::text,''))
          like '%Texto corrigido%'
  ) then
    raise exception 'TRANSCRIPT_WEB_EDIT_AUDIT_LEAKED_TEXT';
  end if;

  -- Lost-response retry replays exactly the same immutable revision.
  select e.status, e.revision_id, e.revision_number
  into v_status, v_current, v_number
  from public.save_transcript_revision_edit_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a2000000-0000-4000-8000-000000000002',
    '[{"trackNumber":1,"segmentId":"1-0","speaker":"Álya","text":"Texto corrigido 🌲"}]'::jsonb
  ) e;
  if v_status <> 'replay' or v_current <> v_revision or v_number <> 2
     or (select count(*) from public.transcript_revisions) <> 2 then
    raise exception 'TRANSCRIPT_WEB_EDIT_REPLAY_INVALID';
  end if;

  -- A stale editor never rebases itself silently.
  select e.status, e.revision_id, e.revision_number
  into v_status, v_current, v_number
  from public.save_transcript_revision_edit_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'a2000000-0000-4000-8000-000000000003',
    '[{"trackNumber":2,"segmentId":"2-0","speaker":"Bob","text":"Stale"}]'::jsonb
  ) e;
  if v_status <> 'stale_current' or v_current <> v_revision or v_number <> 2 then
    raise exception 'TRANSCRIPT_WEB_EDIT_STALE_ACCEPTED:% % %',
      v_status, v_current, v_number;
  end if;

  -- Timing is not part of the accepted delta contract.
  select e.status
  into v_status
  from public.save_transcript_revision_edit_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_revision,
    'a2000000-0000-4000-8000-000000000004',
    '[{"trackNumber":2,"segmentId":"2-0","speaker":"Bob","text":"Tentativa","start":999}]'::jsonb
  ) e;
  if v_status <> 'invalid_payload' then
    raise exception 'TRANSCRIPT_WEB_EDIT_TIMING_MUTATION_ACCEPTED:%', v_status;
  end if;

  -- Database-side validation mirrors the canonical review-string control rules.
  select e.status
  into v_status
  from public.save_transcript_revision_edit_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_revision,
    'a2000000-0000-4000-8000-000000000009',
    jsonb_build_array(
      jsonb_build_object(
        'trackNumber',2,
        'segmentId','2-0',
        'speaker','Bob',
        'text',E'controle\u0001inválido'
      )
    )
  ) e;
  if v_status <> 'invalid_payload' then
    raise exception 'TRANSCRIPT_WEB_EDIT_CONTROL_ACCEPTED:%', v_status;
  end if;

  -- No-op save does not manufacture a revision.
  select count(*) into v_before_count from public.transcript_revisions;
  select e.status
  into v_status
  from public.save_transcript_revision_edit_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_revision,
    'a2000000-0000-4000-8000-000000000005',
    '[{"trackNumber":2,"segmentId":"2-0","speaker":"Bob","text":"Texto original dois"}]'::jsonb
  ) e;
  if v_status <> 'no_change'
     or (select count(*) from public.transcript_revisions) <> v_before_count then
    raise exception 'TRANSCRIPT_WEB_EDIT_NOOP_CREATED_REVISION:%', v_status;
  end if;

  -- Failure after the immutable insert/pointer update rolls the whole RPC back.
  begin
    perform *
    from public.save_transcript_revision_edit_atomic(
      '44444444-4444-4444-8444-444444444444',
      '33333333-3333-4333-8333-333333333333',
      'synthetic-campaign',
      '22222222-2222-4222-8222-222222222222',
      v_revision,
      'a2000000-0000-4000-8000-000000000006',
      '[{"trackNumber":2,"segmentId":"2-0","speaker":"Bobby","text":"Não pode sobreviver"}]'::jsonb
    );
  exception
    when others then
      if sqlerrm not like '%synthetic transcript web edit audit failure%' then
        raise;
      end if;
      v_failed := true;
  end;

  if not v_failed
     or (select count(*) from public.transcript_revisions) <> 2
     or (select current_transcript_revision_id from public.sessions
         where id='22222222-2222-4222-8222-222222222222') <> v_revision then
    raise exception 'TRANSCRIPT_WEB_EDIT_ROLLBACK_INVALID';
  end if;
end;
$contract$;

drop trigger fail_transcript_web_edit_audit on public.audit_log;
drop function public.fail_transcript_web_edit_audit_probe();

delete from public.audit_log
where action='transcript_revision.web_edit'
  and session_id='22222222-2222-4222-8222-222222222222';

update public.sessions
set current_transcript_revision_id=null
where id='22222222-2222-4222-8222-222222222222';

delete from public.transcript_revisions
where session_id='22222222-2222-4222-8222-222222222222';

delete from public.role_assignments
where profile_id='33333333-3333-4333-8333-333333333333'
  and role_id='66666666-6666-4666-8666-666666666666'
  and scope_type='campaign'
  and scope_id='synthetic-campaign';

delete from public.role_permissions
where role_id='66666666-6666-4666-8666-666666666666'
  and permission_action='campaign.content.edit';
