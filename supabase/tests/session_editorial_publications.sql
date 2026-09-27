-- End-to-end synthetic contract for #793. Runs only in disposable PostgreSQL.

insert into public.session_editorial_drafts(
  id,campaign_id,session_id,revision,base_transcript_revision_id,
  cover_asset_id,arc,title,summary_short,summary_full,actor_profile_id
) values (
  '88888888-8888-4888-8888-888888888881',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  1,
  '77777777-7777-4777-8777-777777777777',
  '99999999-9999-4999-8999-999999999999',
  'Valcinzento',
  'Título público v1',
  'Descrição pública v1',
  '# Resumo público v1\n\nConteúdo editorial sintético.',
  '33333333-3333-4333-8333-333333333333'
);
update public.sessions
set current_editorial_draft_id='88888888-8888-4888-8888-888888888881'
where id='22222222-2222-4222-8222-222222222222';

insert into public.media_assets(
  id,campaign_id,media_kind,role_hint,status,staged_bucket,object_key,
  sha256,mime_type,byte_size,width,height,read_back_verified,
  public_bucket,public_object_key,public_delivery_verified,public_verified_at,
  created_by
) values (
  '99999999-9999-4999-8999-999999999999',
  '11111111-1111-4111-8111-111111111111',
  'image','session_cover','verified_public','tda-media-private',
  'campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'image/webp',128,16,8,true,
  'tda-media-public',
  'campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp',
  true,clock_timestamp(),
  '33333333-3333-4333-8333-333333333333'
);

do $contract$
declare
  v_first jsonb;
  v_replay jsonb;
  v_conflict jsonb;
  v_second jsonb;
  v_restore jsonb;
  v_unpublish jsonb;
  v_failed jsonb;
  v_pub_1 uuid;
  v_pub_2 uuid;
  v_hash_1 text;
  v_before_publications bigint;
  v_before_receipts bigint;
  v_before_audits bigint;
  v_before_session jsonb;
