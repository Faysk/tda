import { authorizeSessionCoverTarget } from "@/features/edit/sessions/session-cover-media-access";
import {
	isSessionCoverCampaignKey,
	isSessionCoverMime,
	isSessionCoverSha256,
	isSessionCoverUuid,
	sessionCoverObjectKey,
} from "@/features/edit/sessions/session-cover-media";
import { inspectWorldEntityImage } from "@/features/world-explorer/world-entity-media-image";
import {
	readWorldEntityMediaObject,
	worldEntityMediaEnabled,
} from "@/features/world-explorer/world-entity-media-server";

const PRIVATE_HEADERS = {
	"Cache-Control": "private, no-store",
	"X-Content-Type-Options": "nosniff",
} as const;

type AssetRow = Readonly<{
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
	return new Response(null, { status, headers: PRIVATE_HEADERS });
}

export async function GET(
	_request: Request,
	{
		params,
	}: {
		params: Promise<{
			campaignSlug: string;
			sessionId: string;
			assetId: string;
		}>;
	},
) {
	if (!worldEntityMediaEnabled()) return unavailable();
	const { campaignSlug, sessionId, assetId } = await params;
	if (
		!isSessionCoverCampaignKey(campaignSlug) ||
		!isSessionCoverUuid(sessionId) ||
		!isSessionCoverUuid(assetId)
	)
		return unavailable();

	const access = await authorizeSessionCoverTarget(campaignSlug, sessionId);
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
		const { data, error } = await access.target.client
			.from("media_assets")
			.select(
				"id,status,role_hint,staged_bucket,object_key,sha256,mime_type,byte_size,width,height,read_back_verified",
			)
			.eq("campaign_id", access.target.campaignId)
			.eq("id", assetId)
			.maybeSingle();
		if (error) return unavailable(503);
		if (!data) return unavailable();

		const asset = data as AssetRow;
		if (
			asset.status === "retired" ||
			asset.role_hint !== "session_cover" ||
			asset.read_back_verified !== true ||
			!isSessionCoverMime(asset.mime_type) ||
			!isSessionCoverSha256(asset.sha256) ||
			!Number.isSafeInteger(Number(asset.byte_size)) ||
			Number(asset.byte_size) < 24
		)
			return unavailable();

		const extension = asset.mime_type === "image/png" ? "png" : "webp";
		const expectedKey = sessionCoverObjectKey({
			campaignSlug,
			sessionId,
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
		)
			return unavailable();

		return new Response(Uint8Array.from(bytes).buffer, {
			status: 200,
			headers: {
				...PRIVATE_HEADERS,
				"Content-Type": inspected.mimeType,
				"Content-Length": String(inspected.bytes),
			},
		});
	} catch (error) {
		console.error(
			"Campaign session cover private preview failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return unavailable(503);
	}
}
