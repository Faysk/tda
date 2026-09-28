import "server-only";

import { getVerifiedServerIdentity } from "@/features/auth/server";
import {
	isEffectiveCampaignGrant,
	type EditAccessContext,
} from "../access/policy";
import {
	mutatePermissions,
	type PermissionMutationReason,
} from "./mutation";
import {
	persistPermissionMutation,
	readPermissionsDirectory,
} from "./repository";
import type { PermissionsDirectory } from "./model";

export type PermissionServerMutationResult =
	| Readonly<{
			ok: true;
			status: "updated" | "replayed";
			operationId: string;
			value: PermissionsDirectory;
	  }>
	| Readonly<{
			ok: false;
			reason: PermissionMutationReason | "reconciliation_required";
			revision?: number;
			kind?: string;
			operationId?: string;
	  }>;

export async function mutatePermissionsForEdit(
	request: Omit<
		Parameters<typeof mutatePermissions>[0],
		"authUserId"
	>,
): Promise<PermissionServerMutationResult> {
	const identity = await getVerifiedServerIdentity();
	if (!identity.ok) return identity;

	let resolvedContext: EditAccessContext | null = null;
	try {
		const result = await mutatePermissions(
			{ ...request, authUserId: identity.authUserId },
			{
				resolveAccessContext: async (authUserId) => {
					resolvedContext = await loadEditAccessContext(authUserId);
					return resolvedContext;
				},
				persist: persistPermissionMutation,
			},
		);
		if (!result.ok) return result;

		if (!resolvedContext?.profileId)
			return {
				ok: false,
				reason: "reconciliation_required",
				operationId: result.operationId,
			};

		const now = new Date();
		const actorEffectiveActions = [
			...new Set(
				resolvedContext.grants
					.filter((grant) =>
						isEffectiveCampaignGrant(grant, request.campaignSlug, now),
					)
					.map((grant) => grant.action),
			),
		].sort();

		const directory = await readPermissionsDirectory(
			request.campaignSlug,
			resolvedContext.profileId,
			actorEffectiveActions,
		);
		const target = directory?.people.find(
			(person) => person.id === request.targetProfileId,
		);
		if (!directory || !target || target.revision !== result.revision)
			return {
				ok: false,
				reason: "reconciliation_required",
				operationId: result.operationId,
			};

		return {
			ok: true,
			status: result.status,
			operationId: result.operationId,
			value: directory,
		};
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}
