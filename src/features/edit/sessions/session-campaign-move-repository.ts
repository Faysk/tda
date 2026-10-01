import "server-only";

import { editDataClient } from "@/integrations/supabase/server";
import {
	isSessionCampaignMoveBlocker,
	type SessionCampaignMoveCommitRequest,
	type SessionCampaignMovePreview,
	type SessionCampaignMovePreviewRequest,
} from "./session-campaign-move";

function string(value: unknown): string | null {
	return typeof value === "string" && value.length ? value : null;
}

function parsePreview(data: unknown): SessionCampaignMovePreview | null {
	if (!data || typeof data !== "object" || Array.isArray(data)) return null;
	const row = data as Record<string, unknown>;
	if (row.ok !== true) return null;
	const blockersRaw = Array.isArray(row.blockers) ? row.blockers : null;
	if (!blockersRaw || !blockersRaw.every(isSessionCampaignMoveBlocker))
		return null;
	const sessionId = string(row.sessionId);
	const sourceSessionId = string(row.sourceSessionId);
	const sourceCampaignId = string(row.sourceCampaignId);
	const sourceCampaignSlug = string(row.sourceCampaignSlug);
	const sourceCampaignName = string(row.sourceCampaignName);
	const destinationCampaignId = string(row.destinationCampaignId);
	const destinationCampaignSlug = string(row.destinationCampaignSlug);
	const destinationCampaignName = string(row.destinationCampaignName);
	const expectedUpdatedAt = string(row.expectedUpdatedAt);
	if (
		!sessionId ||
		!sourceSessionId ||
		!sourceCampaignId ||
		!sourceCampaignSlug ||
		!sourceCampaignName ||
		!destinationCampaignId ||
		!destinationCampaignSlug ||
		!destinationCampaignName ||
		!expectedUpdatedAt ||
		!Number.isFinite(Date.parse(expectedUpdatedAt)) ||
		typeof row.ready !== "boolean"
	) {
		return null;
	}
	return {
		sessionId,
		sourceSessionId,
		sourceCampaignId,
		sourceCampaignSlug,
		sourceCampaignName,
		destinationCampaignId,
		destinationCampaignSlug,
		destinationCampaignName,
		expectedUpdatedAt,
		blockers: blockersRaw,
		ready: row.ready,
	};
}

export async function previewSessionCampaignMove(input: {
	authUserId: string;
	actorProfileId: string;
	request: SessionCampaignMovePreviewRequest;
}): Promise<
	| Readonly<{ ok: true; preview: SessionCampaignMovePreview }>
	| Readonly<{ ok: false; reason: "forbidden" | "not_found" | "dependency_unavailable" }>
> {
	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const { data, error } = await client.rpc("preview_session_campaign_move", {
		p_auth_user_id: input.authUserId,
		p_actor_profile_id: input.actorProfileId,
		p_source_campaign_slug: input.request.sourceCampaignSlug,
		p_destination_campaign_slug: input.request.destinationCampaignSlug,
		p_session_id: input.request.sessionId,
		p_source_session_id: input.request.sourceSessionId,
	});
	if (error || !data || typeof data !== "object" || Array.isArray(data))
		return { ok: false, reason: "dependency_unavailable" };

	const raw = data as Record<string, unknown>;
	if (raw.ok === false) {
		return {
			ok: false,
			reason:
				raw.reason === "forbidden" || raw.reason === "not_found"
					? raw.reason
					: "dependency_unavailable",
		};
	}
	const preview = parsePreview(raw);
	return preview
		? { ok: true, preview }
		: { ok: false, reason: "dependency_unavailable" };
}

export async function commitSessionCampaignMove(input: {
	authUserId: string;
	actorProfileId: string;
	request: SessionCampaignMoveCommitRequest;
}): Promise<
	| Readonly<{
			ok: true;
			status: "moved" | "replay";
			sessionUpdatedAt: string;
			committedAt: string;
	  }>
	| Readonly<{
			ok: false;
			reason:
				| "forbidden"
				| "not_found"
				| "blocked"
				| "conflict"
				| "operation_conflict"
				| "dependency_unavailable";
			blockers?: readonly string[];
	  }>
> {
	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };

	const { data, error } = await client.rpc("move_session_campaign_atomic", {
		p_auth_user_id: input.authUserId,
		p_actor_profile_id: input.actorProfileId,
		p_source_campaign_slug: input.request.sourceCampaignSlug,
		p_destination_campaign_slug: input.request.destinationCampaignSlug,
		p_session_id: input.request.sessionId,
		p_source_session_id: input.request.sourceSessionId,
		p_expected_updated_at: input.request.expectedUpdatedAt,
		p_operation_id: input.request.operationId,
	});
	if (error || !data || typeof data !== "object" || Array.isArray(data))
		return { ok: false, reason: "dependency_unavailable" };
	const row = data as Record<string, unknown>;
	if (row.ok === true && (row.status === "moved" || row.status === "replay")) {
		const sessionUpdatedAt = string(row.sessionUpdatedAt);
		const committedAt = string(row.committedAt);
		if (
			!sessionUpdatedAt ||
			!committedAt ||
			!Number.isFinite(Date.parse(sessionUpdatedAt)) ||
			!Number.isFinite(Date.parse(committedAt))
		) {
			return { ok: false, reason: "dependency_unavailable" };
		}
		return {
			ok: true,
			status: row.status,
			sessionUpdatedAt,
			committedAt,
		};
	}
	const reason =
		row.reason === "forbidden" ||
		row.reason === "not_found" ||
		row.reason === "blocked" ||
		row.reason === "conflict" ||
		row.reason === "operation_conflict"
			? row.reason
			: "dependency_unavailable";
	return {
		ok: false,
		reason,
		blockers:
			reason === "blocked" && Array.isArray(row.blockers)
				? row.blockers.filter((item): item is string => typeof item === "string")
				: undefined,
	};
}
