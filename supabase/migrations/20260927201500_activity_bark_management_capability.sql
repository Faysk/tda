-- Register the browser-local activity bark administration capability.
-- The application still authorizes by exact capability + scope; no profile/user
-- identifier is embedded here and no role assignment is created by this migration.

insert into public.permission_catalog(action, plane, description)
values (
  'campaign.processing.barks.manage',
  'technical',
  'Manage untrusted browser-local Humanized processing bark packs.'
)
on conflict (action) do nothing;

do $$
declare
  v_role_id uuid;
begin
  if not exists (
    select 1
    from public.permission_catalog pc
    where pc.action = 'campaign.processing.barks.manage'
      and pc.plane = 'technical'
  ) then
    raise exception 'campaign.processing.barks.manage exists with an incompatible plane or could not be defined';
  end if;

  select rd.id
  into strict v_role_id
  from public.role_definitions rd
  where rd.slug = 'platform_owner'
    and rd.plane = 'technical'
    and rd.is_system = true;

  insert into public.role_permissions(role_id, permission_action)
  values (v_role_id, 'campaign.processing.barks.manage')
  on conflict (role_id, permission_action) do nothing;
end;
$$;
