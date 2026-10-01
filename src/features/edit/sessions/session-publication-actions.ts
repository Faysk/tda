"use server";

import { revalidatePath } from "next/cache";
import { authorizeCampaignCapabilityServer } from "@/features/auth/server";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { readSessionEditorialDraft } from "./editorial-draft-repository";
import { resolveEditSessionCampaign } from "./repository";
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
		"/edit/sessoes/" + encodeURIComponent(sessionId),
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

	let sessionCampaign: Awaited<ReturnType<typeof resolveEditSessionCampaign>>;
	try {
		sessionCampaign = await resolveEditSessionCampaign(request.sessionId);
	} catch {
		return { ok: false as const, reason: "dependency_unavailable" as const };
	}
	if (!sessionCampaign || sessionCampaign.lifecycle !== "active")
		return { ok: false as const, reason: "not_found" as const };

	const access = await authorizeCampaignCapabilityServer({
		action: EDIT_CAPABILITIES.sessionPublish,
		campaignSlug: sessionCampaign.technicalSlug,
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
			const current = await readSessionPublicationContext(request.sessionId, sessionCampaign.technicalSlug);
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
						request.sessionId,
						current.sourceSessionId,
					),
				},
			};
		}

		const draft = await readSessionEditorialDraft(request.sessionId, sessionCampaign.technicalSlug);
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

		const context = await readSessionPublicationContext(request.sessionId, sessionCampaign.technicalSlug);
		if (!context)
			return { ok: false as const, reason: "not_found" as const };

		const publicCoverUrl = await prepareSessionCoverForPublication({
			sessionId: request.sessionId,
			campaignId: context.campaignId,
			campaignSlug: sessionCampaign.technicalSlug,
			coverReference: draft.coverAssetId,
		});
		if (!publicCoverUrl)
			return { ok: false as const, reason: "cover_unverified" as const };

		const committed = await persistSessionPublication({
			actorProfileId: access.profileId,
			campaignSlug: sessionCampaign.technicalSlug,
			request,
			publicCoverUrl,
		});
		if (!committed.ok)
			return { ok: false as const, reason: committed.reason };

		const current = await readSessionPublicationContext(request.sessionId, sessionCampaign.technicalSlug);
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
