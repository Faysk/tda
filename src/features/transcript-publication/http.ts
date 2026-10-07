import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import {
	MAX_PUBLICATION_WIRE_BYTES,
	PUBLICATION_GZIP_CONTENT_TYPE,
} from "./transport-contract";

const decompress = promisify(gunzip);
import {
	MAX_PUBLICATION_REQUEST_BYTES,
	type PublicationResult,
} from "./contract";
import {
	publishTranscriptRevision,
	readPublicationReceipt,
	type PublicationDependencies,
} from "./consumer";

type PublicationHttpDependencies = Readonly<{
	origin: () => string | null;
	identity: () => Promise<
		| { ok: true; authUserId: string }
		| { ok: false; reason: "unauthenticated" | "dependency_unavailable" }
	>;
	publication: PublicationDependencies;
}>;

function response(result: PublicationResult): Response {
	const status = result.ok
		? 200
		: (
				{
					unauthenticated: 401,
					forbidden: 403,
					publish_capability_undefined: 503,
					invalid_payload: 400,
					approved_review_required: 422,
					too_large: 413,
					not_found: 404,
					conflict: 409,
					stale_current: 409,
					dependency_unavailable: 503,
				} as const
			)[result.reason];
	return Response.json(result, {
		status,
		headers: {
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

async function boundedBody(
	request: Request,
	compressed: boolean,
): Promise<string | null> {
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.byteLength;
			if (
				size >
				(compressed
					? MAX_PUBLICATION_WIRE_BYTES
					: MAX_PUBLICATION_REQUEST_BYTES)
			) {
				await reader.cancel();
				return null;
			}
			chunks.push(next.value);
		}
		let bytes = Buffer.concat(chunks);
		if (compressed) {
			try {
				bytes = await decompress(bytes, {
					maxOutputLength: MAX_PUBLICATION_REQUEST_BYTES,
				});
			} catch (cause) {
				if (
					cause &&
					typeof cause === "object" &&
					"code" in cause &&
					cause.code === "ERR_BUFFER_TOO_LARGE"
				)
					return null;
				throw cause;
			}
		}
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} finally {
		reader.releaseLock();
	}
}

export function createPublicationHandler(
	deps: PublicationHttpDependencies,
	receiptOnly = false,
) {
	return async (request: Request): Promise<Response> => {
		try {
			const origin = deps.origin();
			if (!origin)
				return response({ ok: false, reason: "dependency_unavailable" });
			if (request.method !== "POST" || request.headers.get("origin") !== origin)
				return response({ ok: false, reason: "forbidden" });
			const contentType = request.headers
				.get("content-type")
				?.split(";")[0]
				.trim();
			const compressed = contentType === PUBLICATION_GZIP_CONTENT_TYPE;
			if (contentType !== "application/json" && !compressed)
				return response({ ok: false, reason: "invalid_payload" });

			const identity = await deps.identity();
			if (!identity.ok) return response(identity);
			const raw = await boundedBody(request, compressed);
			if (raw === null) return response({ ok: false, reason: "too_large" });

			return response(
				await (receiptOnly
					? readPublicationReceipt(raw, identity.authUserId, deps.publication)
					: publishTranscriptRevision(
							raw,
							identity.authUserId,
							deps.publication,
						)),
			);
		} catch {
			return response({ ok: false, reason: "invalid_payload" });
		}
	};
}
