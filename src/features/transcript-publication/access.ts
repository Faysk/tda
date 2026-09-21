import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
	type EditAccessContext,
} from "../edit/access/policy";
import type { PublicationTarget } from "./contract";

export type ResolvedPublicationTarget = Readonly<{
	campaignId: string;
	sessionId: string;
}>;

export type PublicationAuthorizationQueries = Readonly<{
	physicalAction: () => Promise<
		| Readonly<{ ok: true; exists: boolean }>
		| Readonly<{ ok: false; reason: "dependency_unavailable" }>
	>;
	target: (
		target: PublicationTarget,
	) => Promise<
		| Readonly<{ ok: true; value: ResolvedPublicationTarget }>
		| Readonly<{
				ok: false;
				reason: "not_found" | "dependency_unavailable";
		  }>
	>;
}>;

export function authorizePublicationCampaignScope(
	context: EditAccessContext,
	campaignSlug: string,
	physicalActionExists: boolean,
) {
	if (!physicalActionExists)
		return {
			ok: false,
			reason: "publish_capability_undefined",
		} as const;

	const decision = authorizeCampaignCapability(
		context,
		EDIT_CAPABILITIES.transcriptPublish,
		campaignSlug,
	);
	return decision.ok
		? {
				ok: true,
				actor: {
					authUserId: context.authUserId,
					profileId: decision.profileId,
				},
			} as const
		: ({ ok: false, reason: "forbidden" } as const);
}

export async function authorizePublicationRequest(
	context: EditAccessContext,
	target: PublicationTarget,
	queries: PublicationAuthorizationQueries,
) {
	const action = await queries.physicalAction();
	if (!action.ok)
		return { ok: false, reason: "dependency_unavailable" } as const;

	const scope = authorizePublicationCampaignScope(
		context,
		target.campaignSlug,
		action.exists,
	);
	if (!scope.ok) return scope;

	const resolved = await queries.target(target);
	if (!resolved.ok) return resolved;

	return {
		ok: true,
		actor: {
			...scope.actor,
			campaignId: resolved.value.campaignId,
			sessionId: resolved.value.sessionId,
		},
	} as const;
}
