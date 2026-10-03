import { describe, expect, it } from "vitest";
import {
	parseBenchmarkProfileMetrics,
	parseBenchmarkProfileTelemetry,
	parseBenchmarkQualitySummary,
	parseBenchmarkReference,
	parseBenchmarkResult,
	parseBenchmarkTranscript,
} from "./protocol";
import { compareRunSegments, summarizeRunComparison } from "./run-comparison";

const sha = (char: string) => char.repeat(64);

function lineage(family: "whisper" | "qwen") {
	return {
		schema_version: "tda_execution_lineage_v1",
		companion_version: "test",
		runtime_family: family,
		runtime_version: "1.2.3",
		runtime_artifact: {
			runtime_id: \`\${family}-test\`,
			version: "1.2.3",
			worker_sha256: sha("a"),
			archive_sha256: sha("b"),
		},
		device: "cuda:0",
		execution_device: {
			kind: "cuda",
			logical_index: 0,
			physical_uuid: "GPU-SYNTHETIC",
			pci_bus_id: "0000:01:00.0",
		},
		compute_type: "float16",
		gpu: {
			vendor: "NVIDIA",
			index: 0,
			model: "Synthetic GPU",
			vram_total_bytes: 8 * 1024 ** 3,
			compute_capability: "8.9",
			driver_version: "synthetic",
		},
	};
}

function profile(profileId: string, engine: "whisper" | "qwen3") {
	return {
		schema_version: "tda_benchmark_profile_v1",
		profile_id: profileId,
		engine,
		model: "model",
		model_revision: "revision",
		device: "cuda:0",
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
		execution_lineage: lineage(engine === "whisper" ? "whisper" : "qwen"),
		transcript_sha256: sha("c"),
		transcript_size_bytes: 2048,
		artifact_available: true,
	};
}

describe("benchmark evidence protocol", () => {
	it("keeps legacy receipts readable and exposes additive evidence metadata", () => {
		const base = {
			schema_version: "tda_processing_benchmark_v1",
			job_id: "benchmark-job",
			kind: "benchmark.craig",
			source_id: \`craig-\${sha("d")}\`,
			campaign_id: "benchmark-local",
			session_id: "benchmark-local",
			sample_identity_sha256: sha("e"),
			sample_seconds: 300,
			execution_mode: "prepared_artifacts_fresh_worker_per_profile_v1",
			track_count: 1,
			audio_work_seconds: 300,
			prepared: true,
			profiles: [
				profile("whisper-turbo", "whisper"),
				profile("whisper-detailed", "whisper"),
				profile("qwen-fast", "qwen3"),
				profile("qwen-quality", "qwen3"),
			],
		};

		const current = parseBenchmarkResult(
			{
				...base,
				benchmark_id: \`benchmark-\${"1".repeat(32)}\`,
				bundle_manifest_sha256: sha("f"),
				bundle_size_bytes: 9999,
			},
			"benchmark-job",
		);
		expect(current.benchmarkId).toBe(\`benchmark-\${"1".repeat(32)}\`);
		expect(current.bundleManifestSha256).toBe(sha("f"));
		expect(current.profiles.every((item) => item.artifactAvailable)).toBe(true);

		const legacy = parseBenchmarkResult(
			{
				...base,
				profiles: base.profiles.map(({ transcript_sha256, transcript_size_bytes, artifact_available, ...item }) => item),
			},
			"benchmark-job",
		);
		expect(legacy.benchmarkId).toBeNull();
		expect(legacy.bundleManifestSha256).toBeNull();
		expect(legacy.profiles.every((item) => !item.artifactAvailable)).toBe(true);
	});

	it("parses canonical benchmark transcripts into timeline-aware comparison segments", () => {
		const left = parseBenchmarkTranscript(
			{
				schema_version: "tda_transcript_v1",
				source_sha256: sha("a"),
				engine: { profile: "whisper-turbo" },
				tracks: [
					{
						number: 1,
						speaker: "Alice",
						timeline_offset_seconds: 5,
						segments: [{ id: "a", start: 1, end: 2, text: "Olá mundo" }],
					},
				],
			},
			"whisper-turbo",
		);
		const right = parseBenchmarkTranscript(
			{
				schema_version: "tda_transcript_v1",
				source_sha256: sha("a"),
				engine: { profile: "qwen-quality" },
				tracks: [
					{
						number: 1,
						speaker: "Alice",
						timeline_offset_seconds: 5,
						segments: [{ id: "b", start: 1.05, end: 2.05, text: "Olá mundo!" }],
					},
				],
			},
			"qwen-quality",
		);
		expect(left.segments[0]).toMatchObject({ timelineStart: 6, timelineEnd: 7 });
		expect(
			summarizeRunComparison(compareRunSegments(left.segments, right.segments)),
		).toMatchObject({ changedRegions: 1, differentRegions: 1 });
	});

	it("parses stage timing and telemetry without host identity", () => {
		const metrics = parseBenchmarkProfileMetrics({
			schema_version: "tda_benchmark_metrics_v1",
			profile_id: "qwen-fast",
			processing_seconds: 20,
			rtf: 0.2,
			execution_lineage: lineage("qwen"),
			processing_metrics: {
				version: "engine_processing_v1",
				stage_seconds: {
					runtime_validation: 1,
					checkpoint_scan: 0,
					model_prepare: 2,
					model_load: 3,
					transcription: 10,
					alignment_and_energy: 3,
					consolidation: 1,
				},
				fresh_audio_work_seconds: 300,
				reused_audio_work_seconds: 0,
			},
		});
		expect(metrics.stageSeconds.transcription).toBe(10);
		expect(metrics.freshAudioWorkSeconds).toBe(300);

		const telemetry = parseBenchmarkProfileTelemetry({
			schema_version: "tda_benchmark_telemetry_v1",
			coverage: 1,
			captured_samples: 4,
			aggregates: {
				cpu_avg_percent: 20,
				cpu_p95_percent: 30,
				ram_peak_bytes: 4096,
				gpu_utilization_avg_percent: 80,
				gpu_utilization_p95_percent: 95,
				gpu_utilization_peak_percent: 99,
				vram_peak_bytes: 8192,
				temperature_max_c: 60,
				power_avg_w: 100,
				power_peak_w: 120,
			},
			host: "must be ignored",
		});
		expect(telemetry.aggregates.gpuUtilizationPeakPercent).toBe(99);
		expect(telemetry).not.toHaveProperty("host");
	});

	it("parses private reference revisions and objective quality without a composite winner", () => {
		const reference = parseBenchmarkReference({
			reference: {
				schema_version: "tda_benchmark_reference_v1",
				revision: 2,
				provenance: "manual",
				seed_profile_id: null,
				capability: "text",
				payload: {
					tracks: [{ track_number: 1, speaker: "Alice", text: "Olá mundo" }],
				},
			},
		});
		expect(reference?.revision).toBe(2);
		expect(reference?.tracks[0]?.text).toBe("Olá mundo");

		const quality = parseBenchmarkQualitySummary({
			schema_version: "tda_benchmark_quality_summary_v1",
			benchmark_id: \`benchmark-\${"1".repeat(32)}\`,
			quality_measured: true,
			reference: {
				revision: 2,
				capability: "text",
				provenance: "manual",
				seed_profile_id: null,
			},
			profiles: [
				{
					profile_id: "whisper-turbo",
					overall: {
						reference_words: 2,
						hypothesis_words: 2,
						substitutions: 0,
						deletions: 0,
						insertions: 0,
						wer_normalized: 0,
						reference_characters: 8,
						hypothesis_characters: 8,
						character_edits: 0,
						cer_normalized: 0,
					},
					timing: null,
					term_fidelity: null,
				},
			],
		});
		expect(quality.qualityMeasured).toBe(true);
		expect(quality.profiles[0]?.overall.werNormalized).toBe(0);
		expect(quality).not.toHaveProperty("winner");
	});
});
