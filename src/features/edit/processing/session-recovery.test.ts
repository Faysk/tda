import { describe, expect, it } from "vitest";
import { BridgeError } from "./protocol";
import type { SessionWorkspace } from "./protocol";
import {
	sessionRecoveryForError,
	sessionRecoveryPrimaryText,
	sessionTimelineRecovery,
} from "./session-recovery";

const sourceA = `craig-${"a".repeat(64)}`;
const sourceB = `craig-${"b".repeat(64)}`;

function workspace(
	overrides: Partial<SessionWorkspace> = {},
): SessionWorkspace {
	const base: SessionWorkspace = {
		schemaVersion: "tda_session_workspace_v1",
		campaignId: "yuhara-main",
		sessionId: "sessao-42",
		revision: 3,
		orderingMode: "attachment",
		createdAt: "2026-10-04T02:00:00.000Z",
		updatedAt: "2026-10-04T02:00:00.000Z",
		parts: [
			{
				partId: "1".repeat(32),
				sourceId: sourceA,
				ordinal: 0,
				selectedRunId: "run-a",
				sourceState: "ready",
				timelineMode: "automatic",
				sessionOffsetSeconds: 0,
				trimStartSeconds: 0,
				trimEndSeconds: null,
				gapConfirmed: false,
				overlapResolution: null,
				overlapBoundarySeconds: null,
				sourceStartTime: null,
				sourceStartConfidence: "missing",
				sourceStartUtc: null,
				sourceDurationSeconds: 300,
				effectiveStartSeconds: 0,
				effectiveEndSeconds: 300,
				relationToPrevious: "first",
				relationSeconds: null,
				overlapResolutionValid: true,
				physicalIntervalState: "first",
				createdAt: "2026-10-04T02:00:00.000Z",
				updatedAt: "2026-10-04T02:00:00.000Z",
			},
			{
				partId: "2".repeat(32),
				sourceId: sourceB,
				ordinal: 1,
				selectedRunId: "run-b",
				sourceState: "ready",
				timelineMode: "unresolved",
				sessionOffsetSeconds: null,
				trimStartSeconds: 0,
				trimEndSeconds: null,
				gapConfirmed: false,
				overlapResolution: null,
				overlapBoundarySeconds: null,
				sourceStartTime: null,
				sourceStartConfidence: "missing",
				sourceStartUtc: null,
				sourceDurationSeconds: 300,
				effectiveStartSeconds: null,
				effectiveEndSeconds: null,
				relationToPrevious: "unknown",
				relationSeconds: null,
				overlapResolutionValid: true,
				physicalIntervalState: "unknown",
				createdAt: "2026-10-04T02:00:00.000Z",
				updatedAt: "2026-10-04T02:00:00.000Z",
			},
		],
		timeline: {
			policyVersion: "tda_session_timeline_v1",
			segmentBoundaryPolicy: "segment_start_owner_v1",
			fingerprintSha256: "f".repeat(64),
			strategy: null,
			wallClock: null,
			unknownIntervalCount: null,
			state: "needs_timing",
			allSourcesTrusted: false,
			automaticOrderAvailable: false,
			gapCount: 0,
			overlapCount: 0,
			orderConflictCount: 0,
			unresolvedOverlapCount: 0,
			unconfirmedGapCount: 0,
		},
	};
	return {
		...base,
		...overrides,
		timeline: { ...base.timeline, ...(overrides.timeline ?? {}) },
		parts: overrides.parts ?? base.parts,
	};
}

function failure(code: string) {
	return new BridgeError("conflict", code);
}

