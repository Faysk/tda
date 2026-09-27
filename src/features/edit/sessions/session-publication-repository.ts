import "server-only";

import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import {
	WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
} from "@/features/world-explorer/world-entity-media";
import { editDataClient } from "@/integrations/supabase/server";
import {
	isExistingPublishedSessionCoverReference,
	isSessionCoverMime,
	isSessionCoverSha256,
	isSessionCoverUuid,
	normalizePublishedSessionCoverReference,
	sessionCoverObjectKey,
} from "./session-cover-media";
import { promoteSessionCoverToPublic } from "./session-cover-media-server";
import {
	type SessionPublicationRequest,
	type SessionPublicationState,
	validPublicationHash,
} from "./session-publication-model";

type CurrentPublicationRow = Readonly<{
	id: unknown;
	version: unknown;
	source_draft_id: unknown;
	payload_sha256: unknown;
	created_at: unknown;
}>;

type SessionPublicationSessionRow = Readonly<{
	campaign_id: unknown;
	current_session_publication_id: unknown;
	status: unknown;
	source_session_id: unknown;
}>;

type CoverAssetRow = Readonly<{
	id: unknown;
	campaign_id: unknown;
	status: unknown;
	role_hint: unknown;
	staged_bucket: unknown;
	object_key: unknown;
	sha256: unknown;
	mime_type: unknown;
	byte_size: unknown;
	width: unknown;
	height: unknown;
	read_back_verified: unknown;
	public_bucket: unknown;
	public_object_key: unknown;
	public_delivery_verified: unknown;
	public_verified_at: unknown;
}>;

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function id(value: unknown): string | null {
	return typeof value === "string" && UUID.test(value) ? value : null;
}

function positiveInteger(value: unknown): number | null {
	return typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value > 0
		? value
		: null;
}

async function publicationSessionRow(
	sessionId: string,
): Promise<SessionPublicationSessionRow | null> {
	const client = editDataClient();
	if (!client) throw new Error("Edit data connection is unavailable");
	const { data, error } = await client
		.from("sessions")
		.select(
			"campaign_id,current_session_publication_id,status,source_session_id,campaigns!inner(slug)",
		)
		.eq("id", sessionId)
		.eq("campaigns.slug", CAMPAIGN_SLUG)
		.maybeSingle();
	if (error) throw new Error("Session publication lookup unavailable");
	return (data as unknown as SessionPublicationSessionRow | null) ?? null;
}

export async function readSessionPublicationState(
	sessionId: string,
): Promise<SessionPublicationState | null> {
	if (!UUID.test(sessionId)) return null;
	const session = await publicationSessionRow(sessionId);
	if (!session) return null;
	const sourceSessionId =
		typeof session.source_session_id === "string"
			? session.source_session_id.trim()
			: "";
	if (!sourceSessionId || sourceSessionId.length > 220)
		throw new Error("Session publication identity is invalid");

	const currentPublicationId = id(session.current_session_publication_id);
	if (!currentPublicationId) {
		return {
			currentPublicationId: null,
			version: null,
			sourceDraftId: null,
			payloadSha256: null,
			publishedAt: null,
			sessionStatus:
				typeof session.status === "string" ? session.status : "unknown",
			sourceSessionId,
		};
	}

	const client = editDataClient();
	if (!client) throw new Error("Edit data connection is unavailable");
	const { data, error } = await client
		.from("session_editorial_publications")
		.select("id,version,source_draft_id,payload_sha256,created_at")
		.eq("id", currentPublicationId)
		.eq("session_id", sessionId)
		.maybeSingle();
	if (error) throw new Error("Session publication snapshot unavailable");
	if (!data) throw new Error("Session publication pointer is inconsistent");
	const row = data as unknown as CurrentPublicationRow;
	const version = positiveInteger(row.version);
	const sourceDraftId = id(row.source_draft_id);
	const payloadSha256 = validPublicationHash(row.payload_sha256)
		? row.payload_sha256
		: null;
	const publishedAt =
		typeof row.created_at === "string" && !Number.isNaN(Date.parse(row.created_at))
			? row.created_at
			: null;
	if (!version || !sourceDraftId || !payloadSha256 || !publishedAt)
		throw new Error("Session publication snapshot metadata is invalid");

	return {
		currentPublicationId,
		version,
		sourceDraftId,
		payloadSha256,
		publishedAt,
		sessionStatus:
			typeof session.status === "string" ? session.status : "unknown",
		sourceSessionId,
	};
}

