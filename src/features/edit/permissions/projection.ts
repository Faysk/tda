import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	isEffectiveCampaignGrant,
} from "../access/policy";
import type {
	PermissionOrigin,
	PermissionPerson,
	PermissionsDirectory,
} from "./model";

export type AssignmentRow = Readonly<{
	id: string;
	profile_id: string;
	role_id: string;
	scope_type: string;
	scope_id: string;
	status: string;
	starts_at: string;
	ends_at: string | null;
}>;
export type ProfileRow = Readonly<{
	id: string;
	display_name: string;
	auth_user_id: string | null;
	discord_id: string | null;
}>;
export type RoleRow = Readonly<{ id: string; name: string; slug: string }>;
export type RolePermissionRow = Readonly<{
	role_id: string;
	permission_action: string;
}>;

export function projectPermissionsDirectory(
	input: Readonly<{
		campaign: { slug: string; name: string };
		assignments: readonly AssignmentRow[];
		profiles: readonly ProfileRow[];
		roles: readonly RoleRow[];
		permissions: readonly RolePermissionRow[];
		now: Date;
	}>,
): PermissionsDirectory {
	const roleNames = new Map(input.roles.map((role) => [role.id, role]));
	const people: PermissionPerson[] = [];
	for (const profile of input.profiles) {
		const assignments = input.assignments.filter(
			(assignment) =>
				assignment.profile_id === profile.id &&
				((assignment.scope_type === "campaign" &&
					assignment.scope_id === input.campaign.slug) ||
					(assignment.scope_type === "project" &&
						assignment.scope_id === "tda")),
		);
		if (!assignments.length) continue;
		const capabilities = new Map<string, PermissionOrigin[]>();
		const roles = assignments.map(
			(assignment): PermissionPerson["roles"][number] => {
				const role = roleNames.get(assignment.role_id);
				if (!role) throw new Error("Permissions role missing");
				const name = role.name;
				const actions = input.permissions
					.filter((permission) => permission.role_id === assignment.role_id)
					.map((permission) => permission.permission_action)
					.sort();
				const scopeType =
					assignment.scope_type === "campaign" ? "campaign" : "project";
				const active = isEffectiveCampaignGrant(
					{
						action: "",
						scopeType,
						scopeId: assignment.scope_id,
						status: assignment.status,
						startsAt: assignment.starts_at,
						endsAt: assignment.ends_at,
					},
					input.campaign.slug,
					input.now,
				);
				for (const action of Object.values(EDIT_CAPABILITIES)) {
					if (!profile.auth_user_id) continue;
					const allowed = authorizeCampaignCapability(
						{
							authUserId: profile.auth_user_id,
							profileId: profile.id,
							grants: actions.map((permissionAction) => ({
								action: permissionAction,
								scopeType,
								scopeId: assignment.scope_id,
								status: assignment.status,
								startsAt: assignment.starts_at,
								endsAt: assignment.ends_at,
							})),
						},
						action,
						input.campaign.slug,
						input.now,
					).ok;
					if (!allowed) continue;
					const origins = capabilities.get(action) ?? [];
					if (!origins.some((origin) => origin.assignmentId === assignment.id))
						origins.push({
							assignmentId: assignment.id,
							roleSlug: role.slug,
							roleName: name,
							scopeType,
							scopeId: assignment.scope_id,
						});
					capabilities.set(action, origins);
				}
				return {
					id: assignment.id,
					name,
					slug: role.slug,
					actions,
					scopeType,
					scopeId: assignment.scope_id,
					status: assignment.status,
					startsAt: assignment.starts_at,
					endsAt: assignment.ends_at,
					active,
				};
			},
		);
		people.push({
			id: profile.id,
			displayName: profile.display_name,
			authLinked: Boolean(profile.auth_user_id),
			discordLinked: Boolean(profile.discord_id),
			roles,
			verifiedEditAccess: [...capabilities]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([action, origins]) => ({ action, origins })),
		});
	}
	return {
		campaign: { slug: input.campaign.slug, name: input.campaign.name },
		people,
		checkedAt: input.now.toISOString(),
	};
}
