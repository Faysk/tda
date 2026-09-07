import {
	MAX_IMPORT_BYTES,
	MAX_SEGMENTS,
	RECEIPT_VERSION,
	SHA256,
	UUID,
	type ImportIdentity,
	type ImportResult,
} from "./contract";
import {
	consumeTranscript,
	queryReceipt,
	type ImportDependencies,
} from "./consumer";

type HttpDependencies = {
	origin: () => string | null;
	identity: () => Promise<
		| { ok: true; authUserId: string }
		| { ok: false; reason: "unauthenticated" | "dependency_unavailable" }
	>;
	consumer: ImportDependencies;
};
function response(result: ImportResult): Response {
	const status = result.ok
		? 200
		: (
				{
					unauthenticated: 401,
					forbidden: 403,
					import_capability_undefined: 503,
					invalid_payload: 400,
					transcript_required: 422,
					unsupported_version: 422,
					too_large: 413,
					hash_mismatch: 422,
					synthetic_payload: 422,
					not_found: 404,
					conflict: 409,
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

async function boundedBody(request: Request): Promise<string | null> {
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.byteLength;
			if (size > MAX_IMPORT_BYTES) {
				await reader.cancel();
				return null;
			}
			chunks.push(next.value);
		}
		return new TextDecoder("utf-8", { fatal: true }).decode(
			Buffer.concat(chunks),
		);
	} finally {
		reader.releaseLock();
	}
}

export function createImportHandler(
	deps: HttpDependencies,
	receiptOnly = false,
) {
	return async (request: Request): Promise<Response> => {
		try {
			const origin = deps.origin();
			if (!origin)
				return response({ ok: false, reason: "dependency_unavailable" });
			if (request.method !== "POST" || request.headers.get("origin") !== origin)
				return response({ ok: false, reason: "forbidden" });
			if (
				request.headers.get("content-type")?.split(";")[0].trim() !==
				"application/json"
			)
				return response({ ok: false, reason: "invalid_payload" });
			const actor = await deps.identity();
			if (!actor.ok) return response(actor);
			const raw = await boundedBody(request);
			if (raw === null) return response({ ok: false, reason: "too_large" });
			if (!receiptOnly)
				return response(
					await consumeTranscript(raw, actor.authUserId, deps.consumer),
				);
			const input = JSON.parse(raw);
			const identity = input?.identity as ImportIdentity | undefined;
			if (
				input?.schemaVersion !== RECEIPT_VERSION ||
				!identity ||
				typeof identity.campaignId !== "string" ||
				!UUID.test(identity.campaignId) ||
				typeof identity.sessionId !== "string" ||
				!UUID.test(identity.sessionId) ||
				identity.sourceSystem !== "local_companion" ||
				typeof identity.sourceSessionId !== "string" ||
				!/^[A-Za-z0-9_-]{1,160}$/u.test(identity.sourceSessionId) ||
				typeof identity.publicationId !== "string" ||
				!SHA256.test(identity.publicationId) ||
				typeof identity.transcriptSha256 !== "string" ||
				!SHA256.test(identity.transcriptSha256) ||
				!Number.isSafeInteger(input.segmentCount) ||
				input.segmentCount < 1 ||
				input.segmentCount > MAX_SEGMENTS
			)
				return response({ ok: false, reason: "invalid_payload" });
			return response(
				await queryReceipt(
					identity,
					input.segmentCount,
					actor.authUserId,
					deps.consumer,
				),
			);
		} catch {
			return response({ ok: false, reason: "invalid_payload" });
		}
	};
}
