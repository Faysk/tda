-- Definition only. No role_permissions or role_assignments are created.
insert into public.permission_catalog(action, plane, description)
values ('campaign.transcript.import', 'mixed', 'Import transcript segments from the authorized local companion into an existing campaign session.')
on conflict (action) do nothing;