function verifiedCoverRow(
	row: CoverAssetRow,
	sessionId: string,
	campaignId: string,
): {
	assetId: string;
	stagedBucket: string;
	objectKey: string;
	sha256: string;
	mimeType: "image/png" | "image/webp";
	bytes: number;
	width: number;
	height: number;
} | null {
	const assetId = id(row.id);
	const sha256 = isSessionCoverSha256(row.sha256) ? row.sha256 : null;
	const mimeType = isSessionCoverMime(row.mime_type) ? row.mime_type : null;
	const bytes = Number(row.byte_size);
	const width = Number(row.width);
	const height = Number(row.height);
	if (
		!assetId ||
		row.campaign_id !== campaignId ||
		row.role_hint !== "session_cover" ||
		(row.status !== "staged" && row.status !== "verified_public") ||
		row.read_back_verified !== true ||
		!sha256 ||
		!mimeType ||
		!Number.isSafeInteger(bytes) ||
		bytes < 24 ||
		!Number.isSafeInteger(width) ||
		width < 1 ||
		!Number.isSafeInteger(height) ||
		height < 1 ||
		typeof row.staged_bucket !== "string" ||
		typeof row.object_key !== "string"
	)
		return null;
	const expectedKey = sessionCoverObjectKey({
		campaignSlug: CAMPAIGN_SLUG,
		sessionId,
		sha256,
		extension: mimeType === "image/png" ? "png" : "webp",
	});
	if (!expectedKey || row.object_key !== expectedKey) return null;
	return {
		assetId,
		stagedBucket: row.staged_bucket,
		objectKey: row.object_key,
		sha256,
		mimeType,
		bytes,
		width,
		height,
	};
}

export async function prepareSessionPublicationCover(
	sessionId: string,
	coverReference: string,
): Promise<{ assetId: string | null; publicUrl: string }> {
	const raw = coverReference.trim();
	if (!raw) throw new Error("SESSION_PUBLICATION_COVER_REQUIRED");
	if (!isSessionCoverUuid(raw)) {
		const normalized = normalizePublishedSessionCoverReference(raw);
		if (!normalized || !isExistingPublishedSessionCoverReference(normalized))
			throw new Error("SESSION_PUBLICATION_COVER_INVALID");
		return { assetId: null, publicUrl: normalized };
	}

	const session = await publicationSessionRow(sessionId);
	const campaignId = session ? id(session.campaign_id) : null;
	if (!session || !campaignId) throw new Error("SESSION_PUBLICATION_NOT_FOUND");
	const client = editDataClient();
	if (!client) throw new Error("Edit data connection is unavailable");
	const { data, error } = await client
		.from("media_assets")
		.select(
			"id,campaign_id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,public_bucket,public_object_key,public_delivery_verified,public_verified_at",
		)
		.eq("id", raw)
		.eq("campaign_id", campaignId)
		.maybeSingle();
	if (error) throw new Error("SESSION_PUBLICATION_COVER_LOOKUP");
	if (!data) throw new Error("SESSION_PUBLICATION_COVER_INVALID");
	const cover = verifiedCoverRow(
		data as unknown as CoverAssetRow,
		sessionId,
		campaignId,
	);
	if (!cover) throw new Error("SESSION_PUBLICATION_COVER_INVALID");

	const promoted = await promoteSessionCoverToPublic({
		campaignSlug: CAMPAIGN_SLUG,
		sessionId,
		...cover,
	});
	const { data: updated, error: updateError } = await client
		.from("media_assets")
		.update({
			status: "verified_public",
			public_bucket: promoted.publicBucket,
			public_object_key: promoted.publicObjectKey,
			public_delivery_verified: true,
			public_verified_at: promoted.verifiedAt,
			updated_at: promoted.verifiedAt,
		})
		.eq("id", cover.assetId)
		.eq("campaign_id", campaignId)
		.eq("object_key", cover.objectKey)
		.eq("sha256", cover.sha256)
		.eq("read_back_verified", true)
		.select(
			"id,status,public_bucket,public_object_key,public_delivery_verified,public_verified_at",
		)
		.maybeSingle();
	if (
		updateError ||
		!updated ||
		updated.status !== "verified_public" ||
		updated.public_bucket !== WORLD_ENTITY_MEDIA_PUBLIC_BUCKET ||
		updated.public_object_key !== cover.objectKey ||
		updated.public_delivery_verified !== true ||
		!updated.public_verified_at
	)
		throw new Error("SESSION_PUBLICATION_COVER_COMMIT");

	return { assetId: cover.assetId, publicUrl: promoted.publicUrl };
}

