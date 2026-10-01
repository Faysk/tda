"use server";

import { revalidatePath } from "next/cache";
import { getVerifiedServerIdentity } from "@/features/auth/server";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import {
	editSessionDetailHref,
	editSessionLibraryHref,
} from "./session-campaigns";
import {
	isSessionCampaignMoveBlocker,
	type SessionCampaignMoveCommitRequest,
	type SessionCampaignMovePreviewRequest,
	validateSessionCampaignMoveCommitRequest,
	validateSessionCampaignMovePreviewRequest,
} from "./session-campaign-move";
import {
	commitSessionCampaignMove,
	previewSessionCampaignMove,
} from "./session-campaign-move-repository";

async function authorizeMove(
	sourceCampaignSlug: string,
	destinationCampaignSlug: string,
) {
	const identity = await getVerifiedServerIdentity();
	if (!identity.ok) return identity;
	try {
		const context = await loadEditAccessContext(identity.authUserId);
		if (!context)
			return { ok: false as const, reason: "dependency_unavailable" as const };
		const source = authorizeCampaignCapability(
			context,
			EDIT_CAPABILITIES.contentEdit,
			sourceCampaignSlug,
		);
		const destination = authorizeCampaignCapability(
			context,
			EDIT_CAPABILITIES.contentEdit,
			destinationCampaignSlug,
		);
		if (!source.ok || !destination.ok)
			return { ok: false as const, reason: "forbidden" as const };
		if (source.profileId !== destination.profileId)
			return { ok: false as const, reason: "forbidden" as const };
		return {
			ok: true as const,
			authUserId: identity.authUserId,
			profileId: source.profileId,
		};
	} catch {
		return { ok: false as const, reason: "dependency_unavailable" as const };
	}
}

export async function previewSessionCampaignMoveAction(
	request: SessionCampaignMovePreviewRequest,
) {
	const issues = validateSessionCampaignMovePreviewRequest(request);
	if (issues.length)
		return { ok: false as const, reason: "validation" as const, issues };

	const access = await authorizeMove(
		request.sourceCampaignSlug,
		request.destinationCampaignSlug,
	);
	if (!access.ok) return { ok: false as const, reason: access.reason };

	try {
		return await previewSessionCampaignMove({
			authUserId: access.authUserId,
			actorProfileId: access.profileId,
			request,
		});
	} catch {
		return { ok: false as const, reason: "dependency_unavailable" as const };
	}
}

function invalidateMovePaths(request: SessionCampaignMoveCommitRequest): boolean {
	let cachePending = false;
	const paths = [
		"/edit/sessoes",
		editSessionLibraryHref(request.sourceCampaignSlug),
		editSessionLibraryHref(request.destinationCampaignSlug),
		editSessionDetailHref(request.sourceCampaignSlug, request.sourceSessionId),
		editSessionDetailHref(
			request.destinationCampaignSlug,
			request.sourceSessionId,
		),
	];
	for (const path of paths) {
		try {
			revalidatePath(path);
		} catch {
			cachePending = true;
		}
	}
	return cachePending;
}

export async function moveSessionCampaignAction(
	request: SessionCampaignMoveCommitRequest,
) {
	const issues = validateSessionCampaignMoveCommitRequest(request);
	if (issues.length)
		return { ok: false as const, reason: "validation" as const, issues };

	const access = await authorizeMove(
		request.sourceCampaignSlug,
		request.destinationCampaignSlug,
	);
	if (!access.ok) return { ok: false as const, reason: access.reason };

	try {
		const result = await commitSessionCampaignMove({
			authUserId: access.authUserId,
			actorProfileId: access.profileId,
			request,
		});
		if (!result.ok) {
			return {
				...result,
				blockers: result.blockers?.filter(isSessionCampaignMoveBlocker),
			};
		}
		return {
			...result,
			destinationHref: editSessionDetailHref(
				request.destinationCampaignSlug,
				request.sourceSessionId,
			),
			cachePending: invalidateMovePaths(request),
		};
	} catch {
		return { ok: false as const, reason: "dependency_unavailable" as const };
	}
}
