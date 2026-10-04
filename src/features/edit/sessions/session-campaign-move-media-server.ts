import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
	WORLD_ENTITY_MEDIA_PUBLIC_BUCKET,
} from "@/features/world-explorer/world-entity-media";
import {
	inspectWorldEntityImage,
} from "@/features/world-explorer/world-entity-media-image";
import {
	promoteGovernedImageObject,
	readWorldEntityMediaObject,
	stageGovernedImageObject,
} from "@/features/world-explorer/world-entity-media-server";
import {
	SESSION_COVER_MEDIA_MAX_PIXELS,
	isSessionCoverMime,
	isSessionCoverSha256,
	isSessionCoverUuid,
	sessionCoverObjectKey,
} from "./session-cover-media";

type CoverAssetRow = Readonly<{
	id: unknown;
	campaign_id?: unknown;
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

export type PreparedSessionCampaignMoveCover = Readonly<{
	sourceAssetId: string;
	destinationAssetId: string;
	sha256: string;
	mimeType: "image/png" | "image/webp";
	status: "staged" | "verified_public";
	stagedBucket: string;
	objectKey: string;
	bytes: number;
	width: number;
	height: number;
	publicBucket: string | null;
	publicObjectKey: string | null;
	publicDeliveryVerified: boolean;
	publicVerifiedAt: string | null;
}>;

function positiveInteger(value: unknown): number | null {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parsedAsset(
	row: CoverAssetRow,
	expected: Readonly<{
		assetId?: string;
		campaignId?: string;
		sessionId: string;
		campaignSlug: string;
	}>,
): PreparedSessionCampaignMoveCover | null {
	const assetId =
		typeof row.id === "string" && isSessionCoverUuid(row.id) ? row.id : null;
	const sha256 = isSessionCoverSha256(row.sha256) ? row.sha256 : null;
	const mimeType = isSessionCoverMime(row.mime_type) ? row.mime_type : null;
	const bytes = positiveInteger(row.byte_size);
	const width = positiveInteger(row.width);
	const height = positiveInteger(row.height);
	const status =
		row.status === "staged" || row.status === "verified_public"
			? row.status
			: null;
	if (
		!assetId ||
		(expected.assetId && assetId !== expected.assetId) ||
		(expected.campaignId && row.campaign_id !== expected.campaignId) ||
		!sha256 ||
		!mimeType ||
		bytes === null ||
		width === null ||
		height === null ||
		!status ||
		row.role_hint !== "session_cover" ||
		row.read_back_verified !== true ||
		typeof row.staged_bucket !== "string"
	) {
		return null;
	}
	const extension = mimeType === "image/png" ? "png" : "webp";
	const objectKey = sessionCoverObjectKey({
		campaignSlug: expected.campaignSlug,
		sessionId: expected.sessionId,
		sha256,
		extension,
	});
	if (!objectKey || row.object_key !== objectKey) return null;

	const publicBucket =
		typeof row.public_bucket === "string" ? row.public_bucket : null;
	const publicObjectKey =
		typeof row.public_object_key === "string" ? row.public_object_key : null;
	const publicVerifiedAt =
		typeof row.public_verified_at === "string" && row.public_verified_at
			? row.public_verified_at
			: null;
	const publicDeliveryVerified = row.public_delivery_verified === true;
	if (
		status === "verified_public" &&
		(publicBucket !== WORLD_ENTITY_MEDIA_PUBLIC_BUCKET ||
			publicObjectKey !== objectKey ||
			!publicDeliveryVerified ||
			!publicVerifiedAt)
	) {
		return null;
	}

	return {
		sourceAssetId: assetId,
		destinationAssetId: assetId,
		sha256,
		mimeType,
		status,
		stagedBucket: row.staged_bucket,
		objectKey,
		bytes,
		width,
		height,
		publicBucket,
		publicObjectKey,
		publicDeliveryVerified,
		publicVerifiedAt,
	};
}

async function assetById(
	client: SupabaseClient,
	campaignId: string,
	assetId: string,
): Promise<CoverAssetRow | null> {
	const { data, error } = await client
		.from("media_assets")
		.select(
			"id,campaign_id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,public_bucket,public_object_key,public_delivery_verified,public_verified_at",
		)
		.eq("campaign_id", campaignId)
		.eq("id", assetId)
		.maybeSingle();
	if (error) throw new Error("SESSION_CAMPAIGN_MOVE_MEDIA_LOOKUP");
	return (data as CoverAssetRow | null) ?? null;
}

async function destinationAsset(
	client: SupabaseClient,
	campaignId: string,
	stagedBucket: string,
	objectKey: string,
): Promise<CoverAssetRow | null> {
	const { data, error } = await client
		.from("media_assets")
		.select(
			"id,campaign_id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified,public_bucket,public_object_key,public_delivery_verified,public_verified_at",
		)
		.eq("campaign_id", campaignId)
		.eq("staged_bucket", stagedBucket)
		.eq("object_key", objectKey)
		.maybeSingle();
	if (error) throw new Error("SESSION_CAMPAIGN_MOVE_MEDIA_DESTINATION_LOOKUP");
	return (data as CoverAssetRow | null) ?? null;
}

export async function prepareSessionCampaignMoveCover(input: Readonly<{
	client: SupabaseClient;
	sessionId: string;
	sourceCampaignId: string;
	sourceCampaignSlug: string;
	destinationCampaignId: string;
	destinationCampaignSlug: string;
	destinationPublic: boolean;
}>): Promise<
	| Readonly<{ kind: "none" | "legacy" }>
	| Readonly<{ kind: "prepared"; cover: PreparedSessionCampaignMoveCover }>
> {
	const { data: session, error: sessionError } = await input.client
		.from("sessions")
		.select("current_editorial_draft_id")
		.eq("id", input.sessionId)
		.eq("campaign_id", input.sourceCampaignId)
		.maybeSingle();
	if (sessionError) throw new Error("SESSION_CAMPAIGN_MOVE_MEDIA_SESSION_LOOKUP");
	if (!session) throw new Error("SESSION_CAMPAIGN_MOVE_MEDIA_SESSION_MISSING");
	if (
		typeof session.current_editorial_draft_id !== "string" ||
		!session.current_editorial_draft_id
	) {
		return { kind: "none" };
	}

	const { data: draft, error: draftError } = await input.client
		.from("session_editorial_drafts")
		.select("cover_asset_id")
		.eq("id", session.current_editorial_draft_id)
		.eq("session_id", input.sessionId)
		.eq("campaign_id", input.sourceCampaignId)
		.maybeSingle();
	if (draftError) throw new Error("SESSION_CAMPAIGN_MOVE_MEDIA_DRAFT_LOOKUP");
	if (!draft) throw new Error("SESSION_CAMPAIGN_MOVE_MEDIA_DRAFT_MISSING");
	const coverReference =
		typeof draft.cover_asset_id === "string" ? draft.cover_asset_id.trim() : "";
	if (!coverReference) return { kind: "none" };
	if (!isSessionCoverUuid(coverReference)) return { kind: "legacy" };

	const sourceRaw = await assetById(
		input.client,
		input.sourceCampaignId,
		coverReference,
	);
	if (!sourceRaw) throw new Error("SESSION_CAMPAIGN_MOVE_MEDIA_SOURCE_MISSING");
	const source = parsedAsset(sourceRaw, {
		assetId: coverReference,
		campaignId: input.sourceCampaignId,
		sessionId: input.sessionId,
		campaignSlug: input.sourceCampaignSlug,
	});
	if (!source) throw new Error("SESSION_CAMPAIGN_MOVE_MEDIA_SOURCE_INVALID");

	const extension = source.mimeType === "image/png" ? "png" : "webp";
	const destinationKey = sessionCoverObjectKey({
		campaignSlug: input.destinationCampaignSlug,
		sessionId: input.sessionId,
		sha256: source.sha256,
		extension,
	});
	if (!destinationKey)
		throw new Error("SESSION_CAMPAIGN_MOVE_MEDIA_DESTINATION_KEY");

	const readBucket =
		source.status === "verified_public" && source.publicBucket
			? source.publicBucket
			: source.stagedBucket;
	const bytes = await readWorldEntityMediaObject({
		bucket: readBucket,
		objectKey: source.objectKey,
	});
	const inspected = inspectWorldEntityImage(bytes);
	if (
		inspected.sha256 !== source.sha256 ||
		inspected.mimeType !== source.mimeType ||
		inspected.bytes !== source.bytes ||
		inspected.width !== source.width ||
		inspected.height !== source.height ||
		inspected.width * inspected.height > SESSION_COVER_MEDIA_MAX_PIXELS
	) {
		throw new Error("SESSION_CAMPAIGN_MOVE_MEDIA_READBACK_MISMATCH");
	}

	const staged = await stageGovernedImageObject({
		objectKey: destinationKey,
		bytes,
		maxPixels: SESSION_COVER_MEDIA_MAX_PIXELS,
	});
	if (
		staged.sha256 !== source.sha256 ||
		staged.mimeType !== source.mimeType ||
		staged.bytes !== source.bytes ||
		staged.width !== source.width ||
		staged.height !== source.height
	) {
		throw new Error("SESSION_CAMPAIGN_MOVE_MEDIA_STAGE_MISMATCH");
	}

	const existingRaw = await destinationAsset(
		input.client,
		input.destinationCampaignId,
		staged.bucket,
		destinationKey,
	);
	const existing = existingRaw
		? parsedAsset(existingRaw, {
				campaignId: input.destinationCampaignId,
				sessionId: input.sessionId,
				campaignSlug: input.destinationCampaignSlug,
			})
		: null;
	if (
		existingRaw &&
		(!existing ||
			existing.sha256 !== source.sha256 ||
			existing.mimeType !== source.mimeType ||
			existing.bytes !== source.bytes ||
			existing.width !== source.width ||
			existing.height !== source.height)
	) {
		throw new Error("SESSION_CAMPAIGN_MOVE_MEDIA_COLLISION");
	}

	const destinationAssetId = existing?.destinationAssetId ?? randomUUID();
	if (
		existing &&
		(
			source.status === "staged" ||
			(!input.destinationPublic && existing.status === "staged")
		)
	) {
		return {
			kind: "prepared",
			cover: {
				...existing,
				sourceAssetId: coverReference,
				destinationAssetId,
				status: "staged",
				publicBucket: null,
				publicObjectKey: null,
				publicDeliveryVerified: false,
				publicVerifiedAt: null,
			},
		};
	}
	if (source.status === "verified_public" && input.destinationPublic) {
		const promoted = await promoteGovernedImageObject({
			stagedBucket: staged.bucket,
			objectKey: staged.objectKey,
			expectedObjectKey: destinationKey,
			info: staged,
			maxPixels: SESSION_COVER_MEDIA_MAX_PIXELS,
		});
		return {
			kind: "prepared",
			cover: {
				sourceAssetId: coverReference,
				destinationAssetId,
				sha256: staged.sha256,
				mimeType: staged.mimeType,
				status: "verified_public",
				stagedBucket: staged.bucket,
				objectKey: staged.objectKey,
				bytes: staged.bytes,
				width: staged.width,
				height: staged.height,
				publicBucket: promoted.publicBucket,
				publicObjectKey: promoted.publicObjectKey,
				publicDeliveryVerified: true,
				publicVerifiedAt: promoted.verifiedAt,
			},
		};
	}

	return {
		kind: "prepared",
		cover: {
			sourceAssetId: coverReference,
			destinationAssetId,
			sha256: staged.sha256,
			mimeType: staged.mimeType,
			status: "staged",
			stagedBucket: staged.bucket,
			objectKey: staged.objectKey,
			bytes: staged.bytes,
			width: staged.width,
			height: staged.height,
			publicBucket: null,
			publicObjectKey: null,
			publicDeliveryVerified: false,
			publicVerifiedAt: null,
		},
	};
}
