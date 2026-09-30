begin;

do $$
begin
  if has_table_privilege('anon', 'public.lembra_references', 'SELECT') then
    raise exception 'anon unexpectedly has direct Lembra table access';
  end if;
  if has_table_privilege('authenticated', 'public.lembra_references', 'SELECT') then
    raise exception 'authenticated unexpectedly has direct Lembra table access';
  end if;
  if not has_table_privilege('service_role', 'public.lembra_references', 'SELECT') then
    raise exception 'service_role must read Lembra references';
  end if;
end;
$$;

insert into public.lembra_references (
  id,
  title,
  description,
  campaign_id,
  status,
  staged_bucket,
  object_key,
  sha256,
  mime_type,
  byte_size,
  width,
  height,
  read_back_verified,
  created_by_auth_user_id,
  created_by_name
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'Ruínas élficas',
  'Arcos antigos cobertos por árvores.',
  null,
  'active',
  'tda-media-preview',
  'lembra/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.png',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'image/png',
  1024,
  800,
  600,
  true,
  '11111111-1111-4111-8111-111111111111',
  'Faysk'
);

insert into public.lembra_favorites(auth_user_id, reference_id)
values (
  '22222222-2222-4222-8222-222222222222',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
);

do $$
begin
  if (
    select count(*)
    from public.lembra_references
    where status = 'active'
  ) <> 1 then
    raise exception 'expected one active shared reference';
  end if;

  if (
    select campaign_id
    from public.lembra_references
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) is not null then
    raise exception 'legacy Lembra reference must remain in Geral after migration';
  end if;

  if (
    select count(*)
    from public.lembra_favorites
    where reference_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) <> 1 then
    raise exception 'favorite relation missing';
  end if;
end;
$$;

do $$
begin
  begin
    insert into public.lembra_references (
      id,
      title,
      staged_bucket,
      object_key,
      sha256,
      mime_type,
      byte_size,
      width,
      height,
      read_back_verified,
      created_by_auth_user_id,
      created_by_name
    )
    values (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'Objeto inválido',
      'tda-media-preview',
      'lembra/outro-caminho.png',
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      'image/png',
      1024,
      100,
      100,
      true,
      '11111111-1111-4111-8111-111111111111',
      'Faysk'
    );
    raise exception 'invalid object key should have failed';
  exception
    when check_violation then
      null;
  end;
end;
$$;

update public.lembra_references
set campaign_id = '11111111-1111-4111-8111-111111111111'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$
declare
  v_key text;
begin
  select object_key into v_key
  from public.lembra_references
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  if v_key <> 'lembra/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.png' then
    raise exception 'campaign classification must not move or rewrite the immutable Lembra object key';
  end if;

  begin
    update public.lembra_references
    set campaign_id = '99999999-9999-4999-8999-999999999999'
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    raise exception 'unknown campaign classification should have failed';
  exception
    when foreign_key_violation then
      null;
  end;
end;
$$;

update public.lembra_references
set campaign_id = '33333333-3333-4333-8333-333333333333'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$
begin
  if not exists (
    select 1
    from public.lembra_references
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and campaign_id = '33333333-3333-4333-8333-333333333333'
  ) then
    raise exception 'archived campaign classification must remain readable';
  end if;
end;
$$;

delete from public.campaigns
where id = '33333333-3333-4333-8333-333333333333';

do $$
begin
  if (
    select campaign_id
    from public.lembra_references
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) is not null then
    raise exception 'campaign deletion must degrade Lembra classification back to Geral';
  end if;
end;
$$;

do $$
declare
  v_expected_updated_at timestamptz;
  v_first_count integer;
  v_stale_count integer;
begin
  select updated_at into v_expected_updated_at
  from public.lembra_references
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  update public.lembra_references
  set
    title = 'Writer A',
    updated_at = v_expected_updated_at + interval '1 second'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and updated_at = v_expected_updated_at;
  get diagnostics v_first_count = row_count;

  update public.lembra_references
  set
    title = 'Writer B stale',
    updated_at = v_expected_updated_at + interval '2 seconds'
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    and updated_at = v_expected_updated_at;
  get diagnostics v_stale_count = row_count;

  if v_first_count <> 1 or v_stale_count <> 0 then
    raise exception 'Lembra optimistic metadata update must reject stale writers';
  end if;

  if (
    select title
    from public.lembra_references
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ) <> 'Writer A' then
    raise exception 'stale metadata writer overwrote the winning update';
  end if;
end;
$$;

update public.lembra_references
set
  title = 'Ruínas élficas atualizadas',
  updated_at = clock_timestamp()
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

update public.lembra_references
set
  status = 'retired',
  retired_at = clock_timestamp(),
  updated_at = clock_timestamp()
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$
begin
  if not exists (
    select 1
    from public.lembra_references
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and status = 'retired'
      and retired_at is not null
  ) then
    raise exception 'soft retirement contract failed';
  end if;
end;
$$;

select 'LEMBRA_SHARED_DATABASE_OK';

rollback;
