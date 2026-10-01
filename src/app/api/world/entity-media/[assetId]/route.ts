import {
	isWorldEntityMediaAssetId,
	isWorldEntityMediaMime,
	worldEntityPortraitObjectKey,
} from "@/features/world-explorer/world-entity-media";
import { authorizeWorldEntityMediaAsset } from "@/features/world-explorer/world-entity-media-access";
import { inspectWorldEntityImage } from "@/features/world-explorer/world-entity-media-image";
import {
	readWorldEntityMediaObject,
	worldEntityMediaEnabled,
} from "@/features/world-explorer/world-entity-media-server";

const PRIVATE_MEDIA_HEADERS = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
} as const;

type MediaAssetRow = Readonly<{
	id: string;
	status: "staged" | "verified_public" | "retired";
	role_hint: string;
	staged_bucket: string;
	object_key: string;
	sha256: string;
	mime_type: string;
	byte_size: number | string;
	width: number;
	height: number;
	read_back_verified: boolean;
}>;

function unavailable(status = 404): Response {
	return new Response(null, { status, headers: PRIVATE_MEDIA_HEADERS });
}

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ assetId: string }> },
) {
	if (!worldEntityMediaEnabled()) return unavailable();
	const { assetId } = await params;
	if (!isWorldEntityMediaAssetId(assetId)) return unavailable();

	const access = await authorizeWorldEntityMediaAsset(assetId);
	if (!access.ok) {
		const status =
			access.reason === "unauthenticated"
				? 401
				: access.reason === "dependency_unavailable"
					? 503
					: access.reason === "not_found"
						? 404
						: 403;
		return unavailable(status);
	}

	try {
		const { campaignId, campaignTechnicalSlug, client } = access.target;
		const { data, error } = await client
			.from("media_assets")
			.select(
				"id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified",
			)
			.eq("campaign_id", campaignId)
			.eq("id", assetId)
			.maybeSingle();
		if (error) return unavailable(503);
		if (!data) return unavailable();

		const asset = data as MediaAssetRow;
		if (
			asset.status === "retired" ||
			asset.role_hint !== "portrait" ||
			asset.read_back_verified !== true ||
			!isWorldEntityMediaMime(asset.mime_type) ||
			!Number.isSafeInteger(Number(asset.byte_size)) ||
			Number(asset.byte_size) < 24
		) {
			return unavailable();
		}

		const pattern = new RegExp(
			`^campaigns/${campaignTechnicalSlug}/entities/([0-9a-f-]{36})/portrait/([a-f0-9]{64})\\.(png|webp)$`,
			"u",
		);
		const match = pattern.exec(asset.object_key);
		if (!match || match[2] !== asset.sha256) return unavailable();
		const entityId = match[1];
		const extension = asset.mime_type === "image/png" ? "png" : "webp";
		const expectedKey = worldEntityPortraitObjectKey({
			campaignSlug: campaignTechnicalSlug,
			entityId,
			sha256: asset.sha256,
			extension,
		});
		if (!expectedKey || expectedKey !== asset.object_key) return unavailable();

		const bytes = await readWorldEntityMediaObject({
			bucket: asset.staged_bucket,
			objectKey: asset.object_key,
		});
		const inspected = inspectWorldEntityImage(bytes);
		if (
			inspected.sha256 !== asset.sha256 ||
			inspected.mimeType !== asset.mime_type ||
			inspected.bytes !== Number(asset.byte_size) ||
			inspected.width !== asset.width ||
			inspected.height !== asset.height
		) {
			return unavailable();
		}

		return new Response(Uint8Array.from(bytes).buffer, {
			status: 200,
			headers: {
				...PRIVATE_MEDIA_HEADERS,
				"Content-Type": inspected.mimeType,
				"Content-Length": String(inspected.bytes),
			},
		});
	} catch (error) {
		console.error(
			"World entity media preview failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return unavailable(503);
	}
}
