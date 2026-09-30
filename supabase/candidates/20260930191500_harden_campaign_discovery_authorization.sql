-- #1134: harden campaign discovery and cross-campaign authorization boundaries.
-- Candidate only. Depends on the approved #1123 campaign registry candidate being
-- applied first in scratch/rollout. No remote application is implied by this file.

begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'campaigns'
      and column_name = 'lifecycle'
  )
  or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'campaigns'
      and column_name = 'visibility'
  )
  or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'campaigns'
      and column_name = 'public_slug'
  ) then
    raise exception '#1134 requires the #1123 first-class campaign registry schema';
  end if;
end
$$;

-- Campaign creation is a project concern. Keep it separate from campaign-level
-- permissions so future campaigns are not created by virtue of membership in one
-- existing campaign.
insert into public.permission_catalog(action, plane, description)
values (
  'project.campaigns.manage',
  'technical',
  'Create and administer first-class campaign registry identities.'
)
on conflict (action) do update
set
  plane = excluded.plane,
  description = excluded.description;

insert into public.role_permissions(role_id, permission_action)
select role.id, 'project.campaigns.manage'
from public.role_definitions role
where role.slug = 'platform_owner'
on conflict (role_id, permission_action) do nothing;

do $$
begin
  if not exists (
    select 1
    from public.role_permissions rp
    join public.role_definitions rd on rd.id = rp.role_id
    where rd.slug = 'platform_owner'
      and rp.permission_action = 'project.campaigns.manage'
  ) then
    raise exception 'platform_owner role is missing required project.campaigns.manage capability';
  end if;
end
$$;

-- Internal capability predicate used by SECURITY DEFINER discovery/access RPCs.
-- Direct browser execution is intentionally denied so it cannot become a
-- capability oracle. Exact action + active temporal grant + exact physical scope
-- are required; project/tda is the only project scope that may cover campaigns.
create or replace function public.has_profile_campaign_capability(
  p_profile_id uuid,
  p_campaign_slug text,
  p_action text,
  p_at timestamptz default statement_timestamp()
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    p_profile_id is not null
    and p_campaign_slug is not null
    and p_action is not null
    and exists (
      select 1
      from public.role_assignments assignment
      join public.role_permissions permission
        on permission.role_id = assignment.role_id
      where assignment.profile_id = p_profile_id
        and permission.permission_action = p_action
        and assignment.status = 'active'
        and assignment.starts_at <= p_at
        and (assignment.ends_at is null or assignment.ends_at > p_at)
        and (
          (
            assignment.scope_type = 'campaign'
            and assignment.scope_id = p_campaign_slug
          )
          or (
            assignment.scope_type = 'project'
            and assignment.scope_id = 'tda'
          )
        )
    );
$$;

revoke all on function public.has_profile_campaign_capability(
  uuid, text, text, timestamptz
) from public;
revoke execute on function public.has_profile_campaign_capability(
  uuid, text, text, timestamptz
) from anon;
revoke execute on function public.has_profile_campaign_capability(
  uuid, text, text, timestamptz
) from authenticated;
grant execute on function public.has_profile_campaign_capability(
  uuid, text, text, timestamptz
) to service_role;

-- Public campaign discovery is a deliberately tiny projection. It reveals no
-- UUID, technical slug, metadata, grants or membership. Archived/private rows
-- are indistinguishable from absent rows through this RPC.
create or replace function public.campaign_public_directory()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'routeKey', campaign.public_slug,
        'name', campaign.name,
        'description', campaign.description
      )
      order by campaign.name, campaign.public_slug
    ),
    '[]'::jsonb
  )
  from public.campaigns campaign
  where campaign.lifecycle = 'active'
    and campaign.visibility = 'public';
$$;

revoke all on function public.campaign_public_directory() from public;
grant execute on function public.campaign_public_directory() to anon;
grant execute on function public.campaign_public_directory() to authenticated;
grant execute on function public.campaign_public_directory() to service_role;

-- Authenticated operational discovery is governed by the exact
-- campaign.edit.access capability. Project grants count only on project/tda and
-- only when their role contains that exact action. Archived campaigns may remain
-- visible to an authorized actor for historical navigation; mutation guards
-- remain separate.
create or replace function public.campaign_edit_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_profile_id uuid;
  v_now timestamptz := statement_timestamp();
