import { describe, expect, it } from "vitest";
import { sessionShareDescription } from "./share";

describe("session sharing", () => {
	it("normalizes markdown-like summary copy and bounds its length", () => {
		const description = sessionShareDescription(
			"## **Resumo**\n\n> A mesa   encontrou `Yuhara` e seguiu em frente.",
			"Sessão 12",
		);
		expect(description).toBe("Resumo A mesa encontrou Yuhara e seguiu em frente.");
		expect(description.length).toBeLessThanOrEqual(240);
	});

	it("uses a branded fallback when the summary is empty", () => {
		expect(sessionShareDescription("   ", "A Última Canção")).toBe(
			"Resumo público de A Última Canção no TDA — Tem Dado Aqui.",
		);
	});
});
