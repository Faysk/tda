import {
	BridgeError,
	type LocalReviewSegment,
	type TranscriptionProfileId,
	identifier,
	record,
	text,
} from "./protocol";

export type BenchmarkTranscriptSegment = {
	id: string;
	start: number;
	end: number;
	text: string;
};
export type BenchmarkTranscriptTrack = {
	number: number;
	speaker: string;
	timelineOffsetSeconds: number;
	segments: readonly BenchmarkTranscriptSegment[];
};
export type BenchmarkTranscript = {
	schemaVersion: "tda_transcript_v1";
	sourceSha256: string;
	profileId: TranscriptionProfileId;
	tracks: readonly BenchmarkTranscriptTrack[];
};

export type BenchmarkReferenceTrack = {
	trackNumber: number;
	speaker: string;
	text: string;
	turns?: readonly {
		start: number;
		end: number;
		text: string;
		speaker: string;
		overlapsOtherSpeaker: boolean;
	}[];
};
export type BenchmarkReference = {
	schemaVersion: "tda_benchmark_reference_v1";
	benchmarkId: string;
	sampleIdentitySha256: string;
	revision: number;
	capability: "text" | "timed_turns";
	normalizationVersion: string;
	tracks: readonly BenchmarkReferenceTrack[];
	terms: readonly string[];
};

export type BenchmarkQualityProfile = {
	profileId: TranscriptionProfileId;
	normalizationVersion: string;
	referenceRevision: number;
	referenceCapability: "text" | "timed_turns";
	metricsAvailable: readonly string[];
	micro: {
		referenceWords: number;
		hypothesisWords: number;
		substitutions: number;
		deletions: number;
		insertions: number;
		werNormalized: number | null;
		referenceCharacters: number;
		hypothesisCharacters: number;
		characterSubstitutions: number;
		characterDeletions: number;
		characterInsertions: number;
		cerNormalized: number | null;
	};
	timed: null | {
		matchedTurns: number;
		referenceTurns: number;
		hypothesisTurns: number;
		turnCoverage: number | null;
		speakerAccuracy: number | null;
		startMaeSeconds: number | null;
		endMaeSeconds: number | null;
		boundaryP50Seconds: number | null;
		boundaryP95Seconds: number | null;
		overlapPrecision: number | null;
		overlapRecall: number | null;
		overlapF1: number | null;
	};
};

export type BenchmarkQualityResponse = Readonly<
	Partial<Record<TranscriptionProfileId, BenchmarkQualityProfile>>
>;

function invalid(): never {
	throw new BridgeError("invalid_response");
}

function number(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
		return invalid();
	return value;
}

function integer(value: unknown): number {
	const parsed = number(value);
	if (!Number.isSafeInteger(parsed)) return invalid();
	return parsed;
}

function nullableNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	return number(value);
}

function sha256(value: unknown): string {
	const parsed = text(value, 64);
	if (!/^[0-9a-f]{64}$/u.test(parsed)) return invalid();
	return parsed;
}

function profile(value: unknown): TranscriptionProfileId {
	const parsed = text(value, 32);
	if (
		![
			"whisper-turbo",
			"whisper-detailed",
			"qwen-fast",
			"qwen-quality",
		].includes(parsed)
	)
		return invalid();
	return parsed as TranscriptionProfileId;
}

export function parseBenchmarkTranscript(value: unknown): BenchmarkTranscript {
	const row = record(value);
	if (row.schema_version !== "tda_transcript_v1") return invalid();
	const engine = record(row.engine);
	const rawTracks = row.tracks;
	if (!Array.isArray(rawTracks) || rawTracks.length > 256) return invalid();
	const tracks = rawTracks.map((raw) => {
		const track = record(raw);
		const rawSegments = track.segments;
		if (!Array.isArray(rawSegments) || rawSegments.length > 200_000)
			return invalid();
		const segments = rawSegments.map((segmentRaw) => {
			const segment = record(segmentRaw);
			const start = number(segment.start);
			const end = number(segment.end);
			if (end < start) return invalid();
			return {
				id: text(segment.id, 256),
				start,
				end,
				text: text(segment.text, 200_000),
			};
		});
		return {
			number: integer(track.number),
			speaker: text(track.speaker, 160),
			timelineOffsetSeconds: number(track.timeline_offset_seconds ?? 0),
			segments,
		};
	});
	return {
		schemaVersion: "tda_transcript_v1",
		sourceSha256: sha256(row.source_sha256),
		profileId: profile(engine.profile),
		tracks,
	};
}

export function benchmarkTranscriptSegments(
	transcript: BenchmarkTranscript,
): readonly LocalReviewSegment[] {
	return transcript.tracks.flatMap((track) =>
		track.segments.map((segment) => ({
			trackNumber: track.number,
			segmentId: segment.id,
			start: segment.start,
			end: segment.end,
			timelineStart: track.timelineOffsetSeconds + segment.start,
			timelineEnd: track.timelineOffsetSeconds + segment.end,
			text: segment.text,
			speaker: track.speaker,
			reviewed: false,
		})),
	);
}

