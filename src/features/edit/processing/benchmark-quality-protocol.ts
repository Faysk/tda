import { BridgeError, type TranscriptionProfileId } from "./protocol";

export type BenchmarkNormalizationPolicy = Readonly<{
	schemaVersion: "tda_asr_text_normalization_v1";
	unicodeNormalization: "NFC";
	casePolicy: "unicode_casefold";
	whitespace: "collapse";
	punctuation: "strip_unicode_punctuation_except_apostrophe_hyphen_v1";
	diacritics: "preserve";
	localeDependent: false;
}>;

export type BenchmarkReferenceTurn = Readonly<{
	id: string;
	speaker: string;
	start: number;
	end: number;
	text: string;
	overlapsOtherSpeaker: boolean;
}>;

export type BenchmarkReferenceTrack = Readonly<{
	trackNumber: number;
	speaker: string;
	text: string;
	turns: readonly BenchmarkReferenceTurn[];
}>;

export type BenchmarkReferenceStatus = Readonly<{
	benchmarkId: string;
	latestRevision: number;
	activeRevision: number | null;
	activeSha256: string | null;
	normalizationPolicy: BenchmarkNormalizationPolicy;
}>;

export type BenchmarkReference = Readonly<{
	benchmarkId: string;
	sourceSha256: string;
	sampleIdentitySha256: string;
	revision: number;
	parentRevision: number | null;
	capabilityLevel: 1 | 2;
	canonicalPayloadSha256: string;
	provenance: Readonly<{
		kind: "manual" | "imported" | "derived-from-profile";
		seedProfileId: TranscriptionProfileId | null;
		humanOwned: true;
	}>;
	normalizationPolicy: BenchmarkNormalizationPolicy;
	glossaryTerms: readonly string[];
	tracks: readonly BenchmarkReferenceTrack[];
}>;

export type BenchmarkReferenceDraft = Readonly<{
	benchmarkId: string;
	sourceSha256: string;
	sampleIdentitySha256: string;
	capabilityLevel: 1;
	provenance: Readonly<{
		kind: "derived-from-profile";
		seedProfileId: TranscriptionProfileId;
		humanOwned: true;
	}>;
	normalizationPolicy: BenchmarkNormalizationPolicy;
	glossaryTerms: readonly string[];
	tracks: readonly BenchmarkReferenceTrack[];
}>;

export type BenchmarkReferenceSaveInput = Readonly<{
	expectedRevision: number;
	capabilityLevel: 1 | 2;
	provenanceKind: "manual" | "imported" | "derived-from-profile";
	seedProfileId?: TranscriptionProfileId | null;
	glossaryTerms: readonly string[];
	tracks: readonly BenchmarkReferenceTrack[];
	activate: boolean;
}>;

export type BenchmarkTextQuality = Readonly<{
	trackNumber: number;
	state: "matched" | "missing_hypothesis" | "extra_hypothesis";
	substitutions: number;
	deletions: number;
	insertions: number;
	distance: number;
	referenceWords: number;
	hypothesisWords: number;
	werNormalized: number | null;
	referenceCharacters: number;
	hypothesisCharacters: number;
	characterDistance: number;
	cerNormalized: number | null;
}>;

export type BenchmarkQualityProfile = Readonly<{
	benchmarkId: string;
	benchmarkManifestSha256: string;
	sampleIdentitySha256: string;
	profileId: TranscriptionProfileId;
	profileTranscriptSha256: string;
	referenceRevision: number;
	referenceSha256: string;
	normalizationPolicy: BenchmarkNormalizationPolicy;
	normalizationPolicySha256: string;
	metricImplementationVersion: "tda_asr_quality_metrics_v1";
	capabilityLevel: 1 | 2;
	receiptSha256: string;
	receiptSizeBytes: number;
	metrics: Readonly<{
		perTrack: readonly BenchmarkTextQuality[];
		micro: Readonly<{
			substitutions: number;
			deletions: number;
			insertions: number;
			distance: number;
			referenceWords: number;
			hypothesisWords: number;
			werNormalized: number | null;
			referenceCharacters: number;
			hypothesisCharacters: number;
			characterDistance: number;
			cerNormalized: number | null;
			macroWerNormalized: number | null;
		}>;
		glossary: Readonly<{
			available: boolean;
			referenceOccurrences: number;
			correctOccurrences: number;
			missedOccurrences: number;
			extraOccurrences: number;
			recall: number | null;
			precision: number | null;
		}>;
		timing: Readonly<{
			available: boolean;
			reason: string | null;
			timingPrecision: "window_fallback" | "word_aligned" | "segment_aligned";
			turnCoverage: number | null;
			speakerAccuracy: number | null;
			boundaryP50Seconds: number | null;
			boundaryP95Seconds: number | null;
			overlapF1: number | null;
		}>;
	}>;
}>;

