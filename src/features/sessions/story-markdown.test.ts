import { describe, expect, it } from "vitest";
import { parseStoryMarkdown } from "./story-markdown";

describe("story markdown parser", () => {
	it("strips legacy frontmatter and keeps story blocks", () => {
		const blocks = parseStoryMarkdown(`---
title: "A história"
date: "2026-07-29"
tags:
  - D&D
---

# A história

Primeiro parágrafo.

- um
- dois
`);

		expect(blocks).toEqual([
			{ type: "heading", level: 1, text: "A história" },
			{ type: "paragraph", text: "Primeiro parágrafo." },
			{ type: "list", ordered: false, items: ["um", "dois"] },
		]);
	});

	it("parses headings, quotes, ordered lists and rules", () => {
		const blocks = parseStoryMarkdown(`## Descoberta

> Uma frase importante.
> Continua aqui.

1. Primeiro
2. Segundo

---
`);

		expect(blocks).toEqual([
			{ type: "heading", level: 2, text: "Descoberta" },
			{ type: "quote", text: "Uma frase importante. Continua aqui." },
			{ type: "list", ordered: true, items: ["Primeiro", "Segundo"] },
			{ type: "rule" },
		]);
	});

	it("joins soft lines and preserves markdown hard breaks", () => {
		const blocks = parseStoryMarkdown("Linha um\nlinha dois  \nlinha três");
		expect(blocks).toEqual([
			{ type: "paragraph", text: "Linha um linha dois\nlinha três" },
		]);
	});

	it("keeps raw html as plain text instead of interpreting it", () => {
		const blocks = parseStoryMarkdown('<script>alert("não")</script>');
		expect(blocks).toEqual([
			{ type: "paragraph", text: '<script>alert("não")</script>' },
		]);
	});
});
