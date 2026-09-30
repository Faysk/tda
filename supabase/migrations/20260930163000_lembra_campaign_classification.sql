-- #1132: optional campaign classification for the globally shared Lembra library.
-- Classification is organization metadata only. It MUST NOT become a campaign
-- authorization boundary and MUST NOT move immutable media objects.

begin;

alter table public.lembra_references
  add column if not exists campaign_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lembra_references_campaign_fkey'
      and conrelid = 'public.lembra_references'::regclass
  ) then
    alter table public.lembra_references
      add constraint lembra_references_campaign_fkey
      foreign key (campaign_id)
      references public.campaigns(id)
      on delete set null
      not valid;

    alter table public.lembra_references
      validate constraint lembra_references_campaign_fkey;
  end if;
end $$;

create index if not exists lembra_references_active_campaign_created_idx
  on public.lembra_references(campaign_id, created_at desc, id desc)
  where status = 'active';

comment on column public.lembra_references.campaign_id is
  'Optional organizational campaign classification for Lembra. NULL means Geral. It never grants/revokes access and never changes the immutable Lembra object key.';

commit;
