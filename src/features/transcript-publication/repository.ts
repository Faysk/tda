import "server-only";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import {
	authorizeCampaignCapability,
	EDIT_CAPABILITIES,
} from "@/features/edit/access/policy";
import { editDataClient } from "@/integrations/supabase/server";
import type {
	PreparedPublication,
	PublicationResult,
	PublicationTarget,
} from "./contract";
import type {
	AuthorizedPublicationActor,
	PublicationDependencies,
} from "./consumer";

export const databasePublicationDependencies: PublicationDependencies = {
	authorize: async (authUserId, target) => {
		const client = editDataClient();
		if (!client) return { ok: false, reason: "dependency_unavailable" };

		const { data: action, error: actionError } = await client
			.from("permission_catalog")
			.select("action")
			.eq("action", EDIT_CAPABILITIES.transcriptPublish)
			.eq("plane", "mixed")
			.maybeSingle();
		if (actionError)
			return { ok: false, reason: "dependency_unavailable" };
		if (!action)
			return { ok: false, reason: "publish_capability_undefined" };

		const context = await loadEditAccessContext(authUserId);
		if (!context) return { ok: false, reason: "dependency_unavailable" };

		// The claimed campaign slug is checked against the operator's effective
		// grants before any campaign/session target lookup. This keeps foreign
		// target existence opaque to an unauthorized operator.
		const scope = authorizeCampaignCapability(
			context,
			EDIT_CAPABILITIES.transcriptPublish,
			target.campaignSlug,
		);
		if (!scope.ok) return { ok: false, reason: "forbidden" };

		return resolveAuthorizedTarget(
			client,
			authUserId,
			scope.profileId,
			target,
		);
	},
	commit: (actor, input) => invoke(actor, input, false),
	lookup: (actor, input) => invoke(actor, input, true),
};

async function resolveAuthorizedTarget(
	client: NonNullable<ReturnType<typeof editDataClient>>,
	authUserId: string,
	profileId: string,
	target: PublicationTarget,
) {
	const { data: campaign, error: campaignError } = await client
		.from("campaigns")
		.select("id")
		.eq("slug", target.campaignSlug)
		.maybeSingle();
	if (campaignError)
		return { ok: false as const, reason: "dependency_unavailable" as const };
	if (!campaign)
		return { ok: false as const, reason: "not_found" as const };

	const { data: session, error: sessionError } = await client
		.from("sessions")
		.select("id")
		.eq("campaign_id", campaign.id)
		.eq("source_system", "local_companion")
		.eq("source_session_id", target.sourceSessionId)
		.maybeSingle();
	if (sessionError)
		return { ok: false as const, reason: "dependency_unavailable" as const };
	if (!session)
		return { ok: false as const, reason: "not_found" as const };

	return {
		ok: true as const,
		actor: {
			authUserId,
			profileId,
			campaignId: campaign.id,
			sessionId: session.id,
		},
	};
}

async function invoke(
	actor: AuthorizedPublicationActor,
	input: PreparedPublication,
	lookupOnly: boolean,
): Promise<PublicationResult> {
	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const { data, error } = await client.rpc("publish_transcript_revision_atomic", {
		p_auth_user_id: actor.authUserId,
		p_actor_profile_id: actor.profileId,
		p_input: {
			campaignId: actor.campaignId,
			sessionId: actor.sessionId,
			operationId: input.operationId,
			sourceSystem: "local_companion",
			sourceSessionId: input.target.sourceSessionId,
			sourceId: input.sourceId,
			runId: input.runId,
			baseTranscriptSha256: input.baseTranscriptSha256,
			draftSha256: input.draftSha256,
			payloadSha256: input.payloadSha256,
			payloadJson: input.payloadJson,
			segmentCount: input.segmentCount,
		},
		p_lookup_only: lookupOnly,
	});
	if (
		error ||
		!data ||
		typeof data !== "object" ||
		typeof data.ok !== "boolean"
	)
		return { ok: false, reason: "dependency_unavailable" };

	if (
		!data.ok &&
		![
			"forbidden",
			"publish_capability_undefined",
			"invalid_payload",
			"not_found",
			"conflict",
		].includes(data.reason)
	)
		return { ok: false, reason: "dependency_unavailable" };

	return data as PublicationResult;
}
