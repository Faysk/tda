import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "../access/policy";
import type { PermissionsDirectory, PermissionsResult } from "./model";

export type PermissionsRequest = Readonly<{ campaignSlug: string }>;
export type PermissionsQueryDependencies = Readonly<{
	resolveAccessContext: (
		authUserId: string,
	) => Promise<EditAccessContext | null>;
	readDirectory: (campaignSlug: string) => Promise<PermissionsDirectory | null>;
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
		const access = authorizeCampaignCapability(
			context,
			EDIT_CAPABILITIES.permissionsManage,
			request.campaignSlug,
		);
		if (!access.ok) return { ok: false, reason: access.reason };
		const value = await dependencies.readDirectory(request.campaignSlug);
		if (!value) return { ok: false, reason: "not_found" };
		if (value.campaign.slug !== request.campaignSlug)
			return { ok: false, reason: "dependency_unavailable" };
		return { ok: true, value };
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}
