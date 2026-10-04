"use client";

import type {
	SessionAssembly,
	SessionAssemblyReviewSummary,
} from "./session-composer-protocol";
import {
	MULTI_SOURCE_PUBLICATION_RECEIPT_VERSION,
	prepareMultiSourceCanonicalPublication,
} from "../../transcript-publication/multi-source-canonical";
import {
	PublicationClientError,
	type PublicationReceiptView,
} from "./publication-client";

type Transport = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function sessionAssemblyPublicationRequestBody(
	assembly: SessionAssembly,
	review: SessionAssemblyReviewSummary,
	operationId: string,
	expectedCurrentRevisionId: string | null,
	expectedActorProfileId?: string,
) {
	if (
		review.assemblyId !== assembly.assemblyId ||
		review.baseTranscriptSha256 !== assembly.transcriptSha256 ||
		review.persistence !== "persisted" ||
		review.draftRevision === null ||
		review.draftSha256 === null ||
		review.status !== "approved_local" ||
		!review.approvalCurrent
	)
		throw new PublicationClientError("approved_review_required");

	return {
		schemaVersion: "tda_transcript_publication_request_v2",
		operationId,
		expectedCurrentRevisionId,
		...(expectedActorProfileId === undefined ? {} : { expectedActorProfileId }),
		target: {
			schemaVersion: "tda_publication_session_target_v1",
			campaignSlug: assembly.campaignId,
			sourceSessionId: assembly.sessionId,
		},
		assembly: {
			schemaVersion: "tda_session_assembly_v1",
			canonicalizationVersion: assembly.canonicalizationVersion,
			assemblyId: assembly.assemblyId,
			inputsSha256: assembly.inputsSha256,
			campaignId: assembly.campaignId,
			sessionId: assembly.sessionId,
			transcriptSha256: assembly.transcriptSha256,
			timingPolicyVersion: assembly.timingPolicyVersion,
			segmentBoundaryPolicy: assembly.segmentBoundaryPolicy,
			timelineFingerprintSha256: assembly.timelineFingerprintSha256,
			...(assembly.canonicalizationVersion ===
			"tda_session_assembly_canonical_v2"
				? {
						timelineStrategy: assembly.timelineStrategy,
						wallClock: assembly.wallClock,
						unknownIntervalCount: assembly.unknownIntervalCount,
					}
				: {}),
			participantMappingSchemaVersion:
				"tda_session_participant_mapping_v1",
			participantMappingPolicy: "strong_discord_or_manual_v1",
			participantMappingSha256: assembly.participantMappingSha256,
			parts: assembly.parts.map((part) => ({
				partId: part.partId,
				sourceId: part.sourceId,
				sourceSha256: part.sourceSha256,
				runId: part.runId,
				transcriptSha256: part.transcriptSha256,
				ordinal: part.ordinal,
				sessionOffsetSeconds: part.sessionOffsetSeconds,
				trimStartSeconds: part.trimStartSeconds,
				trimEndSeconds: part.trimEndSeconds,
				overlapResolution: part.overlapResolution,
				overlapBoundarySeconds: part.overlapBoundarySeconds,
				...(assembly.canonicalizationVersion ===
				"tda_session_assembly_canonical_v2"
					? { physicalIntervalState: part.physicalIntervalState }
					: {}),
			})),
		},
		review: {
			baseTranscriptSha256: review.baseTranscriptSha256,
			draftRevision: review.draftRevision,
			draftSha256: review.draftSha256,
			status: review.status,
			warnings: [],
			review: {
				reviewedSegments: review.reviewedSegments,
				totalSegments: review.segmentCount,
				reviewPercent: review.reviewPercent,
				editedSegments: review.editedSegments,
				wordCount: review.wordCount,
				warningCount: 0,
			},
			segments: review.segments.map((segment) => ({
				assemblySegmentId: segment.assemblySegmentId,
				partId: segment.partId,
				sourceId: segment.sourceId,
				runId: segment.runId,
				sourceSegmentId: segment.sourceSegmentId,
				trackNumber: segment.trackNumber,
				start: segment.start,
				end: segment.end,
				...(segment.absoluteTime === undefined
					? {}
					: { absoluteTime: segment.absoluteTime }),
				text: segment.text,
				speaker: segment.speaker,
				reviewed: segment.reviewed,
			})),
		},
	};
}

function prepare(
	assembly: SessionAssembly,
	review: SessionAssemblyReviewSummary,
	operationId: string,
	expectedCurrentRevisionId: string | null,
	expectedActorProfileId?: string,
) {
	let raw: string;
	try {
		raw = JSON.stringify(
			sessionAssemblyPublicationRequestBody(
				assembly,
				review,
				operationId,
				expectedCurrentRevisionId,
				expectedActorProfileId,
			),
		);
	} catch (cause) {
		if (cause instanceof PublicationClientError) throw cause;
		throw new PublicationClientError("invalid_payload");
	}
	const prepared = prepareMultiSourceCanonicalPublication(raw);
	if (!prepared.ok)
		throw new PublicationClientError(
			prepared.reason === "approved_review_required"
				? "approved_review_required"
				: prepared.reason === "too_large"
					? "too_large"
					: "invalid_payload",
		);
	return { raw, prepared: prepared.value };
}

