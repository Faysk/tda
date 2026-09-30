"use client";

import {
	MAX_PUBLICATION_PAYLOAD_BYTES,
	prepareCanonicalPublication,
	type PublicationFailure,
} from "@/features/transcript-publication/canonical";
import {
	MULTI_SOURCE_PUBLICATION_REQUEST_VERSION,
} from "@/features/transcript-publication/multi-source-canonical";
import type {
	SessionAssembly,
	SessionAssemblyReviewSummary,
} from "./session-composer-protocol";

export type AssemblyPublicationReceipt = Readonly<{
	receiptId: string;
	revisionId: string;
	revisionNumber: number;
	committedAt: string;
}>;

export class AssemblyPublicationClientError extends Error {
	constructor(
		readonly code:
			| PublicationFailure
			| "unconfirmed",
	) {
		super(code);
		this.name = "AssemblyPublicationClientError";
	}
}

type Transport = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

function failure(value: unknown): AssemblyPublicationClientError["code"] {
	if (!value || typeof value !== "object" || Array.isArray(value))
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
		? (reason as PublicationFailure)
		: "dependency_unavailable";
}

export function assemblyPublicationRequestBody(
	assembly: SessionAssembly,
	review: SessionAssemblyReviewSummary,
	operationId: string,
	expectedCurrentRevisionId: string | null,
	expectedActorProfileId?: string,
) {
	if (
		review.assemblyId !== assembly.assemblyId ||
		review.baseTranscriptSha256 !== assembly.transcriptSha256 ||
		review.inputsSha256 !== assembly.inputsSha256 ||
		review.persistence !== "persisted" ||
		review.draftRevision === null ||
		review.draftSha256 === null ||
		review.status !== "approved_local" ||
		!review.approvalCurrent
	)
		throw new AssemblyPublicationClientError("approved_review_required");

	return {
		schemaVersion: MULTI_SOURCE_PUBLICATION_REQUEST_VERSION,
		operationId,
		expectedCurrentRevisionId,
		...(expectedActorProfileId === undefined
			? {}
			: { expectedActorProfileId }),
		target: {
			schemaVersion: "tda_publication_session_target_v1",
			campaignSlug: assembly.campaignId,
			sourceSessionId: assembly.sessionId,
		},
		assembly: {
			schemaVersion: assembly.schemaVersion,
			canonicalizationVersion: assembly.canonicalizationVersion,
			assemblyId: assembly.assemblyId,
			inputsSha256: assembly.inputsSha256,
			campaignId: assembly.campaignId,
			sessionId: assembly.sessionId,
			transcriptSha256: assembly.transcriptSha256,
			timingPolicyVersion: assembly.timingPolicyVersion,
			segmentBoundaryPolicy: assembly.segmentBoundaryPolicy,
			timelineFingerprintSha256: assembly.timelineFingerprintSha256,
			participantMappingSchemaVersion:
				assembly.participantMappingSchemaVersion,
			participantMappingPolicy: assembly.participantMappingPolicy,
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
			})),
		},
		review: {
			baseTranscriptSha256: review.baseTranscriptSha256,
			draftRevision: review.draftRevision,
			draftSha256: review.draftSha256,
			status: review.status,
			warnings: review.warnings,
			warningSummary: {
				totalCount: review.warningSummary.totalCount,
				displayedCount: review.warningSummary.displayedCount,
				truncated: review.warningSummary.truncated,
			},
			review: {
				reviewedSegments: review.reviewedSegments,
				totalSegments: review.segmentCount,
				reviewPercent: review.reviewPercent,
				editedSegments: review.editedSegments,
				wordCount: review.wordCount,
				warningCount: review.warningCount,
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
				absoluteStart: segment.absoluteStart,
				absoluteEnd: segment.absoluteEnd,
				text: segment.text,
				speaker: segment.speaker,
				reviewed: segment.reviewed,
			})),
		},
	};
}

export function preflightAssemblyPublication(
	assembly: SessionAssembly,
	review: SessionAssemblyReviewSummary,
) {
	try {
		const raw = JSON.stringify(
			assemblyPublicationRequestBody(
				assembly,
				review,
				"00000000-0000-4000-8000-000000000000",
				null,
			),
		);
		const prepared = prepareCanonicalPublication(raw);
		return prepared.ok
			? {
					eligible: true as const,
					reason: null,
					payloadBytes: prepared.value.payloadBytes,
					maxPayloadBytes: MAX_PUBLICATION_PAYLOAD_BYTES,
				}
			: {
					eligible: false as const,
					reason: prepared.reason,
					payloadBytes: prepared.payloadBytes ?? null,
					maxPayloadBytes: MAX_PUBLICATION_PAYLOAD_BYTES,
				};
	} catch (cause) {
		return {
			eligible: false as const,
			reason:
				cause instanceof AssemblyPublicationClientError
					? cause.code
					: ("invalid_payload" as const),
			payloadBytes: null,
			maxPayloadBytes: MAX_PUBLICATION_PAYLOAD_BYTES,
		};
	}
}

