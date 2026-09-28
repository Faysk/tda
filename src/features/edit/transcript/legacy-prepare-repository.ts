import "server-only";

import { editDataClient } from "@/integrations/supabase/server";
import type {
	LegacyTranscriptPrepareRequest,
	LegacyTranscriptPrepareResult,
} from "./legacy-prepare-model";

function revisionNumber(value: unknown): number | null {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function segmentCount(value: unknown): number | null {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function hash(value: unknown): string | null {
	return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value)
		? value
		: null;
}

export async function persistLegacyTranscriptPreparation(input: {
	authUserId: string;
	actorProfileId: string;
	campaignSlug: string;
	request: LegacyTranscriptPrepareRequest;
}): Promise<LegacyTranscriptPrepareResult> {
	const client = editDataClient();
	if (!client)
		return {
			ok: false,
			reason: "dependency_unavailable",
			issues: ["dependency_unavailable"],
		};

	const { data, error } = await client.rpc(
		"prepare_legacy_transcript_revision_atomic",
		{
			p_auth_user_id: input.authUserId,
			p_actor_profile_id: input.actorProfileId,
			p_campaign_slug: input.campaignSlug,
			p_session_id: input.request.sessionId,
			p_operation_id: input.request.operationId,
			p_expected_snapshot_sha256: input.request.expectedSnapshotSha256,
		},
	);

	if (error || !Array.isArray(data) || data.length !== 1)
		return {
			ok: false,
			reason: "dependency_unavailable",
			issues: ["dependency_unavailable"],
		};

	const row = data[0] as Record<string, unknown>;
	const status = typeof row.status === "string" ? row.status : "";
	const revisionId =
		typeof row.revision_id === "string" ? row.revision_id : null;
	const number = revisionNumber(row.revision_number);
	const snapshotSha256 = hash(row.snapshot_sha256);
	const count = segmentCount(row.segment_count);

	if (
		(status === "prepared" ||
			status === "replay" ||
			status === "already_prepared") &&
		revisionId &&
		number !== null &&
		snapshotSha256 &&
		count !== null
	) {
		return {
			ok: true,
			status,
			revisionId,
			revisionNumber: number,
			snapshotSha256,
			segmentCount: count,
		};
	}

	if (
		status === "forbidden" ||
		status === "not_found" ||
		status === "operation_conflict" ||
		status === "stale_legacy" ||
		status === "empty_legacy" ||
		status === "invalid_legacy"
	) {
		return {
			ok: false,
			reason: status,
			issues: [status],
			actualSnapshotSha256: snapshotSha256,
			segmentCount: count,
		};
	}

	return {
		ok: false,
		reason: "dependency_unavailable",
		issues: ["dependency_unavailable"],
	};
}
