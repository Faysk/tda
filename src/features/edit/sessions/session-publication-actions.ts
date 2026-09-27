"use server";

import { revalidatePath } from "next/cache";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import {
	readSessionEditorialDraft,
} from "./editorial-draft-repository";
import { sessionDraftReadiness } from "./editorial-draft-model";
import {
	type SessionPublicationRequest,
	validateSessionPublicationRequest,
} from "./session-publication-model";
import {
	persistSessionPublication,
	prepareSessionCoverForPublication,
	readSessionPublicationContext,
} from "./session-publication-repository";

export async function publishSessionEditorialDraftAction(
	request: SessionPublicationRequest,
) {
	const issues = validateSessionPublicationRequest(request);
	if (issues.length)
		return {
			ok: false as const,
			reason: "validation" as const,
			issues,
		};

	const access = await authorizeCampaignCapabilityServer({
		action: EDIT_CAPABILITIES.sessionPublish,
		campaignSlug: CAMPAIGN_SLUG,
	});
	if (!access.ok) return { ok: false as const, reason: access.reason };

	try {
		const draft = await readSessionEditorialDraft(request.sessionId);
		if (
			!draft ||
			!draft.draftId ||
			draft.draftId !== request.draftId ||
			draft.revision < 1
		) {
			return { ok: false as const, reason: "draft_changed" as const };
		}
		if (draft.transcriptChanged)
			return { ok: false as const, reason: "transcript_changed" as const };

		const missing = sessionDraftReadiness(draft);
		if (missing.length)
			return {
				ok: false as const,
				reason: "not_ready" as const,
				missing,
			};

		const context = await readSessionPublicationContext(request.sessionId);
		if (!context)
			return { ok: false as const, reason: "not_found" as const };

		const publicCoverUrl = await prepareSessionCoverForPublication({
			sessionId: request.sessionId,
			campaignId: context.campaignId,
			coverReference: draft.coverAssetId,
		});
		if (!publicCoverUrl)
			return { ok: false as const, reason: "cover_unverified" as const };

		const committed = await persistSessionPublication({
			actorProfileId: access.profileId,
			request,
			publicCoverUrl,
		});
		if (!committed.ok)
			return { ok: false as const, reason: committed.reason };

		const current = await readSessionPublicationContext(request.sessionId);
		if (
			!current ||
			current.currentPublicationId !== committed.publicationId ||
			current.currentVersion !== committed.version
		) {
			return {
				ok: false as const,
				reason: "readback_unavailable" as const,
				receipt: committed,
			};
		}

		let cachePending = false;
		const paths = [
			"/",
			"/sessoes",
			current.sourceSessionId
				? "/sessoes/" + encodeURIComponent(current.sourceSessionId)
				: null,
			"/edit/sessoes",
			"/edit/sessoes/" + encodeURIComponent(request.sessionId),
		].filter((path): path is string => Boolean(path));
		for (const path of paths) {
			try {
				revalidatePath(path);
			} catch {
				cachePending = true;
			}
		}

		return {
			ok: true as const,
			receipt: {
				publicationId: committed.publicationId,
				version: committed.version,
				previousPublicationId: committed.previousPublicationId,
				payloadSha256: committed.payloadSha256,
				replayed: committed.replayed,
				cachePending,
			},
		};
	} catch (error) {
		console.error(
			"[edit] session publication failed",
			error instanceof Error ? error.name : "unknown_error",
		);
		return {
			ok: false as const,
			reason: "dependency_unavailable" as const,
		};
	}
}
