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
