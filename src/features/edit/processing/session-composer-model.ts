import type {
	LocalJob,
	LocalRunSummary,
	SessionParticipantMapping,
	SessionWorkspace,
	SessionWorkspacePart,
	LocalSourceSummary,
} from "./protocol";

export type ComposerReadiness = {
	ready: boolean;
	reasons: readonly string[];
};

export type SessionProcessingProgress = {
	total: number;
	completed: number;
	active: number;
	attention: number;
	waiting: number;
};

export function supportsSessionComposer(capabilities: readonly string[]): boolean {
	const required = [
		"transcription.session-workspace",
		"transcription.session-timeline",
		"transcription.session-participants",
		"transcription.session-assembly",
	];
	return required.every((capability) => capabilities.includes(capability));
}

export function moveSessionPart(
	parts: readonly SessionWorkspacePart[],
	partId: string,
	direction: -1 | 1,
): string[] {
	const ids = parts.map((part) => part.partId);
	const index = ids.indexOf(partId);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= ids.length) return ids;
	const next = [...ids];
	[next[index], next[target]] = [next[target], next[index]];
	return next;
}

export function latestJobForSource(
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

export function runsForPart(
	runsBySource: ReadonlyMap<string, readonly LocalRunSummary[]>,
	part: SessionWorkspacePart,
): readonly LocalRunSummary[] {
	return runsBySource.get(part.sourceId) ?? [];
}

export function pendingSourceIds(
	workspace: SessionWorkspace | null,
	runsBySource: ReadonlyMap<string, readonly LocalRunSummary[]>,
	jobs: readonly LocalJob[] = [],
): string[] {
	if (!workspace) return [];
	const settledOrActiveSources = new Set(
		jobs
			.filter(
			(job) =>
				job.status === "queued" ||
				job.status === "running" ||
				job.status === "succeeded",
		)
			.map((job) => job.context?.sourceId)
			.filter((sourceId): sourceId is string => Boolean(sourceId)),
	);
	return workspace.parts
		.filter(
			(part) =>
				part.sourceState === "ready" &&
				runsForPart(runsBySource, part).length === 0 &&
				!settledOrActiveSources.has(part.sourceId),
		)
		.map((part) => part.sourceId);
}

export function sessionProcessingProgress(
	workspace: SessionWorkspace | null,
	runsBySource: ReadonlyMap<string, readonly LocalRunSummary[]>,
	jobs: readonly LocalJob[] = [],
): SessionProcessingProgress {
	const progress: SessionProcessingProgress = {
		total: workspace?.parts.length ?? 0,
		completed: 0,
		active: 0,
		attention: 0,
		waiting: 0,
	};
	if (!workspace) return progress;

	for (const part of workspace.parts) {
		const runs = runsForPart(runsBySource, part);
		if (part.selectedRunId || runs.length > 0) {
			progress.completed += 1;
			continue;
		}
		if (part.sourceState !== "ready") {
			progress.attention += 1;
			continue;
		}
		const job = latestJobForSource(jobs, part.sourceId);
		if (job?.status === "queued" || job?.status === "running") {
			progress.active += 1;
			continue;
		}
		if (
			job?.status === "failed" ||
			job?.status === "cancelled" ||
			job?.status === "interrupted"
		) {
			progress.attention += 1;
			continue;
		}
		progress.waiting += 1;
	}
	return progress;
}

export function sessionAssemblyReadiness(
	workspace: SessionWorkspace | null,
	mapping: SessionParticipantMapping | null,
): ComposerReadiness {
	if (!workspace || workspace.parts.length === 0)
		return { ready: false, reasons: ["Adicione pelo menos uma gravação."] };
	const reasons: string[] = [];
	if (workspace.timeline.state !== "ready")
		reasons.push("Resolva a cronologia da sessão.");
	if (workspace.parts.some((part) => part.sourceState !== "ready"))
		reasons.push("Restaure as gravações locais inválidas.");
	if (workspace.parts.some((part) => !part.selectedRunId))
		reasons.push("Selecione um resultado para cada gravação.");
	if (!mapping)
		reasons.push("Atualizando a identificação dos participantes.");
	else if (mapping.approvalBlocked)
		reasons.push("Restaure a identificação das gravações locais.");
	return { ready: reasons.length === 0, reasons };
}

export function partRelationLabel(part: SessionWorkspacePart): string {
	if (part.relationToPrevious === "first") return "Primeira gravação";
	if (part.physicalIntervalState === "unknown")
		return "Continuidade editorial · intervalo real desconhecido";
	if (part.relationToPrevious === "contiguous")
		return part.physicalIntervalState === "trusted_absolute"
			? "Horários confiáveis indicam continuidade"
			: "Continuação definida";
	if (part.relationToPrevious === "gap")
		return (part.physicalIntervalState === "trusted_absolute" ? "Gap comprovado de " : "Gap definido de ") +
			Math.round(part.relationSeconds ?? 0) +
			" s";
	if (part.relationToPrevious === "overlap")
		return (part.physicalIntervalState === "trusted_absolute" ? "Overlap comprovado de " : "Overlap definido de ") +
			Math.round(part.relationSeconds ?? 0) +
			" s";
	if (part.relationToPrevious === "order_conflict")
		return "Ordem temporal em conflito";
	return "Cronologia ainda não resolvida";
}

export function partStatusLabel(
	part: SessionWorkspacePart,
	runs: readonly LocalRunSummary[],
	job: LocalJob | null,
): string {
	if (part.sourceState !== "ready") return "Fonte local inválida";
	const hasPreservedResult = Boolean(part.selectedRunId) || runs.length > 0;
	if (hasPreservedResult) {
		if (job?.status === "running")
			return "Resultado preservado · nova tentativa processando";
		if (job?.status === "queued")
			return "Resultado preservado · nova tentativa na fila";
		if (part.selectedRunId) return "Resultado selecionado";
		return runs.length === 1
			? "Resultado disponível"
			: runs.length + " resultados disponíveis";
	}
	if (job?.status === "running") return "Processando";
	if (job?.status === "queued") return "Na fila";
	if (job?.status === "failed")
		return job.error?.recoverable ? "Falhou · pode tentar de novo" : "Falhou";
	if (job?.status === "interrupted") return "Interrompido";
	if (job?.status === "cancelled") return "Cancelado";
	return "Ainda não processada";
}

export function partAttemptNotice(
	part: SessionWorkspacePart,
	runs: readonly LocalRunSummary[],
	job: LocalJob | null,
): string | null {
	if ((!part.selectedRunId && runs.length === 0) || !job) return null;
	if (job.status === "failed")
		return job.error?.recoverable
			? "A última tentativa falhou, mas o resultado anterior está preservado e pode continuar sendo usado."
			: "A última tentativa falhou, mas o resultado anterior está preservado.";
	if (job.status === "interrupted" || job.status === "cancelled")
		return "A última tentativa foi interrompida, mas o resultado anterior está preservado.";
	return null;
}

export function timelineStateLabel(
	state: SessionWorkspace["timeline"]["state"],
): string {
	if (state === "ready") return "Cronologia pronta";
	if (state === "needs_timing") return "Confirme a ordem das gravações";
	if (state === "gap_unconfirmed") return "Confirme o intervalo entre gravações";
	if (state === "overlap_unresolved") return "Resolva a sobreposição entre gravações";
	if (state === "order_conflict") return "Os horários indicam uma ordem diferente";
	return "Cronologia precisa de revisão";
}


export function recordingVariantSourceIds(
	currentSourceId: string,
	workspace: SessionWorkspace | null,
	sourcesById: ReadonlyMap<string, LocalSourceSummary>,
): string[] {
	if (!workspace) return [];
	const current = sourcesById.get(currentSourceId);
	if (!current?.recordingId) return [];
	return workspace.parts
		.filter((part) => part.sourceId !== currentSourceId)
		.filter(
			(part) =>
				sourcesById.get(part.sourceId)?.recordingId === current.recordingId,
		)
		.map((part) => part.sourceId);
}