describe("session guided recovery", () => {
	it.each([
		[
			"SESSION_WORKSPACE_TIMELINE_ORDER_AMBIGUOUS",
			"Não conseguimos confirmar a ordem das gravações.",
			"Revisar ordem",
			"order",
		],
		[
			"SESSION_WORKSPACE_TIMELINE_ORDER_COLLISION",
			"Duas gravações parecem começar no mesmo momento.",
			"Revisar ordem",
			"order",
		],
		[
			"SESSION_WORKSPACE_TIMELINE_ORDER_CONFLICT",
			"Os horários entram em conflito com a sequência escolhida.",
			"Revisar ordem",
			"order",
		],
		[
			"SESSION_WORKSPACE_SEQUENCE_INVALID",
			"A ordem mudou antes da confirmação.",
			"Atualizar sessão",
			"reload",
		],
		[
			"SESSION_WORKSPACE_OVERLAP_BOUNDARY_INVALID",
			"Estas gravações se sobrepõem",
			"Resolver sobreposição",
			"overlap",
		],
		[
			"SESSION_ASSEMBLY_TIMELINE_NOT_READY",
			"Não conseguimos confirmar a ordem das gravações.",
			"Revisar ordem",
			"order",
		],
		[
			"SESSION_WORKSPACE_SOURCE_UNAVAILABLE",
			"Uma gravação local precisa ser restaurada.",
			"Selecionar ZIP original",
			"source",
		],
		[
			"SESSION_WORKSPACE_SOURCE_DURATION_UNAVAILABLE",
			"Uma gravação local precisa ser restaurada.",
			"Selecionar ZIP original",
			"source",
		],
		[
			"SESSION_ASSEMBLY_SOURCE_UNAVAILABLE",
			"Uma gravação local precisa ser restaurada.",
			"Selecionar ZIP original",
			"source",
		],
		[
			"SESSION_ASSEMBLY_RUN_INVALID",
			"Um resultado local não passou na verificação de integridade.",
			"Revisar resultado",
			"run",
		],
		[
			"SESSION_ASSEMBLY_RUN_NOT_VISIBLE",
			"O resultado escolhido não está mais disponível para esta sessão.",
			"Revisar resultado",
			"run",
		],
		[
			"SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INVALID",
			"Há um conflito de participantes nesta sessão.",
			"Resolver participantes",
			"participants",
		],
		[
			"SESSION_WORKSPACE_REVISION_CONFLICT",
			"A sessão mudou enquanto você trabalhava.",
			"Atualizar sessão",
			"reload",
		],
	] as const)(
		"maps %s to human copy and a concrete action",
		(code, title, actionLabel, target) => {
			const recovery = sessionRecoveryForError(failure(code), workspace());
			expect(recovery.title).toContain(title);
			expect(recovery.actionLabel).toBe(actionLabel);
			expect(recovery.target).toBe(target);
			expect(recovery.technicalCode).toBe(code);
			expect(sessionRecoveryPrimaryText(recovery)).not.toContain(code);
		},
	);

	it("treats manual override as warning while a decision is still required", () => {
		const recovery = sessionRecoveryForError(
			failure("SESSION_WORKSPACE_TIMELINE_MANUAL_OVERRIDE"),
			workspace(),
		);
		expect(recovery).toMatchObject({
			severity: "warning",
			title: "A ordem desta sessão já possui um ajuste manual.",
			actionLabel: "Revisar ordem",
			target: "order",
			technicalCode: "SESSION_WORKSPACE_TIMELINE_MANUAL_OVERRIDE",
		});
		expect(recovery.detail).toContain("preservou sua decisão");
		expect(sessionRecoveryPrimaryText(recovery)).not.toContain("SESSION_WORKSPACE");
	});

	it("treats a ready manual order as information rather than an error", () => {
		const current = workspace({
			orderingMode: "manual",
			timeline: {
				...workspace().timeline,
				state: "ready",
			},
		});
		const recovery = sessionRecoveryForError(
			failure("SESSION_WORKSPACE_TIMELINE_MANUAL_OVERRIDE"),
			current,
		);
		expect(recovery).toMatchObject({
			severity: "info",
			title: "Ordem definida manualmente.",
			detail: "Vamos preservar a sequência escolhida por você.",
			actionLabel: null,
		});
	});

	it("describes known gaps without fatal language once they are ready", () => {
		const current = workspace({
			orderingMode: "automatic",
			parts: [
				workspace().parts[0],
				{
					...workspace().parts[1],
					timelineMode: "automatic",
					sessionOffsetSeconds: 390,
					effectiveStartSeconds: 390,
					effectiveEndSeconds: 690,
					relationToPrevious: "gap",
					relationSeconds: 90,
					gapConfirmed: true,
				},
			],
			timeline: {
				...workspace().timeline,
				state: "ready",
				gapCount: 1,
			},
		});
		const recovery = sessionTimelineRecovery(current);
		expect(recovery).toMatchObject({
			severity: "info",
			title: "Existe um intervalo de 1min 30s entre estas gravações.",
			detail: "O intervalo será preservado.",
			actionLabel: null,
		});
	});

	it("describes an unconfirmed gap as preserved but still requiring confirmation", () => {
		const current = workspace({
			parts: [
				workspace().parts[0],
				{
					...workspace().parts[1],
					sessionOffsetSeconds: 375,
					effectiveStartSeconds: 375,
					effectiveEndSeconds: 675,
					relationToPrevious: "gap",
					relationSeconds: 75,
					gapConfirmed: false,
				},
			],
			timeline: {
				...workspace().timeline,
				state: "gap_unconfirmed",
				gapCount: 1,
				unconfirmedGapCount: 1,
			},
		});
		const recovery = sessionTimelineRecovery(current);
		expect(recovery).toMatchObject({
			severity: "blocker",
			title: "Existe um intervalo de 1min 15s entre estas gravações.",
			detail: "O intervalo será preservado. Confirme-o para continuar.",
			actionLabel: "Revisar intervalo",
			target: "position",
		});
	});

	it("describes an unresolved overlap with its duration and exact recovery target", () => {
		const current = workspace({
			parts: [
				workspace().parts[0],
				{
					...workspace().parts[1],
					relationToPrevious: "overlap",
					relationSeconds: 42,
					overlapResolutionValid: false,
				},
			],
			timeline: {
				...workspace().timeline,
				state: "overlap_unresolved",
				overlapCount: 1,
				unresolvedOverlapCount: 1,
			},
		});
		const recovery = sessionTimelineRecovery(current);
		expect(recovery).toMatchObject({
			severity: "blocker",
			title: "Estas gravações se sobrepõem por 42s.",
			actionLabel: "Resolver sobreposição",
			target: "overlap",
		});
	});

	it("maps a missing completed run to selective processing", () => {
		const recovery = sessionRecoveryForError(
			failure("SESSION_ASSEMBLY_PART_INVALID"),
			workspace(),
		);
		expect(recovery).toMatchObject({
			title: "Uma gravação ainda não possui resultado concluído.",
			actionLabel: "Processar parte pendente",
			target: "run",
		});
		expect(recovery.detail).toContain("demais resultados concluídos permanecem preservados");
	});

	it.each(["timeout", "unreachable"] as const)(
		"keeps %s human and reloadable",
		(code) => {
			const recovery = sessionRecoveryForError(
				new BridgeError(code),
				workspace(),
			);
			expect(recovery.severity).toBe("error");
			expect(recovery.actionLabel).toBe("Atualizar sessão");
			expect(recovery.target).toBe("reload");
			expect(sessionRecoveryPrimaryText(recovery)).not.toContain(code);
		},
	);

	it("keeps an unknown server code only as technical detail", () => {
		const code = "SESSION_WORKSPACE_FUTURE_RECOVERY_CASE";
		const recovery = sessionRecoveryForError(failure(code), workspace());
		expect(recovery).toMatchObject({
			severity: "error",
			title: "Não foi possível concluir esta operação local.",
			actionLabel: "Atualizar sessão",
			target: "reload",
			technicalCode: code,
		});
		expect(sessionRecoveryPrimaryText(recovery)).not.toContain(code);
	});
});
