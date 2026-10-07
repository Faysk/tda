import { describe, expect, it } from "vitest";
import {
	parseBenchmarkEvidenceSummary,
	parseBenchmarkResult,
	parseBenchmarkTranscriptSnapshot,
	type TranscriptionProfileId,
} from "./protocol";
import {
	compareRunPerformanceSemantics,
	compareRunSegments,
	summarizeRunComparison,
} from "./run-comparison";

const profiles: readonly TranscriptionProfileId[] = [
	"whisper-turbo",
	"whisper-detailed",
	"qwen-fast",
	"qwen-quality",
];

function lineage(profileId: TranscriptionProfileId) {
	const whisper = profileId.startsWith("whisper-");
	return {
		schema_version: "tda_execution_lineage_v1",
		companion_version: "0.3.18",
		runtime_family: whisper ? "whisper" : "qwen",
		runtime_version: "1.2.3",
		device: "cuda",
		compute_type: "float16",
		runtime_artifact: {
			runtime_id: whisper ? "whisper-ctranslate2" : "qwen3-transformers",
			version: "1.2.3",
			worker_sha256: "1".repeat(64),
			archive_sha256: "2".repeat(64),
		},
		execution_device: {
			kind: "cuda",
			logical_index: 0,
			physical_uuid: "GPU-12345678-1234-1234-1234-123456789abc",
			pci_bus_id: "00000000:01:00.0",
		},
		gpu: {
			vendor: "NVIDIA",
			index: 0,
			model: "Synthetic GPU",
			vram_total_bytes: 8 * 1024 ** 3,
			compute_capability: "8.9",
			driver_version: "fixture",
		},
	};
}

function profileReceipt(
	profileId: TranscriptionProfileId,
	withEvidence = false,
) {
	const whisper = profileId.startsWith("whisper-");
	return {
		schema_version: "tda_benchmark_profile_v1",
		profile_id: profileId,
		engine: whisper ? "whisper" : "qwen3",
		model: `model-${profileId}`,
		model_revision: null,
		device: "cuda",
		compute_type: "float16",
		alignment: "native",
		sample_seconds: 300,
		audio_work_seconds: 300,
		session_duration_seconds: 300,
		processing_timing_version: "engine_processing_v1",
		processing_seconds: 30,
		rtf: 0.1,
		word_count: 10,
		segment_count: 2,
		track_count: 1,
		warning_count: 0,
		execution_lineage: lineage(profileId),
		...(withEvidence
			? {
					benchmark_id: "benchmark-job-1-a1",
					sample_identity_sha256: "a".repeat(64),
					transcript_sha256: "f".repeat(64),
					transcript_size_bytes: 2048,
					artifact_available: true,
				}
			: {}),
	};
}

function benchmarkResult(withEvidence = false) {
	return {
		schema_version: "tda_processing_benchmark_v1",
		kind: "benchmark.craig",
		job_id: "job-1",
		source_id: "source-1",
		campaign_id: "campaign-1",
		session_id: "session-1",
		sample_identity_sha256: "a".repeat(64),
		sample_seconds: 300,
		execution_mode: "prepared_artifacts_fresh_worker_per_profile_v1",
		track_count: 1,
		audio_work_seconds: 300,
		prepared: true,
		...(withEvidence
			? {
					benchmark_id: "benchmark-job-1-a1",
					bundle_manifest_sha256: "c".repeat(64),
					bundle_size_bytes: 4096,
				}
			: {}),
		profiles: profiles.map((profileId) =>
			profileReceipt(profileId, withEvidence),
		),
	};
}

function snapshot(profileId: TranscriptionProfileId, text: string, start = 0) {
	const whisper = profileId.startsWith("whisper-");
	return {
		schema_version: "tda_benchmark_transcript_snapshot_v1",
		benchmark_id: "benchmark-job-1-a1",
		sample_identity_sha256: "a".repeat(64),
		source_id: "source-1",
		source_sha256: "b".repeat(64),
		profile_id: profileId,
		engine: whisper ? "whisper" : "qwen3",
		model: `model-${profileId}`,
		model_revision: null,
		device: "cuda",
		compute_type: "float16",
		alignment: "native",
		execution_lineage: lineage(profileId),
		stats: {
			audio_work_seconds: 300,
			processing_seconds: 30,
			processing_metrics: {
				version: "engine_processing_v1",
				external_preparation_included: false,
				stage_seconds: {
					runtime_validation: 1,
					checkpoint_scan: 1,
					model_prepare: 2,
					model_load: 2,
					transcription: 20,
					alignment_and_energy: 3,
					consolidation: 1,
				},
				total_processing_seconds: 30,
				total_tracks: 1,
				fresh_asr_tracks: 1,
				text_checkpoint_reused_tracks: 0,
				completed_checkpoint_reused_tracks: 0,
				fresh_audio_work_seconds: 300,
				reused_audio_work_seconds: 0,
				fresh_calibration_eligible: true,
			},
			session_duration_seconds: 300,
			duration_semantics: "session_extent_v1",
			rtf: 0.1,
			word_count: 3,
			segment_count: 1,
			track_count: 1,
			turn_count: 0,
			deduplicated_segment_count: 0,
			warning_count: 0,
		},
		warnings: [],
		segments: [
			{
				track_number: 1,
				segment_id: `${profileId}-segment`,
				start,
				end: start + 2,
				timeline_start: start,
				timeline_end: start + 2,
				text,
				speaker: "Alice",
				word_count: 3,
				timing_precision: "word",
			},
		],
	};
}

