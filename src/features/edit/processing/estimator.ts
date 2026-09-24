import type { LocalRunSummary } from "./protocol";

export type CalibrationConfidence = "high" | "medium" | "low" | "unavailable";
export type CalibrationOrigin = "run" | "benchmark";

export type CalibrationSignature = Readonly<{
	profileId: string;
	engine: string;
	model: string;
	modelRevision: string | null;
	runtimeFamily: string;
	runtimeVersion: string;
	companionVersion: string;
	device: string;
	computeType: string;
	alignment: string | null;
	gpuModel: string | null;
	gpuComputeCapability: string | null;
	driverVersion: string | null;
}>;

export type CalibrationSample = Readonly<{
	origin: CalibrationOrigin;
	signature: CalibrationSignature;
	rtf: number;
	audioWorkSeconds: number;
	processingSeconds: number;
	occurredAt: string | null;
}>;

export type ProcessingEstimate =
	| Readonly<{
			status: "unavailable";
			confidence: "unavailable";
			reason:
				| "audio_work_unavailable"
				| "signature_unavailable"
				| "no_compatible_samples";
			sampleCount: 0;
			runCount: 0;
			benchmarkCount: 0;
	  }>
	| Readonly<{
			status: "available";
			confidence: Exclude<CalibrationConfidence, "unavailable">;
			sampleCount: number;
			runCount: number;
			benchmarkCount: number;
			medianRtf: number;
			lowerRtf: number | null;
			upperRtf: number | null;
			medianSeconds: number;
			lowerSeconds: number | null;
			upperSeconds: number | null;
			relativeIqr: number | null;
			fixedOverheadSeconds: null;
	  }>;

const MAX_SANE_RTF = 50;

function clean(value: string | null | undefined): string | null {
	const normalized = value?.trim();
	return normalized ? normalized : null;
}

export function calibrationSignatureFromRun(
	run: LocalRunSummary,
): CalibrationSignature | null {
	const lineage = run.executionLineage;
	if (!lineage) return null;

	const profileId = clean(run.profileId);
	const engine = clean(run.engine);
	const model = clean(run.model);
	const runtimeFamily = clean(lineage.runtimeFamily);
	const runtimeVersion = clean(lineage.runtimeVersion);
	const companionVersion = clean(lineage.companionVersion);
	const device = clean(lineage.device ?? run.device);
	const computeType = clean(lineage.computeType ?? run.computeType);
	if (
		!profileId ||
		!engine ||
		!model ||
		!runtimeFamily ||
		!runtimeVersion ||
		!companionVersion ||
		!device ||
		!computeType
	) {
		return null;
	}

	const cuda = /^cuda(?::\d+)?$/iu.test(device);
	const gpuModel = clean(lineage.gpu?.model);
	const gpuComputeCapability = clean(lineage.gpu?.computeCapability);
	if (cuda && (!gpuModel || !gpuComputeCapability)) return null;

	return {
		profileId,
		engine,
		model,
		modelRevision: clean(run.modelRevision),
		runtimeFamily,
		runtimeVersion,
		companionVersion,
		device,
		computeType,
		alignment: clean(run.alignment),
		gpuModel: cuda ? gpuModel : null,
		gpuComputeCapability: cuda ? gpuComputeCapability : null,
		driverVersion: cuda ? clean(lineage.gpu?.driverVersion) : null,
	};
}

export function calibrationSignatureKey(
	signature: CalibrationSignature,
): string {
	return [
		signature.profileId,
		signature.engine,
		signature.model,
		signature.modelRevision ?? "unknown-revision",
		signature.runtimeFamily,
		signature.runtimeVersion,
		signature.companionVersion,
		signature.device,
		signature.computeType,
		signature.alignment ?? "unknown-alignment",
		signature.gpuModel ?? "no-gpu",
		signature.gpuComputeCapability ?? "no-capability",
		signature.driverVersion ?? "unknown-driver",
	].join("\u001f");
}

export function calibrationSampleFromRun(
	run: LocalRunSummary,
): CalibrationSample | null {
	const signature = calibrationSignatureFromRun(run);
	const audioWorkSeconds = run.stats.audioWorkSeconds;
	const processingSeconds = run.stats.processingSeconds;
	if (
		!signature ||
		audioWorkSeconds === null ||
		processingSeconds === null ||
		!Number.isFinite(audioWorkSeconds) ||
		!Number.isFinite(processingSeconds) ||
		audioWorkSeconds <= 0 ||
		processingSeconds <= 0
	) {
		return null;
	}
	const rtf = processingSeconds / audioWorkSeconds;
	if (!Number.isFinite(rtf) || rtf <= 0 || rtf > MAX_SANE_RTF) return null;
	return {
		origin: "run",
		signature,
		rtf,
		audioWorkSeconds,
		processingSeconds,
		occurredAt: run.completedAt,
	};
}

