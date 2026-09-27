-- Private, immutable editorial drafts for session publication (#791).
-- Browser roles are denied. The server-side service role is the only Data API caller.
-- Public session fields are not mutated by this migration.

create table public.session_editorial_drafts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  revision bigint not null check (revision > 0),
  base_transcript_revision_id uuid not null references public.transcript_revisions(id) on delete restrict,
  cover_asset_id text null check (
    cover_asset_id is null or char_length(cover_asset_id) between 1 and 512
  ),
  arc text not null default '' check (char_length(arc) <= 300),
  title text not null default '' check (char_length(title) <= 500),
  summary_short text not null default '' check (char_length(summary_short) <= 4000),
  summary_full text not null default '' check (char_length(summary_full) <= 200000),
  actor_profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  unique(session_id, revision)
);

alter table public.session_editorial_drafts enable row level security;
revoke all on public.session_editorial_drafts from public, anon, authenticated;
grant select, insert on public.session_editorial_drafts to service_role;

alter table public.sessions
  add column current_editorial_draft_id uuid null;

alter table public.sessions
  add constraint sessions_current_editorial_draft_fk
  foreign key (current_editorial_draft_id)
  references public.session_editorial_drafts(id)
  on delete set null;

create index sessions_current_editorial_draft_id_idx
  on public.sessions(current_editorial_draft_id)
  where current_editorial_draft_id is not null;

create index session_editorial_drafts_campaign_id_idx
  on public.session_editorial_drafts(campaign_id);

create index session_editorial_drafts_base_transcript_revision_id_idx
  on public.session_editorial_drafts(base_transcript_revision_id);

create function public.save_session_editorial_draft_atomic(
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_expected_revision bigint,
  p_base_transcript_revision_id uuid,
  p_cover_asset_id text,
  p_arc text,
  p_title text,
  p_summary_short text,
  p_summary_full text
)
returns table(status text, draft_id uuid, revision bigint)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_campaign_id uuid;
  v_current_draft_id uuid;
  v_current_revision bigint := 0;
  v_new_draft_id uuid;
  v_new_revision bigint;
  v_cover_asset_id text;
begin
  if p_actor_profile_id is null
     or p_campaign_slug is null
     or btrim(p_campaign_slug) = ''
     or p_session_id is null
     or p_expected_revision is null
     or p_expected_revision < 0
     or p_base_transcript_revision_id is null then
    raise exception 'invalid editorial draft identity' using errcode = '22023';
  end if;

  if p_arc is null
     or char_length(p_arc) > 300
     or p_title is null
     or char_length(p_title) > 500
     or p_summary_short is null
     or char_length(p_summary_short) > 4000
     or p_summary_full is null
     or char_length(p_summary_full) > 200000
     or (p_cover_asset_id is not null and char_length(btrim(p_cover_asset_id)) > 512) then
    raise exception 'invalid editorial draft content' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_actor_profile_id
  ) then
    return query select 'forbidden'::text, null::uuid, null::bigint;
    return;
  end if;

  select s.campaign_id, s.current_editorial_draft_id
  into v_campaign_id, v_current_draft_id
  from public.sessions s
  join public.campaigns c on c.id = s.campaign_id
  where s.id = p_session_id
    and c.slug = p_campaign_slug
  for update of s;

  if not found then
    return query select 'not_found'::text, null::uuid, null::bigint;
    return;
  end if;

  if not exists (
    select 1
    from public.transcript_revisions tr
    where tr.id = p_base_transcript_revision_id
      and tr.session_id = p_session_id
      and tr.campaign_id = v_campaign_id
  ) then
    return query select 'invalid_base'::text, null::uuid, null::bigint;
    return;
  end if;

  if v_current_draft_id is not null then
    select d.revision
    into v_current_revision
    from public.session_editorial_drafts d
    where d.id = v_current_draft_id
      and d.session_id = p_session_id
      and d.campaign_id = v_campaign_id;

    if not found then
      raise exception 'current editorial draft pointer is inconsistent';
    end if;
  end if;

  if v_current_revision <> p_expected_revision then
    return query select 'conflict'::text, v_current_draft_id, v_current_revision;
    return;
  end if;

  v_new_revision := v_current_revision + 1;
  v_new_draft_id := gen_random_uuid();
  v_cover_asset_id := nullif(btrim(coalesce(p_cover_asset_id, '')), '');

  insert into public.session_editorial_drafts (
    id,
    campaign_id,
    session_id,
    revision,
    base_transcript_revision_id,
    cover_asset_id,
    arc,
    title,
    summary_short,
    summary_full,
    actor_profile_id
  ) values (
    v_new_draft_id,
    v_campaign_id,
    p_session_id,
    v_new_revision,
    p_base_transcript_revision_id,
    v_cover_asset_id,
    p_arc,
    p_title,
    p_summary_short,
    p_summary_full,
    p_actor_profile_id
  );

  update public.sessions s
  set current_editorial_draft_id = v_new_draft_id
  where s.id = p_session_id
    and s.campaign_id = v_campaign_id
    and s.current_editorial_draft_id is not distinct from v_current_draft_id;

  if not found then
    raise exception 'editorial draft pointer changed while session was locked';
  end if;

  insert into public.audit_log (
    campaign_id,
    session_id,
    actor_id,
    action,
    table_name,
    record_id,
    old_value,
    new_value
  ) values (
    v_campaign_id,
    p_session_id,
    p_actor_profile_id,
    'session_editorial_draft.save',
    'session_editorial_drafts',
    v_new_draft_id,
    case
      when v_current_draft_id is null then null
      else jsonb_build_object(
        'draftId', v_current_draft_id,
        'revision', v_current_revision
      )
    end,
    jsonb_build_object(
      'draftId', v_new_draft_id,
      'revision', v_new_revision,
      'baseTranscriptRevisionId', p_base_transcript_revision_id,
      'hasCoverIntent', v_cover_asset_id is not null,
      'titleChars', char_length(p_title),
      'shortDescriptionChars', char_length(p_summary_short),
      'summaryChars', char_length(p_summary_full)
    )
  );

  return query select 'updated'::text, v_new_draft_id, v_new_revision;
end;
$$;

comment on function public.save_session_editorial_draft_atomic(
  uuid, text, uuid, bigint, uuid, text, text, text, text, text
)
is 'Server-only SECURITY INVOKER CAS boundary for immutable session editorial drafts. Public session fields are never mutated by draft save.';

revoke all on function public.save_session_editorial_draft_atomic(
  uuid, text, uuid, bigint, uuid, text, text, text, text, text
) from public;
revoke execute on function public.save_session_editorial_draft_atomic(
  uuid, text, uuid, bigint, uuid, text, text, text, text, text
) from anon;
revoke execute on function public.save_session_editorial_draft_atomic(
  uuid, text, uuid, bigint, uuid, text, text, text, text, text
) from authenticated;
grant execute on function public.save_session_editorial_draft_atomic(
  uuid, text, uuid, bigint, uuid, text, text, text, text, text
) to service_role;
