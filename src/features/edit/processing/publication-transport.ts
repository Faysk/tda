import { MAX_PUBLICATION_REQUEST_BYTES } from "../../transcript-publication/canonical";
import {
	MAX_PUBLICATION_WIRE_BYTES,
	PUBLICATION_COMPRESSION_THRESHOLD_BYTES,
	PUBLICATION_GZIP_CONTENT_TYPE,
} from "../../transcript-publication/transport-contract";

export async function encodePublicationTransport(
	raw: string,
): Promise<
	| { ok: true; body: string | Blob; contentType: string }
	| { ok: false; reason: "too_large" | "dependency_unavailable" }
> {
	const bytes = new TextEncoder().encode(raw).byteLength;
	if (bytes > MAX_PUBLICATION_REQUEST_BYTES)
		return { ok: false, reason: "too_large" };
	if (bytes <= PUBLICATION_COMPRESSION_THRESHOLD_BYTES)
		return { ok: true, body: raw, contentType: "application/json" };
	try {
		const body = await new Response(
			new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip")),
		).blob();
		if (body.size > MAX_PUBLICATION_WIRE_BYTES)
			return { ok: false, reason: "too_large" };
		return { ok: true, body, contentType: PUBLICATION_GZIP_CONTENT_TYPE };
	} catch {
		return { ok: false, reason: "dependency_unavailable" };
	}
}