export type BenchmarkQualitySummary = Readonly<{
	benchmarkId: string;
	reference: BenchmarkReferenceStatus;
	qualityMeasured: boolean;
	profiles: readonly BenchmarkQualityProfile[];
	winner: null;
	compositeScore: null;
}>;


export type BenchmarkQualityInspection = Readonly<{
	benchmarkId: string;
	profileId: TranscriptionProfileId;
	referenceRevision: number;
	referenceSha256: string;
	normalizationPolicy: BenchmarkNormalizationPolicy;
	privateText: true;
	regions: readonly Readonly<{
		trackNumber: number;
		kind:
			| "substitution_region"
			| "deletion_region"
			| "insertion_region"
			| "unmatched_region";
		referenceWordRange: readonly [number, number];
		hypothesisWordRange: readonly [number, number];
		referenceContext: string;
		hypothesisContext: string;
	}>[];
	truncated: boolean;
	glossaryFindings: readonly Readonly<{
		term: string;
		referenceOccurrences: number;
		hypothesisOccurrences: number;
		correctOccurrences: number;
		missedOccurrences: number;
		extraOccurrences: number;
	}>[];
}>;

type Row = Record<string, unknown>;

function invalid(): never {
	throw new BridgeError("invalid_response");
}

function row(value: unknown): Row {
	if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
	return value as Row;
}

function hasUnpairedSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			if (index + 1 >= value.length) return true;
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) return true;
			index += 1;
			continue;
		}
		if (code >= 0xdc00 && code <= 0xdfff) return true;
	}
	return false;
}

function stringValue(value: unknown, maximum = 250_000): string {
	if (
		typeof value !== "string" ||
		value.length > maximum ||
		value.includes("\0") ||
		hasUnpairedSurrogate(value)
	)
		return invalid();
	return value;
}

function nonEmptyString(value: unknown, maximum = 256): string {
	const parsed = stringValue(value, maximum);
	if (!parsed.length) return invalid();
	return parsed;
}

function sha256(value: unknown): string {
	const parsed = nonEmptyString(value, 64);
	if (!/^[0-9a-f]{64}$/u.test(parsed)) return invalid();
	return parsed;
}

function benchmarkIdentifier(value: unknown): string {
	const parsed = nonEmptyString(value, 196);
	if (!/^benchmark-[A-Za-z0-9_-]{1,128}-a[1-9][0-9]{0,5}$/u.test(parsed))
		return invalid();
	return parsed;
}

function integer(value: unknown, minimum = 0): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < minimum
	)
		return invalid();
	return value;
}

function numberValue(value: unknown, minimum = 0): number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < minimum
	)
		return invalid();
	return value;
}

function nullableNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	return numberValue(value);
}

function booleanValue(value: unknown): boolean {
	if (typeof value !== "boolean") return invalid();
	return value;
}

function profileId(value: unknown): TranscriptionProfileId {
	if (
		value !== "whisper-turbo" &&
		value !== "whisper-detailed" &&
		value !== "qwen-fast" &&
		value !== "qwen-quality"
	)
		return invalid();
	return value;
}

