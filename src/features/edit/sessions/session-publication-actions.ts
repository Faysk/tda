"use server";

import { revalidatePath } from "next/cache";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { readSessionEditorialDraft } from "./editorial-draft-repository";
import { sessionDraftReadiness } from "./editorial-draft-model";
import {
	type SessionPublicationRequest,
	validateSessionPublicationRequest,
} from "./session-publication-model";
import {
	persistSessionPublication,
	prepareSessionCoverForPublication,
	readCommittedSessionPublication,
	readSessionPublicationContext,
} from "./session-publication-repository";

function invalidateSessionPublicationPaths(
	campaignSlug: string,
	sessionId: string,
	sourceSessionId: string | null,
): boolean {
	let cachePending = false;
	const paths = [
		"/",
		"/sessoes",
		sourceSessionId
			? "/sessoes/" + encodeURIComponent(sourceSessionId)
			: null,
		"/edit/sessoes",
		"/edit/" + encodeURIComponent(campaignSlug) + "/sessoes",
		sourceSessionId
			? "/edit/" +
				encodeURIComponent(campaignSlug) +
				"/sessoes/" +
				encodeURIComponent(sourceSessionId)
			: null,
	].filter((path): path is string => Boolean(path));

	for (const path of paths) {
		try {
			revalidatePath(path);
		} catch {
			cachePending = true;
		}
	}
	return cachePending;
}

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
		campaignSlug: request.campaignSlug,
	});
	if (!access.ok) return { ok: false as const, reason: access.reason };

	try {
		// Recover a durable COMMIT before consulting mutable draft/current pointers.
		// This is what makes a lost-response retry idempotent even if another editor
		// saved or published something newer in the meantime.
		const recovered = await readCommittedSessionPublication({
			actorProfileId: access.profileId,
			request,
		});
		if (recovered?.ok === false)
			return { ok: false as const, reason: recovered.reason };
		if (recovered?.ok) {
			const current = await readSessionPublicationContext(
				request.campaignSlug,
				request.sessionId,
			);
			if (!current)
				return { ok: false as const, reason: "readback_unavailable" as const };
			const currentlyActive =
				current.currentPublicationId === recovered.publicationId;
			return {
				ok: true as const,
				receipt: {
					publicationId: recovered.publicationId,
					version: recovered.version,
					previousPublicationId: recovered.previousPublicationId,
					payloadSha256: recovered.payloadSha256,
					replayed: true,
					currentlyActive,
					cachePending: invalidateSessionPublicationPaths(
						request.campaignSlug,
						request.sessionId,
						current.sourceSessionId,
					),
				},
			};
		}

		const draft = await readSessionEditorialDraft(
			request.campaignSlug,
			request.sessionId,
		);
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

		const context = await readSessionPublicationContext(
			request.campaignSlug,
			request.sessionId,
		);
		if (!context)
			return { ok: false as const, reason: "not_found" as const };

		const publicCoverUrl = await prepareSessionCoverForPublication({
			campaignSlug: request.campaignSlug,
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

		const current = await readSessionPublicationContext(
			request.campaignSlug,
			request.sessionId,
		);
		if (!current) {
			return {
				ok: false as const,
				reason: "readback_unavailable" as const,
				receipt: committed,
			};
		}

		const currentlyActive =
			current.currentPublicationId === committed.publicationId;
		if (!committed.replayed && !currentlyActive) {
			return {
				ok: false as const,
				reason: "readback_unavailable" as const,
				receipt: committed,
			};
		}

		return {
			ok: true as const,
			receipt: {
				publicationId: committed.publicationId,
				version: committed.version,
				previousPublicationId: committed.previousPublicationId,
				payloadSha256: committed.payloadSha256,
				replayed: committed.replayed,
				currentlyActive,
				cachePending: invalidateSessionPublicationPaths(
					request.campaignSlug,
					request.sessionId,
					current.sourceSessionId,
				),
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
