"use server";

import { revalidatePath } from "next/cache";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { isSessionCoverUuid } from "./session-cover-media";
import {
	commitSessionPublication,
	prepareSessionPublication,
} from "./session-publication-server";
import type { SessionPublicationCommitInput } from "./session-publication-model";

function validCommit(input: SessionPublicationCommitInput): boolean {
	return (
		isSessionCoverUuid(input.sessionId) &&
		isSessionCoverUuid(input.operationId) &&
		(input.expectedCurrentPublicationId === null ||
			isSessionCoverUuid(input.expectedCurrentPublicationId)) &&
		isSessionCoverUuid(input.draftId) &&
		Number.isSafeInteger(input.draftRevision) &&
		input.draftRevision > 0 &&
		isSessionCoverUuid(input.transcriptRevisionId) &&
		isSessionCoverUuid(input.coverAssetId)
	);
}

export async function prepareSessionPublicationAction(sessionId: string) {
	const access = await authorizeCampaignCapabilityServer({
		action: EDIT_CAPABILITIES.sessionPublish,
		campaignSlug: CAMPAIGN_SLUG,
	});
	if (!access.ok) return access;
	if (!isSessionCoverUuid(sessionId))
		return { ok: false as const, reason: "invalid_payload" as const };

	try {
		return await prepareSessionPublication(sessionId);
	} catch (error) {
		console.error(
			"Session publication preparation failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return { ok: false as const, reason: "dependency_unavailable" as const };
	}
}

export async function publishSessionEditorialDraftAction(
	input: SessionPublicationCommitInput,
) {
	const access = await authorizeCampaignCapabilityServer({
		action: EDIT_CAPABILITIES.sessionPublish,
		campaignSlug: CAMPAIGN_SLUG,
	});
	if (!access.ok) return access;
	if (!validCommit(input))
		return { ok: false as const, reason: "invalid_payload" as const };

	try {
		const result = await commitSessionPublication({
			authUserId: access.authUserId,
			profileId: access.profileId,
			commit: input,
		});
		if (!result.ok) return result;

		let cachePending = false;
		try {
			revalidatePath("/");
			revalidatePath("/sessoes");
			revalidatePath(
				"/sessoes/" + encodeURIComponent(result.sourceSessionId),
			);
		} catch (error) {
			cachePending = true;
			console.error(
				"Session publication committed but cache invalidation failed",
				error instanceof Error ? error.message : "unknown_error",
			);
		}
		return {
			ok: true as const,
			receipt: result.receipt,
			cachePending,
		};
	} catch (error) {
		console.error(
			"Session publication failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return { ok: false as const, reason: "dependency_unavailable" as const };
	}
}
