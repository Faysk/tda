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
	const activeSources = new Set(
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
		reasons.push("Carregue o mapa de participantes.");
	else if (mapping.approvalBlocked)
		reasons.push("Resolva os participantes ambíguos.");
	return { ready: reasons.length === 0, reasons };
}

export function partRelationLabel(part: SessionWorkspacePart): string {
	if (part.relationToPrevious === "first") return "Primeira gravação";
	if (part.relationToPrevious === "contiguous") return "Continuação sem gap detectável";
	if (part.relationToPrevious === "gap")
		return "Gap de " + Math.round(part.relationSeconds ?? 0) + " s";
	if (part.relationToPrevious === "overlap")
		return "Overlap de " + Math.round(part.relationSeconds ?? 0) + " s";
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
	if (job?.status === "running") return "Processando";
	if (job?.status === "queued") return "Na fila";
	if (job?.status === "failed") return job.error?.recoverable ? "Falhou · pode tentar de novo" : "Falhou";
	if (job?.status === "interrupted") return "Interrompido";
	if (part.selectedRunId) return "Resultado selecionado";
	if (runs.length > 0) return runs.length === 1 ? "Resultado disponível" : runs.length + " resultados disponíveis";
	return "Ainda não processada";
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
