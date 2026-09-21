import { getLembraIdentity } from "@/features/lembra/access";
import {
	LEMBRA_UPLOAD_CHUNK_BYTES,
	isLembraUuid,
} from "@/features/lembra/model";
import {
	lembraPersistenceEnabled,
	writeLembraUploadChunk,
} from "@/features/lembra/server";

export const dynamic = "force-dynamic";

function accessStatus(reason: string) {
	return reason === "unauthenticated" ? 401 : 503;
}

export async function PUT(request: Request) {
	if (!lembraPersistenceEnabled()) {
		return new Response("Lembra media unavailable", { status: 503 });
	}

	const url = new URL(request.url);
	const referenceId = url.searchParams.get("referenceId");
	const uploadId = url.searchParams.get("uploadId");
	const partValue = url.searchParams.get("part");
	const part = partValue === null ? Number.NaN : Number(partValue);

	if (
		!isLembraUuid(referenceId) ||
		!isLembraUuid(uploadId) ||
		!Number.isSafeInteger(part) ||
		part < 0
	) {
		return new Response("Invalid upload target", { status: 400 });
	}

	const origin = request.headers.get("origin");
	if (origin && origin !== url.origin) {
		return new Response("Origin denied", { status: 403 });
	}

	if (request.headers.get("content-type") !== "application/octet-stream") {
		return new Response("Unsupported media type", { status: 415 });
	}

	const declaredLength = Number(request.headers.get("content-length"));
	if (
		Number.isFinite(declaredLength) &&
		(declaredLength < 1 || declaredLength > LEMBRA_UPLOAD_CHUNK_BYTES)
	) {
		return new Response("Chunk too large", { status: 413 });
	}

	const access = await getLembraIdentity();
	if (!access.ok) {
		return new Response("Access denied", {
			status: accessStatus(access.reason),
		});
	}

	try {
		const bytes = new Uint8Array(await request.arrayBuffer());
		if (bytes.length < 1 || bytes.length > LEMBRA_UPLOAD_CHUNK_BYTES) {
			return new Response("Chunk too large", { status: 413 });
		}

		await writeLembraUploadChunk({
			referenceId,
			uploadId,
			part,
			bytes,
		});

		return new Response(null, {
			status: 204,
			headers: { "Cache-Control": "private, no-store" },
		});
	} catch (error) {
		console.error(
			"Lembra chunk upload failed",
			error instanceof Error ? error.message : "unknown_error",
		);
		return new Response("Upload unavailable", { status: 503 });
	}
}
