import "server-only";

import { editDataClient } from "@/integrations/supabase/server";
import {
	isSessionCoverMime,
	isSessionCoverUuid,
} from "./session-cover-media";
import { prepareSessionCoverCampaignMove } from "./session-cover-media-server";
import type {
	SessionCampaignMoveBlocker,
	SessionCampaignMoveDecisionState,
	SessionCampaignMovePlanItem,
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

type MediaPreparationInput = MoveBoundaryInput & Readonly<{
	operationId: string;
	sourceCampaignId: string;
	destinationCampaignId: string;
	destinationPublic: boolean;
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

function plan(value: unknown): readonly SessionCampaignMovePlanItem[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const row = record(item);
		if (
			!row ||
			typeof row.family !== "string" ||
			typeof row.message !== "string" ||
			(
				row.classification !== "auto" &&
				row.classification !== "historical" &&
				row.classification !== "external_prepare" &&
				row.classification !== "decision"
			)
		) return [];
		const count = Number(row.count);
		return [{
			family: row.family,
			classification: row.classification,
			count: Number.isSafeInteger(count) && count > 0 ? count : 1,
			message: row.message,
			action: typeof row.action === "string" ? row.action : null,
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
		typeof row.destinationCampaignSlug !== "string" ||
		Number(row.contractVersion) !== 2
	) return null;
	return {
		status: row.status,
		contractVersion: 2,
		sessionId: row.sessionId,
		sourceSessionId: row.sourceSessionId,
		sourceCampaignSlug: row.sourceCampaignSlug,
		destinationCampaignSlug: row.destinationCampaignSlug,
		blockers: blockers(row.blockers),
		plan: plan(row.plan),
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

export async function sessionCampaignMoveBackendReady(): Promise<boolean> {
	const client = editDataClient();
	if (!client) return false;
	const { data, error } = await client.rpc("session_campaign_move_contract");
	if (error) return false;
	const row = record(data);
	return Number(row?.version) >= 2;
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

type CoverAssetRow = Readonly<{
	id: string;
	status: string;
	role_hint: string;
	staged_bucket: string;
	object_key: string;
	sha256: string;
	mime_type: string;
	byte_size: number | string;
	width: number;
	height: number;
	read_back_verified: boolean;
	public_delivery_verified: boolean;
}>;

function coverIds(rows: readonly unknown[]): string[] {
	return rows.flatMap((raw) => {
		const row = record(raw);
		const value = row?.cover_asset_id;
		return isSessionCoverUuid(value) ? [value.toLowerCase()] : [];
	});
}

function samePreparation(
	row: Record<string, unknown>,
	prepared: Awaited<ReturnType<typeof prepareSessionCoverCampaignMove>>,
	input: MediaPreparationInput,
	assetId: string,
): boolean {
	return (
		row.operation_id === input.operationId &&
		row.asset_id === assetId &&
		row.session_id === input.sessionId &&
		row.source_campaign_id === input.sourceCampaignId &&
		row.destination_campaign_id === input.destinationCampaignId &&
		row.source_object_key === prepared.sourceObjectKey &&
		row.destination_object_key === prepared.destinationObjectKey &&
		row.sha256 === prepared.sha256 &&
		row.staged_bucket === prepared.stagedBucket &&
		row.destination_public_object_key === prepared.publicObjectKey &&
		row.destination_public_url === prepared.publicUrl
	);
}

export async function prepareSessionCampaignMoveMedia(
	input: MediaPreparationInput,
) {
	const client = editDataClient();
	if (!client) return { ok: false as const, reason: "dependency_unavailable" as const };

	const [draftsResult, publicationsResult] = await Promise.all([
		client
			.from("session_editorial_drafts")
			.select("cover_asset_id")
			.eq("session_id", input.sessionId)
			.eq("campaign_id", input.sourceCampaignId),
		client
			.from("session_publications")
			.select("cover_asset_id")
			.eq("session_id", input.sessionId)
			.eq("campaign_id", input.sourceCampaignId),
	]);
	if (draftsResult.error || publicationsResult.error) {
		return { ok: false as const, reason: "dependency_unavailable" as const };
	}

	const ids = Array.from(new Set([
		...coverIds(draftsResult.data ?? []),
		...coverIds(publicationsResult.data ?? []),
	]));
	if (!ids.length) return { ok: true as const, prepared: 0 };

	const { data: assets, error: assetsError } = await client
		.from("media_assets")
		.select(
			"id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,public_delivery_verified",
		)
		.eq("campaign_id", input.sourceCampaignId)
		.in("id", ids);
	if (assetsError || !Array.isArray(assets) || assets.length !== ids.length) {
		return { ok: false as const, reason: "cover_unverified" as const };
	}

	for (const raw of assets) {
		const asset = raw as CoverAssetRow;
		const bytes = Number(asset.byte_size);
		if (
			!isSessionCoverUuid(asset.id) ||
			asset.role_hint !== "session_cover" ||
			!isSessionCoverMime(asset.mime_type) ||
			!Number.isSafeInteger(bytes) ||
			bytes < 24 ||
			!Number.isSafeInteger(asset.width) ||
			asset.width < 1 ||
			!Number.isSafeInteger(asset.height) ||
			asset.height < 1 ||
			asset.read_back_verified !== true ||
			!(/^[a-f0-9]{64}$/u.test(asset.sha256))
		) {
			return { ok: false as const, reason: "cover_unverified" as const };
		}

		let prepared: Awaited<ReturnType<typeof prepareSessionCoverCampaignMove>>;
		try {
			prepared = await prepareSessionCoverCampaignMove({
				sourceCampaignSlug: input.sourceCampaignSlug,
				destinationCampaignSlug: input.destinationCampaignSlug,
				sessionId: input.sessionId,
				stagedBucket: asset.staged_bucket,
				sourceObjectKey: asset.object_key,
				sha256: asset.sha256,
				mimeType: asset.mime_type,
				bytes,
				width: asset.width,
				height: asset.height,
				verifiedPublic:
					input.destinationPublic &&
					asset.status === "verified_public" &&
					asset.public_delivery_verified === true,
			});
		} catch (error) {
			console.error(
				"[edit] session campaign move media prepare failed",
				error instanceof Error ? error.message : "unknown_error",
			);
			return { ok: false as const, reason: "cover_unverified" as const };
		}

		const receipt = {
			operation_id: input.operationId,
			asset_id: asset.id,
			session_id: input.sessionId,
			source_campaign_id: input.sourceCampaignId,
			destination_campaign_id: input.destinationCampaignId,
			source_object_key: prepared.sourceObjectKey,
			destination_object_key: prepared.destinationObjectKey,
			sha256: prepared.sha256,
			staged_bucket: prepared.stagedBucket,
			destination_public_object_key: prepared.publicObjectKey,
			destination_public_url: prepared.publicUrl,
			public_verified_at: prepared.publicVerifiedAt,
		};
		const { error: insertError } = await client
			.from("session_campaign_move_media_preparations")
			.insert(receipt);
		if (insertError) {
			const { data: existing, error: existingError } = await client
				.from("session_campaign_move_media_preparations")
				.select(
					"operation_id,asset_id,session_id,source_campaign_id,destination_campaign_id,source_object_key,destination_object_key,sha256,staged_bucket,destination_public_object_key,destination_public_url",
				)
				.eq("operation_id", input.operationId)
				.eq("asset_id", asset.id)
				.maybeSingle();
			const existingRecord = record(existing);
			if (
				existingError ||
				!existingRecord ||
				!samePreparation(existingRecord, prepared, input, asset.id)
			) {
				return { ok: false as const, reason: "operation_conflict" as const };
			}
		}
	}

	return { ok: true as const, prepared: ids.length };
}

export async function commitSessionCampaignMove(
	input: MoveBoundaryInput & Readonly<{
		operationId: string;
		decisions: SessionCampaignMoveDecisionState;
	}>,
) {
	const client = editDataClient();
	if (!client) return { ok: false as const, reason: "dependency_unavailable" as const };
	const { data, error } = await client.rpc("move_session_campaign_v2_atomic", {
		...boundaryParams(input),
		p_operation_id: input.operationId,
		p_decisions: {
			unlinkParticipantEntities: input.decisions.unlinkParticipantEntities,
			revokeSessionGrants: input.decisions.revokeSessionGrants,
		},
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
		row.status === "decision_required" ||
		row.status === "preparation_required" ||
		row.status === "preparation_conflict" ||
		row.status === "validation"
			? row.status
			: "dependency_unavailable";
	return { ok: false as const, reason };
}

export async function readRecentSessionCampaignMoveDestination(input: {
	actorProfileId: string;
	sourceCampaignId: string;
	sourceSessionId: string;
}) {
	const client = editDataClient();
	if (!client) return null;
	const { data, error } = await client
		.from("session_campaign_move_operations")
		.select("destination_campaign_id,session_id,committed_at")
		.eq("actor_profile_id", input.actorProfileId)
		.eq("source_campaign_id", input.sourceCampaignId)
		.eq("source_session_id", input.sourceSessionId)
		.order("committed_at", { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error || !data || typeof data.destination_campaign_id !== "string") return null;
	return {
		destinationCampaignId: data.destination_campaign_id,
		sessionId: typeof data.session_id === "string" ? data.session_id : null,
	};
}
