import { BridgeError } from "./protocol";
import type { SessionWorkspace } from "./protocol";

export type SessionRecoverySeverity = "info" | "warning" | "blocker" | "error";
export type SessionRecoveryTarget =
	| "order"
	| "position"
	| "overlap"
	| "participants"
	| "run"
	| "source"
	| "reload";

export type SessionRecoveryGuide = Readonly<{
	severity: SessionRecoverySeverity;
	title: string;
	detail: string;
	actionLabel: string | null;
	target: SessionRecoveryTarget | null;
	technicalCode: string | null;
}>;

function durationLabel(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds))
		return "um intervalo";
	const value = Math.max(0, Math.round(seconds));
	const hours = Math.floor(value / 3600);
	const minutes = Math.floor((value % 3600) / 60);
	const rest = value % 60;
	if (hours)
		return `${hours}h ${String(minutes).padStart(2, "0")}min`;
	if (minutes && rest)
		return `${minutes}min ${String(rest).padStart(2, "0")}s`;
	if (minutes) return `${minutes}min`;
	return `${rest}s`;
}

function gapSeconds(workspace: SessionWorkspace | null): number | null {
	const part = workspace?.parts.find(
		(item) => item.relationToPrevious === "gap" && !item.gapConfirmed,
	);
	return part?.relationSeconds ?? null;
}

function anyGapSeconds(workspace: SessionWorkspace | null): number | null {
	const part = workspace?.parts.find((item) => item.relationToPrevious === "gap");
	return part?.relationSeconds ?? null;
}

function overlapSeconds(workspace: SessionWorkspace | null): number | null {
	const part = workspace?.parts.find(
		(item) =>
			item.relationToPrevious === "overlap" && !item.overlapResolutionValid,
	);
	return part?.relationSeconds ?? null;
}

function guide(
	severity: SessionRecoverySeverity,
	title: string,
	detail: string,
	actionLabel: string | null,
	target: SessionRecoveryTarget | null,
	technicalCode: string | null = null,
): SessionRecoveryGuide {
	return { severity, title, detail, actionLabel, target, technicalCode };
}

export function sessionTimelineRecovery(
	workspace: SessionWorkspace | null,
): SessionRecoveryGuide | null {
	if (!workspace) return null;
	if (workspace.timeline.state === "source_invalid") {
		return guide(
			"blocker",
			"Uma gravação local precisa ser restaurada.",
			"Selecione novamente o ZIP original. Os resultados já concluídos serão preservados quando íntegros.",
			"Selecionar ZIP original",
			"source",
		);
	}
	if (workspace.timeline.state === "gap_unconfirmed") {
		const seconds = gapSeconds(workspace);
		return guide(
			"blocker",
			`Existe um intervalo de ${durationLabel(seconds)} entre estas gravações.`,
			"O intervalo será preservado. Confirme-o para continuar.",
			"Revisar intervalo",
			"position",
		);
	}
	if (workspace.timeline.state === "overlap_unresolved") {
		const seconds = overlapSeconds(workspace);
		return guide(
			"blocker",
			`Estas gravações se sobrepõem por ${durationLabel(seconds)}.`,
			"Escolha qual gravação deve prevalecer nesse trecho.",
			"Resolver sobreposição",
			"overlap",
		);
	}
	if (
		workspace.timeline.state === "order_conflict" ||
		workspace.timeline.state === "needs_timing"
	) {
		return guide(
			"blocker",
			"Não conseguimos confirmar a ordem das gravações.",
			"Organize os arquivos na sequência correta e confirme.",
			"Revisar ordem",
			"order",
		);
	}
	if (workspace.timeline.state !== "ready") return null;

	if (workspace.orderingMode === "manual") {
		return guide(
			"info",
			"Ordem definida manualmente.",
			"Vamos preservar a sequência escolhida por você.",
			null,
			null,
		);
	}
	if (workspace.timeline.gapCount > 0) {
		return guide(
			"info",
			`Existe um intervalo de ${durationLabel(anyGapSeconds(workspace))} entre estas gravações.`,
			"O intervalo será preservado.",
			null,
			null,
		);
	}
	return null;
}

