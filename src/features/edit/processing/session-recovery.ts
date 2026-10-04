export type SessionRecoverySeverity = "info" | "warning" | "blocker" | "error";

export type SessionRecoveryTarget =
	| "order"
	| "position"
	| "overlap"
	| "participants"
	| "run"
	| "source"
	| "retry"
	| null;

export type SessionRecoveryGuidance = Readonly<{
	title: string;
	detail: string;
	severity: SessionRecoverySeverity;
	target: SessionRecoveryTarget;
	cta: string | null;
}>;

const GUIDANCE: Readonly<Record<string, SessionRecoveryGuidance>> = {
	SESSION_WORKSPACE_TIMELINE_MANUAL_OVERRIDE: {
		title: "A ordem desta sessão já possui um ajuste manual.",
		detail:
			"O TDA preservou sua decisão e não alterou os horários automaticamente. Revise a ordem das gravações para continuar.",
		severity: "warning",
		target: "order",
		cta: "Revisar ordem",
	},
	SESSION_WORKSPACE_TIMELINE_ORDER_AMBIGUOUS: {
		title: "Não conseguimos confirmar a ordem das gravações.",
		detail: "Organize os arquivos na sequência correta e confirme.",
		severity: "blocker",
		target: "order",
		cta: "Revisar ordem",
	},
	SESSION_WORKSPACE_TIMELINE_ORDER_COLLISION: {
		title: "Duas gravações parecem começar no mesmo momento.",
		detail: "Confirme qual vem primeiro.",
		severity: "blocker",
		target: "order",
		cta: "Revisar ordem",
	},
	SESSION_WORKSPACE_TIMELINE_ORDER_CONFLICT: {
		title: "Os horários confiáveis contradizem a ordem mostrada.",
		detail:
			"Revise a sequência antes de continuar. O TDA não vai trocar a ordem silenciosamente.",
		severity: "blocker",
		target: "order",
		cta: "Revisar ordem",
	},
	SESSION_WORKSPACE_SEQUENCE_INVALID: {
		title: "A ordem mudou depois da confirmação.",
		detail: "Revise a sequência atual e confirme novamente.",
		severity: "blocker",
		target: "order",
		cta: "Revisar ordem",
	},
	SESSION_WORKSPACE_SOURCE_UNAVAILABLE: {
		title: "Uma gravação local precisa ser restaurada.",
		detail:
			"Selecione novamente o ZIP original. Os resultados já concluídos serão preservados quando íntegros.",
		severity: "blocker",
		target: "source",
		cta: "Selecionar ZIP original",
	},
	SESSION_ASSEMBLY_TIMELINE_NOT_READY: {
		title: "A cronologia ainda precisa de uma decisão.",
		detail:
			"Revise somente a parte pendente; gravações e resultados já concluídos permanecem preservados.",
		severity: "blocker",
		target: "order",
		cta: "Revisar cronologia",
	},
	SESSION_ASSEMBLY_OVERLAP_BOUNDARY_INVALID: {
		title: "A resolução da sobreposição precisa ser ajustada.",
		detail:
			"Escolha qual gravação deve prevalecer nesse trecho antes de montar a sessão.",
		severity: "blocker",
		target: "overlap",
		cta: "Resolver sobreposição",
	},
	SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INVALID: {
		title: "Há um conflito de participantes.",
		detail: "Resolva somente os participantes ambíguos para continuar.",
		severity: "blocker",
		target: "participants",
		cta: "Resolver participantes",
	},
	SESSION_ASSEMBLY_RUN_INVALID: {
		title: "Uma gravação ainda não possui resultado concluído.",
		detail:
			"Processe somente esta parte para continuar. Os demais resultados permanecem preservados.",
		severity: "blocker",
		target: "run",
		cta: "Processar parte pendente",
	},
	SESSION_ASSEMBLY_RUN_NOT_VISIBLE: {
		title: "Um resultado selecionado não está mais disponível.",
		detail:
			"Escolha outro resultado íntegro ou reprocesse somente esta gravação para continuar.",
		severity: "blocker",
		target: "run",
		cta: "Revisar resultado",
	},
	SESSION_WORKSPACE_REVISION_CONFLICT: {
		title: "A sessão mudou em outra aba.",
		detail:
			"Atualize o estado antes de continuar. O trabalho já concluído permanece preservado.",
		severity: "warning",
		target: "retry",
		cta: "Atualizar sessão",
	},
	timeout: {
		title: "O Companion demorou demais para responder.",
		detail:
			"O estado já salvo foi preservado. Tente novamente sem reprocessar o que já foi concluído.",
		severity: "error",
		target: "retry",
		cta: "Tentar novamente",
	},
	unreachable: {
		title: "O Companion ficou indisponível.",
		detail:
			"O estado já salvo foi preservado. Reabra ou reconecte o Companion e tente novamente.",
		severity: "error",
		target: "retry",
		cta: "Tentar novamente",
	},
};

const SAFE_FALLBACK: SessionRecoveryGuidance = {
	title: "Não foi possível concluir esta etapa da sessão.",
	detail:
		"O estado já salvo foi preservado. Abra os detalhes técnicos se precisar do código para suporte e tente novamente.",
	severity: "error",
	target: "retry",
	cta: "Tentar novamente",
};

export function sessionRecoveryGuidance(
	code: string | null | undefined,
): SessionRecoveryGuidance {
	if (!code) return SAFE_FALLBACK;
	return GUIDANCE[code] ?? SAFE_FALLBACK;
}

export function sessionRecoveryPrimaryMessage(
	code: string | null | undefined,
): string {
	const guidance = sessionRecoveryGuidance(code);
	return `${guidance.title} ${guidance.detail}`;
}

export function isInternalSessionCode(value: string): boolean {
	return /^(?:SESSION_WORKSPACE|SESSION_ASSEMBLY|SESSION_INTENT|SESSION_PARTICIPANT)_/u.test(
		value,
	);
}
