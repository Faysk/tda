import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
	WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
	WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN,
} from "@/features/world-explorer/world-entity-media";
import { editDataClient } from "@/integrations/supabase/server";
import {
	isExistingPublishedSessionCoverReference,
	isSessionCoverMime,
	isSessionCoverSha256,
	isSessionCoverUuid,
	sessionCoverObjectKey,
} from "./session-cover-media";
import { promoteSessionCover } from "./session-cover-media-server";
import type {
	SessionPublicationRequest,
	SessionPublicationState,
} from "./session-publication-model";

type PublicationSessionRow = Readonly<{
	campaign_id: unknown;
	source_session_id: unknown;
	status: unknown;
	current_session_publication_id: unknown;
}>;

type PublicationRow = Readonly<{
	id: unknown;
	version: unknown;
}>;

type CoverAssetRow = Readonly<{
	id: unknown;
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

export type SessionPublicationContext = SessionPublicationState &
	Readonly<{
		campaignId: string;
		sourceSessionId: string | null;
		sessionStatus: string;
	}>;

function requiredId(value: unknown): string | null {
	return typeof value === "string" && isSessionCoverUuid(value) ? value : null;
}

function positiveSafeInteger(value: unknown): number | null {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function readSessionPublicationContext(
	sessionId: string,
	campaignSlug: string,
): Promise<SessionPublicationContext | null> {
	const client = editDataClient();
	if (!client) throw new Error("Session publication data connection unavailable");

	const { data: raw, error } = await client
		.from("sessions")
		.select(
			"campaign_id,source_session_id,status,current_session_publication_id,campaigns!inner(slug)",
		)
		.eq("id", sessionId)
		.eq("campaigns.slug", campaignSlug)
		.maybeSingle();
	if (error) throw new Error("Session publication lookup unavailable");
	if (!raw) return null;

	const row = raw as unknown as PublicationSessionRow;
	const campaignId = requiredId(row.campaign_id);
	if (!campaignId) throw new Error("Session publication campaign identity invalid");

	const currentPublicationId = requiredId(row.current_session_publication_id);
	let currentVersion = 0;
	if (currentPublicationId) {
		const { data: publicationRaw, error: publicationError } = await client
			.from("session_publications")
			.select("id,version")
			.eq("id", currentPublicationId)
			.eq("session_id", sessionId)
			.eq("campaign_id", campaignId)
			.maybeSingle();
		if (publicationError || !publicationRaw)
			throw new Error("Session publication pointer inconsistent");
		const publication = publicationRaw as unknown as PublicationRow;
		const version = positiveSafeInteger(publication.version);
		if (!requiredId(publication.id) || version === null)
			throw new Error("Session publication metadata invalid");
		currentVersion = version;
	}

	return {
		campaignId,
		sourceSessionId:
			typeof row.source_session_id === "string" && row.source_session_id
				? row.source_session_id
				: null,
		sessionStatus: typeof row.status === "string" ? row.status : "unknown",
		currentPublicationId,
		currentVersion,
	};
}

function normalizeExistingPublicCover(reference: string): string | null {
	const raw = reference.trim();
	if (!isExistingPublishedSessionCoverReference(raw)) return null;
	if (raw.startsWith("/assets/sessions/")) return "https://dnd.faysk.dev" + raw;
	return raw;
}

function verifiedPublicCoverUrl(
	row: CoverAssetRow,
	sessionId: string,
	campaignSlug: string,
): string | null {
	const id = requiredId(row.id);
	const sha256 = isSessionCoverSha256(row.sha256) ? row.sha256 : null;
	const mimeType = isSessionCoverMime(row.mime_type) ? row.mime_type : null;
	const bytes = positiveSafeInteger(row.byte_size);
	const width = positiveSafeInteger(row.width);
	const height = positiveSafeInteger(row.height);
	if (
		!id ||
		row.role_hint !== "session_cover" ||
		row.status !== "verified_public" ||
		row.read_back_verified !== true ||
		row.public_bucket !== WORLD_ENTITY_MEDIA_PUBLIC_BUCKET ||
		row.public_delivery_verified !== true ||
		typeof row.public_verified_at !== "string" ||
		!row.public_verified_at ||
		!sha256 ||
		!mimeType ||
		bytes === null ||
		width === null ||
		height === null
	) {
		return null;
	}
	const extension = mimeType === "image/png" ? "png" : "webp";
	const expectedKey = sessionCoverObjectKey({
		campaignSlug,
		sessionId,
		sha256,
		extension,
	});
	if (
		!expectedKey ||
		row.object_key !== expectedKey ||
		row.public_object_key !== expectedKey
	) {
		return null;
	}
	return WORLD_ENTITY_MEDIA_PUBLIC_ORIGIN + "/" + expectedKey;
}

async function coverAsset(
	client: SupabaseClient,
	campaignId: string,
	assetId: string,
): Promise<CoverAssetRow | null> {
	const { data, error } = await client
		.from("media_assets")
		.select(
			"id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,public_bucket,public_object_key,public_delivery_verified,public_verified_at",
		)
		.eq("campaign_id", campaignId)
		.eq("id", assetId)
		.maybeSingle();
	if (error) throw new Error("Session cover publication lookup unavailable");
	return (data as CoverAssetRow | null) ?? null;
}

export async function prepareSessionCoverForPublication(input: {
	sessionId: string;
	campaignId: string;
	campaignSlug: string;
	coverReference: string;
}): Promise<string | null> {
	const existing = normalizeExistingPublicCover(input.coverReference);
	if (existing) return existing;
	if (!isSessionCoverUuid(input.coverReference)) return null;

	const client = editDataClient();
	if (!client) throw new Error("Session publication data connection unavailable");
	let asset = await coverAsset(client, input.campaignId, input.coverReference);
	if (!asset || asset.role_hint !== "session_cover" || asset.read_back_verified !== true)
		return null;

	const alreadyPublic = verifiedPublicCoverUrl(asset, input.sessionId, input.campaignSlug);
	if (alreadyPublic) return alreadyPublic;
	if (asset.status !== "staged") return null;

	const sha256 = isSessionCoverSha256(asset.sha256) ? asset.sha256 : null;
	const mimeType = isSessionCoverMime(asset.mime_type) ? asset.mime_type : null;
	const bytes = positiveSafeInteger(asset.byte_size);
	const width = positiveSafeInteger(asset.width);
	const height = positiveSafeInteger(asset.height);
	if (
		!sha256 ||
		!mimeType ||
		bytes === null ||
		width === null ||
		height === null ||
		typeof asset.staged_bucket !== "string" ||
		typeof asset.object_key !== "string"
	) {
		return null;
	}

	const extension = mimeType === "image/png" ? "png" : "webp";
	const expectedKey = sessionCoverObjectKey({
		campaignSlug: input.campaignSlug,
		sessionId: input.sessionId,
		sha256,
		extension,
	});
	if (!expectedKey || asset.object_key !== expectedKey) return null;

	const promoted = await promoteSessionCover({
		campaignSlug: input.campaignSlug,
		sessionId: input.sessionId,
		stagedBucket: asset.staged_bucket,
		objectKey: asset.object_key,
		sha256,
		mimeType,
		bytes,
		width,
		height,
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
		.eq("id", input.coverReference)
		.eq("campaign_id", input.campaignId)
		.eq("status", "staged")
		.select(
			"id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,public_bucket,public_object_key,public_delivery_verified,public_verified_at",
		)
		.maybeSingle();

	if (!updateError && updated) {
		return verifiedPublicCoverUrl(
			updated as unknown as CoverAssetRow,
			input.sessionId,
			input.campaignSlug,
		);
	}

	// A concurrent retry may have persisted the same immutable promotion first.
	asset = await coverAsset(client, input.campaignId, input.coverReference);
	return asset ? verifiedPublicCoverUrl(asset, input.sessionId, input.campaignSlug) : null;
}

export async function readCommittedSessionPublication(input: {
	actorProfileId: string;
	request: SessionPublicationRequest;
}): Promise<
	| Readonly<{
			ok: true;
			publicationId: string;
			version: number;
			previousPublicationId: string | null;
			payloadSha256: string;
	  }>
	| Readonly<{ ok: false; reason: "operation_conflict" | "dependency_unavailable" }>
	| null
> {
	const client = editDataClient();
	if (!client)
		return { ok: false, reason: "dependency_unavailable" };

	const { data: raw, error } = await client
		.from("session_publication_operations")
		.select(
			"campaign_id,session_id,draft_id,publication_id,expected_previous_publication_id,payload_sha256,actor_profile_id",
		)
		.eq("operation_id", input.request.operationId)
		.maybeSingle();
	if (error) return { ok: false, reason: "dependency_unavailable" };
	if (!raw) return null;

	const operation = raw as Record<string, unknown>;
	const publicationId = requiredId(operation.publication_id);
	const previousPublicationId =
		operation.expected_previous_publication_id === null
			? null
			: requiredId(operation.expected_previous_publication_id);
	const payloadSha256 =
		typeof operation.payload_sha256 === "string" &&
		/^[a-f0-9]{64}$/u.test(operation.payload_sha256)
			? operation.payload_sha256
			: null;

	if (
		operation.actor_profile_id !== input.actorProfileId ||
		operation.session_id !== input.request.sessionId ||
		operation.draft_id !== input.request.draftId ||
		operation.expected_previous_publication_id !==
			input.request.expectedCurrentPublicationId ||
		!publicationId ||
		(operation.expected_previous_publication_id !== null &&
			!previousPublicationId) ||
		!payloadSha256
	) {
		return { ok: false, reason: "operation_conflict" };
	}

	const { data: publicationRaw, error: publicationError } = await client
		.from("session_publications")
		.select("id,version,payload_sha256")
		.eq("id", publicationId)
		.eq("session_id", input.request.sessionId)
		.maybeSingle();
	if (publicationError || !publicationRaw)
		return { ok: false, reason: "dependency_unavailable" };

	const publication = publicationRaw as Record<string, unknown>;
	const version = positiveSafeInteger(publication.version);
	if (
		publication.id !== publicationId ||
		publication.payload_sha256 !== payloadSha256 ||
		version === null
	) {
		return { ok: false, reason: "dependency_unavailable" };
	}

	return {
		ok: true,
		publicationId,
		version,
		previousPublicationId,
		payloadSha256,
	};
}

export async function persistSessionPublication(input: {
	actorProfileId: string;
	campaignSlug: string;
	request: SessionPublicationRequest;
	publicCoverUrl: string;
}) {
	const client = editDataClient();
	if (!client) return { ok: false as const, reason: "dependency_unavailable" as const };

	const { data, error } = await client.rpc("publish_session_editorial_with_date_atomic", {
		p_actor_profile_id: input.actorProfileId,
		p_campaign_slug: CAMPAIGN_SLUG,
		p_session_id: input.request.sessionId,
		p_draft_id: input.request.draftId,
		p_expected_current_publication_id:
			input.request.expectedCurrentPublicationId,
		p_operation_id: input.request.operationId,
		p_public_cover_url: input.publicCoverUrl,
	});
	if (error || !Array.isArray(data) || data.length !== 1)
		return { ok: false as const, reason: "dependency_unavailable" as const };

	const row = data[0] as Record<string, unknown>;
	if (row.status !== "published" && row.status !== "replay") {
		const reason =
			typeof row.status === "string"
				? row.status
				: "dependency_unavailable";
		return { ok: false as const, reason };
	}

	const publicationId = requiredId(row.publication_id);
	const version = positiveSafeInteger(row.version);
	const previousPublicationId =
		row.previous_publication_id === null
			? null
			: requiredId(row.previous_publication_id);
	const payloadSha256 =
		typeof row.payload_sha256 === "string" &&
		/^[a-f0-9]{64}$/u.test(row.payload_sha256)
			? row.payload_sha256
			: null;
	if (
		!publicationId ||
		version === null ||
		(row.previous_publication_id !== null && !previousPublicationId) ||
		!payloadSha256
	) {
		return { ok: false as const, reason: "dependency_unavailable" as const };
	}

	return {
		ok: true as const,
		publicationId,
		version,
		previousPublicationId,
		payloadSha256,
		replayed: row.status === "replay",
	};
}
