import type { LocalReviewStatus } from "./protocol";

export type SessionAssemblyPart = {
	partId: string;
	sourceId: string;
	sourceSha256: string;
	runId: string;
	transcriptSha256: string;
	ordinal: number;
	sessionOffsetSeconds: number;
	sourceStartTime: string | null;
	sourceStartConfidence: "trusted_absolute" | "ambiguous" | "opaque" | "missing";
	sourceStartUtc: string | null;
	trimStartSeconds: number;
	trimEndSeconds: number | null;
	overlapResolution: "prefer_earlier_until" | "prefer_later_from" | null;
	overlapBoundarySeconds: number | null;
};

export type SessionAssembly = {
	schemaVersion: "tda_session_assembly_v1";
	assemblyId: string;
	campaignId: string;
	sessionId: string;
	inputsSha256: string;
	timelineFingerprintSha256: string;
	participantMappingSha256: string;
	participantApprovalBlocked: boolean;
	transcriptSha256: string;
	transcriptSizeBytes: number;
	segmentCount: number;
	createdAt: string;
	parts: readonly SessionAssemblyPart[];
};

export type SessionAssemblyListItem = {
	assemblyId: string;
	transcriptSha256: string;
	inputsSha256: string;
	segmentCount: number;
	partCount: number;
	participantApprovalBlocked: boolean;
	createdAt: string;
};

export type SessionAssemblyList = {
	campaignId: string;
	sessionId: string;
	assemblies: readonly SessionAssemblyListItem[];
};

export type SessionAssemblyReviewSummary = {
	assemblyId: string;
	baseTranscriptSha256: string;
	status: LocalReviewStatus;
	persistence: "persisted" | "ephemeral_base";
	draftRevision: number | null;
	draftSha256: string | null;
	approvalCurrent: boolean;
	approvalBlocked: boolean;
	segmentCount: number;
	reviewedSegments: number;
	reviewPercent: number;
	editedSegments: number;
	wordCount: number;
};

function invalid(): never {
	throw new Error("invalid_response");
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
	return value as Record<string, unknown>;
}

function string(value: unknown, max = 512): string {
	if (typeof value !== "string" || value.length === 0 || value.length > max) return invalid();
	return value;
}

function optionalString(value: unknown, max = 512): string | null {
	return value === null || value === undefined ? null : string(value, max);
}

function id(value: unknown, max = 196): string {
	const parsed = string(value, max);
	if (!/^[A-Za-z0-9_-]+$/u.test(parsed)) return invalid();
	return parsed;
}

function hex(value: unknown, length: number): string {
	const parsed = string(value, length);
	if (parsed.length !== length || !/^[0-9a-f]+$/u.test(parsed)) return invalid();
	return parsed;
}

function bool(value: unknown): boolean {
	if (typeof value !== "boolean") return invalid();
	return value;
}

function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < min ||
		value > max
	)
		return invalid();
	return value;
}

function number(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return invalid();
	return value;
}

function nullableNumber(value: unknown): number | null {
	return value === null || value === undefined ? null : number(value);
}

function iso(value: unknown): string {
	const parsed = string(value, 64);
	if (!Number.isFinite(Date.parse(parsed))) return invalid();
	return parsed;
}

function status(value: unknown): LocalReviewStatus {
	const parsed = string(value, 32);
	if (!["draft", "reviewed", "approved_local"].includes(parsed)) return invalid();
	return parsed as LocalReviewStatus;
}

function parseAssemblyPart(value: unknown, expectedOrdinal: number): SessionAssemblyPart {
	const row = object(value);
	const overlap = optionalString(row.overlap_resolution, 32);
	if (
		overlap !== null &&
		overlap !== "prefer_earlier_until" &&
		overlap !== "prefer_later_from"
	)
		return invalid();
	const ordinal = integer(row.ordinal, 0, 63);
	if (ordinal !== expectedOrdinal) return invalid();
	const confidenceRaw = row.source_start_confidence ?? "missing";
	if (
		confidenceRaw !== "trusted_absolute" &&
		confidenceRaw !== "ambiguous" &&
		confidenceRaw !== "opaque" &&
		confidenceRaw !== "missing"
	)
		return invalid();
	const sourceStartTime = optionalString(row.source_start_time, 128);
	const sourceStartUtc = optionalString(row.source_start_utc, 128);
	if (
		confidenceRaw === "trusted_absolute" &&
		(!sourceStartTime || !sourceStartUtc || !Number.isFinite(Date.parse(sourceStartTime)) || !Number.isFinite(Date.parse(sourceStartUtc)))
	)
		return invalid();
	if (confidenceRaw !== "trusted_absolute" && sourceStartUtc !== null) return invalid();
	return {
		partId: hex(row.part_id, 32),
		sourceId: (() => {
			const source = string(row.source_id, 80);
			if (!/^craig-[0-9a-f]{64}$/u.test(source)) return invalid();
			return source;
		})(),
		sourceSha256: hex(row.source_sha256, 64),
		runId: id(row.run_id),
		transcriptSha256: hex(row.transcript_sha256, 64),
		ordinal,
		sessionOffsetSeconds: number(row.session_offset_seconds),
		sourceStartTime,
		sourceStartConfidence: confidenceRaw,
		sourceStartUtc,
		trimStartSeconds: number(row.trim_start_seconds),
		trimEndSeconds: nullableNumber(row.trim_end_seconds),
		overlapResolution: overlap as SessionAssemblyPart["overlapResolution"],
		overlapBoundarySeconds: nullableNumber(row.overlap_boundary_seconds),
	};
}

