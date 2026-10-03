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
			physical_uuid: "GPU-SYNTHETIC",
			pci_bus_id: "0000:01:00.0",
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

function profileReceipt(profileId: TranscriptionProfileId) {
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
	};
}

function benchmarkResult(artifactBundle?: Record<string, unknown>) {
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
		...(artifactBundle ? { artifact_bundle: artifactBundle } : {}),
		profiles: profiles.map(profileReceipt),
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
	it("keeps historical receipts valid without invented artifacts", () => {
		const parsed = parseBenchmarkResult(benchmarkResult(), "job-1");
		expect(parsed.artifacts).toBeNull();
		expect(parsed.profiles).toHaveLength(4);
	});

	it("accepts an immutable evidence pointer on new receipts", () => {
		const parsed = parseBenchmarkResult(
			benchmarkResult({
				schema_version: "tda_benchmark_artifacts_v1",
				benchmark_id: "benchmark-job-1-a1",
				manifest_sha256: "c".repeat(64),
				manifest_size_bytes: 1024,
				bundle_size_bytes: 4096,
				profile_count: 4,
			}),
			"job-1",
		);
		expect(parsed.artifacts).toMatchObject({
			benchmarkId: "benchmark-job-1-a1",
			profileCount: 4,
		});
	});

	it("parses a verified bundle summary and all four profile formats", () => {
		expect(
			parseBenchmarkEvidenceSummary(
				{
					schema_version: "tda_benchmark_artifacts_v1",
					benchmark_id: "benchmark-job-1-a1",
					sample_identity_sha256: "a".repeat(64),
					source_id: "source-1",
					profile_order: profiles,
					bundle_size_bytes: 4096,
					formats: ["json", "txt", "vtt", "srt"],
					quality_reference_status: "none",
					telemetry_available: false,
					integrity: "verified",
				},
				"benchmark-job-1-a1",
			),
		).toMatchObject({
			benchmarkId: "benchmark-job-1-a1",
			profileOrder: profiles,
			integrity: "verified",
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
		expect(compareRunPerformanceSemantics(left, right).status).toBe("comparable");
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
		expect(compareRunSegments(left.segments, right.segments)[0]?.kind).toBe("equal");
	});
});
