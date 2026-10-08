import "server-only";
import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "../access/repository";
import { queryPermissions, type PermissionsRequest } from "./query";
import { readPermissionsDirectory } from "./repository";
import { readAuthorizedCampaignRoutes, resolveAuthorizedCampaignReference } from "@/features/campaigns/authorized-routes";
import { EDIT_CAPABILITIES } from "../access/policy";
import type { PermissionsResult } from "./model";

export async function getPermissionsForEdit(
	request: PermissionsRequest,
): Promise<PermissionsResult> {
	try {
		const identity = await getVerifiedServerIdentity();
		if (!identity.ok) return identity;
		return await queryPermissions(identity.authUserId, request, {
			resolveCampaignReference: async (context, reference) => {
				const eligible = await readAuthorizedCampaignRoutes(context, EDIT_CAPABILITIES.permissionsManage);
				if (!eligible.ok) throw new Error("Campaign directory unavailable");
				return resolveAuthorizedCampaignReference(eligible.campaigns, reference)?.technicalSlug ?? reference;
			},
			resolveAccessContext: loadEditAccessContext,
			readDirectory: readPermissionsDirectory,
		});
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}
