-- #898 synthetic-only contract for private Web-derived transcript revisions.
-- Loaded only by tools/transcript-sync-db.py in an isolated PostgreSQL cluster.

begin;

insert into public.permission_catalog(action, plane, description)
values (
  'campaign.content.edit',
  'mixed',
  'Synthetic content edit capability for #898 contract coverage.'
)
on conflict (action) do nothing;

insert into public.role_permissions(role_id, permission_action)
values
  ('55555555-5555-4555-8555-555555555555', 'campaign.transcript.publish'),
  ('55555555-5555-4555-8555-555555555555', 'campaign.content.edit')
on conflict do nothing;

insert into public.role_assignments(
  profile_id, role_id, scope_type, scope_id, status, starts_at
) values (
  '33333333-3333-4333-8333-333333333333',
  '55555555-5555-4555-8555-555555555555',
  'campaign',
  'synthetic-campaign',
  'active',
  now()
);

do $privileges$
begin
  if has_function_privilege(
      'anon',
      'public.edit_current_transcript_revision_atomic(uuid,uuid,text,uuid,uuid,uuid,jsonb)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.edit_current_transcript_revision_atomic(uuid,uuid,text,uuid,uuid,uuid,jsonb)',
      'EXECUTE'
    ) then
    raise exception 'TRANSCRIPT_WEB_EDIT_EXPOSED_TO_BROWSER_ROLE';
  end if;
end;
$privileges$;

set role service_role;

do $contract$
declare
  v_publish jsonb;
  v_edit jsonb;
  v_replay jsonb;
  v_conflict jsonb;
  v_stale jsonb;
  v_noop jsonb;
  v_invalid jsonb;
  v_parent uuid;
  v_child uuid;
  v_current uuid;
  v_parent_segments jsonb;
  v_child_segments jsonb;
  v_count bigint;
  v_audits bigint;
begin
  select public.publish_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    public.synthetic_publication_input(
      '92000000-0000-4000-8000-000000000001',
      'run-web-edit-parent',
      'Texto original'
    ),
    false
  ) into v_publish;

  if v_publish->>'ok' <> 'true' then
    raise exception 'WEB_EDIT_PARENT_PUBLICATION_FAILED:%', v_publish;
  end if;

  select current_transcript_revision_id
  into v_parent
  from public.sessions
  where id = '22222222-2222-4222-8222-222222222222';

  select segments
  into v_parent_segments
  from public.transcript_revisions
  where id = v_parent;

  select public.edit_current_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_parent,
    '92000000-0000-4000-8000-000000000002',
    jsonb_build_array(jsonb_build_object(
      'id', 'r-1-1-0',
      'speaker', 'Alicia',
      'text', 'Texto privado corrigido'
    ))
  ) into v_edit;

  if v_edit->>'ok' <> 'true'
     or v_edit->>'replayed' <> 'false'
     or v_edit->>'unchanged' <> 'false'
     or (v_edit->>'revisionNumber')::bigint <> 2
     or (v_edit->>'changedSegments')::integer <> 1 then
    raise exception 'WEB_EDIT_RESULT_INVALID:%', v_edit;
  end if;

  v_child := (v_edit->>'revisionId')::uuid;

  select current_transcript_revision_id
  into v_current
  from public.sessions
  where id = '22222222-2222-4222-8222-222222222222';

  if v_current <> v_child then
    raise exception 'WEB_EDIT_POINTER_NOT_ADVANCED';
  end if;

  select segments
  into v_child_segments
  from public.transcript_revisions
  where id = v_child
    and revision_origin = 'web_edit'
    and parent_revision_id = v_parent
    and actor_profile_id = '33333333-3333-4333-8333-333333333333'
    and word_count = 3;

  if v_child_segments is null then
    raise exception 'WEB_EDIT_CHILD_METADATA_INVALID';
  end if;

  if v_parent_segments->0->>'speaker' <> 'Alice'
     or v_parent_segments->0->>'text' <> 'Texto original'
     or (v_parent_segments->0->>'start')::numeric <> 0
     or (v_parent_segments->0->>'end')::numeric <> 1 then
    raise exception 'WEB_EDIT_MUTATED_PARENT:%', v_parent_segments;
  end if;

  if v_child_segments->0->>'speaker' <> 'Alicia'
     or v_child_segments->0->>'text' <> 'Texto privado corrigido'
     or v_child_segments->0->>'segment_id' <> v_parent_segments->0->>'segment_id'
     or v_child_segments->0->>'track_number' <> v_parent_segments->0->>'track_number'
     or v_child_segments->0->>'start' <> v_parent_segments->0->>'start'
     or v_child_segments->0->>'end' <> v_parent_segments->0->>'end'
     or v_child_segments->0->>'reviewed' <> v_parent_segments->0->>'reviewed' then
    raise exception 'WEB_EDIT_CHANGED_IDENTITY_OR_TIMING:%', v_child_segments;
  end if;

  select count(*)
  into v_audits
  from public.audit_log
  where action = 'transcript_revision.edit'
    and record_id = v_child;

  if v_audits <> 1 then
    raise exception 'WEB_EDIT_AUDIT_MISSING:%', v_audits;
  end if;

  if exists (
    select 1
    from public.audit_log a
    where a.action = 'transcript_revision.edit'
      and (
        coalesce(a.old_value::text, '') ilike '%Texto original%'
        or coalesce(a.new_value::text, '') ilike '%Texto privado corrigido%'
        or coalesce(a.new_value::text, '') ilike '%Alicia%'
      )
  ) then
    raise exception 'WEB_EDIT_AUDIT_LEAKED_PRIVATE_CONTENT';
  end if;

  select public.edit_current_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_parent,
    '92000000-0000-4000-8000-000000000002',
    jsonb_build_array(jsonb_build_object(
      'id', 'r-1-1-0',
      'speaker', 'Alicia',
      'text', 'Texto privado corrigido'
    ))
  ) into v_replay;

  if v_replay->>'ok' <> 'true'
     or v_replay->>'replayed' <> 'true'
     or (v_replay->>'revisionId')::uuid <> v_child then
    raise exception 'WEB_EDIT_REPLAY_NOT_EXACT:%', v_replay;
  end if;

  select public.edit_current_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_parent,
    '92000000-0000-4000-8000-000000000002',
    jsonb_build_array(jsonb_build_object(
      'id', 'r-1-1-0',
      'speaker', 'Mallory',
      'text', 'Payload divergente'
    ))
  ) into v_conflict;

  if v_conflict <> '{"ok":false,"reason":"operation_conflict"}'::jsonb then
    raise exception 'WEB_EDIT_DIVERGENT_OPERATION_ACCEPTED:%', v_conflict;
  end if;

  select public.edit_current_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_parent,
    '92000000-0000-4000-8000-000000000003',
    jsonb_build_array(jsonb_build_object(
      'id', 'r-1-1-0',
      'speaker', 'Outra',
      'text', 'Tentativa stale'
    ))
  ) into v_stale;

  if v_stale->>'ok' <> 'false'
     or v_stale->>'reason' <> 'stale_current'
     or (v_stale->>'currentRevisionId')::uuid <> v_child then
    raise exception 'WEB_EDIT_STALE_CURRENT_NOT_REJECTED:%', v_stale;
  end if;

  select public.edit_current_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_child,
    '92000000-0000-4000-8000-000000000004',
    jsonb_build_array(jsonb_build_object(
      'id', 'r-1-1-0',
      'speaker', 'Alicia',
      'text', 'Texto privado corrigido'
    ))
  ) into v_noop;

  if v_noop->>'ok' <> 'true'
     or v_noop->>'unchanged' <> 'true'
     or (v_noop->>'revisionId')::uuid <> v_child then
    raise exception 'WEB_EDIT_NOOP_CREATED_REVISION:%', v_noop;
  end if;

  select public.edit_current_transcript_revision_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_child,
    '92000000-0000-4000-8000-000000000005',
    jsonb_build_array(jsonb_build_object(
      'id', 'r-1-1-0',
      'speaker', 'Alicia',
      'text', 'Texto privado corrigido',
      'start', 99
    ))
  ) into v_invalid;

  if v_invalid <> '{"ok":false,"reason":"invalid_payload"}'::jsonb then
    raise exception 'WEB_EDIT_TIMING_PATCH_ACCEPTED:%', v_invalid;
  end if;

  select count(*)
  into v_count
  from public.transcript_revisions
  where session_id = '22222222-2222-4222-8222-222222222222';

  if v_count <> 2 then
    raise exception 'WEB_EDIT_UNEXPECTED_REVISION_COUNT:%', v_count;
  end if;
