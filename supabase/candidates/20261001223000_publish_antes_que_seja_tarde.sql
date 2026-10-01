-- #1286 — deliberate public activation for the second first-class campaign.
--
-- Apply only after the D/Seika/Yllith catalogue build is deployed and the
-- multi-campaign public smoke for the same source SHA is green.
--
-- Rollback is non-destructive:
--   update public.campaigns
--      set visibility = 'private'
--    where slug = 'antes-que-seja-tarde';
--
-- No narrative rows, sessions, entities, canon or media bindings are created.

begin;

do $$
declare
  changed integer;
begin
  if not exists (
    select 1
      from public.campaigns
     where slug = 'antes-que-seja-tarde'
       and name = 'Antes que seja tarde'
       and public_slug = 'antes-que-seja-tarde'
       and lifecycle = 'active'
  ) then
    raise exception 'ANTES_QUE_SEJA_TARDE_IDENTITY_NOT_READY';
  end if;

  update public.campaigns
     set visibility = 'public'
   where slug = 'antes-que-seja-tarde'
     and public_slug = 'antes-que-seja-tarde'
     and lifecycle = 'active'
     and visibility = 'private';

  get diagnostics changed = row_count;

  if changed not in (0, 1) then
    raise exception 'ANTES_QUE_SEJA_TARDE_VISIBILITY_UPDATE_INVALID_COUNT:%', changed;
  end if;

  if not exists (
    select 1
      from public.campaigns
     where slug = 'antes-que-seja-tarde'
       and public_slug = 'antes-que-seja-tarde'
       and lifecycle = 'active'
       and visibility = 'public'
  ) then
    raise exception 'ANTES_QUE_SEJA_TARDE_PUBLIC_READBACK_FAILED';
  end if;
end
$$;

commit;
