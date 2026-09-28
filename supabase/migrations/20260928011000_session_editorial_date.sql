-- Version session date inside private editorial drafts and immutable session publications (#899).
-- Existing rows remain readable without backfill. New Web callers use compatibility
-- wrapper RPCs so the previously published application can continue using the old
-- signatures during staged rollout.

alter table public.session_editorial_drafts
  add column session_date date null,
  add column session_date_captured boolean not null default false;

alter table public.session_publications
  add column session_date date null;

comment on column public.session_editorial_drafts.session_date
is 'Date-only editorial value captured by the draft; null is allowed while editing.';

comment on column public.session_editorial_drafts.session_date_captured
is 'Distinguishes legacy drafts that predate editable session dates from a new draft intentionally saved with an empty date.';

comment on column public.session_publications.session_date
is 'Date-only value included in the immutable public editorial snapshot. Legacy publications may be null.';

create function public.save_session_editorial_draft_with_date_atomic(
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_expected_revision bigint,
  p_base_transcript_revision_id uuid,
  p_cover_asset_id text,
  p_arc text,
  p_title text,
  p_summary_short text,
  p_summary_full text,
  p_session_date text
)
returns table(status text, draft_id uuid, revision bigint)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_session_date date;
  v_status text;
  v_draft_id uuid;
  v_revision bigint;
begin
  if p_session_date is null or p_session_date = '' then
    v_session_date := null;
  else
    if p_session_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'invalid canonical session date' using errcode = '22007';
    end if;
    begin
      v_session_date := p_session_date::date;
    exception
      when datetime_field_overflow or invalid_datetime_format then
        raise exception 'invalid canonical session date' using errcode = '22007';
    end;
    if to_char(v_session_date, 'YYYY-MM-DD') <> p_session_date then
      raise exception 'invalid canonical session date' using errcode = '22007';
    end if;
  end if;

  select r.status, r.draft_id, r.revision
  into v_status, v_draft_id, v_revision
  from public.save_session_editorial_draft_atomic(
    p_actor_profile_id,
    p_campaign_slug,
    p_session_id,
    p_expected_revision,
    p_base_transcript_revision_id,
    p_cover_asset_id,
    p_arc,
    p_title,
    p_summary_short,
    p_summary_full
  ) r;

  if v_status = 'updated' and v_draft_id is not null then
    update public.session_editorial_drafts d
    set
      session_date = v_session_date,
      session_date_captured = true
    where d.id = v_draft_id
      and d.session_id = p_session_id;

    if not found then
      raise exception 'editorial draft date capture failed';
    end if;

    update public.audit_log a
    set new_value = coalesce(a.new_value, '{}'::jsonb) ||
      jsonb_build_object('sessionDate', v_session_date)
    where a.record_id = v_draft_id
      and a.session_id = p_session_id
      and a.action = 'session_editorial_draft.save';
  end if;

  return query select v_status, v_draft_id, v_revision;
end;
$$;

comment on function public.save_session_editorial_draft_with_date_atomic(
  uuid, text, uuid, bigint, uuid, text, text, text, text, text, text
)
is 'Server-only SECURITY INVOKER CAS wrapper that captures an optional canonical YYYY-MM-DD session date in the immutable editorial draft.';

revoke all on function public.save_session_editorial_draft_with_date_atomic(
  uuid, text, uuid, bigint, uuid, text, text, text, text, text, text
) from public;
revoke execute on function public.save_session_editorial_draft_with_date_atomic(
  uuid, text, uuid, bigint, uuid, text, text, text, text, text, text
) from anon;
revoke execute on function public.save_session_editorial_draft_with_date_atomic(
  uuid, text, uuid, bigint, uuid, text, text, text, text, text, text
) from authenticated;
grant execute on function public.save_session_editorial_draft_with_date_atomic(
  uuid, text, uuid, bigint, uuid, text, text, text, text, text, text
) to service_role;

create function public.publish_session_editorial_with_date_atomic(
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_session_id uuid,
  p_draft_id uuid,
  p_expected_current_publication_id uuid,
  p_operation_id uuid,
  p_public_cover_url text
)
returns table(
  status text,
  publication_id uuid,
  version bigint,
  previous_publication_id uuid,
  payload_sha256 text
)
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  v_date_captured boolean;
  v_session_date date;
  v_status text;
  v_publication_id uuid;
  v_version bigint;
  v_previous_publication_id uuid;
  v_old_payload_sha256 text;
  v_publication public.session_publications%rowtype;
  v_payload_material text;
  v_payload_sha256 text;
begin
  select d.session_date_captured, d.session_date
  into v_date_captured, v_session_date
  from public.session_editorial_drafts d
  where d.id = p_draft_id
    and d.session_id = p_session_id;

  if found and (v_date_captured is not true or v_session_date is null) then
    return query select
      'not_ready'::text,
      null::uuid,
      null::bigint,
      null::uuid,
      null::text;
    return;
  end if;

  select r.status, r.publication_id, r.version, r.previous_publication_id, r.payload_sha256
  into v_status, v_publication_id, v_version, v_previous_publication_id, v_old_payload_sha256
  from public.publish_session_editorial_atomic(
    p_actor_profile_id,
    p_campaign_slug,
    p_session_id,
    p_draft_id,
    p_expected_current_publication_id,
    p_operation_id,
    p_public_cover_url
  ) r;

  if v_status not in ('published', 'replay') or v_publication_id is null then
    return query select
      v_status,
      v_publication_id,
      v_version,
      v_previous_publication_id,
      v_old_payload_sha256;
    return;
  end if;

  select sp.*
  into v_publication
  from public.session_publications sp
  where sp.id = v_publication_id
    and sp.session_id = p_session_id;

  if not found then
    raise exception 'session publication date wrapper could not read publication';
  end if;

  v_payload_material :=
    'tda_session_publication_v2' ||
    '|session=' || p_session_id::text ||
    '|draft=' || p_draft_id::text ||
    '|transcript=' || v_publication.base_transcript_revision_id::text ||
    '|date=' || v_session_date::text ||
    '|cover=' || octet_length(convert_to(v_publication.cover_url, 'UTF8'))::text || ':' || v_publication.cover_url ||
    '|arc=' || octet_length(convert_to(v_publication.arc, 'UTF8'))::text || ':' || v_publication.arc ||
    '|title=' || octet_length(convert_to(v_publication.title, 'UTF8'))::text || ':' || v_publication.title ||
    '|short=' || octet_length(convert_to(v_publication.summary_short, 'UTF8'))::text || ':' || v_publication.summary_short ||
    '|full=' || octet_length(convert_to(v_publication.summary_full, 'UTF8'))::text || ':' || v_publication.summary_full;

  v_payload_sha256 := encode(
    extensions.digest(convert_to(v_payload_material, 'UTF8'), 'sha256'),
    'hex'
  );

  update public.session_publications sp
  set
    session_date = v_session_date,
    payload_sha256 = v_payload_sha256
  where sp.id = v_publication_id
    and sp.session_id = p_session_id;

  update public.session_publication_operations o
  set payload_sha256 = v_payload_sha256
  where o.operation_id = p_operation_id
    and o.publication_id = v_publication_id
    and o.session_id = p_session_id;

  if not found then
    raise exception 'session publication operation date receipt is inconsistent';
  end if;

  update public.sessions s
  set session_date = v_session_date
  where s.id = p_session_id
    and s.current_session_publication_id = v_publication_id;

  update public.audit_log a
  set new_value = coalesce(a.new_value, '{}'::jsonb) ||
    jsonb_build_object(
      'sessionDate', v_session_date,
      'payloadSha256', v_payload_sha256
    )
  where a.record_id = v_publication_id
    and a.session_id = p_session_id
    and a.action = 'session_publication.publish';

  return query select
    v_status,
    v_publication_id,
    v_version,
    v_previous_publication_id,
    v_payload_sha256;
end;
$$;

comment on function public.publish_session_editorial_with_date_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text
)
is 'Server-only SECURITY INVOKER publication wrapper that requires a captured session date, includes it in the immutable v2 payload hash, and promotes it atomically with the current public publication.';

revoke all on function public.publish_session_editorial_with_date_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text
) from public;
revoke execute on function public.publish_session_editorial_with_date_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text
) from anon;
revoke execute on function public.publish_session_editorial_with_date_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text
) from authenticated;
grant execute on function public.publish_session_editorial_with_date_atomic(
  uuid, text, uuid, uuid, uuid, uuid, text
) to service_role;
