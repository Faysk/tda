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

	it("parses only canonical TDA inline images between chapters", () => {
		const imageUrl = "https://media.dnd.faysk.dev/campaigns/yuhara-main/sessions/11111111-1111-4111-8111-111111111111/inline/" + "a".repeat(64) + ".webp";
		const blocks = parseStoryMarkdown("# Dança\n![Astel com Talven](" + imageUrl + ' "tda-inline:22222222-2222-4222-8222-222222222222")' + "\n## O mestre\nUma aula.");
		expect(blocks).toEqual([
			{ type: "heading", level: 1, text: "Dança" },
			{ type: "image", alt: "Astel com Talven", src: imageUrl, title: "tda-inline:22222222-2222-4222-8222-222222222222" },
			{ type: "heading", level: 2, text: "O mestre" },
			{ type: "paragraph", text: "Uma aula." },
		]);
	});

	it("does not render untrusted Markdown image destinations as navigable images", () => {
		const good = "https://media.dnd.faysk.dev/campaigns/yuhara-main/sessions/11111111-1111-4111-8111-111111111111/inline/" + "a".repeat(64) + ".webp";
		for (const url of [
			"javascript:alert(1)", "http://example.org/portrait.png",
			"//example.org/portrait.png", "https://evil.example/portrait.webp",
			"https://media.dnd.faysk.dev.evil.example" + new URL(good).pathname,
			good + "?token=secret", good + "#fragment",
			good.replace("/inline/", "/cover/"),
			good.replace("/inline/", "/inline/%2e%2e/"),
			good.replace("yuhara-main", "../private"),
			"https://media.dnd.faysk.dev/image.webp",
		]) {
			expect(parseStoryMarkdown("![Retrato](" + url + ")")).toEqual([
				{ type: "paragraph", text: "![Retrato](" + url + ")" },
			]);
		}
	});

	it("keeps raw html as plain text instead of interpreting it", () => {
		const blocks = parseStoryMarkdown('<script>alert("não")</script>');
		expect(blocks).toEqual([
			{ type: "paragraph", text: '<script>alert("não")</script>' },
		]);
	});
});