end;
$contract$;

reset role;

create function public.fail_web_edit_audit_probe() returns trigger
language plpgsql as $probe$
begin
  if new.action = 'transcript_revision.edit' then
    raise exception 'synthetic web edit audit failure';
  end if;
  return new;
end;
$probe$;

create trigger fail_web_edit_audit
before insert on public.audit_log
for each row execute function public.fail_web_edit_audit_probe();

set role service_role;

do $rollback_probe$
declare
  v_before uuid;
  v_after uuid;
  v_revisions bigint;
  v_failed boolean := false;
begin
  select current_transcript_revision_id
  into v_before
  from public.sessions
  where id = '22222222-2222-4222-8222-222222222222';

  begin
    perform public.edit_current_transcript_revision_atomic(
      '44444444-4444-4444-8444-444444444444',
      '33333333-3333-4333-8333-333333333333',
      'synthetic-campaign',
      '22222222-2222-4222-8222-222222222222',
      v_before,
      '92000000-0000-4000-8000-000000000006',
      jsonb_build_array(jsonb_build_object(
        'id', 'r-1-1-0',
        'speaker', 'Rollback',
        'text', 'Este conteúdo não pode sobreviver'
      ))
    );
  exception
    when others then
      if sqlerrm not like '%synthetic web edit audit failure%' then
        raise;
      end if;
      v_failed := true;
  end;

  if not v_failed then
    raise exception 'WEB_EDIT_ROLLBACK_PROBE_DID_NOT_FAIL';
  end if;

  select current_transcript_revision_id
  into v_after
  from public.sessions
  where id = '22222222-2222-4222-8222-222222222222';

  select count(*)
  into v_revisions
  from public.transcript_revisions
  where session_id = '22222222-2222-4222-8222-222222222222';

  if v_after <> v_before or v_revisions <> 2 then
    raise exception 'WEB_EDIT_ROLLBACK_LEFT_PARTIAL_STATE:%:%:%',
      v_before, v_after, v_revisions;
  end if;
end;
$rollback_probe$;

reset role;
drop trigger fail_web_edit_audit on public.audit_log;
drop function public.fail_web_edit_audit_probe();

rollback;
