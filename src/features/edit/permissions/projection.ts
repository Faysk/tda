import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	isEffectiveCampaignGrant,
} from "../access/policy";
import {
	SENSITIVE_PERMISSION_ACTIONS,
	type PermissionAuditEvent,
	type PermissionOrigin,
	type PermissionPerson,
	type PermissionRoleDefinition,
	type PermissionsDirectory,
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
	updated_at: string;
}>;
export type ProfileRow = Readonly<{
	id: string;
	display_name: string;
	auth_user_id: string | null;
	discord_id: string | null;
}>;
export type RoleRow = Readonly<{
	id: string;
	name: string;
	slug: string;
	description: string;
	plane: string;
	is_system: boolean;
}>;
export type RolePermissionRow = Readonly<{
	role_id: string;
	permission_action: string;
}>;
export type RevisionRow = Readonly<{
	profile_id: string;
	revision: number;
}>;
export type AuditRow = Readonly<{
	id: string;
	actor_id: string | null;
	action: string;
	new_value: unknown;
	created_at: string;
}>;

function isObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textField(value: unknown, key: string): string | null {
	if (!isObject(value)) return null;
	const field = value[key];
	return typeof field === "string" && field ? field : null;
}

function assignmentCoversCampaign(
	assignment: AssignmentRow,
	campaignSlug: string,
): boolean {
	return (
		(assignment.scope_type === "campaign" &&
			assignment.scope_id === campaignSlug) ||
		(assignment.scope_type === "project" && assignment.scope_id === "tda")
	);
}

export function projectPermissionsDirectory(
	input: Readonly<{
		campaign: { slug: string; name: string };
		assignments: readonly AssignmentRow[];
		profiles: readonly ProfileRow[];
		roles: readonly RoleRow[];
		permissions: readonly RolePermissionRow[];
		memberProfileIds: readonly string[];
		revisions: readonly RevisionRow[];
		audits: readonly AuditRow[];
		actorProfileId: string;
		actorEffectiveActions: readonly string[];
		now: Date;
	}>,
): PermissionsDirectory {
	const roleNames = new Map(input.roles.map((role) => [role.id, role]));
	const profileMap = new Map(input.profiles.map((profile) => [profile.id, profile]));
	const memberProfileIds = new Set(input.memberProfileIds);
	const actorActions = new Set(input.actorEffectiveActions);
	const revisionByProfile = new Map(
		input.revisions.map((revision) => [revision.profile_id, revision.revision]),
	);
	const actionsByRole = new Map<string, string[]>();

	for (const permission of input.permissions) {
		const actions = actionsByRole.get(permission.role_id) ?? [];
		actions.push(permission.permission_action);
		actionsByRole.set(permission.role_id, actions);
	}
	for (const actions of actionsByRole.values()) actions.sort();

	const people: PermissionPerson[] = [];
	for (const profile of input.profiles) {
		const assignments = input.assignments.filter(
			(assignment) =>
				assignment.profile_id === profile.id &&
				assignmentCoversCampaign(assignment, input.campaign.slug),
		);
		if (!assignments.length && !memberProfileIds.has(profile.id)) continue;

		const capabilities = new Map<string, PermissionOrigin[]>();
		const roles = assignments.map(
			(assignment): PermissionPerson["roles"][number] => {
				const role = roleNames.get(assignment.role_id);
				if (!role) throw new Error("Permissions role missing");
				const actions = actionsByRole.get(assignment.role_id) ?? [];
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
							roleName: role.name,
							scopeType,
							scopeId: assignment.scope_id,
						});
					capabilities.set(action, origins);
				}

				return {
					id: assignment.id,
					roleId: assignment.role_id,
					name: role.name,
					slug: role.slug,
					actions,
					scopeType,
					scopeId: assignment.scope_id,
					status: assignment.status,
					startsAt: assignment.starts_at,
					endsAt: assignment.ends_at,
					updatedAt: assignment.updated_at,
					active,
				};
			},
		);

		people.push({
			id: profile.id,
			displayName: profile.display_name,
			authLinked: Boolean(profile.auth_user_id),
			discordLinked: Boolean(profile.discord_id),
			campaignMember: memberProfileIds.has(profile.id),
			isCurrentActor: profile.id === input.actorProfileId,
			revision: revisionByProfile.get(profile.id) ?? 0,
			roles,
			verifiedEditAccess: [...capabilities]
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([action, origins]) => ({ action, origins })),
		});
	}
	people.sort((a, b) =>
		a.displayName.localeCompare(b.displayName, "pt-BR", { sensitivity: "base" }),
	);

	const roleCatalog: PermissionRoleDefinition[] = input.roles
		.map((role) => {
			const actions = actionsByRole.get(role.id) ?? [];
			const projectScoped = actions.some((action) => action.startsWith("project."));
			const missingSensitive = actions.filter(
				(action) =>
					(SENSITIVE_PERMISSION_ACTIONS as readonly string[]).includes(action) &&
					!actorActions.has(action),
			);
			const sensitive = actions.some((action) =>
				(SENSITIVE_PERMISSION_ACTIONS as readonly string[]).includes(action),
			);
			const peopleCount = people.filter((person) =>
				person.roles.some(
					(assignment) => assignment.roleId === role.id && assignment.active,
				),
			).length;
			const delegable = !projectScoped && missingSensitive.length === 0;
			return {
				id: role.id,
				name: role.name,
				slug: role.slug,
				description: role.description,
				plane: role.plane,
				isSystem: role.is_system,
				actions,
				peopleCount,
				delegable,
				delegationReason: projectScoped
					? "Função contém autoridade de projeto e não pode ser concedida no escopo da campanha."
					: missingSensitive.length
						? "Sua autoridade atual não permite delegar todas as ações sensíveis desta função."
						: null,
				sensitive,
			};
		})
		.sort((a, b) =>
			a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
		);

	const history: PermissionAuditEvent[] = input.audits.flatMap((audit) => {
		if (
			audit.action !== "permissions.role.grant" &&
			audit.action !== "permissions.role.revoke"
		)
			return [];
		const operation = audit.action.endsWith(".grant") ? "grant" : "revoke";
		const operationId = textField(audit.new_value, "operationId");
		const targetProfileId = textField(audit.new_value, "targetProfileId");
		const roleId = textField(audit.new_value, "roleId");
		const reason = textField(audit.new_value, "reason");
		return [
			{
				id: audit.id,
				operationId,
				operation,
				actorProfileId: audit.actor_id,
				actorDisplayName:
					(audit.actor_id && profileMap.get(audit.actor_id)?.display_name) ??
					"Perfil indisponível",
				targetProfileId,
				targetDisplayName:
					(targetProfileId && profileMap.get(targetProfileId)?.display_name) ??
					"Perfil indisponível",
				roleId,
				roleName:
					(roleId && roleNames.get(roleId)?.name) ?? "Função indisponível",
				reason,
				createdAt: audit.created_at,
			},
		];
	});

	return {
		campaign: { slug: input.campaign.slug, name: input.campaign.name },
		actorProfileId: input.actorProfileId,
		people,
		roles: roleCatalog,
		history,
		checkedAt: input.now.toISOString(),
	};
}
