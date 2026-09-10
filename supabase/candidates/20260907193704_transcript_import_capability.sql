-- Definition only. No role_permissions or role_assignments are created.
insert into public.permission_catalog(action, plane, description)
values (
  'campaign.transcript.import',
  'mixed',
  'Import transcript segments from the authorized local companion into an existing campaign session.'
)
on conflict (action) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.permission_catalog pc
    where pc.action = 'campaign.transcript.import'
      and pc.plane = 'mixed'
  ) then
    raise exception 'campaign.transcript.import exists with an incompatible plane or could not be defined';
  end if;
end;
$$;
