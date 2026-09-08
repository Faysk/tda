-- Candidate only. No role_permissions or role_assignments are created.
insert into public.permission_catalog(action, plane, description)
values (
  'campaign.world.layout.edit',
  'narrative',
  'Save the editorial presentation layout for the campaign World Explorer.'
)
on conflict (action) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.permission_catalog pc
    where pc.action = 'campaign.world.layout.edit'
      and pc.plane = 'narrative'
  ) then
    raise exception 'campaign.world.layout.edit exists with an incompatible plane or could not be defined';
  end if;
end;
$$;
