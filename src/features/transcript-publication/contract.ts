import { MULTI_SOURCE_PUBLICATION_RECEIPT_VERSION } from "./multi-source-canonical";
import { createHash } from "node:crypto";
import {
	PUBLICATION_RECEIPT_VERSION,
	prepareCanonicalPublication,
	type CanonicalPreparedPublication,
	type PublicationFailure,
	type PublicationReceipt,
	type PublicationResult,
	UUID,
} from "./canonical";

export {
	MULTI_SOURCE_PROVENANCE_VERSION,
	MULTI_SOURCE_PUBLICATION_PAYLOAD_VERSION,
	MULTI_SOURCE_PUBLICATION_RECEIPT_VERSION,
	MULTI_SOURCE_PUBLICATION_REQUEST_VERSION,
} from "./multi-source-canonical";
export type {
	CanonicalMultiSourcePart,
	CanonicalMultiSourceProvenance,
} from "./multi-source-canonical";

export {
	MAX_PUBLICATION_PAYLOAD_BYTES,
	MAX_PUBLICATION_REQUEST_BYTES,
	MAX_PUBLICATION_SEGMENTS,
	PUBLICATION_PAYLOAD_VERSION,
	PUBLICATION_RECEIPT_VERSION,
	PUBLICATION_REQUEST_VERSION,
	SHA256,
	UUID,
} from "./canonical";
export type {
	PublicationFailure,
	PublicationReceipt,
	PublicationResult,
	PublicationTarget,
} from "./canonical";

export type PreparedPublication = Readonly<
	Omit<CanonicalPreparedPublication, "payloadBytes"> & {
		payloadSha256: string;
	}
>;

export type PreparePublicationResult =
	| Readonly<{ ok: true; value: PreparedPublication }>
	| Readonly<{ ok: false; reason: PublicationFailure }>;

export function sha256Utf8(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

export function preparePublication(raw: string): PreparePublicationResult {
	const canonical = prepareCanonicalPublication(raw);
	if (!canonical.ok) return { ok: false, reason: canonical.reason };
	const { payloadBytes: _payloadBytes, ...value } = canonical.value;
	return {
		ok: true,
		value: {
			...value,
			payloadSha256: sha256Utf8(value.payloadJson),
		},
	};
}

export function confirmedPublicationReceipt(
	receipt: PublicationReceipt,
	expected: PreparedPublication & { campaignId: string; sessionId: string },
): boolean {
	const common =
		receipt.status === "committed" &&
		UUID.test(receipt.receiptId) &&
		receipt.campaignId === expected.campaignId &&
		receipt.sessionId === expected.sessionId &&
		UUID.test(receipt.revisionId) &&
		Number.isSafeInteger(receipt.revisionNumber) &&
		receipt.revisionNumber > 0 &&
		receipt.operationId === expected.operationId &&
		receipt.baseTranscriptSha256 === expected.baseTranscriptSha256 &&
		receipt.draftSha256 === expected.draftSha256 &&
		receipt.payloadSha256 === expected.payloadSha256 &&
		receipt.segmentCount === expected.segmentCount &&
		Number.isSafeInteger(receipt.wordCount) &&
		receipt.wordCount >= 0 &&
		Number.isFinite(Date.parse(receipt.committedAt));
	if (!common) return false;
	if (expected.publicationKind === "single_source") {
		return (
			receipt.schemaVersion === PUBLICATION_RECEIPT_VERSION &&
			receipt.sourceId === expected.sourceId &&
			receipt.runId === expected.runId
		);
	}
	return (
		receipt.schemaVersion === MULTI_SOURCE_PUBLICATION_RECEIPT_VERSION &&
		receipt.assemblyId === expected.provenance?.assembly_id &&
		receipt.partCount === expected.provenance?.parts.length
	);
}