export function parseSessionAssembly(value: unknown): SessionAssembly {
	const row = object(value);
	if (
		row.schema_version !== "tda_session_assembly_v1" ||
		row.status !== "completed" ||
		row.canonicalization_version !== "tda_session_assembly_canonical_v1"
	)
		return invalid();
	if (!Array.isArray(row.parts) || row.parts.length < 1 || row.parts.length > 64)
		return invalid();
	const parts = row.parts.map((part, index) => parseAssemblyPart(part, index));
	const assemblyId = hex(row.assembly_id, 64);
	const inputsSha256 = hex(row.inputs_sha256, 64);
	if (assemblyId !== inputsSha256) return invalid();
	return {
		schemaVersion: "tda_session_assembly_v1",
		assemblyId,
		campaignId: id(row.campaign_id, 128),
		sessionId: id(row.session_id, 128),
		inputsSha256,
		timelineFingerprintSha256: hex(row.timeline_fingerprint_sha256, 64),
		participantMappingSha256: hex(row.participant_mapping_sha256, 64),
		participantApprovalBlocked: bool(row.participant_approval_blocked),
		transcriptSha256: hex(row.transcript_sha256, 64),
		transcriptSizeBytes: integer(row.transcript_size_bytes, 1, 64 * 1024 * 1024),
		segmentCount: integer(row.segment_count, 0, 100_000),
		createdAt: iso(row.created_at),
		parts,
	};
}

export function parseSessionAssemblyList(value: unknown): SessionAssemblyList {
	const row = object(value);
	if (row.schema_version !== "tda_session_assemblies_v1") return invalid();
	if (!Array.isArray(row.assemblies) || row.assemblies.length > 1000) return invalid();
	const assemblies = row.assemblies.map((raw) => {
		const item = object(raw);
		return {
			assemblyId: hex(item.assembly_id, 64),
			transcriptSha256: hex(item.transcript_sha256, 64),
			inputsSha256: hex(item.inputs_sha256, 64),
			segmentCount: integer(item.segment_count, 0, 100_000),
			partCount: integer(item.part_count, 1, 64),
			participantApprovalBlocked: bool(item.participant_approval_blocked),
			createdAt: iso(item.created_at),
		} satisfies SessionAssemblyListItem;
	});
	if (new Set(assemblies.map((item) => item.assemblyId)).size !== assemblies.length)
		return invalid();
	return {
		campaignId: id(row.campaign_id, 128),
		sessionId: id(row.session_id, 128),
		assemblies,
	};
}

export function parseSessionAssemblyReviewSummary(
	value: unknown,
	expectedAssemblyId?: string,
): SessionAssemblyReviewSummary {
	const row = object(value);
	if (
		row.schema_version !== "tda_session_assembly_review_v1" ||
		row.snapshot_contract !== "tda_session_assembly_review_cas_v1"
	)
		return invalid();
	const base = object(row.base);
	if (base.kind !== "session_assembly") return invalid();
	const assemblyId = hex(base.assembly_id, 64);
	if (expectedAssemblyId && assemblyId !== expectedAssemblyId) return invalid();
	const persistence = string(row.persistence, 32);
	if (persistence !== "persisted" && persistence !== "ephemeral_base") return invalid();
	const draftRevision =
		row.draft_revision === null ? null : integer(row.draft_revision, 1);
	const draftSha256 =
		row.draft_sha256 === null ? null : hex(row.draft_sha256, 64);
	if (
		(persistence === "ephemeral_base" && (draftRevision !== null || draftSha256 !== null)) ||
		(persistence === "persisted" && (draftRevision === null || draftSha256 === null))
	)
		return invalid();
	if (!Array.isArray(row.segments) || row.segments.length > 100_000) return invalid();
	const review = object(row.review);
	const reviewedSegments = integer(review.reviewed_segments, 0, row.segments.length);
	const totalSegments = integer(review.total_segments, 0, 100_000);
	if (totalSegments !== row.segments.length || reviewedSegments > totalSegments)
		return invalid();
	const reviewPercent = number(review.review_percent);
	if (reviewPercent > 100) return invalid();
	return {
		assemblyId,
		baseTranscriptSha256: hex(base.transcript_sha256, 64),
		status: status(row.status),
		persistence,
		draftRevision,
		draftSha256,
		approvalCurrent: bool(row.approval_current),
		approvalBlocked: bool(row.approval_blocked),
		segmentCount: totalSegments,
		reviewedSegments,
		reviewPercent,
		editedSegments: integer(review.edited_segments, 0, totalSegments),
		wordCount: integer(review.word_count, 0),
	};
}
