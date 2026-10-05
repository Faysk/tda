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

export type IntentRunContract = Readonly<{
	profileId: string;
	profileContractSha256: string;
	contextSha256: string;
	glossarySha256: string;
}>;

export type IntentRunChoice =
	| Readonly<{ kind: "selected"; runId: string }>
	| Readonly<{ kind: "automatic"; runId: string; reason: "intent_job" | "exact_match" }>
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

export function intentProgress(
	workspace: SessionWorkspace | null,
	runsBySource: ReadonlyMap<string, readonly LocalRunSummary[]>,
	jobs: readonly LocalJob[],
	contract: IntentRunContract | null | undefined = undefined,
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
		const partRuns = runsBySource.get(part.sourceId) ?? [];
		const selected = part.selectedRunId
			? partRuns.find((run) => run.runId === part.selectedRunId) ?? null
			: null;
		if (
			(selected &&
				(contract === undefined ||
					(contract !== null && runMatchesIntent(selected, part.sourceId, contract)))) ||
			(contract !== null &&
				contract !== undefined &&
				partRuns.some((run) => runMatchesIntent(run, part.sourceId, contract)))
		) {
			counts.completed += 1;
			continue;
		}
		const job = latestJob(jobs, part.sourceId);
		if (job?.status === "queued" || job?.status === "running") {
			counts.running += 1;
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

function sourceSha256(sourceId: string): string | null {
	const match = /^craig-([a-f0-9]{64})$/u.exec(sourceId);
	return match?.[1] ?? null;
}

export function runMatchesIntent(
	run: LocalRunSummary,
	sourceId: string,
	contract: IntentRunContract,
): boolean {
	const expectedSourceSha256 = sourceSha256(sourceId);
	return Boolean(
		expectedSourceSha256 &&
		run.sourceId === sourceId &&
		run.sourceSha256 === expectedSourceSha256 &&
		run.profileId === contract.profileId &&
		run.profileContractSha256 !== null &&
		run.profileContractSha256 === contract.profileContractSha256 &&
		run.contextSha256 !== null &&
		run.contextSha256 === contract.contextSha256 &&
		run.glossarySha256 !== null &&
		run.glossarySha256 === contract.glossarySha256
	);
}

function newestExactRun(
	runs: readonly LocalRunSummary[],
	sourceId: string,
	contract: IntentRunContract,
): LocalRunSummary | null {
	const exact = runs.filter((run) => runMatchesIntent(run, sourceId, contract));
	if (!exact.length) return null;
	return [...exact].sort((left, right) => {
		const leftTime = left.completedAt ? Date.parse(left.completedAt) : 0;
		const rightTime = right.completedAt ? Date.parse(right.completedAt) : 0;
		return rightTime - leftTime || right.runId.localeCompare(left.runId);
	})[0] ?? null;
}

export function chooseIntentRun(
	part: SessionWorkspacePart,
	runs: readonly LocalRunSummary[],
	intentRunId: string | null | undefined,
	contract: IntentRunContract | null | undefined = undefined,
): IntentRunChoice {
	if (intentRunId && runs.some((run) => run.runId === intentRunId))
		return { kind: "automatic", runId: intentRunId, reason: "intent_job" };

	if (part.selectedRunId) {
		const selected = runs.find((run) => run.runId === part.selectedRunId);
		if (
			selected &&
			(contract === undefined ||
				(contract !== null && runMatchesIntent(selected, part.sourceId, contract)))
		)
			return { kind: "selected", runId: part.selectedRunId };
	}

	if (!contract) return { kind: "missing" };
	const exact = newestExactRun(runs, part.sourceId, contract);
	return exact
		? { kind: "automatic", runId: exact.runId, reason: "exact_match" }
		: { kind: "missing" };
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

export function retryableIntentJob(
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
