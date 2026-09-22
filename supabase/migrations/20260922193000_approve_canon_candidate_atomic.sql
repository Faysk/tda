-- Human-gated canonical review boundary for narrative candidates.
--
-- This function never publishes to public audiences. An approved candidate becomes
-- an active canon entry with review_only visibility. World relation publication
-- remains a separate, provenance-gated editorial action.
create or replace function public.approve_canon_candidate_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_candidate_id uuid,
  p_reviewer_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_campaign_id uuid;
  v_candidate public.canon_candidates%rowtype;
  v_existing public.canon_entries%rowtype;
  v_canon_entry_id uuid;
  v_now timestamptz := clock_timestamp();
  v_notes text := nullif(btrim(coalesce(p_reviewer_notes, '')), '');
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_candidate_id is null
     or nullif(btrim(coalesce(p_campaign_slug, '')), '') is null
     or length(coalesce(p_reviewer_notes, '')) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payload');
  end if;

  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_actor_profile_id
      and profile.auth_user_id = p_auth_user_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  -- Authorize before resolving campaign/candidate existence to avoid a target oracle.
  if not exists (
    select 1
    from public.role_assignments assignment
    join public.role_permissions permission on permission.role_id = assignment.role_id
    where assignment.profile_id = p_actor_profile_id
      and assignment.status = 'active'
      and assignment.starts_at <= v_now
      and (assignment.ends_at is null or assignment.ends_at > v_now)
      and permission.permission_action = 'narrative.canon.approve'
      and (
        (assignment.scope_type = 'campaign' and assignment.scope_id = p_campaign_slug)
        or (assignment.scope_type = 'project' and assignment.scope_id = 'tda')
      )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  select campaign.id
  into v_campaign_id
  from public.campaigns campaign
  where campaign.slug = p_campaign_slug;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select candidate.*
  into v_candidate
  from public.canon_candidates candidate
  join public.sessions session on session.id = candidate.session_id
  where candidate.id = p_candidate_id
    and session.campaign_id = v_campaign_id
  for update of candidate;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select canon.*
  into v_existing
  from public.canon_entries canon
  where canon.campaign_id = v_campaign_id
    and canon.source_candidate_id = p_candidate_id
  for update;

  if found then
    if v_candidate.status = 'approved_canon'
       and v_existing.status = 'active' then
      return jsonb_build_object(
        'ok', true,
        'status', 'unchanged',
        'canonEntryId', v_existing.id,
        'visibility', v_existing.visibility
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'conflict');
  end if;

  if v_candidate.status <> 'candidate' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_state');
  end if;

  insert into public.canon_entries(
    campaign_id,
    source_candidate_id,
    title,
    content,
    entry_type,
    visibility,
    status,
    source_run_id,
    metadata
  ) values (
    v_campaign_id,
    v_candidate.id,
    v_candidate.title,
    v_candidate.claim,
    'canon_candidate',
    'review_only',
    'active',
    v_candidate.source_run_id,
    jsonb_build_object('candidateType', v_candidate.candidate_type)
  )
  returning id into v_canon_entry_id;

  update public.canon_candidates
  set status = 'approved_canon',
      approved_by = p_actor_profile_id,
      approved_at = v_now,
      reviewer_notes = v_notes,
      updated_at = v_now
  where id = v_candidate.id;

  insert into public.review_decisions(
    session_id,
    target_table,
    target_id,
    decision,
    notes,
    decided_by,
    source_system,
    source_run_id,
    target_source_id,
    metadata
  ) values (
    v_candidate.session_id,
    'canon_candidates',
    v_candidate.id,
    'approved_canon',
    v_notes,
    p_actor_profile_id,
    'tda_edit',
    v_candidate.source_run_id,
    v_candidate.source_candidate_id,
    jsonb_build_object(
      'canonEntryId', v_canon_entry_id,
      'visibility', 'review_only'
    )
  );

  insert into public.audit_log(
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
    v_candidate.session_id,
    p_actor_profile_id,
    'canon_candidate.approve',
    'canon_candidates',
    v_candidate.id,
    jsonb_build_object('status', v_candidate.status),
    jsonb_build_object(
      'status', 'approved_canon',
      'canonEntryId', v_canon_entry_id,
      'visibility', 'review_only'
    )
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'approved',
    'canonEntryId', v_canon_entry_id,
    'visibility', 'review_only'
  );
end;
$function$;

comment on function public.approve_canon_candidate_atomic(uuid,uuid,text,uuid,text) is
  'Server-only human canon approval. Requires narrative.canon.approve, atomically records decision/audit and creates review_only canon; never publishes to a public audience.';

revoke all on function public.approve_canon_candidate_atomic(uuid,uuid,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.approve_canon_candidate_atomic(uuid,uuid,text,uuid,text)
  to service_role;