function normalizationPolicy(value: unknown): BenchmarkNormalizationPolicy {
	const item = row(value);
	if (
		item.schema_version !== "tda_asr_text_normalization_v1" ||
		item.unicode_normalization !== "NFC" ||
		item.case !== "unicode_casefold" ||
		item.whitespace !== "collapse" ||
		item.punctuation !==
			"strip_unicode_punctuation_except_apostrophe_hyphen_v1" ||
		item.diacritics !== "preserve" ||
		item.locale_dependent !== false
	)
		return invalid();
	return {
		schemaVersion: "tda_asr_text_normalization_v1",
		unicodeNormalization: "NFC",
		casePolicy: "unicode_casefold",
		whitespace: "collapse",
		punctuation: "strip_unicode_punctuation_except_apostrophe_hyphen_v1",
		diacritics: "preserve",
		localeDependent: false,
	};
}

function parseTurn(value: unknown): BenchmarkReferenceTurn {
	const item = row(value);
	const start = numberValue(item.start);
	const end = numberValue(item.end);
	if (end < start) return invalid();
	return {
		id: nonEmptyString(item.id, 256),
		speaker: nonEmptyString(item.speaker, 160),
		start,
		end,
		text: stringValue(item.text),
		overlapsOtherSpeaker: booleanValue(item.overlaps_other_speaker),
	};
}

function parseTrack(value: unknown): BenchmarkReferenceTrack {
	const item = row(value);
	const turnsRaw =
		item.turns === undefined || item.turns === null ? [] : item.turns;
	if (!Array.isArray(turnsRaw) || turnsRaw.length > 20_000) return invalid();
	return {
		trackNumber: integer(item.track_number, 1),
		speaker: nonEmptyString(item.speaker, 160),
		text: stringValue(item.text),
		turns: turnsRaw.map(parseTurn),
	};
}

function parseGlossary(value: unknown): string[] {
	if (!Array.isArray(value) || value.length > 512) return invalid();
	return value.map((item) => nonEmptyString(item, 256));
}

export function parseBenchmarkReferenceStatus(
	value: unknown,
): BenchmarkReferenceStatus {
	const item = row(value);
	if (item.schema_version !== "tda_benchmark_reference_status_v1")
		return invalid();
	const activeRevision =
		item.active_revision === null || item.active_revision === undefined
			? null
			: integer(item.active_revision, 1);
	const activeSha256 =
		item.active_sha256 === null || item.active_sha256 === undefined
			? null
			: sha256(item.active_sha256);
	if ((activeRevision === null) !== (activeSha256 === null)) return invalid();
	return {
		benchmarkId: benchmarkIdentifier(item.benchmark_id),
		latestRevision: integer(item.latest_revision),
		activeRevision,
		activeSha256,
		normalizationPolicy: normalizationPolicy(item.normalization_policy),
	};
}

export function parseBenchmarkReference(value: unknown): BenchmarkReference {
	const item = row(value);
	if (item.schema_version !== "tda_benchmark_reference_v1") return invalid();
	const provenance = row(item.provenance);
	if (
		provenance.kind !== "manual" &&
		provenance.kind !== "imported" &&
		provenance.kind !== "derived-from-profile"
	)
		return invalid();
	const capabilityLevel = integer(item.capability_level, 1);
	if (capabilityLevel !== 1 && capabilityLevel !== 2) return invalid();
	if (!Array.isArray(item.tracks) || item.tracks.length < 1 || item.tracks.length > 128)
		return invalid();
	const seedProfileId =
		provenance.seed_profile_id === null || provenance.seed_profile_id === undefined
			? null
			: profileId(provenance.seed_profile_id);
	if (provenance.kind === "derived-from-profile" && seedProfileId === null)
		return invalid();
	if (provenance.human_owned !== true) return invalid();
	const parentRevision =
		item.parent_revision === null || item.parent_revision === undefined
			? null
			: integer(item.parent_revision, 1);
	return {
		benchmarkId: benchmarkIdentifier(item.benchmark_id),
		sourceSha256: sha256(item.source_sha256),
		sampleIdentitySha256: sha256(item.sample_identity_sha256),
		revision: integer(item.revision, 1),
		parentRevision,
		capabilityLevel,
		canonicalPayloadSha256: sha256(item.canonical_payload_sha256),
		provenance: {
			kind: provenance.kind,
			seedProfileId,
			humanOwned: true,
		},
		normalizationPolicy: normalizationPolicy(item.normalization_policy),
		glossaryTerms: parseGlossary(item.glossary_terms),
		tracks: item.tracks.map(parseTrack),
	};
}

