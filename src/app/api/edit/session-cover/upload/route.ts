import { CAMPAIGN_SLUG } from "@/features/sessions/model";
import { worldEntityMediaEnabled } from "@/features/world-explorer/world-entity-media-server";
import { authorizeSessionCoverTarget } from "@/features/edit/sessions/session-cover-media-access";
import {
	SESSION_COVER_MEDIA_UPLOAD_CHUNK_BYTES,
	isSessionCoverSha256,
	isSessionCoverUuid,
	sessionCoverUploadChunkCount,
} from "@/features/edit/sessions/session-cover-media";
import { writeSessionCoverPendingUploadChunk } from "@/features/edit/sessions/session-cover-media-server";

export const dynamic = "force-dynamic";

function denied(reason: string): Response {
	if (reason === "unauthenticated")
		return new Response("Access denied", { status: 401 });
	if (reason === "dependency_unavailable")
		return new Response("Upload unavailable", { status: 503 });
	if (reason === "not_found")
		return new Response("Upload target unavailable", { status: 404 });
	return new Response("Access denied", { status: 403 });
}

function header(request: Request, name: string): string {
	return request.headers.get(name)?.trim() ?? "";
}

export async function PUT(request: Request) {
	if (!worldEntityMediaEnabled())
		return new Response("Session media unavailable", { status: 503 });

	const url = new URL(request.url);
	const origin = request.headers.get("origin");
	if (origin && origin !== url.origin)
		return new Response("Origin denied", { status: 403 });
	if (request.headers.get("content-type") !== "application/octet-stream")
		return new Response("Unsupported media type", { status: 415 });

	const sessionId = header(request, "x-tda-session");
	const uploadId = header(request, "x-tda-upload-id");
	const sha256 = header(request, "x-tda-content-sha256");
	const totalBytes = Number(header(request, "x-tda-total-bytes"));
	const part = Number(header(request, "x-tda-part"));
	const chunkCount = sessionCoverUploadChunkCount(totalBytes);

	if (
		!isSessionCoverUuid(sessionId) ||
		!isSessionCoverUuid(uploadId) ||
		!isSessionCoverSha256(sha256) ||
		!chunkCount ||
		!Number.isSafeInteger(part) ||
		part < 0 ||
		part >= chunkCount
	) {
		return new Response("Invalid upload target", { status: 400 });
	}

	const expectedChunkBytes = Math.min(
		SESSION_COVER_MEDIA_UPLOAD_CHUNK_BYTES,
		totalBytes - part * SESSION_COVER_MEDIA_UPLOAD_CHUNK_BYTES,
	);
	const declaredLengthHeader = request.headers.get("content-length");
	if (declaredLengthHeader !== null) {
		const declaredLength = Number(declaredLengthHeader);
		if (
			!Number.isSafeInteger(declaredLength) ||
			declaredLength !== expectedChunkBytes
		) {
			return new Response("Invalid chunk length", { status: 400 });
		}
	}

	const access = await authorizeSessionCoverTarget(CAMPAIGN_SLUG, sessionId);
	if (!access.ok) return denied(access.reason);

	try {
		const bytes = new Uint8Array(await request.arrayBuffer());
		if (bytes.length !== expectedChunkBytes)
			return new Response("Invalid chunk length", { status: 400 });

		await writeSessionCoverPendingUploadChunk({
			campaignSlug: CAMPAIGN_SLUG,
			sessionId,
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
			"Session cover same-origin upload failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return new Response("Upload unavailable", { status: 503 });
	}
}
