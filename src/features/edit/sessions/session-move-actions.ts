"use server";

import { revalidatePath } from "next/cache";
import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import { authorizeCampaignCapability, EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import {
	type SessionCampaignMoveRequest,
	validateSessionCampaignMoveRequest,
} from "./session-move-model";
import {
	persistSessionCampaignMove,
	preflightSessionCampaignMove,
} from "./session-move-repository";

async function authorizeMove(input: Omit<SessionCampaignMoveRequest, "operationId">) {
	const identity = await getVerifiedServerIdentity();
	if (!identity.ok) return { ok: false as const, reason: identity.reason };
	const context = await loadEditAccessContext(identity.authUserId);
	if (!context) return { ok: false as const, reason: "dependency_unavailable" as const };
	for (const campaignSlug of [input.sourceCampaignSlug, input.destinationCampaignSlug]) {
		const access = authorizeCampaignCapability(
			context,
			EDIT_CAPABILITIES.contentEdit,
			campaignSlug,
		);
		if (!access.ok) return { ok: false as const, reason: access.reason };
	}
	if (!context.profileId) return { ok: false as const, reason: "profile_unresolved" as const };
	return { ok: true as const, profileId: context.profileId };
}

export async function preflightSessionCampaignMoveAction(
	input: Omit<SessionCampaignMoveRequest, "operationId">,
) {
	const issues = validateSessionCampaignMoveRequest({
		...input,
		operationId: "11111111-1111-4111-8111-111111111111",
	}).filter((issue) => issue !== "operation_id");
	if (issues.length) return { ok: false as const, reason: "validation" as const, issues };
	const access = await authorizeMove(input);
	if (!access.ok) return access;
	return preflightSessionCampaignMove(input);
}

export async function moveSessionCampaignAction(input: SessionCampaignMoveRequest) {
	const issues = validateSessionCampaignMoveRequest(input);
	if (issues.length) return { ok: false as const, reason: "validation" as const, issues };
	const access = await authorizeMove(input);
	if (!access.ok) return access;
	const result = await persistSessionCampaignMove(access.profileId, input);
	if (!result.ok) return result;
	let cachePending = false;
	for (const path of [
		"/edit/sessoes",
		"/edit/" + encodeURIComponent(input.sourceCampaignSlug) + "/sessoes",
		"/edit/" + encodeURIComponent(input.destinationCampaignSlug) + "/sessoes",
		"/sessoes",
		"/campanhas",
	]) {
		try { revalidatePath(path); } catch { cachePending = true; }
	}
	return { ...result, cachePending };
}