begin
  -- Browser roles must not receive direct table/function authority.
  if has_table_privilege('anon','public.session_editorial_publications','select')
     or has_table_privilege('authenticated','public.session_editorial_publications','select')
     or has_table_privilege('anon','public.session_editorial_publication_receipts','select')
     or has_table_privilege('authenticated','public.session_editorial_publication_receipts','select')
     or has_function_privilege(
       'anon',
       'public.publish_session_editorial_snapshot_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.publish_session_editorial_snapshot_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text)',
       'execute'
     ) then
    raise exception 'PUBLICATION_BROWSER_PRIVILEGE_LEAK';
  end if;

  set local role service_role;

  select public.publish_session_editorial_snapshot_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '88888888-8888-4888-8888-888888888881',
    null,
    'aaaaaaaa-0000-4000-8000-000000000001',
    '99999999-9999-4999-8999-999999999999',
    'https://media.dnd.faysk.dev/campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp'
  ) into v_first;

  if v_first->>'ok' <> 'true'
     or v_first->>'replayed' <> 'false'
     or (v_first->>'version')::bigint <> 1 then
    raise exception 'FIRST_PUBLISH_INVALID:%', v_first;
  end if;
  v_pub_1 := (v_first->>'publicationId')::uuid;
  v_hash_1 := v_first->>'payloadSha256';

  if v_hash_1 !~ '^[0-9a-f]{64}$' then
    raise exception 'PAYLOAD_HASH_INVALID:%', v_hash_1;
  end if;

  if not exists (
    select 1 from public.sessions s
    where s.id='22222222-2222-4222-8222-222222222222'
      and s.status='published'
      and s.title='Título público v1'
      and s.arc='Valcinzento'
      and s.summary_short='Descrição pública v1'
      and s.summary_full like '# Resumo público v1%'
      and s.current_session_publication_id=v_pub_1
      and s.metadata->>'coverImageUrl' =
        'https://media.dnd.faysk.dev/campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp'
      and s.metadata->>'heroImageUrl' =
        'https://media.dnd.faysk.dev/campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp'
  ) then
    raise exception 'FIRST_PUBLISH_PUBLIC_STATE_MISMATCH';
  end if;

  if (select count(*) from public.session_editorial_publications) <> 1
     or (select count(*) from public.session_editorial_publication_receipts) <> 1
     or (select count(*) from public.audit_log where action='session_editorial_publication.publish') <> 1 then
    raise exception 'FIRST_PUBLISH_EVIDENCE_MISMATCH';
  end if;

  -- Same operation + same payload is a pure replay even after current moved.
  select public.publish_session_editorial_snapshot_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '88888888-8888-4888-8888-888888888881',
    null,
    'aaaaaaaa-0000-4000-8000-000000000001',
    '99999999-9999-4999-8999-999999999999',
    'https://media.dnd.faysk.dev/campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp'
  ) into v_replay;
  if v_replay->>'ok' <> 'true'
     or v_replay->>'replayed' <> 'true'
     or (v_replay->>'publicationId')::uuid <> v_pub_1
     or v_replay->>'payloadSha256' <> v_hash_1 then
    raise exception 'REPLAY_INVALID:%', v_replay;
  end if;
  if (select count(*) from public.session_editorial_publications) <> 1
     or (select count(*) from public.session_editorial_publication_receipts) <> 1 then
    raise exception 'REPLAY_DUPLICATED_EVIDENCE';
  end if;

  -- Same operation with a different valid public cover is a conflict, not replay.
  select public.publish_session_editorial_snapshot_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '88888888-8888-4888-8888-888888888881',
    v_pub_1,
    'aaaaaaaa-0000-4000-8000-000000000001',
    null,
    'https://dnd.faysk.dev/assets/sessions/other.webp'
  ) into v_conflict;
  if v_conflict <> '{"ok":false,"reason":"operation_conflict"}'::jsonb then
    raise exception 'DIVERGENT_OPERATION_REPLAY_ACCEPTED:%', v_conflict;
  end if;

  -- A new operation with stale expected-current leaves zero evidence.
  v_before_publications := (select count(*) from public.session_editorial_publications);
  v_before_receipts := (select count(*) from public.session_editorial_publication_receipts);
  v_before_audits := (select count(*) from public.audit_log);
  select public.publish_session_editorial_snapshot_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '88888888-8888-4888-8888-888888888881',
    null,
    'aaaaaaaa-0000-4000-8000-000000000002',
    '99999999-9999-4999-8999-999999999999',
    'https://media.dnd.faysk.dev/campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp'
  ) into v_conflict;
  if v_conflict->>'ok' <> 'false' or v_conflict->>'reason' <> 'conflict' then
    raise exception 'STALE_CURRENT_ACCEPTED:%', v_conflict;
  end if;
  if (select count(*) from public.session_editorial_publications) <> v_before_publications
     or (select count(*) from public.session_editorial_publication_receipts) <> v_before_receipts
     or (select count(*) from public.audit_log) <> v_before_audits then
    raise exception 'STALE_CURRENT_LEFT_EVIDENCE';
  end if;

  -- A second immutable draft produces version 2 and preserves version 1.
  reset role;
  insert into public.session_editorial_drafts(
    id,campaign_id,session_id,revision,base_transcript_revision_id,
    cover_asset_id,arc,title,summary_short,summary_full,actor_profile_id
  ) values (
    '88888888-8888-4888-8888-888888888882',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    2,
    '77777777-7777-4777-8777-777777777777',
    '99999999-9999-4999-8999-999999999999',
    'Valcinzento',
    'Título público v2',
    'Descrição pública v2',
    '# Resumo público v2',
    '33333333-3333-4333-8333-333333333333'
  );
  update public.sessions
  set current_editorial_draft_id='88888888-8888-4888-8888-888888888882'
  where id='22222222-2222-4222-8222-222222222222';
  set local role service_role;

  select public.publish_session_editorial_snapshot_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '88888888-8888-4888-8888-888888888882',
    v_pub_1,
    'aaaaaaaa-0000-4000-8000-000000000003',
    '99999999-9999-4999-8999-999999999999',
    'https://media.dnd.faysk.dev/campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp'
  ) into v_second;
  if v_second->>'ok' <> 'true' or (v_second->>'version')::bigint <> 2 then
    raise exception 'SECOND_PUBLISH_INVALID:%', v_second;
  end if;
  v_pub_2 := (v_second->>'publicationId')::uuid;
  if (select count(*) from public.session_editorial_publications) <> 2 then
    raise exception 'REPLACE_DESTROYED_HISTORY';
  end if;

  -- Restore selects old immutable content and does not create a fake third snapshot.
  select public.restore_session_editorial_publication_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_pub_1,
    v_pub_2,
    'aaaaaaaa-0000-4000-8000-000000000004'
  ) into v_restore;
  if v_restore->>'ok' <> 'true'
     or (v_restore->>'publicationId')::uuid <> v_pub_1 then
    raise exception 'RESTORE_INVALID:%', v_restore;
  end if;
  if not exists (
    select 1 from public.sessions
    where id='22222222-2222-4222-8222-222222222222'
      and current_session_publication_id=v_pub_1
      and title='Título público v1'
      and summary_short='Descrição pública v1'
      and summary_full like '# Resumo público v1%'
      and status='published'
  ) then
    raise exception 'RESTORE_PUBLIC_STATE_MISMATCH';
  end if;

  -- Unpublish hides the session by lifecycle without deleting history.
  select public.unpublish_session_editorial_snapshot_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    v_pub_1,
    'aaaaaaaa-0000-4000-8000-000000000005'
  ) into v_unpublish;
  if v_unpublish->>'ok' <> 'true' then
    raise exception 'UNPUBLISH_INVALID:%', v_unpublish;
  end if;
  if not exists (
    select 1 from public.sessions
    where id='22222222-2222-4222-8222-222222222222'
      and current_session_publication_id is null
      and status='approved'
  ) or (select count(*) from public.session_editorial_publications) <> 2 then
    raise exception 'UNPUBLISH_DESTROYED_HISTORY';
  end if;

  -- Receipt failure after snapshot/session writes must roll back the whole DB commit.
  reset role;
  update public.sessions
  set current_editorial_draft_id='88888888-8888-4888-8888-888888888882'
  where id='22222222-2222-4222-8222-222222222222';
  create function public.fail_session_publication_receipt()
  returns trigger language plpgsql as $fail$
  begin
    raise exception 'synthetic receipt failure';
  end
  $fail$;
  create trigger fail_session_publication_receipt
  before insert on public.session_editorial_publication_receipts
  for each row execute function public.fail_session_publication_receipt();

  select to_jsonb(s) into v_before_session
  from public.sessions s
  where s.id='22222222-2222-4222-8222-222222222222';
  v_before_publications := (select count(*) from public.session_editorial_publications);
  v_before_receipts := (select count(*) from public.session_editorial_publication_receipts);
  v_before_audits := (select count(*) from public.audit_log);

  begin
    set local role service_role;
    select public.publish_session_editorial_snapshot_atomic(
      '44444444-4444-4444-8444-444444444444',
      '33333333-3333-4333-8333-333333333333',
      'synthetic-campaign',
      '22222222-2222-4222-8222-222222222222',
      '88888888-8888-4888-8888-888888888882',
      null,
      'aaaaaaaa-0000-4000-8000-000000000006',
      '99999999-9999-4999-8999-999999999999',
      'https://media.dnd.faysk.dev/campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp'
    ) into v_failed;
    raise exception 'RECEIPT_FAILURE_DID_NOT_ABORT';
  exception
    when others then
      if sqlerrm not like '%synthetic receipt failure%' then raise; end if;
  end;
  reset role;

  if (select count(*) from public.session_editorial_publications) <> v_before_publications
     or (select count(*) from public.session_editorial_publication_receipts) <> v_before_receipts
     or (select count(*) from public.audit_log) <> v_before_audits
     or (select to_jsonb(s) from public.sessions s
         where s.id='22222222-2222-4222-8222-222222222222') <> v_before_session then
    raise exception 'RECEIPT_FAILURE_LEFT_PARTIAL_STATE';
  end if;
  drop trigger fail_session_publication_receipt
    on public.session_editorial_publication_receipts;
  drop function public.fail_session_publication_receipt();

  -- Revoking capability denies publication before any evidence is reserved.
  delete from public.role_permissions
  where role_id='55555555-5555-4555-8555-555555555555'
    and permission_action='campaign.transcript.publish';
  set local role service_role;
  select public.publish_session_editorial_snapshot_atomic(
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'synthetic-campaign',
    '22222222-2222-4222-8222-222222222222',
    '88888888-8888-4888-8888-888888888882',
    null,
    'aaaaaaaa-0000-4000-8000-000000000007',
    '99999999-9999-4999-8999-999999999999',
    'https://media.dnd.faysk.dev/campaigns/synthetic-campaign/sessions/22222222-2222-4222-8222-222222222222/cover/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp'
  ) into v_conflict;
  if v_conflict <> '{"ok":false,"reason":"forbidden"}'::jsonb then
    raise exception 'REVOKED_CAPABILITY_ACCEPTED:%', v_conflict;
  end if;
  reset role;

  -- No transcript payload or marker may leak into the public snapshot/receipt/audit.
  if exists (
    select 1
    from public.session_editorial_publications p
    where row_to_json(p)::text like '%PRIVATE_TRANSCRIPT_MARKER_NEVER_PUBLIC%'
  ) or exists (
    select 1
    from public.session_editorial_publication_receipts r
    where row_to_json(r)::text like '%PRIVATE_TRANSCRIPT_MARKER_NEVER_PUBLIC%'
  ) or exists (
    select 1
    from public.audit_log a
    where a.action like 'session_editorial_publication.%'
      and (coalesce(a.old_value::text,'') || coalesce(a.new_value::text,''))
        like '%PRIVATE_TRANSCRIPT_MARKER_NEVER_PUBLIC%'
  ) then
    raise exception 'PUBLICATION_LEAKED_PRIVATE_TRANSCRIPT';
  end if;
end
$contract$;

select 'SESSION_EDITORIAL_PUBLICATION_DATABASE_OK';
