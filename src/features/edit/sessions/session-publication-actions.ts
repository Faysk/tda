"use server";

import { revalidatePath } from "next/cache";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { readSessionEditorialDraft } from "./editorial-draft-repository";
import { sessionDraftReadiness } from "./editorial-draft-model";
import { authorizeSessionCampaignTarget } from "./session-campaign-access";
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

function invalidateSessionPublicationPaths(input: {
	sessionId: string;
	sourceSessionId: string | null;
	campaignPublicSlug: string;
	campaignTechnicalSlug: string;
}): boolean {
	let cachePending = false;
	const publicCampaignRoot =
		"/campanhas/" + encodeURIComponent(input.campaignPublicSlug) + "/sessoes";
	const paths = [
		"/",
		"/campanhas",
		"/campanhas/sessoes",
		publicCampaignRoot,
		input.sourceSessionId
			? publicCampaignRoot + "/" + encodeURIComponent(input.sourceSessionId)
			: null,
		// Legacy/default aliases stay valid for the original campaign. Revalidating
		// them for another campaign is harmless and avoids stale compatibility
		// caches while the route migration in #1136 remains in flight.
		"/sessoes",
		input.sourceSessionId
			? "/sessoes/" + encodeURIComponent(input.sourceSessionId)
			: null,
		"/edit/sessoes",
		"/edit/sessoes/" + encodeURIComponent(input.sessionId),
		"/edit/" +
			encodeURIComponent(input.campaignTechnicalSlug) +
			"/sessoes",
		"/edit/" +
			encodeURIComponent(input.campaignTechnicalSlug) +
			"/sessoes/" +
			encodeURIComponent(input.sessionId),
	].filter((path): path is string => Boolean(path));

	for (const path of new Set(paths)) {
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

	const access = await authorizeSessionCampaignTarget(
		request.sessionId,
		EDIT_CAPABILITIES.sessionPublish,
	);
	if (!access.ok) return { ok: false as const, reason: access.reason };

	const {
		campaignId,
		campaignTechnicalSlug,
		profileId,
	} = access.target;

	try {
		// Recover a durable COMMIT before consulting mutable draft/current pointers.
		// This is what makes a lost-response retry idempotent even if another editor
		// saved or published something newer in the meantime.
		const recovered = await readCommittedSessionPublication({
			actorProfileId: profileId,
			campaignId,
			request,
		});
		if (recovered?.ok === false)
			return { ok: false as const, reason: recovered.reason };
		if (recovered?.ok) {
			const current = await readSessionPublicationContext(
				request.sessionId,
				campaignTechnicalSlug,
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
					cachePending: invalidateSessionPublicationPaths({
						sessionId: request.sessionId,
						sourceSessionId: current.sourceSessionId,
						campaignPublicSlug: current.campaignPublicSlug,
						campaignTechnicalSlug,
					}),
				},
			};
		}

		const draft = await readSessionEditorialDraft(
			request.sessionId,
			campaignTechnicalSlug,
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
			request.sessionId,
			campaignTechnicalSlug,
		);
		if (!context)
			return { ok: false as const, reason: "not_found" as const };
		if (context.campaignId !== campaignId)
			return { ok: false as const, reason: "not_found" as const };

		const publicCoverUrl = await prepareSessionCoverForPublication({
			sessionId: request.sessionId,
			campaignId,
			campaignTechnicalSlug,
			coverReference: draft.coverAssetId,
		});
		if (!publicCoverUrl)
			return { ok: false as const, reason: "cover_unverified" as const };

		const committed = await persistSessionPublication({
			actorProfileId: profileId,
			campaignTechnicalSlug,
			request,
			publicCoverUrl,
		});
		if (!committed.ok)
			return { ok: false as const, reason: committed.reason };

		const current = await readSessionPublicationContext(
			request.sessionId,
			campaignTechnicalSlug,
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
				cachePending: invalidateSessionPublicationPaths({
					sessionId: request.sessionId,
					sourceSessionId: current.sourceSessionId,
					campaignPublicSlug: current.campaignPublicSlug,
					campaignTechnicalSlug,
				}),
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
