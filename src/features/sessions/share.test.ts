import { describe, expect, it } from "vitest";
import { sessionShareDescription, whatsappShareUrl } from "./share";

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

	it("encodes title, description and URL for WhatsApp", () => {
		const url = whatsappShareUrl({
			title: "Sessão 12",
			description: "Um resumo curto.",
			url: "https://example.com/sessoes/12?ref=mesa",
		});
		const parsed = new URL(url);
		expect(parsed.hostname).toBe("wa.me");
		expect(parsed.searchParams.get("text")).toBe(
			"Sessão 12\n\nUm resumo curto.\n\nhttps://example.com/sessoes/12?ref=mesa",
		);
	});
});