function parseFailure(value: unknown): PublicationClientError["code"] {
	if (!value || typeof value !== "object")
		return "dependency_unavailable";
	const reason = (value as { reason?: unknown }).reason;
	return typeof reason === "string" &&
		[
			"unauthenticated",
			"forbidden",
			"publish_capability_undefined",
			"invalid_payload",
			"approved_review_required",
			"too_large",
			"not_found",
			"conflict",
			"stale_current",
			"dependency_unavailable",
		].includes(reason)
		? (reason as PublicationClientError["code"])
		: "dependency_unavailable";
}

async function post(path: string, body: string, transport: Transport) {
	return transport(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		cache: "no-store",
		redirect: "error",
		body,
	});
}

async function receipt(
	response: Response,
	assembly: SessionAssembly,
	review: SessionAssemblyReviewSummary,
	operationId: string,
): Promise<PublicationReceiptView> {
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new PublicationClientError("dependency_unavailable");
	}
	if (!response.ok) throw new PublicationClientError(parseFailure(body));
	if (!body || typeof body !== "object")
		throw new PublicationClientError("dependency_unavailable");
	const raw = (body as { receipt?: unknown }).receipt;
	if (!raw || typeof raw !== "object")
		throw new PublicationClientError("dependency_unavailable");
	const value = raw as Record<string, unknown>;
	if (
		value.schemaVersion !== MULTI_SOURCE_PUBLICATION_RECEIPT_VERSION ||
		value.status !== "committed" ||
		typeof value.receiptId !== "string" ||
		!UUID.test(value.receiptId) ||
		typeof value.revisionId !== "string" ||
		!UUID.test(value.revisionId) ||
		!Number.isSafeInteger(value.revisionNumber) ||
		(value.revisionNumber as number) < 1 ||
		typeof value.committedAt !== "string" ||
		!Number.isFinite(Date.parse(value.committedAt)) ||
		value.operationId !== operationId ||
		value.assemblyId !== assembly.assemblyId ||
		value.partCount !== assembly.parts.length ||
		value.baseTranscriptSha256 !== review.baseTranscriptSha256 ||
		value.draftSha256 !== review.draftSha256 ||
		value.segmentCount !== review.segments.length ||
		value.wordCount !== review.wordCount
	)
		throw new PublicationClientError("conflict");
	return {
		receiptId: value.receiptId,
		revisionId: value.revisionId,
		revisionNumber: value.revisionNumber as number,
		committedAt: value.committedAt,
	};
}

export async function readCurrentSessionAssemblyPublication(
	assembly: SessionAssembly,
	transport: Transport = fetch,
): Promise<{ actorProfileId: string; revisionId: string | null }> {
	const response = await post(
		"/api/transcript-publications/current",
		JSON.stringify({
			campaignSlug: assembly.campaignId,
			sourceSessionId: assembly.sessionId,
		}),
		transport,
	);
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new PublicationClientError("dependency_unavailable");
	}
	if (!response.ok) throw new PublicationClientError(parseFailure(body));
	const current =
		body && typeof body === "object"
			? (body as { current?: unknown }).current
			: null;
	if (!current || typeof current !== "object")
		throw new PublicationClientError("dependency_unavailable");
	const value = current as Record<string, unknown>;
	if (
		typeof value.actorProfileId !== "string" ||
		!UUID.test(value.actorProfileId) ||
		(value.revisionId !== null &&
			(typeof value.revisionId !== "string" || !UUID.test(value.revisionId)))
	)
		throw new PublicationClientError("dependency_unavailable");
	return {
		actorProfileId: value.actorProfileId,
		revisionId: value.revisionId as string | null,
	};
}

export async function publishApprovedSessionAssemblyReview(
	assembly: SessionAssembly,
	review: SessionAssemblyReviewSummary,
	operationId: string,
	expectedCurrentRevisionId: string | null,
	transport: Transport = fetch,
	expectedActorProfileId?: string,
): Promise<PublicationReceiptView> {
	const { raw } = prepare(
		assembly,
		review,
		operationId,
		expectedCurrentRevisionId,
		expectedActorProfileId,
	);
	try {
		return await receipt(
			await post("/api/transcript-publications", raw, transport),
			assembly,
			review,
			operationId,
		);
	} catch (cause) {
		if (
			cause instanceof PublicationClientError &&
			cause.code !== "dependency_unavailable"
		)
			throw cause;
	}
	try {
		return await receipt(
			await post("/api/transcript-publications/receipt", raw, transport),
			assembly,
			review,
			operationId,
		);
	} catch (cause) {
		if (
			cause instanceof PublicationClientError &&
			cause.code !== "not_found" &&
			cause.code !== "dependency_unavailable"
		)
			throw cause;
		throw new PublicationClientError("unconfirmed");
	}
}