function quantile(sorted: readonly number[], fraction: number): number {
	if (sorted.length === 0) throw new Error("CALIBRATION_SAMPLE_REQUIRED");
	if (fraction < 0 || fraction > 1)
		throw new Error("CALIBRATION_QUANTILE_INVALID");
	const position = (sorted.length - 1) * fraction;
	const lowerIndex = Math.floor(position);
	const upperIndex = Math.ceil(position);
	const lower = sorted[lowerIndex];
	const upper = sorted[upperIndex];
	if (lower === undefined || upper === undefined)
		throw new Error("CALIBRATION_QUANTILE_OUT_OF_RANGE");
	if (lowerIndex === upperIndex) return lower;
	const weight = position - lowerIndex;
	return lower + (upper - lower) * weight;
}

function confidenceFor(
	sampleCount: number,
	medianRtf: number,
	lowerRtf: number | null,
	upperRtf: number | null,
): {
	confidence: Exclude<CalibrationConfidence, "unavailable">;
	relativeIqr: number | null;
} {
	if (
		lowerRtf === null ||
		upperRtf === null ||
		!Number.isFinite(medianRtf) ||
		medianRtf <= 0
	) {
		return { confidence: "low", relativeIqr: null };
	}
	const relativeIqr = Math.max(0, (upperRtf - lowerRtf) / medianRtf);
	if (sampleCount >= 3 && relativeIqr <= 0.15)
		return { confidence: "high", relativeIqr };
	if (sampleCount >= 2 && relativeIqr <= 0.35)
		return { confidence: "medium", relativeIqr };
	return { confidence: "low", relativeIqr };
}

export function estimateProcessingTime(input: Readonly<{
	audioWorkSeconds: number | null;
	signature: CalibrationSignature | null;
	samples: readonly CalibrationSample[];
}>): ProcessingEstimate {
	const { audioWorkSeconds, signature, samples } = input;
	if (
		audioWorkSeconds === null ||
		!Number.isFinite(audioWorkSeconds) ||
		audioWorkSeconds <= 0
	) {
		return {
			status: "unavailable",
			confidence: "unavailable",
			reason: "audio_work_unavailable",
			sampleCount: 0,
			runCount: 0,
			benchmarkCount: 0,
		};
	}
	if (!signature) {
		return {
			status: "unavailable",
			confidence: "unavailable",
			reason: "signature_unavailable",
			sampleCount: 0,
			runCount: 0,
			benchmarkCount: 0,
		};
	}

	const key = calibrationSignatureKey(signature);
	const compatible = samples.filter(
		(sample) =>
			calibrationSignatureKey(sample.signature) === key &&
			Number.isFinite(sample.rtf) &&
			sample.rtf > 0 &&
			sample.rtf <= MAX_SANE_RTF,
	);
	if (compatible.length === 0) {
		return {
			status: "unavailable",
			confidence: "unavailable",
			reason: "no_compatible_samples",
			sampleCount: 0,
			runCount: 0,
			benchmarkCount: 0,
		};
	}

	const values = compatible.map((sample) => sample.rtf).sort((a, b) => a - b);
	const medianRtf = quantile(values, 0.5);
	let lowerRtf: number | null = null;
	let upperRtf: number | null = null;
	if (values.length === 2) {
		lowerRtf = values[0] ?? null;
		upperRtf = values[1] ?? null;
	} else if (values.length >= 3) {
		lowerRtf = quantile(values, 0.25);
		upperRtf = quantile(values, 0.75);
	}
	const calibration = confidenceFor(
		values.length,
		medianRtf,
		lowerRtf,
		upperRtf,
	);
	const runCount = compatible.filter((sample) => sample.origin === "run").length;
	const benchmarkCount = compatible.length - runCount;
	return {
		status: "available",
		confidence: calibration.confidence,
		sampleCount: compatible.length,
		runCount,
		benchmarkCount,
		medianRtf,
		lowerRtf,
		upperRtf,
		medianSeconds: audioWorkSeconds * medianRtf,
		lowerSeconds:
			lowerRtf === null ? null : audioWorkSeconds * lowerRtf,
		upperSeconds:
			upperRtf === null ? null : audioWorkSeconds * upperRtf,
		relativeIqr: calibration.relativeIqr,
		fixedOverheadSeconds: null,
	};
}

export function estimateMedianErrorPercent(
	estimate: Pick<Extract<ProcessingEstimate, { status: "available" }>, "medianSeconds">,
	actualProcessingSeconds: number,
): number | null {
	if (
		!Number.isFinite(actualProcessingSeconds) ||
		actualProcessingSeconds <= 0 ||
		!Number.isFinite(estimate.medianSeconds) ||
		estimate.medianSeconds <= 0
	) {
		return null;
	}
	return ((actualProcessingSeconds - estimate.medianSeconds) / estimate.medianSeconds) * 100;
}
