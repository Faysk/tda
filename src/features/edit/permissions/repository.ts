import "server-only";
import { editDataClient } from "@/integrations/supabase/server";
import {
	projectPermissionsDirectory,
	type AuditRow,
	type AssignmentRow,
	type ProfileRow,
	type RevisionRow,
	type RolePermissionRow,
	type RoleRow,
} from "./projection";
import type { PermissionsDirectory } from "./model";

const MAX_ROWS = 500;
const MAX_HISTORY = 100;

function completeRows<T>(result: {
	data: T[] | null;
	error: unknown;
	count: number | null;
}): T[] {
	if (
		result.error ||
		!result.data ||
		result.count === null ||
		result.count !== result.data.length
	)
		throw new Error("Permissions snapshot unavailable or capacity exceeded");
	return result.data;
}

function boundedRows<T>(result: { data: T[] | null; error: unknown }): T[] {
	if (result.error || !result.data)
		throw new Error("Permissions bounded snapshot unavailable");
	return result.data;
}

function objectText(value: unknown, key: string): string | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === "string" && field ? field : null;
}

export type PermissionMutationChange = Readonly<{
	operation: "grant" | "revoke";
	roleId: string;
	assignmentId?: string;
}>;

export type PermissionMutationPersistenceInput = Readonly<{
	campaignSlug: string;
	actorProfileId: string;
	targetProfileId: string;
	expectedRevision: number;
	changes: readonly PermissionMutationChange[];
	operationId: string;
	reason: string | null;
	confirmSensitive: boolean;
	confirmSelfRevoke: boolean;
}>;

export type PermissionMutationPersistenceResult = Readonly<{
	status:
		| "updated"
		| "replayed"
		| "validation"
		| "forbidden"
		| "not_found"
		| "target_not_found"
		| "target_not_in_campaign"
		| "role_not_found"
		| "delegation_forbidden"
		| "confirmation_required"
		| "duplicate"
		| "assignment_not_active"
		| "last_admin"
		| "conflict"
		| "dependency_unavailable";
	revision?: number;
	kind?: string;
	operationId?: string;
}>;

