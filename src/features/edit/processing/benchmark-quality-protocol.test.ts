import { describe, expect, it } from "vitest";
import {
	parseBenchmarkQualityInspection,
	parseBenchmarkQualitySummary,
	parseBenchmarkReference,
	parseBenchmarkReferenceDraft,
	serializeBenchmarkReferenceSave,
} from "./benchmark-quality-protocol";

const normalization = {
	schema_version: "tda_asr_text_normalization_v1",
	unicode_normalization: "NFC",
	case: "unicode_casefold",
	whitespace: "collapse",
	punctuation: "strip_unicode_punctuation_except_apostrophe_hyphen_v1",
	diacritics: "preserve",
	locale_dependent: false,
};

describe("benchmark quality protocol", () => {
	it("accepts level-one references without timed turns", () => {
		const parsed = parseBenchmarkReference({
			schema_version: "tda_benchmark_reference_v1",
			benchmark_id: "benchmark-quality-a1",
			source_sha256: "b".repeat(64),
			sample_identity_sha256: "c".repeat(64),
			revision: 1,
			parent_revision: null,
			capability_level: 1,
			canonical_payload_sha256: "d".repeat(64),
			provenance: {
				kind: "manual",
				seed_profile_id: null,
				human_owned: true,
			},
			normalization_policy: normalization,
			glossary_terms: ["Baróvia"],
			tracks: [
				{
					track_number: 1,
					speaker: "Renan",
					text: "Olá, Baróvia. 🐉",
				},
			],
		});

		expect(parsed.capabilityLevel).toBe(1);
		expect(parsed.tracks[0]?.turns).toEqual([]);
		expect(parsed.normalizationPolicy.diacritics).toBe("preserve");
		expect(parsed.tracks[0]?.text).toContain("🐉");
	});

	it("parses profile-derived drafts as human-owned level one", () => {
		const parsed = parseBenchmarkReferenceDraft({
			schema_version: "tda_benchmark_reference_draft_v1",
			benchmark_id: "benchmark-quality-a1",
			source_sha256: "b".repeat(64),
			sample_identity_sha256: "c".repeat(64),
			capability_level: 1,
			provenance: {
				kind: "derived-from-profile",
				seed_profile_id: "whisper-turbo",
				human_owned: true,
			},
			normalization_policy: normalization,
			glossary_terms: [],
			tracks: [
				{
					track_number: 1,
					speaker: "Renan",
					text: "rascunho local",
				},
			],
		});

		expect(parsed.provenance).toEqual({
			kind: "derived-from-profile",
			seedProfileId: "whisper-turbo",
			humanOwned: true,
		});
		expect(parsed.tracks[0]?.text).toBe("rascunho local");
	});

	it("keeps quality summaries sanitized and winner-free", () => {
		const value = {
			schema_version: "tda_benchmark_quality_summary_v1",
			benchmark_id: "benchmark-quality-a1",
			reference: {
				schema_version: "tda_benchmark_reference_status_v1",
				benchmark_id: "benchmark-quality-a1",
				latest_revision: 1,
				active_revision: 1,
				active_sha256: "d".repeat(64),
				normalization_policy: normalization,
			},
			quality_measured: true,
			winner: null,
			composite_score: null,
			profiles: [
				"whisper-turbo",
				"whisper-detailed",
				"qwen-fast",
				"qwen-quality",
			].map((profileId, index) => ({
				schema_version: "tda_benchmark_quality_receipt_v1",
				benchmark_id: "benchmark-quality-a1",
				benchmark_manifest_sha256: "e".repeat(64),
				sample_identity_sha256: "c".repeat(64),
				profile_id: profileId,
				profile_transcript_sha256: String(index + 1).repeat(64),
				reference_revision: 1,
				reference_sha256: "d".repeat(64),
				normalization_policy: normalization,
				normalization_policy_sha256: "f".repeat(64),
				metric_implementation_version: "tda_asr_quality_metrics_v1",
				capability_level: 1,
				receipt_sha256: "9".repeat(64),
				receipt_size_bytes: 2048,
				metrics: {
					metric_implementation_version: "tda_asr_quality_metrics_v1",
					normalization_policy: normalization,
					normalization_policy_sha256: "f".repeat(64),
					capability_level: 1,
					per_track: [
						{
							track_number: 1,
							state: "matched",
							substitutions: 1,
							deletions: 0,
							insertions: 2,
							distance: 3,
							reference_words: 10,
							hypothesis_words: 12,
							wer_normalized: 0.3,
							reference_characters: 40,
							hypothesis_characters: 43,
							character_distance: 4,
							cer_normalized: 0.1,
						},
					],
					micro: {
						substitutions: 1,
						deletions: 0,
						insertions: 2,
						distance: 3,
						reference_words: 10,
						hypothesis_words: 12,
						wer_normalized: 0.3,
						reference_characters: 40,
						hypothesis_characters: 43,
						character_distance: 4,
						cer_normalized: 0.1,
						macro_wer_normalized: 0.3,
					},
					glossary: {
						available: true,
						reference_occurrences: 2,
						correct_occurrences: 1,
						missed_occurrences: 1,
						extra_occurrences: 0,
						recall: 0.5,
						precision: 1,
						terms: [{ term_sha256: "1".repeat(64) }],
					},
					timing: {
						available: false,
						reason: "reference_capability_level_1",
						timing_precision: "segment_aligned",
					},
				},
			})),
		};

		const parsed = parseBenchmarkQualitySummary(value);
		expect(parsed.winner).toBeNull();
		expect(parsed.compositeScore).toBeNull();
		expect(parsed.profiles).toHaveLength(4);
		expect(parsed.profiles[0]?.metrics.micro).toMatchObject({
			substitutions: 1,
			deletions: 0,
			insertions: 2,
			werNormalized: 0.3,
		});
		expect(JSON.stringify(parsed)).not.toContain("Baróvia");
	});

	it("parses private error inspection separately from sanitized receipts", () => {
		const parsed = parseBenchmarkQualityInspection({
			schema_version: "tda_benchmark_quality_inspection_v1",
			benchmark_id: "benchmark-quality-a1",
			profile_id: "whisper-turbo",
			reference_revision: 2,
			reference_sha256: "b".repeat(64),
			normalization_policy: normalization,
			private_text: true,
			regions: [
				{
					track_number: 1,
					kind: "substitution_region",
					reference_word_range: [3, 4],
					hypothesis_word_range: [3, 4],
					reference_context: "joão chegou cedo",
					hypothesis_context: "joao chegou cedo",
				},
			],
			truncated: false,
			glossary_findings: [
				{
					term: "João",
					reference_occurrences: 1,
					hypothesis_occurrences: 0,
					correct_occurrences: 0,
					missed_occurrences: 1,
					extra_occurrences: 0,
				},
			],
		});

		expect(parsed.privateText).toBe(true);
		expect(parsed.regions[0]?.referenceContext).toContain("joão");
		expect(parsed.glossaryFindings[0]?.term).toBe("João");
	});

	it("serializes references without adding publication intent", () => {
		const body = serializeBenchmarkReferenceSave({
			expectedRevision: 0,
			capabilityLevel: 1,
			provenanceKind: "derived-from-profile",
			seedProfileId: "qwen-quality",
			glossaryTerms: ["Strahd"],
			tracks: [
				{
					trackNumber: 1,
					speaker: "Renan",
					text: "texto corrigido",
					turns: [],
				},
			],
			activate: true,
		});

		expect(body).toMatchObject({
			expected_revision: 0,
			capability_level: 1,
			provenance_kind: "derived-from-profile",
			seed_profile_id: "qwen-quality",
			activate: true,
		});
		expect(body).not.toHaveProperty("publish");
		expect(body).not.toHaveProperty("sync");
	});
});
