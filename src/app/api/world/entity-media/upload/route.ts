import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { authorizeWorldEntityMediaTarget } from "@/features/world-explorer/world-entity-media-access";
import {
	WORLD_ENTITY_MEDIA_UPLOAD_CHUNK_BYTES,
	isWorldEntityMediaAssetId,
	isWorldEntityMediaSha256,
	worldEntityMediaUploadChunkCount,
} from "@/features/world-explorer/world-entity-media";
import {
	worldEntityMediaEnabled,
	writeWorldEntityPortraitPendingUploadChunk,
} from "@/features/world-explorer/world-entity-media-server";

export const dynamic = "force-dynamic";

function denied(reason: string): Response {
	if (reason === "unauthenticated") return new Response("Access denied", { status: 401 });
	if (reason === "dependency_unavailable") return new Response("Upload unavailable", { status: 503 });
	return new Response("Access denied", { status: 403 });
}

function exactHeader(request: Request, name: string): string {
	return request.headers.get(name)?.trim() ?? "";
}

export async function PUT(request: Request) {
	if (!worldEntityMediaEnabled()) {
		return new Response("World media unavailable", { status: 503 });
	}

	const url = new URL(request.url);
	const origin = request.headers.get("origin");
	if (origin && origin !== url.origin) {
		return new Response("Origin denied", { status: 403 });
	}
	if (request.headers.get("content-type") !== "application/octet-stream") {
		return new Response("Unsupported media type", { status: 415 });
	}

	const leaseToken = exactHeader(request, "x-tda-world-lease");
	const entityId = exactHeader(request, "x-tda-world-entity");
	const uploadId = exactHeader(request, "x-tda-upload-id");
	const sha256 = exactHeader(request, "x-tda-content-sha256");
	const totalBytes = Number(exactHeader(request, "x-tda-total-bytes"));
	const part = Number(exactHeader(request, "x-tda-part"));
	const chunkCount = worldEntityMediaUploadChunkCount(totalBytes);

	if (
		!isWorldEntityMediaAssetId(leaseToken) ||
		!isWorldEntityMediaAssetId(entityId) ||
		!isWorldEntityMediaAssetId(uploadId) ||
		!isWorldEntityMediaSha256(sha256) ||
		!chunkCount ||
		!Number.isSafeInteger(part) ||
		part < 0 ||
		part >= chunkCount
	) {
		return new Response("Invalid upload target", { status: 400 });
	}

	const expectedChunkBytes = Math.min(
		WORLD_ENTITY_MEDIA_UPLOAD_CHUNK_BYTES,
		totalBytes - part * WORLD_ENTITY_MEDIA_UPLOAD_CHUNK_BYTES,
	);
	const declaredLength = Number(request.headers.get("content-length"));
	if (
		Number.isFinite(declaredLength) &&
		declaredLength !== expectedChunkBytes
	) {
		return new Response("Invalid chunk length", { status: 400 });
	}

	const access = await authorizeWorldEntityMediaTarget(leaseToken, entityId);
	if (!access.ok) return denied(access.reason);

	try {
		const bytes = new Uint8Array(await request.arrayBuffer());
		if (bytes.length !== expectedChunkBytes) {
			return new Response("Invalid chunk length", { status: 400 });
		}
		await writeWorldEntityPortraitPendingUploadChunk({
			campaignSlug: CAMPAIGN_SLUG,
			entityId,
			uploadId,
			sha256,
			part,
			bytes,
		});
		return new Response(null, {
			status: 204,
			headers: { "Cache-Control": "private, no-store" },
		});
	} catch (error) {
		console.error(
			"World entity media same-origin upload failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return new Response("Upload unavailable", { status: 503 });
	}
}
