import "server-only";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import { editDataClient } from "@/integrations/supabase/server";
import { authorizeImportRequest } from "./access";
import type { ImportDependencies } from "./consumer";
import type { ImportResult } from "./contract";

/** Implemented adapter; production server.ts deliberately does not select it yet. */
export const databaseImportDependencies: ImportDependencies = {
	authorize: async (authUserId, identity) => {
		const client = editDataClient();
		if (!client) return { ok: false, reason: "dependency_unavailable" };
		const context = await loadEditAccessContext(authUserId);
		if (!context) return { ok: false, reason: "dependency_unavailable" };

		return authorizeImportRequest(context, identity, {
			physicalAction: async () => {
				const { data, error } = await client
					.from("permission_catalog")
					.select("action")
					.eq("action", "campaign.transcript.import")
					.maybeSingle();
				return error
					? { ok: false as const, reason: "dependency_unavailable" as const }
					: { ok: true as const, exists: Boolean(data) };
			},
			campaignSlug: async (campaignId) => {
				const { data, error } = await client
					.from("campaigns")
					.select("slug")
					.eq("id", campaignId)
					.maybeSingle();
				if (error) {
					return {
						ok: false as const,
						reason: "dependency_unavailable" as const,
					};
				}
				return data
					? { ok: true as const, value: data.slug }
					: { ok: false as const, reason: "not_found" as const };
			},
			target: async (expected) => {
				const { data: session, error } = await client
					.from("sessions")
					.select("id,campaign_id,source_system,source_session_id")
					.eq("id", expected.sessionId)
					.eq("campaign_id", expected.campaignId)
					.maybeSingle();
				if (error) {
					return {
						ok: false as const,
						reason: "dependency_unavailable" as const,
					};
				}
				return session
					? {
							ok: true as const,
							value: {
								campaignId: session.campaign_id,
								campaignSlug: "",
								sessionId: session.id,
								sourceSystem: session.source_system,
								sourceSessionId: session.source_session_id,
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
	actor: { authUserId: string; profileId: string },
	input: unknown,
	lookupOnly: boolean,
): Promise<ImportResult> {
	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };
	const { data, error } = await client.rpc("import_transcript_bundle_atomic", {
		p_auth_user_id: actor.authUserId,
		p_actor_profile_id: actor.profileId,
		p_input: input,
		p_lookup_only: lookupOnly,
	});
	if (
		error ||
		!data ||
		typeof data !== "object" ||
		typeof data.ok !== "boolean"
	) {
		return { ok: false, reason: "dependency_unavailable" };
	}
	if (
		!data.ok &&
		![
			"forbidden",
			"not_found",
			"conflict",
			"invalid_payload",
			"import_capability_undefined",
		].includes(data.reason)
	) {
		return { ok: false, reason: "dependency_unavailable" };
	}
	// The consumer checks every successful receipt against its request before exposing it.
	return data as ImportResult;
}
