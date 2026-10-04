"use server";

import { revalidatePath } from "next/cache";
import { getVerifiedServerIdentity } from "@/features/auth/server";
import { editSessionDetailHref } from "@/features/campaigns/session-routes";
import { readEditableSessionCampaigns } from "@/features/campaigns/sessions";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { sessionCampaignMoveRevalidationPaths } from "./session-campaign-move-cache";
import type { SessionCampaignMoveDecisionState } from "./session-campaign-move-model";
import {
	commitSessionCampaignMove,
	prepareSessionCampaignMoveMedia,
	preflightSessionCampaignMove,
} from "./session-campaign-move-repository";

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

type Request = Readonly<{
	sessionId: string;
	sourceSessionId: string;
	sourceCampaignSlug: string;
	destinationCampaignSlug: string;
}>;

async function authorizedRequest(request: Request) {
	if (
		!UUID.test(request.sessionId) ||
		!request.sourceSessionId ||
		request.sourceSessionId.length > 220 ||
		!SLUG.test(request.sourceCampaignSlug) ||
		!SLUG.test(request.destinationCampaignSlug) ||
		request.sourceCampaignSlug === request.destinationCampaignSlug
	) return { ok: false as const, reason: "validation" as const };

	const identity = await getVerifiedServerIdentity();
	if (!identity.ok) return { ok: false as const, reason: identity.reason };
	const context = await loadEditAccessContext(identity.authUserId);
	if (!context?.profileId)
		return { ok: false as const, reason: "profile_unresolved" as const };

	const directory = await readEditableSessionCampaigns(context);
	if (!directory.ok)
		return { ok: false as const, reason: directory.reason };
	const source = directory.campaigns.find(
		(item) => item.technicalSlug === request.sourceCampaignSlug,
	);
	const destination = directory.campaigns.find(
		(item) => item.technicalSlug === request.destinationCampaignSlug,
	);
	if (!source || !destination)
		return { ok: false as const, reason: "forbidden" as const };
	if (source.lifecycle !== "active" || destination.lifecycle !== "active")
		return { ok: false as const, reason: "blocked" as const };

	for (const campaign of [source, destination]) {
		if (
			!authorizeCampaignCapability(
				context,
				EDIT_CAPABILITIES.contentEdit,
				campaign.technicalSlug,
			).ok
		) return { ok: false as const, reason: "forbidden" as const };
	}

	return {
		ok: true as const,
		authUserId: identity.authUserId,
		profileId: context.profileId,
		source,
		destination,
	};
}

export async function preflightSessionCampaignMoveAction(request: Request) {
	const access = await authorizedRequest(request);
	if (!access.ok) return access;
	return preflightSessionCampaignMove({
		authUserId: access.authUserId,
		actorProfileId: access.profileId,
		...request,
	});
}

function invalidateMovePaths(input: {
	sourceCampaignSlug: string;
	sourceRouteKey: string;
	destinationCampaignSlug: string;
	destinationRouteKey: string;
	sourceSessionId: string;
}) {
	let cachePending = false;
	const paths = sessionCampaignMoveRevalidationPaths(input);
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
	request: Request & Readonly<{
		operationId: string;
		decisions: SessionCampaignMoveDecisionState;
	}>,
) {
	if (
		!UUID.test(request.operationId) ||
		typeof request.decisions?.unlinkParticipantEntities !== "boolean" ||
		typeof request.decisions?.revokeSessionGrants !== "boolean"
	) {
		return { ok: false as const, reason: "validation" as const };
	}
	const access = await authorizedRequest(request);
	if (!access.ok) return access;

	const boundary = {
		authUserId: access.authUserId,
		actorProfileId: access.profileId,
		...request,
	};
	let result = await commitSessionCampaignMove(boundary);

	if (!result.ok && result.reason === "preparation_required") {
		const prepared = await prepareSessionCampaignMoveMedia({
			...boundary,
			sourceCampaignId: access.source.id,
			destinationCampaignId: access.destination.id,
		});
		if (!prepared.ok) return prepared;
		result = await commitSessionCampaignMove(boundary);
	}
	if (!result.ok) return result;

	const cachePending = invalidateMovePaths({
		sourceCampaignSlug: access.source.technicalSlug,
		sourceRouteKey: access.source.routeKey,
		destinationCampaignSlug: access.destination.technicalSlug,
		destinationRouteKey: access.destination.routeKey,
		sourceSessionId: request.sourceSessionId,
	});
	return {
		ok: true as const,
		replayed: result.replayed,
		cachePending,
		destinationHref: editSessionDetailHref(
			access.destination.technicalSlug,
			request.sourceSessionId,
		),
	};
}