export function parseBenchmarkReferenceResponse(value: unknown): Readonly<{
	status: BenchmarkReferenceStatus;
	reference: BenchmarkReference | null;
}> {
	const item = row(value);
	const status = parseBenchmarkReferenceStatus(item.status);
	const reference =
		item.reference === null || item.reference === undefined
			? null
			: parseBenchmarkReference(item.reference);
	if (
		reference &&
		(reference.benchmarkId !== status.benchmarkId ||
			reference.revision !== status.activeRevision ||
			reference.canonicalPayloadSha256 !== status.activeSha256)
	)
		return invalid();
	if (!reference && status.activeRevision !== null) return invalid();
	return { status, reference };
}

export function parseBenchmarkReferenceDraft(
	value: unknown,
): BenchmarkReferenceDraft {
	const item = row(value);
	if (
		item.schema_version !== "tda_benchmark_reference_draft_v1" ||
		item.capability_level !== 1
	)
		return invalid();
	const provenance = row(item.provenance);
	if (
		provenance.kind !== "derived-from-profile" ||
		provenance.human_owned !== true
	)
		return invalid();
	if (!Array.isArray(item.tracks) || item.tracks.length < 1 || item.tracks.length > 128)
		return invalid();
	return {
		benchmarkId: benchmarkIdentifier(item.benchmark_id),
		sourceSha256: sha256(item.source_sha256),
		sampleIdentitySha256: sha256(item.sample_identity_sha256),
		capabilityLevel: 1,
		provenance: {
			kind: "derived-from-profile",
			seedProfileId: profileId(provenance.seed_profile_id),
			humanOwned: true,
		},
		normalizationPolicy: normalizationPolicy(item.normalization_policy),
		glossaryTerms: parseGlossary(item.glossary_terms),
		tracks: item.tracks.map((track) => {
			const parsed = row(track);
			return {
				trackNumber: integer(parsed.track_number, 1),
				speaker: nonEmptyString(parsed.speaker, 160),
				text: stringValue(parsed.text),
				turns: [],
			};
		}),
	};
}

function textQuality(value: unknown): BenchmarkTextQuality {
	const item = row(value);
	if (
		item.state !== "matched" &&
		item.state !== "missing_hypothesis" &&
		item.state !== "extra_hypothesis"
	)
		return invalid();
	return {
		trackNumber: integer(item.track_number, 1),
		state: item.state,
		substitutions: integer(item.substitutions),
		deletions: integer(item.deletions),
		insertions: integer(item.insertions),
		distance: integer(item.distance),
		referenceWords: integer(item.reference_words),
		hypothesisWords: integer(item.hypothesis_words),
		werNormalized: nullableNumber(item.wer_normalized),
		referenceCharacters: integer(item.reference_characters),
		hypothesisCharacters: integer(item.hypothesis_characters),
		characterDistance: integer(item.character_distance),
		cerNormalized: nullableNumber(item.cer_normalized),
	};
}

function timing(value: unknown): BenchmarkQualityProfile["metrics"]["timing"] {
	const item = row(value);
	const timingPrecision = item.timing_precision;
	if (
		timingPrecision !== "window_fallback" &&
		timingPrecision !== "word_aligned" &&
		timingPrecision !== "segment_aligned"
	)
		return invalid();
	const overlap =
		item.overlap === undefined || item.overlap === null ? null : row(item.overlap);
	return {
		available: booleanValue(item.available),
		reason:
			item.reason === undefined || item.reason === null
				? null
				: nonEmptyString(item.reason, 128),
		timingPrecision,
		turnCoverage: nullableNumber(item.turn_coverage),
		speakerAccuracy: nullableNumber(item.speaker_accuracy),
		boundaryP50Seconds: nullableNumber(item.boundary_p50_seconds),
		boundaryP95Seconds: nullableNumber(item.boundary_p95_seconds),
		overlapF1: overlap ? nullableNumber(overlap.f1) : null,
	};
}