async function post(
	path: string,
	body: string,
	transport: Transport,
): Promise<Response> {
	return transport(path, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		cache: "no-store",
		redirect: "error",
		body,
	});
}

async function parseReceipt(
	response: Response,
	assembly: SessionAssembly,
	review: SessionAssemblyReviewSummary,
	operationId: string,
): Promise<AssemblyPublicationReceipt> {
	let body: unknown;
	try {
		body = await response.json();
	} catch {
		throw new AssemblyPublicationClientError("dependency_unavailable");
	}
	if (!response.ok)
		throw new AssemblyPublicationClientError(failure(body));
	if (!body || typeof body !== "object" || Array.isArray(body))
		throw new AssemblyPublicationClientError("dependency_unavailable");
	const receipt = (body as { receipt?: unknown }).receipt;
	if (!receipt || typeof receipt !== "object" || Array.isArray(receipt))
		throw new AssemblyPublicationClientError("dependency_unavailable");
	const value = receipt as Record<string, unknown>;
	if (
		value.schemaVersion !== "tda_transcript_publication_receipt_v2" ||
		value.status !== "committed" ||
		typeof value.receiptId !== "string" ||
		typeof value.revisionId !== "string" ||
		!Number.isSafeInteger(value.revisionNumber) ||
		(value.revisionNumber as number) < 1 ||
		typeof value.committedAt !== "string" ||
		!Number.isFinite(Date.parse(value.committedAt)) ||
		value.operationId !== operationId ||
		value.assemblyId !== assembly.assemblyId ||
		value.baseTranscriptSha256 !== review.baseTranscriptSha256 ||
		value.draftSha256 !== review.draftSha256 ||
		value.partCount !== assembly.parts.length ||
		value.segmentCount !== review.segmentCount ||
		value.wordCount !== review.wordCount
	)
		throw new AssemblyPublicationClientError("conflict");
	return {
		receiptId: value.receiptId,
		revisionId: value.revisionId,
		revisionNumber: value.revisionNumber as number,
		committedAt: value.committedAt,
	};
}

export async function readCurrentAssemblyPublication(
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
		throw new AssemblyPublicationClientError("dependency_unavailable");
	}
	if (!response.ok)
		throw new AssemblyPublicationClientError(failure(body));
	if (!body || typeof body !== "object" || Array.isArray(body))
		throw new AssemblyPublicationClientError("dependency_unavailable");
	const current = (body as { current?: unknown }).current;
	if (!current || typeof current !== "object" || Array.isArray(current))
		throw new AssemblyPublicationClientError("dependency_unavailable");
	const value = current as Record<string, unknown>;
	const uuid =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
	if (
		typeof value.actorProfileId !== "string" ||
		!uuid.test(value.actorProfileId) ||
		!(
			value.revisionId === null ||
			(typeof value.revisionId === "string" &&
				uuid.test(value.revisionId))
		)
	)
		throw new AssemblyPublicationClientError("dependency_unavailable");
	return {
		actorProfileId: value.actorProfileId,
		revisionId: value.revisionId as string | null,
	};
}

export async function publishAssemblyReview(
	assembly: SessionAssembly,
	review: SessionAssemblyReviewSummary,
	operationId: string,
	expectedCurrentRevisionId: string | null,
	expectedActorProfileId: string,
	transport: Transport = fetch,
): Promise<AssemblyPublicationReceipt> {
	const body = JSON.stringify(
		assemblyPublicationRequestBody(
			assembly,
			review,
			operationId,
			expectedCurrentRevisionId,
			expectedActorProfileId,
		),
	);
	try {
		return await parseReceipt(
			await post("/api/transcript-publications", body, transport),
			assembly,
			review,
			operationId,
		);
	} catch (cause) {
		if (
			cause instanceof AssemblyPublicationClientError &&
			cause.code !== "dependency_unavailable"
		)
			throw cause;
	}
	try {
		return await parseReceipt(
			await post("/api/transcript-publications/receipt", body, transport),
			assembly,
			review,
			operationId,
		);
	} catch (cause) {
		if (
			cause instanceof AssemblyPublicationClientError &&
			cause.code !== "not_found" &&
			cause.code !== "dependency_unavailable"
		)
			throw cause;
		throw new AssemblyPublicationClientError("unconfirmed");
	}
}
