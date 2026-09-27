import { describe, expect, it } from "vitest";
import {
	estimateProfileProcessing,
	estimateRemainingProcessing,
	predictionErrorPercent,
} from "./processing-estimator";
import type {
	LocalRunSummary,
	SystemSnapshot,
	TranscriptionProfileState,
} from "./protocol";

const profile: TranscriptionProfileState = {
	id: "qwen-quality",
	engine: "qwen3",
	ready: true,
	preparationRequired: false,
	reason: null,
	model: "Qwen/Qwen3-ASR-1.7B-hf",
	modelRevision: "revision",
	runtimeVersion: "1.0.12",
	computeType: "bfloat16",
	gpuModel: "NVIDIA GeForce RTX 4070 Laptop GPU",
	gpuComputeCapability: "8.9",
};

const system: SystemSnapshot = {
	sampledAt: "2026-09-27T00:00:00Z",
	host: { os: "Windows", cpu: "CPU" },
	cpu: { utilizationPercent: 0 },
	memory: { usedBytes: 1, totalBytes: 2, percent: 50 },
	gpus: [
		{
			index: 0,
			name: "NVIDIA GeForce RTX 4070 Laptop GPU",
			utilizationPercent: 0,
			memoryUsedBytes: 0,
			memoryTotalBytes: 8 * 1024 ** 3,
		},
	],
};

function run(
	rtf: number,
	overrides: Partial<LocalRunSummary> = {},
): LocalRunSummary {
	return {
		runId: `run-${rtf}`,
		sourceId: "craig-source",
		profileId: "qwen-quality",
		engine: "qwen3",
		model: "Qwen/Qwen3-ASR-1.7B-hf",
		modelRevision: "revision",
		device: "cuda",
		computeType: "bfloat16",
		alignment: "forced",
		executionLineage: {
			schemaVersion: "tda_execution_lineage_v1",
			companionVersion: "0.3.16",
			runtimeFamily: "qwen",
			runtimeVersion: "1.0.12",
			device: "cuda",
			computeType: "bfloat16",
			gpu: {
				vendor: "NVIDIA",
				index: 0,
				model: "NVIDIA GeForce RTX 4070 Laptop GPU",
				vramTotalBytes: 8 * 1024 ** 3,
				computeCapability: "8.9",
				driverVersion: "616.56",
			},
		},
		language: "pt",
		completedAt: "2026-09-27T00:00:00Z",
		transcriptSha256: "a".repeat(64),
		transcriptSizeBytes: 1,
		stats: {
			audioWorkSeconds: 100,
			processingSeconds: 100 * rtf,
			processingMetrics: {
				version: "engine_processing_v1",
				stageSeconds: {
					runtime_validation: 0,
					checkpoint_scan: 0,
					model_prepare: 0,
					model_load: 0,
					transcription: 100 * rtf,
					alignment_and_energy: 0,
					consolidation: 0,
				},
				totalProcessingSeconds: 100 * rtf,
				totalTracks: 1,
				freshAsrTracks: 1,
				textCheckpointReusedTracks: 0,
				completedCheckpointReusedTracks: 0,
				freshAudioWorkSeconds: 100,
				reusedAudioWorkSeconds: 0,
				freshCalibrationEligible: true,
			},
			sessionDurationSeconds: 100,
			rtf,
			wordCount: 1,
			segmentCount: 1,
			trackCount: 1,
			turnCount: 1,
			deduplicatedSegmentCount: 0,
			warningCount: 0,
		},
		publicationTarget: null,
		review: null,
		...overrides,
	};
}

