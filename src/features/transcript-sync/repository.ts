import "server-only";
import { loadEditAccessContext } from "@/features/edit/access/repository";
import { editDataClient } from "@/integrations/supabase/server";
import {
	authorizeImportBoundTarget,
	authorizeImportCampaignScope,
} from "./access";
import type { ImportDependencies } from "./consumer";
import type { ImportResult } from "./contract";

/** Implemented adapter; production server.ts deliberately does not select it yet. */
export const databaseImportDependencies: ImportDependencies = {
	authorize: async (authUserId, identity) => {
		const client = editDataClient();
		if (!client) return { ok: false, reason: "dependency_unavailable" };
		const context = await loadEditAccessContext(authUserId);
		if (!context) return { ok: false, reason: "dependency_unavailable" };

		const { data: action, error: actionError } = await client
			.from("permission_catalog")
			.select("action")
			.eq("action", "campaign.transcript.import")
			.maybeSingle();
		if (actionError) return { ok: false, reason: "dependency_unavailable" };
		if (!action) return { ok: false, reason: "import_capability_undefined" };

		// Resolve only the campaign scope needed for authorization. Do not touch the
		// target session until capability/scope is proven, so denied callers cannot
		// distinguish existing and missing sessions through this adapter.
		const { data: campaign, error: campaignError } = await client
			.from("campaigns")
			.select("slug")
			.eq("id", identity.campaignId)
			.maybeSingle();
		if (campaignError) return { ok: false, reason: "dependency_unavailable" };

		const scope = authorizeImportCampaignScope(
			context,
			campaign?.slug ?? null,
			true,
		);
		if (!scope.ok) return scope;

		const { data: session, error: sessionError } = await client
			.from("sessions")
			.select("id,campaign_id,source_system,source_session_id")
			.eq("id", identity.sessionId)
			.eq("campaign_id", identity.campaignId)
			.maybeSingle();
		if (sessionError) return { ok: false, reason: "dependency_unavailable" };

		return authorizeImportBoundTarget(
			scope.actor,
			identity,
			session && campaign
				? {
						campaignId: session.campaign_id,
						campaignSlug: campaign.slug,
						sessionId: session.id,
						sourceSystem: session.source_system,
						sourceSessionId: session.source_session_id,
					}
				: null,
		);
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
