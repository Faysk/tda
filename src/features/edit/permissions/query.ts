import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	isEffectiveCampaignGrant,
	type EditAccessContext,
} from "../access/policy";
import type { PermissionsDirectory, PermissionsResult } from "./model";

export type PermissionsRequest = Readonly<{ campaignSlug: string }>;
export type PermissionsQueryDependencies = Readonly<{
	resolveCampaignReference?: (context: EditAccessContext, reference: string) => Promise<string>;
	resolveAccessContext: (
		authUserId: string,
	) => Promise<EditAccessContext | null>;
	readDirectory: (
		campaignSlug: string,
		actorProfileId: string,
		actorEffectiveActions: readonly string[],
	) => Promise<PermissionsDirectory | null>;
}>;

/** authUserId is supplied only by the verified server identity, never request input. */
export async function queryPermissions(
	authUserId: string | null,
	request: PermissionsRequest,
	dependencies: PermissionsQueryDependencies,
): Promise<PermissionsResult> {
	if (!authUserId) return { ok: false, reason: "unauthenticated" };
	if (!/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u.test(request.campaignSlug))
		return { ok: false, reason: "validation" };

	try {
		const context = await dependencies.resolveAccessContext(authUserId);
		if (!context || context.authUserId !== authUserId)
			return { ok: false, reason: "dependency_unavailable" };
		if (!context.profileId) return { ok: false, reason: "profile_unresolved" };
		const campaignSlug = dependencies.resolveCampaignReference
			? await dependencies.resolveCampaignReference(context, request.campaignSlug)
			: request.campaignSlug;
		const access = authorizeCampaignCapability(
			context,
			EDIT_CAPABILITIES.permissionsManage,
			campaignSlug,
		);
		if (!access.ok) return { ok: false, reason: access.reason };

		const now = new Date();
		const actorEffectiveActions = [
			...new Set(
				context.grants
					.filter((grant) =>
						isEffectiveCampaignGrant(grant, campaignSlug, now),
					)
					.map((grant) => grant.action),
			),
		].sort();

		const value = await dependencies.readDirectory(
			campaignSlug,
			access.profileId,
			actorEffectiveActions,
		);
		if (!value) return { ok: false, reason: "not_found" };
		if (
			value.campaign.slug !== campaignSlug ||
			value.actorProfileId !== access.profileId
		)
			return { ok: false, reason: "dependency_unavailable" };
		return { ok: true, value };
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}