/** Internal repository: call only after the permissions capability boundary. */
export async function readPermissionsDirectory(
	campaignSlug: string,
	actorProfileId: string,
	actorEffectiveActions: readonly string[],
): Promise<PermissionsDirectory | null> {
	const client = editDataClient();
	if (!client) throw new Error("Permissions data connection unavailable");

	const { data: campaign, error } = await client
		.from("campaigns")
		.select("id,slug,name")
		.eq("slug", campaignSlug)
		.maybeSingle();
	if (error) throw new Error("Permissions campaign lookup unavailable");
	if (!campaign) return null;

	const [assignmentResult, memberResult, roleResult, permissionResult, auditResult] =
		await Promise.all([
			client
				.from("role_assignments")
				.select(
					"id,profile_id,role_id,scope_type,scope_id,status,starts_at,ends_at,updated_at",
					{ count: "exact" },
				)
				.or(
					`and(scope_type.eq.campaign,scope_id.eq.${campaignSlug}),and(scope_type.eq.project,scope_id.eq.tda)`,
				)
				.order("id")
				.limit(MAX_ROWS),
			client
				.from("campaign_members")
				.select("profile_id", { count: "exact" })
				.eq("campaign_id", campaign.id)
				.order("profile_id")
				.limit(MAX_ROWS),
			client
				.from("role_definitions")
				.select("id,name,slug,description,plane,is_system", { count: "exact" })
				.order("name")
				.limit(MAX_ROWS),
			client
				.from("role_permissions")
				.select("role_id,permission_action", { count: "exact" })
				.order("role_id")
				.order("permission_action")
				.limit(MAX_ROWS),
			client
				.from("audit_log")
				.select("id,actor_id,action,new_value,created_at")
				.eq("campaign_id", campaign.id)
				.in("action", ["permissions.role.grant", "permissions.role.revoke"])
				.order("created_at", { ascending: false })
				.limit(MAX_HISTORY),
		]);

	const assignments = completeRows<AssignmentRow>(assignmentResult);
	const members = completeRows<{ profile_id: string }>(memberResult);
	const roles = completeRows<RoleRow>(roleResult);
	const permissions = completeRows<RolePermissionRow>(permissionResult);
	const audits = boundedRows<AuditRow>(auditResult);

	const profileIds = new Set<string>([
		...assignments.map((row) => row.profile_id),
		...members.map((row) => row.profile_id),
	]);
	for (const audit of audits) {
		if (audit.actor_id) profileIds.add(audit.actor_id);
		const target = objectText(audit.new_value, "targetProfileId");
		if (target) profileIds.add(target);
	}

	const ids = [...profileIds];
	const [profiles, revisions] = ids.length
		? await Promise.all([
				client
					.from("profiles")
					.select("id,display_name,auth_user_id,discord_id", { count: "exact" })
					.in("id", ids)
					.order("display_name")
					.order("id")
					.limit(MAX_ROWS)
					.then((result) => completeRows<ProfileRow>(result)),
				client
					.from("campaign_permission_revisions")
					.select("profile_id,revision", { count: "exact" })
					.eq("campaign_id", campaign.id)
					.in("profile_id", ids)
					.order("profile_id")
					.limit(MAX_ROWS)
					.then((result) => completeRows<RevisionRow>(result)),
			])
		: [[], []];

	const resolvedProfileIds = new Set(profiles.map((profile) => profile.id));
	const requiredProfileIds = new Set([
		...assignments.map((assignment) => assignment.profile_id),
		...members.map((member) => member.profile_id),
	]);
	if ([...requiredProfileIds].some((id) => !resolvedProfileIds.has(id)))
		throw new Error("Permissions snapshot changed; retry required");

	const roleIds = new Set(roles.map((role) => role.id));
	if (assignments.some((assignment) => !roleIds.has(assignment.role_id)))
		throw new Error("Permissions role reference unavailable");

	return projectPermissionsDirectory({
		campaign,
		assignments,
		profiles,
		roles,
		permissions,
		memberProfileIds: members.map((member) => member.profile_id),
		revisions,
		audits,
		actorProfileId,
		actorEffectiveActions,
		now: new Date(),
	});
}

export async function persistPermissionMutation(
	input: PermissionMutationPersistenceInput,
): Promise<PermissionMutationPersistenceResult> {
	const client = editDataClient();
	if (!client) return { status: "dependency_unavailable" };

	const { data, error } = await client.rpc("manage_campaign_role_assignments", {
		p_campaign_slug: input.campaignSlug,
		p_actor_profile_id: input.actorProfileId,
		p_target_profile_id: input.targetProfileId,
		p_expected_revision: input.expectedRevision,
		p_changes: input.changes,
		p_operation_id: input.operationId,
		p_reason: input.reason,
		p_confirm_sensitive: input.confirmSensitive,
		p_confirm_self_revoke: input.confirmSelfRevoke,
	});
	if (error || !data || typeof data !== "object" || Array.isArray(data))
		return { status: "dependency_unavailable" };

	const raw = data as Record<string, unknown>;
	const status = typeof raw.status === "string" ? raw.status : "";
	const allowed = new Set<PermissionMutationPersistenceResult["status"]>([
		"updated",
		"replayed",
		"validation",
		"forbidden",
		"not_found",
		"target_not_found",
		"target_not_in_campaign",
		"role_not_found",
		"delegation_forbidden",
		"confirmation_required",
		"duplicate",
		"assignment_not_active",
		"last_admin",
		"conflict",
	]);
	if (!allowed.has(status as PermissionMutationPersistenceResult["status"]))
		return { status: "dependency_unavailable" };

	return {
		status: status as PermissionMutationPersistenceResult["status"],
		...(typeof raw.revision === "number" &&
		Number.isSafeInteger(raw.revision) &&
		raw.revision >= 0
			? { revision: raw.revision }
			: {}),
		...(typeof raw.kind === "string" ? { kind: raw.kind } : {}),
		...(typeof raw.operationId === "string"
			? { operationId: raw.operationId }
			: {}),
	};
}
