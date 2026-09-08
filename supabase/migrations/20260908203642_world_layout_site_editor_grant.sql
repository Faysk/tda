-- Activate the dedicated World layout capability for the existing narrative
-- Site Editor role. Existing assignments are preserved; no user/profile grant is
-- created here and no broader content capability is changed.
do $$
declare
  v_role_id uuid;
begin
  if not exists (
    select 1
    from public.permission_catalog pc
    where pc.action = 'campaign.world.layout.edit'
      and pc.plane = 'narrative'
  ) then
    raise exception 'campaign.world.layout.edit must exist before granting it';
  end if;

  select rd.id
  into strict v_role_id
  from public.role_definitions rd
  where rd.slug = 'site_editor'
    and rd.plane = 'narrative';

  insert into public.role_permissions(role_id, permission_action)
  values (v_role_id, 'campaign.world.layout.edit')
  on conflict (role_id, permission_action) do nothing;
end;
$$;
