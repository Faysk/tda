import { countWordsV1, isReviewStringV1 } from "../transcript-review/text-contract";

export const MULTI_SOURCE_PUBLICATION_REQUEST_VERSION =
	"tda_transcript_publication_request_v2" as const;
export const MULTI_SOURCE_PUBLICATION_PAYLOAD_VERSION =
	"tda_transcript_publication_v2" as const;
export const MULTI_SOURCE_PUBLICATION_RECEIPT_VERSION =
	"tda_transcript_publication_receipt_v2" as const;
export const MULTI_SOURCE_PROVENANCE_VERSION =
	"tda_transcript_multi_source_provenance_v1" as const;

const MAX_REQUEST_BYTES = 34 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;
const MAX_SEGMENTS = 100_000;
const MAX_PARTS = 64;
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,160}$/u;
const SOURCE_ID = /^craig-[0-9a-f]{64}$/u;
const RUN_ID = /^[A-Za-z0-9_-]{1,196}$/u;
const PART_ID = /^[0-9a-f]{32}$/u;

type PublicationFailure =
	| "invalid_payload"
	| "approved_review_required"
	| "too_large";

type PublicationTarget = Readonly<{
	campaignSlug: string;
	sourceSessionId: string;
}>;

export type CanonicalMultiSourcePart = Readonly<{
	part_id: string;
	source_id: string;
	source_sha256: string;
	run_id: string;
	transcript_sha256: string;
	ordinal: number;
	session_offset_seconds: number;
	trim_start_seconds: number;
	trim_end_seconds: number | null;
	overlap_resolution: "prefer_earlier_until" | "prefer_later_from" | null;
	overlap_boundary_seconds: number | null;
}>;

export type CanonicalMultiSourceProvenance = Readonly<{
	schema_version: typeof MULTI_SOURCE_PROVENANCE_VERSION;
	assembly_schema_version: "tda_session_assembly_v1";
	canonicalization_version: "tda_session_assembly_canonical_v1";
	assembly_id: string;
	inputs_sha256: string;
	campaign_id: string;
	session_id: string;
	transcript_sha256: string;
	timing_policy_version: "tda_session_timeline_v1";
	segment_boundary_policy: "segment_start_owner_v1";
	timeline_fingerprint_sha256: string;
	participant_mapping_schema_version: "tda_session_participant_mapping_v1";
	participant_mapping_policy: "strong_discord_or_manual_v1";
	participant_mapping_sha256: string;
	parts: readonly CanonicalMultiSourcePart[];
}>;

export type CanonicalMultiSourcePreparedPublication = Readonly<{
	operationId: string;
	expectedCurrentRevisionId: string | null;
	expectedActorProfileId?: string;
	target: PublicationTarget;
	publicationKind: "session_assembly";
	sourceId: null;
	runId: null;
	baseTranscriptSha256: string;
	draftSha256: string;
	provenance: CanonicalMultiSourceProvenance;
	payloadJson: string;
	payloadBytes: number;
	segmentCount: number;
}>;

export type CanonicalMultiSourcePrepareResult =
	| Readonly<{ ok: true; value: CanonicalMultiSourcePreparedPublication }>
	| Readonly<{ ok: false; reason: PublicationFailure; payloadBytes?: number }>;

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function exactKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	const actual = Object.keys(value);
	return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function text(value: unknown, max: number, pattern?: RegExp): string | null {
	if (typeof value !== "string" || value.length < 1 || value.length > max)
		return null;
	if (pattern && !pattern.test(value)) return null;
	return value;
}

function integer(value: unknown, min: number, max: number): number | null {
	return Number.isSafeInteger(value) &&
		(value as number) >= min &&
		(value as number) <= max
		? (value as number)
		: null;
}

function finite(value: unknown, min: number, max: number): number | null {
	return typeof value === "number" &&
		Number.isFinite(value) &&
		value >= min &&
		value <= max
		? value
		: null;
}

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

