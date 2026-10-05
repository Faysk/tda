import { queueRetryAvailable } from "./queue-model";
import type {
	LocalJob,
	LocalRunSummary,
	LocalSourceSummary,
	SessionWorkspace,
	SessionWorkspacePart,
} from "./protocol";

export type IntentPartProgress = "waiting" | "running" | "completed" | "failed";

export type IntentProgress = Readonly<{
	total: number;
	waiting: number;
	running: number;
	completed: number;
	failed: number;
}>;

export type IntentRunChoice =
	| Readonly<{ kind: "selected"; runId: string }>
	| Readonly<{
			kind: "automatic";
			runId: string;
			reason: "intent_job" | "exact_match";
	  }>
	| Readonly<{ kind: "ambiguous"; runIds: readonly string[] }>
	| Readonly<{ kind: "missing" }>;

export type RecordingVariantConflict = Readonly<{
	sourceId: string;
	recordingId: string;
	conflictsWith: readonly string[];
}>;

function latestJob(
	jobs: readonly LocalJob[],
	sourceId: string,
): LocalJob | null {
	return (
		jobs
			.filter((job) => job.context?.sourceId === sourceId)
			.sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0] ??
		null
	);
}

function exactRuns(
	runs: readonly LocalRunSummary[],
	expectedFingerprint: string | null | undefined,
): readonly LocalRunSummary[] {
	if (!expectedFingerprint) return [];
	return runs.filter((run) => run.intentFingerprint === expectedFingerprint);
}

function newestRun(runs: readonly LocalRunSummary[]): LocalRunSummary {
	return [...runs].sort((left, right) => {
		const completed =
			Date.parse(right.completedAt ?? "") - Date.parse(left.completedAt ?? "");
		if (Number.isFinite(completed) && completed !== 0) return completed;
		return right.runId.localeCompare(left.runId);
	})[0]!;
}

export function intentProgress(
	workspace: SessionWorkspace | null,
	runsBySource: ReadonlyMap<string, readonly LocalRunSummary[]>,
	jobs: readonly LocalJob[],
	expectedFingerprint: string | null | undefined = null,
): IntentProgress {
	const counts = {
		total: workspace?.parts.length ?? 0,
		waiting: 0,
		running: 0,
		completed: 0,
		failed: 0,
	};
	if (!workspace) return counts;

	for (const part of workspace.parts) {
		const runs = runsBySource.get(part.sourceId) ?? [];
		const selected = part.selectedRunId
			? runs.find((run) => run.runId === part.selectedRunId)
			: undefined;
		if (
			(selected && selected.intentFingerprint === expectedFingerprint) ||
			exactRuns(runs, expectedFingerprint).length > 0
		) {
			counts.completed += 1;
			continue;
		}
		const job = latestJob(jobs, part.sourceId);
		if (job?.status === "queued" || job?.status === "running") {
			counts.running += 1;
			continue;
		}
		if (job?.status === "succeeded" && job.result_available) {
			counts.completed += 1;
			continue;
		}
		if (
			job?.status === "failed" ||
			job?.status === "cancelled" ||
			job?.status === "interrupted"
		) {
			counts.failed += 1;
			continue;
		}
		counts.waiting += 1;
	}
	return counts;
}

export function chooseIntentRun(
	part: SessionWorkspacePart,
	runs: readonly LocalRunSummary[],
	intentRunId: string | null | undefined,
	expectedFingerprint: string | null | undefined,
): IntentRunChoice {
	if (intentRunId) {
		const current = runs.find((run) => run.runId === intentRunId);
		if (current) {
			if (part.selectedRunId === current.runId)
				return { kind: "selected", runId: current.runId };
			return { kind: "automatic", runId: current.runId, reason: "intent_job" };
		}
	}

	if (part.selectedRunId) {
		const selected = runs.find((run) => run.runId === part.selectedRunId);
		if (
			selected &&
			expectedFingerprint &&
			selected.intentFingerprint === expectedFingerprint
		)
			return { kind: "selected", runId: selected.runId };
	}

	const compatible = exactRuns(runs, expectedFingerprint);
	if (compatible.length === 0) return { kind: "missing" };
	if (
		compatible.length > 1 &&
		new Set(compatible.map((run) => run.transcriptSha256)).size > 1
	)
		return {
			kind: "ambiguous",
			runIds: compatible.map((run) => run.runId).sort(),
		};
	const chosen = newestRun(compatible);
	return { kind: "automatic", runId: chosen.runId, reason: "exact_match" };
}