function qualityProfile(value: unknown): BenchmarkQualityProfile {
	const item = row(value);
	if (
		item.schema_version !== "tda_benchmark_quality_receipt_v1" ||
		item.metric_implementation_version !== "tda_asr_quality_metrics_v1"
	)
		return invalid();
	const metrics = row(item.metrics);
	const micro = row(metrics.micro);
	const glossary = row(metrics.glossary);
	if (!Array.isArray(metrics.per_track) || metrics.per_track.length > 256)
		return invalid();
	const capabilityLevel = integer(item.capability_level, 1);
	if (capabilityLevel !== 1 && capabilityLevel !== 2) return invalid();
	return {
		benchmarkId: benchmarkIdentifier(item.benchmark_id),
		benchmarkManifestSha256: sha256(item.benchmark_manifest_sha256),
		sampleIdentitySha256: sha256(item.sample_identity_sha256),
		profileId: profileId(item.profile_id),
		profileTranscriptSha256: sha256(item.profile_transcript_sha256),
		referenceRevision: integer(item.reference_revision, 1),
		referenceSha256: sha256(item.reference_sha256),
		normalizationPolicy: normalizationPolicy(item.normalization_policy),
		normalizationPolicySha256: sha256(item.normalization_policy_sha256),
		metricImplementationVersion: "tda_asr_quality_metrics_v1",
		capabilityLevel,
		receiptSha256: sha256(item.receipt_sha256),
		receiptSizeBytes: integer(item.receipt_size_bytes, 1),
		metrics: {
			perTrack: metrics.per_track.map(textQuality),
			micro: {
				substitutions: integer(micro.substitutions),
				deletions: integer(micro.deletions),
				insertions: integer(micro.insertions),
				distance: integer(micro.distance),
				referenceWords: integer(micro.reference_words),
				hypothesisWords: integer(micro.hypothesis_words),
				werNormalized: nullableNumber(micro.wer_normalized),
				referenceCharacters: integer(micro.reference_characters),
				hypothesisCharacters: integer(micro.hypothesis_characters),
				characterDistance: integer(micro.character_distance),
				cerNormalized: nullableNumber(micro.cer_normalized),
				macroWerNormalized: nullableNumber(micro.macro_wer_normalized),
			},
			glossary: {
				available: booleanValue(glossary.available),
				referenceOccurrences: integer(glossary.reference_occurrences),
				correctOccurrences: integer(glossary.correct_occurrences),
				missedOccurrences: integer(glossary.missed_occurrences),
				extraOccurrences: integer(glossary.extra_occurrences),
				recall: nullableNumber(glossary.recall),
				precision: nullableNumber(glossary.precision),
			},
			timing: timing(metrics.timing),
		},
	};
}

export function parseBenchmarkQualitySummary(
	value: unknown,
): BenchmarkQualitySummary {
	const item = row(value);
	if (
		item.schema_version !== "tda_benchmark_quality_summary_v1" ||
		item.winner !== null ||
		item.composite_score !== null ||
		!Array.isArray(item.profiles) ||
		item.profiles.length > 4
	)
		return invalid();
	const benchmarkId = benchmarkIdentifier(item.benchmark_id);
	const reference = parseBenchmarkReferenceStatus(item.reference);
	const qualityMeasured = booleanValue(item.quality_measured);
	const profiles = item.profiles.map(qualityProfile);
	const expectedProfiles: readonly TranscriptionProfileId[] = [
		"whisper-turbo",
		"whisper-detailed",
		"qwen-fast",
		"qwen-quality",
	];
	if (
		reference.benchmarkId !== benchmarkId ||
		qualityMeasured !== (reference.activeRevision !== null) ||
		(!qualityMeasured && profiles.length !== 0) ||
		(qualityMeasured &&
			(profiles.length !== expectedProfiles.length ||
				profiles.some(
					(profile, index) =>
						profile.benchmarkId !== benchmarkId ||
						profile.profileId !== expectedProfiles[index] ||
						profile.referenceRevision !== reference.activeRevision ||
						profile.referenceSha256 !== reference.activeSha256,
				)))
	)
		return invalid();
	return {
		benchmarkId,
		reference,
		qualityMeasured,
		profiles,
		winner: null,
		compositeScore: null,
	};
}