export function prepareMultiSourceCanonicalPublication(
	raw: string,
): CanonicalMultiSourcePrepareResult {
	if (utf8Bytes(raw) > MAX_REQUEST_BYTES)
		return { ok: false, reason: "too_large" };

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, reason: "invalid_payload" };
	}

	const root = record(parsed);
	if (
		!root ||
		root.schemaVersion !== MULTI_SOURCE_PUBLICATION_REQUEST_VERSION ||
		!exactKeys(root, [
			"schemaVersion",
			"operationId",
			"expectedCurrentRevisionId",
			"target",
			"assembly",
			"review",
			...(root.expectedActorProfileId === undefined
				? []
				: ["expectedActorProfileId"]),
		])
	)
		return { ok: false, reason: "invalid_payload" };

	const operationId = text(root.operationId, 36, UUID);
	const expectedCurrentRevisionId =
		root.expectedCurrentRevisionId === null
			? null
			: text(root.expectedCurrentRevisionId, 36, UUID);
	if (
		!operationId ||
		(root.expectedCurrentRevisionId !== null && !expectedCurrentRevisionId) ||
		(root.expectedActorProfileId !== undefined &&
			!text(root.expectedActorProfileId, 36, UUID))
	)
		return { ok: false, reason: "invalid_payload" };

	const target = record(root.target);
	const assembly = record(root.assembly);
	const review = record(root.review);
	if (
		!target ||
		!assembly ||
		!review ||
		!exactKeys(target, ["schemaVersion", "campaignSlug", "sourceSessionId"]) ||
		target.schemaVersion !== "tda_publication_session_target_v1" ||
		!exactKeys(assembly, [
			"schemaVersion",
			"canonicalizationVersion",
			"assemblyId",
			"inputsSha256",
			"campaignId",
			"sessionId",
			"transcriptSha256",
			"timingPolicyVersion",
			"segmentBoundaryPolicy",
			"timelineFingerprintSha256",
			"participantMappingSchemaVersion",
			"participantMappingPolicy",
			"participantMappingSha256",
			"parts",
		])
	)
		return { ok: false, reason: "invalid_payload" };

	const campaignSlug = text(target.campaignSlug, 128, IDENTIFIER);
	const sourceSessionId = text(target.sourceSessionId, 160, IDENTIFIER);
	const assemblyId = text(assembly.assemblyId, 64, SHA256);
	const inputsSha256 = text(assembly.inputsSha256, 64, SHA256);
	const assemblyCampaignId = text(assembly.campaignId, 128, IDENTIFIER);
	const assemblySessionId = text(assembly.sessionId, 160, IDENTIFIER);
	const assemblyTranscriptSha256 = text(assembly.transcriptSha256, 64, SHA256);
	const timelineFingerprintSha256 = text(
		assembly.timelineFingerprintSha256,
		64,
		SHA256,
	);
	const participantMappingSha256 = text(
		assembly.participantMappingSha256,
		64,
		SHA256,
	);
	const rawParts = Array.isArray(assembly.parts) ? assembly.parts : null;
	if (
		!campaignSlug ||
		!sourceSessionId ||
		assembly.schemaVersion !== "tda_session_assembly_v1" ||
		assembly.canonicalizationVersion !== "tda_session_assembly_canonical_v1" ||
		assembly.timingPolicyVersion !== "tda_session_timeline_v1" ||
		assembly.segmentBoundaryPolicy !== "segment_start_owner_v1" ||
		assembly.participantMappingSchemaVersion !==
			"tda_session_participant_mapping_v1" ||
		assembly.participantMappingPolicy !== "strong_discord_or_manual_v1" ||
		!assemblyId ||
		!inputsSha256 ||
		assemblyId !== inputsSha256 ||
		!assemblyCampaignId ||
		assemblyCampaignId !== campaignSlug ||
		!assemblySessionId ||
		assemblySessionId !== sourceSessionId ||
		!assemblyTranscriptSha256 ||
		!timelineFingerprintSha256 ||
		!participantMappingSha256 ||
		!rawParts ||
		rawParts.length < 1 ||
		rawParts.length > MAX_PARTS
	)
		return { ok: false, reason: "invalid_payload" };

	const seenPartIds = new Set<string>();
	const seenSources = new Set<string>();
	const canonicalParts: CanonicalMultiSourcePart[] = [];
	for (let ordinal = 0; ordinal < rawParts.length; ordinal += 1) {
		const part = record(rawParts[ordinal]);
		if (
			!part ||
			!exactKeys(part, [
				"partId",
				"sourceId",
				"sourceSha256",
				"runId",
				"transcriptSha256",
				"ordinal",
				"sessionOffsetSeconds",
				"trimStartSeconds",
				"trimEndSeconds",
				"overlapResolution",
				"overlapBoundarySeconds",
			])
		)
			return { ok: false, reason: "invalid_payload" };

		const partId = text(part.partId, 32, PART_ID);
		const sourceId = text(part.sourceId, 70, SOURCE_ID);
		const sourceSha256 = text(part.sourceSha256, 64, SHA256);
		const runId = text(part.runId, 196, RUN_ID);
		const transcriptSha256 = text(part.transcriptSha256, 64, SHA256);
		const partOrdinal = integer(part.ordinal, 0, MAX_PARTS - 1);
		const sessionOffsetSeconds = finite(part.sessionOffsetSeconds, 0, 604800);
		const trimStartSeconds = finite(part.trimStartSeconds, 0, 604800);
		const trimEndSeconds =
			part.trimEndSeconds === null
				? null
				: finite(part.trimEndSeconds, 0, 604800);
		const overlapResolution =
			part.overlapResolution === null ||
			part.overlapResolution === "prefer_earlier_until" ||
			part.overlapResolution === "prefer_later_from"
				? part.overlapResolution
				: undefined;
		const overlapBoundarySeconds =
			part.overlapBoundarySeconds === null
				? null
				: finite(part.overlapBoundarySeconds, 0, 604800);

		if (
			!partId ||
			seenPartIds.has(partId) ||
			!sourceId ||
			seenSources.has(sourceId) ||
			!sourceSha256 ||
			sourceId.slice("craig-".length) !== sourceSha256 ||
			!runId ||
			!transcriptSha256 ||
			partOrdinal !== ordinal ||
			sessionOffsetSeconds === null ||
			trimStartSeconds === null ||
			(part.trimEndSeconds !== null && trimEndSeconds === null) ||
			(trimEndSeconds !== null && trimEndSeconds < trimStartSeconds) ||
			overlapResolution === undefined ||
			(part.overlapBoundarySeconds !== null &&
				overlapBoundarySeconds === null) ||
			((overlapResolution === null) !== (overlapBoundarySeconds === null))
		)
			return { ok: false, reason: "invalid_payload" };

		seenPartIds.add(partId);
		seenSources.add(sourceId);
		canonicalParts.push({
			part_id: partId,
			source_id: sourceId,
			source_sha256: sourceSha256,
			run_id: runId,
			transcript_sha256: transcriptSha256,
			ordinal,
			session_offset_seconds: sessionOffsetSeconds,
			trim_start_seconds: trimStartSeconds,
			trim_end_seconds: trimEndSeconds,
			overlap_resolution: overlapResolution,
			overlap_boundary_seconds: overlapBoundarySeconds,
		});
	}

	if (
		!exactKeys(review, [
			"baseTranscriptSha256",
			"draftRevision",
			"draftSha256",
			"status",
			"warnings",
			"review",
			"segments",
			...(review.warningSummary === undefined ? [] : ["warningSummary"]),
		])
	)
		return { ok: false, reason: "invalid_payload" };
	if (review.status !== "approved_local")
		return { ok: false, reason: "approved_review_required" };

	const baseTranscriptSha256 = text(review.baseTranscriptSha256, 64, SHA256);
	const draftSha256 = text(review.draftSha256, 64, SHA256);
	const draftRevision = integer(review.draftRevision, 1, 999_999_999_999);
	if (
		!baseTranscriptSha256 ||
		baseTranscriptSha256 !== assemblyTranscriptSha256 ||
		!draftSha256 ||
		draftRevision === null
	)
		return { ok: false, reason: "invalid_payload" };

	const summary = record(review.review);
	const warnings = Array.isArray(review.warnings) ? review.warnings : null;
	const segments = Array.isArray(review.segments) ? review.segments : null;
	if (
		!summary ||
		!warnings ||
		!segments ||
		segments.length < 1 ||
		segments.length > MAX_SEGMENTS ||
		!exactKeys(summary, [
			"reviewedSegments",
			"totalSegments",
			"reviewPercent",
			"editedSegments",
			"wordCount",
			"warningCount",
		])
	)
		return { ok: false, reason: "invalid_payload" };

	const reviewedSegments = integer(summary.reviewedSegments, 0, MAX_SEGMENTS);
	const totalSegments = integer(summary.totalSegments, 1, MAX_SEGMENTS);
	const wordCount = integer(summary.wordCount, 0, 999_999_999);
	const warningCount = integer(summary.warningCount, 0, 999_999_999);
	if (
		reviewedSegments === null ||
		totalSegments === null ||
		wordCount === null ||
		warningCount === null ||
		totalSegments !== segments.length ||
		reviewedSegments > totalSegments ||
		finite(summary.reviewPercent, 0, 100) === null ||
		integer(summary.editedSegments, 0, MAX_SEGMENTS) === null
	)
		return { ok: false, reason: "invalid_payload" };

	const warningSummary =
		review.warningSummary === undefined ? null : record(review.warningSummary);
	if (
		review.warningSummary !== undefined &&
		(!warningSummary ||
			!exactKeys(warningSummary, ["totalCount", "displayedCount", "truncated"]) ||
			warningSummary.totalCount !== warningCount ||
			warningSummary.displayedCount !== warnings.length ||
			warningSummary.displayedCount !== Math.min(warningCount, 1000) ||
			warningSummary.truncated !== (warningCount > warnings.length))
	)
		return { ok: false, reason: "invalid_payload" };
	if (
		(!warningSummary && warnings.length !== warningCount) ||
		warnings.length > 1000 ||
		warnings.some(
			(value) => typeof value !== "string" || value.length > 1024,
		)
	)
		return { ok: false, reason: "invalid_payload" };

	const partsById = new Map(canonicalParts.map((part) => [part.part_id, part]));
	const seenSegments = new Set<string>();
	let computedReviewed = 0;
	let computedWords = 0;
	const canonicalSegments: Array<{
		assembly_segment_id: string;
		segment_id: string;
		part_id: string;
		source_id: string;
		run_id: string;
		source_segment_id: string;
		track_number: number;
		start: number;
		end: number;
		text: string;
		speaker: string;
		reviewed: boolean;
	}> = [];

	for (const rawSegment of segments) {
		const segment = record(rawSegment);
		if (
			!segment ||
			!exactKeys(segment, [
				"assemblySegmentId",
				"partId",
				"sourceId",
				"runId",
				"sourceSegmentId",
				"trackNumber",
				"start",
				"end",
				"text",
				"speaker",
				"reviewed",
			])
		)
			return { ok: false, reason: "invalid_payload" };

		const assemblySegmentId = text(segment.assemblySegmentId, 64, SHA256);
		const partId = text(segment.partId, 32, PART_ID);
		const sourceId = text(segment.sourceId, 70, SOURCE_ID);
		const runId = text(segment.runId, 196, RUN_ID);
		const sourceSegmentId = text(segment.sourceSegmentId, 256);
		const trackNumber = integer(segment.trackNumber, 1, 9999);
		const start = finite(segment.start, 0, 604800);
		const end = finite(segment.end, 0, 604800);
		const segmentText = isReviewStringV1(segment.text, "text")
			? segment.text
			: null;
		const speaker = isReviewStringV1(segment.speaker, "speaker")
			? segment.speaker
			: null;
		const part = partId ? partsById.get(partId) : undefined;

		if (
			!assemblySegmentId ||
			seenSegments.has(assemblySegmentId) ||
			!partId ||
			!part ||
			!sourceId ||
			sourceId !== part.source_id ||
			!runId ||
			runId !== part.run_id ||
			!sourceSegmentId ||
			trackNumber === null ||
			start === null ||
			end === null ||
			end < start ||
			segmentText === null ||
			speaker === null ||
			typeof segment.reviewed !== "boolean"
		)
			return { ok: false, reason: "invalid_payload" };

		seenSegments.add(assemblySegmentId);
		if (segment.reviewed) computedReviewed += 1;
		computedWords += countWordsV1(segmentText);
		canonicalSegments.push({
			assembly_segment_id: assemblySegmentId,
			// Keep the canonical revision reader/editor identity contract while
			// retaining the stronger assembly provenance identity alongside it.
			segment_id: assemblySegmentId,
			part_id: partId;
			source_id: sourceId,
			run_id: runId,
			source_segment_id: sourceSegmentId,
			track_number: trackNumber,
			start,
			end,
			text: segmentText,
			speaker,
			reviewed: segment.reviewed,
		});
	}

	if (computedReviewed !== reviewedSegments || computedWords !== wordCount)
		return { ok: false, reason: "invalid_payload" };

	canonicalSegments.sort((a, b) => {
		const partA = partsById.get(a.part_id);
		const partB = partsById.get(b.part_id);
		return (
			a.start - b.start ||
			a.end - b.end ||
			(partA?.ordinal ?? 0) - (partB?.ordinal ?? 0) ||
			a.track_number - b.track_number ||
			(a.source_segment_id < b.source_segment_id
				? -1
				: a.source_segment_id > b.source_segment_id
					? 1
					: 0) ||
			(a.assembly_segment_id < b.assembly_segment_id
				? -1
				: a.assembly_segment_id > b.assembly_segment_id
					? 1
					: 0)
		);
	});

	const provenance: CanonicalMultiSourceProvenance = {
		schema_version: MULTI_SOURCE_PROVENANCE_VERSION,
		assembly_schema_version: "tda_session_assembly_v1",
		canonicalization_version: "tda_session_assembly_canonical_v1",
		assembly_id: assemblyId,
		inputs_sha256: inputsSha256,
		campaign_id: assemblyCampaignId,
		session_id: assemblySessionId,
		transcript_sha256: assemblyTranscriptSha256,
		timing_policy_version: "tda_session_timeline_v1",
		segment_boundary_policy: "segment_start_owner_v1",
		timeline_fingerprint_sha256: timelineFingerprintSha256,
		participant_mapping_schema_version:
			"tda_session_participant_mapping_v1",
		participant_mapping_policy: "strong_discord_or_manual_v1",
		participant_mapping_sha256: participantMappingSha256,
		parts: canonicalParts,
	};

	const payload = {
		schema_version: MULTI_SOURCE_PUBLICATION_PAYLOAD_VERSION,
		publication_kind: "session_assembly",
		base_transcript_sha256: baseTranscriptSha256,
		draft_sha256: draftSha256,
		lineage: {
			kind: "session_assembly",
			assembly_id: assemblyId,
			assembly_schema_version: "tda_session_assembly_v1",
		},
		provenance,
		review: {
			status: "approved_local",
			draft_revision: draftRevision,
			reviewed_segments: reviewedSegments,
			total_segments: totalSegments,
			warning_count: warningCount,
			word_count: wordCount,
		},
		segments: canonicalSegments,
	};
	const payloadJson = JSON.stringify(payload);
	const payloadBytes = utf8Bytes(payloadJson);
	if (payloadBytes > MAX_PAYLOAD_BYTES)
		return { ok: false, reason: "too_large", payloadBytes };

	return {
		ok: true,
		value: {
			operationId,
			expectedCurrentRevisionId,
			...(root.expectedActorProfileId === undefined
				? {}
				: { expectedActorProfileId: root.expectedActorProfileId as string }),
			target: { campaignSlug, sourceSessionId },
			publicationKind: "session_assembly",
			sourceId: null,
			runId: null,
			baseTranscriptSha256,
			draftSha256,
			provenance,
			payloadJson,
			payloadBytes,
			segmentCount: canonicalSegments.length,
		},
	};
}