function parseReferenceTrack(raw: unknown): BenchmarkReferenceTrack {
	const row = record(raw);
	const rawTurns = row.turns;
	let turns: BenchmarkReferenceTrack["turns"];
	if (rawTurns !== undefined && rawTurns !== null) {
		if (!Array.isArray(rawTurns) || rawTurns.length > 200_000) return invalid();
		turns = rawTurns.map((rawTurn) => {
			const turn = record(rawTurn);
			const start = number(turn.start);
			const end = number(turn.end);
			if (end < start || typeof turn.overlaps_other_speaker !== "boolean")
				return invalid();
			return {
				start,
				end,
				text: typeof turn.text === "string" ? turn.text : invalid(),
				speaker: text(turn.speaker, 160),
				overlapsOtherSpeaker: turn.overlaps_other_speaker,
			};
		});
	}
	return {
		trackNumber: integer(row.track_number),
		speaker: text(row.speaker, 160),
		text: typeof row.text === "string" ? row.text : invalid(),
		...(turns ? { turns } : {}),
	};
}

export function parseBenchmarkReference(value: unknown): BenchmarkReference {
	const row = record(value);
	if (row.schema_version !== "tda_benchmark_reference_v1") return invalid();
	if (row.capability !== "text" && row.capability !== "timed_turns")
		return invalid();
	if (!Array.isArray(row.tracks) || !Array.isArray(row.terms)) return invalid();
	return {
		schemaVersion: "tda_benchmark_reference_v1",
		benchmarkId: identifier(row.benchmark_id),
		sampleIdentitySha256: sha256(row.sample_identity_sha256),
		revision: integer(row.revision),
		capability: row.capability,
		normalizationVersion: text(row.normalization_version, 128),
		tracks: row.tracks.map(parseReferenceTrack),
		terms: row.terms.map((item) =>
			typeof item === "string" && item.length <= 160 ? item : invalid(),
		),
	};
}

function parseMicro(raw: unknown): BenchmarkQualityProfile["micro"] {
	const row = record(raw);
	return {
		referenceWords: integer(row.reference_words),
		hypothesisWords: integer(row.hypothesis_words),
		substitutions: integer(row.substitutions),
		deletions: integer(row.deletions),
		insertions: integer(row.insertions),
		werNormalized: nullableNumber(row.wer_normalized),
		referenceCharacters: integer(row.reference_characters),
		hypothesisCharacters: integer(row.hypothesis_characters),
		characterSubstitutions: integer(row.character_substitutions),
		characterDeletions: integer(row.character_deletions),
		characterInsertions: integer(row.character_insertions),
		cerNormalized: nullableNumber(row.cer_normalized),
	};
}

function parseTimed(raw: unknown): BenchmarkQualityProfile["timed"] {
	if (raw === null || raw === undefined) return null;
	const row = record(raw);
	return {
		matchedTurns: integer(row.matched_turns),
		referenceTurns: integer(row.reference_turns),
		hypothesisTurns: integer(row.hypothesis_turns),
		turnCoverage: nullableNumber(row.turn_coverage),
		speakerAccuracy: nullableNumber(row.speaker_accuracy),
		startMaeSeconds: nullableNumber(row.start_mae_seconds),
		endMaeSeconds: nullableNumber(row.end_mae_seconds),
		boundaryP50Seconds: nullableNumber(row.boundary_p50_seconds),
		boundaryP95Seconds: nullableNumber(row.boundary_p95_seconds),
		overlapPrecision: nullableNumber(row.overlap_precision),
		overlapRecall: nullableNumber(row.overlap_recall),
		overlapF1: nullableNumber(row.overlap_f1),
	};
}

function parseProfileQuality(raw: unknown): BenchmarkQualityProfile {
	const row = record(raw);
	if (row.schema_version !== "tda_benchmark_quality_receipt_v1")
		return invalid();
	if (
		row.reference_capability !== "text" &&
		row.reference_capability !== "timed_turns"
	)
		return invalid();
	if (!Array.isArray(row.metrics_available)) return invalid();
	if (row.winner !== null) return invalid();
	return {
		profileId: profile(row.profile_id),
		normalizationVersion: text(row.normalization_version, 128),
		referenceRevision: integer(row.reference_revision),
		referenceCapability: row.reference_capability,
		metricsAvailable: row.metrics_available.map((item) => text(item, 64)),
		micro: parseMicro(row.micro),
		timed: parseTimed(row.timed),
	};
}

export function parseBenchmarkQuality(value: unknown): BenchmarkQualityResponse {
	const outer = record(value);
	const source = outer.profiles === undefined ? outer : record(outer.profiles);
	const result: Partial<Record<TranscriptionProfileId, BenchmarkQualityProfile>> =
		{};
	for (const profileId of [
		"whisper-turbo",
		"whisper-detailed",
		"qwen-fast",
		"qwen-quality",
	] as const) {
		if (source[profileId] === undefined) continue;
		const parsed = parseProfileQuality(source[profileId]);
		if (parsed.profileId !== profileId) return invalid();
		result[profileId] = parsed;
	}
	return result;
}

export function referenceTracksFromTranscript(
	transcript: BenchmarkTranscript,
): BenchmarkReferenceTrack[] {
	return transcript.tracks.map((track) => ({
		trackNumber: track.number,
		speaker: track.speaker,
		text: track.segments
			.map((segment) => segment.text.trim())
			.filter(Boolean)
			.join(" "),
	}));
}
