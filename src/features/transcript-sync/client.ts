import {
	confirmedReceipt,
	IMPORT_VERSION,
	MAX_IMPORT_BYTES,
	RECEIPT_VERSION,
	type ImportIdentity,
	type ImportReceipt,
} from "./contract";

export type SyncState =
	| { status: "pending"; reason: string }
	| { status: "synchronized"; receipt: ImportReceipt };
export type SyncInput = {
	result: unknown;
	expected: ImportIdentity;
	segmentCount: number;
};
type Transport = (path: string, init: RequestInit) => Promise<Response>;

function failureReason(value: unknown): string | null {
	if (!value || typeof value !== "object") return null;
	const result = value as { ok?: unknown; reason?: unknown };
	return result.ok === false &&
		typeof result.reason === "string" &&
		[
			"unauthenticated",
			"forbidden",
			"import_capability_undefined",
			"invalid_payload",
			"transcript_required",
			"unsupported_version",
			"too_large",
			"hash_mismatch",
			"synthetic_payload",
			"not_found",
			"conflict",
			"dependency_unavailable",
		].includes(result.reason)
		? result.reason
		: null;
}

/** The local token is never accepted here. Both requests use only the web operator's same-origin cookies. */
export async function syncTranscript(
	input: SyncInput,
	signal?: AbortSignal,
	transport: Transport = fetch,
): Promise<SyncState> {
	const post = async (path: string, value: unknown) => {
		const body = JSON.stringify(value);
		if (new TextEncoder().encode(body).byteLength > MAX_IMPORT_BYTES)
			throw new Error("too_large");
		const response = await transport(path, {
			method: "POST",
			credentials: "same-origin",
			redirect: "error",
			headers: { "Content-Type": "application/json" },
			body,
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(15000)])
				: AbortSignal.timeout(15000),
			cache: "no-store",
		});
		const data = await response.json();
		return response.ok || failureReason(data) ? data : null;
	};
	try {
		const imported = await post("/api/transcript-imports", {
			schemaVersion: IMPORT_VERSION,
			result: input.result,
		});
		const importFailure = failureReason(imported);
		if (importFailure) return { status: "pending", reason: importFailure };
		if (
			!imported?.ok ||
			!confirmedReceipt(imported.receipt, input.expected, input.segmentCount)
		)
			return { status: "pending", reason: "import_unconfirmed" };
		const readBack = await post("/api/transcript-imports/receipt", {
			schemaVersion: RECEIPT_VERSION,
			identity: input.expected,
			segmentCount: input.segmentCount,
		});
		const receiptFailure = failureReason(readBack);
		if (receiptFailure) return { status: "pending", reason: receiptFailure };
		if (
			!readBack?.ok ||
			!confirmedReceipt(readBack.receipt, input.expected, input.segmentCount) ||
			readBack.receipt.receiptId !== imported.receipt.receiptId ||
			readBack.receipt.committedAt !== imported.receipt.committedAt
		)
			return { status: "pending", reason: "receipt_unconfirmed" };
		return { status: "synchronized", receipt: readBack.receipt };
	} catch {
		return { status: "pending", reason: "retry_required" };
	}
}
