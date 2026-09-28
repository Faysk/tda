import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "../access/policy";
import type {
	PermissionMutationChange,
	PermissionMutationPersistenceInput,
	PermissionMutationPersistenceResult,
} from "./repository";

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CAMPAIGN_SLUG_PATTERN =
	/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u;

export type PermissionMutationRequest = Readonly<{
	authUserId: string | null;
	campaignSlug: string;
	targetProfileId: unknown;
	expectedRevision: unknown;
	changes: unknown;
	operationId: unknown;
	reason?: unknown;
	confirmSensitive?: unknown;
	confirmSelfRevoke?: unknown;
}>;

export type PermissionMutationReason =
	| "unauthenticated"
	| "profile_unresolved"
	| "forbidden"
	| "validation"
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

export type PermissionMutationResult =
	| Readonly<{
			ok: true;
			status: "updated" | "replayed";
			revision: number;
			operationId: string;
	  }>
	| Readonly<{
			ok: false;
			reason: PermissionMutationReason;
			revision?: number;
			kind?: string;
	  }>;

export type PermissionMutationDependencies = Readonly<{
	resolveAccessContext: (
		authUserId: string,
	) => Promise<EditAccessContext | null>;
	persist: (
		input: PermissionMutationPersistenceInput,
	) => Promise<PermissionMutationPersistenceResult>;
}>;

function parseChanges(value: unknown): readonly PermissionMutationChange[] | null {
	if (!Array.isArray(value) || value.length < 1 || value.length > 20) return null;
	const seen = new Set<string>();
	const parsed: PermissionMutationChange[] = [];
	for (const change of value) {
		if (!change || typeof change !== "object" || Array.isArray(change)) return null;
		const row = change as Record<string, unknown>;
		if (row.operation !== "grant" && row.operation !== "revoke") return null;
		if (typeof row.roleId !== "string" || !UUID_PATTERN.test(row.roleId))
			return null;
		if (seen.has(row.roleId)) return null;
		seen.add(row.roleId);
		if (row.operation === "revoke") {
			if (
				typeof row.assignmentId !== "string" ||
				!UUID_PATTERN.test(row.assignmentId)
			)
				return null;
			parsed.push({
				operation: "revoke",
				roleId: row.roleId,
				assignmentId: row.assignmentId,
			});
		} else {
			parsed.push({ operation: "grant", roleId: row.roleId });
		}
	}
	return parsed;
}

export async function mutatePermissions(
	request: PermissionMutationRequest,
	dependencies: PermissionMutationDependencies,
): Promise<PermissionMutationResult> {
	if (!request.authUserId) return { ok: false, reason: "unauthenticated" };
	const changes = parseChanges(request.changes);
	const valid =
		CAMPAIGN_SLUG_PATTERN.test(request.campaignSlug) &&
		typeof request.targetProfileId === "string" &&
		UUID_PATTERN.test(request.targetProfileId) &&
		typeof request.operationId === "string" &&
		UUID_PATTERN.test(request.operationId) &&
		typeof request.expectedRevision === "number" &&
		Number.isSafeInteger(request.expectedRevision) &&
		request.expectedRevision >= 0 &&
		changes;
	if (!valid) return { ok: false, reason: "validation" };

	const context = await dependencies.resolveAccessContext(request.authUserId);
	if (!context || context.authUserId !== request.authUserId)
		return { ok: false, reason: "dependency_unavailable" };

	const access = authorizeCampaignCapability(
		context,
		EDIT_CAPABILITIES.permissionsManage,
		request.campaignSlug,
	);
	if (!access.ok) return { ok: false, reason: access.reason };

	const reason =
		typeof request.reason === "string" && request.reason.trim()
			? request.reason.trim().slice(0, 500)
			: null;
	const persistence = await dependencies.persist({
		campaignSlug: request.campaignSlug,
		actorProfileId: access.profileId,
		targetProfileId: request.targetProfileId,
		expectedRevision: request.expectedRevision,
		changes,
		operationId: request.operationId,
		reason,
		confirmSensitive: request.confirmSensitive === true,
		confirmSelfRevoke: request.confirmSelfRevoke === true,
	});

	if (
		(persistence.status === "updated" || persistence.status === "replayed") &&
		typeof persistence.revision === "number"
	) {
		return {
			ok: true,
			status: persistence.status,
			revision: persistence.revision,
			operationId:
				typeof persistence.operationId === "string"
					? persistence.operationId
					: request.operationId,
		};
	}

	if (persistence.status === "updated" || persistence.status === "replayed")
		return { ok: false, reason: "dependency_unavailable" };

	return {
		ok: false,
		reason: persistence.status,
		...(typeof persistence.revision === "number"
			? { revision: persistence.revision }
			: {}),
		...(persistence.kind ? { kind: persistence.kind } : {}),
	};
}