export function parseBenchmarkQualityInspection(
	value: unknown,
): BenchmarkQualityInspection {
	const item = row(value);
	if (
		item.schema_version !== "tda_benchmark_quality_inspection_v1" ||
		item.private_text !== true ||
		!Array.isArray(item.regions) ||
		item.regions.length > 500 ||
		!Array.isArray(item.glossary_findings) ||
		item.glossary_findings.length > 512
	)
		return invalid();
	const regions = item.regions.map((value) => {
		const region = row(value);
		const kind = region.kind;
		if (
			kind !== "substitution_region" &&
			kind !== "deletion_region" &&
			kind !== "insertion_region" &&
			kind !== "unmatched_region"
		)
			return invalid();
		if (
			!Array.isArray(region.reference_word_range) ||
			region.reference_word_range.length !== 2 ||
			!Array.isArray(region.hypothesis_word_range) ||
			region.hypothesis_word_range.length !== 2
		)
			return invalid();
		const referenceStart = integer(region.reference_word_range[0]);
		const referenceEnd = integer(region.reference_word_range[1]);
		const hypothesisStart = integer(region.hypothesis_word_range[0]);
		const hypothesisEnd = integer(region.hypothesis_word_range[1]);
		if (referenceEnd < referenceStart || hypothesisEnd < hypothesisStart)
			return invalid();
		return {
			trackNumber: integer(region.track_number, 1),
			kind: kind as BenchmarkQualityInspection["regions"][number]["kind"],
			referenceWordRange: [referenceStart, referenceEnd] as const,
			hypothesisWordRange: [hypothesisStart, hypothesisEnd] as const,
			referenceContext: stringValue(region.reference_context, 2048),
			hypothesisContext: stringValue(region.hypothesis_context, 2048),
		};
	});
	const glossaryFindings = item.glossary_findings.map((value) => {
		const finding = row(value);
		return {
			term: nonEmptyString(finding.term, 256),
			referenceOccurrences: integer(finding.reference_occurrences),
			hypothesisOccurrences: integer(finding.hypothesis_occurrences),
			correctOccurrences: integer(finding.correct_occurrences),
			missedOccurrences: integer(finding.missed_occurrences),
			extraOccurrences: integer(finding.extra_occurrences),
		};
	});
	return {
		benchmarkId: benchmarkIdentifier(item.benchmark_id),
		profileId: profileId(item.profile_id),
		referenceRevision: integer(item.reference_revision, 1),
		referenceSha256: sha256(item.reference_sha256),
		normalizationPolicy: normalizationPolicy(item.normalization_policy),
		privateText: true,
		regions,
		truncated: booleanValue(item.truncated),
		glossaryFindings,
	};
}

export function serializeBenchmarkReferenceSave(
	input: BenchmarkReferenceSaveInput,
): Record<string, unknown> {
	if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
		return invalid();
	if (input.capabilityLevel !== 1 && input.capabilityLevel !== 2) return invalid();
	if (
		input.provenanceKind !== "manual" &&
		input.provenanceKind !== "imported" &&
		input.provenanceKind !== "derived-from-profile"
	)
		return invalid();
	if (
		input.provenanceKind === "derived-from-profile" &&
		!input.seedProfileId
	)
		return invalid();
	return {
		expected_revision: input.expectedRevision,
		capability_level: input.capabilityLevel,
		provenance_kind: input.provenanceKind,
		seed_profile_id: input.seedProfileId ?? null,
		glossary_terms: [...input.glossaryTerms],
		tracks: input.tracks.map((track) => ({
			track_number: track.trackNumber,
			speaker: track.speaker,
			text: track.text,
			turns: track.turns.map((turn) => ({
				id: turn.id,
				speaker: turn.speaker,
				start: turn.start,
				end: turn.end,
				text: turn.text,
				overlaps_other_speaker: turn.overlapsOtherSpeaker,
			})),
		})),
		activate: input.activate,
	};
}
