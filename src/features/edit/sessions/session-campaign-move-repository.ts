import "server-only";

import { editDataClient } from "@/integrations/supabase/server";
import type { PreparedSessionCampaignMoveCover } from "./session-campaign-move-media-server";
import {
	SESSION_CAMPAIGN_MOVE_CONTRACT_V2,
	type SessionCampaignMoveBlocker,
	type SessionCampaignMoveClassification,
	type SessionCampaignMoveOptions,
	type SessionCampaignMovePlanItem,
	type SessionCampaignMovePreview,
} from "./session-campaign-move-model";

type MoveBoundaryInput = Readonly<{
	authUserId: string;
	actorProfileId: string;
	sourceCampaignSlug: string;
	destinationCampaignSlug: string;
	sessionId: string;
	sourceSessionId: string;
	options: SessionCampaignMoveOptions;
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
		)
			return [];
		const count = Number(row.count);
		return [
			{
				code: row.code,
				message: row.message,
				count: Number.isSafeInteger(count) && count > 0 ? count : 1,
			},
		];
	});
}

const CLASSIFICATIONS = new Set<SessionCampaignMoveClassification>([
	"auto",
	"historical",
	"external_prepare",
	"decision",
	"hard_block",
]);

function planItems(value: unknown): readonly SessionCampaignMovePlanItem[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const row = record(item);
		if (
			!row ||
			typeof row.code !== "string" ||
			typeof row.family !== "string" ||
			typeof row.classification !== "string" ||
			!CLASSIFICATIONS.has(
				row.classification as SessionCampaignMoveClassification,
			) ||
			typeof row.message !== "string"
		)
			return [];
		const count = Number(row.count);
		return [
			{
				code: row.code,
				family: row.family,
				classification:
					row.classification as SessionCampaignMoveClassification,
				resolved: row.resolved === true,
				count: Number.isSafeInteger(count) && count > 0 ? count : 1,
				message: row.message,
				actionId:
					typeof row.actionId === "string" && row.actionId
						? row.actionId
						: null,
				selectedPolicy:
					typeof row.selectedPolicy === "string" && row.selectedPolicy
						? row.selectedPolicy
						: null,
			},
		];
	});
}

function preview(value: unknown): SessionCampaignMovePreview | null {
	const row = record(value);
	if (!row || (row.status !== "ready" && row.status !== "blocked")) return null;
	if (
		row.contractVersion !== SESSION_CAMPAIGN_MOVE_CONTRACT_V2 ||
		typeof row.sessionId !== "string" ||
		typeof row.sourceSessionId !== "string" ||
		typeof row.sourceCampaignSlug !== "string" ||
		typeof row.destinationCampaignSlug !== "string"
	)
		return null;
	return {
		status: row.status,
		contractVersion: SESSION_CAMPAIGN_MOVE_CONTRACT_V2,
		sessionId: row.sessionId,
		sourceSessionId: row.sourceSessionId,
		sourceCampaignSlug: row.sourceCampaignSlug,
		destinationCampaignSlug: row.destinationCampaignSlug,
		blockers: blockers(row.blockers),
		planItems: planItems(row.planItems),
		consequences: Array.isArray(row.consequences)
			? row.consequences.filter(
					(item): item is string => typeof item === "string",
				)
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
		p_options: input.options,
	};
}

export async function sessionCampaignMoveBackendReady(): Promise<boolean> {
	const client = editDataClient();
	if (!client) return false;

	const { data, error } = await client.rpc("session_campaign_move_contract_v2");
	if (error) return false;
	const row = record(data);
	return (
		row?.contractVersion === SESSION_CAMPAIGN_MOVE_CONTRACT_V2 &&
		row.registryComplete === true &&
		row.supportsPopulatedSessions === true &&
		row.supportsRecoveryReplay === true
	);
}

export async function preflightSessionCampaignMove(input: MoveBoundaryInput) {
	const client = editDataClient();
	if (!client)
		return {
			ok: false as const,
			reason: "dependency_unavailable" as const,
		};
	const { data, error } = await client.rpc(
		"preflight_session_campaign_move_v2",
		boundaryParams(input),
	);
	if (error)
		return {
			ok: false as const,
			reason: "dependency_unavailable" as const,
		};
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
	input: MoveBoundaryInput &
		Readonly<{
			operationId: string;
			preparedCover: PreparedSessionCampaignMoveCover | null;
		}>,
) {
	const client = editDataClient();
	if (!client)
		return {
			ok: false as const,
			reason: "dependency_unavailable" as const,
		};
	const { data, error } = await client.rpc("move_session_campaign_atomic_v2", {
		...boundaryParams(input),
		p_operation_id: input.operationId,
		p_options: {
			...input.options,
			preparedCover: input.preparedCover,
		},
	});
	if (error)
		return {
			ok: false as const,
			reason: "dependency_unavailable" as const,
		};
	const row = record(data);
	if (!row)
		return {
			ok: false as const,
			reason: "dependency_unavailable" as const,
		};
	if (row.status === "moved" || row.status === "replay") {
		return {
			ok: true as const,
			replayed: row.status === "replay",
			destinationCampaignSlug: input.destinationCampaignSlug,
			publicationState:
				row.publicationState === "unpublished" ? "unpublished" as const : "unchanged" as const,
		};
	}
	const parsed = preview(data);
	if (parsed)
		return {
			ok: false as const,
			reason: "blocked" as const,
			preview: parsed,
		};
	const reason =
		row.status === "forbidden" ||
		row.status === "not_found" ||
		row.status === "conflict" ||
		row.status === "operation_conflict" ||
		row.status === "validation" ||
		row.status === "media_prepare_required" ||
		row.status === "media_prepare_stale" ||
		row.status === "blocked"
			? row.status
			: "dependency_unavailable";
	return { ok: false as const, reason };
}