export function uniqueIntentSources<T extends Readonly<{ sourceId: string }>>(
	sources: readonly T[],
): readonly T[] {
	const seen = new Set<string>();
	return sources.filter((source) => {
		if (seen.has(source.sourceId)) return false;
		seen.add(source.sourceId);
		return true;
	});
}

export function recordingVariantConflicts(
	sourceIds: readonly string[],
	catalog: ReadonlyMap<string, LocalSourceSummary>,
): readonly RecordingVariantConflict[] {
	const selected = new Set(sourceIds);
	const byRecording = new Map<string, string[]>();
	for (const sourceId of sourceIds) {
		const recordingId = catalog.get(sourceId)?.recordingId;
		if (!recordingId) continue;
		const group = byRecording.get(recordingId) ?? [];
		group.push(sourceId);
		byRecording.set(recordingId, group);
	}
	const conflicts: RecordingVariantConflict[] = [];
	for (const [recordingId, ids] of byRecording) {
		const distinct = [...new Set(ids)];
		if (distinct.length < 2) continue;
		for (const sourceId of distinct) {
			conflicts.push({
				sourceId,
				recordingId,
				conflictsWith: distinct.filter(
					(candidate) => candidate !== sourceId && selected.has(candidate),
				),
			});
		}
	}
	return conflicts;
}

export function trustedTimelineSourceOrder(
	workspace: SessionWorkspace,
): readonly string[] | null {
	if (!workspace.timeline.automaticOrderAvailable || workspace.parts.length < 2)
		return null;
	const values = workspace.parts.map((part) => {
		if (
			part.sourceStartConfidence !== "trusted_absolute" ||
			!part.sourceStartUtc
		)
			return null;
		const epoch = Date.parse(part.sourceStartUtc);
		return Number.isFinite(epoch) ? { sourceId: part.sourceId, epoch } : null;
	});
	if (values.some((value) => value === null)) return null;
	const trusted = values.filter(
		(value): value is Readonly<{ sourceId: string; epoch: number }> => value !== null,
	);
	if (new Set(trusted.map((value) => value.epoch)).size !== trusted.length) return null;
	return [...trusted]
		.sort((left, right) => left.epoch - right.epoch || left.sourceId.localeCompare(right.sourceId))
		.map((value) => value.sourceId);
}

export function trustedTimelineOrderDiffers(
	workspace: SessionWorkspace,
	editorialOrder: readonly string[] = workspace.parts.map((part) => part.sourceId),
): boolean {
	const trusted = trustedTimelineSourceOrder(workspace);
	if (!trusted) return false;
	if (trusted.length !== editorialOrder.length) return true;
	return trusted.some((sourceId, index) => editorialOrder[index] !== sourceId);
}

export function terminalIntentJob(
	jobs: readonly LocalJob[],
	sourceId: string,
): LocalJob | null {
	const job = latestJob(jobs, sourceId);
	if (!job) return null;
	return job.status === "failed" ||
		job.status === "cancelled" ||
		job.status === "interrupted"
		? job
		: null;
}

export function retryableIntentJob(
	jobs: readonly LocalJob[],
	sourceId: string,
): LocalJob | null {
	const job = terminalIntentJob(jobs, sourceId);
	return job && queueRetryAvailable(job) ? job : null;
}