begin
  if v_auth_user_id is null then
    return '[]'::jsonb;
  end if;

  select profile.id
  into v_profile_id
  from public.profiles profile
  where profile.auth_user_id = v_auth_user_id
  limit 1;

  if v_profile_id is null then
    return '[]'::jsonb;
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', campaign.id,
          'technicalSlug', campaign.slug,
          'routeKey', campaign.public_slug,
          'name', campaign.name,
          'lifecycle', campaign.lifecycle,
          'visibility', campaign.visibility
        )
        order by campaign.name, campaign.slug
      )
      from public.campaigns campaign
      where public.has_profile_campaign_capability(
        v_profile_id,
        campaign.slug,
        'campaign.edit.access',
        v_now
      )
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.campaign_edit_directory() from public;
revoke execute on function public.campaign_edit_directory() from anon;
grant execute on function public.campaign_edit_directory() to authenticated;
grant execute on function public.campaign_edit_directory() to service_role;

-- The legacy claim RPCs do not have a campaign-scoped invite/eligibility
-- proof. Until that model exists, they are server-only: browser callers cannot
-- bypass the hardened directory by posting a target_profile_id directly, and
-- review cannot continue to authorize by owner/master role names.
do $$
begin
  if to_regprocedure(
    'public.submit_profile_claim(text,uuid,text,text,text,text,text[],text)'
  ) is not null then
    execute 'revoke all on function public.submit_profile_claim(text,uuid,text,text,text,text,text[],text) from public';
    execute 'revoke execute on function public.submit_profile_claim(text,uuid,text,text,text,text,text[],text) from anon';
    execute 'revoke execute on function public.submit_profile_claim(text,uuid,text,text,text,text,text[],text) from authenticated';
    execute 'grant execute on function public.submit_profile_claim(text,uuid,text,text,text,text,text[],text) to service_role';
  end if;

  if to_regprocedure(
    'public.review_profile_claim(uuid,text,text)'
  ) is not null then
    execute 'revoke all on function public.review_profile_claim(uuid,text,text) from public';
    execute 'revoke execute on function public.review_profile_claim(uuid,text,text) from anon';
    execute 'revoke execute on function public.review_profile_claim(uuid,text,text) from authenticated';
    execute 'grant execute on function public.review_profile_claim(uuid,text,text) to service_role';
  end if;
end
$$;

