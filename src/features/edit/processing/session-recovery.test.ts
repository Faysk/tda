import { describe, expect, it } from "vitest";
import {
	isInternalSessionCode,
	sessionRecoveryGuidance,
	sessionRecoveryPrimaryMessage,
} from "./session-recovery";

const knownCodes = [
	"SESSION_WORKSPACE_TIMELINE_MANUAL_OVERRIDE",
	"SESSION_WORKSPACE_TIMELINE_ORDER_AMBIGUOUS",
	"SESSION_WORKSPACE_TIMELINE_ORDER_COLLISION",
	"SESSION_WORKSPACE_TIMELINE_ORDER_CONFLICT",
	"SESSION_WORKSPACE_SEQUENCE_INVALID",
	"SESSION_WORKSPACE_SOURCE_UNAVAILABLE",
	"SESSION_ASSEMBLY_TIMELINE_NOT_READY",
	"SESSION_ASSEMBLY_OVERLAP_BOUNDARY_INVALID",
	"SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INVALID",
	"SESSION_ASSEMBLY_RUN_INVALID",
	"SESSION_ASSEMBLY_RUN_NOT_VISIBLE",
	"SESSION_WORKSPACE_REVISION_CONFLICT",
] as const;

describe("sessionRecoveryGuidance", () => {
	it.each(knownCodes)("never leaks %s into primary copy", (code) => {
		const guidance = sessionRecoveryGuidance(code);
		const primary = sessionRecoveryPrimaryMessage(code);
		expect(primary).not.toContain(code);
		expect(guidance.title).not.toContain("SESSION_");
		expect(guidance.detail).not.toContain("SESSION_");
	});

	it("turns manual override into preserved-state guidance", () => {
		expect(
			sessionRecoveryGuidance("SESSION_WORKSPACE_TIMELINE_MANUAL_OVERRIDE"),
		).toMatchObject({
			severity: "warning",
			target: "order",
			cta: "Revisar ordem",
		});
		expect(
			sessionRecoveryPrimaryMessage(
				"SESSION_WORKSPACE_TIMELINE_MANUAL_OVERRIDE",
			),
		).toContain("preservou sua decisão");
	});

	it("routes blockers to a concrete recovery target", () => {
		expect(
			sessionRecoveryGuidance("SESSION_WORKSPACE_SOURCE_UNAVAILABLE"),
		).toMatchObject({ target: "source", cta: "Selecionar ZIP original" });
		expect(
			sessionRecoveryGuidance("SESSION_ASSEMBLY_RUN_INVALID"),
		).toMatchObject({ target: "run", cta: "Processar parte pendente" });
		expect(
			sessionRecoveryGuidance(
				"SESSION_ASSEMBLY_PARTICIPANT_MAPPING_INVALID",
			),
		).toMatchObject({
			target: "participants",
			cta: "Resolver participantes",
		});
		expect(
			sessionRecoveryGuidance("SESSION_ASSEMBLY_OVERLAP_BOUNDARY_INVALID"),
		).toMatchObject({
			target: "overlap",
			cta: "Resolver sobreposição",
		});
	});

	it("keeps timeout and unreachable human while preserving retry semantics", () => {
		for (const code of ["timeout", "unreachable"]) {
			expect(sessionRecoveryGuidance(code)).toMatchObject({
				severity: "error",
				target: "retry",
				cta: "Tentar novamente",
			});
			expect(sessionRecoveryPrimaryMessage(code)).not.toContain(code);
		}
	});

	it("keeps unknown internal codes out of the primary message", () => {
		const unknown = "SESSION_ASSEMBLY_SOMETHING_NEW";
		const guidance = sessionRecoveryGuidance(unknown);
		expect(guidance.title).toBe(
			"Não foi possível concluir esta etapa da sessão.",
		);
		expect(sessionRecoveryPrimaryMessage(unknown)).not.toContain(unknown);
		expect(isInternalSessionCode(unknown)).toBe(true);
	});

	it("does not classify ordinary transport labels as internal session codes", () => {
		expect(isInternalSessionCode("timeout")).toBe(false);
		expect(isInternalSessionCode("unreachable")).toBe(false);
	});
});
