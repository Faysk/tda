import { describe, expect, it } from "vitest";
import { buildStoryOutline } from "./story-outline";

describe("story outline", () => {
	it("skips the duplicated document title and creates stable unique anchors", () => {
		const source = [
			"# Minha sessão",
			"",
			"## Chegada",
			"",
			"### Detalhe",
			"",
			"## Chegada",
			"",
			"## Chegada 2",
			"",
			"## Chegada",
		].join("\n");
		const result = buildStoryOutline(source, "Minha sessão");

		expect(result.outline).toEqual([
			{ blockIndex: 1, id: "secao-chegada", level: 2, text: "Chegada" },
			{ blockIndex: 2, id: "secao-detalhe", level: 3, text: "Detalhe" },
			{ blockIndex: 3, id: "secao-chegada-2", level: 2, text: "Chegada" },
			{ blockIndex: 4, id: "secao-chegada-2-2", level: 2, text: "Chegada 2" },
			{ blockIndex: 5, id: "secao-chegada-3", level: 2, text: "Chegada" },
		]);
	});

	it("normalizes accents and formatting without changing the visible label", () => {
		const result = buildStoryOutline(
			"# Título\n\n## **Coração** que Não Morre\n\nTexto.",
			"Título",
		);
		expect(result.outline[0]).toEqual({
			blockIndex: 1,
			id: "secao-coracao-que-nao-morre",
			level: 2,
			text: "Coração que Não Morre",
		});
	});
});