type PublishRpcResult = Readonly<Record<string, unknown>>;

async function receiptForOperation(
	operationId: string,
	sessionId: string,
	draftId: string,
	expectedCurrentPublicationId: string | null,
) {
	const client = editDataClient();
	if (!client) return null;
	const { data, error } = await client
		.from("session_editorial_publication_receipts")
		.select(
			"operation_id,operation_kind,session_id,source_draft_id,expected_current_publication_id,publication_id,previous_publication_id,payload_sha256,status",
		)
		.eq("operation_id", operationId)
		.maybeSingle();
	if (error || !data) return null;
	if (
		data.status !== "committed" ||
		data.operation_kind !== "publish" ||
		data.session_id !== sessionId ||
		data.source_draft_id !== draftId ||
		data.expected_current_publication_id !== expectedCurrentPublicationId ||
		!id(data.publication_id) ||
		!validPublicationHash(data.payload_sha256)
	)
		return null;
	return data;
}

export async function commitSessionEditorialPublication(input: {
	authUserId: string;
	actorProfileId: string;
	request: SessionPublicationRequest;
	coverAssetId: string | null;
	coverImageUrl: string;
}): Promise<
	| {
			ok: true;
			replayed: boolean;
			publicationId: string;
			previousPublicationId: string | null;
			payloadSha256: string;
	  }
	| {
			ok: false;
			reason:
				| "forbidden"
				| "not_found"
				| "draft_stale"
				| "transcript_stale"
				| "draft_incomplete"
				| "cover_not_verified"
				| "conflict"
				| "operation_conflict"
				| "dependency_unavailable";
	  }
> {
	const client = editDataClient();
	if (!client) return { ok: false, reason: "dependency_unavailable" };
	const args = {
		p_auth_user_id: input.authUserId,
		p_actor_profile_id: input.actorProfileId,
		p_campaign_slug: CAMPAIGN_SLUG,
		p_session_id: input.request.sessionId,
		p_draft_id: input.request.draftId,
		p_expected_current_publication_id:
			input.request.expectedCurrentPublicationId,
		p_operation_id: input.request.operationId,
		p_cover_asset_id: input.coverAssetId,
		p_cover_image_url: input.coverImageUrl,
	};
	const { data, error } = await client.rpc(
		"publish_session_editorial_snapshot_atomic",
		args,
	);
	let row = (data && typeof data === "object" && !Array.isArray(data)
		? data
		: null) as PublishRpcResult | null;

	if (error || !row) {
		const receipt = await receiptForOperation(
			input.request.operationId,
			input.request.sessionId,
			input.request.draftId,
			input.request.expectedCurrentPublicationId,
		);
		if (!receipt)
			return { ok: false, reason: "dependency_unavailable" };
		row = {
			ok: true,
			replayed: true,
			publicationId: receipt.publication_id,
			previousPublicationId: receipt.previous_publication_id,
			payloadSha256: receipt.payload_sha256,
		};
	}

	if (row.ok !== true) {
		const reason =
			typeof row.reason === "string" ? row.reason : "dependency_unavailable";
		const known = new Set([
			"forbidden",
			"not_found",
			"draft_stale",
			"transcript_stale",
			"draft_incomplete",
			"cover_not_verified",
			"conflict",
			"operation_conflict",
		]);
		return {
			ok: false,
			reason: known.has(reason)
				? (reason as
						| "forbidden"
						| "not_found"
						| "draft_stale"
						| "transcript_stale"
						| "draft_incomplete"
						| "cover_not_verified"
						| "conflict"
						| "operation_conflict")
				: "dependency_unavailable",
		};
	}

	const publicationId = id(row.publicationId);
	const previousPublicationId =
		row.previousPublicationId === null || row.previousPublicationId === undefined
			? null
			: id(row.previousPublicationId);
	const payloadSha256 = validPublicationHash(row.payloadSha256)
		? row.payloadSha256
		: null;
	if (
		!publicationId ||
		(row.previousPublicationId && !previousPublicationId) ||
		!payloadSha256
	)
		return { ok: false, reason: "dependency_unavailable" };
	return {
		ok: true,
		replayed: row.replayed === true,
		publicationId,
		previousPublicationId,
		payloadSha256,
	};
}