export function sessionRecoveryForError(
	cause: unknown,
	workspace: SessionWorkspace | null,
): SessionRecoveryGuide {
	if (!(cause instanceof BridgeError)) {
		return guide(
			"error",
			"Não foi possível concluir esta operação local.",
			"O estado já salvo foi preservado. Atualize a sessão e tente novamente. Se o problema continuar, abra os detalhes técnicos.",
			"Atualizar sessão",
			"reload",
		);
	}

	const code = cause.serverCode ?? cause.code;
	switch (code) {
		case "SESSION_WORKSPACE_TIMELINE_MANUAL_OVERRIDE":
			if (
				workspace?.timeline.state === "ready" &&
				workspace.orderingMode === "manual"
			) {
				return guide(
					"info",
					"Ordem definida manualmente.",
					"Vamos preservar a sequência escolhida por você.",
					null,
					null,
					code,
				);
			}
			return guide(
				"warning",
				"A ordem desta sessão já possui um ajuste manual.",
				"O TDA preservou sua decisão e não alterou os horários automaticamente. Revise a ordem das gravações para continuar.",
				"Revisar ordem",
				"order",
				code,
			);
		case "SESSION_WORKSPACE_TIMELINE_ORDER_AMBIGUOUS":
			return guide(
				"blocker",
				"Não conseguimos confirmar a ordem das gravações.",
				"Organize os arquivos na sequência correta e confirme.",
				"Revisar ordem",
				"order",
				code,
			);
		case "SESSION_WORKSPACE_TIMELINE_ORDER_COLLISION":
			return guide(
				"blocker",
				"Duas gravações parecem começar no mesmo momento.",
				"Confirme qual vem primeiro.",
				"Revisar ordem",
				"order",
				code,
			);
		case "SESSION_WORKSPACE_TIMELINE_ORDER_CONFLICT":
			return guide(
				"blocker",
				"Os horários entram em conflito com a sequência escolhida.",
				"Revise qual gravação vem primeiro. A ordem atual e os resultados concluídos permanecem preservados até sua decisão.",
				"Revisar ordem",
				"order",
				code,
			);
		case "SESSION_WORKSPACE_SEQUENCE_INVALID":
			return guide(
				"warning",
				"A ordem mudou antes da confirmação.",
				"Atualize a sessão e confira a sequência novamente antes de continuar.",
				"Atualizar sessão",
				"reload",
				code,
			);
		case "SESSION_WORKSPACE_OVERLAP_BOUNDARY_INVALID":
			return guide(
				"blocker",
				`Estas gravações se sobrepõem por ${durationLabel(overlapSeconds(workspace))}.`,
				"Escolha qual gravação deve prevalecer nesse trecho.",
				"Resolver sobreposição",
				"overlap",
				code,
			);
		case "SESSION_ASSEMBLY_TIMELINE_NOT_READY": {
			const timeline = sessionTimelineRecovery(workspace);
			if (timeline)
				return { ...timeline, technicalCode: code };
			return guide(
				"blocker",
				"A cronologia da sessão ainda precisa de uma decisão.",
				"Revise a ordem, os intervalos ou as sobreposições destacados para continuar.",
				"Revisar cronologia",
				"order",
				code,
			);
		}
		case "SESSION_WORKSPACE_SOURCE_UNAVAILABLE":
		case "SESSION_WORKSPACE_SOURCE_DURATION_UNAVAILABLE":
		case "SESSION_ASSEMBLY_SOURCE_UNAVAILABLE":
			return guide(
				"blocker",
				"Uma gravação local precisa ser restaurada.",
				"Selecione novamente o ZIP original. Os resultados já concluídos serão preservados quando íntegros.",
				"Selecionar ZIP original",
				"source",
				code,
			);
		case "SESSION_ASSEMBLY_PART_INVALID":
			return guide(
				"blocker",
				"Uma gravação ainda não possui resultado concluído.",
				"Processe somente esta parte para continuar. Os demais resultados concluídos permanecem preservados.",
				"Processar parte pendente",
				"run",
				code,
			);
		case "SESSION_ASSEMBLY_RUN_INVALID":
			return guide(
				"blocker",
				"Um resultado local não passou na verificação de integridade.",
				"Selecione outro resultado ou processe somente esta gravação. Os demais resultados concluídos permanecem preservados.",
				"Revisar resultado",
				"run",
				code,
			);
		case "SESSION_ASSEMBLY_RUN_NOT_VISIBLE":
			return guide(
				"blocker",
				"O resultado escolhido não está mais disponível para esta sessão.",
				"Selecione outro resultado ou processe somente esta gravação. Os demais resultados concluídos permanecem preservados.",
				"Revisar resultado",
				"run",
				code,
			);
		case "SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INVALID":
			return guide(
				"blocker",
				"Há um conflito de participantes nesta sessão.",
				"Resolva somente os participantes sinalizados antes de montar a transcrição.",
				"Resolver participantes",
				"participants",
				code,
			);
		case "SESSION_WORKSPACE_REVISION_CONFLICT":
			return guide(
				"warning",
				"A sessão mudou enquanto você trabalhava.",
				"O estado salvo foi preservado. Atualize a sessão para continuar sobre a revisão mais recente.",
				"Atualizar sessão",
				"reload",
				code,
			);
		case "SESSION_WORKSPACE_SESSION_MISMATCH":
			return guide(
				"blocker",
				"A sessão aberta não corresponde ao workspace carregado.",
				"Atualize a sessão antes de continuar para não aplicar uma decisão no alvo errado.",
				"Atualizar sessão",
				"reload",
				code,
			);
		case "SESSION_WORKSPACE_SOURCE_EXISTS":
			return guide(
				"info",
				"Esta gravação já faz parte da sessão.",
				"Nenhuma cópia adicional foi criada.",
				null,
				null,
				code,
			);
		case "timeout":
			return guide(
				"error",
				"O Companion demorou demais para responder.",
				"O estado já salvo foi preservado. Atualize a sessão e tente novamente.",
				"Atualizar sessão",
				"reload",
				code,
			);
		case "unreachable":
			return guide(
				"error",
				"O Companion ficou indisponível.",
				"O estado já salvo foi preservado. Reconecte o Companion e atualize a sessão.",
				"Atualizar sessão",
				"reload",
				code,
			);
		case "conflict":
			return guide(
				"warning",
				"A operação encontrou uma alteração mais recente.",
				"O estado salvo foi preservado. Atualize a sessão antes de repetir a ação.",
				"Atualizar sessão",
				"reload",
				code,
			);
		default:
			return guide(
				"error",
				"Não foi possível concluir esta operação local.",
				"O estado já salvo foi preservado. Atualize a sessão e tente novamente. Se o problema continuar, abra os detalhes técnicos.",
				"Atualizar sessão",
				"reload",
				code,
			);
	}
}

export function sessionRecoveryPrimaryText(
	recovery: SessionRecoveryGuide,
): string {
	return `${recovery.title} ${recovery.detail}`;
}
