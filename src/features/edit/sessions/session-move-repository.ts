import "server-only";

import { editDataClient } from "@/integrations/supabase/server";
import {
	normalizeSessionMoveBlockers,
	type SessionCampaignMoveRequest,
} from "./session-move-model";

function firstRow(data: unknown): Record<string, unknown> | null {
	return Array.isArray(data) && data.length === 1 && data[0] && typeof data[0] === "object"
		? (data[0] as Record<string, unknown>)
		: null;
}

export async function preflightSessionCampaignMove(input: Omit<SessionCampaignMoveRequest, "operationId">) {
	const client = editDataClient();
	if (!client) return { ok: false as const, reason: "dependency_unavailable" as const };
	const { data, error } = await client.rpc("preflight_session_campaign_move", {
		p_session_id: input.sessionId,
		p_source_campaign_slug: input.sourceCampaignSlug,
		p_destination_campaign_slug: input.destinationCampaignSlug,
	});
	const row = firstRow(data);
	if (error || !row) return { ok: false as const, reason: "dependency_unavailable" as const };
	const status = typeof row.status === "string" ? row.status : "";
	if (status === "ready") return { ok: true as const, blockers: [] as const };
	if (status === "blocked" || status === "invalid_target")
		return { ok: false as const, reason: status, blockers: normalizeSessionMoveBlockers(row.blockers) };
	if (status === "not_found") return { ok: false as const, reason: "not_found" as const };
	return { ok: false as const, reason: "dependency_unavailable" as const };
}

export async function persistSessionCampaignMove(
	actorProfileId: string,
	input: SessionCampaignMoveRequest,
) {
	const client = editDataClient();
	if (!client) return { ok: false as const, reason: "dependency_unavailable" as const };
	const { data, error } = await client.rpc("move_session_campaign_atomic", {
		p_operation_id: input.operationId,
		p_actor_profile_id: actorProfileId,
		p_session_id: input.sessionId,
		p_source_campaign_slug: input.sourceCampaignSlug,
		p_destination_campaign_slug: input.destinationCampaignSlug,
	});
	const row = firstRow(data);
	if (error || !row) return { ok: false as const, reason: "dependency_unavailable" as const };
	const status = typeof row.status === "string" ? row.status : "";
	if (status === "moved" || status === "replay")
		return { ok: true as const, replayed: status === "replay" };
	if (status === "blocked" || status === "invalid_target")
		return { ok: false as const, reason: status, blockers: normalizeSessionMoveBlockers(row.blockers) };
	if (status === "not_found" || status === "conflict" || status === "operation_conflict")
		return { ok: false as const, reason: status };
	return { ok: false as const, reason: "dependency_unavailable" as const };
}
