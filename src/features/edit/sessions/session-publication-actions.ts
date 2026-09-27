"use server";

import { revalidatePath } from "next/cache";
import { getVerifiedServerIdentity } from "@/features/auth/server";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import {
	readSessionEditorialDraft,
} from "./editorial-draft-repository";
import { sessionDraftReadiness } from "./editorial-draft-model";
import {
	type SessionPublicationRequest,
	type SessionPublicationResult,
	validSessionPublicationRequest,
} from "./session-publication-model";
import {
	commitSessionEditorialPublication,
	prepareSessionPublicationCover,
	readSessionPublicationState,
} from "./session-publication-repository";

export async function publishSessionEditorialDraftAction(
	request: SessionPublicationRequest,
): Promise<SessionPublicationResult> {
	if (!validSessionPublicationRequest(request))
		return { ok: false, reason: "validation" };
	if (process.env.VERCEL_ENV !== "production")
		return { ok: false, reason: "not_production" };

	const identity = await getVerifiedServerIdentity();
	if (!identity.ok) return { ok: false, reason: identity.reason };

	try {
		const context = await loadEditAccessContext(identity.authUserId);
		if (!context)
			return { ok: false, reason: "dependency_unavailable" };
		const access = authorizeCampaignCapability(
			context,
			EDIT_CAPABILITIES.transcriptPublish,
			CAMPAIGN_SLUG,
		);
		if (!access.ok) return { ok: false, reason: access.reason };

		const draft = await readSessionEditorialDraft(request.sessionId);
		if (!draft || !draft.draftId || draft.draftId !== request.draftId)
			return { ok: false, reason: "draft_stale" };
		if (draft.transcriptChanged)
			return { ok: false, reason: "transcript_stale" };
		if (sessionDraftReadiness(draft).length)
			return { ok: false, reason: "draft_incomplete" };

		let cover: { assetId: string | null; publicUrl: string };
		try {
			cover = await prepareSessionPublicationCover(
				request.sessionId,
				draft.coverAssetId,
			);
		} catch {
			return { ok: false, reason: "cover_not_verified" };
		}

		const committed = await commitSessionEditorialPublication({
			authUserId: identity.authUserId,
			actorProfileId: access.profileId,
			request,
			coverAssetId: cover.assetId,
			coverImageUrl: cover.publicUrl,
		});
		if (!committed.ok) {
			const state =
				committed.reason === "conflict"
					? await readSessionPublicationState(request.sessionId)
					: undefined;
			return { ...committed, ...(state !== undefined ? { state } : {}) };
		}

		const state = await readSessionPublicationState(request.sessionId);
		if (
			!state ||
			state.currentPublicationId !== committed.publicationId ||
			state.version === null ||
			state.payloadSha256 !== committed.payloadSha256 ||
			state.sessionStatus !== "published"
		)
			return { ok: false, reason: "dependency_unavailable" };

		revalidatePath("/");
		revalidatePath("/sessoes");
		revalidatePath("/sessoes/" + encodeURIComponent(state.sourceSessionId));

		return {
			ok: true,
			replayed: committed.replayed,
			operationId: request.operationId,
			publicationId: committed.publicationId,
			previousPublicationId: committed.previousPublicationId,
			version: state.version,
			payloadSha256: committed.payloadSha256,
			state,
		};
	} catch {
		console.error(
			"[edit] session publication failed",
			request.operationId,
		);
		return { ok: false, reason: "dependency_unavailable" };
	}
}
