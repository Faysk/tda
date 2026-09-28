import "server-only";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import { EDIT_CAPABILITIES } from "@/features/edit/access/policy";
import { editDataClient } from "@/integrations/supabase/server";
import { authorizePublicationRequest } from "./access";
import type {
	PreparedPublication,
	PublicationResult,
} from "./contract";
import type {
	CurrentMutationInput,
	CurrentMutationResult,
} from "./current-mutation";
import type {
	AuthorizedPublicationActor,
	PublicationDependencies,
} from "./consumer";

export const databasePublicationDependencies: PublicationDependencies = {
	authorize: async (authUserId, target) => {
		const client = editDataClient();
		if (!client) return { ok: false, reason: "dependency_unavailable" };
		const context = await loadEditAccessContext(authUserId);
		if (!context) return { ok: false, reason: "dependency_unavailable" };

		return authorizePublicationRequest(context, target, {
			physicalAction: async () => {
				const { data, error } = await client
					.from("permission_catalog")
					.select("action")
					.eq("action", EDIT_CAPABILITIES.transcriptPublish)
					.eq("plane", "mixed")
					.maybeSingle();
				return error
					? {
							ok: false as const,
							reason: "dependency_unavailable" as const,
						}
					: { ok: true as const, exists: Boolean(data) };
			},
			target: async (expected) => {
				// This lookup is reached only after authorizePublicationRequest
				// proves the operator has the exact campaign scope.
				const { data: campaign, error: campaignError } = await client
					.from("campaigns")
					.select("id")
					.eq("slug", expected.campaignSlug)
					.maybeSingle();
				if (campaignError)
					return {
						ok: false as const,
						reason: "dependency_unavailable" as const,
					};
				if (!campaign)
					return { ok: false as const, reason: "not_found" as const };

				const { data: session, error: sessionError } = await client
					.from("sessions")
					.select("id")
					.eq("campaign_id", campaign.id)
					.eq("source_system", "local_companion")
					.eq("source_session_id", expected.sourceSessionId)
					.maybeSingle();
				if (sessionError)
					return {
						ok: false as const,
						reason: "dependency_unavailable" as const,
					};
				return session
					? {
							ok: true as const,
							value: {
								campaignId: campaign.id,
								sessionId: session.id,
							},
						}
					: { ok: false as const, reason: "not_found" as const };
			},
		});
	},
	commit: (actor, input) => invoke(actor, input, false),
	lookup: (actor, input) => invoke(actor, input, true),
};

async function invoke(
	actor: AuthorizedPublicationActor,
	input: PreparedPublication,
	lookupOnly: boolean,
): Promise<PublicationResult> {
	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const commonInput = {
		campaignId: actor.campaignId,
		sessionId: actor.sessionId,
		operationId: input.operationId,
		expectedCurrentRevisionId: input.expectedCurrentRevisionId,
		sourceSystem: "local_companion",
		sourceSessionId: input.target.sourceSessionId,
		baseTranscriptSha256: input.baseTranscriptSha256,
		draftSha256: input.draftSha256,
		payloadSha256: input.payloadSha256,
		payloadJson: input.payloadJson,
		segmentCount: input.segmentCount,
	};
	const { data, error } =
		input.publicationKind === "single_source"
			? await client.rpc("publish_transcript_revision_atomic", {
					p_auth_user_id: actor.authUserId,
					p_actor_profile_id: actor.profileId,
					p_input: {
						...commonInput,
						sourceId: input.sourceId,
						runId: input.runId,
					},
					p_lookup_only: lookupOnly,
				})
			: await client.rpc("publish_transcript_assembly_revision_atomic", {
					p_auth_user_id: actor.authUserId,
					p_actor_profile_id: actor.profileId,
					p_input: {
						...commonInput,
						provenance: input.provenance,
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
			"stale_current",
		].includes(data.reason)
	)
		return { ok: false, reason: "dependency_unavailable" };

	return data as PublicationResult;
}

export async function readCurrentPublication(actor: AuthorizedPublicationActor) {
	const client = editDataClient();
	if (!client) return { ok: false as const, reason: "dependency_unavailable" as const };
	const { data, error } = await client
		.from("sessions")
		.select("current_transcript_revision_id")
		.eq("id", actor.sessionId)
		.eq("campaign_id", actor.campaignId)
		.maybeSingle();
	if (error) return { ok: false as const, reason: "dependency_unavailable" as const };
	if (!data) return { ok: false as const, reason: "not_found" as const };
	return {
		ok: true as const,
		current: {
			actorProfileId: actor.profileId,
			revisionId: data.current_transcript_revision_id as string | null,
		},
	};
}

export async function setCurrentPublication(
	actor: AuthorizedPublicationActor,
	input: CurrentMutationInput,
): Promise<CurrentMutationResult> {
	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const { data, error } = await client.rpc(
		"set_current_transcript_revision_atomic",
		{
			p_auth_user_id: actor.authUserId,
			p_actor_profile_id: actor.profileId,
			p_campaign_id: actor.campaignId,
			p_session_id: actor.sessionId,
			p_operation_id: input.operationId,
			p_revision_id: input.revisionId,
			p_expected_current_revision_id: input.expectedCurrentRevisionId,
		},
	);
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
			"not_found",
			"conflict",
			"stale_current",
		].includes(data.reason)
	)
		return { ok: false, reason: "dependency_unavailable" };

	return data as CurrentMutationResult;
}