describe("benchmark evidence contract", () => {
	it("preserves measured VRAM coverage without inventing historical telemetry", () => {
		const value = snapshot("qwen-fast", "fixture");
		expect(
			parseBenchmarkTranscriptSnapshot(value, "benchmark-job-1-a1", "qwen-fast")
				.telemetry,
		).toBeNull();
		const measured = {
			...value,
			telemetry: {
				captured_samples: 3,
				coverage: 0.75,
				missing_reason: "coverage_gap",
				vram_peak_bytes: 4 * 1024 ** 3,
				vram_average_bytes: 3 * 1024 ** 3,
			},
		};
		expect(
			parseBenchmarkTranscriptSnapshot(
				measured,
				"benchmark-job-1-a1",
				"qwen-fast",
			).telemetry,
		).toMatchObject({
			capturedSamples: 3,
			coverage: 0.75,
			vramPeakBytes: 4 * 1024 ** 3,
		});
		for (const invalid of [
			{ ...measured.telemetry, coverage: 1.1 },
			{ ...measured.telemetry, vram_peak_bytes: -1 },
		]) {
			expect(() =>
				parseBenchmarkTranscriptSnapshot(
					{ ...value, telemetry: invalid },
					"benchmark-job-1-a1",
					"qwen-fast",
				),
			).toThrow();
		}
	});
	it("keeps historical receipts valid without invented artifacts", () => {
		const parsed = parseBenchmarkResult(benchmarkResult(), "job-1");
		expect(parsed.benchmarkId).toBeNull();
		expect(parsed.bundleManifestSha256).toBeNull();
		expect(parsed.profiles.every((profile) => !profile.artifactAvailable)).toBe(
			true,
		);
	});

	it("accepts an immutable evidence pointer on new receipts", () => {
		const parsed = parseBenchmarkResult(benchmarkResult(true), "job-1");
		expect(parsed).toMatchObject({
			benchmarkId: "benchmark-job-1-a1",
			bundleManifestSha256: "c".repeat(64),
			bundleSizeBytes: 4096,
		});
		expect(parsed.profiles.every((profile) => profile.artifactAvailable)).toBe(
			true,
		);
	});

	it("parses a verified bundle summary and all four profile formats", () => {
		expect(
			parseBenchmarkEvidenceSummary(
				{
					schema_version: "tda_benchmark_bundle_v1",
					benchmark_id: "benchmark-job-1-a1",
					sample_identity_sha256: "a".repeat(64),
					source_id: "source-1",
					profile_order: profiles,
					bundle_size_bytes: 4096,
				},
				"benchmark-job-1-a1",
			),
		).toMatchObject({
			benchmarkId: "benchmark-job-1-a1",
			profileOrder: profiles,
			integrity: "manifest_verified",
		});
	});

	it("feeds benchmark snapshots into the existing segmentation-aware comparator", () => {
		const left = parseBenchmarkTranscriptSnapshot(
			snapshot("qwen-fast", "Neverwinter"),
			"benchmark-job-1-a1",
			"qwen-fast",
		);
		const right = parseBenchmarkTranscriptSnapshot(
			snapshot("qwen-quality", "Never winter", 0.02),
			"benchmark-job-1-a1",
			"qwen-quality",
		);
		const regions = compareRunSegments(left.segments, right.segments);
		expect(summarizeRunComparison(regions)).toMatchObject({
			totalRegions: 1,
			differentRegions: 1,
		});
		expect(regions[0]?.kind).toBe("changed");
		expect(compareRunPerformanceSemantics(left, right).status).toBe(
			"comparable",
		);
	});

	it("accepts every distinct pair in the four-profile comparison matrix", () => {
		const parsed = Object.fromEntries(
			profiles.map((profileId) => [
				profileId,
				parseBenchmarkTranscriptSnapshot(
					snapshot(profileId, `texto ${profileId}`),
					"benchmark-job-1-a1",
					profileId,
				),
			]),
		) as Record<
			TranscriptionProfileId,
			ReturnType<typeof parseBenchmarkTranscriptSnapshot>
		>;

		let pairs = 0;
		for (let leftIndex = 0; leftIndex < profiles.length; leftIndex += 1) {
			for (
				let rightIndex = leftIndex + 1;
				rightIndex < profiles.length;
				rightIndex += 1
			) {
				const left = parsed[profiles[leftIndex]!]!;
				const right = parsed[profiles[rightIndex]!]!;
				expect(compareRunSegments(left.segments, right.segments)).toHaveLength(
					1,
				);
				pairs += 1;
			}
		}
		expect(pairs).toBe(6);
	});

	it("keeps identical benchmark transcript text equal across different segmentation ids", () => {
		const left = parseBenchmarkTranscriptSnapshot(
			snapshot("whisper-turbo", "mesma fala"),
			"benchmark-job-1-a1",
			"whisper-turbo",
		);
		const right = parseBenchmarkTranscriptSnapshot(
			snapshot("whisper-detailed", "mesma fala", 0.01),
			"benchmark-job-1-a1",
			"whisper-detailed",
		);
		expect(compareRunSegments(left.segments, right.segments)[0]?.kind).toBe(
			"equal",
		);
	});
});
