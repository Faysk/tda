-- Human review decisions that deliberately do not create canon.
--
-- Canon approval remains a separate boundary requiring narrative.canon.approve.
-- This function handles triage states under narrative.review.manage only.
create or replace function public.review_canon_candidate_atomic(
  p_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_campaign_slug text,
  p_candidate_id uuid,
  p_decision text,
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
  v_now timestamptz := clock_timestamp();
  v_notes text := nullif(btrim(coalesce(p_reviewer_notes, '')), '');
  v_decision text := lower(btrim(coalesce(p_decision, '')));
begin
  if p_auth_user_id is null
     or p_actor_profile_id is null
     or p_candidate_id is null
     or nullif(btrim(coalesce(p_campaign_slug, '')), '') is null
     or length(coalesce(p_reviewer_notes, '')) > 2000
     or v_decision not in (
       'rejected',
       'interpretation',
       'possible_hook',
       'retcon_pending',
       'private'
     ) then
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
      and permission.permission_action = 'narrative.review.manage'
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

  if v_candidate.status = v_decision then
    if exists (
      select 1
      from public.review_decisions decision
      where decision.target_table = 'canon_candidates'
        and decision.target_id = v_candidate.id
        and decision.decision = v_decision
    ) then
      return jsonb_build_object(
        'ok', true,
        'status', 'unchanged',
        'decision', v_decision
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'conflict');
  end if;

  if v_candidate.status <> 'candidate' then
    return jsonb_build_object('ok', false, 'reason', 'conflict');
  end if;

  update public.canon_candidates
  set status = v_decision,
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
    v_decision,
    v_notes,
    p_actor_profile_id,
    'tda_edit',
    v_candidate.source_run_id,
    v_candidate.source_candidate_id,
    jsonb_build_object('createsCanon', false)
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
    'canon_candidate.review',
    'canon_candidates',
    v_candidate.id,
    jsonb_build_object('status', v_candidate.status),
    jsonb_build_object('status', v_decision)
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'reviewed',
    'decision', v_decision
  );
end;
$function$;

comment on function public.review_canon_candidate_atomic(uuid,uuid,text,uuid,text,text) is
  'Server-only non-canon candidate triage. Requires narrative.review.manage; records decision/audit atomically and never creates canon or public content.';

revoke all on function public.review_canon_candidate_atomic(uuid,uuid,text,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.review_canon_candidate_atomic(uuid,uuid,text,uuid,text,text)
  to service_role;