-- access_directory is a campaign people/onboarding surface, not campaign
-- discovery. A caller must already be authenticated, linked to a profile and
-- hold campaign.read or campaign.access.manage for the requested technical
-- slug. Missing, private-to-the-caller and archived targets all fail with the
-- same opaque response. Global unlinked profiles are no longer enumerable.
create or replace function public.access_directory(
  campaign_slug text default 'yuhara-main'::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  viewer_auth uuid := auth.uid();
  campaign_row public.campaigns%rowtype;
  viewer_profile public.profiles%rowtype;
  viewer_role text;
  can_read boolean := false;
  can_manage boolean := false;
  profile_list jsonb := '[]'::jsonb;
  character_list jsonb := '[]'::jsonb;
  claim_list jsonb := '[]'::jsonb;
begin
  if viewer_auth is null
     or campaign_slug is null
     or campaign_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select *
  into viewer_profile
  from public.profiles
  where auth_user_id = viewer_auth
  limit 1;

  if viewer_profile.id is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select *
  into campaign_row
  from public.campaigns
  where slug = campaign_slug
    and lifecycle = 'active'
  limit 1;

  if campaign_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  can_manage := public.has_profile_campaign_capability(
    viewer_profile.id,
    campaign_row.slug,
    'campaign.access.manage',
    statement_timestamp()
  );
  can_read := can_manage or public.has_profile_campaign_capability(
    viewer_profile.id,
    campaign_row.slug,
    'campaign.read',
    statement_timestamp()
  );

  if not can_read then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select member.role
  into viewer_role
  from public.campaign_members member
  where member.campaign_id = campaign_row.id
    and member.profile_id = viewer_profile.id
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', profile.id,
        'displayName', profile.display_name,
        'roll20Name', profile.roll20_name,
        'discordId',
          case
            when can_manage or profile.auth_user_id = viewer_auth
              then profile.discord_id
            else null
          end,
        'discordHandle',
          case
            when can_manage or profile.auth_user_id = viewer_auth
              then profile.discord_handle
            else null
          end,
        'defaultCharacterName', profile.default_character_name,
        'linked', profile.auth_user_id is not null,
        'isCurrentUser', profile.auth_user_id = viewer_auth,
        'role', member.role
      )
      order by
        case member.role
          when 'owner' then 0
          when 'master' then 1
          when 'player' then 2
          when 'reviewer' then 3
          when 'viewer' then 4
          else 5
        end,
        profile.display_name
    ),
    '[]'::jsonb
  )
  into profile_list
  from public.campaign_members member
  join public.profiles profile on profile.id = member.profile_id
  where member.campaign_id = campaign_row.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', character.id,
        'profileId', character.profile_id,
        'characterName', character.character_name,
        'aliases', character.aliases,
        'status', character.status,
        'approvedAt', character.approved_at
      )
      order by character.character_name
    ),
    '[]'::jsonb
  )
  into character_list
  from public.profile_characters character
  join public.campaign_members member
    on member.campaign_id = campaign_row.id
   and member.profile_id = character.profile_id
  where character.campaign_id = campaign_row.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', claim.id,
        'status', claim.status,
        'createdAt', claim.created_at,
        'reviewedAt', claim.reviewed_at,
        'requesterEmail',
          case
            when can_manage or claim.requester_auth_user_id = viewer_auth
              then claim.requester_email
            else null
          end,
        'requesterName', claim.requester_name,
        'targetProfileId', claim.target_profile_id,
        'requestedDisplayName', claim.requested_display_name,
        'requestedRoll20Name', claim.requested_roll20_name,
        'requestedDiscordId',
          case
            when can_manage or claim.requester_auth_user_id = viewer_auth
              then claim.requested_discord_id
            else null
          end,
        'requestedDiscordHandle',
          case
            when can_manage or claim.requester_auth_user_id = viewer_auth
              then claim.requested_discord_handle
            else null
          end,
        'requestedCharacterNames', claim.requested_character_names,
        'playerNote',
          case
            when can_manage or claim.requester_auth_user_id = viewer_auth
              then claim.player_note
            else null
          end,
        'reviewNote', claim.review_note
      )
      order by claim.created_at desc
    ),
    '[]'::jsonb
  )
  into claim_list
  from public.profile_claims claim
  where claim.campaign_id = campaign_row.id
    and (
      can_manage
      or claim.requester_auth_user_id = viewer_auth
    );

  return jsonb_build_object(
    'ok', true,
    'campaign', jsonb_build_object(
      'id', campaign_row.id,
      'slug', campaign_row.slug,
      'name', campaign_row.name
    ),
    'viewer', jsonb_build_object(
      'authenticated', true,
      'profileId', viewer_profile.id,
      'displayName', viewer_profile.display_name,
      'campaignRole', viewer_role,
      'canManageAccess', can_manage
    ),
    'profiles', profile_list,
    'characters', character_list,
    'claims', claim_list,
    'rules', jsonb_build_object(
      'playerCanRequest', false,
      'inviteRequiredForUnlinked', true,
      'dmApprovesFinalLink', true,
      'dmCanOverride', can_manage,
      'canonApprover', 'dm'
    )
  );
end;
$$;

revoke all on function public.access_directory(text) from public;
revoke execute on function public.access_directory(text) from anon;
grant execute on function public.access_directory(text) to authenticated;
grant execute on function public.access_directory(text) to service_role;

comment on function public.has_profile_campaign_capability(
  uuid, text, text, timestamptz
) is
'Internal #1134 exact-capability resolver for campaign scopes and project/tda. Browser EXECUTE is revoked so it cannot be used as a capability oracle.';

comment on function public.campaign_public_directory() is
'Public #1134 campaign discovery projection. Returns only active/public route key, name and description; private/archived campaigns are not enumerable.';

comment on function public.campaign_edit_directory() is
'Authenticated #1134 operational campaign discovery. Returns only campaigns with active effective campaign.edit.access for the current profile; raw grants are never returned.';

comment on function public.access_directory(text) is
'Hardened #1134 campaign people/onboarding directory. Requires current profile plus campaign.read or campaign.access.manage, denies archived/missing/unauthorized targets opaquely, and no longer enumerates global unlinked profiles.';

commit;