describe("calibrated processing estimator", () => {
	it("uses compatible local RTF quantiles and rejects a large outlier", () => {
		const estimate = estimateProfileProcessing({
			audioWorkSeconds: 600,
			profile,
			system,
			runs: [run(0.5), run(0.51), run(0.49), run(0.5), run(0.52), run(8)],
		});
		expect(estimate.available).toBe(true);
		if (!estimate.available) return;
		expect(estimate.sampleCount).toBe(5);
		expect(estimate.medianRtf).toBeCloseTo(0.5);
		expect(estimate.upperRtf).toBeLessThan(0.53);
		expect(estimate.confidence).toBe("high");
	});

	it("never mixes another runtime or GPU into calibration", () => {
		const estimate = estimateProfileProcessing({
			audioWorkSeconds: 600,
			profile,
			system,
			runs: [
				run(0.5, {
					executionLineage: {
						...run(0.5).executionLineage!,
						runtimeVersion: "1.0.11",
					},
				}),
				run(0.6, {
					executionLineage: {
						...run(0.6).executionLineage!,
						gpu: {
							...run(0.6).executionLineage!.gpu!,
							model: "NVIDIA GeForce RTX 3090",
						},
					},
				}),
			],
		});
		expect(estimate).toMatchObject({
			available: false,
			reason: "insufficient_history",
		});
	});

	it("requires real audio work and at least two compatible observations", () => {
		expect(
			estimateProfileProcessing({
				audioWorkSeconds: 0,
				profile,
				system,
				runs: [run(0.5), run(0.6)],
			}),
		).toMatchObject({ available: false, reason: "audio_work_unavailable" });
		expect(
			estimateProfileProcessing({
				audioWorkSeconds: 600,
				profile,
				system,
				runs: [run(0.5)],
			}),
		).toMatchObject({ available: false, reason: "insufficient_history" });
	});

	it("computes remaining time from remaining audio tracks, not percentage elapsed", () => {
		const estimate = estimateProfileProcessing({
			audioWorkSeconds: 600,
			profile,
			system,
			runs: [run(0.5), run(0.6), run(0.55)],
		});
		const remaining = estimateRemainingProcessing(estimate, [100, 200, 300], 1);
		expect(remaining).not.toBeNull();
		expect(remaining!.medianSeconds).toBeCloseTo(275);
	});

	it("can evaluate the signed prediction error after completion", () => {
		const estimate = estimateProfileProcessing({
			audioWorkSeconds: 600,
			profile,
			system,
			runs: [run(0.5), run(0.6), run(0.55)],
		});
		expect(predictionErrorPercent(estimate, 363)).toBeCloseTo(10);
	});

	it("excludes legacy and checkpoint-reused runs from fresh calibration", () => {
		const legacy = run(0.2, {
			stats: {
				...run(0.2).stats,
				processingMetrics: null,
			},
		});
		const cached = run(0.1, {
			stats: {
				...run(0.1).stats,
				processingMetrics: {
					...run(0.1).stats.processingMetrics!,
					totalTracks: 2,
					freshAsrTracks: 1,
					completedCheckpointReusedTracks: 1,
					freshAudioWorkSeconds: 50,
					reusedAudioWorkSeconds: 50,
					freshCalibrationEligible: false,
				},
			},
		});
		const estimate = estimateProfileProcessing({
			audioWorkSeconds: 600,
			profile,
			system,
			runs: [legacy, cached, run(0.5), run(0.6)],
		});
		expect(estimate.available).toBe(true);
		if (!estimate.available) return;
		expect(estimate.sampleCount).toBe(2);
		expect(estimate.medianRtf).toBeCloseTo(0.55);
	});

		it("refuses ambiguous historical compute modes when current mode is unknown", () => {
		const whisperProfile: TranscriptionProfileState = {
			...profile,
			id: "whisper-turbo",
			engine: "whisper",
			computeType: null,
			gpuModel: null,
			gpuComputeCapability: null,
		};
		const base = run(0.5, {
			profileId: "whisper-turbo",
			engine: "whisper",
			computeType: "float16",
		});
		const other = run(0.6, {
			profileId: "whisper-turbo",
			engine: "whisper",
			computeType: "int8_float16",
		});
		expect(
			estimateProfileProcessing({
				audioWorkSeconds: 600,
				profile: whisperProfile,
				system,
				runs: [base, other],
			}),
		).toMatchObject({
			available: false,
			reason: "compute_identity_ambiguous",
		});
	});
});
