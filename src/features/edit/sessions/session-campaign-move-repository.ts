import "server-only";

import { editDataClient } from "@/integrations/supabase/server";
import type {
	SessionCampaignMoveBlocker,
	SessionCampaignMovePreview,
} from "./session-campaign-move-model";

type MoveBoundaryInput = Readonly<{
	authUserId: string;
	actorProfileId: string;
	sourceCampaignSlug: string;
	destinationCampaignSlug: string;
	sessionId: string;
	sourceSessionId: string;
}>;

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function blockers(value: unknown): readonly SessionCampaignMoveBlocker[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const row = record(item);
		if (
			!row ||
			typeof row.code !== "string" ||
			typeof row.message !== "string"
		) return [];
		const count = Number(row.count);
		return [{
			code: row.code,
			message: row.message,
			count: Number.isSafeInteger(count) && count > 0 ? count : 1,
		}];
	});
}

function preview(value: unknown): SessionCampaignMovePreview | null {
	const row = record(value);
	if (!row || (row.status !== "ready" && row.status !== "blocked")) return null;
	if (
		typeof row.sessionId !== "string" ||
		typeof row.sourceSessionId !== "string" ||
		typeof row.sourceCampaignSlug !== "string" ||
		typeof row.destinationCampaignSlug !== "string"
	) return null;
	return {
		status: row.status,
		sessionId: row.sessionId,
		sourceSessionId: row.sourceSessionId,
		sourceCampaignSlug: row.sourceCampaignSlug,
		destinationCampaignSlug: row.destinationCampaignSlug,
		blockers: blockers(row.blockers),
		consequences: Array.isArray(row.consequences)
			? row.consequences.filter((item): item is string => typeof item === "string")
			: [],
	};
}

function boundaryParams(input: MoveBoundaryInput) {
	return {
		p_auth_user_id: input.authUserId,
		p_actor_profile_id: input.actorProfileId,
		p_source_campaign_slug: input.sourceCampaignSlug,
		p_destination_campaign_slug: input.destinationCampaignSlug,
		p_session_id: input.sessionId,
		p_source_session_id: input.sourceSessionId,
	};
}

export async function preflightSessionCampaignMove(input: MoveBoundaryInput) {
	const client = editDataClient();
	if (!client) return { ok: false as const, reason: "dependency_unavailable" as const };
	const { data, error } = await client.rpc(
		"preflight_session_campaign_move",
		boundaryParams(input),
	);
	if (error) return { ok: false as const, reason: "dependency_unavailable" as const };
	const parsed = preview(data);
	if (parsed) return { ok: true as const, preview: parsed };
	const row = record(data);
	const reason =
		row?.status === "forbidden" ||
		row?.status === "not_found" ||
		row?.status === "conflict" ||
		row?.status === "validation"
			? row.status
			: "dependency_unavailable";
	return { ok: false as const, reason };
}

export async function commitSessionCampaignMove(
	input: MoveBoundaryInput & Readonly<{ operationId: string }>,
) {
	const client = editDataClient();
	if (!client) return { ok: false as const, reason: "dependency_unavailable" as const };
	const { data, error } = await client.rpc("move_session_campaign_atomic", {
		...boundaryParams(input),
		p_operation_id: input.operationId,
	});
	if (error) return { ok: false as const, reason: "dependency_unavailable" as const };
	const row = record(data);
	if (!row) return { ok: false as const, reason: "dependency_unavailable" as const };
	if (row.status === "moved" || row.status === "replay") {
		return {
			ok: true as const,
			replayed: row.status === "replay",
			destinationCampaignSlug: input.destinationCampaignSlug,
		};
	}
	const parsed = preview(data);
	if (parsed) return { ok: false as const, reason: "blocked" as const, preview: parsed };
	const reason =
		row.status === "forbidden" ||
		row.status === "not_found" ||
		row.status === "conflict" ||
		row.status === "operation_conflict" ||
		row.status === "validation"
			? row.status
			: "dependency_unavailable";
	return { ok: false as const, reason };
}
